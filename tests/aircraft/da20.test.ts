// The Diamond DA20-C1's presentation (src/aircraft/da20/{visual,panel,ui,audio,training}.ts): the airframe builds as
// the simulator builds it, with outward skins and no NaN, the data sheet's span and length; the interior stays
// drawn under the canopy in a zoomed fly-by and one figure sits in it in the external views; the airframe is plain
// data; the low panel face fits inside the canopy, and every gauge, switch and hotspot of the panel lies inside
// it without overlap; the panel carries the flight manual's markings; the sound profile is plain data and full
// power sits in the cockpit level window of the C172S; the school data is plain JSON with the type's own speeds.
// Numbers come from the type's geometry and reference files (G-da20) and the data sheet they cite.

import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DA20_AUDIO } from '../../src/aircraft/da20/audio';
import { DA20_GEOMETRY } from '../../src/aircraft/da20/geometry';
import { DA20_INSTRUMENT_SYSTEMS, DA20_PANEL, DA20_PANEL_PX_RECT } from '../../src/aircraft/da20/panel';
import DA20_PRESENTATION from '../../src/aircraft/da20/presentation';
import { DA20_REFERENCE } from '../../src/aircraft/da20/reference';
import { DA20 } from '../../src/aircraft/da20/training';
import { DA20_UI } from '../../src/aircraft/da20/ui';
import { DA20_VISUAL } from '../../src/aircraft/da20/visual';
import { loadAirframeVisual, loadPresentation } from '../../src/aircraft/registry';
import { defaultControls } from '../../src/core/types';
import { buildHotspots } from '../../src/instruments/hotspots';
import { panelLayoutProblems } from '../../src/instruments/panelLayout';
import { AircraftVisual } from '../../src/render/aircraft/AircraftVisual';
import { FuselageShape, type Section } from '../../src/render/aircraft/fuselageShape';
import { interiorMix, dbfs } from '../audio/mixModel';
import { peak, rms, SR, SynthHost } from '../audio/workletHost';
import { blankDocument, bodyBox, facing, fakeContext, nonFinite, worldMeshes } from './meshChecks';

vi.setConfig({ testTimeout: 60_000 });

beforeAll(() => {
  vi.stubGlobal('document', blankDocument());
});
afterAll(() => {
  vi.unstubAllGlobals();
});

/** The visual built as the simulator builds it, seen from the chase position 13 m away. */
function build(): { visual: AircraftVisual; ctx: ReturnType<typeof fakeContext> } {
  const ctx = fakeContext(1);
  for (const p of ctx.state.propellers) p.rpm = 2300;
  const visual = new AircraftVisual({ asyncBake: false, airframe: DA20_VISUAL, panelDef: DA20_PANEL });
  visual.init(ctx);
  ctx.camera.position.set(3, 3, 12);
  ctx.camera.updateMatrixWorld(true);
  ctx.aircraftRoot.updateMatrixWorld(true);
  visual.update(1 / 60, ctx);
  return { visual, ctx };
}

/** Half width of a loft section at height z (FRD), m: the superellipse halves of render/aircraft/fuselageShape.ts. */
function halfWidthAt(s: Section, z: number): number {
  const upper = z < s.zMid;
  const q = upper ? (s.zMid - z) / (s.zMid - s.zTop) : (z - s.zMid) / (s.zBot - s.zMid);
  if (q >= 1) return 0;
  const n = upper ? s.nTop : s.nBot;
  const u = Math.pow(Math.max(0, q), n / 2);
  return s.hw * Math.pow(1 - u * u, 1 / n);
}

describe('Diamond DA20-C1 presentation', () => {
  it('is what the registry loads, on the main thread and in the livery worker', async () => {
    expect(await loadPresentation('da20')).toBe(DA20_PRESENTATION);
    expect(await loadAirframeVisual('da20')).toBe(DA20_VISUAL);
    expect(DA20_PRESENTATION.id).toBe('da20');
    expect(DA20_VISUAL.id).toBe('da20');
    expect(DA20_PANEL.id).toBe('da20');
  });

  it('the airframe and the sound are plain data (structuredClone and JSON round-trip)', () => {
    expect(structuredClone(DA20_VISUAL)).toEqual(DA20_VISUAL);
    expect(JSON.parse(JSON.stringify(DA20_VISUAL))).toEqual(DA20_VISUAL);
    expect(structuredClone(DA20_AUDIO)).toEqual(DA20_AUDIO);
    expect(JSON.parse(JSON.stringify(DA20)) as unknown).toEqual(DA20);
  });

  it('builds as the simulator builds it: no NaN, outward skins, the data sheet span and length', () => {
    const { visual } = build();
    expect(visual.root.name).toBe('da20');
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
    // s.2.1: span 10.87 m (the upturned tips); length 7.24 m from the spinner tip to the elevator's trailing edge.
    const box = bodyBox(visual.root);
    expect(Math.abs(box.y1 - box.y0 - DA20_GEOMETRY.wing.span)).toBeLessThan(0.02);
    expect(Math.abs(box.x1 - box.x0 - DA20_GEOMETRY.fuselage.length)).toBeLessThan(0.04);
    // The cockpit view sits at the geometry's eye.
    const eye = DA20_GEOMETRY.fuselage.pilotEye;
    expect(visual.pilotEye.distanceTo(new THREE.Vector3(eye.y, -eye.z, -eye.x))).toBeLessThan(1e-9);
    visual.dispose();
  }, 120_000);

  it('under the canopy: the interior stays drawn in a zoomed fly-by, one figure in the external views only', () => {
    const { visual, ctx } = build();
    const cockpit = visual.root.getObjectByName('cockpit')!;
    const occupants = visual.root.getObjectByName('occupants')!;
    expect([cockpit.visible, occupants.visible]).toEqual([true, true]);
    // One figure of about 300 flat-shaded triangles (contract 5.3), its head under the canopy at the eye height.
    let triangles = 0;
    for (const m of occupants.children as THREE.Mesh[]) triangles += m.geometry.index!.count / 3;
    expect(triangles).toBeGreaterThan(250);
    expect(triangles).toBeLessThan(400);
    const head = bodyBox(occupants);
    expect(head.z0).toBeLessThan(DA20_GEOMETRY.fuselage.pilotEye.z - 0.03);
    expect(head.z0).toBeGreaterThan(DA20_GEOMETRY.fuselage.pilotEye.z - 0.2);
    // A fly-by camera 700 m away zoomed to 4 degrees: the canopy's interior is as large as from 42 m and stays.
    ctx.camera.fov = 4;
    ctx.camera.position.set(0, 0, 700);
    ctx.camera.updateMatrixWorld(true);
    visual.update(1 / 60, ctx);
    expect([cockpit.visible, occupants.visible]).toEqual([true, true]);
    // In the cockpit view the figure is not drawn (the camera sits in the pilot's head).
    (ctx as { cameraMode: string }).cameraMode = 'cockpit';
    visual.update(1 / 60, ctx);
    expect([cockpit.visible, occupants.visible]).toEqual([true, false]);
    visual.dispose();
  }, 120_000);

  it('the low panel face, the glareshield and the seats fit inside the cabin', () => {
    const c = DA20_VISUAL.cockpit;
    // pxRect { 0, 0, 2080, 624 } (contract 5.3): about 1.0 m x 0.30 m, square pixels.
    expect(c.panel.pxRect).toBe(DA20_PANEL_PX_RECT);
    expect(DA20_PANEL_PX_RECT).toEqual({ x: 0, y: 0, w: 2080, h: 624 });
    const pxPerM = DA20_PANEL_PX_RECT.w / c.panel.width;
    expect(c.panel.width).toBeGreaterThan(0.94);
    expect(DA20_PANEL_PX_RECT.h / pxPerM).toBeGreaterThan(0.28);
    // The upper corners of the face and the forward ends of the hood stay 1.5 cm inside the cabin lining.
    const lining = new FuselageShape(0.015, -1e9, DA20_VISUAL.fuselage);
    expect(halfWidthAt(lining.section(c.panel.x), c.panel.zTop)).toBeGreaterThan(c.panel.width / 2 + 0.015);
    for (const [x, z] of c.glareshield.profile) expect(halfWidthAt(lining.section(x), z), `glareshield at x ${x}`).toBeGreaterThan(c.glareshield.halfWidth);
    // The seat shells low in the narrowing tub: the cushion's outer edges and the floor rails under it (cockpit.ts
    // addSeat: a cushion 0.1 m deep under its top, rails 0.1 m either side of the seat centre, depth + 0.3 long).
    for (const seat of c.seats) {
      const top = seat.z!;
      for (let k = 0; k <= 10; k++) {
        const x = seat.x - (seat.depth * k) / 10;
        for (const z of [top, top + 0.1]) expect(halfWidthAt(lining.section(x), z), `seat cushion at x ${x}`).toBeGreaterThan(Math.abs(seat.y) + seat.width / 2);
        const rail = seat.x - seat.depth / 2 + ((k - 5) / 10) * (seat.depth + 0.3);
        expect(halfWidthAt(lining.section(rail), c.floor.z), `seat rail at x ${rail}`).toBeGreaterThan(Math.abs(seat.y) + 0.1 + 0.0125);
      }
    }
  });

  it('the root fillet ends at the fuselage skin, the footwell is closed, the stick grips stay under the key', () => {
    // The fillet is one thin plate across the fuselage: behind the wing's root trailing edge (x 3.00 aft of the
    // spinner tip) its edges come in to the skin at the wing's height, so nothing stands proud of the boom.
    const fillet = DA20_VISUAL.fairings![0];
    expect([fillet.offset?.y, fillet.mirror]).toEqual([0, undefined]);
    const skin = new FuselageShape(0, -1e9, DA20_VISUAL.fuselage);
    const last = fillet.keys[fillet.keys.length - 1];
    expect(last[4]).toBeLessThan(halfWidthAt(skin.section(last[0]), fillet.offset!.z + last[3]));
    // The tub's carpet runs up the firewall ahead of the pedals to above the line of sight under the panel.
    const c = DA20_VISUAL.cockpit;
    const toe = c.fittings!.toeBoard!;
    expect(Math.min(toe.x0, toe.x1)).toBeGreaterThan(c.pedals.x);
    const eye = c.pilotEye;
    const panelBottom = c.panel.zTop + DA20_PANEL_PX_RECT.h / (DA20_PANEL_PX_RECT.w / c.panel.width);
    const sightAtFirewall = eye[2] + ((panelBottom - eye[2]) * (toe.x1 - eye[0])) / (c.panel.x - eye[0]);
    expect(toe.z).toBeLessThan(sightAtFirewall);
    // From the eye, the grips' tops lie below the magneto key (the item the start card asks for).
    if (c.column.kind !== 'stick' || DA20_PANEL.ignition.kind !== 'key') throw new Error('no stick or key');
    const pxPerM = DA20_PANEL_PX_RECT.w / c.panel.width;
    const keyZ = c.panel.zTop + (DA20_PANEL.ignition.at[1] - DA20_PANEL_PX_RECT.y) / pxPerM;
    const gripX = c.column.pivot[0];
    const gripZ = c.column.pivot[2] - c.column.height;
    const sightAtGrip = eye[2] + ((keyZ - eye[2]) * (gripX - eye[0])) / (c.panel.x - eye[0]);
    expect(gripZ).toBeGreaterThan(sightAtGrip);
  });

  it('every gauge, switch and hotspot lies inside the face the cockpit shows, without overlap', () => {
    expect(panelLayoutProblems(DA20_PANEL, DA20_PANEL_PX_RECT, buildHotspots(DA20_PANEL))).toEqual([]);
    const r = DA20_PANEL_PX_RECT;
    for (const h of buildHotspots(DA20_PANEL)) {
      expect(h.x - h.hw, h.id).toBeGreaterThanOrEqual(r.x);
      expect(h.x + h.hw, h.id).toBeLessThanOrEqual(r.x + r.w);
      expect(h.y - h.hh, h.id).toBeGreaterThanOrEqual(r.y);
      expect(h.y + h.hh, h.id).toBeLessThanOrEqual(r.y + r.h);
    }
  });

  it("the panel carries the flight manual's markings and the type's switches", () => {
    const asi = DA20_PANEL.gauges.find((g) => g.kind === 'asi');
    const tach = DA20_PANEL.gauges.find((g) => g.kind === 'tach');
    if (asi?.kind !== 'asi' || tach?.kind !== 'tach') throw new Error('no ASI or tachometer');
    // AFM 2.3: white 34-78, green 42-118, yellow 118-164, red line 164 KIAS; no blue line or red radial.
    expect(asi.marks.arcs).toEqual([
      { from: 42, to: 118, color: 'green' },
      { from: 118, to: 164, color: 'yellow' },
      { from: 34, to: 78, color: 'white', inner: true },
    ]);
    expect(asi.marks.redLine).toBe(DA20_REFERENCE.vne);
    expect(asi.marks.blueLine).toBeUndefined();
    // AFM 2.5: green 700-2800 rpm, red line 2800.
    expect(tach.marks.arcs).toEqual([{ from: 700, to: 2800, color: 'green' }]);
    expect(tach.marks.redLine).toBe(2800);
    // The engine instruments in two columns of four (s.9); no manifold pressure gauge (s.4).
    const ids = DA20_PANEL.gauges.map((g) => g.id);
    for (const id of ['egt', 'cht', 'fuelPress', 'fuel', 'oilTemp', 'oilPress', 'ammeter', 'volts']) expect(ids).toContain(id);
    expect(ids).not.toContain('manifold');
    const gauge = (id: string) => DA20_PANEL.gauges.find((g) => g.id === id);
    const cht = gauge('cht');
    const oilPress = gauge('oilPress');
    if (cht?.kind !== 'single' || oilPress?.kind !== 'single') throw new Error('no CHT or oil pressure gauge');
    // CHT green 300-420 F, red line 460; oil pressure green 30-60 psi, red lines 10 and 100 (AFM 2.4.1, 2.5).
    expect(cht.scale.arcs).toContainEqual({ from: 300, to: 420, color: 'green' });
    expect(cht.scale.redLines).toEqual([460]);
    expect(oilPress.scale.arcs).toContainEqual({ from: 30, to: 60, color: 'green' });
    expect(oilPress.scale.redLines).toEqual([10, 100]);
    // The flap switch with its three lights: green CRUISE, yellow T/O and LDG at 0, 15, 45 degrees (s.9).
    const flaps = gauge('flaps');
    if (flaps?.kind !== 'flapLights') throw new Error('no flap lights');
    expect(flaps.positions).toEqual(['CRUISE', 'T/O', 'LDG']);
    expect(flaps.colors).toEqual(['green', 'yellow', 'yellow']);
    expect(flaps.degrees).toEqual([0, 15, 45]);
    expect(flaps.lever).toBeDefined();
    expect(gauge('elevatorTrim')?.kind).toBe('trimBar');
    // GEN, CANOPY and START lamps; the split GEN / BAT master, the fuel pump and the avionics master; a key.
    expect(DA20_PANEL.annunciator?.lamps?.map((l) => l.id)).toEqual(['gen', 'canopy', 'start']);
    expect(DA20_INSTRUMENT_SYSTEMS.lamps.map((l) => l.id)).toEqual(['gen', 'canopy', 'start']);
    const switches = DA20_PANEL.switchRow.switches.map((s) => s.id);
    for (const id of ['fuelPump', 'avionics', 'alternator', 'battery']) expect(switches).toContain(id);
    expect(DA20_PANEL.ignition.kind).toBe('key');
    // One fuselage tank: one gauge reading both halves of the legacy view.
    expect(DA20_INSTRUMENT_SYSTEMS.fuel.tanks).toHaveLength(1);
  });

  it('the cockpit: sticks, the three-lever quadrant left to right, the flap switch on the panel', () => {
    const c = DA20_VISUAL.cockpit;
    expect(c.enclosure).toBe('canopy');
    expect(c.column.kind).toBe('stick');
    // Alternate air (left), throttle (centre), mixture (right, red) side by side on the centre console (s.9).
    const levers = c.engineControls.map((k) => [k.kind, k.control, k.pos[1], k.colour] as const);
    expect(levers.map((k) => k[1])).toEqual(['alternateAir', 'throttle', 'mixture']);
    expect(levers.every((k) => k[0] === 'lever')).toBe(true);
    expect(levers[0][2]).toBeLessThan(levers[1][2]);
    expect(levers[1][2]).toBeLessThan(levers[2][2]);
    expect(levers[2][3]).toBe('red');
    expect(c.flapControl.kind).toBe('panelSwitch');
    expect(c.trimWheel).toBeUndefined();
    expect(c.occupants).toEqual([{ seat: 0 }]);
    expect(DA20_VISUAL.livery.construction).toBe('composite');
    expect(DA20_VISUAL.tail.tTail).toBe(true);
    expect(DA20_VISUAL.wing.root).toBe('conform');
  });

  it("the UI names the type's controls: a stick, the fuel valve, the toe-brake steering", () => {
    expect(DA20_UI.controlName).toBe('stick');
    const c = defaultControls();
    c.masterBattery = true;
    c.fuelSelector = 'off';
    expect(DA20_UI.starterAdvice(c, 0)).toMatch(/fuel shut-off valve is CLOSED/);
    c.fuelSelector = 'on';
    c.mixture = 1;
    expect(DA20_UI.starterAdvice(c, 0)).toBeNull();
    c.alternateAir = true;
    expect(DA20_UI.switches.find((s) => s.id === 'alternateAir')?.read(c)).toBe('ON');
    expect(DA20_UI.switches.map((s) => s.id)).not.toContain('carbHeat');
    // Contract 3.6: the hints row of a castering type.
    expect(DA20_UI.hints.map((h) => `${h[0]}: ${h[1]}`)).toContain('Taxi turns: rudder keys, or , and . for the toe brakes');
  });

  it('full power on the ground sits in the cockpit level window of the C172S (-17 .. -9 dBFS), nothing clips', () => {
    // A static full-power run: 2150 rpm (s.5: 2100-2200 on the roll), full throttle, the propeller loaded about 1.7
    // x its cruise thrust, tip Mach 0.58 (1.752 m at 2150 rpm).
    const fullPower = { rpm: 2150, firing: 1, load: 1, throttle: 1, propLoad: 1.7, tipMach: 0.58 };
    const stems = new SynthHost(DA20_AUDIO).set(fullPower).render(4);
    const interior = interiorMix(stems, DA20_AUDIO);
    const level = dbfs(rms(interior, SR));
    console.log(`[da20] full power interior ${level.toFixed(2)} dBFS RMS, peak ${dbfs(peak(interior.subarray(SR))).toFixed(2)} dBFS`);
    expect(level).toBeGreaterThan(-17);
    expect(level).toBeLessThan(-9);
    expect(dbfs(peak(interior.subarray(SR)))).toBeLessThan(-2);
    // The pneumatic horn needs no bus; a 14 V system.
    expect(DA20_AUDIO.stallWarner.needsBus).toBe(false);
    expect(DA20_AUDIO.busPoweredV).toBe(10);
  }, 30_000);

  it("the school data: the type's own id, speeds from the reference table, data only (not a school type)", () => {
    expect(DA20.id).toBe('da20');
    expect(DA20.icaoType).toBe('DV20');
    expect(DA20.classRating).toBe('SEP');
    expect(DA20.vspeeds.Vne).toBe(DA20_REFERENCE.vne);
    expect(DA20.vspeeds.Vs0).toBe(DA20_REFERENCE.vs0);
    expect(DA20.vspeeds.Vy).toBe(DA20_REFERENCE.vy);
    expect(DA20.vspeeds.VfeFull).toBe(78);
    expect(Object.keys(DA20.vspeeds)).toHaveLength(22);
    expect(Object.keys(DA20.settings)).toHaveLength(11);
    expect(Object.keys(DA20.checklists)).toHaveLength(14);
    expect(DA20.flapDetentsDeg).toEqual([0, 15, 45]);
    expect(DA20.flapLeverForDeg[15]).toBeCloseTo(1 / 3, 12);
    expect(DA20.systems?.steering).toBe('castering');
    expect(DA20.systems?.inceptor).toBe('stick');
    expect(DA20.school?.syllabus).toBe(false);
  });
});
