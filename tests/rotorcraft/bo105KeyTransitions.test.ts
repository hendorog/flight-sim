// The Bo 105 keyboard transitions into the hover with the STAB ASSIST (the round-2 pilot gate's must items; probes
// W/bofly/pilot-r3, logs out/final): keys through the REAL InputSystem into the REAL SimPhysics, the gate's tapping
// beginner (tests/rotorcraft/bo105KeyPilot.ts). The gate found the hover lost after a runway lift-off at 18-25 s with
// every pedal technique and a keyboard deceleration from 45 / 30 KIAS crashing 2-10 s after the stop. Round 3: the
// lift-off is held (the cyclic term on light skids, the trim follow-up, the hold's own pedal authority); the
// deceleration is better (the stick 0.3-0.45 at the stop against 0.18, the stop reached more often) but still lost, now
// by the collective: the beginner lets go in an 8-12 m/s sink with the collective at 0.13-0.31 against the hover's
// 0.39, which the assist never touches. Pressing A below 25 kt hands it to the hold, which flies on at that speed
// without a loss (it hovers only when engaged under 3 m/s, about 6 kt). The gate's deceleration probe reset the physics
// after attaching the input module, which kept the hover's keyboard pedal (-0.42) against the 45 KIAS trim (+0.18): a
// 30 deg/s yaw at the start of every run; keyRig tells the input module of the reset, as the Simulator does.
import { afterAll, describe, expect, it } from 'vitest';
import { DEG, KT } from '../../src/core/math';
import type { AircraftDefinition } from '../../src/aircraft/types';
import { BO105_DEFINITION as def } from '../../src/aircraft/bo105';
import { MD500_DEFINITION } from '../../src/aircraft/md500';
import { hoverScenario } from '../../src/sim/rotorcraft/starts';
import { Keys, decelKeys, decelToHoverKeys, flyHover, frame, hoverBeginner, keyRig, liftOffKeys } from './bo105KeyPilot';
import { writeTrace } from './bo105Rig';

const report: Record<string, unknown> = {};
afterAll(() => writeTrace('bo105KeyTransitions', report));

/** The tuning with some fields removed (a definition copy). */
function withoutTuning(...keys: (keyof NonNullable<typeof def.input.stabilityAssist>)[]): AircraftDefinition {
  const t = { ...def.input.stabilityAssist! };
  for (const k of keys) delete t[k];
  return { ...def, input: { ...def.input, stabilityAssist: t } };
}

describe('keyboard lift-off from the runway into the 3 ft hover (the round-2 gate: lost at 18-25 s with every pedal technique)', () => {
  function liftOffHover(pedalS: number, dd?: AircraftDefinition) {
    const r = keyRig({ start: 'runway', dd }), keys = new Keys(r);
    const liftS = liftOffKeys(r, keys, pedalS);
    const hover = flyHover(r, keys, 30, hoverBeginner(r, keys));
    return { liftS, ...hover, pedalEnd: r.c.rudder, followed: { ...r.physics.stabilityAssist!.followed } };
  }
  /**
   * F6 held until the skids lift (about 2.9 s), the pedals untouched or KeyZ held for the first 2 s, then the tapping
   * beginner (0.8 s, 0.3 s late) holds the 3 ft hover for 30 s. Round 2 (this code at 8f543d3, pilot-r3
   * a_liftoff.v1.log): lost at 20.7 s (crashed, the heading round 180 deg, the skids dragging with the cyclic term off)
   * and 18.8 s (drifted 30 m). Without the follow-up and the hold's own authority the heading still goes round (180 /
   * 137 deg).
   */
  it('the tapping beginner holds the hover 30 s after a lift-off with no pedal and with 2 s of left pedal', () => {
    const none = liftOffHover(0), left = liftOffHover(2), r2 = liftOffHover(0, withoutTuning('followUp', 'holdAuthority'));
    report.liftOff = { none, left, withoutFollowUpAndHoldAuthority: r2 };
    for (const h of [none, left]) {
      expect(h.liftS).toBeGreaterThan(0);
      expect(h.lostS).toBeNull(); expect(h.crashed).toBe(false);
      expect(h.maxAttDeg).toBeLessThanOrEqual(20); expect(h.driftM).toBeLessThanOrEqual(25);
    }
    expect(none.maxHdgDeg).toBeLessThan(150);
    expect(r2.maxHdgDeg).toBeGreaterThan(170);
  }, 120_000);
  /**
   * Round 2's trap: 5 once, 2 s after a lift-off with the pedals untouched, threw the lift-off pedal away (42 deg/s,
   * the heading round 180 deg); round 3 kept the followed pedal (18 deg/s) but still threw a pedal set with the keys
   * away (KeyZ 2 s: 62 deg/s at most, 136 deg). The tune pass (item 3): 5 leaves the pedals where they are on the Bo 105
   * (InputProfile.centreKeepsPedals), so both are kept; the stick still glides back to the keyboard trim.
   */
  it('5 once after a lift-off keeps the pedal, untouched (followed) or set with the keys (KeyZ 2 s): yaw under 25 deg/s, the pedal unmoved by 5, no crash', () => {
    const run = (pedalS: number) => {
      const r = keyRig({ start: 'runway' }), keys = new Keys(r);
      const liftS = liftOffKeys(r, keys, pedalS), h0 = r.physics.state.heading;
      let maxRate = 0, maxHdg = 0, before = NaN, after = NaN;
      while (r.t < liftS + 12) {
        if (Math.abs(r.t - liftS - 2) < 1 / 120) { before = r.c.rudder; keys.tap('Digit5', 0.05); }
        keys.update(); frame(r);
        if (Number.isNaN(after) && !Number.isNaN(before)) after = r.c.rudder;
        const s = r.physics.state;
        maxRate = Math.max(maxRate, Math.abs(s.angularVelocity.z) / DEG);
        maxHdg = Math.max(maxHdg, Math.abs(Math.atan2(Math.sin(s.heading - h0), Math.cos(s.heading - h0))) / DEG);
        if (s.crashed) break;
      }
      return { liftS, maxRate, maxHdg, pedalBefore5: before, pedalAfter5: after, pedalEnd: r.c.rudder, crashed: r.physics.state.crashed };
    };
    const untouched = run(0), keyed = run(2);
    report.fiveAfterLiftOff = { untouched, keyed };
    for (const h of [untouched, keyed]) {
      expect(h.crashed).toBe(false);
      expect(h.maxRate).toBeLessThanOrEqual(25);
      // 5 moved nothing on the pedals (the follow-up's own step of that frame aside).
      expect(Math.abs(h.pedalAfter5 - h.pedalBefore5)).toBeLessThanOrEqual(0.005);
    }
    expect(untouched.pedalBefore5).toBeLessThan(-0.15);
    expect(keyed.pedalBefore5).toBeLessThan(-0.2);
  }, 60_000);
});

describe('keyboard deceleration from 45 KIAS to the hover (the round-2 gate: crashed 2-10 s after the stop)', () => {
  /**
   * The gate's beginner (nose up 8 deg while over 8 kt, taps every 1 / 2 / 3 s, 0.3 s late), now to a HOVER (ground speed
   * under 3 kt, |vz| under 1.5 m/s, attitude within 15 deg, for 2 s: decelToHoverKeys), then flying on with the hover
   * beginner for 20 s. Round 3 (pilot-r3 b_decel, and W/tune/bo105 d_hh 'none'): lost before the hover in every variant
   * (crashed or past 30 deg at 20-35 s; the "stop" it recorded was a tumble crossing 3 kt). The tune pass (STAB ASSIST
   * height hold and collective crossfeed; d_hh_final): reached in 9 of 10 variants and held flying on in all 9. The tenth,
   * 60 KIAS with 1 s taps, is lost at 12.6 s with or without the new aids (above their 40 KIAS band: the beginner's
   * own flare), recorded in KNOWN_ISSUES.
   */
  it('the tapping beginner reaches a hover from 45 KIAS (taps every 1 / 2 / 3 s, nose 8 or 12) and from 30 KIAS, and flying on holds it 20 s', () => {
    const rows: Record<string, unknown> = {};
    for (const [kias, interval, nose] of [[45, 1, 8], [45, 2, 8], [45, 3, 8], [45, 1, 12], [30, 1, 8]] as const) {
      const r = keyRig({ start: 'level', kias, heightM: 30 }), keys = new Keys(r);
      const d = decelToHoverKeys(r, keys, { interval, noseUpDeg: nose });
      keys.releaseAll();
      const after = d.hoverS !== null ? flyHover(r, keys, 20, hoverBeginner(r, keys)) : null;
      rows[`${kias}/${interval}/${nose}`] = { ...d, collective: r.c.collective, after };
      expect(d.hoverS, `${kias} KIAS, ${interval} s, nose ${nose}`).not.toBeNull();
      expect(after!.lostS).toBeNull(); expect(after!.crashed).toBe(false); expect(after!.maxAttDeg).toBeLessThanOrEqual(20);
    }
    report.decelFlyOn = rows;
  }, 300_000);
  /**
   * The same beginner letting go of every key at the hover, then 20 s hands off: not crashed and the attitude held (the
   * STAB ASSIST holds attitude, heading and height), but it drifts: the attitude datum at the moment of letting go is a
   * decelerating attitude, and an attitude hold does not hold position (ADS-33E's attitude command / attitude hold, not
   * translational rate command), so the 30 m drift limit is passed (d_hh_final: 8-16 s, attitude within 8 deg). Position
   * is the hover hold's (A: tests below). Round 3: lost in a 12 m/s sink with the collective at 0.13 (gate rig) before any
   * hover. Expected to fail while the STAB ASSIST holds attitude rather than position (KNOWN_ISSUES).
   */
  it.fails('KNOWN DRIFT GAP: the beginner who lets go at the hover holds it 20 s hands off (drifts past 30 m: the assist holds attitude, not position)', () => {
    const r = keyRig({ start: 'level', kias: 45, heightM: 30 }), keys = new Keys(r);
    const d = decelToHoverKeys(r, keys, { interval: 1, noseUpDeg: 8 });
    keys.releaseAll();
    report.decelLetGo = { ...d, collective: r.c.collective, elevator: r.c.elevator };
    expect(d.hoverS).not.toBeNull();
    const after = flyHover(r, keys, 20);
    report.decelLetGo = { ...(report.decelLetGo as object), after };
    expect(after.crashed).toBe(false); expect(after.maxAttDeg).toBeLessThanOrEqual(15);
    expect(after.lostS).toBeNull();
  }, 60_000);
  /**
   * What A does there (docs section 9, the hints): pressed (Simulator.toggleAutoflight's physics.setAutoflight) when
   * the same beginner has slowed under 25 kt of ground speed. Round 3: the hold engaged and flew on at that speed
   * (HelicopterAutopilot.engagementSpeed; pilot-r3 h_aroute: engaged at 35 / 25 / 15 kt, none lost, all still moving at
   * the end, 18 kt here). The tune pass (item 1, BO105_SIM.heliHoldSlowToHover): engaged below 30 kt it slows to a hover
   * at 1.5 kt/s and holds the position (W/tune/bo105 c_aslow.log: 25 kt, 1 s taps, the hover 11.3 s after A, attitude
   * within 14.5 deg). Above 30 kt the hold keeps the engagement speed, as on every helicopter.
   */
  it('the same beginner pressing A below 25 kt: the hold engages, slows to a hover within 25 s and holds it, attitude within 20 deg, not lost', () => {
    const r = keyRig({ start: 'level', kias: 45, heightM: 30 }), keys = new Keys(r);
    const at = decelKeys(r, keys, { interval: 1, noseUpDeg: 5, stopKt: 25 });
    keys.releaseAll();
    expect(at).not.toBeNull();
    const engagedKt = r.physics.state.groundSpeed / KT;
    r.physics.setAutoflight(true);
    const t0 = r.t;
    let hoverS: number | null = null, maxAtt = 0, lost = false;
    while (r.t - t0 < 40) {
      frame(r);
      const s = r.physics.state;
      maxAtt = Math.max(maxAtt, Math.abs(s.roll) / DEG, Math.abs(s.pitch) / DEG);
      if (hoverS === null && s.groundSpeed < KT) hoverS = r.t - t0;
      if (s.crashed || !r.physics.autoflight.engaged) { lost = true; break; }
    }
    const endKt = r.physics.state.groundSpeed / KT;
    report.decelHoverHold = { pressedAtS: at, engagedKt, hoverS, maxAtt, endKt, lost };
    expect(lost).toBe(false);
    expect(maxAtt).toBeLessThanOrEqual(20);
    expect(hoverS).not.toBeNull(); expect(hoverS!).toBeLessThanOrEqual(25);
    expect(endKt).toBeLessThan(1.5);
  }, 60_000);
  it('engaged above 30 kt the hold keeps the engagement speed (as on every helicopter)', () => {
    const r = keyRig({ start: 'level', kias: 45, heightM: 30 });
    for (let i = 0; i < 60; i++) frame(r);
    const engagedKt = r.physics.state.groundSpeed / KT;
    expect(engagedKt).toBeGreaterThan(40);
    r.physics.setAutoflight(true);
    for (let i = 0; i < 20 * 60; i++) frame(r);
    report.holdAbove30 = { engagedKt, endKt: r.physics.state.groundSpeed / KT };
    expect(r.physics.autoflight.engaged).toBe(true);
    expect(Math.abs(r.physics.state.groundSpeed / KT - engagedKt)).toBeLessThanOrEqual(3);
  }, 60_000);
});

/**
 * The tune pass, item 2 (BO105_SIM.hoverIntoWind; W/tune/bo105 j_wind_before / j_wind_after): the hover scenario
 * (hover=1) trimmed at zero airspeed in the default 8 kt wind started drifting with the air mass at 11.1 kt of ground
 * speed (the 16 m wind with its mechanical turbulence), and the round-2 gate's beginner crashed at 14-15 s; with the
 * round-3 aids and the height hold it drifted 19-24 m (and 30 m by 2.9 s with a 15 kt tailwind). Now it starts nose
 * into the wind at the start point, trimmed at that airspeed: still over the ground.
 */
describe('the hover scenario in wind starts into the wind, still over the ground (hover=1)', () => {
  it('8 kt wind: ground speed 0 at the start, the nose into the wind, and the tapping beginner holds it 60 s within 10 m (also with gusts, and a 15 kt wind from behind the runway heading)', () => {
    const rows: Record<string, unknown> = {};
    for (const wind of [{ fromDeg: 100, kt: 8 }, { fromDeg: 100, kt: 8, gustKt: 13, turbulence: 0.3 }, { fromDeg: 250, kt: 15 }]) {
      const r = keyRig({ start: 'hover15', wind }), keys = new Keys(r), s = r.physics.state;
      const gs0Kt = s.groundSpeed / KT, iasKt = s.ias / KT, hdgDeg = s.heading / DEG;
      const h = flyHover(r, keys, 60, hoverBeginner(r, keys));
      rows[`${wind.fromDeg}/${wind.kt}${wind.gustKt ? 'G' + wind.gustKt : ''}`] = { gs0Kt, iasKt, hdgDeg, ...h };
      expect(gs0Kt).toBeLessThan(0.1);
      expect(Math.abs(((hdgDeg - wind.fromDeg + 540) % 360) - 180)).toBeLessThanOrEqual(30);
      expect(h.lostS).toBeNull(); expect(h.driftM).toBeLessThanOrEqual(10);
    }
    report.hoverIntoWind = rows;
  }, 300_000);
  it('calm air: the start is unchanged (the runway heading, zero airspeed); the MD 500E\'s hover scenario still drifts with the air', () => {
    const calm = keyRig({ start: 'hover15' });
    expect(calm.physics.state.heading / DEG).toBeCloseTo(hoverScenario(calm.physics.env, def.rotorcraft!).ic.heading / DEG, 6);
    expect(calm.physics.state.ias).toBeLessThan(0.1);
    const md = keyRig({ start: 'hover15', dd: MD500_DEFINITION, assist: false, wind: { fromDeg: 100, kt: 8 } });
    expect(md.physics.state.ias).toBeLessThan(0.1);
    expect(md.physics.state.groundSpeed / KT).toBeGreaterThan(5);
  });
});

