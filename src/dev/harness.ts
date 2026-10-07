// Stand-alone page harness for developing one visual module in isolation. It builds a SimContext with a
// mock aircraft state, neutral daylight and a free camera, runs a render loop, and sets window.__ready
// once the module has initialised and a few frames have rendered (scripts/shot.mjs waits for that).
//
// URL parameters (all optional):
//   cam=north,east,alt      camera position (m; alt is MSL)
//   look=north,east,alt     point the camera looks at
//   fov=60                  vertical field of view, degrees
//   tod=9.5                 local solar time, hours
//   agl=300                 mock aircraft height above the airfield, m (0 = on the runway)
//   hdg=70                  mock aircraft heading, degrees
//   tas=54                  mock aircraft true airspeed, m/s
//   freeze=1                do not advance time (deterministic screenshots)
//   aircraft=c172s          the type in the context (ctx.aircraft / ctx.presentation) and the mock state (default c172s)
// Any other parameter is left for the module under test to read from location.search.
//
// Manual inspection: drag = look, WASD/QE = move, shift = fast, wheel = change speed.

import * as THREE from 'three';
import { DEFAULT_AIRCRAFT_ID, isAircraftId, loadAircraft, loadPresentation } from '../aircraft/registry';
import { createEventBus, type SimContext, type Subsystem } from '../core/context';
import { applyPose, nedToThree } from '../core/frames';
import { DEG } from '../core/math';
import { makeMockEnvironment, makeMockState } from '../core/mockState';
import { createCamera, createRenderer } from '../core/renderSetup';
import { defaultControls, defaultWeather } from '../core/types';
import { AIRPORT, sunDirectionNED } from '../core/world';

export interface HarnessOptions {
  /** Subsystems under test, initialised in order. */
  subsystems: Subsystem[];
  /**
   * Basic stand-in lighting (sun + hemisphere light + flat background). Default true. Turn off when the
   * module under test is the sky/lighting module itself.
   */
  basicLighting?: boolean;
  /** Called after the context exists but before subsystems initialise. */
  setup?(ctx: SimContext): void | Promise<void>;
  /** Called every frame before subsystem updates (e.g. to animate the mock state). */
  beforeUpdate?(dt: number, ctx: SimContext): void;
  /** Replace the default renderer.render(scene, camera) (e.g. to run a post-processing chain). */
  render?(dt: number, ctx: SimContext): void;
}

const params = new URLSearchParams(location.search);
const num = (key: string, fallback: number): number => {
  const v = params.get(key);
  return v === null || v === '' || Number.isNaN(Number(v)) ? fallback : Number(v);
};
const triple = (key: string): [number, number, number] | null => {
  const v = params.get(key);
  if (!v) return null;
  const p = v.split(',').map(Number);
  return p.length === 3 && p.every((n) => !Number.isNaN(n)) ? (p as [number, number, number]) : null;
};

export async function runHarness(opts: HarnessOptions): Promise<SimContext> {
  document.body.style.cssText = 'margin:0;overflow:hidden;background:#000';
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'display:block;width:100vw;height:100vh';
  document.body.appendChild(canvas);

  const basic = opts.basicLighting ?? true;
  const renderer = createRenderer(canvas, { antialias: true });
  renderer.setPixelRatio(1);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  if (basic) {
    // Fixed daylight exposure standing in for the post chain's auto exposure.
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1 / 3200;
  }

  const scene = new THREE.Scene();
  const camera = createCamera(window.innerWidth / window.innerHeight, num('fov', 60));
  const weather = defaultWeather();
  weather.timeOfDay = num('tod', weather.timeOfDay);

  const id = params.get('aircraft');
  const type = isAircraftId(id) ? id : DEFAULT_AIRCRAFT_ID;
  const [def, presentation] = await Promise.all([loadAircraft(type), loadPresentation(type)]);
  const state = makeMockState({
    def,
    heightAGL: num('agl', 300),
    heading: num('hdg', AIRPORT.runway.heading / DEG) * DEG,
    tas: params.has('tas') ? num('tas', 54) : undefined,
  });
  const aircraftRoot = new THREE.Object3D();
  aircraftRoot.name = 'aircraftRoot';
  scene.add(aircraftRoot);
  applyPose(aircraftRoot, state.position, state.orientation);

  const sunDir = nedToThree(sunDirectionNED(weather.timeOfDay, weather.dayOfYear));
  const ctx: SimContext = {
    renderer,
    scene,
    camera,
    aircraftRoot,
    state,
    controls: defaultControls(def),
    weather,
    env: makeMockEnvironment(),
    sky: {
      sunDir,
      moonDir: sunDir.clone().negate(),
      // Daylight at the project's photometric scale (see core/context.ts).
      sunColor: new THREE.Color(11000, 10000, 8700),
      moonColor: new THREE.Color(0, 0, 0),
      skyColor: new THREE.Color(340, 480, 740),
      hazeColor: new THREE.Color(900, 1000, 1150),
      hazeExtinction: 3.0 / weather.visibilityM,
      hazeScaleHeight: 1200,
      dayFactor: 1,
    },
    simTime: 0,
    paused: false,
    timeScale: 1,
    cameraMode: 'orbit',
    quality: 'high',
    commands: {
      reset: (s) => console.log('[harness] reset', s),
      setPaused: (p) => (ctx.paused = p),
      setCameraMode: (m) => (ctx.cameraMode = m),
      setTimeScale: (s) => (ctx.timeScale = s),
      setQuality: (q) => (ctx.quality = q),
    },
    events: createEventBus(),
    aircraft: def,
    presentation,
  };

  if (basic) {
    const sun = new THREE.DirectionalLight(ctx.sky.sunColor, 1);
    sun.position.copy(sunDir).multiplyScalar(1000);
    scene.add(sun, sun.target);
    scene.add(new THREE.HemisphereLight(ctx.sky.skyColor, new THREE.Color(250, 220, 180), 1.0));
    scene.background = new THREE.Color(1600, 2200, 3000);
    // Keep the stand-in sun centred on the camera so distant objects stay lit from the same direction.
    ctx.events.on('weatherChanged', () => {
      sunDir.copy(nedToThree(sunDirectionNED(weather.timeOfDay, weather.dayOfYear)));
      sun.position.copy(sunDir).multiplyScalar(1000);
    });
  }

  // Camera placement: default is a three-quarter view of the mock aircraft.
  const camNED = triple('cam');
  const lookNED = triple('look');
  if (camNED) camera.position.set(camNED[1], camNED[2], -camNED[0]);
  else camera.position.copy(aircraftRoot.position).add(new THREE.Vector3(14, 5, 16));
  if (lookNED) camera.lookAt(lookNED[1], lookNED[2], -lookNED[0]);
  else camera.lookAt(aircraftRoot.position);
  installFreeCamera(camera, canvas);

  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  });

  await opts.setup?.(ctx);
  for (const s of opts.subsystems) await s.init(ctx);

  const freeze = params.get('freeze') === '1';
  let last = performance.now();
  let frames = 0;
  const frame = (now: number): void => {
    const dt = freeze || ctx.paused ? 0 : Math.min(0.1, (now - last) / 1000) * ctx.timeScale;
    last = now;
    ctx.simTime += dt;
    ctx.state.time = ctx.simTime;
    opts.beforeUpdate?.(dt, ctx);
    applyPose(aircraftRoot, ctx.state.position, ctx.state.orientation);
    for (const s of opts.subsystems) s.update(dt, ctx);
    if (opts.render) opts.render(dt, ctx);
    else renderer.render(scene, camera);
    if (++frames === 8) (window as unknown as { __ready: boolean }).__ready = true;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  (window as unknown as { __ctx: SimContext }).__ctx = ctx;
  return ctx;
}

function installFreeCamera(camera: THREE.PerspectiveCamera, el: HTMLElement): void {
  const keys = new Set<string>();
  let speed = 40;
  let dragging = false;
  const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
  el.addEventListener('mousedown', () => (dragging = true));
  window.addEventListener('mouseup', () => (dragging = false));
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    euler.y -= e.movementX * 0.003;
    euler.x = Math.max(-1.55, Math.min(1.55, euler.x - e.movementY * 0.003));
    camera.quaternion.setFromEuler(euler);
  });
  el.addEventListener('wheel', (e) => (speed = Math.max(1, Math.min(20000, speed * (e.deltaY < 0 ? 1.25 : 0.8)))));
  window.addEventListener('keydown', (e) => keys.add(e.code));
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  let last = performance.now();
  const tick = (now: number): void => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const v = new THREE.Vector3(
      (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0),
      (keys.has('KeyE') ? 1 : 0) - (keys.has('KeyQ') ? 1 : 0),
      (keys.has('KeyS') ? 1 : 0) - (keys.has('KeyW') ? 1 : 0),
    );
    if (v.lengthSq() > 0) {
      v.normalize().multiplyScalar(speed * (keys.has('ShiftLeft') ? 8 : 1) * dt).applyQuaternion(camera.quaternion);
      camera.position.add(v);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
