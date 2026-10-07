// Dev page for the aircraft model (src/render/aircraft; the Cessna 172S unless type= says otherwise). Places
// the aircraft on a runway on a flat plane at the field elevation (agl=0) or in flight, drives every animated
// part from URL parameters or an automatic cycle, and offers camera presets around the aircraft and at the
// pilot eye.
//
// Extra URL parameters (on top of the harness ones):
//   type=<id>              the airframe and panel of a registered type (c172s, c152, pa38, da20, pa34, da42: a
//                          type that has no airframe of its own yet shows its placeholder), or a synthetic
//                          airframe of render/aircraft/airframe/testbed.ts (syn-twin, syn-canopy)
//   gear=0..1              landing gear extension of every leg (retractable types; default 1 = down)
//   pitch=deg              blade angle of every variable-pitch propeller (default: the angle it is built at)
//   feather=1|2|all        that propeller (or every one) stopped with its blades feathered
//   rpm2=1200              rpm of the second propeller (default: rpm)
//   view=front|side|rear|top|low|flaps|gear|gearfront|nose|door|root|tail|cockpit|cockpitleft|cockpitdown   camera preset (follows the aircraft)
//   anim=1                 cycle surfaces, flaps, gear compression, steering, prop rpm and lights over time
//   flaps=deg ail=deg elev=deg rud=deg trim=deg   surface deflections (ail = left aileron; right is opposite)
//   rpm=2300 comp=0.06 steer=deg                  propeller rpm, strut compression (m), nosewheel steering
//   lights=nav,beacon,strobe,landing,taxi | all | none      panel=0..1 panel light level
//   paneltex=1             show a test instrument-panel texture (checks the setPanelTexture mapping)
//   t=seconds              simulation time offset (strobe/beacon phase; use with freeze=1)
//   exposure=1             exposure multiplier over the harness's daylight exposure (dusk defaults higher)
//   pants=0                build without wheel fairings
//   hash=1                 regression mode (use with freeze=1): Math.random is replaced by a seeded generator before
//                          anything is built (the asphalt texture is otherwise different on every load, so two
//                          screenshots of the same tree would not be pixel-identical), and window.__hash is set
//                          before window.__ready: SHA-256 digests of the four baked fuselage textures (colour,
//                          detail, glass, lining) and the cockpit group's mesh count, vertex count and bounding
//                          box, with one digest over all of it in `hash`. Read it with
//                          scripts/shot.mjs --eval "window.__hash"; the gate compares it with the lead's baseline.
import * as THREE from 'three';
import type { SimContext } from '../core/context';
import { C172 } from '../core/c172';
import { DEG, clamp, smoothstep } from '../core/math';
import { AIRPORT } from '../core/world';
import { emptyEngineState, emptyPropellerState } from '../core/types';
import type { PanelDef } from '../instruments/panelDef';
import type { AirframeVisualDef } from '../render/aircraft/airframe/types';
import { AircraftVisual } from '../render/aircraft/AircraftVisual';
import { runHarness } from './harness';

const params = new URLSearchParams(location.search);
const num = (k: string, d: number): number => (params.has(k) && params.get(k) !== '' ? Number(params.get(k)) : d);
const anim = params.get('anim') === '1';
const hashMode = params.get('hash') === '1';
if (hashMode) {
  // mulberry32 with a fixed seed: every load of the page draws the same random numbers in the same order.
  let seed = 0x172;
  Math.random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** type=: the airframe (and panel) to show instead of the Cessna 172S. Loaded only when asked for. */
let airframe: AirframeVisualDef | undefined;
let panelDef: PanelDef | undefined;
const type = params.get('type');
if (type) {
  const { SYNTHETIC_AIRFRAMES } = await import('../render/aircraft/airframe/testbed');
  if (Object.hasOwn(SYNTHETIC_AIRFRAMES, type)) airframe = SYNTHETIC_AIRFRAMES[type];
  else {
    const { isAircraftId, loadPresentation } = await import('../aircraft/registry');
    if (!isAircraftId(type)) throw new Error(`type=${type}: not an aircraft id (nor ${Object.keys(SYNTHETIC_AIRFRAMES).join(', ')})`);
    const presentation = await loadPresentation(type);
    airframe = presentation.visual;
    panelDef = presentation.panel;
  }
}
// (The bake is synchronous here whatever the type: the worker would bake the registered airframe of the id.)
const visual = new AircraftVisual({ wheelFairings: params.get('pants') !== '0', asyncBake: false, ...(airframe ? { airframe } : {}), ...(panelDef ? { panelDef } : {}) });
/** Blade angle of a feathered propeller on this page. */
const FEATHER = 84 * DEG;

/** Camera presets: [position, target] in aircraft model space (nose -Z, right +X, up +Y). */
const eye = visual.pilotEye;
const PRESETS: Record<string, [THREE.Vector3, THREE.Vector3]> = {
  front: [new THREE.Vector3(-6.5, 0.9, -8.5), new THREE.Vector3(0, -0.2, -0.6)],
  side: [new THREE.Vector3(-13, 0.2, -0.9), new THREE.Vector3(0, -0.1, 0.9)],
  rear: [new THREE.Vector3(7.5, 2.6, 9.5), new THREE.Vector3(0, -0.2, 0.8)],
  top: [new THREE.Vector3(0.001, 16, 0.6), new THREE.Vector3(0, 0, 0.6)],
  low: [new THREE.Vector3(-3.2, -1.05, -6.4), new THREE.Vector3(0, 0, -0.6)],
  flaps: [new THREE.Vector3(3.3, 1.5, 3.4), new THREE.Vector3(1.6, 0.35, 0.9)],
  gear: [new THREE.Vector3(-3.4, -0.75, -2.2), new THREE.Vector3(-0.9, -0.9, 0.2)],
  nose: [new THREE.Vector3(-2.2, 0.35, -4.2), new THREE.Vector3(0, -0.1, -1.9)],
  gearfront: [new THREE.Vector3(-1.6, -0.55, -4.6), new THREE.Vector3(0, -0.85, -0.4)],
  root: [new THREE.Vector3(-2.2, 2.2, 2.6), new THREE.Vector3(-0.5, 0.6, 0.2)],
  door: [new THREE.Vector3(-2.1, 0.05, -0.1), new THREE.Vector3(-0.4, -0.15, 0.3)],
  tail: [new THREE.Vector3(-3.0, 1.6, 8.6), new THREE.Vector3(0, 0.5, 4.8)],
  cockpit: [eye.clone(), eye.clone().add(new THREE.Vector3(0, -0.035, -1))],
  cockpitleft: [eye.clone(), eye.clone().add(new THREE.Vector3(-1, 0.25, -0.35))],
  cockpitdown: [eye.clone(), eye.clone().add(new THREE.Vector3(0.25, -0.75, -0.6))],
};

function lightsFromParam(ctx: SimContext): void {
  const l = ctx.controls.lights;
  const v = params.get('lights');
  if (v === null) return;
  const on = v === 'all' ? ['nav', 'beacon', 'strobe', 'landing', 'taxi'] : v.split(',');
  l.nav = on.includes('nav');
  l.beacon = on.includes('beacon');
  l.strobe = on.includes('strobe');
  l.landing = on.includes('landing');
  l.taxi = on.includes('taxi');
}

/** Scene units of the dev sky dome at full daylight, and of the direct sun (core/context.ts: noon ~1e4). */
const SKY_UNITS = 1000;
const SUN_UNITS = 1e4;
/** The harness's fixed daylight exposure (src/dev/harness.ts). */
const DAY_EXPOSURE = 1 / 3200;

/** A gradient sky dome with sun-dependent colours; also baked into scene.environment for reflections. */
function makeSky(ctx: SimContext, dayFactor: number, ambient: number): THREE.Mesh {
  // Day colours fading to a blue night sky with a warm afterglow on the horizon, scaled by sky brightness.
  // Radiances on the project's photometric scale (core/context.ts): a clear day sky is ~5000-9000 cd/m^2.
  const k = ambient * SKY_UNITS;
  const zenith = new THREE.Color(0.1, 0.25, 0.65).lerp(new THREE.Color(0.25, 0.35, 0.9), 1 - dayFactor).multiplyScalar(k);
  const horizon = new THREE.Color(0.62, 0.72, 0.85).lerp(new THREE.Color(1.6, 0.7, 0.45), 1 - dayFactor).multiplyScalar(k);
  const ground = new THREE.Color(0.16, 0.17, 0.12).multiplyScalar(k);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { zenith: { value: zenith }, horizon: { value: horizon }, ground: { value: ground } },
    vertexShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <logdepthbuf_pars_fragment>
      uniform vec3 zenith; uniform vec3 horizon; uniform vec3 ground;
      varying vec3 vDir;
      void main() {
        #include <logdepthbuf_fragment>
        float h = vDir.y;
        vec3 c = h > 0.0 ? mix(horizon, zenith, pow(h, 0.45)) : mix(horizon, ground, pow(-h, 0.3));
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat);
  const envScene = new THREE.Scene();
  envScene.add(dome.clone());
  const pmrem = new THREE.PMREMGenerator(ctx.renderer);
  ctx.scene.environment = pmrem.fromScene(envScene, 0.02).texture;
  pmrem.dispose();
  dome.scale.setScalar(20000);
  dome.frustumCulled = false;
  return dome;
}

function makeGround(ctx: SimContext): void {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d')!;
  const img = g.createImageData(512, 512);
  for (let i = 0; i < 512 * 512; i++) {
    const n = 90 + Math.random() * 40;
    img.data[i * 4] = n;
    img.data[i * 4 + 1] = n;
    img.data[i * 4 + 2] = n * 0.98;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const asphaltTex = new THREE.CanvasTexture(c);
  asphaltTex.wrapS = asphaltTex.wrapT = THREE.RepeatWrapping;
  asphaltTex.repeat.set(60, 4);
  asphaltTex.colorSpace = THREE.SRGBColorSpace;
  // Moderately tessellated planes: a single 40 km quad rasterises with visible depth speckle.
  const grass = new THREE.Mesh(
    new THREE.PlaneGeometry(6000, 6000, 60, 60).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(0.13, 0.2, 0.07), roughness: 1 }),
  );
  grass.position.y = AIRPORT.elevation - 0.06;
  grass.receiveShadow = true;
  const rw = AIRPORT.runway;
  const asphalt = new THREE.Mesh(
    new THREE.PlaneGeometry(rw.length, rw.width, 90, 3).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ map: asphaltTex, color: 0x9a9a9a, roughness: 0.92 }),
  );
  asphalt.position.set(0, AIRPORT.elevation, 0);
  // PlaneGeometry length along three x (east); rotate to the runway heading (true, clockwise from north).
  asphalt.rotation.y = Math.PI / 2 - rw.heading;
  asphalt.receiveShadow = true;
  const stripes = new THREE.Group();
  for (let a = -rw.length / 2 + 40; a < rw.length / 2 - 40; a += 50) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 0.9).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.8 }),
    );
    m.position.x = a;
    m.receiveShadow = true;
    stripes.add(m);
  }
  stripes.position.set(0, AIRPORT.elevation + 0.01, 0);
  stripes.rotation.y = asphalt.rotation.y;
  ctx.scene.add(grass, asphalt, stripes);
}

function configureLighting(ctx: SimContext): void {
  const sunDir = ctx.sky.sunDir;
  const elev = Math.asin(clamp(sunDir.y, -1, 1));
  // Rough twilight model: direct sun gone just below the horizon, sky light falling ~300x to night.
  const day = smoothstep(-8 * DEG, 10 * DEG, elev);
  const ambient = 0.004 + 0.996 * Math.pow(day, 2.2);
  ctx.sky.dayFactor = day;
  const sun = ctx.scene.children.find((o): o is THREE.DirectionalLight => (o as THREE.DirectionalLight).isDirectionalLight);
  const hemi = ctx.scene.children.find((o): o is THREE.HemisphereLight => (o as THREE.HemisphereLight).isHemisphereLight);
  const ac = ctx.aircraftRoot.position;
  if (sun) {
    const direct = smoothstep(-1 * DEG, 8 * DEG, elev);
    sun.intensity = direct * SUN_UNITS;
    sun.color.setRGB(1, 0.75 + 0.23 * direct, 0.55 + 0.4 * direct);
    sun.castShadow = direct > 0.02;
    sun.position.copy(ac).addScaledVector(sunDir, 60);
    sun.target.position.copy(ac);
    const cam = sun.shadow.camera;
    cam.left = cam.bottom = -9;
    cam.right = cam.top = 9;
    cam.near = 1;
    cam.far = 140;
    sun.shadow.mapSize.set(4096, 4096);
    sun.shadow.bias = -0.0002;
    sun.shadow.normalBias = 0.02;
  }
  if (hemi) hemi.intensity = ambient;
  const sky = makeSky(ctx, day, ambient);
  sky.position.copy(ac);
  ctx.scene.add(sky);
  ctx.scene.background = null;
  // Stand-in for the post chain's eye adaptation: the harness's daylight exposure, raised as it gets dark
  // (exposure= multiplies it).
  ctx.renderer.toneMappingExposure = DAY_EXPOSURE * num('exposure', clamp(0.3 / ambient, 1, 40));
}

/** Test pattern for the panel texture: a frame, labelled corners and six round gauges. */
function testPanelTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 1040;
  c.height = 400;
  const g = c.getContext('2d')!;
  g.fillStyle = '#26282c';
  g.fillRect(0, 0, 1040, 400);
  g.strokeStyle = '#e0e0e0';
  g.lineWidth = 6;
  g.strokeRect(3, 3, 1034, 394);
  for (let i = 0; i < 6; i++) {
    const x = 120 + (i % 3) * 150;
    const y = 120 + Math.floor(i / 3) * 160;
    g.fillStyle = '#0b0b0c';
    g.beginPath();
    g.arc(x, y, 68, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#ddd';
    g.lineWidth = 3;
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      g.beginPath();
      g.moveTo(x + Math.cos(a) * 52, y + Math.sin(a) * 52);
      g.lineTo(x + Math.cos(a) * 64, y + Math.sin(a) * 64);
      g.stroke();
    }
    g.strokeStyle = '#fff';
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + 40 * Math.cos(-1 + i), y + 40 * Math.sin(-1 + i));
    g.stroke();
  }
  g.fillStyle = '#0a2a0a';
  g.fillRect(620, 40, 380, 250);
  g.fillStyle = '#9f9';
  g.font = 'bold 40px sans-serif';
  g.fillText('TOP LEFT', 20, 50);
  g.fillText('RIGHT ->', 830, 380);
  g.fillText('UP ^', 760, 170);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** First 16 hex digits of the SHA-256 of some bytes. */
async function digest(bytes: Uint8Array): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>));
  return Array.from(d.subarray(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * hash=1: publish window.__hash (see the header). Everything is found by walking the scene graph under the
 * visual's root (materials by name, the group named 'cockpit'), not through private members; what is not found
 * is recorded as 'missing', which no baseline equals.
 */
async function publishHash(): Promise<void> {
  const materials = new Map<string, THREE.MeshStandardMaterial>();
  visual.root.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    for (const x of Array.isArray(m) ? m : m ? [m] : []) if (x.name && !materials.has(x.name)) materials.set(x.name, x as THREE.MeshStandardMaterial);
  });
  const texture = async (t: THREE.Texture | null | undefined): Promise<{ width: number; height: number; sha: string } | 'missing'> => {
    const img = t?.image as { data?: unknown; width: number; height: number } | undefined;
    if (!img || !(img.data instanceof Uint8Array)) return 'missing';
    return { width: img.width, height: img.height, sha: await digest(img.data) };
  };
  const textures = {
    colour: await texture(materials.get('fuselagePaint')?.map),
    detail: await texture(materials.get('fuselagePaint')?.bumpMap),
    glass: await texture(materials.get('glass')?.alphaMap),
    lining: await texture(materials.get('lining')?.alphaMap),
  };
  // The cockpit group in the model space of the visual's root (independent of where the aircraft stands).
  const group = visual.root.getObjectByName('cockpit');
  let cockpit: { meshes: number; vertices: number; bbox: number[] } | 'missing' = 'missing';
  if (group) {
    visual.root.updateMatrixWorld(true);
    const toRoot = visual.root.matrixWorld.clone().invert();
    const m = new THREE.Matrix4();
    const box = new THREE.Box3();
    const part = new THREE.Box3();
    let meshes = 0, vertices = 0;
    group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      meshes++;
      vertices += mesh.geometry.getAttribute('position')?.count ?? 0;
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      box.union(part.copy(mesh.geometry.boundingBox!).applyMatrix4(m.multiplyMatrices(toRoot, mesh.matrixWorld)));
    });
    // Micrometres: the model-space box does not depend on the last bits of the pose arithmetic.
    cockpit = { meshes, vertices, bbox: [...box.min.toArray(), ...box.max.toArray()].map((v) => Math.round(v * 1e6) / 1e6) };
  }
  const parts = { textures, cockpit };
  const hash = await digest(new TextEncoder().encode(JSON.stringify(parts)));
  (window as unknown as { __hash: unknown }).__hash = { hash, ...parts };
}

let camPreset: [THREE.Vector3, THREE.Vector3] | null = null;
let initStart = 0;
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();

void runHarness({
  subsystems: [
    visual,
    {
      async init() {
        // Build time of the aircraft (texture bake + geometry), readable with --eval "__aircraftInitMs".
        (window as unknown as { __aircraftInitMs: number }).__aircraftInitMs = performance.now() - initStart;
        if (hashMode) await publishHash();
      },
      update(_dt, ctx) {
        if (!camPreset) return;
        ctx.aircraftRoot.updateMatrixWorld();
        ctx.aircraftRoot.localToWorld(tmpA.copy(camPreset[0]));
        ctx.aircraftRoot.localToWorld(tmpB.copy(camPreset[1]));
        ctx.camera.position.copy(tmpA);
        ctx.camera.up.set(0, 1, 0).applyQuaternion(ctx.aircraftRoot.quaternion);
        ctx.camera.lookAt(tmpB);
      },
    },
  ],
  setup(ctx) {
    initStart = performance.now();
    // core/renderSetup asks for PCFSoftShadowMap, which three r186 no longer has (it warns every frame).
    ctx.renderer.shadowMap.type = THREE.PCFShadowMap;
    makeGround(ctx);
    configureLighting(ctx);
    lightsFromParam(ctx);
    ctx.controls.lights.panel = num('panel', ctx.controls.lights.panel);
    const view = params.get('view');
    if (view && PRESETS[view]) camPreset = PRESETS[view];
    if (view?.startsWith('cockpit')) ctx.cameraMode = 'cockpit';
    ctx.simTime = num('t', 0);
    // One engine and propeller state per propeller of the airframe (the harness's state is the Cessna's).
    const s = ctx.state;
    for (let i = s.propellers.length; i < (airframe?.props.length ?? 1); i++) {
      s.engines.push({ ...emptyEngineState(), ...s.engine });
      s.propellers.push({ ...emptyPropellerState(), ...s.propeller });
    }
    s.gear.retractable = airframe?.gear.some((w) => w.retract !== undefined) ?? false;
    applyStatic(ctx);
  },
  beforeUpdate(_dt, ctx) {
    if (anim) animate(ctx);
    if (params.get('paneltex') === '1' && !panelSet) {
      visual.setPanelTexture(testPanelTexture());
      panelSet = true;
    }
  },
});
let panelSet = false;

/** Apply the fixed surface / gear / prop values given in the URL. */
function applyStatic(ctx: SimContext): void {
  const s = ctx.state;
  s.surfaces.flaps = num('flaps', 0) * DEG;
  s.surfaces.aileronLeft = num('ail', 0) * DEG;
  s.surfaces.aileronRight = -num('ail', 0) * DEG;
  s.surfaces.elevator = num('elev', 0) * DEG;
  s.surfaces.rudder = num('rud', 0) * DEG;
  s.surfaces.elevatorTrim = num('trim', 0) * DEG;
  const rpm = num('rpm', s.propeller.rpm);
  s.propeller.rpm = s.engine.rpm = rpm;
  s.propeller.rotation = num('prop', 0.4);
  const feather = params.get('feather');
  s.propellers.forEach((p, i) => {
    const def = airframe?.props[i];
    if (i > 0) {
      p.rpm = s.engines[i].rpm = num('rpm2', rpm);
      // The spin angle is the state's and already signed: a propeller turning the other way counts down.
      p.rotation = (def?.rotation ?? 1) * num('prop', 0.4);
    }
    p.direction = def?.rotation ?? 1;
    p.bladePitch = params.has('pitch') ? num('pitch', 0) * DEG : (def?.referencePitch ?? 0);
    p.feathered = feather === 'all' || feather === String(i + 1);
    if (p.feathered) {
      p.bladePitch = FEATHER;
      p.rpm = s.engines[i].rpm = 0;
    }
  });
  const gear = clamp(num('gear', 1), 0, 1);
  s.gear.extension = [gear, gear, gear];
  ctx.controls.gearLever = s.gear.lever = gear < 0.5 ? 'up' : 'down';
  const comp = num('comp', s.wheels[0].compression);
  for (const w of s.wheels) {
    w.compression = comp;
    w.rotation = num('spin', 0);
  }
  s.wheels[0].steerAngle = num('steer', 0) * DEG;
  const c = ctx.controls;
  c.flaps = s.surfaces.flaps / C172.wing.flap.maxDeflection;
  c.aileron = clamp(num('ail', 0) / 15, -1, 1);
  c.elevator = clamp(-num('elev', 0) / 25, -1, 1);
  c.rudder = clamp(-num('rud', 0) / 16, -1, 1);
  c.throttle = clamp((rpm - 700) / 2000, 0, 1);
  c.mixture = num('mixture', 1);
  c.elevatorTrim = clamp(num('trim', 0) / 20, -1, 1);
}

/** Automatic cycle through every animation. */
function animate(ctx: SimContext): void {
  const t = ctx.simTime;
  const s = ctx.state;
  const c = ctx.controls;
  c.aileron = Math.sin(t * 0.9);
  c.elevator = Math.sin(t * 0.7 + 1);
  c.rudder = Math.sin(t * 0.5 + 2);
  c.flaps = 0.5 - 0.5 * Math.cos(t * 0.3);
  c.throttle = 0.5 - 0.5 * Math.cos(t * 0.2);
  c.mixture = 0.8 + 0.2 * Math.sin(t * 0.4);
  c.elevatorTrim = Math.sin(t * 0.25);
  s.surfaces.aileronLeft = c.aileron * (c.aileron > 0 ? C172.wing.aileron.maxDown : C172.wing.aileron.maxUp);
  s.surfaces.aileronRight = -c.aileron * (c.aileron < 0 ? C172.wing.aileron.maxDown : C172.wing.aileron.maxUp);
  s.surfaces.elevator = -c.elevator * (c.elevator > 0 ? C172.hTail.elevator.maxUp : C172.hTail.elevator.maxDown);
  s.surfaces.rudder = -c.rudder * C172.vTail.rudder.maxDeflection;
  s.surfaces.flaps = c.flaps * C172.wing.flap.maxDeflection;
  s.surfaces.elevatorTrim = c.elevatorTrim * 15 * DEG;
  const rpm = 600 + 2100 * c.throttle;
  s.propeller.rpm = s.engine.rpm = rpm;
  s.propeller.rotation += ((rpm / 60) * 2 * Math.PI) / 60;
  s.propellers.forEach((p, i) => {
    const def = airframe?.props[i];
    if (i > 0) {
      p.rpm = s.engines[i].rpm = rpm;
      p.rotation += (def?.rotation ?? 1) * ((rpm / 60) * 2 * Math.PI) / 60;
    }
    // Fine to coarse and back; the last propeller feathers and stops for a part of the cycle.
    if (def?.variablePitch) p.bladePitch = def.referencePitch + (0.5 - 0.5 * Math.cos(t * 0.35)) * 20 * DEG;
    if (def?.variablePitch && i > 0 && i === s.propellers.length - 1 && Math.floor(t / 9) % 2 === 1) {
      p.bladePitch = FEATHER;
      p.rpm = 0;
    }
  });
  if (s.gear.retractable) {
    // Up and down with a pause at each end.
    const g = clamp(0.5 + 0.8 * Math.cos(t * 0.4), 0, 1);
    s.gear.extension = [g, g, g];
    c.gearLever = g < 0.5 ? 'up' : 'down';
  }
  for (const e of s.engines) e.cowlFlap = 0.5 - 0.5 * Math.cos(t * 0.5);
  for (const w of s.wheels) {
    w.compression = 0.06 + 0.05 * Math.sin(t * 1.3 + (w.name === 'nose' ? 0 : 1.5));
    w.rotation += 0.15;
  }
  s.wheels[0].steerAngle = Math.sin(t * 0.6) * C172.gear.maxNoseSteer;
  const cyc = Math.floor(t / 4) % 2 === 0;
  const l = c.lights;
  l.nav = l.beacon = l.strobe = true;
  l.landing = cyc;
  l.taxi = !cyc;
}
