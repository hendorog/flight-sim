// Resume on reload (src/sim/resume.ts): a snapshot taken from a flying SimPhysics, written as JSON and read
// back, restored into a fresh SimPhysics (as after a page reload) through the flight model's own API.
// The restored aircraft must be where the original was, with the same attitude, speed, rpm and controls,
// and must keep flying the way the original does (no jump).

import { describe, expect, it } from 'vitest';
import { KT } from '../../src/core/math';
import { defaultWeather, type WeatherSettings } from '../../src/core/types';
import type { ScenarioId } from '../../src/core/context';
import {
  MAX_AGE_MS,
  SNAPSHOT_KEY,
  SNAPSHOT_SCHEMA,
  decideBoot,
  formatAge,
  loadResumePreference,
  loadSnapshot,
  parseSnapshot,
  saveSnapshot,
  type FlightSnapshot,
  type KeyValueStore,
} from '../../src/sim/resume';
import { SimPhysics } from '../../src/sim/SimPhysics';

const NOW = 1_800_000_000_000;

/** The live weather object of each SimPhysics (the shell keeps it; SimPhysics does not expose it). */
const weatherOf = new WeakMap<SimPhysics, WeatherSettings>();

function fly(id: ScenarioId, seconds: number, weather: Partial<WeatherSettings> = {}): SimPhysics {
  const w = { ...defaultWeather(), ...weather };
  const p = new SimPhysics({ weather: w });
  weatherOf.set(p, w);
  p.autoflightOnReset = true;
  p.reset(id);
  p.step(seconds);
  return p;
}

function snap(p: SimPhysics, resume = true): FlightSnapshot {
  return p.captureSnapshot({ weather: weatherOf.get(p)!, cameraMode: 'chase', quality: 'high', renderScale: null, resume, now: NOW });
}

/** Through JSON (as localStorage holds it) into a brand-new SimPhysics. */
function reload(s: FlightSnapshot): SimPhysics {
  const back = parseSnapshot(JSON.stringify(s));
  expect(back).not.toBeNull();
  const w = { ...back!.weather };
  const q = new SimPhysics({ weather: w });
  weatherOf.set(q, w);
  q.restore(back!);
  return q;
}

function angleBetween(a: { w: number; x: number; y: number; z: number }, b: typeof a): number {
  const d = Math.abs(a.w * b.w + a.x * b.x + a.y * b.y + a.z * b.z);
  return 2 * Math.acos(Math.min(1, d));
}

function compare(a: SimPhysics, b: SimPhysics) {
  const s = a.state;
  const r = b.state;
  return {
    pos: Math.hypot(s.position.x - r.position.x, s.position.y - r.position.y, s.position.z - r.position.z),
    att: (angleBetween(s.orientation, r.orientation) * 180) / Math.PI,
    vel: Math.hypot(s.velocity.x - r.velocity.x, s.velocity.y - r.velocity.y, s.velocity.z - r.velocity.z),
    kias: Math.abs(s.ias - r.ias) / KT,
    rpm: Math.abs(s.engine.rpm - r.engine.rpm),
    vsFpm: Math.abs(s.verticalSpeed - r.verticalSpeed) / 0.00508,
  };
}

describe('resume snapshot round trip through the flight model', () => {
  it.each([
    ['cruise', 20],
    ['downwind', 15],
    ['final', 30],
    ['runway', 10], // mid take-off roll, on the wheels at ~50 kt
    ['runway', 40], // climbing out, full power
  ] as [ScenarioId, number][])('%s after %d s: restored within tolerance and keeps flying the same', (id, t) => {
    const a = fly(id, t, { turbulence: 0 });
    const s = snap(a);
    const b = reload(s);

    // Immediately after the restore.
    const d0 = compare(a, b);
    expect(d0.pos).toBeLessThan(1e-6);
    expect(d0.att).toBeLessThan(1e-4); // degrees (setKinematics renormalises the quaternion)
    expect(d0.vel).toBeLessThan(1e-6);
    const sa = a.fm.captureSystems();
    const sb = b.fm.captureSystems();
    expect(Math.abs(sb.engines[0].rpm - sa.engines[0].rpm)).toBeLessThan(1e-6);
    expect(b.state.engine.running).toBe(a.state.engine.running);
    expect(sb.tanks[0]).toBeCloseTo(sa.tanks[0], 9);
    expect(sb.tanks[1]).toBeCloseTo(sa.tanks[1], 9);
    expect(sb.surfaces).toEqual(sa.surfaces);
    expect(b.controls).toEqual(a.controls);
    expect(b.scenario.id).toBe(id);
    expect(b.autoflight.phase).toBe(a.autoflight.phase);
    expect(b.autoflight.autopilot.settings).toEqual(a.autoflight.autopilot.settings);

    // One step: the IAS and rpm agree (the aerodynamic lag states restart from rest, a fraction of a knot).
    a.step(1 / 240);
    b.step(1 / 240);
    const d1 = compare(a, b);
    expect(d1.kias).toBeLessThan(1);
    expect(d1.rpm).toBeLessThan(5);

    // Both keep flying: after 2 s and 10 s the restored flight is still with the original. Measured (240 Hz,
    // no turbulence): cruise/downwind/final/climb within 6 mm and 0.007 deg after 10 s; the take-off roll
    // (tyre states restart from rest) 0.42 m after 2 s and 1.9 m after 10 s.
    a.step(2);
    b.step(2);
    const d2 = compare(a, b);
    a.step(8);
    b.step(8);
    const d10 = compare(a, b);
    const line = `[resume] ${id} @${t}s: +1 step ${JSON.stringify(round(d1))}  +2 s ${JSON.stringify(round(d2))}  +10 s ${JSON.stringify(round(d10))}`;
    console.log(line);
    // On the wheels the tyre states restart from rest, and the roll lifts off inside the 10 s window, so a
    // small difference in rotation timing shows as attitude. Measured (round 4 aero): runway @10 s gives
    // 0.42 m / 0.53 kt after 2 s and 1.94 m / 0.75 deg after 10 s.
    const ground = s.status.onGround;
    expect(d2.pos).toBeLessThan(0.5);
    expect(d2.att).toBeLessThan(0.1);
    expect(d2.kias).toBeLessThan(ground ? 0.6 : 0.5);
    expect(d2.rpm).toBeLessThan(5);
    expect(d10.pos).toBeLessThan(5);
    expect(d10.att).toBeLessThan(ground ? 1.0 : 0.5);
    expect(d10.kias).toBeLessThan(1);
    if (!s.status.onGround) {
      // Airborne the air and the aircraft are the same: the flights agree to millimetres (measured: <= 6 mm,
      // 0.007 deg, 0.001 kt after 10 s). On the wheels the tyre states restart from rest (~2 m in 10 s).
      expect(d10.pos).toBeLessThan(0.05);
      expect(d10.kias).toBeLessThan(0.05);
    }
    expect(b.state.crashed).toBe(false);
  }, 30_000);   // about 2 s alone; the default 5 s timed out under a loaded full-suite run

  it('with turbulence the restored flight shows no jump (smooth continuation)', () => {
    const a = fly('cruise', 30);
    const b = reload(snap(a));
    const before = { ias: b.state.ias, vs: b.state.verticalSpeed, pitch: b.state.pitch, roll: b.state.roll };
    b.step(1);
    expect(Math.abs(b.state.ias - before.ias) / KT).toBeLessThan(3);
    expect(Math.abs(b.state.verticalSpeed - before.vs) / 0.00508).toBeLessThan(400);
    expect(Math.abs(b.state.pitch - before.pitch) * 57.3).toBeLessThan(2);
    expect(Math.abs(b.state.roll - before.roll) * 57.3).toBeLessThan(3);
  }, 30_000);   // about 2 s alone, like the test above

  it('a restart after the restore goes back to the snapshot scenario', () => {
    const b = reload(snap(fly('downwind', 5)));
    b.reset(b.scenario.id);
    expect(b.scenario.id).toBe('downwind');
  });
});

describe('resume decision and storage', () => {
  const base = (): FlightSnapshot => snap(fly('cruise', 2));
  const opts = { param: null, explicitScenario: false, enabled: true, now: NOW + 65_000 };

  it('resumes a fresh flying snapshot and formats its age', () => {
    const d = decideBoot(base(), opts);
    expect(d.kind).toBe('resume');
    if (d.kind === 'resume') expect(formatAge(d.ageMs)).toBe('1:05');
    expect(formatAge(3 * 3600e3 + 61e3)).toBe('3:01:01');
  });

  it('starts normally when crashed, too old, explicitly asked or disabled', () => {
    const crashed = base();
    crashed.status.crashed = true;
    expect(decideBoot(crashed, opts).kind).toBe('normal');
    expect(decideBoot(base(), { ...opts, now: NOW + MAX_AGE_MS + 1 }).kind).toBe('normal');
    expect(decideBoot(base(), { ...opts, now: NOW - 10_000 }).kind).toBe('normal'); // clock went backwards
    expect(decideBoot(base(), { ...opts, explicitScenario: true }).kind).toBe('normal');
    expect(decideBoot(base(), { ...opts, enabled: false }).kind).toBe('normal');
    expect(decideBoot(base(), { ...opts, param: false }).kind).toBe('normal');
    // resume=1 overrides scenario= and the preference.
    expect(decideBoot(base(), { ...opts, explicitScenario: true, enabled: false, param: true }).kind).toBe('resume');
    expect(decideBoot(null, opts).kind).toBe('normal');
  });

  it('parked with the engine off, or deliberately restarted: that scenario fresh', () => {
    const parked = snap(fly('apron', 1));
    expect(parked.status.onGround).toBe(true);
    expect(parked.engine.running).toBe(false);
    expect(decideBoot(parked, opts)).toMatchObject({ kind: 'scenario', scenario: 'apron' });
    const restarted = base();
    restarted.resume = false;
    expect(decideBoot(restarted, opts)).toMatchObject({ kind: 'scenario', scenario: 'cruise' });
    // On the runway with the engine running is a flight to resume.
    expect(decideBoot(snap(fly('runway', 1)), opts).kind).toBe('resume');
  });

  it('ignores corrupt, truncated and old-schema snapshots silently', () => {
    const good = JSON.stringify(base());
    expect(parseSnapshot(good)).not.toBeNull();
    expect(parseSnapshot('{not json')).toBeNull();
    expect(parseSnapshot(good.slice(0, good.length / 2))).toBeNull();
    expect(parseSnapshot('null')).toBeNull();
    expect(parseSnapshot('[]')).toBeNull();
    // Older than the oldest schema still read (schema 1 stays valid under schema 2, spec section 6.1).
    expect(parseSnapshot(JSON.stringify({ ...base(), schema: 0 }))).toBeNull();
    expect(parseSnapshot(JSON.stringify({ ...base(), schema: SNAPSHOT_SCHEMA + 1 }))).toBeNull();
    expect(parseSnapshot(JSON.stringify({ ...base(), scenario: 'moon' }))).toBeNull();
    const nan = base();
    nan.body.position.x = NaN; // JSON writes null
    expect(parseSnapshot(JSON.stringify(nan))).toBeNull();
    const noControls = JSON.parse(good);
    delete noControls.controls.throttle;
    expect(parseSnapshot(JSON.stringify(noControls))).toBeNull();
  });

  it('survives storage that throws (quota, security) and missing storage', () => {
    const throwing: KeyValueStore = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {
        throw new Error('SecurityError');
      },
    };
    expect(saveSnapshot(throwing, base())).toBe(false);
    expect(loadSnapshot(throwing)).toBeNull();
    expect(loadResumePreference(throwing)).toBe(true);
    expect(saveSnapshot(null, base())).toBe(false);
    const map = new Map<string, string>();
    const mem: KeyValueStore = { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
    expect(saveSnapshot(mem, base())).toBe(true);
    expect(map.get(SNAPSHOT_KEY)!.length).toBeLessThan(6000);
    expect(loadSnapshot(mem)?.scenario).toBe('cruise');
  });
});

function round(o: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, +v.toPrecision(3)]));
}
