// The Cessna 172S airframe definition (aircraft/c172s/visual.ts) and what the builders of render/aircraft
// derive from a definition: the planforms, the panel face (pxRect, gaugeRecess), the control points, the
// options of AircraftVisual. That the C172S model itself comes out unchanged is geometry.regression.test.ts.

import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { C172 } from '../../src/core/c172';
import { C172S_PANEL } from '../../src/aircraft/c172s/panel';
import { C172S_VISUAL } from '../../src/aircraft/c172s/visual';
import type { AirframeVisualDef, CockpitDef, GlazingDef } from '../../src/aircraft/types';
import { PANEL_HEIGHT, PANEL_WIDTH } from '../../src/instruments/layout';
import { gaugeRecess } from '../../src/instruments/panelDef';
import { NACA0009, NACA2412, surfacePoint } from '../../src/render/aircraft/airfoil';
import { FuselageShape } from '../../src/render/aircraft/fuselageShape';
import { createFuselageShapes } from '../../src/render/aircraft/fuselage';
import { finPlanform, makeWingPlanform, sectionPoint, stabPlanform, wingPlanform } from '../../src/render/aircraft/liftingSurface';
import { INLET, inletSdf, makeWindowSdf, windowSdf } from '../../src/render/aircraft/livery';
import type { AircraftMaterials } from '../../src/render/aircraft/materials';

const V = C172S_VISUAL;

function fakeMaterials(): AircraftMaterials {
  const cache = new Map<string | symbol, THREE.Material>();
  return new Proxy({} as AircraftMaterials, {
    get(_t, key) {
      if (!cache.has(key)) cache.set(key, Object.assign(new THREE.MeshStandardMaterial(), { name: String(key) }));
      return cache.get(key);
    },
  });
}

describe('C172S_VISUAL', () => {
  it('is complete: every part the builders read, nothing of a twin', () => {
    expect(Object.keys(V).sort()).toEqual(['cockpit', 'fuselage', 'gear', 'glazing', 'id', 'lamps', 'livery', 'nacelles', 'props', 'shadow', 'tail', 'wing']);
    expect(V.props).toHaveLength(1);
    expect(V.nacelles).toEqual([]);
    expect(V.fairings).toBeUndefined();
    expect(V.gear).toHaveLength(3);
    expect(V.gear.map((w) => w.leg.kind)).toEqual(['oleo', 'springTube', 'springTube']);
    expect(V.gear.every((w) => w.retract === undefined)).toBe(true);
    expect(V.lamps.map((l) => l.id)).toEqual(['navL', 'navR', 'navTail', 'strobeL', 'strobeR', 'beacon', 'landing', 'taxi']);
    expect(V.lamps.filter((l) => l.parent !== undefined).map((l) => l.id)).toEqual(['navTail']);
    expect(V.cockpit.enclosure).toBe('cabin');
    expect(V.cockpit.panel.pxRect).toBeUndefined();
    expect(V.tail.tTail).toBe(false);
    expect(V.tail.h.kind).toBe('elevator');
  });

  it('takes from core/c172.ts what the flight model and the picture must agree on', () => {
    const W = C172.wing;
    expect(V.wing.breaks).toEqual([
      { y: W.rootY, chord: W.rootChord, qcX: 0 },
      { y: W.taperStartY, chord: W.rootChord, qcX: 0 },
      { y: W.span / 2, chord: W.tipChord, qcX: 0 },
    ]);
    expect(V.wing.bays.map((b) => [b.kind, b.from, b.to])).toEqual([
      ['fixed', W.rootY, W.flap.innerY],
      ['flap', W.flap.innerY, W.flap.outerY],
      ['aileron', W.aileron.innerY, W.aileron.outerY],
      ['fixed', W.aileron.outerY, W.span / 2],
    ]);
    // Contiguous from the root to the tip.
    V.wing.bays.forEach((b, i) => expect(b.from).toBe(i === 0 ? V.wing.rootY : V.wing.bays[i - 1].to));
    expect(V.wing.section).toEqual(NACA2412);
    expect(V.tail.section).toEqual(NACA0009);
    expect(V.wing.flap.maxDeflection).toBe(W.flap.maxDeflection);
    expect(V.tail.h.chordFraction).toBe(C172.hTail.elevator.chordFraction);
    expect(V.tail.v.rudderChordFraction).toBe(C172.vTail.rudder.chordFraction);
    expect(V.gear.map((w) => w.contact)).toEqual([C172.gear.nose, C172.gear.leftMain, C172.gear.rightMain].map((p) => [p.x, p.y, p.z]));
    expect(V.gear.map((w) => w.radius)).toEqual([C172.gear.noseWheelRadius, C172.gear.mainWheelRadius, C172.gear.mainWheelRadius]);
    expect(V.props[0].hub).toEqual([C172.prop.hub.x, C172.prop.hub.y, C172.prop.hub.z]);
    expect(V.props[0].diameter).toBe(C172.prop.diameter);
    expect(V.props[0].blades).toBe(C172.prop.blades);
    expect(V.props[0].geometricPitch).toBe(C172.prop.pitchIn * 0.0254);
    // The blade angle at 0.75 R of that helix: about 19.7 degrees.
    expect(Math.tan(V.props[0].referencePitch) * 2 * Math.PI * 0.75 * (C172.prop.diameter / 2)).toBeCloseTo(C172.prop.pitchIn * 0.0254, 12);
    expect(V.props[0].spinner.baseX + V.props[0].spinner.length).toBeCloseTo(C172.fuselage.noseX, 12);
  });

  it('the planforms built from it are the wing, tailplane and fin of core/c172.ts', () => {
    const W = C172.wing;
    expect(wingPlanform.chord(1)).toBe(W.rootChord);
    expect(wingPlanform.chord(W.taperStartY)).toBe(W.rootChord);
    expect(wingPlanform.chord(W.span / 2)).toBeCloseTo(W.tipChord, 14);
    expect(wingPlanform.twist(W.rootY)).toBe(W.rootIncidence);
    expect(wingPlanform.twist(W.span / 2)).toBeCloseTo(W.tipIncidence, 14);
    const tip = wingPlanform.ref(W.span / 2, { x: 0, y: 0, z: 0 });
    expect(tip.z).toBeCloseTo(W.quarterChord.z - (W.span / 2 - W.rootY) * Math.tan(W.dihedral), 14);
    expect(stabPlanform.chord(0)).toBe(C172.hTail.rootChord);
    expect(stabPlanform.chord(C172.hTail.span / 2)).toBe(C172.hTail.tipChord);
    expect(finPlanform.chord(0)).toBe(C172.vTail.rootChord);
    // A planform of the same data is the same planform.
    const again = makeWingPlanform(V.wing);
    for (const y of [0.3, 0.53, 2.0, 2.54, 3.7, 5.5]) {
      expect(again.chord(y)).toBe(wingPlanform.chord(y));
      expect(sectionPoint(again, y, 0.3, 0.04)).toEqual(sectionPoint(wingPlanform, y, 0.3, 0.04));
    }
  });

  it('the cabin roof between the wing roots follows the root section of the wing', () => {
    const keys = V.fuselage.keys;
    expect(keys).toHaveLength(32);
    // Nose to tail.
    keys.forEach((k, i) => i > 0 && expect(k[0]).toBeLessThan(keys[i - 1][0]));
    expect(keys[0][0]).toBe(V.fuselage.frontX);
    expect(keys[keys.length - 1][0]).toBe(V.fuselage.endX);
    for (const xc of [0.02, 0.3, 0.75]) {
      const [ax, ay] = surfacePoint(NACA2412, xc, 1);
      const p = sectionPoint(wingPlanform, V.wing.rootY, ax, ay);
      const key = keys.find((k) => k[0] === p.x);
      expect(key?.[1], `roof key at ${xc}`).toBe(p.z + 0.003);
    }
    // The lofts of the definition are the default lofts.
    const shapes = createFuselageShapes(V);
    for (const x of [1.5, 0.3, -1.0, -3.0]) {
      expect(shapes.outer.section(x).zTop).toBe(new FuselageShape(0).section(x).zTop);
      expect(shapes.lining.section(x).zTop).toBe(new FuselageShape(0.015, V.glazing.liningRoofLimit).section(x).zTop);
    }
  });

  it('glazing: outlines on the side they are given for; the inlets mirror', () => {
    const one: GlazingDef = { ...V.glazing, windscreen: undefined, windows: [{ pts: [[0, -0.1], [0, -0.5], [-0.6, -0.5], [-0.6, -0.1]], r: 0.02, sides: 'left' }] };
    const sdf = makeWindowSdf(one);
    expect(sdf(-0.3, -0.5, -0.3)).toBeLessThan(0);
    expect(sdf(-0.3, 0.5, -0.3)).toBe(Infinity);
    expect(makeWindowSdf({ ...one, windows: [{ ...one.windows[0], sides: 'right' }] })(-0.3, 0.5, -0.3)).toBeLessThan(0);
    // Outside the glazed stations there is no window at all.
    expect(windowSdf(1.2, 0.3, -0.3)).toBe(1);
    expect(windowSdf(-2.2, 0.3, -0.5)).toBe(1);
    expect(windowSdf(0.2, 0.5, -0.3)).toBeLessThan(0);
    expect(inletSdf(1.9, INLET.y, INLET.z)).toBeLessThan(0);
    expect(inletSdf(1.9, -INLET.y, INLET.z)).toBe(inletSdf(1.9, INLET.y, INLET.z));
    expect(inletSdf(1.9, 0, INLET.z)).toBeGreaterThan(0);
    expect(inletSdf(1.7, INLET.y, INLET.z)).toBe(1);
  });
});

describe('cockpit from the definitions', () => {
  beforeAll(() => {
    // The compass card is drawn on a canvas; nothing here looks at it.
    const context = new Proxy({}, { get: () => () => undefined, set: () => true });
    vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => context }) });
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('the C172S panel face: the whole canvas at 2000 px/m, fifteen recesses from gaugeRecess', async () => {
    const { panelFace, PANEL, Cockpit, panelPixelToModel, COCKPIT_CONTROLS, cockpitControls } = await import('../../src/render/aircraft/cockpit');
    const face = panelFace(V.cockpit.panel, C172S_PANEL.size);
    expect(face.pxPerM).toBe(2000);
    expect(face.height).toBe(0.4);
    expect(face.rect).toEqual({ x: 0, y: 0, w: PANEL_WIDTH, h: PANEL_HEIGHT });
    expect(PANEL).toEqual({ x: 0.5, width: 1.04, height: 0.4, zTop: -0.28 });

    const cockpit = new Cockpit(fakeMaterials(), new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3)));
    const shader = { uniforms: {} as Record<string, { value: THREE.Vector4[] }>, vertexShader: '', fragmentShader: '#include <common>' };
    (cockpit.panelMesh.material as THREE.Material).onBeforeCompile(shader as never, null as never);
    const recesses = C172S_PANEL.gauges.map((g) => gaugeRecess(g, C172S_PANEL.apertures)).filter((r) => r !== null);
    const gauges = shader.uniforms.panelGauges.value;
    expect(gauges).toHaveLength(15);
    expect(gauges).toHaveLength(recesses.length);
    recesses.forEach((r, i) => {
      const centre = panelPixelToModel(r.x, r.y);
      expect([gauges[i].x, gauges[i].y, gauges[i].z, gauges[i].w]).toEqual([centre.x, centre.y, r.r / 2000, r.depth]);
    });
    expect(shader.fragmentShader).toContain('#define PANEL_GAUGE_COUNT 15');
    // The program cache key tells panels of another gauge count or face apart.
    expect((cockpit.panelMesh.material as THREE.Material).customProgramCacheKey()).toBe('panelBacklightMask|15|1.04x0.4@2000');
    // A plain plane: its texture coordinates span the whole canvas.
    const uv = cockpit.panelMesh.geometry.getAttribute('uv') as THREE.BufferAttribute;
    expect([Math.min(...(uv.array as Float32Array)), Math.max(...(uv.array as Float32Array))]).toEqual([0, 1]);
    expect(cockpitControls(V.cockpit, C172S_PANEL)).toEqual(COCKPIT_CONTROLS);
    expect(Object.keys(COCKPIT_CONTROLS)).toHaveLength(32);
    cockpit.dispose();
  });

  it('a face that shows part of the canvas: height from the pixels, texture coordinates on that part, recesses to scale', async () => {
    const { panelFace, Cockpit, cockpitControls } = await import('../../src/render/aircraft/cockpit');
    const low: CockpitDef = { ...V.cockpit, panel: { x: 0.45, zTop: -0.2, width: 1.0, pxRect: { x: 0, y: 0, w: 2080, h: 624 } } };
    const face = panelFace(low.panel);
    expect(face.pxPerM).toBe(2080);
    expect(face.height).toBe(0.3);

    const cockpit = new Cockpit(fakeMaterials(), new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3)), undefined, low);
    const g = cockpit.panelMesh.geometry;
    g.computeBoundingBox();
    const size = g.boundingBox!.getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(1.0, 6);
    expect(size.y).toBeCloseTo(0.3, 6);
    // Facing aft at the panel station; the top edge at zTop.
    expect(g.boundingBox!.max.z).toBeCloseTo(-0.45, 6);
    expect(g.boundingBox!.max.y).toBeCloseTo(0.2, 6);
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    let vMin = 1;
    let vMax = 0;
    for (let i = 0; i < uv.count; i++) {
      vMin = Math.min(vMin, uv.getY(i));
      vMax = Math.max(vMax, uv.getY(i));
    }
    expect(vMax).toBeCloseTo(1, 6);
    expect(vMin).toBeCloseTo(1 - 624 / 800, 6);

    const shader = { uniforms: {} as Record<string, { value: THREE.Vector4[] }>, vertexShader: '', fragmentShader: '#include <common>\n#include <map_fragment>' };
    (cockpit.panelMesh.material as THREE.Material).onBeforeCompile(shader as never, null as never);
    const asi = shader.uniforms.panelGauges.value[0];
    // A 74 px aperture at 2080 px/m; pixels stay square, so the dial is as round as its recess.
    expect(asi.z).toBeCloseTo(74 / 2080, 12);
    expect(asi.w).toBe(0.014);
    // The shift across the face is a texture coordinate over the WHOLE canvas: 2080 / 2080 m wide, 800 / 2080 m high.
    expect(shader.fragmentShader).toContain('shift / vec2( 1.000, 0.385 )');
    expect((cockpit.panelMesh.material as THREE.Material).customProgramCacheKey()).toBe('panelBacklightMask|15|1x0.3@2080');
    // The same pixel is lower and nearer the centreline on the smaller face.
    const points = cockpitControls(low, C172S_PANEL);
    expect(points.asi.z).toBeCloseTo(-0.45, 12);
    expect(points.asi.x).toBeCloseTo((315 / 2080 - 0.5) * 1.0, 12);
    cockpit.dispose();
  });

  it('AircraftVisual takes the airframe and the panel definition as options, the C172S by default', async () => {
    const { AircraftVisual } = await import('../../src/render/aircraft/AircraftVisual');
    const eye = C172.fuselage.pilotEye;
    const plain = new AircraftVisual();
    expect(plain.root.name).toBe('C172');
    expect(plain.pilotEye.toArray()).toEqual([eye.y, -eye.z, -eye.x]);
    const other: AirframeVisualDef = { ...V, id: 'c152', cockpit: { ...V.cockpit, pilotEye: [-0.1, -0.25, -0.4] } };
    const visual = new AircraftVisual({ airframe: other, panelDef: C172S_PANEL, asyncBake: false });
    expect(visual.root.name).toBe('c152');
    expect(visual.pilotEye.toArray()).toEqual([-0.25, 0.4, 0.1]);
  });
});
