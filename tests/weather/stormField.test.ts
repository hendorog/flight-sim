// Storm cells derived from the conditions (physics/weather/stormField.ts): the convective activity and its terms,
// the lattice's determinism and its time base (the weather clock, unaffected by a scenario reset or a resume), the
// regional factor, the activity at a cell's birth, the continuity of the up-to-MAX_STORMS selection in position and
// in time, the rank fade, the agreement of the physics and the render selections (tops included), the explicit
// `storms` override, the lightning schedule of derived cells, the training weather line and the cost of env.wind.
// Each test logs its measured numbers.

import * as THREE from 'three';
import { describe, expect, test } from 'vitest';
import { DEG, KT, type Vec3 } from '../../src/core/math';
import { windVeer } from '../../src/physics/weather/boundaryLayer';
import { defaultWeather, type WeatherSettings } from '../../src/core/types';
import { NO_STORMS, stormCentreAt } from '../../src/core/weatherFields';
import { createEnvironment, type TerrainProvider } from '../../src/physics/environment';
import {
  CLOCK_REUSE_S,
  FADE_END_M,
  FADE_START_M,
  REGION_MAX,
  REGION_MIN,
  SITE_SPACING_M,
  StormField,
  convectiveState,
  emptyConvectiveState,
  proceduralStorms,
  regionFactor,
  stormClockS,
  stormSteering,
  type ActiveStorm,
} from '../../src/physics/weather/stormField';
import { CELL_TOP_MIN_M, cellTopM } from '../../src/physics/weather/convection';
import { MAX_STORMS } from '../../src/core/weatherFields';
import { StormCellEffect } from '../../src/render/weather/StormCellEffect';
import { advanceTimeOfDay } from '../../src/sim/clock';
import { SimPhysics } from '../../src/sim/SimPhysics';
import { WEATHER_PRESETS, applyWeatherPreset, restoreWeather, weatherPresetById, withoutExtras } from '../../src/sim/weatherPresets';
import { strikesBetween, type Strike } from '../../src/sim/weather/lightning';
import { WEATHER_PRESETS as LESSON_PRESETS, buildWeather, weatherLine } from '../../src/training/content/weatherPresets';
import { mulberry32 } from '../../src/physics/weather/random';
import type { SimContext } from '../../src/core/context';

const ELEV = 120;
const report = (label: string, values: Record<string, number | string>) =>
  console.log(`[stormField] ${label}: ${Object.entries(values).map(([k, v]) => `${k}=${typeof v === 'number' ? +v.toPrecision(4) : v}`).join('  ')}`);
const flatTerrain = (): TerrainProvider => ({ height: () => ELEV, normal: () => ({ x: 0, y: 0, z: -1 }), surface: () => 'grass' });
const activity = (w: WeatherSettings): number => convectiveState(w, emptyConvectiveState()).activity;
const thunderstorm = (): WeatherSettings => applyWeatherPreset(defaultWeather(), weatherPresetById('thunderstorm')!);
/** The cells' centres, ids and shares, rounded to 1e-6 m for comparisons. */
const snapshot = (cells: readonly ActiveStorm[], t: number) =>
  cells.map((c) => {
    const p = stormCentreAt(c, t, { north: 0, east: 0 });
    return { id: c.id, n: +p.north.toFixed(6), e: +p.east.toFixed(6), r: c.radiusM, top: c.topM, i: c.intensity, w: c.weight, core: c.core, anvil: c.anvil, rain: c.rain, flash: c.flash, wind: c.wind };
  });

describe('convective activity', () => {
  test('0 for defaultWeather(), every free-flight preset but Thunderstorm, and every lesson preset', () => {
    expect(activity(defaultWeather())).toBe(0);
    for (const p of WEATHER_PRESETS) {
      const a = activity(applyWeatherPreset(defaultWeather(), p));
      report(`preset ${p.id}`, { activity: a });
      if (p.id === 'thunderstorm') expect(a).toBe(1);
      else expect(a).toBe(0);
    }
    // A lesson's weather is built on withoutExtras(player) whatever the player flew in, and has the cells off.
    for (const player of [defaultWeather(), thunderstorm()]) {
      for (const lp of Object.values(LESSON_PRESETS)) {
        const w = buildWeather({ preset: lp.id }, withoutExtras(player), mulberry32(3));
        expect(activity({ ...w, storms: undefined }), lp.id).toBe(0);
        expect(proceduralStorms(w)).toBe(false);
        expect(new StormField().select(w, 0, 0, 0)).toHaveLength(0);
      }
    }
  });

  test('ordinary fair-weather cumulus gives 0 on a warm summer afternoon', () => {
    const w = { ...defaultWeather(), timeOfDay: 15, isaDeviation: 10 };
    const s = convectiveState(w, emptyConvectiveState());
    report('fair cumulus, 15:00, ISA+10', { activity: s.activity, cape: s.capeJkg, depth: s.depth });
    expect(s.activity).toBe(0);
  });

  test('rises with temperature, layer depth and afternoon sun; falls with the cloud base; decks suppress it', () => {
    const ts = thunderstorm();
    const series = (vary: (v: number) => Partial<WeatherSettings>, values: number[]) => values.map((v) => activity({ ...ts, ...vary(v) }));
    const nonDecreasing = (a: number[]) => a.every((x, i) => i === 0 || x >= a[i - 1]);
    const isa = series((v) => ({ isaDeviation: v }), [-15, -10, -5, -2, 0, 2, 4, 6, 8, 12]);
    const depth = series((v) => ({ cloudTopM: ts.cloudBaseM + v, cloudType: 'cumulus' }), [600, 1000, 1400, 1800, 2200, 2600, 3000]);
    const base = series((v) => ({ cloudBaseM: v, cloudTopM: v + 1700 }), [600, 900, 1200, 1500, 1800, 2100]);
    const morning = series((v) => ({ timeOfDay: v }), [5, 7, 9, 10, 11, 12, 13]);
    const evening = series((v) => ({ timeOfDay: v }), [15, 17, 18, 19, 20, 21, 23]);
    const cover = series((v) => ({ cloudCover: v }), [0, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5]);
    report('activity vs ISA deviation -15..12 K', { values: isa.map((x) => x.toFixed(2)).join(' ') });
    report('activity vs layer depth 600..3000 m (cumulus)', { values: depth.map((x) => x.toFixed(2)).join(' ') });
    report('activity vs cloud base 600..2100 m', { values: base.map((x) => x.toFixed(2)).join(' ') });
    report('activity vs time 05..13 h', { values: morning.map((x) => x.toFixed(2)).join(' ') });
    report('activity vs time 15..23 h', { values: evening.map((x) => x.toFixed(2)).join(' ') });
    expect(nonDecreasing(isa)).toBe(true);
    expect(isa[0]).toBe(0);
    expect(nonDecreasing(depth)).toBe(true);
    expect(depth[0]).toBe(0);
    expect(nonDecreasing(base.slice().reverse())).toBe(true);
    expect(base[base.length - 1]).toBe(0);
    expect(nonDecreasing(morning)).toBe(true);
    expect(morning[0]).toBe(0);
    expect(nonDecreasing(evening.slice().reverse())).toBe(true);
    expect(evening[evening.length - 1]).toBe(0);
    expect(nonDecreasing(cover)).toBe(true);
    expect(cover[0]).toBe(0);
    // Winter: the low sun leaves the heating term near 0 at the same hour.
    const winter = activity({ ...ts, dayOfYear: 355 });
    report('winter (day 355) at 15:00', { activity: winter });
    expect(winter).toBeLessThan(0.05);
    // Cloud type: towering >= cumulus >= auto (at cover 0.5), the decks 0.
    const type = (t: WeatherSettings['cloudType']) => activity({ ...ts, cloudType: t, isaDeviation: 0 });
    report('activity by type at ISA', { towering: type('towering'), cumulus: type('cumulus'), auto: type('auto'), stratus: type('stratus') });
    expect(type('towering')).toBeGreaterThanOrEqual(type('cumulus'));
    expect(type('cumulus')).toBeGreaterThanOrEqual(type('auto'));
    expect(type('auto')).toBeGreaterThan(0);
    for (const deck of ['stratus', 'stratocumulus', 'nimbostratus'] as const) expect(activity({ ...ts, cloudType: deck })).toBe(0);
  });
});

describe('depth and cover terms', () => {
  test("'towering' gives D = 1 at any layer depth; auto and cumulus keep the measured depth", () => {
    const ts = thunderstorm();
    const depthTerm = (type: WeatherSettings['cloudType'], depth: number) => convectiveState({ ...ts, cloudType: type, cloudTopM: ts.cloudBaseM + depth }, emptyConvectiveState()).depth;
    for (const depth of [200, 600, 1100, 1700]) expect(depthTerm('towering', depth)).toBe(1);
    // 1.6 x 1100 m = 1760 m drawn: 0; 1.6 x 2600 m = 4160 m: 1.
    for (const type of ['auto', 'cumulus'] as const) {
      expect(depthTerm(type, 1100)).toBe(0);
      expect(depthTerm(type, 2600)).toBe(1);
    }
    // From the pause menu: the default weather (1100 m layer) with towering cumulus, a warm afternoon and a low base.
    const menu = { ...defaultWeather(), cloudType: 'towering' as const, isaDeviation: 8, timeOfDay: 15, cloudBaseM: 900, cloudTopM: 2000 };
    const a = activity(menu);
    report('menu: default layer depth, towering, ISA+8, 15:00, base 900 m', { activity: a });
    expect(a).toBe(1);
  });

  test('the cover term is 0 at cover 0.05 and 1 from cover 0.25', () => {
    const ts = thunderstorm();
    const c = (cover: number) => convectiveState({ ...ts, cloudCover: cover }, emptyConvectiveState()).cover;
    report('cover term at 0.05, 0.1, 0.15, 0.2, 0.25, 0.3', { values: [0.05, 0.1, 0.15, 0.2, 0.25, 0.3].map((v) => c(v).toFixed(3)).join(' ') });
    expect(c(0.05)).toBe(0);
    expect(c(0.25)).toBe(1);
    expect(c(0.3)).toBe(1);
    expect(ts.cloudCover).toBe(0.3);
  });
});

describe('regional factor', () => {
  test('deterministic, within 0.5..1.5, varying over about 60 km', () => {
    let lo = Infinity;
    let hi = -Infinity;
    let low = 0;
    let high = 0;
    let n = 0;
    let near = 0;
    let far = 0;
    for (let x = -300_000; x <= 300_000; x += 5000) {
      for (let y = -300_000; y <= 300_000; y += 5000) {
        const v = regionFactor(x, y);
        expect(regionFactor(x, y)).toBe(v);
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
        if (v < 0.8) low++;
        if (v > 1.2) high++;
        near += Math.abs(regionFactor(x + 5000, y) - v);
        far += Math.abs(regionFactor(x + 30_000, y) - v);
        n++;
      }
    }
    report('regional factor over a 600 km square, 5 km grid', { min: lo, max: hi, shareBelow08: low / n, shareAbove12: high / n, meanStep5km: near / n, meanStep30km: far / n });
    expect(lo).toBeGreaterThanOrEqual(REGION_MIN);
    expect(hi).toBeLessThanOrEqual(REGION_MAX);
    expect(low / n).toBeGreaterThan(0.1);
    expect(high / n).toBeGreaterThan(0.1);
    expect(far / n).toBeGreaterThan(3 * (near / n));
  });

  test('more cells over a high-factor site than over a low-factor one', () => {
    // The highest and lowest factor among the lattice sites of a 300 km square.
    let best = { v: -Infinity, n: 0, e: 0 };
    let worst = { v: Infinity, n: 0, e: 0 };
    for (let i = -10; i <= 10; i++) {
      for (let j = -10; j <= 10; j++) {
        const v = regionFactor(i * SITE_SPACING_M, j * SITE_SPACING_M);
        if (v > best.v) best = { v, n: i * SITE_SPACING_M, e: j * SITE_SPACING_M };
        if (v < worst.v) worst = { v, n: i * SITE_SPACING_M, e: j * SITE_SPACING_M };
      }
    }
    const count = (p: { n: number; e: number }) => {
      const w = { ...thunderstorm(), windSpeedKt: 0 };
      const f = new StormField();
      let sum = 0;
      for (let m = 0; m < 24 * 60; m += 5) {
        w.dayOfYear = 150 + Math.floor(m / 60);
        w.timeOfDay = 15 + (m % 60) / 60;
        for (const c of f.select(w, 0, p.n, p.e)) if (Math.hypot(c.northM - p.n, c.eastM - p.e) < 15_000) sum += c.core;
      }
      return sum;
    };
    const hiCount = count(best);
    const loCount = count(worst);
    report('core share summed within 15 km, 15:00-16:00 on 24 days, calm', { highFactor: best.v, highSum: hiCount, lowFactor: worst.v, lowSum: loCount });
    expect(hiCount).toBeGreaterThan(1.5 * loCount);
  });
});

describe('activity at the birth of a cell', () => {
  test('evening decay stops births: a cell keeps the intensity of its birth, and cells outlast the activity', () => {
    const w = { ...thunderstorm(), timeOfDay: 18 };
    const f = new StormField();
    const seen = new Map<number, { intensity: number; last: number }>();
    let afterZero = 0;
    let firstZero = NaN;
    for (let m = 0; m <= 240; m++) {
      const now = activity(w);
      if (now === 0 && Number.isNaN(firstZero)) firstZero = w.timeOfDay;
      for (let k = 0; k < 9; k++) {
        const n = (k - 4) * 40_000;
        for (const c of f.select(w, 0, n, 0)) {
          const s = seen.get(c.id);
          if (!s) seen.set(c.id, { intensity: c.intensity, last: w.timeOfDay });
          else {
            expect(c.intensity).toBe(s.intensity);
            s.last = w.timeOfDay;
          }
          if (now === 0 && c.core > 0) afterZero++;
        }
      }
      advanceTimeOfDay(w, 60);
    }
    const lastSeen = Math.max(...[...seen.values()].map((s) => s.last));
    report('evening 18:00-22:00', { cells: seen.size, activityZeroFrom: firstZero, cellSamplesAfterActivity0: afterZero, lastCellSeenH: lastSeen });
    expect(seen.size).toBeGreaterThan(10);
    expect(afterZero).toBeGreaterThan(0);
    // No cell after the activity has been 0 for a whole lifetime (plus a grid step).
    expect(lastSeen).toBeLessThan(firstZero + 70 / 60);
  });
});

describe('lattice', () => {
  test('the same weather and clock give the same cells, whatever was asked before', () => {
    const w = thunderstorm();
    const a = new StormField();
    const b = new StormField();
    // b is asked at other points and times first.
    for (let k = 0; k < 20; k++) b.select({ ...w, timeOfDay: 12 + k * 0.1 }, k, k * 7000, -k * 3000);
    const at = snapshot(a.select(w, 50, 4000, -2000), 50);
    expect(at.length).toBeGreaterThan(0);
    expect(snapshot(b.select(w, 50, 4000, -2000), 50)).toEqual(at);
  });

  test('the cells depend on the weather clock, not on how it was stepped', () => {
    const one = thunderstorm();
    const many = thunderstorm();
    advanceTimeOfDay(one, 1800);
    for (let k = 0; k < 1800; k++) advanceTimeOfDay(many, 1);
    report('clock after 1800 one-second steps vs one step', { differenceS: stormClockS(many) - stormClockS(one) });
    const a = snapshot(new StormField().select(one, 0, 0, 0), 0);
    const b = snapshot(new StormField().select(many, 0, 0, 0), 0);
    expect(b.map((c) => c.id)).toEqual(a.map((c) => c.id));
    for (let i = 0; i < a.length; i++) {
      expect(Math.abs(b[i].n - a[i].n)).toBeLessThan(1e-3);
      expect(Math.abs(b[i].e - a[i].e)).toBeLessThan(1e-3);
      expect(Math.abs(b[i].w - a[i].w)).toBeLessThan(1e-6);
    }
  });

  test('a field reused across clock steps within CLOCK_REUSE_S gives what a new field gives at each reading', () => {
    // The live cells are rebuilt only when the clock moves more than CLOCK_REUSE_S (10 s) from their build clock;
    // in between, positions and life cycles are evaluated at the current clock. Steps of -10 to +15 s, 40 kt wind.
    const w = { ...thunderstorm(), windSpeedKt: 40 };
    const f = new StormField();
    const rnd = mulberry32(7);
    let compared = 0;
    let cells = 0;
    for (let k = 0; k < 1500; k++) {
      advanceTimeOfDay(w, (rnd() - 0.4) * 25);
      const n = (rnd() - 0.5) * 30_000;
      const e = (rnd() - 0.5) * 30_000;
      const a = f.select(w, k, n, e).map((c) => ({ ...c }));
      expect(a).toEqual(new StormField().select(w, k, n, e).map((c) => ({ ...c })));
      compared++;
      cells += a.length;
    }
    report('reused field against a new field at each reading', { readings: compared, cellsCompared: cells, clockReuseS: CLOCK_REUSE_S });
    expect(cells).toBeGreaterThan(compared);
  });

  test('cells move with the steering wind between clock readings', () => {
    const w = thunderstorm();
    const f = new StormField();
    const before = snapshot(f.select(w, 0, 0, 0), 0);
    advanceTimeOfDay(w, 60);
    const after = snapshot(f.select(w, 0, 0, 0), 0);
    // The steering wind: the surface speed x 1.8, the direction veered as at 2000 m AGL (25 deg).
    const steer = stormSteering(w, { fromDeg: 0, kt: 0 });
    report('steering wind', { fromDeg: steer.fromDeg, kt: steer.kt, surfaceFromDeg: w.windDirectionDeg });
    expect(steer.fromDeg).toBeCloseTo(w.windDirectionDeg + windVeer(2000) / DEG, 9);
    expect(steer.fromDeg - w.windDirectionDeg).toBeCloseTo(25, 0);
    const v = steer.kt * KT;
    const from = (steer.fromDeg * Math.PI) / 180;
    let checked = 0;
    for (const c of after) {
      const old = before.find((o) => o.id === c.id);
      if (!old) continue;
      expect(c.n - old.n).toBeCloseTo(-Math.cos(from) * v * 60, 3);
      expect(c.e - old.e).toBeCloseTo(-Math.sin(from) * v * 60, 3);
      checked++;
    }
    for (const c of f.select(w, 0, 0, 0)) {
      expect(c.motionDeg).toBeCloseTo(steer.fromDeg, 9);
      expect(c.motionKt).toBeCloseTo(steer.kt, 9);
    }
    expect(checked).toBeGreaterThan(0);
  });

  test('Thunderstorm: a cell with a mature core within 40 km of the airport in most minutes of an hour', () => {
    const w = thunderstorm();
    const f = new StormField();
    let minutes = 0;
    let nearest = Infinity;
    let flashing = 0;
    for (let m = 0; m < 60; m++) {
      const cells = f.select(w, 0, 0, 0);
      let near = false;
      let lit = false;
      for (const c of cells) {
        const d = Math.hypot(c.northM, c.eastM);
        if (c.core > 0.5 && d < 40_000) near = true;
        if (c.flash > 0.5 && d < 40_000) lit = true;
        nearest = Math.min(nearest, d);
      }
      if (near) minutes++;
      if (lit) flashing++;
      advanceTimeOfDay(w, 60);
    }
    report('Thunderstorm over an hour from 15:00', { minutesWithCoreWithin40km: minutes, minutesWithLightningWithin40km: flashing, nearestKm: nearest / 1000 });
    expect(minutes).toBeGreaterThanOrEqual(45);
    expect(flashing).toBeGreaterThanOrEqual(20);
    expect(nearest).toBeLessThan(20_000);
  });
});

describe('time base across a reset and a resume', () => {
  test('a scenario reset (clock back to 0) moves no derived cell and leaves the convective wind', () => {
    const w = thunderstorm();
    const p = new SimPhysics({ weather: w });
    p.reset('cruise', w);
    p.step(20);
    const t = p.time;
    const cells = p.env.windField.stormCells(0, 0, t);
    expect(cells.length).toBeGreaterThan(0);
    const before = snapshot(cells, t);
    const c = before[0];
    const probe: Vec3 = { x: c.n + 500, y: c.e, z: -(ELEV + 300) };
    const windBefore = p.env.windField.breakdown(probe, t).convective;
    p.reset('cruise', w);
    expect(p.time).toBe(0);
    const after = snapshot(p.env.windField.stormCells(0, 0, 0), 0);
    expect(after).toEqual(before);
    const windAfter = p.env.windField.breakdown(probe, 0).convective;
    report('convective wind before and after the reset', { upBefore: windBefore.up, upAfter: windAfter.up });
    expect(windAfter.up).toBeCloseTo(windBefore.up, 9);
    expect(windAfter.outN).toBeCloseTo(windBefore.outN, 9);
  });

  test('a weather copy through JSON and restoreWeather (the boot resume) gives the same cells', () => {
    const w = thunderstorm();
    advanceTimeOfDay(w, 777);
    const saved = JSON.parse(JSON.stringify(w)) as WeatherSettings;
    expect('storms' in saved).toBe(false);
    const live = restoreWeather(defaultWeather(), saved);
    expect(proceduralStorms(live)).toBe(true);
    expect(snapshot(new StormField().select(live, 3, 1000, 1000), 3)).toEqual(snapshot(new StormField().select(w, 3, 1000, 1000), 3));
  });
});

describe('selection continuity', () => {
  /** Sum over all ids of |weight change| between two selections, and the largest single change. */
  const weightJump = (a: Map<number, number>, b: Map<number, number>): number => {
    let worst = 0;
    for (const id of new Set([...a.keys(), ...b.keys()])) worst = Math.max(worst, Math.abs((a.get(id) ?? 0) - (b.get(id) ?? 0)));
    return worst;
  };
  const weights = (cells: readonly ActiveStorm[]) => new Map(cells.map((c) => [c.id, c.weight]));

  test('weights change by small steps when cells enter and leave the selection, along a 2-hour jet flight', () => {
    // 250 m/s north-east with the clock running, sampled every `dt` s: the largest weight step shrinks with dt.
    const run = (dt: number) => {
      const w = thunderstorm();
      const f = new StormField();
      let prev = weights(f.select(w, 0, 0, 0));
      let ids = new Set(prev.keys());
      let worst = 0;
      let changes = 0;
      const steps = Math.round(7200 / dt);
      for (let k = 1; k <= steps; k++) {
        advanceTimeOfDay(w, dt);
        const t = k * dt;
        const cur = weights(f.select(w, t, 177 * t, 177 * t));
        worst = Math.max(worst, weightJump(prev, cur));
        const curIds = new Set(cur.keys());
        if ([...curIds].some((id) => !ids.has(id))) changes++;
        ids = curIds;
        prev = cur;
      }
      return { worst, changes };
    };
    const coarse = run(1);
    const fine = run(0.1);
    report('selection along 1800 km in 2 h', { setChanges1s: coarse.changes, largestWeightStep1s: coarse.worst, setChanges01s: fine.changes, largestWeightStep01s: fine.worst });
    expect(fine.changes).toBeGreaterThan(50);
    expect(fine.worst).toBeLessThan(0.05);
    expect(fine.worst).toBeLessThan(0.2 * coarse.worst);
  });

  test('the rank fade dims at most one cell within FADE_START_M in nearly every selection', () => {
    const w = thunderstorm();
    const f = new StormField();
    let selections = 0;
    let moreThanOne = 0;
    let dimmed = 0;
    let full = 0;
    let cells = 0;
    for (let m = 0; m < 180; m++) {
      for (let k = 0; k < 5; k++) {
        const n = 30_000 * (k - 2);
        const list = f.select(w, 0, n, 0);
        let below = 0;
        for (const c of list) {
          if (Math.hypot(c.northM - n, c.eastM) >= FADE_START_M) continue;
          cells++;
          if (c.weight < 0.99) below++;
          else full++;
        }
        dimmed += below;
        if (below > 1) moreThanOne++;
        selections++;
      }
      advanceTimeOfDay(w, 60);
    }
    report('selections 15:00-18:00 at 5 points', { selections, cellsWithin40km: cells, weightAtLeast099: full, weightBelow099: dimmed, selectionsWithTwoOrMoreDimmed: moreThanOne });
    expect(cells).toBeGreaterThan(selections * 3);
    expect(moreThanOne).toBeLessThan(0.05 * selections);
  });

  test('the convective wind has no jump along a path through the storms, clock running', () => {
    const w = thunderstorm();
    const env = createEnvironment({ weather: w, terrain: flatTerrain() });
    // Fly 60 m/s toward the nearest mature cell at 300 m above the field for 20 minutes, 0.1 s steps.
    const first = env.windField.stormCells(0, 0, 0).find((c) => c.core > 0.5)!;
    const target = stormCentreAt(first, 0, { north: 0, east: 0 });
    const len = Math.hypot(target.north, target.east);
    const dir = { n: target.north / len, e: target.east / len };
    const p: Vec3 = { x: 0, y: 0, z: -(ELEV + 300) };
    let last = env.windField.breakdown(p, 0).convective;
    let worst = 0;
    let peak = 0;
    let setChanges = 0;
    let ids = env.windField.stormCells(0, 0, 0).map((c) => c.id).join();
    for (let k = 1; k <= 12_000; k++) {
      const t = k * 0.1;
      advanceTimeOfDay(w, 0.1);
      p.x = dir.n * 60 * t;
      p.y = dir.e * 60 * t;
      const c = env.windField.breakdown(p, t).convective;
      worst = Math.max(worst, Math.abs(c.up - last.up), Math.abs(c.outN - last.outN), Math.abs(c.outE - last.outE));
      peak = Math.max(peak, Math.abs(c.up), Math.hypot(c.outN, c.outE));
      const now = env.windField.stormCells(p.x, p.y, t).map((s) => s.id).join();
      if (now !== ids) setChanges++;
      ids = now;
      last = c;
    }
    report('convective wind along 72 km, 0.1 s steps', { largestStepMs: worst, peakMs: peak, selectionChanges: setChanges });
    expect(peak).toBeGreaterThan(1);
    expect(worst).toBeLessThan(0.5);
  });
});

describe('physics and render agree', () => {
  test('the render effect and the wind field select the same cells at the same point and time', () => {
    const w = thunderstorm();
    const env = createEnvironment({ weather: w, terrain: flatTerrain() });
    const effect = new StormCellEffect();
    const camera = new THREE.PerspectiveCamera(170, 1, 1, 400_000);
    const ctx = { weather: w, simTime: 0, camera } as unknown as SimContext;
    let compared = 0;
    let growing = 0;
    for (let k = 0; k < 90; k++) {
      advanceTimeOfDay(w, 120);
      const t = 10 * k;
      ctx.simTime = t;
      const n = 3000 * k - 20_000;
      const e = -1500 * k;
      camera.position.set(e, 150_000, -n);
      // Looking straight down from 150 km with a 170 degree field: every cell's bounds are in view.
      camera.lookAt(e, 0, -n);
      camera.updateMatrixWorld();
      const count = effect.updateCells(ctx);
      const phys = env.windField.stormCells(n, e, t);
      expect(count).toBe(phys.length);
      for (let i = 0; i < count; i++) {
        const g = effect.cells[i];
        const c = stormCentreAt(phys[i], t, { north: 0, east: 0 });
        expect(g.x).toBeCloseTo(c.east, 6);
        expect(g.z).toBeCloseTo(-c.north, 6);
        expect([g.core, g.anvil, g.rain]).toEqual([phys[i].core, phys[i].anvil, phys[i].rain]);
        // The same top, also while a derived cell grows below the explicit cells' 6000 m floor.
        expect(g.top).toBe(cellTopM(phys[i]));
        if (g.top < CELL_TOP_MIN_M) growing++;
        compared++;
      }
    }
    report('cells compared', { count: compared, topsBelow6000m: growing });
    expect(compared).toBeGreaterThan(90);
    expect(growing).toBeGreaterThan(0);
  });
});

describe('explicit storms override the derived cells', () => {
  const cell = { northM: 5000, eastM: 0, radiusM: 3000, topM: 11_000, intensity: 0.8, motionDeg: 270, motionKt: 15 };

  test('an explicit list replaces them, an empty list turns all cells off', () => {
    const f = new StormField();
    const w = thunderstorm();
    expect(f.select(w, 0, 0, 0).length).toBeGreaterThan(0);
    const listed = f.select({ ...w, storms: [cell] }, 0, 0, 0);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ ...cell, id: 0, weight: 1, core: 1, anvil: 1, rain: 1, flash: 1, wind: 1 });
    expect(f.select({ ...w, storms: NO_STORMS }, 0, 0, 0)).toHaveLength(0);
    // Up to MAX_STORMS (6) explicit cells are read.
    const seven = Array.from({ length: 7 }, (_, k) => ({ ...cell, northM: k * 10_000 }));
    expect(f.select({ ...w, storms: seven }, 0, 0, 0).map((c) => c.northM)).toEqual(seven.slice(0, MAX_STORMS).map((c) => c.northM));
    expect(MAX_STORMS).toBe(6);
    // Far from the airport too: nothing but the listed cell.
    expect(f.select({ ...w, storms: [cell] }, 0, 200_000, -80_000)).toHaveLength(1);
  });

  test('no derived cell beyond FADE_END_M of the point', () => {
    const w = thunderstorm();
    const f = new StormField();
    for (let k = 0; k < 40; k++) {
      advanceTimeOfDay(w, 90);
      for (const c of f.select(w, 0, k * 9000, 0)) expect(Math.hypot(c.northM - k * 9000, c.eastM)).toBeLessThan(FADE_END_M);
    }
  });
});

describe('lightning of derived cells', () => {
  test('a cell keeps its strikes when its place in the list changes', () => {
    const w = thunderstorm();
    const cells = new StormField().select(w, 0, 0, 0).map((c) => ({ ...c }));
    expect(cells.length).toBeGreaterThan(1);
    const a: Strike[] = [];
    const b: Strike[] = [];
    const na = strikesBetween(cells, 0, 3600, a);
    const nb = strikesBetween(cells.slice().reverse(), 0, 3600, b);
    const key = (s: Strike, list: readonly ActiveStorm[]) => `${list[s.cell].id}@${s.tStart.toFixed(6)}`;
    const reversed = cells.slice().reverse();
    expect(b.slice(0, nb).map((s) => key(s, reversed)).sort()).toEqual(a.slice(0, na).map((s) => key(s, cells)).sort());
    // The lightning share scales the rate: a cell outside its lightning phase has none.
    const quiet = cells.map((c) => ({ ...c, flash: 0 }));
    expect(strikesBetween(quiet, 0, 3600, [])).toBe(0);
    report('strikes in an hour of the Thunderstorm cells at 15:00', { strikes: na });
  });
});

describe('training weather line', () => {
  test('CB and TS from derived cells near the airport; none for the default weather', () => {
    expect(weatherLine(defaultWeather())).not.toMatch(/CB|TS/);
    const w = thunderstorm();
    let cb = 0;
    let ts = 0;
    for (let m = 0; m < 60; m++) {
      const line = weatherLine(w);
      if (/ CB/.test(line)) cb++;
      if (/\bTS\b/.test(line)) ts++;
      advanceTimeOfDay(w, 60);
    }
    report('Thunderstorm weather line over an hour', { minutesWithCB: cb, minutesWithTS: ts, sample: weatherLine(w) });
    expect(cb).toBe(60);
    expect(ts).toBeGreaterThan(0);
  });
});

describe('cost', () => {
  test('env.wind with derived cells, clock fixed and clock advancing every call', () => {
    for (const advancing of [false, true]) {
      const w = thunderstorm();
      const env = createEnvironment({ weather: w, terrain: flatTerrain() });
      const n = 50_000;
      const p = { x: 0, y: 0, z: -(ELEV + 300) };
      let acc = 0;
      let withCells = 0;
      const start = performance.now();
      for (let i = 0; i < n; i++) {
        if (advancing && i % 4 === 0) advanceTimeOfDay(w, 1 / 60);
        p.x = 25_000 + i * 0.2;
        acc += env.wind(p, i / 240).z;
      }
      const us = ((performance.now() - start) / n) * 1000;
      for (let i = 0; i < n; i += 500) if (env.windField.stormCells(25_000 + i * 0.2, 0, i / 240).length > 0) withCells++;
      report(`env.wind, derived cells, clock ${advancing ? 'advancing every 4 calls' : 'fixed'}`, { microsecondsPerWindCall: us, checksum: acc, samplesWithCells: `${withCells}/100` });
      expect(withCells).toBeGreaterThan(80);
      expect(us).toBeLessThan(30);
    }
  });
});
