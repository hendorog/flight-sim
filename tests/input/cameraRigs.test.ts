// Camera rig geometry (src/render/cameras): the cockpit eye turns about the neck and leans when looking back,
// the tower observer stands outside the cab on the aircraft's side, and mode switches whose path would pass
// through the airframe cut instead of blending.
//
// The cameras take the aircraft as data (CameraSystem.setAircraft: the pilot's eye, the bounding radius, the
// zoom-to-fit size, the default view), with the Cessna 172S as the default. The second half holds the numbers
// the cameras gave for the C172S when its eye and size were constants in the rigs (recorded from that code,
// compared exactly), and checks that another aircraft moves what it should and nothing else.

import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { C172 } from '../../src/core/c172';
import type { SimContext } from '../../src/core/context';
import { nedToThree, quatToThree } from '../../src/core/frames';
import { DEG, quat } from '../../src/core/math';
import type { AircraftState } from '../../src/core/types';
import { C172S_CAMERA, type CameraAircraft } from '../../src/render/cameras/aircraft';
import { CameraSystem, segmentNearPoint } from '../../src/render/cameras/CameraSystem';
import { CockpitRig, glanceAngles, headOffset, setCockpitGlance } from '../../src/render/cameras/cockpitRig';
import { FlybyRig } from '../../src/render/cameras/flybyRig';
import { HeadMotion } from '../../src/render/cameras/headMotion';
import { TOWER_STAND_OFF, TowerRig } from '../../src/render/cameras/towerRig';
import { makePose, type AircraftPose, type CameraPose } from '../../src/render/cameras/pose';
import { TemporalAA } from '../../src/render/post/TemporalAA';

describe('cockpit head movement', () => {
  it('leaves the default view at the design eye point', () => {
    expect(headOffset(0, -7 * DEG).length()).toBeLessThan(1e-9);
  });

  it('turns the head about the neck: a side look moves the eye sideways and slightly aft', () => {
    const left = headOffset(60 * DEG, 0);
    expect(left.x).toBeLessThan(-0.06); // model -x is left
    expect(left.z).toBeGreaterThan(0); // aft of the straight-ahead eye (the neck is behind it)
    const up = headOffset(0, 40 * DEG);
    expect(up.y).toBeGreaterThan(0);
  });

  it('looking back over a shoulder leans forward and to that side, clear of the seat back', () => {
    for (const yaw of [156 * DEG, -156 * DEG]) {
      const o = headOffset(yaw, 5 * DEG);
      // Forward of the straight-ahead eye (model -z), away from the headrest behind it.
      expect(o.z).toBeLessThan(-0.05);
      // Toward the looked-at side, more room inboard (right) than toward the door (left).
      if (yaw > 0) expect(o.x).toBeLessThan(-0.08);
      else expect(o.x).toBeGreaterThan(0.2);
      // Never far enough outboard to reach the cabin side (~0.23 m from the eye).
      expect(o.x).toBeGreaterThan(-0.15);
    }
  });
});

describe('tower observer', () => {
  const aircraftAt = (x: number, y: number, z: number) => ({ position: new THREE.Vector3(x, y, z), quaternion: new THREE.Quaternion() });

  it('stands outside the cab, on the side facing the aircraft, and follows it round smoothly', () => {
    const rig = new TowerRig({ x: 0, y: 0, z: -20 }); // NED: cab centre 20 m up at the origin
    const out = makePose();
    const east = aircraftAt(500, 5, 0);
    rig.activate(null, east);
    rig.update(0, 1 / 60, null, east, out);
    // three: x east, y up, z = -north.
    expect(out.position.x).toBeCloseTo(TOWER_STAND_OFF, 6);
    expect(out.position.z).toBeCloseTo(0, 6);
    expect(out.position.y).toBeCloseTo(20, 6);
    // The aircraft moves to the north: the observer walks round the catwalk over a second or two.
    const north = aircraftAt(0, 300, -500);
    rig.update(0, 1 / 60, null, north, out);
    const first = out.position.clone();
    expect(first.x).toBeGreaterThan(TOWER_STAND_OFF * 0.9);
    for (let i = 0; i < 600; i++) rig.update(0, 1 / 60, null, north, out);
    expect(out.position.x).toBeCloseTo(0, 1);
    expect(out.position.z).toBeCloseTo(-TOWER_STAND_OFF, 1);
    expect(Math.hypot(out.position.x, out.position.z)).toBeCloseTo(TOWER_STAND_OFF, 6);
  });
});

describe('camera mode switches', () => {
  it('detect a blend path through the airframe', () => {
    const ac = new THREE.Vector3(0, 0, 0);
    const chase = new THREE.Vector3(0, 3, 15);
    const cockpit = new THREE.Vector3(-0.27, 0.4, 0.18);
    const ahead = new THREE.Vector3(10, 2, -300);
    const orbitSide = new THREE.Vector3(20, 5, 10);
    expect(segmentNearPoint(chase, cockpit, ac, 6.5)).toBe(true);
    expect(segmentNearPoint(cockpit, chase, ac, 6.5)).toBe(true);
    expect(segmentNearPoint(chase, ahead, ac, 6.5)).toBe(true);
    expect(segmentNearPoint(chase, orbitSide, ac, 6.5)).toBe(false);
  });
});

/** What the rigs read of the aircraft, in a rolling climbing turn: frame i of 60 per second. */
function stateAt(i: number): AircraftState {
  const t = i / 60;
  const roll = 0.4 * Math.sin(t);
  const pitch = 0.1 * Math.cos(0.7 * t);
  const heading = 0.5 + 0.2 * t;
  return {
    position: { x: 100 + 40 * t, y: -20 + 25 * t, z: -300 - 2 * t },
    orientation: quat.fromEuler(roll, pitch, heading),
    velocity: { x: 40, y: 25, z: -2 },
    angularVelocity: { x: 0.3 * Math.sin(2 * t), y: 0.1 * Math.cos(3 * t), z: 0.2 * Math.sin(t) },
    specificForce: { x: 0.1 * Math.sin(t), y: 0.05 * Math.cos(2 * t), z: -1 - 0.3 * Math.sin(1.5 * t) },
    roll,
    pitch,
    heading,
    ias: 45,
    groundSpeed: 15,
    onGround: i >= 60,
    stallFraction: 0.2,
    altitudeAGL: 300,
    altitudeMSL: 300,
    verticalSpeed: 2,
  } as AircraftState;
}

function poseOf(s: AircraftState): AircraftPose {
  return { position: nedToThree(s.position), quaternion: quatToThree(s.orientation) };
}

function contextAt(i: number): SimContext {
  return {
    state: stateAt(i),
    env: { surface: () => 'grass', groundElevation: () => 0 },
    weather: { turbulence: 0.4 },
  } as unknown as SimContext;
}

/** Position, quaternion and field of view (-0 as 0: a recorded value does not carry the sign of zero). */
const numbers = (p: CameraPose | THREE.PerspectiveCamera): number[] => [...p.position.toArray(), ...p.quaternion.toArray(), p.fov].map((v) => v + 0);

/** A second and a half in the cockpit: a mouse look, a glance and back, a wheel zoom at the pointer, a touchdown. */
function flyCockpit(rig: CockpitRig, record: readonly number[]): number[][] {
  const out = makePose();
  const recorded: number[][] = [];
  rig.activate();
  for (let i = 0; i < 90; i++) {
    const ctx = contextAt(i);
    if (i === 10) rig.look(120, -40);
    if (i === 30) setCockpitGlance({ x: 0.2, y: -0.1, z: -0.9 });
    if (i === 50) rig.zoomAt(2, 0.3, -0.2, 16 / 9);
    if (i === 60) rig.touchdown(1.5);
    if (i === 70) setCockpitGlance(null);
    rig.update(1 / 60, 1 / 60, ctx, poseOf(ctx.state), out);
    if (record.includes(i)) recorded.push(numbers(out));
  }
  return recorded;
}

/** Two seconds of the manoeuvre: where the head has got to. */
function shakeHead(head: HeadMotion): number[] {
  for (let i = 0; i < 120; i++) head.update(1 / 60, stateAt(i), 0.4, 'grass');
  const { offset, shake } = head.out;
  return [offset.x, offset.y, offset.z, shake.x, shake.y, shake.z];
}

const TOWER = { x: 900, y: 400, z: -325 };

/** The fields of view a spectator and the tower choose for the aircraft at frame 0. */
function fits(flyby: FlybyRig, tower: TowerRig): number[] {
  const ctx = contextAt(0);
  const a = poseOf(ctx.state);
  const out = makePose();
  flyby.activate(ctx, a);
  flyby.update(1 / 60, 1 / 60, ctx, a, out);
  const fov = out.fov;
  tower.activate(null, a);
  tower.update(1 / 60, 1 / 60, null, a, out);
  return [fov, out.fov];
}

/** A camera system on a page that is not there: the listeners go nowhere and the wall clock is the test's. */
function bootCameras(): { cameras: CameraSystem; ctx: SimContext; frame: (i: number, dt?: number) => void } {
  const nowhere = { addEventListener: () => {}, removeEventListener: () => {} };
  vi.stubGlobal('window', nowhere);
  vi.stubGlobal('document', { pointerLockElement: null, exitPointerLock: () => {} });
  let wall = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => wall);
  const cameras = new CameraSystem({ towerPositionNED: TOWER, domElement: nowhere as unknown as HTMLElement });
  const ctx = { ...contextAt(0), camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 60000), events: { on: () => () => {} }, cameraMode: 'cockpit' } as unknown as SimContext;
  cameras.init(ctx);
  const frame = (i: number, dt = 1 / 60): void => {
    wall += 1000 / 60;
    ctx.state = stateAt(i);
    cameras.update(dt, ctx);
  };
  return { cameras, ctx, frame };
}

/** The first cockpit frame, then a second in each other mode and back: the camera at the end of each, and the cuts so far. */
function tour({ cameras, ctx, frame }: ReturnType<typeof bootCameras>): { boot: number[]; cuts: number[]; views: number[][] } {
  frame(0);
  const boot = numbers(ctx.camera);
  const cuts = [cameras.cuts];
  const views: number[][] = [];
  let i = 1;
  for (const mode of ['chase', 'orbit', 'tower', 'flyby', 'cockpit'] as const) {
    ctx.cameraMode = mode;
    for (let k = 0; k < 60; k++) frame(i++);
    cuts.push(cameras.cuts);
    views.push(numbers(ctx.camera));
  }
  return { boot, cuts, views };
}

/** The radius the temporal pass hands its shader once it has seen the aircraft twice. */
function reprojectionRadius(taa: TemporalAA): number {
  const camera = new THREE.PerspectiveCamera();
  const aircraft = new THREE.Object3D();
  const texture = new THREE.Texture();
  let radius = NaN;
  taa.setSize(8, 8);
  for (let k = 0; k < 2; k++) {
    taa.render(null as unknown as THREE.WebGLRenderer, texture, texture, camera, aircraft, (material) => {
      radius = (material.uniforms.uAircraft.value as THREE.Vector4).w;
    });
  }
  taa.dispose();
  return radius;
}

const C172S_TOUR = {
  boot: [-20.34316756811399, 300.39877945377117, -99.9359287370745, -0.010904899028650432, -0.24738047382565267, -0.003306012295971532, 0.9688514099848693, 60],
  // Cockpit to chase and fly-by to cockpit cut (the path enters the airframe); the three in between blend.
  cuts: [0, 1, 1, 1, 1, 2],
  views: [
    [-3.38349858040913, 303.9557751912278, -127.71619379208317, -0.007449024453929723, -0.3001956527225203, -0.06254947102228205, 0.951795485278228, 55],
    [26.23286717397701, 308.15823381635516, -160.80318250856095, -0.10403823261174384, -0.09620607501113611, -0.010111665941957712, 0.9898576622413219, 50],
    [397.90337019952847, 325, -895.9055960775987, -0.0029147585325074356, 0.9724973267136119, 0.01218778638494344, 0.23257667892678008, 4.804275917980171],
    [193.08152297068244, 1.7, -472.4414254836514, 0.105850172382809, 0.8726286738113235, -0.42412946511444666, 0.21778231211591517, 6.261239565336988],
    [104.81906992029923, 310.2858636276877, -300.41292313707635, -0.21276117661661448, -0.6379720772642427, 0.06258878990732893, 0.7374326774247243, 60],
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setCockpitGlance(null);
});

describe('the Cessna 172S through the cameras, as recorded before the aircraft was data', () => {
  it('is the default aircraft', () => {
    expect(C172S_CAMERA.pilotEye).toBe(C172.fuselage.pilotEye);
    expect(C172S_CAMERA).toEqual({ pilotEye: { x: -0.18, y: -0.27, z: -0.42 }, radius: 6.5, fitSize: 13, defaultPitchDeg: -7 });
  });

  it('glance angles and head offsets', () => {
    const panel = glanceAngles({ x: 0.2, y: -0.1, z: -0.9 });
    const behind = glanceAngles({ x: -0.3, y: 0.25, z: 0.5 });
    expect([panel.yaw, panel.pitch, behind.yaw, behind.pitch]).toEqual([-0.41046586456376605, -0.4157521985926258, 3.048115872431204, -0.4865233929258058]);
    expect(headOffset(60 * DEG, 0).toArray()).toEqual([-0.07794228634059946, 0.011490010291570728, 0.05286000768607929]);
    expect(headOffset(-156 * DEG, 5 * DEG).toArray()).toEqual([0.24851754001732107, 0.019067656005282145, -0.060718039748030986]);
  });

  it('head motion', () => {
    expect(shakeHead(new HeadMotion())).toEqual([
      -0.003307612105236549, 0.021870811379266015, 0.002079774929788068, -0.00008353947405256054, -0.001267631979191771, 0.00034853330164267643,
    ]);
  });

  it('the cockpit view through a look, a glance, a zoom and a touchdown', () => {
    expect(flyCockpit(new CockpitRig(), [29, 59, 89])).toEqual([
      [-8.171851908280164, 301.412046862323, -119.21497160400094, 0.06131798704838876, -0.48918261956074466, -0.08406730606881824, 0.8659521679829393, 60],
      [4.3950034584930195, 302.37623202777576, -139.20825259726462, -0.11011667906977975, -0.5104017794390618, -0.26963821864007054, 0.8091103580999885, 50.019464974463006],
      [16.905568230731067, 303.4273799210248, -159.19093245223266, 0.058590399751118655, -0.5920716761096927, -0.18779332657077127, 0.7815062136036712, 48.602740212031186],
    ]);
  });

  it('the zoom of the fly-by and tower cameras', () => {
    expect(fits(new FlybyRig(), new TowerRig(TOWER))).toEqual([8.692500089255569, 4.139465859583212]);
  });

  it('the camera system through every mode, and where it cuts', () => {
    expect(tour(bootCameras())).toEqual(C172S_TOUR);
  });

  it('the radius inside which the temporal pass moves pixels with the aircraft', () => {
    expect(reprojectionRadius(new TemporalAA())).toBe(7.5);
  });
});

describe('another aircraft', () => {
  // A low-wing twin, say: the eye further forward, right of the centre line and higher; twice the size.
  const OTHER: CameraAircraft = { pilotEye: { x: 0.4, y: 0.3, z: -0.6 }, radius: 16, fitSize: 26, defaultPitchDeg: -12 };

  it('given as the C172S, or given and taken back, changes no number', () => {
    const named = bootCameras();
    named.cameras.setAircraft({ ...C172S_CAMERA });
    expect(tour(named)).toEqual(C172S_TOUR);
    const back = bootCameras();
    back.cameras.setAircraft(OTHER);
    back.cameras.setAircraft();
    expect(tour(back)).toEqual(C172S_TOUR);
  });

  it('puts the cockpit camera at its eye point, in its default view', () => {
    const { cameras, ctx, frame } = bootCameras();
    cameras.setAircraft(OTHER);
    frame(0, 0); // paused: the head is at rest
    const a = poseOf(ctx.state);
    // FRD (x, y, z) is model space (y, -z, -x).
    const eye = new THREE.Vector3(0.3, 0.6, -0.4).applyQuaternion(a.quaternion).add(a.position);
    expect(ctx.camera.position.distanceTo(eye)).toBeLessThan(1e-9);
    const view = a.quaternion.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -12 * DEG));
    expect(ctx.camera.quaternion.angleTo(view)).toBeLessThan(1e-7);
    // Only what was given changes: the C172S eye with another default view.
    cameras.setAircraft({ defaultPitchDeg: -12 });
    frame(0, 0);
    const e = C172.fuselage.pilotEye;
    expect(ctx.camera.position.distanceTo(new THREE.Vector3(e.y, -e.z, -e.x).applyQuaternion(a.quaternion).add(a.position))).toBeLessThan(1e-9);
    expect(ctx.camera.quaternion.angleTo(view)).toBeLessThan(1e-7);
  });

  it('glances from its eye, and its head feels the rotation there', () => {
    // A point straight ahead of the eye, at its height.
    const ahead = glanceAngles({ x: 0.3, y: 0.6, z: -2 }, OTHER.pilotEye);
    expect(ahead.yaw).toBeCloseTo(0, 12);
    expect(ahead.pitch).toBeCloseTo(0, 12);
    expect(Math.abs(glanceAngles({ x: 0.3, y: 0.6, z: -2 }).yaw)).toBeGreaterThan(0.2);
    // A steady roll rate in level 1 g flight: an eye on the roll axis is not thrown about, one beside and above it is.
    const rolling = { angularVelocity: { x: 1.5, y: 0, z: 0 }, specificForce: { x: 0, y: 0, z: -1 }, roll: 0, ias: 0, onGround: false, stallFraction: 0 } as AircraftState;
    const settle = (head: HeadMotion): number => {
      for (let i = 0; i < 120; i++) head.update(1 / 60, rolling, 0, 'runway');
      return Math.hypot(head.out.offset.x, head.out.offset.y, head.out.offset.z);
    };
    expect(settle(new HeadMotion({ x: 0.4, y: 0, z: 0 }))).toBeLessThan(1e-12);
    expect(settle(new HeadMotion(OTHER.pilotEye))).toBeGreaterThan(0.002);
  });

  it('is zoomed to its size, and kept clear of by its radius', () => {
    const flyby = new FlybyRig();
    const tower = new TowerRig(TOWER);
    const [flyby172, tower172] = fits(flyby, tower);
    flyby.setAircraft(OTHER);
    tower.setAircraft(OTHER);
    const [flybyOther, towerOther] = fits(flyby, tower);
    // The fly-by camera stands on the other side each time it is placed, at a slightly different range.
    expect(flybyOther).toBeGreaterThan(1.8 * flyby172);
    expect(Math.tan((towerOther * DEG) / 2) / Math.tan((tower172 * DEG) / 2)).toBeCloseTo(2, 10);
    // The chase camera (15 m behind) is inside 16 m: the switch from it to the orbit camera, a blend around the
    // C172S, now cuts.
    const system = bootCameras();
    system.cameras.setAircraft({ radius: 16 });
    expect(tour(system).cuts.slice(0, 3)).toEqual([0, 1, 2]);
    const taa = new TemporalAA();
    taa.setAircraftRadius(OTHER.radius);
    expect(reprojectionRadius(taa)).toBe(17);
  });
});
