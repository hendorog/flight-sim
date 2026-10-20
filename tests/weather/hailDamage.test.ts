// Hail damage to the airframe (sim/weather/hailDamage.ts) and its path through SimPhysics: nothing from small hail,
// growth with the stone size and the airspeed, determinism, the reset of a new flight, the resume snapshot (schema 5,
// and none from an older one). Each test logs its measured numbers.

import { describe, expect, it } from 'vitest';
import { quat } from '../../src/core/math';
import { defaultWeather, type StormCell, type WeatherSettings } from '../../src/core/types';
import { emptyLocalPrecip, type LocalPrecip } from '../../src/physics/weather/stormPrecip';
import { parseSnapshot, SNAPSHOT_SCHEMA } from '../../src/sim/resume';
import { SimPhysics } from '../../src/sim/SimPhysics';
import type { BladeElementFlightModel } from '../../src/physics';
import { weatherPresetById } from '../../src/sim/weatherPresets';
import {
  CRACK_STONE_J,
  DENT_STONE_J,
  HailDamage,
  hailDamageRates,
  MAX_CRACKS,
  SHATTER_LEVEL,
  type HailDamageRates,
} from '../../src/sim/weather/hailDamage';
import type { ScenarioId } from '../../src/core/context';

const report = (label: string, values: Record<string, number | string>) =>
  console.log(`[hail damage] ${label}: ${Object.entries(values).map(([k, v]) => `${k}=${typeof v === 'number' ? +v.toPrecision(4) : v}`).join('  ')}`);

const hail = (rate: number, max: number): LocalPrecip => ({ ...emptyLocalPrecip(), type: 'rain', rateMmH: 30, stormRainMmH: 30, hailMmH: rate, hailMaxMm: max });
const level = quat.identity();
/** The dent level the flight model's aerodynamics hold. */
const dents = (p: SimPhysics): number => (p.fm as BladeElementFlightModel).aero.leadingEdgeDamage;
const rates = (p: LocalPrecip, tas: number): HailDamageRates => hailDamageRates(p, tas, 0.05, 0, level, { dentJm2s: 0, crackJm2s: 0, cracksPerS: 0, maxWindscreenJ: 0 });

describe('hail damage rates', () => {
  it('are zero without hail and for small stones below the dent and crack energies', () => {
    expect(rates(emptyLocalPrecip(), 60)).toEqual({ dentJm2s: 0, crackJm2s: 0, cracksPerS: 0, maxWindscreenJ: 0 });
    // A 6 mm stone at 60 m/s: 0.5 x 0.10 g x 3600 = 0.18 J, below DENT_STONE_J.
    const small = rates(hail(12, 6), 60);
    expect(small).toEqual({ dentJm2s: 0, crackJm2s: 0, cracksPerS: 0, maxWindscreenJ: 0 });
    report('below threshold', { maxMm: 6, tas: 60, dentJ: DENT_STONE_J, crackJ: CRACK_STONE_J });
  });

  it('grow with the stone size and the airspeed', () => {
    let prev = 0;
    const sizes: Record<string, number> = {};
    for (const mm of [10, 15, 20, 30, 40, 60]) {
      const r = rates(hail(6, mm), 55);
      sizes[`${mm}mm`] = r.dentJm2s;
      expect(r.dentJm2s).toBeGreaterThanOrEqual(prev);
      prev = r.dentJm2s;
    }
    expect(prev).toBeGreaterThan(0);
    report('dent rate J/m^2/s at 55 m/s, 6 mm/h', sizes);
    prev = 0;
    const speeds: Record<string, number> = {};
    let crackPrev = 0;
    for (const tas of [0, 20, 40, 60, 80]) {
      const r = rates(hail(6, 30), tas);
      speeds[`${tas}ms`] = r.dentJm2s;
      speeds[`ws${tas}ms`] = r.crackJm2s;
      expect(r.dentJm2s).toBeGreaterThanOrEqual(prev);
      expect(r.crackJm2s).toBeGreaterThanOrEqual(crackPrev);
      prev = r.dentJm2s;
      crackPrev = r.crackJm2s;
    }
    report('dent and windscreen rates J/m^2/s, 30 mm stones, 6 mm/h', speeds);
    // Parked: the stones fall onto the windscreen, not onto the leading edges; 30 mm stones falling at 20 m/s stay
    // below the crack energy there, 60 mm ones do not.
    expect(rates(hail(6, 60), 0).dentJm2s).toBe(0);
    expect(rates(hail(6, 30), 0).crackJm2s).toBe(0);
    expect(rates(hail(6, 60), 0).crackJm2s).toBeGreaterThan(0);
  });

  it('accumulate monotonically, keep at most MAX_CRACKS cracks and are deterministic', () => {
    const a = new HailDamage(), b = new HailDamage();
    let last = 0;
    for (let k = 1; k <= 600; k++) {
      a.update(hail(8, 45), 60, 0.05, 0, level, 0.1 * k, 0.1);
      b.update(hail(8, 45), 60, 0.05, 0, level, 0.1 * k, 0.1);
      expect(a.state.leadingEdge).toBeGreaterThanOrEqual(last);
      last = a.state.leadingEdge;
    }
    expect(a.capture()).toEqual(b.capture());
    expect(a.state.crackCount).toBe(MAX_CRACKS);
    expect(a.state.leadingEdge).toBeGreaterThan(0.5);
    expect(a.state.windscreen).toBeGreaterThan(SHATTER_LEVEL);
    report('60 s at 8 mm/h, 45 mm stones, 60 m/s', { leadingEdge: a.state.leadingEdge, windscreen: a.state.windscreen, cracks: a.state.crackCount });
    a.reset();
    expect(a.state.leadingEdge).toBe(0);
    expect(a.state.crackCount).toBe(0);
  });
});

// ------------------------------------------------------------------------------------------- through SimPhysics

/** The Thunderstorm preset's conditions (its CAPE grows the hail) with one explicit cell over `north`, `east`. */
function stormOver(north: number, east: number): WeatherSettings {
  const cell: StormCell = { northM: north, eastM: east, radiusM: 3000, topM: 11_000, intensity: 1, motionDeg: 0, motionKt: 0 };
  return { ...defaultWeather(), ...weatherPresetById('thunderstorm')!.settings, storms: [cell] };
}

function flyIn(id: ScenarioId, seconds: number): { p: SimPhysics; w: WeatherSettings } {
  const probe = new SimPhysics({ weather: defaultWeather() });
  probe.reset(id);
  const s = probe.state;
  const w = stormOver(s.position.x, s.position.y);
  const p = new SimPhysics({ weather: w });
  p.reset(id, w);
  p.step(seconds);
  return { p, w };
}

describe('hail damage in SimPhysics', () => {
  it('is zero in the default weather and the flight model keeps the clean leading edges', () => {
    const p = new SimPhysics({ weather: defaultWeather() });
    p.reset('cruise');
    p.step(5);
    expect(p.hailDamage.state.leadingEdge).toBe(0);
    expect(p.hailDamage.state.windscreen).toBe(0);
    expect(dents(p)).toBe(0);
  });

  it('accumulates under a hail core, is the same on a second run, and resets with the scenario', () => {
    const a = flyIn('runway', 20);
    const b = flyIn('runway', 20);
    const d = a.p.hailDamage.state;
    report('parked 20 s under the core', { windscreen: d.windscreen, leadingEdge: d.leadingEdge, cracks: d.crackCount });
    expect(d.windscreen).toBeGreaterThan(0);
    expect(a.p.hailDamage.capture()).toEqual(b.p.hailDamage.capture());
    const c = flyIn('downwind', 10);
    const dc = c.p.hailDamage.state;
    report('downwind 10 s under the core', { windscreen: dc.windscreen, leadingEdge: dc.leadingEdge, cracks: dc.crackCount, aero: dents(c.p), crashed: String(c.p.state.crashed) });
    expect(dc.leadingEdge).toBeGreaterThan(0);
    expect(dents(c.p)).toBe(dc.leadingEdge);
    c.p.reset('downwind', c.w);
    expect(c.p.hailDamage.state.leadingEdge).toBe(0);
    expect(c.p.hailDamage.state.crackCount).toBe(0);
    expect(dents(c.p)).toBe(0);
  }, 60_000);

  it('goes through the resume snapshot, and an older snapshot resumes with none', () => {
    const { p, w } = flyIn('downwind', 10);
    const snap = p.captureSnapshot({ weather: w, cameraMode: 'cockpit', quality: 'high', renderScale: null, resume: true, now: 1_800_000_000_000 });
    expect(snap.schema).toBe(SNAPSHOT_SCHEMA);
    const back = parseSnapshot(JSON.stringify(snap))!;
    expect(back.damage).toEqual(p.hailDamage.capture());
    const q = new SimPhysics({ weather: { ...back.weather } });
    q.restore(back);
    expect(q.hailDamage.capture()).toEqual(p.hailDamage.capture());
    expect(dents(q)).toBe(p.hailDamage.state.leadingEdge);
    // Schema 4: no damage block.
    const old = JSON.parse(JSON.stringify(snap));
    delete old.damage;
    old.schema = 4;
    const oldBack = parseSnapshot(JSON.stringify(old))!;
    expect(oldBack).not.toBeNull();
    expect(oldBack.damage).toEqual({ windscreen: 0, leadingEdge: 0, windscreenDoseJm2: 0, leadingEdgeDoseJm2: 0, crackDue: 0, cracks: [] });
    const r = new SimPhysics({ weather: { ...oldBack.weather } });
    r.restore(oldBack);
    expect(r.hailDamage.state.leadingEdge).toBe(0);
    expect(dents(r)).toBe(0);
    // A malformed block is dropped (no damage), the flight kept.
    const bad = JSON.parse(JSON.stringify(snap));
    bad.damage.windscreen = 7;
    expect(parseSnapshot(JSON.stringify(bad))!.damage!.windscreen).toBe(0);
  }, 60_000);
});
