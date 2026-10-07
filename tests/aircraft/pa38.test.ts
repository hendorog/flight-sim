// The Piper PA-38-112 Tomahawk II's presentation (src/aircraft/pa38/{visual,panel,ui,audio,training}.ts): the
// airframe builds as the simulator builds it, with outward skins and no NaN, the data sheet's span and length; the
// airframe is plain data; every gauge, switch and hotspot of the panel lies inside the face the cockpit shows, with
// no overlap and nothing under a control wheel boot; the panel carries the handbook's markings; the sound profile
// is plain data and full power sits in the cockpit level window of the C172S; the school data is plain JSON with
// the type's own speeds. Numbers come from the type's geometry and reference files (G-pa38) and the data sheet
// they cite.

import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PA38_AUDIO } from '../../src/aircraft/pa38/audio';
import { PA38_GEOMETRY } from '../../src/aircraft/pa38/geometry';
import { PA38_INSTRUMENT_SYSTEMS, PA38_PANEL, PA38_PANEL_PX_RECT } from '../../src/aircraft/pa38/panel';
import PA38_PRESENTATION from '../../src/aircraft/pa38/presentation';
import { PA38_REFERENCE } from '../../src/aircraft/pa38/reference';
import { PA38 } from '../../src/aircraft/pa38/training';
import { PA38_UI } from '../../src/aircraft/pa38/ui';
import { PA38_VISUAL } from '../../src/aircraft/pa38/visual';
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

describe('Piper PA-38 Tomahawk II presentation', () => {
  it('is what the registry loads, on the main thread and in the livery worker', async () => {
    expect(await loadPresentation('pa38')).toBe(PA38_PRESENTATION);
    expect(await loadAirframeVisual('pa38')).toBe(PA38_VISUAL);
    expect(PA38_PRESENTATION.id).toBe('pa38');
    expect(PA38_VISUAL.id).toBe('pa38');
    expect(PA38_PANEL.id).toBe('pa38');
  });

  it('the airframe and the sound are plain data (structuredClone and JSON round-trip)', () => {
    expect(structuredClone(PA38_VISUAL)).toEqual(PA38_VISUAL);
    expect(JSON.parse(JSON.stringify(PA38_VISUAL))).toEqual(PA38_VISUAL);
    expect(structuredClone(PA38_AUDIO)).toEqual(PA38_AUDIO);
    expect(JSON.parse(JSON.stringify(PA38)) as unknown).toEqual(PA38);
  });

  it('builds as the simulator builds it: no NaN, outward skins, the data sheet span and length, a T-tail', () => {
    const ctx = fakeContext(1);
    for (const p of ctx.state.propellers) p.rpm = 2350;
    const visual = new AircraftVisual({ asyncBake: false, airframe: PA38_VISUAL, panelDef: PA38_PANEL });
    visual.init(ctx);
    ctx.camera.position.set(3, 3, 12);
    ctx.camera.updateMatrixWorld(true);
    ctx.aircraftRoot.updateMatrixWorld(true);
    visual.update(1 / 60, ctx);
    expect(visual.root.name).toBe('pa38');
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
    // s.2.1 span 10.36 m (34 ft). s.2.6 length 7.06 m from the spinner tip to the aft end of the fin-top bullet
    // (STA 273.59, tail.bullet.aftX).
    const box = bodyBox(visual.root);
    expect(Math.abs(box.y1 - box.y0 - PA38_GEOMETRY.wing.span)).toBeLessThan(0.02);
    expect(box.x1 - box.x0).toBeGreaterThan(PA38_GEOMETRY.fuselage.length - 0.02);
    expect(box.x1 - box.x0).toBeLessThan(PA38_GEOMETRY.fuselage.length + 0.02);
    // The cockpit view sits at the geometry's eye.
    const eye = PA38_GEOMETRY.fuselage.pilotEye;
    expect(visual.pilotEye.distanceTo(new THREE.Vector3(eye.y, -eye.z, -eye.x))).toBeLessThan(1e-9);
    // The tailplane sits on the fin: the T-tail of the geometry, drawn as one.
    expect(PA38_VISUAL.tail.tTail).toBe(true);
    expect(PA38_VISUAL.tail.v.tip.z).toBeCloseTo(PA38_GEOMETRY.hTail.quarterChord.z, 9);
    visual.dispose();
  }, 120_000);

  it('the rudder hangs below the tail cone top, the compass stays under the roof, the quadrant levers stay in view', () => {
    // bottomH is measured up the fin from its base: the rudder's foot at WL 44.90 lies below the cone top (WL 57).
    expect(PA38_VISUAL.tail.v.rudderExtension!.bottomH).toBeLessThan(-0.25);
    // The cockpit builder stacks the compass's mounting bracket 0.125 m above pos at x + 0.005 .. 0.035: under the
    // roof line (the fuselage keys' top) on the centre line.
    const keys = PA38_VISUAL.fuselage.keys;
    const top = (x: number): number => {
      for (let i = 1; i < keys.length; i++) {
        const [x0, z0] = keys[i - 1];
        const [x1, z1] = keys[i];
        if (x <= x0 && x >= x1) return z0 + ((x - x0) / (x1 - x0)) * (z1 - z0);
      }
      return NaN;
    };
    const c = PA38_VISUAL.cockpit.compass!.pos;
    for (const x of [c[0] + 0.005, c[0] + 0.035]) expect(c[2] - 0.125, `bracket at x ${x}`).toBeGreaterThan(top(x) + 0.003);
    // Throttle and mixture: at full forward travel (travel / 2 from upright) the knob (radius 0.017) stays aft of
    // every black quadrant body it is level with.
    const quadrant = PA38_VISUAL.cockpit.consoles.filter((k) => k.material === 'black');
    for (const e of PA38_VISUAL.cockpit.engineControls.filter((k) => k.control !== 'carbHeat')) {
      const len = e.length ?? 0.11;
      const knob = { x: e.pos[0] + len * Math.sin(e.travel / 2) + 0.017, z: e.pos[2] - len * Math.cos(e.travel / 2) };
      for (const k of quadrant) {
        if (knob.z < k.min[2] || knob.z > k.max[2] || e.pos[1] < k.min[1] || e.pos[1] > k.max[1]) continue;
        expect(knob.x, `${e.control} knob forward of the quadrant face`).toBeLessThan(k.min[0]);
      }
    }
  });

  it('every gauge, switch and hotspot lies inside the face the cockpit shows, without overlap', () => {
    expect(PA38_VISUAL.cockpit.panel.pxRect).toBe(PA38_PANEL_PX_RECT);
    expect(panelLayoutProblems(PA38_PANEL, PA38_PANEL_PX_RECT, buildHotspots(PA38_PANEL))).toEqual([]);
    const r = PA38_PANEL_PX_RECT;
    for (const h of buildHotspots(PA38_PANEL)) {
      expect(h.x - h.hw, h.id).toBeGreaterThanOrEqual(r.x);
      expect(h.x + h.hw, h.id).toBeLessThanOrEqual(r.x + r.w);
      expect(h.y - h.hh, h.id).toBeGreaterThanOrEqual(r.y);
      expect(h.y + h.hh, h.id).toBeLessThanOrEqual(r.y + r.h);
    }
    // 2000 px/m like the C172S, so the instruments are drawn at their real size.
    expect(r.w / PA38_VISUAL.cockpit.panel.width).toBeCloseTo(2000, 9);
  });

  it("the panel carries the handbook's markings and the type's switches", () => {
    const asi = PA38_PANEL.gauges.find((g) => g.kind === 'asi');
    const tach = PA38_PANEL.gauges.find((g) => g.kind === 'tach');
    if (asi?.kind !== 'asi' || tach?.kind !== 'tach') throw new Error('no ASI or tachometer');
    // POH 2.5, Tomahawk II: white 49-89, green 52-110, yellow 110-138, red line 138 KIAS.
    expect(asi.marks.arcs).toEqual([
      { from: 52, to: 110, color: 'green' },
      { from: 110, to: 138, color: 'yellow' },
      { from: 49, to: 89, color: 'white', inner: true },
    ]);
    expect(asi.marks.redLine).toBe(PA38_REFERENCE.vne);
    // POH 2.9: green 500-2600 rpm, red line 2600.
    expect(tach.marks.arcs).toEqual([{ from: 500, to: 2600, color: 'green' }]);
    expect(tach.marks.redLine).toBe(2600);
    // Engine cluster: fuel pressure 0.5-8 psi with red lines at both ends; oil pressure red lines 15 and 100.
    const cluster = PA38_PANEL.gauges.find((g) => g.id === 'fuelPressAmps');
    const oil = PA38_PANEL.gauges.find((g) => g.id === 'oil');
    if (cluster?.kind !== 'dual' || oil?.kind !== 'dual') throw new Error('no engine cluster');
    expect(cluster.left.arcs).toEqual([{ from: 0.5, to: 8, color: 'green' }]);
    expect(cluster.left.redLines).toEqual([0.5, 8]);
    expect(oil.right.redLines).toEqual([15, 100]);
    // No flap indicator (the lever is on the floor), no EGT / fuel flow, no avionics master; the electric fuel
    // pump rocker; one ALT lamp; a key ignition.
    const kinds = PA38_PANEL.gauges.map((g) => g.kind);
    expect(kinds).not.toContain('flapLever');
    expect(kinds).not.toContain('flapLights');
    expect(PA38_PANEL.gauges.map((g) => g.id)).not.toContain('egtff');
    const switches = PA38_PANEL.switchRow.switches.map((s) => s.id);
    expect(switches).toContain('fuelPump');
    expect(switches).not.toContain('avionics');
    expect(PA38_PANEL.annunciator?.lamps?.map((l) => l.id)).toEqual(['alt']);
    expect(PA38_INSTRUMENT_SYSTEMS.lamps.map((l) => l.id)).toEqual(['alt']);
    expect(PA38_PANEL.ignition.kind).toBe('key');
    // Quadrant levers in the cockpit: carburettor heat at the left edge, throttle left, mixture right; the flap
    // lever on the floor.
    const levers = PA38_VISUAL.cockpit.engineControls.map((k) => [k.control, k.kind, k.pos[1]] as const);
    expect(levers.map((k) => k[0])).toEqual(['carbHeat', 'throttle', 'mixture']);
    expect(levers.every((k) => k[1] === 'lever')).toBe(true);
    expect(levers[0][2]).toBeLessThan(levers[1][2]);
    expect(levers[1][2]).toBeLessThan(levers[2][2]);
    expect(PA38_VISUAL.cockpit.flapControl.kind).toBe('floorLever');
  });

  it('the ALT light shows with no alternator output on a live bus, and not on a dead one', () => {
    const lamp = PA38_INSTRUMENT_SYSTEMS.lamps[0];
    const state = (busVoltage: number, alternatorAmps: number) =>
      ({ state: { electrical: { busVoltage, alternatorAmps } } }) as unknown as Parameters<typeof lamp.lit>[0];
    expect(lamp.lit(state(12.4, 0))).toBe(true);
    expect(lamp.lit(state(14.1, 12))).toBe(false);
    expect(lamp.lit(state(0, 0))).toBe(false);
  });

  it("the UI names the type's controls: tank selector without BOTH, the electric pump, carburettor heat", () => {
    const c = defaultControls();
    c.masterBattery = true;
    c.fuelSelector = 'off';
    expect(PA38_UI.starterAdvice(c, 0)).toMatch(/fuel selector is OFF/);
    c.fuelSelector = 'left';
    c.mixture = 1;
    expect(PA38_UI.starterAdvice(c, 0)).toBeNull();
    c.carbHeat = 1;
    expect(PA38_UI.switches.find((s) => s.id === 'carbHeat')?.read(c)).toBe('ON');
    c.fuelPump = true;
    expect(PA38_UI.switches.find((s) => s.id === 'fuelPump')?.read(c)).toBe('ON');
    // Hand flaps: no flap motor; the stall horn is electric and dead with the master off (POH 4.35).
    expect(PA38_AUDIO.flapMotor).toBe(false);
    expect(PA38_AUDIO.stallWarner.kind).toBe('electric');
    expect(PA38_AUDIO.stallWarner.needsBus).toBe(true);
  });

  it('full power on the ground sits in the cockpit level window of the C172S (-17 .. -9 dBFS), nothing clips', () => {
    // A static full-power run: 2300 rpm (POH 2200-2350), full throttle, the propeller loaded about 1.6 x its
    // cruise thrust, tip Mach 0.65 (1.83 m at 2300 rpm).
    const fullPower = { rpm: 2300, firing: 1, load: 1, throttle: 1, propLoad: 1.6, tipMach: 0.65 };
    const stems = new SynthHost(PA38_AUDIO).set(fullPower).render(4);
    const interior = interiorMix(stems, PA38_AUDIO);
    const level = dbfs(rms(interior, SR));
    console.log(`[pa38] full power interior ${level.toFixed(2)} dBFS RMS, peak ${dbfs(peak(interior.subarray(SR))).toFixed(2)} dBFS`);
    expect(level).toBeGreaterThan(-17);
    expect(level).toBeLessThan(-9);
    expect(dbfs(peak(interior.subarray(SR)))).toBeLessThan(-2);
  }, 30_000);

  it("the school data: the type's own id, speeds from the reference table, data only (not a school type)", () => {
    expect(PA38.id).toBe('pa38');
    expect(PA38.classRating).toBe('SEP');
    expect(PA38.vspeeds.Vne).toBe(PA38_REFERENCE.vne);
    expect(PA38.vspeeds.Vs0).toBe(PA38_REFERENCE.vs0);
    expect(PA38.vspeeds.Vy).toBe(PA38_REFERENCE.vy);
    expect(PA38.vspeeds.Vref).toBe(PA38_REFERENCE.vref);
    expect(Object.keys(PA38.vspeeds)).toHaveLength(22);
    expect(Object.keys(PA38.settings)).toHaveLength(11);
    expect(Object.keys(PA38.checklists)).toHaveLength(14);
    expect(PA38.flapDetentsDeg).toEqual([0, 21, 34]);
    expect(PA38.flapLeverForDeg[34]).toBe(1);
    expect(PA38.systems?.fuelSelector).not.toContain('both');
    expect(PA38.school?.syllabus).toBe(false);
  });
});
