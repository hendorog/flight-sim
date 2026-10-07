// Regression guard of the procedural Cessna 172S model (src/render/aircraft): the model must come out of the
// builders exactly as it did before the airframe became a definition.
//
// Everything is built in node (a stand-in `document` gives the three canvas-drawn textures a blank canvas) and
// reduced to records: per part the mesh count, vertex count, bounding box and a checksum of every vertex
// buffer and node transform; a checksum of livery.windowSdf on a fixed 60 x 20 x 40 grid over the cabin and of
// cabinLight.cabinVisibility on a fixed vertex set; the planforms, the fuselage sections, the baked textures
// (without the registration lettering, which needs a real canvas), the lamp positions and the control points.
// The records were written from the tree BEFORE the first edit of that refactor (geometry.regression.json).
//
// FS_GEOMETRY_RECORD=<path of the json> writes the records instead of comparing. That is for a deliberate
// change of the C172S model only; a refactor that moves a record has changed a number.

import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { makeMockState } from '../../src/core/mockState';
import { defaultControls } from '../../src/core/types';
import { AIRPORT } from '../../src/core/world';
import type { SimContext } from '../../src/core/context';
import type { AircraftMaterials } from '../../src/render/aircraft/materials';

// node:fs without the node type package (tests are type-checked with the DOM library only), as tests/golden has it.
interface Fs {
  readFileSync(path: URL, encoding: 'utf8'): string;
  writeFileSync(path: string, data: string): void;
}
const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as Fs;
const RECORD_PATH = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env.FS_GEOMETRY_RECORD;
const recorded: Record<string, unknown> = {};
const stored: Record<string, unknown> = RECORD_PATH
  ? {}
  : (JSON.parse(fs.readFileSync(new URL('./geometry.regression.json', import.meta.url), 'utf8')) as Record<string, unknown>);

/** Compare a record with the stored one (or keep it for writing). */
function check(name: string, record: unknown): void {
  // Through JSON, as the stored one went: -0 and 0, undefined members.
  const plain = JSON.parse(JSON.stringify(record)) as unknown;
  if (RECORD_PATH) recorded[name] = plain;
  else expect(plain, name).toEqual(stored[name]);
}

afterAll(() => {
  if (RECORD_PATH) fs.writeFileSync(RECORD_PATH, `${JSON.stringify(recorded, null, 1)}\n`);
});

// --- Checksums ---------------------------------------------------------------------------------------------

/** Two FNV-1a passes over the bytes of a buffer: 16 hex digits. */
function checksum(data: ArrayBufferView | null | undefined): string {
  if (!data) return '-';
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < bytes.length; i++) {
    a = Math.imul(a ^ bytes[i], 0x01000193);
    b = Math.imul(b ^ bytes[i], 0x811c9dc5) + i;
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}

const numbers = (values: readonly number[]): string => checksum(new Float64Array(values));
const round = (v: number): number => Math.round(v * 1e9) / 1e9;

interface PartRecord {
  meshes: number;
  vertices: number;
  bbox: number[];
  /** One checksum over every local transform under the root, in traversal order, and their number. */
  nodes: number;
  transforms: string;
  parts: string[];
}

/** Mesh count, vertex count, bounding box (in the root's space) and a line per mesh with its buffer checksums. */
function describePart(root: THREE.Object3D): PartRecord {
  root.updateMatrixWorld(true);
  const toRoot = root.matrixWorld.clone().invert();
  const m = new THREE.Matrix4();
  const box = new THREE.Box3();
  const part = new THREE.Box3();
  const parts: string[] = [];
  const transforms: number[] = [];
  let meshes = 0;
  let vertices = 0;
  let nodes = 0;
  root.traverse((o) => {
    nodes++;
    o.updateMatrix();
    transforms.push(...o.matrix.elements);
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh && !(o as THREE.Points).isPoints) return;
    meshes++;
    const g = mesh.geometry;
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    vertices += pos.count;
    g.computeBoundingBox();
    if (pos.count > 0) box.union(part.copy(g.boundingBox!).applyMatrix4(m.multiplyMatrices(toRoot, mesh.matrixWorld)));
    const attributes = Object.keys(g.attributes)
      .sort()
      .map((name) => `${name}:${checksum((g.getAttribute(name) as THREE.BufferAttribute).array)}`);
    const material = Array.isArray(mesh.material) ? '[]' : mesh.material.name;
    const instanced = o as THREE.InstancedMesh;
    const instances = instanced.isInstancedMesh ? ` instances:${instanced.count}:${checksum(instanced.instanceMatrix.array)}` : '';
    parts.push(
      `${o.parent?.name ?? ''}/${o.name}|${material} v${pos.count} i${g.index?.count ?? 0}:${checksum(g.index?.array)} ${attributes.join(' ')}${instances}` +
        ` vis:${o.visible ? 1 : 0} shadow:${o.castShadow ? 1 : 0}${o.receiveShadow ? 1 : 0} order:${o.renderOrder}`,
    );
  });
  return {
    meshes,
    vertices,
    bbox: [...box.min.toArray(), ...box.max.toArray()].map(round),
    nodes,
    transforms: numbers(transforms),
    parts,
  };
}

// --- Stand-ins ----------------------------------------------------------------------------------------------

/** One distinct named material per member, as tests/aircraft/surfaces.test.ts has them. */
function fakeMaterials(): AircraftMaterials {
  const cache = new Map<string | symbol, THREE.Material>();
  return new Proxy({} as AircraftMaterials, {
    get(_t, key) {
      if (!cache.has(key)) {
        const m = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide });
        m.name = String(key);
        cache.set(key, m);
      }
      return cache.get(key);
    },
  });
}

/** A 2D context that accepts every call and draws nothing; text is 10 px wide per character, pixels are blank. */
function blankContext(canvas: { width: number; height: number }): unknown {
  const own: Record<string | symbol, unknown> = {
    canvas,
    measureText: (text: string) => ({ width: 10 * text.length }),
    getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
  };
  return new Proxy(own, {
    get: (t, key) => (key in t ? t[key] : (t[key] = () => new Proxy({}, { get: () => () => undefined }))),
    set: (t, key, value) => ((t[key] = value), true),
  });
}

function blankCanvas(): unknown {
  const canvas = { width: 300, height: 150, getContext: (): unknown => context };
  const context = blankContext(canvas);
  return canvas;
}

beforeAll(() => {
  vi.stubGlobal('document', { createElement: () => blankCanvas() });
});
afterAll(() => {
  vi.unstubAllGlobals();
});

/** mulberry32: the fixed vertex set of the cabin-visibility checksum. */
function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A simulator context as far as AircraftVisual reads it: parked on the runway, seen from the pilot's seat. */
function fakeContext(): SimContext {
  const state = makeMockState({ heightAGL: 0 });
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1000);
  const aircraftRoot = new THREE.Group();
  const scene = new THREE.Scene();
  scene.add(aircraftRoot, camera);
  const ctx = {
    renderer: { getDrawingBufferSize: (v: THREE.Vector2) => v.set(1600, 900) },
    scene,
    camera,
    aircraftRoot,
    state,
    controls: defaultControls(),
    env: { groundElevation: () => AIRPORT.elevation, groundNormal: () => ({ x: 0, y: 0, z: -1 }) },
    sky: {
      sunDir: new THREE.Vector3(0.3, 0.8, 0.52).normalize(),
      moonDir: new THREE.Vector3(0, -1, 0),
      sunColor: new THREE.Color(9000, 8600, 8000),
      moonColor: new THREE.Color(0, 0, 0),
      skyColor: new THREE.Color(900, 1200, 1800),
      dayFactor: 1,
    },
    simTime: 0.02,
    cameraMode: 'cockpit',
    quality: 'high',
  };
  return ctx as unknown as SimContext;
}

// --- The guard ------------------------------------------------------------------------------------------------

describe('Cessna 172S model: the builders give what they gave', () => {
  it('planforms, hinge fractions and the points other modules take from them', async () => {
    const ls = await import('../../src/render/aircraft/liftingSurface');
    const { wingPoint, wingSurfacePoint } = await import('../../src/render/aircraft/wings');
    const { rudderBottomTrailingEdge } = await import('../../src/render/aircraft/tail');
    const { surfacePoint, thickness, camber, NACA2412, NACA0009, fullContour, truncatedContour, controlSurfaceContour } = await import('../../src/render/aircraft/airfoil');
    const values: number[] = [];
    const p = { x: 0, y: 0, z: 0 };
    for (const [pf, s0, s1] of [
      [ls.wingPlanform, 0.3, 5.6],
      [ls.stabPlanform, -0.1, 1.9],
      [ls.finPlanform, -0.4, 1.4],
    ] as const) {
      values.push(pf.refFrac, pf.aft.x, pf.aft.y, pf.aft.z, pf.up.x, pf.up.y, pf.up.z);
      for (let i = 0; i <= 40; i++) {
        const s = s0 + ((s1 - s0) * i) / 40;
        pf.ref(s, p);
        values.push(p.x, p.y, p.z, pf.chord(s), pf.twist(s));
        for (const [xc, yc] of [[0, 0], [0.3, 0.05], [1, -0.02]]) {
          ls.sectionPoint(pf, s, xc, yc, p);
          values.push(p.x, p.y, p.z);
        }
      }
      values.push(ls.planformInward(pf, s0, s1) ? 1 : 0);
    }
    for (const af of [NACA2412, NACA0009]) {
      for (let i = 0; i <= 20; i++) values.push(thickness(af, i / 20), camber(af, i / 20).yc, camber(af, i / 20).slope, ...surfacePoint(af, i / 20, 1), ...surfacePoint(af, i / 20, -1));
      values.push(...fullContour(af, 12).flat(), ...truncatedContour(af, 0.72, 0.66, 10, 4).flat());
      const cs = controlSurfaceContour(af, 0.7, 8, 6);
      values.push(...cs.pts.flat(), ...cs.hinge);
    }
    const points: number[] = [];
    for (const side of [1, -1] as const) {
      points.push(...wingPoint(5.45, 0.06, 0, side).toArray(), ...wingPoint(2.1, 0.7, 0.03, side).toArray());
      points.push(...wingSurfacePoint(3.35, 0.004, 1, side).toArray(), ...wingSurfacePoint(1.95, 0.34, -1, side).toArray());
    }
    const tail = rudderBottomTrailingEdge();
    check('planforms', {
      constants: [ls.ELEVATOR_HINGE, ls.RUDDER_HINGE, ls.FIN_HEIGHT, ls.STAB_HALF_SPAN],
      planforms: numbers(values),
      wingPoints: numbers(points),
      rudderBottomTrailingEdge: [tail.x, tail.y, tail.z],
    });
  });

  it('fuselage shape: the three lofts, section by section', async () => {
    const fs = await import('../../src/render/aircraft/fuselageShape');
    const { createFuselageShapes, sectionHalfWidth, cabinFloorGeometry } = await import('../../src/render/aircraft/fuselage');
    const { FLOOR_Z } = await import('../../src/render/aircraft/cockpit');
    const shapes = createFuselageShapes();
    const record: Record<string, unknown> = {
      constants: [fs.FUSELAGE_FRONT_X, fs.FUSELAGE_END_X, fs.FIREWALL_X, fs.CABIN_FRONT_X, fs.CABIN_REAR_X, fs.BELLY_DROP],
      insets: [shapes.outer.inset, shapes.glass.inset, shapes.lining.inset],
    };
    const ring = new fs.Ring();
    const q = { y: 0, z: 0 };
    for (const [name, shape] of Object.entries(shapes) as [string, InstanceType<typeof fs.FuselageShape>][]) {
      const values: number[] = [];
      for (let i = 0; i <= 400; i++) {
        const s = i / 400;
        const x = shape.x(s);
        const sec = shape.section(x);
        values.push(x, shape.s(x), sec.zTop, sec.zBot, sec.zMid, sec.hw, sec.nTop, sec.nBot, sec.ridge, sec.ridgeW);
        if (i % 8 === 0) {
          ring.set(sec);
          values.push(ring.circumference, sectionHalfWidth(shape, x, -0.1, ring), sectionHalfWidth(shape, x, 0.3, ring));
          for (let k = 0; k <= 16; k++) {
            ring.at(k / 16, q);
            values.push(q.y, q.z);
          }
        }
      }
      record[name] = numbers(values);
    }
    // The constructor defaults other modules and the tests use.
    const bare = new fs.FuselageShape(0);
    const lining = new fs.FuselageShape(0.015, -0.63);
    record.defaults = numbers([-4, -2, -1, 0, 0.5, 1, 1.5].flatMap((x) => [bare.section(x).zTop, bare.section(x).hw, lining.section(x).zTop, lining.section(x).hw, bare.s(x), lining.s(x)]));
    const floor = cabinFloorGeometry(shapes.lining, FLOOR_Z, 0.95, -2.1);
    record.floor = `${floor.getAttribute('position').count} ${checksum((floor.getAttribute('position') as THREE.BufferAttribute).array)}`;
    check('fuselageShape', record);
  });

  it('wings, tail, landing gear and fuselage meshes (guard item 1)', async () => {
    const { buildWings, setFlap } = await import('../../src/render/aircraft/wings');
    const { buildTail } = await import('../../src/render/aircraft/tail');
    const { LandingGear } = await import('../../src/render/aircraft/gear');
    const { buildFuselage, createFuselageShapes } = await import('../../src/render/aircraft/fuselage');
    const mat = fakeMaterials();

    const wingRoot = new THREE.Group();
    const wings = buildWings(mat, wingRoot);
    check('wings', describePart(wingRoot));
    setFlap(wings.flaps[0], 0.2);
    setFlap(wings.flaps[1], 0.5236);
    wings.ailerons[0].setAngle(-0.2);
    wings.ailerons[1].setAngle(0.15);
    check('wings.deflected', describePart(wingRoot).transforms);

    const tailRoot = new THREE.Group();
    const tail = buildTail(mat, tailRoot);
    check('tail', describePart(tailRoot));
    tail.elevators[0].setAngle(0.3);
    tail.elevators[1].setAngle(0.3);
    tail.trimTab.setAngle(-0.1);
    tail.rudder.setAngle(0.2);
    check('tail.deflected', describePart(tailRoot).transforms);

    for (const pants of [true, false]) {
      const gear = new LandingGear(mat, pants);
      const name = pants ? 'gear' : 'gear.noFairings';
      check(name, describePart(gear.group));
      const state = makeMockState({ heightAGL: 0 });
      state.wheels[0].steerAngle = 0.1;
      state.wheels[0].rotation = 1.3;
      state.wheels[1].compression = 0.11;
      state.wheels[2].rotation = 0.4;
      gear.update(state.wheels);
      check(`${name}.loaded`, describePart(gear.group));
      const rig = gear.shadowRig();
      check(`${name}.shadowRig`, [rig.moving.length, rig.keep.length, rig.none.length]);
    }

    const shapes = createFuselageShapes();
    const f = buildFuselage(shapes, mat);
    const fuselageRoot = new THREE.Group();
    fuselageRoot.add(f.skin, f.glass, f.lining, f.fittings);
    check('fuselage', describePart(fuselageRoot));
  });

  it('window outlines on a 60 x 20 x 40 grid over the cabin, the cowl inlets (guard item 1)', async () => {
    const livery = await import('../../src/render/aircraft/livery');
    const window = new Float64Array(60 * 20 * 40);
    const inlet = new Float64Array(60 * 20 * 40);
    let n = 0;
    for (let i = 0; i < 60; i++) {
      const x = 1.15 + ((-2.25 - 1.15) * i) / 59;
      for (let j = 0; j < 20; j++) {
        const y = -0.57 + (1.14 * j) / 19;
        for (let k = 0; k < 40; k++) {
          const z = -0.72 + (1.22 * k) / 39;
          window[n] = livery.windowSdf(x, y, z);
          inlet[n++] = livery.inletSdf(1.7 + 0.25 * (i / 59), y * 0.8, -0.1 + 0.3 * (k / 39));
        }
      }
    }
    const outline: number[] = [];
    for (let k = 0; k < 32; k++) outline.push(...livery.inletOutline((k / 32) * Math.PI * 2), ...livery.inletOutline((k / 32) * Math.PI * 2, 0.004));
    check('windowSdf', {
      window: checksum(window),
      inside: window.reduce((a, d) => a + (d < 0 ? 1 : 0), 0),
      inlet: checksum(inlet),
      inletOutline: numbers(outline),
      registration: livery.REGISTRATION,
      paint: livery.PAINT,
      inletConstants: livery.INLET,
    });
  });

  it('cabin visibility of a fixed vertex set (guard item 1)', async () => {
    const { cabinVisibility, CABIN_VIS_DEFAULT } = await import('../../src/render/aircraft/cabinLight');
    const random = seeded(0x172);
    const count = 600;
    const positions = new Float32Array(count * 3);
    const normals = new Float32Array(count * 3);
    const doubleSided = new Uint8Array(count);
    for (let i = 0; i < count; i++) {
      // Model space (X right, Y up, Z aft): the cabin from the firewall to the baggage bulkhead.
      positions.set([-0.5 + random(), -0.55 + 1.15 * random(), -0.95 + 3.0 * random()], i * 3);
      const n = new THREE.Vector3(random() - 0.5, random() - 0.5, random() - 0.5).normalize();
      normals.set([n.x, n.y, n.z], i * 3);
      doubleSided[i] = i % 5 === 0 ? 1 : 0;
    }
    const data = cabinVisibility(positions, normals, doubleSided);
    check('cabinVisibility', {
      vis: checksum(data.vis),
      cube: checksum(data.cube),
      mean: round(data.vis.reduce((a, v) => a + v, 0) / count),
      default: CABIN_VIS_DEFAULT,
    });
  });

  it('cockpit interior, trim panels and glareshield; control points and panel face', async () => {
    const cockpit = await import('../../src/render/aircraft/cockpit');
    const { cabinLamps } = await import('../../src/render/aircraft/cabinLight');
    const { createFuselageShapes, cabinFloorGeometry } = await import('../../src/render/aircraft/fuselage');
    const { liningPanel } = await import('../../src/render/aircraft/cabinTrim');
    const mat = fakeMaterials();
    const shapes = createFuselageShapes();
    const c = new cockpit.Cockpit(mat, cabinFloorGeometry(shapes.lining, cockpit.FLOOR_Z, 0.95, -2.1), shapes);
    check('cockpit', describePart(c.group));
    check('cockpit.lamps', [cabinLamps.floodPos.value, cabinLamps.floodAxis.value, cabinLamps.domePos.value].flatMap((v) => v.toArray()).concat(cabinLamps.floodMask.value.toArray()));

    // The panel shader: the recesses (in any order: the first that contains the fragment is taken, and they do
    // not overlap) and the source text.
    const shader = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: '#include <common>\n#include <begin_vertex>', fragmentShader: '#include <common>\n#include <map_fragment>\n#include <emissivemap_fragment>\n#include <opaque_fragment>' };
    (c.panelMesh.material as THREE.Material).onBeforeCompile(shader as never, null as never);
    const gauges = (shader.uniforms.panelGauges.value as THREE.Vector4[]).map((g) => [g.x, g.y, g.z, g.w].map((v) => Math.fround(v)));
    gauges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    check('cockpit.panelShader', {
      gauges: gauges.length,
      recesses: numbers(gauges.flat()),
      vertex: checksum(new TextEncoder().encode(shader.vertexShader)),
      fragment: checksum(new TextEncoder().encode(shader.fragmentShader)),
    });

    // Animated parts at a pose with every control displaced.
    const state = makeMockState({ heightAGL: 0, heading: 1.1 });
    const controls = defaultControls();
    Object.assign(controls, { elevator: -0.4, aileron: 0.6, rudder: -0.3, throttle: 0.35, mixture: 0.8, flaps: 2 / 3, elevatorTrim: 0.2, magnetos: 3 });
    Object.assign(controls, { masterBattery: true, alternator: true, avionics: true, fuelPump: true });
    Object.assign(controls.lights, { beacon: true, nav: true, panel: 0.6 });
    state.electrical.busVoltage = 27.5;
    c.update(state, controls, 1);
    check('cockpit.posed', {
      ...describePart(c.group),
      emissive: (c.panelMesh.material as THREE.MeshStandardMaterial).emissiveIntensity,
      flood: cabinLamps.floodColor.value.toArray(),
      lampFlux: c.lampFlux(new THREE.Color()).toArray(),
    });
    const rig = c.shadowRig();
    check('cockpit.shadowRig', [rig.moving.length, rig.none.length]);

    const { PANEL, FLOOR_Z, COCKPIT_CONTROLS, GLARESHIELD_SKIN_CLEARANCE, panelPixelToModel } = cockpit;
    check('cockpit.constants', {
      panel: PANEL,
      floor: FLOOR_Z,
      clearance: GLARESHIELD_SKIN_CLEARANCE,
      controls: COCKPIT_CONTROLS,
      pixel: [panelPixelToModel(0, 0), panelPixelToModel(2080, 800), panelPixelToModel(499, 632)],
    });

    const hood = cockpit.glareshieldGeometry(shapes.outer);
    const panel = liningPanel(shapes.lining, -1, 0.7, -0.45, -0.08, 0.4, 20, 16, (x, z) => 0.01 * Math.abs(Math.sin(7 * x + 3 * z)));
    check('cockpit.fitted', {
      glareshield: `${hood.getAttribute('position').count} ${checksum((hood.getAttribute('position') as THREE.BufferAttribute).array)}`,
      liningPanel: `${panel.getAttribute('position').count} ${checksum((panel.getAttribute('position') as THREE.BufferAttribute).array)} ${checksum(panel.index?.array)}`,
    });
  });

  it('propeller, exterior lights and the ground contact shadow', async () => {
    const { Propeller } = await import('../../src/render/aircraft/propeller');
    const { AircraftLights, LIGHT_UNITS_PER_CANDELA } = await import('../../src/render/aircraft/lights');
    const { GroundShadow } = await import('../../src/render/aircraft/groundShadow');
    const mat = fakeMaterials();

    const prop = new Propeller(mat);
    check('propeller', describePart(prop.group));
    const textures: string[] = [];
    prop.group.traverse((o) => {
      const map = ((o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined)?.map as THREE.DataTexture | null | undefined;
      if (map?.image?.data) textures.push(checksum(map.image.data as Uint8Array));
    });
    check('propeller.discs', textures);
    for (const rpm of [0, 650, 1500, 2400]) {
      prop.update(0.7, rpm);
      check(`propeller.rpm${rpm}`, describePart(prop.group));
    }

    const rudder = new THREE.Group();
    rudder.position.set(0.1, 0.2, 4.9);
    rudder.rotation.y = 0.05;
    const lights = new AircraftLights(true, 1, rudder);
    const world = new THREE.Group();
    world.add(lights.group, rudder);
    const record = describePart(world);
    const lamps: number[] = [];
    world.traverse((o) => {
      const light = o as THREE.SpotLight;
      if (light.isLight) lamps.push(...light.position.toArray(), light.intensity, light.distance, light.angle ?? 0, light.decay, ...(light.target ? light.target.position.toArray() : []));
    });
    check('lights', { ...record, lamps: numbers(lamps), unitsPerCandela: LIGHT_UNITS_PER_CANDELA });

    const shadow = new GroundShadow();
    const material = shadow.mesh.material as THREE.ShaderMaterial;
    check('groundShadow', {
      ...describePart(shadow.mesh),
      fragment: checksum(new TextEncoder().encode(material.fragmentShader)),
      vertex: checksum(new TextEncoder().encode(material.vertexShader)),
    });
  });

  it('the whole aircraft as the simulator builds it: every mesh, the baked textures, the cabin occlusion, one frame', async () => {
    const { AircraftVisual } = await import('../../src/render/aircraft/AircraftVisual');
    const { FIN_UV_H0, FIN_UV_RANGE } = await import('../../src/render/aircraft/materials');
    const ctx = fakeContext();
    const visual = new AircraftVisual({ asyncBake: false });
    visual.init(ctx);
    ctx.aircraftRoot.updateMatrixWorld(true);
    check('visual', { ...describePart(visual.root), name: visual.root.name, pilotEye: visual.pilotEye.toArray() });

    // The four baked fuselage textures and the fin paint, found by material name as dev/aircraft.ts finds them.
    const materials = new Map<string, THREE.MeshStandardMaterial>();
    visual.root.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      for (const x of Array.isArray(m) ? m : m ? [m] : []) if (x.name && !materials.has(x.name)) materials.set(x.name, x as THREE.MeshStandardMaterial);
    });
    const image = (t: THREE.Texture | null | undefined): string => {
      const img = t?.image as { data?: Uint8Array; width: number; height: number } | undefined;
      return img?.data instanceof Uint8Array ? `${img.width}x${img.height} ${checksum(img.data)}` : 'missing';
    };
    check('visual.textures', {
      colour: image(materials.get('fuselagePaint')?.map),
      detail: image(materials.get('fuselagePaint')?.bumpMap),
      glass: image(materials.get('glass')?.alphaMap),
      lining: image(materials.get('lining')?.alphaMap),
      fin: image(materials.get('finPaint')?.map),
      finUv: [FIN_UV_H0, FIN_UV_RANGE],
      finRepeat: [...(materials.get('finPaint')?.map?.repeat.toArray() ?? []), ...(materials.get('finPaint')?.map?.offset.toArray() ?? [])],
      names: [...materials.keys()].sort(),
    });

    // One frame with every animated part displaced.
    const s = ctx.state;
    Object.assign(s.surfaces, { flaps: 0.35, aileronLeft: -0.2, aileronRight: 0.15, elevator: 0.1, elevatorTrim: -0.05, rudder: 0.12 });
    s.propeller.rotation = 0.4;
    s.propeller.rpm = 900;
    s.wheels[0].steerAngle = 0.08;
    s.wheels[2].compression = 0.1;
    s.electrical.busVoltage = 28;
    Object.assign(ctx.controls, { elevator: 0.3, aileron: -0.5, rudder: 0.4, throttle: 0.6, mixture: 0.9, flaps: 1 / 3, elevatorTrim: -0.1 });
    Object.assign(ctx.controls.lights, { nav: true, beacon: true, strobe: true, landing: true, taxi: true, panel: 0.5 });
    ctx.camera.position.set(3, AIRPORT.elevation + 3, 9);
    ctx.camera.updateMatrixWorld(true);
    visual.update(1 / 60, ctx);
    const frame = describePart(visual.root);
    const lightLevels: number[] = [];
    visual.root.traverse((o) => {
      if ((o as THREE.Light).isLight) lightLevels.push((o as THREE.Light).intensity);
    });
    const shadow = ctx.scene.getObjectByName('aircraftContactShadow') as THREE.Mesh;
    check('visual.frame', {
      transforms: frame.transforms,
      parts: frame.parts,
      lights: numbers(lightLevels),
      shadowWheels: ((shadow.material as THREE.ShaderMaterial).uniforms.uWheels.value as THREE.Vector3[]).flatMap((v) => v.toArray()),
      shadowHeight: round((shadow.material as THREE.ShaderMaterial).uniforms.uHeight.value as number),
    });
    visual.dispose();
  }, 120_000);
});
