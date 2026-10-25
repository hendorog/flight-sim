// The Bo 105 keyboard flows of tune pass 2 (the round-2 pilot gate's must items 1-3 and the by-hand accelerations; probes
// W/tune2/bo105 q1_held, q2_land, q3_cruise, logs out/*.base.log before and out/*.cfg2.log after; the gate's own rigs
// re-flown in W/tune2/bo105 g2/): keys through the REAL InputSystem into the REAL SimPhysics, the gate's see-tap-wait
// beginner (tests/rotorcraft/bo105KeyPilot.ts targetBeginner: looks 0.3 s late every `interval` s, about 9 deg of attitude
// per 1 s tap, F5 / F6 on the height law). All the aids are ESTIMATE sim aids (docs/bo105-flight-model.md section 9,
// "Tune pass 2"); "before" is main at 7b3e8f4.
import { afterAll, describe, expect, it } from 'vitest';
import { DEG, KT, clamp } from '../../src/core/math';
import type { AircraftDefinition } from '../../src/aircraft/types';
import { BO105_DEFINITION as def } from '../../src/aircraft/bo105';
import { Keys, flyHover, frame, hoverBeginner, keyRig, liftOffKeys, targetBeginner, type KeyRig } from './bo105KeyPilot';
import { LEVER, lever, writeTrace } from './bo105Rig';

const report: Record<string, unknown> = {};
afterAll(() => writeTrace('bo105KeyFlows', report));

/** The tuning with some fields removed (a definition copy). */
function withoutTuning(...keys: (keyof NonNullable<typeof def.input.stabilityAssist>)[]): AircraftDefinition {
  const t = { ...def.input.stabilityAssist! };
  for (const k of keys) delete t[k];
  return { ...def, input: { ...def.input, stabilityAssist: t } };
}
const torque = (r: KeyRig): number => {
  const rc = r.physics.state.rotorcraft!;
  return Math.max(rc.turboshaft?.torquePsi ?? 0, rc.twinTurboshaft?.second.torquePsi ?? 0);
};
const view = (r: KeyRig) => {
  const s = r.physics.state;
  return { pitch: s.pitch, roll: s.roll, hdg: s.heading, z: s.position.z, agl: s.altitudeAGL };
};

/**
 * Must 1 (the round-2 gate's h2 / h4): an arrow key held from the hover. The key accelerates (0.04-0.07 of the axis per
 * second at the press, 0.35 after 1.2-1.5 s), so held 1.5-2 s it took the stick past the STAB ASSIST's 10 % series
 * authority and the raw aircraft answered with 35-45 deg of attitude: before, ArrowUp held 2 s crashed 5.3 s after the
 * press from 16 m and 3.5 s from 3 ft, and of 40 holds (1 / 1.5 / 2 / 3 / 5 s, four directions, both heights) 12 came back
 * (the cliff between 1.25 and 1.5 s; q1_held.base). The keyboard cyclic limit (keyboardLimit: 0.12 of the axis from where
 * the stick last rested, below 15 kt of ground speed, open by 30) keeps a held key inside the authority (at most 8.9 deg
 * of commanded attitude), the TRC's walk waits for the arrow keys to rest (translationalRate.keyRest: a key held against
 * the limit is still the pilot's command), and 2.5 s after the release the keyed stick glides back at 0.1 per second, so
 * the next press has the whole limit again. After: 40 of 40 come back, at most 18.6 deg of attitude (with the trim's
 * 3.4), 10.6 kt and 37 m (q1_held.cfg2).
 */
describe('arrow keys held at the hover (tune pass 2: the keyboard cyclic limit and its re-centring)', () => {
  function held(start: 'hover15' | 'ige3', code: string, hold: number, dd?: AircraftDefinition) {
    const r = keyRig({ start, dd }), keys = new Keys(r);
    for (let i = 0; i < 60; i++) frame(r);
    const s0 = r.physics.state, x0 = s0.position.x, y0 = s0.position.y, t0 = r.t;
    let maxAtt = 0, maxKt = 0, maxDrift = 0, crashedS: number | null = null;
    keys.tap(code, hold);
    while (r.t - t0 < hold + 60) {
      keys.update(); frame(r);
      const s = r.physics.state;
      maxAtt = Math.max(maxAtt, Math.abs(s.roll) / DEG, Math.abs(s.pitch) / DEG);
      maxKt = Math.max(maxKt, s.groundSpeed / KT); maxDrift = Math.max(maxDrift, Math.hypot(s.position.x - x0, s.position.y - y0));
      if (s.crashed) { crashedS = r.t - t0; break; }
    }
    keys.releaseAll();
    return { crashedS, maxAtt, maxKt, maxDrift, endKt: r.physics.state.groundSpeed / KT };
  }
  it('every arrow key held 2 s and 5 s from the 16 m hover and from 3 ft: no crash, attitude within 25 deg, under 15 kt, back to a hover (under 1 kt) 60 s after the release, within 60 m (before: ArrowUp 2 s crashed at 5.3 / 3.5 s)', () => {
    const rows: Record<string, unknown> = {};
    for (const start of ['hover15', 'ige3'] as const) for (const code of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) for (const hold of [2, 5]) {
      const h = held(start, code, hold), name = `${start}/${code}/${hold}`;
      rows[name] = h;
      expect(h.crashedS, name).toBeNull();
      expect(h.maxAtt, name).toBeLessThanOrEqual(25); expect(h.maxKt, name).toBeLessThan(15);
      expect(h.endKt, name).toBeLessThan(1); expect(h.maxDrift, name).toBeLessThanOrEqual(60);
    }
    report.heldKeys = rows;
  }, 600_000);
  it('without the keyboard cyclic limit ArrowUp held 2 s from the 16 m hover still crashes (the raw aircraft answers the stick)', () => {
    const without = held('hover15', 'ArrowUp', 2, withoutTuning('keyboardLimit'));
    report.heldKeysWithoutLimit = without;
    expect(without.crashedS).not.toBeNull();
  }, 120_000);
});

/**
 * Must 2 (the round-2 gate's g3 lawDown, the g10 A-route landing and h1): the wings-level beginner, who aims at the hover
 * pitch and 0 deg of roll (the hover trim is 3.4 deg left), lets down from the hover by its height law aimed 1 m below
 * the ground (gain 1, and the gate's 0.5) or in F5 taps of 0.3 s a second (looking every 1 / 2 s). Each tap took back the
 * TRC's lean and its walk waited 2.5 s of rest, which a 1-2 s tapper never gives: before, from 16 m it slid 17-29 kt
 * and rolled over at the touchdown; 3 of 12 landings (with F5 held and the arrows untouched among them) were under 5 kt
 * (q2_land.base). Letting down (the CG under 8 m with a bare F5 held within 5 s) the keyed stick
 * glides back as soon as the arrow key is let go (keyboardLimit.recentre.landing) and the walk runs whenever no arrow is
 * held (translationalRate.landingRestS 0). After: 12 of 12, touchdown 0.1-0.9 kt (q2_land.cfg2); F5 held with an arrow
 * held too (moving on purpose) touches down at 7-8 kt, not crashed.
 */
describe('the wings-level beginner letting down from the hover (tune pass 2)', () => {
  function letDown(start: 'hover15' | 'ige3', how: 'law' | 'lawHalf' | 'taps', interval: number) {
    const r = keyRig({ start }), keys = new Keys(r);
    for (let i = 0; i < 60; i++) frame(r);
    const s0 = view(r), groundZ = s0.z + s0.agl;
    const step = targetBeginner(r, keys, interval, () => ({ pitch: s0.pitch, roll: 0, hdg: s0.hdg,
      z: how === 'taps' ? null : groundZ + 1, collGain: how === 'lawHalf' ? 0.5 : 1 }));
    let touch: { t: number; kt: number; vz: number } | null = null, maxKt = 0;
    const t0 = r.t;
    while (r.t - t0 < 90 && !(touch && r.t > touch.t + 3)) {
      if (touch) keys.tap('F5', 2 / 60);
      else {
        step();
        if (how === 'taps' && Math.round(r.t * 60) % 60 === 0) keys.tap('F5', 0.3);
      }
      keys.update(); frame(r);
      const s = r.physics.state;
      maxKt = Math.max(maxKt, s.groundSpeed / KT);
      if (!touch && s.onGround) touch = { t: r.t - t0, kt: s.groundSpeed / KT, vz: s.velocity.z };
      if (s.crashed) break;
    }
    keys.releaseAll();
    return { touch, maxKt, crashed: r.physics.state.crashed };
  }
  it('by the height law (gain 1 and 0.5) and in F5 taps (looking every 1 / 2 s), from 16 m and 3 ft: touchdown under 5 kt of ground speed, not crashed (before: 17-29 kt and crashed from 16 m)', () => {
    const rows: Record<string, unknown> = {};
    for (const start of ['hover15', 'ige3'] as const) for (const [how, interval] of [['law', 1], ['lawHalf', 1], ['taps', 1], ['taps', 2]] as const) {
      const l = letDown(start, how, interval), name = `${start}/${how}/${interval}`;
      rows[name] = l;
      expect(l.crashed, name).toBe(false); expect(l.touch, name).not.toBeNull();
      expect(l.touch!.kt, name).toBeLessThan(5);
    }
    report.letDown = rows;
  }, 600_000);

  /** The same beginner holding the hover 60 s (the gate's h1 'level'; the height law on its start height). */
  function levelHover(start: 'hover15' | 'ige3', interval: number) {
    const r = keyRig({ start }), keys = new Keys(r);
    for (let i = 0; i < 60; i++) frame(r);
    const s0 = view(r), x0 = r.physics.state.position.x, y0 = r.physics.state.position.y;
    const step = targetBeginner(r, keys, interval, () => ({ pitch: s0.pitch, roll: 0, hdg: s0.hdg, z: s0.z }));
    let lostS: number | null = null, maxKt = 0, maxDrift = 0;
    const t0 = r.t;
    while (r.t - t0 < 60) {
      step(); keys.update(); frame(r);
      const s = r.physics.state, d = Math.hypot(s.position.x - x0, s.position.y - y0);
      maxKt = Math.max(maxKt, s.groundSpeed / KT); maxDrift = Math.max(maxDrift, d);
      if (lostS === null && (d > 30 || s.crashed)) lostS = r.t - t0;
      if (s.crashed) break;
    }
    keys.releaseAll();
    return { lostS, maxKt, maxDrift };
  }
  it('holding the hover 60 s looking every 2 s: within 30 m at 16 m and at 3 ft (before: past 30 m at 18.0 / 18.4 s, 24.5 / 21.9 kt)', () => {
    const rows = { hover15: levelHover('hover15', 2), ige3: levelHover('ige3', 2) };
    report.levelHover2 = rows;
    for (const [name, h] of Object.entries(rows)) expect(h.lostS, name).toBeNull();
  }, 300_000);
  /**
   * KNOWN LEVEL-TAPPER GAP (tune pass 2, recorded): looking every 1 s, the wings-level beginner never lets the arrow keys
   * rest 2.5 s, so in a level hover (no F5, no sink: not letting down) neither the re-centring nor the walk acts, and its
   * taps toward 0 deg of roll hold the keyed stick at the limit: it slides at 6.5-6.7 kt and passes 30 m at 20.5 / 20.9 s
   * (before 15.3 / 15.6 s at 31.6 / 25 kt, q2_land.base counted from the start of the rig, 1 s earlier). A shorter rest at height takes the 1 s roll tap's bank (7-11 deg at 3 s,
   * bo105Assist) away; the hint says to let the keys rest a few seconds in the hover. Once it lets down, it lands (above).
   */
  it.fails('KNOWN LEVEL-TAPPER GAP: holding the hover 60 s looking every 1 s it stays within 30 m at 16 m and at 3 ft (6.7 kt, past 30 m at 20.5 s)', () => {
    const rows = { hover15: levelHover('hover15', 1), ige3: levelHover('ige3', 1) };
    report.levelHover1 = rows;
    for (const [name, h] of Object.entries(rows)) expect(h.lostS, name).toBeNull();
  }, 300_000);
});

/**
 * Must 3 (the round-2 gate's h3 / h4 cruiseF5 and the g1 / g2 climb-outs): the bare collective keys in cruise. Above the
 * height hold's 30-40 KIAS fade the keys were the raw lever (0.12 of the travel per second), and the Bo 105's collective
 * couples strongly into pitch and roll at speed (M_col 0.063, L_col 0.052 rad/s^2 per % at 80 KCAS, AR-280 P; the raw
 * frozen-stick -5 % step: -19 deg pitch, -23 deg roll at 5 s, as the DLR / AFDD identified models): before, F5 held 2 s at
 * 100 KIAS with the beginner then holding the height gave 84 deg of attitude and 135 % torque, 4 s crashed at 7.8 s, and
 * with the collective left alone afterwards all four (60 / 100 KIAS, 2 / 4 s) flew into the ground; the climb-out at 1.5
 * m/s reached 101-111 % torque (q3_cruise.base). The held-key climb-rate command now works at every speed
 * (heightHold.held.everySpeed: the key's move taken back, the lever walked to 2 m/s up or down, stopped at the power
 * limit); a key let go above 40 KIAS leaves the lever where the command put it. After (q3_cruise.cfg2): the attitude
 * within 9 deg, the torque at most 63 %, no crash; the climb-out at most 86.3 %.
 */
describe('the keyboard collective in cruise (tune pass 2: the held-key climb-rate command at every speed)', () => {
  function cruiseKey(kias: number, key: 'F5' | 'F6', holdS: number, then: 'height' | 'alone') {
    const r = keyRig({ start: 'level', kias, heightM: 150 }), keys = new Keys(r);
    for (let i = 0; i < 60; i++) frame(r);
    const s0 = view(r);
    const step = targetBeginner(r, keys, 1, () => ({ pitch: s0.pitch, roll: 0, hdg: s0.hdg, z: then === 'height' && r.t > 2 + holdS ? s0.z : null }));
    let maxAtt = 0, maxTq = 0, minAgl = Infinity, crashedS: number | null = null;
    while (r.t < 40) {
      if (r.t >= 2 && r.t < 2 + holdS) keys.tap(key, 2 / 60);
      step(); keys.update(); frame(r);
      const s = r.physics.state;
      maxAtt = Math.max(maxAtt, Math.abs(s.roll) / DEG, Math.abs(s.pitch) / DEG); maxTq = Math.max(maxTq, torque(r)); minAgl = Math.min(minAgl, s.altitudeAGL);
      if (s.crashed) { crashedS = r.t; break; }
    }
    keys.releaseAll();
    return { crashedS, maxAtt, maxTq, minAgl };
  }
  it('F5 held 2 s and 4 s at 60 / 100 KIAS, the beginner then holding the height, and F6 held 4 s at 100 KIAS: attitude within 20 deg, torque under 90 %, no crash (before: 100 KIAS F5 2 s 84 deg / 135 %, 4 s crashed at 7.8 s; F6 4 s through 180 deg)', () => {
    const rows: Record<string, unknown> = {};
    for (const [kias, key, holdS] of [[60, 'F5', 2], [60, 'F5', 4], [100, 'F5', 2], [100, 'F5', 4], [100, 'F6', 4]] as const) {
      const c = cruiseKey(kias, key, holdS, 'height'), name = `${kias}/${key}/${holdS}`;
      rows[name] = c;
      expect(c.crashedS, name).toBeNull(); expect(c.maxAtt, name).toBeLessThanOrEqual(20); expect(c.maxTq, name).toBeLessThan(90);
    }
    report.cruiseCollective = rows;
  }, 300_000);
  it('F5 held 2 s and 4 s at 60 / 100 KIAS with the collective left alone afterwards: no crash in 40 s from 150 m, a gentle descent (before: all four flew into the ground at 7.5-17 s)', () => {
    const rows: Record<string, unknown> = {};
    for (const [kias, holdS] of [[60, 2], [60, 4], [100, 2], [100, 4]] as const) {
      const c = cruiseKey(kias, 'F5', holdS, 'alone'), name = `${kias}/${holdS}`;
      rows[name] = c;
      expect(c.crashedS, name).toBeNull(); expect(c.minAgl, name).toBeGreaterThan(50);
    }
    report.cruiseF5Alone = rows;
  }, 300_000);
  it('the by-hand climb-out from the 16 m and the 3 ft hover to 100 m at 1.5 m/s (8 deg nose down to 50 kt, then 60 kt), looking every 1 s: reached, torque never above 86.5 % (before: 104.9 %, from 3 ft 110.8 % and lost)', () => {
    const rows: Record<string, unknown> = {};
    for (const start of ['hover15', 'ige3'] as const) {
      const r = keyRig({ start }), keys = new Keys(r);
      for (let i = 0; i < 60; i++) frame(r);
      const s1 = view(r), zTop = s1.z - (100 - s1.agl), t1 = r.t;
      let phase: 'accel' | 'cruise' = 'accel', maxTq = 0, reached = false;
      const step = targetBeginner(r, keys, 1, () => {
        const s = r.physics.state, gs = s.groundSpeed / KT;
        if (phase === 'accel' && gs > 50) phase = 'cruise';
        const pitch = phase === 'accel' ? s1.pitch - 8 * DEG : Math.min(s1.pitch + 6 * DEG, Math.max(s1.pitch - 12 * DEG, s1.pitch - 4 * DEG + (gs - 60) * 0.3 * DEG));
        return { pitch, roll: 0, hdg: s1.hdg, z: Math.max(zTop, s1.z - 1.5 * (r.t - t1)) };
      });
      while (r.t - t1 < 120 && !reached) {
        step(); keys.update(); frame(r);
        const s = r.physics.state;
        maxTq = Math.max(maxTq, torque(r));
        reached = s.altitudeAGL > 95 && s.groundSpeed / KT > 50;
        if (s.crashed) break;
      }
      keys.releaseAll();
      rows[start] = { reached, maxTq, s: r.t - t1, crashed: r.physics.state.crashed };
      expect(reached, start).toBe(true); expect(maxTq, start).toBeLessThanOrEqual(86.5);
    }
    report.climbOut = rows;
  }, 300_000);
});

/**
 * Should 4 (round 2's recorded limit, W/tune2/bo105 q12_cruise): the tapping beginner above 110 KIAS, holding the attitude,
 * the wings level, the heading and the height (looks every 1 / 2 / 3 s). Round 2: the 1 s tapper lost control above
 * about 110 KIAS (120: the attitude through 180 deg; 140: crashed at 38.9 s), its raw collective taps coupling into pitch
 * and roll. With the climb-rate command at every speed the attitude holds; at 140 KIAS (above the maximum continuous
 * power) a held F6 first backed the lever off, so the height law's F6 taps lowered it and all three tappers flew into the
 * ground at 56-59 s; the back-off now never goes below where the key found the lever (heightHold.held.everySpeed), and
 * at 140 KIAS the beginner sinks slowly (27-32 m in 60 s: no power to climb at that speed) without a crash.
 */
describe('the tapping beginner at 120 and 140 KIAS (tune pass 2)', () => {
  it('looks every 1 / 2 / 3 s, 60 s from 100 m: no crash, the bank and the pitch off the trim within 20 deg (round 2: the 1 s tapper through 180 deg at 120, crashed at 140)', () => {
    const rows: Record<string, unknown> = {};
    for (const kias of [120, 140]) for (const interval of [1, 2, 3]) {
      const r = keyRig({ start: 'level', kias, heightM: 100 }), keys = new Keys(r);
      for (let i = 0; i < 60; i++) frame(r);
      const s0 = view(r);
      const step = targetBeginner(r, keys, interval, () => ({ pitch: s0.pitch, roll: 0, hdg: s0.hdg, z: s0.z }));
      let maxAtt = 0, crashedS: number | null = null, minAgl = Infinity;
      const t0 = r.t;
      while (r.t - t0 < 60) {
        step(); keys.update(); frame(r);
        const s = r.physics.state;
        // As the cruise row (bo105KeyTransitions): the bank, and the pitch away from the trimmed attitude.
        maxAtt = Math.max(maxAtt, Math.abs(s.roll) / DEG, Math.abs(s.pitch - s0.pitch) / DEG); minAgl = Math.min(minAgl, s.altitudeAGL);
        if (s.crashed) { crashedS = r.t - t0; break; }
      }
      keys.releaseAll();
      const name = `${kias}/${interval}`;
      rows[name] = { crashedS, maxAtt, minAgl, endKias: r.physics.state.ias / KT };
      expect(crashedS, name).toBeNull(); expect(maxAtt, name).toBeLessThanOrEqual(20);
    }
    report.highSpeedTappers = rows;
  }, 600_000);
});

/**
 * Should 4 (the round-2 gate's g1): the by-hand accelerations out of the hover, from 16 m and from 3 ft: nose down 8 or
 * 12 deg under the hover attitude until 50 kt (looking every 1 / 2 s), then 4 deg; the height law on the start height
 * or a 1.5 m/s climb of 30 m. Before, 5 of these 10 were lost (three flew into the ground accelerating at 3 ft, two
 * over-torqued climbing, 106-118 %; q3_cruise.base). After: 10 of 10, past 45 kt in 28-45 s (the limit makes the start
 * slower: 17-35 s before), torque at most 86.1 % (q3_cruise.cfg2).
 */
describe('by-hand accelerations out of the hover (tune pass 2)', () => {
  it('the five accelerations from 16 m and from 3 ft: not lost (attitude within 30 deg, no crash) and past 45 kt within 60 s, torque at most 86.5 % (before: 5 of 10 lost)', () => {
    const rows: Record<string, unknown> = {};
    for (const start of ['hover15', 'ige3'] as const) for (const [noseDown, interval, climb] of [[8, 1, 0], [12, 1, 0], [8, 2, 0], [8, 1, 30], [5, 1, 30]] as const) {
      const r = keyRig({ start }), keys = new Keys(r);
      for (let i = 0; i < 60; i++) frame(r);
      const s0 = view(r), t0 = r.t;
      let phase: 'accel' | 'cruise' = 'accel', maxAtt = 0, maxTq = 0, t45: number | null = null, crashed = false;
      const step = targetBeginner(r, keys, interval, () => {
        if (phase === 'accel' && r.physics.state.groundSpeed / KT > 50) phase = 'cruise';
        return { pitch: s0.pitch - (phase === 'accel' ? noseDown : 4) * DEG, roll: 0, hdg: s0.hdg,
          z: climb ? Math.max(s0.z - climb, s0.z - 1.5 * (r.t - t0)) : s0.z };
      });
      while (r.t - t0 < 60) {
        step(); keys.update(); frame(r);
        const s = r.physics.state;
        maxAtt = Math.max(maxAtt, Math.abs(s.roll) / DEG, Math.abs(s.pitch) / DEG); maxTq = Math.max(maxTq, torque(r));
        if (t45 === null && s.groundSpeed / KT > 45) t45 = r.t - t0;
        if (s.crashed) { crashed = true; break; }
      }
      keys.releaseAll();
      const name = `${start}/${noseDown}/${interval}/${climb}`;
      rows[name] = { crashed, maxAtt, maxTq, t45 };
      expect(crashed, name).toBe(false); expect(maxAtt, name).toBeLessThanOrEqual(30);
      expect(t45, name).not.toBeNull(); expect(maxTq, name).toBeLessThanOrEqual(86.5);
    }
    report.accelerations = rows;
  }, 900_000);
});

/**
 * Should 2 of the pass-2 gate (gate1 g10 holdSettle, k2): the hover hold (A) pressed at 42 kt at the end of the by-hand
 * acceleration (the gate's g10: lift-off from the runway, 3 s of hover, 8 deg nose down climbing 1.5 m/s, looking every 1
 * s) held 24.7 KIAS calm 15 s later (main 34.9). The hold captured the speed along the nose (observePilot.forwardSpeed):
 * at the press the beginner was sliding 34.6 kt sideways with the pedal at its left stop (the nose about 56 deg off the
 * track, pre-existing: main 23 kt sideways, held 33 kt), so it held 22.7 kt and turned the side speed away with 10 deg of
 * bank. SimProfile.heliHoldGroundSpeed (the Bo 105) captures the speed over the ground instead: held 42.0 kt, 41.9 KIAS
 * calm at 40 s, 48.9 into the 6 kt wind, 34.2 with it behind (a ground-speed hold, as the A route's turns are; fix1
 * f_hold). From the 16 m hover pressed at 35 / 42 / 45 kt: 34.9 / 41.8 / 44.8 KIAS at 40 s (37.3 at 42 before, k2).
 */
describe('the hover hold pressed at the end of a by-hand acceleration (tune pass 2 fix)', () => {
  function accelThenHold(start: 'runway' | 'hover15', dd?: AircraftDefinition) {
    const r = keyRig({ start, dd }), keys = new Keys(r);
    if (start === 'runway') { liftOffKeys(r, keys, 0); flyHover(r, keys, 3, hoverBeginner(r, keys)); } else for (let i = 0; i < 60; i++) frame(r);
    const s1 = view(r), t1 = r.t;
    const step = targetBeginner(r, keys, 1, () => ({ pitch: s1.pitch - 8 * DEG, roll: 0, hdg: s1.hdg, z: Math.max(s1.z - 60, s1.z - 1.5 * (r.t - t1)) }));
    while (r.t - t1 < 60 && r.physics.state.groundSpeed / KT <= 42 && !r.physics.state.crashed) { step(); keys.update(); frame(r); }
    keys.releaseAll();
    const press = { gs: r.physics.state.groundSpeed / KT, kias: r.physics.state.ias / KT };
    r.physics.setAutoflight(true);
    const held = r.physics.autoflight.autopilot.settings.airspeed / KT;
    for (let i = 0; i < 40 / (1 / 60); i++) frame(r);
    return { press, held, engaged: r.physics.autoflight.engaged, kias40: r.physics.state.ias / KT, crashed: r.physics.state.crashed };
  }
  it('A pressed at 42 kt after the gate\'s by-hand acceleration (from the runway, and from the 16 m hover) holds 35-45 KIAS calm 40 s later (before: 22.5 KIAS from the runway, the speed along the nose)', () => {
    const rows = { runway: accelThenHold('runway'), hover15: accelThenHold('hover15') };
    report.holdAfterAccel = rows;
    for (const [name, h] of Object.entries(rows)) {
      expect(h.press.gs, name).toBeGreaterThan(42); expect(h.engaged, name).toBe(true); expect(h.crashed, name).toBe(false);
      expect(h.kias40, name).toBeGreaterThanOrEqual(35); expect(h.kias40, name).toBeLessThanOrEqual(45);
    }
  }, 300_000);
  it('without heliHoldGroundSpeed the same press from the runway holds under 30 KIAS (the sideslipping acceleration\'s speed along the nose)', () => {
    const h = accelThenHold('runway', { ...def, sim: { ...def.sim, heliHoldGroundSpeed: undefined } });
    report.holdAfterAccelWithout = h;
    expect(h.kias40).toBeLessThan(30);
  }, 300_000);
});

/**
 * Must 1 of the pass-2 gate (gate1 g4 oeiCruise 100, k4; fix1 f_oei): one engine out in cruise with the beginner on the
 * keys. The height hold and the held-key climb-rate command stopped with the engine, so the beginner's height-law F6 / F5
 * taps were the raw lever: at 100 KIAS the collective pumped 0.34-0.46 against the survivor's topping (100-111 % torque,
 * NR 91-96 %), the collective's pitch coupling (M_col, checked P) and the late attitude taps built a pitch oscillation
 * past the series authority and it rolled inverted (round 2 and pass 2: crashed, 111.9 %, 179.9 deg). heightHold.oei keeps
 * the climb-rate command with one engine out above the 30-40 KIAS band, F6 stopped by the survivor's OEI limits (95 %
 * torque, 810 C, 105 % N1) and never backed off (an at-rest back-off at 0.01-0.05 per second over the limits flew the
 * hands-off and attitude-only beginners into the ground at 100 KIAS); below the band the keys stay raw (an OEI landing's
 * cushion pulls past the limits: held there, the 16 m hover landings crashed at 3.9-5.2 m/s, 2.1-2.3 raw).
 * Level flight at 100 KIAS (2200 kg) needs about 101 % of one engine (2 x 54 % before the cut), over the 95 % OEI
 * rating: the survivor tops out and it sinks about 1 m/s; the One engine out hint says to slow to about 70 KIAS.
 */
describe('one engine out in cruise with the beginner on the keys (tune pass 2 fix: heightHold.oei)', () => {
  function oei(kias: number, how: 'law1' | 'law0.5' | 'attOnly' | 'hint', dd?: AircraftDefinition) {
    const r = keyRig({ start: 'level', kias, heightM: 150, dd }), keys = new Keys(r);
    for (let i = 0; i < 120; i++) frame(r);
    const s0 = view(r), t0 = r.t;
    const hint = how === 'hint';
    // hint: the One engine out hint (a 0.5 s F5 tap at the warning, the nose eased up to slow to about 70 KIAS: 0.4 deg
    // per kt off 70 within -3 / +10 deg of the cruise attitude, the height held with the law).
    const step = targetBeginner(r, keys, 1, (s) => ({
      pitch: hint ? s0.pitch + clamp(0.4 * (Math.hypot(s.vx, s.vy) / KT - 70) * DEG, -3 * DEG, 10 * DEG) : s0.pitch,
      roll: 0, hdg: s0.hdg, z: how === 'attOnly' ? null : s0.z, collGain: how === 'law0.5' ? 0.5 : 1 }));
    let cut = false, tapped = false, tq5 = 0, nr5 = 200, tq20 = 0, nr20 = 200, maxAtt = 0;
    while (r.t - t0 < 62) {
      const t = r.t - t0;
      if (!cut && t >= 2) { lever(r.c, 1, LEVER.off); cut = true; }
      if (t >= 4) { if (hint && !tapped) { keys.tap('F5', 0.5); tapped = true; } step(); }
      keys.update(); frame(r);
      const s = r.physics.state, tq = torque(r), nr = s.rotorcraft!.turboshaft!.nrPct;
      if (t >= 7) { tq5 = Math.max(tq5, tq); nr5 = Math.min(nr5, nr); maxAtt = Math.max(maxAtt, Math.abs(s.roll) / DEG, Math.abs(s.pitch - s0.pitch) / DEG); }
      if (t >= 22) { tq20 = Math.max(tq20, tq); nr20 = Math.min(nr20, nr); }
      if (s.crashed) break;
    }
    keys.releaseAll();
    const s = r.physics.state;
    return { crashed: s.crashed, tq5, nr5, tq20, nr20, maxAtt, endAgl: s.altitudeAGL, endKias: s.ias / KT, dz: s.position.z - s0.z };
  }
  it('at 80 and 100 KIAS from 150 m the beginner holding the cruise attitude and the height (law gain 1 and 0.5) or the attitude alone: no crash in 60 s, NR at least 95 % and the attitude within 10 deg from 5 s after the cut (before: the law at 100 KIAS crashed at 33-43 s, NR 86-90 %)', () => {
    const rows: Record<string, unknown> = {};
    for (const kias of [80, 100]) for (const how of ['law1', 'law0.5', 'attOnly'] as const) {
      const h = oei(kias, how), name = `${kias}/${how}`;
      rows[name] = h;
      expect(h.crashed, name).toBe(false); expect(h.nr5, name).toBeGreaterThanOrEqual(95); expect(h.maxAtt, name).toBeLessThanOrEqual(10);
    }
    report.oeiCruise = rows;
  }, 600_000);
  it('the beginner following the One engine out hint (F5 tap, slow to about 70 KIAS, hold the height) at 100 and 120 KIAS: no crash, from 20 s after the cut the torque under 100 % and NR at least 95 %, within 30 m of the height at 60 s', () => {
    const rows: Record<string, unknown> = {};
    for (const kias of [100, 120]) {
      const h = oei(kias, 'hint'), name = `${kias}/hint`;
      rows[name] = h;
      expect(h.crashed, name).toBe(false); expect(h.tq20, name).toBeLessThan(100); expect(h.nr20, name).toBeGreaterThanOrEqual(95);
      expect(Math.abs(h.dz), name).toBeLessThanOrEqual(30);
    }
    report.oeiHint = rows;
  }, 300_000);
  it.fails('KNOWN OEI-CRUISE TORQUE GAP: at 100 KIAS the beginner holding the cruise attitude keeps the survivor under 100 % from 5 s after the cut (101.0 %: at its topping, NR 96.3 %; level flight there needs about 101 % of one engine)', () => {
    const h = oei(100, 'attOnly');
    report.oeiTorqueGap = h;
    expect(h.tq5).toBeLessThan(100);
  }, 120_000);
  it('without heightHold.oei the 100 KIAS beginner holding the height crashes (the raw lever against the topping)', () => {
    const t = def.input.stabilityAssist!;
    const h = oei(100, 'law1', { ...def, input: { ...def.input, stabilityAssist: { ...t, heightHold: { ...t.heightHold!, oei: undefined } } } });
    report.oeiWithout = h;
    expect(h.crashed).toBe(true);
  }, 120_000);
});
