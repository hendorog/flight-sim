// The engine controls stay below the radio stack from the pilot's eye: in every fixed-wing cockpit, no lever or push-pull
// knob, at any point of its travel (and through beta / reverse), is seen above the lower edge of the panel's radio stack
// (PanelDef.regions.stack) from the design eye point (CockpitDef.pilotEye). The check is plain geometry, independent of
// the view's pitch and field of view: each vertex of a control's meshes is projected from the eye onto the panel face's
// plane and must land below the stack's lower edge there. (The Cessna 208's tall levers on a tall pedestal once stood in
// front of its radio stack.)

import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { C152_PANEL } from '../../src/aircraft/c152/panel';
import { C152_VISUAL } from '../../src/aircraft/c152/visual';
import { C172S_PANEL } from '../../src/aircraft/c172s/panel';
import { C172S_VISUAL } from '../../src/aircraft/c172s/visual';
import { C208_PANEL } from '../../src/aircraft/c208/panel';
import { C208_VISUAL } from '../../src/aircraft/c208/visual';
import { DA20_PANEL } from '../../src/aircraft/da20/panel';
import { DA20_VISUAL } from '../../src/aircraft/da20/visual';
import { PA34_PANEL } from '../../src/aircraft/pa34/panel';
import { PA34_VISUAL } from '../../src/aircraft/pa34/visual';
import { PA38_PANEL } from '../../src/aircraft/pa38/panel';
import { PA38_VISUAL } from '../../src/aircraft/pa38/visual';
import { PC12_PANEL } from '../../src/aircraft/pc12/panel';
import { PC12_VISUAL } from '../../src/aircraft/pc12/visual';
import type { AirframeVisualDef } from '../../src/aircraft/types';
import type { PanelDef } from '../../src/instruments/panelDef';
import { Cockpit, panelFace } from '../../src/render/aircraft/cockpit';
import { cabinFloorGeometry, createFuselageShapes } from '../../src/render/aircraft/fuselage';
import { setEngineControl } from '../../src/core/types';
import { blankDocument, fakeContext, fakeMaterials } from '../aircraft/meshChecks';

vi.setConfig({ testTimeout: 60_000 });
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
  ['da20', DA20_VISUAL, DA20_PANEL],
  ['pa34', PA34_VISUAL, PA34_PANEL],
  ['c208', C208_VISUAL, C208_PANEL],
  ['pc12', PC12_VISUAL, PC12_PANEL],
];

/** Margin kept under the stack's lower edge, m on the panel face. */
const MARGIN = 0.005;

describe('engine controls from the pilot eye', () => {
  for (const [id, visual, panel] of TYPES) {
    it(`${id}: no lever or knob is seen above the radio stack's lower edge`, () => {
      const c = visual.cockpit;
      const shapes = createFuselageShapes(visual);
      const cockpit = new Cockpit(fakeMaterials(), cabinFloorGeometry(shapes.lining, c.floor.z, c.floor.x0, c.floor.x1), shapes, c, panel);
      const face = panelFace(c.panel, panel.size);
      const stack = panel.regions.stack;
      expect(stack, 'the panel has a radio stack region').toBeDefined();
      // FRD z of the stack's lower edge on the face (down is +).
      const stackBottom = face.zTop + (stack.y + stack.h - face.rect.y) / face.pxPerM;
      const [ex, ey, ez] = c.pilotEye;
      const ctx = fakeContext(c.engineControls.reduce((n, e) => Math.max(n, e.engine + 1), 1));
      ctx.controls.engines = ctx.state.engines.map(() => ({}));
      // The controls' groups: the direct children of the cockpit group holding a lever's or a knob's meshes.
      const holders = cockpit.group.children.filter((g) => g.children.some((m) => /^(lever|knob|leverPart):/.test(m.name)));
      expect(holders.length).toBeGreaterThan(0);
      let worst = -Infinity;
      let worstAt = '';
      for (const v of [0, 1])
        for (const r of [0, 1]) {
          for (const control of ['throttle', 'mixture', 'propeller', 'carbHeat', 'cowlFlaps'] as const)
            for (let i = 0; i < ctx.controls.engines!.length; i++) setEngineControl(ctx.controls, i, control, v);
          ctx.controls.alternateAir = v === 1;
          ctx.controls.reverse = r;
          cockpit.update(ctx.state, ctx.controls, 1);
          cockpit.group.updateMatrixWorld(true);
          for (const h of holders)
            h.traverse((o) => {
              const m = o as THREE.Mesh;
              if (!m.isMesh) return;
              const pos = m.geometry.getAttribute('position');
              const p = new THREE.Vector3();
              for (let k = 0; k < pos.count; k++) {
                p.fromBufferAttribute(pos, k).applyMatrix4(m.matrixWorld);
                // Model (x right, y up, z aft) -> FRD.
                const x = -p.z;
                const z = -p.y;
                if (x >= c.panel.x - 1e-6) continue;
                // Along the line from the eye through the vertex to the face's plane.
                const t = (c.panel.x - ex) / (x - ex);
                const zHit = ez + (z - ez) * t;
                // How far above the stack's lower edge (+ = above, seen over the stack).
                const above = stackBottom + MARGIN - zHit;
                if (above > worst) {
                  worst = above;
                  worstAt = `${m.name} at throttle etc. ${v}, reverse ${r}: seen ${(above * 100).toFixed(1)} cm above the stack's lower edge (y ${p.x.toFixed(3)})`;
                }
              }
            });
        }
      void ey;
      expect(worst, worstAt).toBeLessThanOrEqual(0);
      cockpit.dispose();
    });
  }
});
