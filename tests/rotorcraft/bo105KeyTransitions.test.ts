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
import { Keys, decelKeys, flyHover, frame, hoverBeginner, keyRig, liftOffKeys } from './bo105KeyPilot';
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
   * The gate's beginner: nose up 8 deg, taps every 1 s, lets go of every key when the ground speed is under 3 kt, then
   * 20 s hands off. Measured (pilot-r3 out/final b_decel.log, ground speed as the stop): stop 21.2 s, lost at 23.1 s in
   * a 12 m/s sink, the collective 0.13 (the hover's is 0.39), the stick 0.38 (gate rig: 0.18). Expected to fail until
   * the keyboard collective is part of the answer; it fails as long as the hover is lost.
   */
  it.fails('the tapping beginner who lets go at the stop holds the hover for 20 s (recorded: lost in a sink with the collective low)', () => {
    const r = keyRig({ start: 'level', kias: 45, heightM: 30 }), keys = new Keys(r);
    const stop = decelKeys(r, keys, { interval: 1, noseUpDeg: 8, stopKt: 3 });
    keys.releaseAll();
    report.decelLetGo = { stop, collective: r.c.collective, elevator: r.c.elevator };
    expect(stop).not.toBeNull();
    const after = flyHover(r, keys, 20);
    report.decelLetGo = { ...(report.decelLetGo as object), after };
    expect(after.lostS).toBeNull();
  }, 60_000);
  /**
   * What A does there (docs section 9, the hints): pressed (Simulator.toggleAutoflight's physics.setAutoflight) when
   * the same beginner has slowed under 25 kt of ground speed, the hold engages and flies 25 s without a loss, attitude
   * within 20 deg. It holds the speed it was engaged at, the heading and the height
   * (HelicopterAutopilot.engagementSpeed); it slows to a hover only when engaged under 3 m/s of ground speed (about 6
   * kt), which this beginner does not reach (pilot-r3 h_aroute: engaged at 35 / 25 / 15 kt, none lost, all still moving
   * at the end). So A is a way out of the deceleration, not a way into the hover.
   */
  it('the same beginner pressing A below 25 kt: the hold engages and flies 25 s without a loss, attitude within 20 deg, still moving (it holds the speed)', () => {
    const r = keyRig({ start: 'level', kias: 45, heightM: 30 }), keys = new Keys(r);
    const at = decelKeys(r, keys, { interval: 1, noseUpDeg: 5, stopKt: 25 });
    keys.releaseAll();
    expect(at).not.toBeNull();
    const engagedKt = r.physics.state.groundSpeed / KT;
    r.physics.setAutoflight(true);
    // The hold keeps flying at its engagement speed: no drift limit here.
    const after = flyHover(r, keys, 25, undefined, Infinity);
    const endKt = r.physics.state.groundSpeed / KT;
    report.decelHoverHold = { pressedAtS: at, engagedKt, engaged: r.physics.autoflight.engaged, after, endKt };
    expect(r.physics.autoflight.engaged).toBe(true);
    expect(after.lostS).toBeNull(); expect(after.flownS).toBeGreaterThan(24.9);
    expect(after.crashed).toBe(false); expect(after.maxAttDeg).toBeLessThanOrEqual(20);
    expect(endKt).toBeGreaterThan(10);
  }, 60_000);
});
