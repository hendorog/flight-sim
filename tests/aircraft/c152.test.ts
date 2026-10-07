// The Cessna 152's presentation (src/aircraft/c152/{visual,panel,ui,audio,training}.ts): the airframe builds as the
// simulator builds it, with outward skins and no NaN, the data sheet's span and length; the airframe is plain
// data; every gauge, switch and hotspot of the panel lies inside the face the cockpit shows, with no overlap and
// nothing under a control wheel boot; the panel carries the handbook's markings; the sound profile is plain data
// and full power sits in the cockpit level window of the C172S; the school data is plain JSON with the type's own
// speeds. Numbers come from the type's geometry and reference files (G-c152) and the data sheet they cite.

import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { C152_AUDIO } from '../../src/aircraft/c152/audio';
import { C152_GEOMETRY } from '../../src/aircraft/c152/geometry';
import { C152_INSTRUMENT_SYSTEMS, C152_PANEL, C152_PANEL_PX_RECT } from '../../src/aircraft/c152/panel';
import C152_PRESENTATION from '../../src/aircraft/c152/presentation';
import { C152_REFERENCE } from '../../src/aircraft/c152/reference';
import { C152 } from '../../src/aircraft/c152/training';
import { C152_UI } from '../../src/aircraft/c152/ui';
import { C152_VISUAL } from '../../src/aircraft/c152/visual';
import { loadAirframeVisual, loadPresentation } from '../../src/aircraft/registry';
import { defaultControls } from '../../src/core/types';
import { buildHotspots } from '../../src/instruments/hotspots';
import { panelLayoutProblems } from '../../src/instruments/panelLayout';
import { AircraftVisual } from '../../src/render/aircraft/AircraftVisual';
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

describe('Cessna 152 presentation', () => {
  it('is what the registry loads, on the main thread and in the livery worker', async () => {
    expect(await loadPresentation('c152')).toBe(C152_PRESENTATION);
    expect(await loadAirframeVisual('c152')).toBe(C152_VISUAL);
    expect(C152_PRESENTATION.id).toBe('c152');
    expect(C152_VISUAL.id).toBe('c152');
    expect(C152_PANEL.id).toBe('c152');
  });

  it('the airframe and the sound are plain data (structuredClone and JSON round-trip)', () => {
    expect(structuredClone(C152_VISUAL)).toEqual(C152_VISUAL);
    expect(JSON.parse(JSON.stringify(C152_VISUAL))).toEqual(C152_VISUAL);
    expect(structuredClone(C152_AUDIO)).toEqual(C152_AUDIO);
    expect(JSON.parse(JSON.stringify(C152)) as unknown).toEqual(C152);
  });

  it('builds as the simulator builds it: no NaN, outward skins, the data sheet span and length', () => {
    const ctx = fakeContext(1);
    for (const p of ctx.state.propellers) p.rpm = 2300;
    const visual = new AircraftVisual({ asyncBake: false, airframe: C152_VISUAL, panelDef: C152_PANEL });
    visual.init(ctx);
    ctx.camera.position.set(3, 3, 12);
    ctx.camera.updateMatrixWorld(true);
    ctx.aircraftRoot.updateMatrixWorld(true);
    visual.update(1 / 60, ctx);
    expect(visual.root.name).toBe('c152');
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
    // s.2.1 span 10.16 m (wing tips); s.2.4 length 7.24 m from the spinner tip to the rudder's trailing edge.
    const box = bodyBox(visual.root);
    expect(Math.abs(box.y1 - box.y0 - C152_GEOMETRY.wing.span)).toBeLessThan(0.02);
    expect(Math.abs(box.x1 - box.x0 - C152_GEOMETRY.fuselage.length)).toBeLessThan(0.04);
    // The cockpit view sits at the geometry's eye.
    const eye = C152_GEOMETRY.fuselage.pilotEye;
    expect(visual.pilotEye.distanceTo(new THREE.Vector3(eye.y, -eye.z, -eye.x))).toBeLessThan(1e-9);
    visual.dispose();
  }, 120_000);

  it('every gauge, switch and hotspot lies inside the face the cockpit shows, without overlap', () => {
    expect(C152_VISUAL.cockpit.panel.pxRect).toBe(C152_PANEL_PX_RECT);
    expect(panelLayoutProblems(C152_PANEL, C152_PANEL_PX_RECT, buildHotspots(C152_PANEL))).toEqual([]);
    const r = C152_PANEL_PX_RECT;
    for (const h of buildHotspots(C152_PANEL)) {
      expect(h.x - h.hw, h.id).toBeGreaterThanOrEqual(r.x);
      expect(h.x + h.hw, h.id).toBeLessThanOrEqual(r.x + r.w);
      expect(h.y - h.hh, h.id).toBeGreaterThanOrEqual(r.y);
      expect(h.y + h.hh, h.id).toBeLessThanOrEqual(r.y + r.h);
    }
    // 2000 px/m like the C172S, so the instruments are drawn at their real size.
    expect(r.w / C152_VISUAL.cockpit.panel.width).toBeCloseTo(2000, 9);
  });

  it("the panel carries the handbook's markings and the type's switches", () => {
    const asi = C152_PANEL.gauges.find((g) => g.kind === 'asi');
    const tach = C152_PANEL.gauges.find((g) => g.kind === 'tach');
    if (asi?.kind !== 'asi' || tach?.kind !== 'tach') throw new Error('no ASI or tachometer');
    // POH Fig 2-2: white 35-85, green 40-111, yellow 111-149, red line 149 KIAS.
    expect(asi.marks.arcs).toEqual([
      { from: 40, to: 111, color: 'green' },
      { from: 111, to: 149, color: 'yellow' },
      { from: 35, to: 85, color: 'white', inner: true },
    ]);
    expect(asi.marks.redLine).toBe(C152_REFERENCE.vne);
    // POH Fig 2-3: green 1900-2550 rpm, red line 2550.
    expect(tach.marks.arcs).toEqual([{ from: 1900, to: 2550, color: 'green' }]);
    expect(tach.marks.redLine).toBe(2550);
    // No EGT / fuel flow, no fuel pump, no avionics master; one low-voltage lamp; a key ignition.
    expect(C152_PANEL.gauges.map((g) => g.id)).not.toContain('egtff');
    const switches = C152_PANEL.switchRow.switches.map((s) => s.id);
    expect(switches).not.toContain('fuelPump');
    expect(switches).not.toContain('avionics');
    expect(C152_PANEL.annunciator?.lamps?.map((l) => l.id)).toEqual(['lowVolts']);
    expect(C152_INSTRUMENT_SYSTEMS.lamps.map((l) => l.id)).toEqual(['lowVolts']);
    expect(C152_PANEL.ignition.kind).toBe('key');
    // The CARB HEAT knob is left of the throttle, the mixture right of it, on the panel and in the cockpit.
    const knobs = C152_VISUAL.cockpit.engineControls.map((k) => [k.control, k.pos[1]] as const);
    expect(knobs.map((k) => k[0])).toEqual(['carbHeat', 'throttle', 'mixture']);
    expect(knobs[0][1]).toBeLessThan(knobs[1][1]);
    expect(knobs[1][1]).toBeLessThan(knobs[2][1]);
    expect(C152_PANEL.background.bushings.map((b) => b.text)).toEqual(['CARB HEAT', 'THROTTLE', 'MIXTURE', 'PARK BRAKE']);
  });

  it('the lift strut root stays outside the cabin; the pneumatic stall horn needs no bus', () => {
    // render/aircraft/wings.ts addStrut: the sweep starts 3.5 % of the strut inside the fuselage point, and the
    // root fairing there is 2.3 times the strut's thickness. Its inner face must stay outboard of the cabin side.
    const s = C152_VISUAL.wing.strut!;
    const d = s.wing.map((v, i) => v - s.fuselage[i]);
    const start = s.fuselage.map((v, i) => v - 0.035 * d[i]);
    const n = Math.abs(d[2]) / Math.hypot(d[1], d[2]);
    const halfThickness = 1.15 * s.tc * s.chord;
    expect(start[1] - n * halfThickness).toBeGreaterThan(C152_VISUAL.cockpit.box!.side);
    expect(C152_AUDIO.stallWarner?.needsBus).toBe(false);
  });

  it('the UI names the type\'s controls: carburettor heat, the fuel valve, no pump', () => {
    const c = defaultControls();
    c.masterBattery = true;
    c.fuelSelector = 'off';
    expect(C152_UI.starterAdvice(c, 0)).toMatch(/fuel shut-off valve/);
    c.fuelSelector = 'on';
    c.mixture = 1;
    expect(C152_UI.starterAdvice(c, 0)).toBeNull();
    c.carbHeat = 1;
    expect(C152_UI.switches.find((s) => s.id === 'carbHeat')?.read(c)).toBe('HOT');
    expect(C152_UI.switches.map((s) => s.id)).not.toContain('fuelPump');
  });

  it('full power on the ground sits in the cockpit level window of the C172S (-17 .. -9 dBFS), nothing clips', () => {
    // A static full-power run of the 152: 2330 rpm (POH 2280-2380), full throttle, the propeller loaded about 1.6
    // x its cruise thrust, tip Mach 0.63 (1.753 m at 2330 rpm).
    const fullPower = { rpm: 2330, firing: 1, load: 1, throttle: 1, propLoad: 1.6, tipMach: 0.63 };
    const stems = new SynthHost(C152_AUDIO).set(fullPower).render(4);
    const interior = interiorMix(stems, C152_AUDIO);
    const level = dbfs(rms(interior, SR));
    console.log(`[c152] full power interior ${level.toFixed(2)} dBFS RMS, peak ${dbfs(peak(interior.subarray(SR))).toFixed(2)} dBFS`);
    expect(level).toBeGreaterThan(-17);
    expect(level).toBeLessThan(-9);
    expect(dbfs(peak(interior.subarray(SR)))).toBeLessThan(-2);
  }, 30_000);

  it("the school data: the type's own id, speeds from the reference table, data only (not a school type)", () => {
    expect(C152.id).toBe('c152');
    expect(C152.classRating).toBe('SEP');
    expect(C152.vspeeds.Vne).toBe(C152_REFERENCE.vne);
    expect(C152.vspeeds.Vs0).toBe(C152_REFERENCE.vs0);
    expect(C152.vspeeds.Vy).toBe(C152_REFERENCE.vy);
    expect(Object.keys(C152.vspeeds)).toHaveLength(22);
    expect(Object.keys(C152.settings)).toHaveLength(11);
    expect(Object.keys(C152.checklists)).toHaveLength(14);
    expect(C152.flapDetentsDeg).toEqual([0, 10, 20, 30]);
    expect(C152.school?.syllabus).toBe(false);
  });
});
