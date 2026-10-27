// The elevator trim position indicators with a TAKE OFF band (CockpitDef.trimWheel.indicator.takeOff): the pointer
// slides along the slot with controls.elevatorTrim, NOSE UP towards the def's `up` end, and the band holds the trim the
// flight model sets for the take-off at the type's default loading. Types without a band keep a fixed pointer.

import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import C152_DEFINITION from '../../src/aircraft/c152/index';
import { C152_PANEL } from '../../src/aircraft/c152/panel';
import { C152_VISUAL } from '../../src/aircraft/c152/visual';
import { C172S_PANEL } from '../../src/aircraft/c172s/panel';
import { C172S_VISUAL } from '../../src/aircraft/c172s/visual';
import PA38_DEFINITION from '../../src/aircraft/pa38/index';
import { PA38_PANEL } from '../../src/aircraft/pa38/panel';
import { PA38_VISUAL } from '../../src/aircraft/pa38/visual';
import type { AircraftDefinition, AirframeVisualDef } from '../../src/aircraft/types';
import type { PanelDef } from '../../src/instruments/panelDef';
import { Cockpit } from '../../src/render/aircraft/cockpit';
import { cabinFloorGeometry, createFuselageShapes } from '../../src/render/aircraft/fuselage';
import { frd } from '../../src/render/aircraft/geometry';
import { blankDocument, fakeContext, fakeMaterials } from '../aircraft/meshChecks';
import { at, makeRig, resetTo } from '../fdm/helpers';

vi.setConfig({ testTimeout: 60_000 });
beforeAll(() => {
  vi.stubGlobal('document', blankDocument());
});
afterAll(() => {
  vi.unstubAllGlobals();
});

function build(visual: AirframeVisualDef, panel: PanelDef): Cockpit {
  const c = visual.cockpit;
  const shapes = createFuselageShapes(visual);
  return new Cockpit(fakeMaterials(), cabinFloorGeometry(shapes.lining, c.floor.z, c.floor.x0, c.floor.x1), shapes, c, panel);
}

/** The group holding the pointer's meshes, if any. */
const pointerOf = (cockpit: Cockpit): THREE.Object3D | undefined => cockpit.group.children.find((g) => g.children.some((m) => /^trimPointer:/.test(m.name)));

const TYPES: readonly [string, AirframeVisualDef, PanelDef, AircraftDefinition][] = [
  ['c152', C152_VISUAL, C152_PANEL, C152_DEFINITION],
  ['pa38', PA38_VISUAL, PA38_PANEL, PA38_DEFINITION],
];

describe('trim position indicator', () => {
  for (const [id, visual, panel, def] of TYPES) {
    const ind = visual.cockpit.trimWheel!.indicator!;
    it(`${id}: the pointer slides along the slot with the trim, NOSE UP towards the indicator's up end`, () => {
      const cockpit = build(visual, panel);
      const pointer = pointerOf(cockpit);
      expect(pointer).toBeDefined();
      const ctx = fakeContext(1);
      const pointerAt = (trim: number): THREE.Vector3 => {
        ctx.controls.elevatorTrim = trim;
        cockpit.update(ctx.state, ctx.controls, 1);
        return pointer!.position.clone();
      };
      const centre = frd(ind.pos[0], ind.pos[1], ind.pos[2], new THREE.Vector3());
      const up = frd(ind.up[0], ind.up[1], ind.up[2], new THREE.Vector3()).normalize();
      // Neutral: the slot's middle (a couple of millimetres proud of the plate).
      expect(pointerAt(0).distanceTo(centre)).toBeLessThan(0.004);
      const noseUp = pointerAt(1).sub(pointerAt(0));
      const noseDn = pointerAt(-1).sub(pointerAt(0));
      // Most of the way to each end, along the slot.
      expect(noseUp.dot(up)).toBeGreaterThan(0.4 * ind.length);
      expect(noseUp.dot(up)).toBeLessThan(0.5 * ind.length);
      expect(noseDn.dot(up)).toBeCloseTo(-noseUp.dot(up), 6);
      expect(noseUp.clone().projectOnVector(up).distanceTo(noseUp)).toBeLessThan(1e-9);
    });

    it(`${id}: the TAKE OFF band holds the trim set for the take-off at the typical loading`, () => {
      const rig = makeRig({ def, loading: 'typical' });
      resetTo(rig, { onGround: true, position: at(0), engineRunning: true });
      const trim = rig.controls.elevatorTrim;
      expect(trim).toBeGreaterThan(ind.takeOff!.from);
      expect(trim).toBeLessThan(ind.takeOff!.to);
    });
  }

  it('c172s: no band, so the fixed pointer stays (no sliding pointer)', () => {
    expect(C172S_VISUAL.cockpit.trimWheel!.indicator!.takeOff).toBeUndefined();
    expect(pointerOf(build(C172S_VISUAL, C172S_PANEL))).toBeUndefined();
  });
});
