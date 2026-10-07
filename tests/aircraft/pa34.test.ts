// The Piper PA-34-200 Seneca I's presentation (src/aircraft/pa34/{visual,panel,ui,audio,training}.ts): the airframe
// builds as the simulator builds it with two engines, with outward skins and no NaN, the data sheet's span and
// length, counter-rotating propellers whose handedness comes from PropVisualDef.rotation only, and a render cost
// inside the twin budget; the airframe is plain data; every gauge, switch and hotspot of the panel lies inside the
// face the cockpit shows, with no overlap and nothing under a control wheel boot; the panel carries the handbook's
// markings (blue line, red radial, the twin gauges); the sound profile is plain data and two engines at full power
// sit in the cockpit level window of the C172S; the school data is plain JSON with the type's own speeds and the
// MEP class. Numbers come from the type's geometry and reference files (G-pa34) and the data sheet they cite.

import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PA34_AUDIO } from '../../src/aircraft/pa34/audio';
import { PA34_GEOMETRY } from '../../src/aircraft/pa34/geometry';
import { PA34_INSTRUMENT_SYSTEMS, PA34_PANEL, PA34_PANEL_PX_RECT } from '../../src/aircraft/pa34/panel';
import PA34_PRESENTATION from '../../src/aircraft/pa34/presentation';
import { PA34_REFERENCE } from '../../src/aircraft/pa34/reference';
import { PA34 } from '../../src/aircraft/pa34/training';
import { PA34_UI } from '../../src/aircraft/pa34/ui';
import { PA34_VISUAL } from '../../src/aircraft/pa34/visual';
import { loadAirframeVisual, loadPresentation } from '../../src/aircraft/registry';
import { defaultControls, setEngineControl } from '../../src/core/types';
import { buildHotspots } from '../../src/instruments/hotspots';
import { panelLayoutProblems } from '../../src/instruments/panelLayout';
import { AircraftVisual } from '../../src/render/aircraft/AircraftVisual';
import { createFuselageShapes, sectionHalfWidth } from '../../src/render/aircraft/fuselage';
import { interiorMix, dbfs } from '../audio/mixModel';
import { peak, rms, SR, SynthHost } from '../audio/workletHost';
import { blankDocument, bodyBox, facing, fakeContext, nonFinite, renderCost, worldMeshes } from './meshChecks';

vi.setConfig({ testTimeout: 60_000 });

beforeAll(() => {
  vi.stubGlobal('document', blankDocument());
});
afterAll(() => {
  vi.unstubAllGlobals();
});

/** The aircraft as the chase camera sees it, 13 m away, in cruise (wheels off the ground) or parked at idle. */
function fly(airframe: typeof PA34_VISUAL | undefined, engines: number, onGround = false): { visual: AircraftVisual; ctx: ReturnType<typeof fakeContext> } {
  const ctx = fakeContext(engines);
  if (!onGround) {
    for (const p of ctx.state.propellers) p.rpm = 2400;
    for (const w of ctx.state.wheels) Object.assign(w, { compression: 0, onGround: false });
  }
  const visual = new AircraftVisual({ asyncBake: false, ...(airframe ? { airframe, panelDef: PA34_PANEL } : {}) });
  visual.init(ctx);
  ctx.camera.position.set(3, 3, 12);
  ctx.camera.updateMatrixWorld(true);
  ctx.aircraftRoot.updateMatrixWorld(true);
  visual.update(1 / 60, ctx);
  return { visual, ctx };
}

describe('Piper PA-34-200 Seneca I presentation', () => {
  it('is what the registry loads, on the main thread and in the livery worker', async () => {
    expect(await loadPresentation('pa34')).toBe(PA34_PRESENTATION);
    expect(await loadAirframeVisual('pa34')).toBe(PA34_VISUAL);
    expect(PA34_PRESENTATION.id).toBe('pa34');
    expect(PA34_VISUAL.id).toBe('pa34');
    expect(PA34_PANEL.id).toBe('pa34');
  });

  it('the airframe and the sound are plain data (structuredClone and JSON round-trip)', () => {
    expect(structuredClone(PA34_VISUAL)).toEqual(PA34_VISUAL);
    expect(JSON.parse(JSON.stringify(PA34_VISUAL))).toEqual(PA34_VISUAL);
    expect(structuredClone(PA34_AUDIO)).toEqual(PA34_AUDIO);
    expect(JSON.parse(JSON.stringify(PA34)) as unknown).toEqual(PA34);
  });

  it('builds as the simulator builds it with two engines: no NaN, outward skins, the data sheet span and length', () => {
    const { visual } = fly(PA34_VISUAL, 2);
    expect(visual.root.name).toBe('pa34');
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
    // s.2.1 span 11.85 m; s.2.4 length 8.72 m from the nose tip (FS -27.5) to the rudder's trailing edge (FS 316).
    const box = bodyBox(visual.root);
    expect(Math.abs(box.y1 - box.y0 - PA34_GEOMETRY.wing.span)).toBeLessThan(0.02);
    expect(Math.abs(box.x1 - box.x0 - PA34_GEOMETRY.fuselage.length)).toBeLessThan(0.03);
    // The cockpit view sits at the geometry's eye.
    const eye = PA34_GEOMETRY.fuselage.pilotEye;
    expect(visual.pilotEye.distanceTo(new THREE.Vector3(eye.y, -eye.z, -eye.x))).toBeLessThan(1e-9);
    visual.dispose();
  }, 120_000);

  it('two nacelles and counter-rotating propellers on the geometry discs: handedness from PropVisualDef.rotation only', () => {
    expect(PA34_VISUAL.props).toHaveLength(2);
    expect(PA34_VISUAL.nacelles.map((n) => n.side)).toEqual([-1, 1]);
    PA34_VISUAL.props.forEach((p, i) => {
      const g = PA34_GEOMETRY.propellers[i];
      expect(p.hub).toEqual([g.hub.x, g.hub.y, g.hub.z]);
      expect(p.diameter).toBe(g.diameter);
      expect(p.blades).toBe(2);
      // Left clockwise (+1), right counter-clockwise (-1) seen from the cockpit (s.1, s.5).
      expect(p.rotation).toBe(g.rotation);
      expect(p.variablePitch).toBe(true);
    });
    expect(PA34_VISUAL.props[0].rotation).toBe(-PA34_VISUAL.props[1].rotation);
    // The visual reads the spin angle straight from the state: a right propeller turning the other way counts down
    // and the model follows it unchanged.
    const { visual, ctx } = fly(PA34_VISUAL, 2);
    expect(nonFinite(visual.root)).toBe(0);
    ctx.state.propellers[1].rotation = -0.7;
    visual.update(1 / 60, ctx);
    expect(nonFinite(visual.root)).toBe(0);
    visual.dispose();
    // Retractable gear: every leg folds, the mains inboard, the nose forward; the landing lights ride on the nose leg.
    for (const w of PA34_VISUAL.gear) expect(w.retract).toBeDefined();
    expect(PA34_VISUAL.gear[1].retract!.angle).toBeLessThan(0);
    expect(PA34_VISUAL.gear[2].retract!.angle).toBeGreaterThan(0);
    expect(PA34_VISUAL.lamps.filter((l) => l.parent === 'noseGear').map((l) => l.id).sort()).toEqual(['landing', 'taxi']);
  }, 120_000);

  it("the compass hangs inside the windscreen, in the pilot's view over the glareshield", () => {
    const [cx, , cz] = PA34_VISUAL.cockpit.compass!.pos;
    // The skin's top line (the fuselage keys' zTop, linear between keys) over the compass from its bracket's rear to
    // its housing's front; cockpit.ts draws the bracket top 0.125 m and the housing's top 0.083 m above pos.
    const keys = PA34_VISUAL.fuselage.keys;
    const topAt = (x: number): number => {
      const i = keys.findIndex((k) => k[0] <= x);
      const [a, b] = [keys[i - 1], keys[i]];
      return a[1] + ((x - a[0]) / (b[0] - a[0])) * (b[1] - a[1]);
    };
    for (const x of [cx + 0.005, cx + 0.05]) expect(cz - 0.125, `bracket top under the skin at x ${x}`).toBeGreaterThan(topAt(x));
    // Above the glareshield, below the top of a 30 degree half-height view straight ahead.
    const eye = PA34_GEOMETRY.fuselage.pilotEye;
    const up = Math.atan2(eye.z - (cz - 0.04), cx - eye.x) / (Math.PI / 180);
    expect(up).toBeGreaterThan(8);
    expect(up).toBeLessThan(25);
  });

  it('every cabin console stays inside the fuselage skin (nothing pokes through the belly or the sides)', () => {
    // A corner of a console box outside the skin shows from outside as a black block (review: the aft baggage box
    // under the tail cone's rounding belly).
    const { outer } = createFuselageShapes(PA34_VISUAL);
    for (const [i, c] of (PA34_VISUAL.cockpit.consoles ?? []).entries()) {
      const y = Math.max(Math.abs(c.min[1]), Math.abs(c.max[1]));
      for (const x of [c.min[0], c.max[0]]) {
        for (const z of [c.min[2], c.max[2]]) {
          expect(sectionHalfWidth(outer, x, z) - y, `console ${i} corner x ${x.toFixed(2)} z ${z.toFixed(2)}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('costs at most +30 draw calls and +60 000 triangles over the Cessna 172S in the chase view', () => {
    for (const onGround of [false, true]) {
      const cessna = fly(undefined, 1, onGround);
      const twin = fly(PA34_VISUAL, 2, onGround);
      const a = renderCost(cessna.visual.root);
      const b = renderCost(twin.visual.root);
      console.log(`[pa34] ${onGround ? 'parked' : 'cruise'}: c172s ${a.draws} draws ${a.triangles} triangles; pa34 ${b.draws} draws ${b.triangles} triangles`);
      expect(b.draws - a.draws).toBeLessThanOrEqual(30);
      expect(b.triangles - a.triangles).toBeLessThanOrEqual(60_000);
      cessna.visual.dispose();
      twin.visual.dispose();
    }
  }, 180_000);

  it('every gauge, switch and hotspot lies inside the face the cockpit shows, without overlap', () => {
    expect(PA34_VISUAL.cockpit.panel.pxRect).toBe(PA34_PANEL_PX_RECT);
    expect(panelLayoutProblems(PA34_PANEL, PA34_PANEL_PX_RECT, buildHotspots(PA34_PANEL))).toEqual([]);
    const r = PA34_PANEL_PX_RECT;
    for (const h of buildHotspots(PA34_PANEL)) {
      expect(h.x - h.hw, h.id).toBeGreaterThanOrEqual(r.x);
      expect(h.x + h.hw, h.id).toBeLessThanOrEqual(r.x + r.w);
      expect(h.y - h.hh, h.id).toBeGreaterThanOrEqual(r.y);
      expect(h.y + h.hh, h.id).toBeLessThanOrEqual(r.y + r.h);
    }
    // 2000 px/m like the C172S, so the instruments are drawn at their real size.
    expect(r.w / PA34_VISUAL.cockpit.panel.width).toBeCloseTo(2000, 9);
  });

  it("the panel carries the handbook's markings and the twin's gauges and switches", () => {
    const asi = PA34_PANEL.gauges.find((g) => g.kind === 'asi');
    if (asi?.kind !== 'asi') throw new Error('no ASI');
    // s.7 (AFM, in knots): white 60-109, green 66-165, yellow 165-188, red line 188, red radial 69, blue line 91.
    expect(asi.marks.arcs).toEqual([
      { from: 66, to: 165, color: 'green' },
      { from: 165, to: 188, color: 'yellow' },
      { from: 60, to: 109, color: 'white', inner: true },
    ]);
    expect(asi.marks.redLine).toBe(PA34_REFERENCE.vne);
    expect(asi.marks.blueLine).toBe(91);
    expect(asi.marks.redRadial).toBe(69);
    // Twin-needle manifold pressure, tachometer (green 500-2200 and 2400-2700, red arc 2200-2400, red line 2700) and
    // fuel flow (red line 19.2 gal/h), s.4.
    const twin = (id: string) => {
      const g = PA34_PANEL.gauges.find((x) => x.id === id);
      if (g?.kind !== 'twinNeedle') throw new Error(`${id} is not a twin-needle gauge`);
      return g;
    };
    expect(twin('manifold').scale.arcs ?? []).toEqual([]);
    expect(twin('tach').scale.arcs).toEqual([
      { from: 5, to: 22, color: 'green' },
      { from: 22, to: 24, color: 'red' },
      { from: 24, to: 27, color: 'green' },
    ]);
    expect(twin('tach').scale.redLines).toEqual([27]);
    expect(twin('fuelFlow').scale.redLines).toEqual([19.2]);
    // Per-engine oil and CHT clusters, two load meters, gear lights with the selector and the emergency knob.
    const ids = PA34_PANEL.gauges.map((g) => g.id);
    for (const id of ['oilLeft', 'oilRight', 'chtLeft', 'chtRight', 'loadLeft', 'loadRight', 'gear', 'gearEmergency', 'fuel', 'suction']) expect(ids).toContain(id);
    const gear = PA34_PANEL.gauges.find((g) => g.kind === 'gearLights');
    expect(gear?.kind === 'gearLights' && gear.lever).toBeTruthy();
    const oil = PA34_PANEL.gauges.find((g) => g.id === 'oilLeft');
    if (oil?.kind !== 'dual') throw new Error('no oil gauge');
    expect(oil.right.redLines).toEqual([25, 90]);
    // No flap indicator (the lever is on the floor); magneto toggles; per-engine alternators and pumps.
    const kinds = PA34_PANEL.gauges.map((g) => g.kind);
    expect(kinds).not.toContain('flapLever');
    expect(kinds).not.toContain('flapLights');
    expect(PA34_PANEL.ignition).toEqual({ kind: 'toggles', at: PA34_PANEL.ignition.at, engines: 2 });
    const switches = PA34_PANEL.switchRow.switches.map((s) => s.id);
    expect(switches).toEqual(expect.arrayContaining(['battery', 'leftAlternator', 'rightAlternator', 'leftFuelPump', 'rightFuelPump']));
    expect(switches).not.toContain('avionics');
    // The 3D gear selector stands where the panel draws its slot; six quadrant levers and two cowl flap levers.
    const levers = PA34_VISUAL.cockpit.engineControls;
    expect(levers.filter((k) => k.control !== 'cowlFlaps').map((k) => `${k.control}${k.engine}`)).toEqual(['throttle0', 'throttle1', 'propeller0', 'propeller1', 'mixture0', 'mixture1']);
    expect(levers.filter((k) => k.control === 'cowlFlaps')).toHaveLength(2);
    expect(PA34_VISUAL.cockpit.flapControl.kind).toBe('floorLever');
    expect(PA34_VISUAL.cockpit.gearLever).toBeDefined();
  });

  it('a left switch acts on the left engine only; the alternator lights need a live bus', () => {
    const c = defaultControls({ engineCount: 2, controlDefaults: {} });
    const lPump = PA34_PANEL.switchRow.switches.find((s) => s.id === 'leftFuelPump')!;
    const rPump = PA34_PANEL.switchRow.switches.find((s) => s.id === 'rightFuelPump')!;
    lPump.toggle(c);
    expect(lPump.on(c)).toBe(true);
    expect(rPump.on(c)).toBe(false);
    const [left, right] = PA34_INSTRUMENT_SYSTEMS.lamps;
    const inputs = (busVoltage: number, alternators: number[]) =>
      ({ state: { electrical: { busVoltage, alternators } } }) as unknown as Parameters<typeof left.lit>[0];
    expect(left.lit(inputs(12.4, [0, 20]))).toBe(true);
    expect(right.lit(inputs(12.4, [0, 20]))).toBe(false);
    expect(left.lit(inputs(14.1, [18, 20]))).toBe(false);
    expect(left.lit(inputs(0, [0, 0]))).toBe(false);
  });

  it("the UI names the twin's controls per engine", () => {
    const c = defaultControls({ engineCount: 2, controlDefaults: { fuelSelector: 'on' } });
    c.masterBattery = true;
    c.mixture = 1;
    expect(PA34_UI.starterAdvice(c, 1)).toBeNull();
    setEngineControl(c, 1, 'fuelSelector', 'off');
    expect(PA34_UI.starterAdvice(c, 1)).toMatch(/right fuel selector is OFF/);
    expect(PA34_UI.starterAdvice(c, 0)).toBeNull();
    setEngineControl(c, 0, 'fuelSelector', 'crossfeed');
    expect(PA34_UI.switches.find((s) => s.id === 'fuelSelectorL')?.read(c)).toBe('CROSSFEED');
    expect(PA34_UI.switches.find((s) => s.id === 'fuelSelectorR')?.read(c)).toBe('OFF');
    setEngineControl(c, 0, 'propeller', 0.02);
    expect(PA34_UI.hud.levers.find((l) => l.label === 'PROP L')?.text?.(c, undefined as never)).toBe('FEATH');
    // Hand flaps: no flap motor; a gear pump and horn; the electric stall warner is dead with the master off.
    expect(PA34_AUDIO.flapMotor).toBe(false);
    expect(PA34_AUDIO.gear?.pump).toBe(true);
    expect(PA34_AUDIO.gear?.warningHorn).toBe(true);
    expect(PA34_AUDIO.stallWarner).toMatchObject({ kind: 'electric', needsBus: true });
  });

  it('two engines at full power on the ground sit in the cockpit level window of the C172S (-17 .. -9 dBFS)', () => {
    expect(PA34_AUDIO.engines.map((e) => e.engine.level)).toEqual([0.71, 0.71]);
    // Static full power: 2650 rpm (s.5), full throttle, each propeller loaded about 1.6 x its cruise thrust, tip
    // Mach 0.79 (1.93 m at 2650 rpm); the right engine a few rpm off, as two engines are.
    const full = { rpm: 2650, firing: 1, load: 1, throttle: 1, propLoad: 1.6, tipMach: 0.79 };
    const stems = new SynthHost(PA34_AUDIO).set(full).setEngine(1, { ...full, rpm: 2630 }).render(4);
    const interior = interiorMix(stems, PA34_AUDIO);
    const level = dbfs(rms(interior, SR));
    console.log(`[pa34] full power interior ${level.toFixed(2)} dBFS RMS, peak ${dbfs(peak(interior.subarray(SR))).toFixed(2)} dBFS`);
    expect(level).toBeGreaterThan(-17);
    expect(level).toBeLessThan(-9);
    expect(dbfs(peak(interior.subarray(SR)))).toBeLessThan(-2);
  }, 30_000);

  it("the school data: the type's own id, speeds from the reference table, MEP, data only (not a school type)", () => {
    expect(PA34.id).toBe('pa34');
    expect(PA34.classRating).toBe('MEP');
    expect(PA34.systems?.engines).toBe(2);
    expect(PA34.vspeeds.Vne).toBe(PA34_REFERENCE.vne);
    expect(PA34.vspeeds.Vs0).toBe(PA34_REFERENCE.vs0);
    expect(PA34.vspeeds.Vy).toBe(PA34_REFERENCE.vy);
    expect(PA34.vspeeds.Vref).toBe(PA34_REFERENCE.vref);
    expect(PA34.vspeedsExt).toMatchObject({ Vmca: 69, Vyse: 91, Vsse: 78 });
    expect(Object.keys(PA34.vspeeds)).toHaveLength(22);
    expect(Object.keys(PA34.settings)).toHaveLength(11);
    expect(Object.keys(PA34.checklists)).toHaveLength(14);
    expect(PA34.flapDetentsDeg).toEqual([0, 10, 25, 40]);
    expect(PA34.flapLeverForDeg[40]).toBe(1);
    expect(PA34.systems?.fuelSelector).toEqual(expect.arrayContaining(['on', 'off', 'crossfeed']));
    expect(PA34.school?.syllabus).toBe(false);
  });
});
