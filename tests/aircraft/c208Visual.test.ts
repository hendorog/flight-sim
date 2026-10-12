// The Cessna 208 Caravan's airframe visual (src/aircraft/c208/visual.ts): it is plain data, what the livery worker
// loads by id, and builds as the simulator builds it with outward skins and no NaN, the geometry's span, height
// and eye; the lift strut root stays outside the cabin, every console inside the skin, the cockpit's parts sit on
// the panel face's pixels (panelLayout.ts), and the render cost stays inside the twin budget over the C172S.

import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { C208_GEOMETRY, C208_THRUST_Z } from '../../src/aircraft/c208/geometry';
import { C208_PANEL } from '../../src/aircraft/c208/panel';
import { C208_PANEL_PARTS, c208PanelPx } from '../../src/aircraft/c208/panelLayout';
import { C208_VISUAL } from '../../src/aircraft/c208/visual';
import { loadAirframeVisual } from '../../src/aircraft/visualLoader';
import { AircraftVisual } from '../../src/render/aircraft/AircraftVisual';
import { createFuselageShapes, sectionHalfWidth } from '../../src/render/aircraft/fuselage';
import { blankDocument, bodyBox, facing, fakeContext, nonFinite, renderCost, worldMeshes } from './meshChecks';

vi.setConfig({ testTimeout: 60_000 });

beforeAll(() => {
  vi.stubGlobal('document', blankDocument());
});
afterAll(() => {
  vi.unstubAllGlobals();
});

/** The Caravan (or, given null, the default Cessna 172S) as the chase camera sees it, parked or in cruise. */
function build(airframe: typeof C208_VISUAL | null, onGround = true): { visual: AircraftVisual; ctx: ReturnType<typeof fakeContext> } {
  const ctx = fakeContext(1);
  if (!onGround) {
    for (const p of ctx.state.propellers) p.rpm = 1900;
    for (const w of ctx.state.wheels) Object.assign(w, { compression: 0, onGround: false });
  }
  const visual = new AircraftVisual({ asyncBake: false, ...(airframe ? { airframe, panelDef: C208_PANEL } : {}) });
  visual.init(ctx);
  ctx.camera.position.set(3, 3, 14);
  ctx.camera.updateMatrixWorld(true);
  ctx.aircraftRoot.updateMatrixWorld(true);
  visual.update(1 / 60, ctx);
  return { visual, ctx };
}

describe('Cessna 208 Caravan airframe visual', () => {
  it('is plain data, and what the livery worker loads by id', async () => {
    expect(C208_VISUAL.id).toBe('c208');
    expect(await loadAirframeVisual('c208')).toBe(C208_VISUAL);
    expect(structuredClone(C208_VISUAL)).toEqual(C208_VISUAL);
    expect(JSON.parse(JSON.stringify(C208_VISUAL))).toEqual(C208_VISUAL);
  });

  it('takes the shared facts from the geometry', () => {
    const g = C208_GEOMETRY;
    const v = C208_VISUAL;
    expect(v.props).toHaveLength(1);
    expect(v.props[0].hub).toEqual([g.propellers[0].hub.x, g.propellers[0].hub.y, g.propellers[0].hub.z]);
    expect(v.props[0].diameter).toBe(106 * 0.0254);
    expect(v.props[0].blades).toBe(3);
    expect(v.props[0].variablePitch).toBe(true);
    expect(v.props[0].spinner.baseX + v.props[0].spinner.length).toBeCloseTo(g.fuselage.noseX, 12);
    expect(v.gear.map((w) => w.contact)).toEqual([g.gear.nose, g.gear.leftMain, g.gear.rightMain].map((p) => [p.x, p.y, p.z]));
    expect(v.gear.map((w) => w.radius)).toEqual([g.gear.noseWheelRadius, g.gear.mainWheelRadius, g.gear.mainWheelRadius]);
    expect(v.gear.every((w) => w.retract === undefined)).toBe(true);
    expect(v.wing.flap.maxDeflection).toBe(g.wing.flap.maxDeflection);
    expect(v.cockpit.pilotEye).toEqual([g.fuselage.pilotEye.x, g.fuselage.pilotEye.y, g.fuselage.pilotEye.z]);
    // Contiguous bays from the root to the tip.
    v.wing.bays.forEach((b, i) => expect(b.from).toBe(i === 0 ? v.wing.rootY : v.wing.bays[i - 1].to));
    expect(v.wing.bays[v.wing.bays.length - 1].to).toBe(g.wing.span / 2);
  });

  it('builds as the simulator builds it: no NaN, outward skins, the span, height and eye of the geometry', () => {
    const { visual } = build(C208_VISUAL, false);
    expect(visual.root.name).toBe('c208');
    expect(nonFinite(visual.root)).toBe(0);
    let tested = 0;
    for (const m of worldMeshes(visual.root)) {
      if (!/\|(wingPaint|finPaint)$/.test(m.name)) continue;
      const f = facing(m);
      expect(f.outward / f.total, `${m.name} outward fraction`).toBeGreaterThan(0.9);
      expect(f.normalAgree / f.total, `${m.name} normal/winding agreement`).toBeGreaterThan(0.97);
      tested++;
    }
    expect(tested).toBeGreaterThanOrEqual(8);
    const box = bodyBox(visual.root);
    expect(Math.abs(box.y1 - box.y0 - C208_GEOMETRY.wing.span)).toBeLessThan(0.03);
    // From the spinner tip to the rudder's top trailing edge: POH 37 ft 7 in (11.46 m).
    expect(box.x1).toBeCloseTo(C208_GEOMETRY.fuselage.noseX, 1);
    expect(Math.abs(box.x1 - box.x0 - C208_GEOMETRY.fuselage.length)).toBeLessThan(0.08);
    // Ground to the fin tip: POH 14 ft 10 in (4.52 m) over the static contact points.
    expect(Math.abs(C208_GEOMETRY.gear.nose.z - 0.06 - box.z0 - 4.52)).toBeLessThan(0.15);
    // The exhaust stack stands out of the cowling's right side, pointing out and aft.
    const stack = worldMeshes(visual.root).filter((m) => m.name.endsWith('|exhaust'));
    expect(stack.length).toBeGreaterThan(0);
    const stackBox = bodyBox(new THREE.Group().add(...stack));
    expect(stackBox.y1).toBeGreaterThan(0.45);
    expect(stackBox.y0).toBeGreaterThan(0.2);
    expect(stackBox.x0).toBeGreaterThan(3.0);
    const eye = C208_GEOMETRY.fuselage.pilotEye;
    expect(visual.pilotEye.distanceTo(new THREE.Vector3(eye.y, -eye.z, -eye.x))).toBeLessThan(1e-9);
    visual.dispose();
  }, 120_000);

  it('the lift strut root stays outside the cabin; every console stays inside the skin', () => {
    const s = C208_VISUAL.wing.strut!;
    const d = s.wing.map((v, i) => v - s.fuselage[i]);
    const start = s.fuselage.map((v, i) => v - 0.035 * d[i]);
    // Below the cabin floor the strut's root may run inside the slab side's lower rounding; above it, outside the cabin.
    expect(start[2]).toBeGreaterThan(C208_VISUAL.cockpit.floor.z - 0.2);
    const { outer } = createFuselageShapes(C208_VISUAL);
    expect(s.fuselage[1]).toBeGreaterThan(sectionHalfWidth(outer, s.fuselage[0], s.fuselage[2]));
    for (const [i, c] of C208_VISUAL.cockpit.consoles.entries()) {
      const y = Math.max(Math.abs(c.min[1]), Math.abs(c.max[1]));
      for (const x of [c.min[0], c.max[0]]) {
        for (const z of [c.min[2], c.max[2]]) {
          expect(sectionHalfWidth(outer, x, z) - y, `console ${i} corner x ${x.toFixed(2)} z ${z.toFixed(2)}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it("the cockpit's parts stand on the panel face's pixels", () => {
    const c = C208_VISUAL.cockpit;
    const PX = 2000;
    const faceZ = (py: number): number => c.panel.zTop + py / PX;
    const faceY = (px: number): number => (px - c208PanelPx(0)) / PX;
    expect(c.panel.width * PX).toBe(2920);
    expect(c.column.kind === 'yoke' && c.column.z).toBeCloseTo(faceZ(C208_PANEL_PARTS.yokes.y), 12);
    const levers = C208_PANEL_PARTS.pedestal.levers;
    expect(c.engineControls.map((e) => [e.control, e.pos[1]])).toEqual([
      ['throttle', faceY(levers.power)],
      ['propeller', faceY(levers.propeller)],
      ['mixture', faceY(levers.condition)],
    ]);
    expect(c.flapControl.pos[1]).toBeCloseTo(faceY(C208_PANEL_PARTS.flapSelector.x), 12);
    expect(c.flapControl.travel).toBeCloseTo(C208_PANEL_PARTS.flapSelector.travel / PX, 12);
    // Heights are thrust line + offset: the hub is on the thrust line.
    expect(C208_VISUAL.props[0].hub[2]).toBe(C208_THRUST_Z);
  });

  it('costs at most +30 draw calls and +60 000 triangles over the Cessna 172S in the chase view', () => {
    for (const onGround of [false, true]) {
      const cessna = build(null, onGround);
      const caravan = build(C208_VISUAL, onGround);
      const a = renderCost(cessna.visual.root);
      const b = renderCost(caravan.visual.root);
      expect(b.draws - a.draws).toBeLessThanOrEqual(30);
      expect(b.triangles - a.triangles).toBeLessThanOrEqual(60_000);
      cessna.visual.dispose();
      caravan.visual.dispose();
    }
  }, 180_000);
});
