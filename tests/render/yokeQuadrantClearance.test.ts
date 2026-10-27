// The raised yokes (render/aircraft/yoke.ts) clear the throttle quadrants and pedestals (render/aircraft/quadrant.ts):
// in every yoke cockpit, with both yokes at full forward and full aft and at full left and right roll, and the engine
// controls at both ends of their travel (and through beta / reverse), no edge of a yoke mesh passes through a quadrant
// housing, cover, fitting, lever, knob or trim wheel, and no edge of those passes through a yoke. Plain geometry: every
// triangle edge of one mesh is cast as a ray against the other's triangles, after an overlap test of the bounds.
// Not covered: the plunger bezels and the trim wheel's moulding, which buildPlunger / trimWheelParts put in the cockpit's
// shared fixed batch (with the panel the yoke tubes pass through), not in addQuadrant's.

import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { C152_PANEL } from '../../src/aircraft/c152/panel';
import { C152_VISUAL } from '../../src/aircraft/c152/visual';
import { C172S_PANEL } from '../../src/aircraft/c172s/panel';
import { C172S_VISUAL } from '../../src/aircraft/c172s/visual';
import { C208_PANEL } from '../../src/aircraft/c208/panel';
import { C208_VISUAL } from '../../src/aircraft/c208/visual';
import { PA34_PANEL } from '../../src/aircraft/pa34/panel';
import { PA34_VISUAL } from '../../src/aircraft/pa34/visual';
import { PA38_PANEL } from '../../src/aircraft/pa38/panel';
import { PA38_VISUAL } from '../../src/aircraft/pa38/visual';
import { PC12_PANEL } from '../../src/aircraft/pc12/panel';
import { PC12_VISUAL } from '../../src/aircraft/pc12/visual';
import type { AirframeVisualDef } from '../../src/aircraft/types';
import type { PanelDef } from '../../src/instruments/panelDef';
import { Cockpit } from '../../src/render/aircraft/cockpit';
import { cabinFloorGeometry, createFuselageShapes } from '../../src/render/aircraft/fuselage';
import { MeshBatch } from '../../src/render/aircraft/geometry';
import { addQuadrant, PlacardAtlas } from '../../src/render/aircraft/quadrant';
import { setEngineControl } from '../../src/core/types';
import { blankDocument, fakeContext, fakeMaterials } from '../aircraft/meshChecks';

vi.setConfig({ testTimeout: 120_000 });
beforeAll(() => {
  vi.stubGlobal('document', blankDocument());
});
afterAll(() => {
  vi.unstubAllGlobals();
});

const TYPES: readonly [string, AirframeVisualDef, PanelDef][] = [
  ['c172s', C172S_VISUAL, C172S_PANEL],
  ['c152', C152_VISUAL, C152_PANEL],
  ['pa38', PA38_VISUAL, PA38_PANEL],
  ['pa34', PA34_VISUAL, PA34_PANEL],
  ['c208', C208_VISUAL, C208_PANEL],
  ['pc12', PC12_VISUAL, PC12_PANEL],
];

/** World-space triangles of a set of meshes, with their bounds. */
function triangles(meshes: readonly THREE.Mesh[]): { name: string; tris: Float32Array; box: THREE.Box3 }[] {
  const out: { name: string; tris: Float32Array; box: THREE.Box3 }[] = [];
  const p = new THREE.Vector3();
  for (const m of meshes) {
    const g = m.geometry;
    const pos = g.getAttribute('position');
    const n = g.index ? g.index.count : pos.count;
    const tris = new Float32Array(n * 3);
    const box = new THREE.Box3();
    for (let i = 0; i < n; i++) {
      p.fromBufferAttribute(pos, g.index ? g.index.getX(i) : i).applyMatrix4(m.matrixWorld);
      p.toArray(tris, i * 3);
      box.expandByPoint(p);
    }
    out.push({ name: m.name, tris, box });
  }
  return out;
}

const tri = new THREE.Triangle();
const ray = new THREE.Ray();
const hit = new THREE.Vector3();
const a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3();
const edge = new THREE.Box3();

/** The first edge of `from` (inside `to`'s bounds) that passes through a triangle of `to`, or null. */
function pierce(from: { tris: Float32Array }, to: { tris: Float32Array; box: THREE.Box3 }): string | null {
  const box = to.box.clone().expandByScalar(1e-4);
  for (let t = 0; t < from.tris.length; t += 9) {
    for (let e = 0; e < 3; e++) {
      a.fromArray(from.tris, t + e * 3);
      b.fromArray(from.tris, t + ((e + 1) % 3) * 3);
      if (!box.intersectsBox(edge.setFromPoints([a, b]))) continue;
      const len = a.distanceTo(b);
      if (len < 1e-7) continue;
      ray.set(a, d.subVectors(b, a).divideScalar(len));
      for (let s = 0; s < to.tris.length; s += 9) {
        tri.a.fromArray(to.tris, s);
        tri.b.fromArray(to.tris, s + 3);
        tri.c.fromArray(to.tris, s + 6);
        if (tri.getArea() < 1e-10) continue;
        // Strictly inside the edge (a shared touch at an end is not a pass-through).
        if (ray.intersectTriangle(tri.a, tri.b, tri.c, false, hit) && hit.distanceTo(a) > 1e-4 && hit.distanceTo(a) < len - 1e-4)
          return `(${hit.x.toFixed(3)}, ${hit.y.toFixed(3)}, ${hit.z.toFixed(3)})`;
      }
    }
  }
  return null;
}

/**
 * Known clashes (KNOWN_ISSUES.md), all at simultaneous stops: the yoke at full forward and full roll with the engine
 * controls at an end of their travel. Expected to fail until fixed; remove the type here when it passes.
 * c172s: the inboard horn of the right yoke (full forward, full left roll) through the throttle and mixture plungers
 * (feat/cockpit-yoke). pa34: the inboard horns (full forward, full roll) through the propeller / mixture levers' knobs
 * (feat/cockpit-yoke; at full aft on that branch alone).
 */
const KNOWN_CLASH = new Set(['c172s', 'pa34']);

describe('yokes clear the quadrants', () => {
  for (const [id, visual, panel] of TYPES) {
    (KNOWN_CLASH.has(id) ? it.fails : it)(`${id}: no yoke at any stop passes through a quadrant part, lever, knob or trim wheel`, () => {
      const def = visual.cockpit;
      expect(def.column.kind).toBe('yoke');
      const shapes = createFuselageShapes(visual);
      const mats = fakeMaterials();
      const cockpit = new Cockpit(mats, cabinFloorGeometry(shapes.lining, def.floor.z, def.floor.x0, def.floor.x1), shapes, def, panel);
      // The quadrant's fixed parts, built on their own (in the cockpit they share one batch with the panel the yoke
      // tubes pass through); the cockpit group has no transform of its own.
      const fixedParts: THREE.Mesh[] = [];
      if (def.quadrant) {
        const batch = new MeshBatch();
        addQuadrant(batch, mats, def, new PlacardAtlas());
        batch.build('quadrant').traverse((o) => { if ((o as THREE.Mesh).isMesh) fixedParts.push(o as THREE.Mesh); });
      }
      const ctx = fakeContext(def.engineControls.reduce((n, e) => Math.max(n, e.engine + 1), 1));
      ctx.controls.engines = ctx.state.engines.map(() => ({}));
      const moving = (re: RegExp): THREE.Mesh[] => {
        const out: THREE.Mesh[] = [];
        cockpit.group.traverse((o) => { if ((o as THREE.Mesh).isMesh && re.test(o.name)) out.push(o as THREE.Mesh); });
        return out;
      };
      const clashes: string[] = [];
      for (const v of [0, 1])
        for (const r of [0, 1]) {
          for (const control of ['throttle', 'mixture', 'propeller', 'carbHeat', 'cowlFlaps'] as const)
            for (let i = 0; i < ctx.controls.engines!.length; i++) setEngineControl(ctx.controls, i, control, v);
          ctx.controls.alternateAir = v === 1;
          ctx.controls.reverse = r;
          for (const elevator of [-1, 1])
            for (const aileron of [-1, 0, 1]) {
              ctx.controls.elevator = elevator;
              ctx.controls.aileron = aileron;
              cockpit.update(ctx.state, ctx.controls, 1);
              cockpit.group.updateMatrixWorld(true);
              const yokes = triangles(moving(/^yoke:/));
              const others = triangles([...moving(/^(lever|knob|leverPart|trimWheel):/), ...fixedParts]);
              expect(yokes.length).toBeGreaterThan(0);
              for (const y of yokes)
                for (const o of others) {
                  if (!y.box.intersectsBox(o.box)) continue;
                  const at = pierce(y, o) ?? pierce(o, y);
                  if (at) clashes.push(`${y.name} x ${o.name} at ${at} (elevator ${elevator}, aileron ${aileron}, controls ${v}, reverse ${r})`);
                }
            }
        }
      expect(clashes.slice(0, 5), `${clashes.length} clashes`).toEqual([]);
      cockpit.dispose();
    });
  }
});
