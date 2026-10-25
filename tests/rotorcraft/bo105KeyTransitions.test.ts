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
import { Keys, decelKeys, decelToHoverKeys, flyHover, frame, hoverBeginner, keyRig, liftOffKeys, targetBeginner, type KeyRig } from './bo105KeyPilot';
import { writeTrace } from './bo105Rig';

const report: Record<string, unknown> = {};
afterAll(() => writeTrace('bo105KeyTransitions', report));

/** The tuning with some fields replaced (a definition copy). */
function withTuning(patch: Partial<NonNullable<typeof def.input.stabilityAssist>>): AircraftDefinition {
  return { ...def, input: { ...def.input, stabilityAssist: { ...def.input.stabilityAssist!, ...patch } } };
}
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** The tuning with some fields removed (a definition copy). */
function withoutTuning(...keys: (keyof NonNullable<typeof def.input.stabilityAssist>)[]): AircraftDefinition {
  const t = { ...def.input.stabilityAssist! };
  for (const k of keys) delete t[k];
  return { ...def, input: { ...def.input, stabilityAssist: t } };
}

describe('keyboard lift-off from the runway into the 3 ft hover (the round-2 gate: lost at 18-25 s with every pedal technique)', () => {
  function liftOffHover(pedalS: number, dd?: AircraftDefinition) {
    const r = keyRig({ start: 'runway', dd }), keys = new Keys(r), h0 = r.physics.state.heading;
    const liftS = liftOffKeys(r, keys, pedalS), step = hoverBeginner(r, keys);
    let swing6 = 0;
    const hover = flyHover(r, keys, 30, () => { step(); if (r.t - liftS < 6) swing6 = Math.max(swing6, Math.abs(wrap(r.physics.state.heading - h0)) / DEG); });
    return { liftS, ...hover, swing6, pedalEnd: r.c.rudder, followed: { ...r.physics.stabilityAssist!.followed } };
  }
  /**
   * F6 held until the skids lift (about 2.9 s), the pedals untouched or KeyZ held for the first 2 s, then the tapping
   * beginner (0.8 s, 0.3 s late) holds the 3 ft hover for 30 s. Round 2 (this code at 8f543d3, pilot-r3
   * a_liftoff.v1.log): lost at 20.7 s (crashed, the heading round 180 deg, the skids dragging with the cyclic term off)
   * and 18.8 s (drifted 30 m). Without the follow-up and the hold's own authority the heading still goes round (180 /
   * 137 deg).
   * Tune round 2 (W/tune/bo105 r2 p3 / p7): the crossfeed now also pedals the lift-off's collective on light skids
   * (pedalCrossfeed.onLightSkids) unless a pedal key was worked on the skids: the swing in the first 6 s after the
   * lift-off with the pedals untouched is 38.9 deg against 59.6 with the crossfeed airborne only; with 2 s of left pedal
   * it is unchanged (24.2). The largest heading over the whole 30 s comes from the hover with the skids brushing the
   * ground (the beginner holds the lift-off height, 0.1 m of skid clearance), whose skid friction swings the nose: it
   * scatters 40-140 deg over 12 beginner variants (intervals 0.6-1.2 s, lags 0.2-0.4 s) with or without the round-2 parts
   * (median 77 / 70 deg now, 93 / 68 before), so it keeps round 1's band (102.3 / 59.7 deg here; round 1 76.4 / 25.2).
   */
  it('the tapping beginner holds the hover 30 s after a lift-off with no pedal and with 2 s of left pedal; the crossfeed on light skids cuts the untouched lift-off swing (first 6 s) by more than 10 deg', () => {
    const none = liftOffHover(0), left = liftOffHover(2), r2 = liftOffHover(0, withoutTuning('followUp', 'holdAuthority'));
    const xfAir = liftOffHover(0, withTuning({ pedalCrossfeed: { ...def.input.stabilityAssist!.pedalCrossfeed!, onLightSkids: undefined } }));
    report.liftOff = { none, left, withoutFollowUpAndHoldAuthority: r2, crossfeedAirborneOnly: xfAir };
    expect(none.swing6).toBeLessThan(xfAir.swing6 - 10);
    expect(left.swing6).toBeLessThanOrEqual(30);
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
   * The same beginner letting go of every key at the hover, then 60 s hands off. Tune round 1 (the KNOWN DRIFT GAP row,
   * judged at 20 s): the attitude hold kept the decelerating attitude it was let go at, so it slid sideways past 30 m in
   * 10.5 s; flown on (the round-1 gate, gate1 g5_letgo) it reached 47 kt sideways 38 s after the let-go, weathercocked,
   * left the assist's band and crashed 41 s after the let-go. Tune round 2: the keyboard cyclic's translational rate
   * command (StabilityAssistTuning.translationalRate, ADS-33E TRC) leans the datums against the ground speed and walks
   * them to the zero-ground-speed trim once the stick rests, so it comes back to a hover over the ground (W/tune/bo105 r2
   * p1_ch1: 10.6 m in 60 s, 0.0 kt at the end; the 2 s taps 10.9 m, from 30 KIAS 10.7 m).
   */
  it('the beginner who lets go of every key at the hover holds it 60 s hands off: within 30 m, attitude within 15 deg (round 1: past 30 m in 10.5 s, crashed at 41 s)', () => {
    const r = keyRig({ start: 'level', kias: 45, heightM: 30 }), keys = new Keys(r);
    const d = decelToHoverKeys(r, keys, { interval: 1, noseUpDeg: 8 });
    keys.releaseAll();
    report.decelLetGo = { ...d, collective: r.c.collective, elevator: r.c.elevator };
    expect(d.hoverS).not.toBeNull();
    const after = flyHover(r, keys, 60);
    report.decelLetGo = { ...(report.decelLetGo as object), after, endKt: r.physics.state.groundSpeed / KT };
    expect(after.crashed).toBe(false); expect(after.maxAttDeg).toBeLessThanOrEqual(15);
    expect(after.lostS).toBeNull(); expect(after.driftM).toBeLessThanOrEqual(30);
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
      // A second hover start later in the session (the clock and fm.reset's wind both restart at 0): still over the ground.
      r.physics.resetTo(hoverScenario(r.physics.env, def.rotorcraft!), r.ctx.weather);
      const gsAgainKt = r.physics.state.groundSpeed / KT;
      rows[`${wind.fromDeg}/${wind.kt}${wind.gustKt ? 'G' + wind.gustKt : ''}`] = { gs0Kt, iasKt, hdgDeg, gsAgainKt, ...h };
      expect(gs0Kt).toBeLessThan(0.1); expect(gsAgainKt).toBeLessThan(0.1);
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


/**
 * Tune round 2 (the round-1 gate's g7_winddecel, W/tune/bo105 r2 p5b): the keyboard deceleration in the app's default
 * 6 kt wind and in 10 kt. The gate's beginner (decelToHoverKeys: wings level at every tap) reaches and holds the hover in
 * 7 of its 10 wind variants (round 1: 3; with the translational rate command alone 6, the cruise attitude hold keeps its
 * deceleration from 45 KIAS steadier, p5b_ch1). Its misses: wings level is not the hover trim (about 3.4 deg of left
 * roll), so in 10 kt with 1 s taps it slides sideways at 15-24 kt (the TRC leans the datum, the taps take it back), and in
 * a 6 / 10 kt tailwind with 1 s pedal taps it pirouettes (40-73 deg/s). A beginner who also looks at the ground below 8 kt
 * (driftAware: the hover beginner's 0.03 rad per m/s against the drift) reaches and holds the hover in all 10
 * (p5b_ch1da).
 */
describe('keyboard deceleration to the hover in the app\'s default 6 kt wind and a 10 kt tailwind (taps every 1 s, nose 8)', () => {
  it('a beginner who looks at the ground below 8 kt reaches the hover from 45 KIAS with the wind from ahead and from behind, and holds it 20 s flying on', () => {
    const rows: Record<string, unknown> = {};
    for (const [name, wind] of [['ahead', { fromDeg: 70, kt: 6 }], ['behind', { fromDeg: 250, kt: 6 }]] as const) {
      const r = keyRig({ start: 'level', kias: 45, heightM: 30, wind }), keys = new Keys(r);
      const d = decelToHoverKeys(r, keys, { interval: 1, noseUpDeg: 8, driftAware: true });
      keys.releaseAll();
      const after = d.hoverS !== null ? flyHover(r, keys, 20, hoverBeginner(r, keys)) : null;
      rows[name] = { ...d, after };
      expect(d.hoverS, name).not.toBeNull();
      expect(after!.lostS, name).toBeNull(); expect(after!.maxAttDeg).toBeLessThanOrEqual(20);
    }
    report.decelWind = rows;
  }, 300_000);
  /** The gate's own beginner (wings level at every tap) into the 6 kt wind with 1 s taps (round 1 and r2 p6_head6 with the
   *  TRC alone: no hover by 60 s, sliding sideways at about 18 kt at the end). */
  it('the gate\'s wings-level beginner reaches the hover from 45 KIAS into a 6 kt wind with 1 s taps (round 1: still at 27 kt after 60 s)', () => {
    const r = keyRig({ start: 'level', kias: 45, heightM: 30, wind: { fromDeg: 70, kt: 6 } }), keys = new Keys(r);
    const d = decelToHoverKeys(r, keys, { interval: 1, noseUpDeg: 8 });
    report.decelWindWingsLevel = { ...d, endKt: r.physics.state.groundSpeed / KT };
    expect(d.lostS).toBeNull();
    expect(d.hoverS).not.toBeNull();
  }, 120_000);
  /**
   * The same beginner in a 10 kt tailwind with 1 s taps: the nose goes round (73 deg/s at most) and there is no hover by
   * 60 s, 15.7 kt at the end (p5b_ch1; not lost, not crashed). Its 1 s pedal taps keep the heading hold from capturing
   * while the fin weathercocks it toward the wind; with 2 s taps it reaches the hover (33.7 s). Tune pass 2 fix (W/tune2/
   * bo105 fix1): with the TRC walk at 1 deg/s alone it reached the hover at 50.5 s; with the keyboard cyclic limit at
   * speed too (keyboardLimit.cruise: the stick held to 0.12 a press through the 15-30 kt band) it reaches none again,
   * 6.4 kt at 60 s. Expected to fail (KNOWN_ISSUES).
   */
  it.fails('KNOWN TAILWIND GAP: the wings-level beginner reaches the hover in a 10 kt tailwind with 1 s taps (6.4 kt at 60 s)', () => {
    const r = keyRig({ start: 'level', kias: 45, heightM: 30, wind: { fromDeg: 250, kt: 10 } }), keys = new Keys(r);
    const d = decelToHoverKeys(r, keys, { interval: 1, noseUpDeg: 8 });
    report.decelTailwind10 = { ...d, endKt: r.physics.state.groundSpeed / KT };
    expect(d.lostS).toBeNull();
    expect(d.hoverS).not.toBeNull();
  }, 120_000);
});

/**
 * Tune round 2 (the round-1 gate's issue 3 and its g10_aroute): the route for the keyboard beginner into cruise and back
 * is the hover hold, A. By hand above the STAB ASSIST's band the raw aircraft departs on a collective or cyclic step
 * (gate1 g6 / g11: pre-existing, KNOWN_ISSUES); the hints send the beginner through A. Lift-off from the runway, a 3 s
 * hover, nose 8 deg down by hand to 35 kt of ground speed climbing (above 30 so A holds the speed rather than slowing to a
 * hover, and short of the fade band's top where by hand the 6 kt wind run departed at 43 KIAS going on to 42 kt, r2
 * p9_aturn), A (it holds about the speed it was engaged at), a 180 deg turn on the
 * heading bug (G held) and a 10 s leg, A off (no control step: the attitude moves under 3 deg in the next 2 s; let go
 * the moment the turn ends, while the hold still rolls out, 5.8 deg), by hand down to 28 kt,
 * A again (below 30 kt it slows to a hover: BO105_SIM.heliHoldSlowToHover), A off 5 s after it reaches the hover (it
 * arrives with the nose still 9 deg up from its stop: let go at once, the attitude moves 7.7 deg in 2 s, W/tune/bo105 r2
 * p8_aoff), a 5 s hover and the landing with F5 held (the height hold's climb-rate command). Calm and in the app's 6 kt
 * wind.
 */
describe('the A route: lift-off, by hand to 35 kt, A, a heading-bug turn, A off, by hand to 28 kt, A to the hover, land with F5 held', () => {
  function aRoute(wind?: { fromDeg: number; kt: number }) {
    const r = keyRig({ start: 'runway', wind }), keys = new Keys(r), st: Record<string, unknown> = {};
    let crashed = false;
    const fly = (maxS: number, step: (() => void) | null, until: () => boolean): boolean => {
      const t0 = r.t;
      while (r.t - t0 < maxS) {
        step?.(); keys.update(); frame(r);
        if (r.physics.state.crashed) { crashed = true; return false; }
        if (until()) return true;
      }
      return false;
    };
    const handover = (label: string): number => {
      const s0 = { pitch: r.physics.state.pitch, roll: r.physics.state.roll };
      let dAtt = 0;
      for (let i = 0; i < 120; i++) { frame(r); const s = r.physics.state; dAtt = Math.max(dAtt, Math.abs(s.pitch - s0.pitch) / DEG, Math.abs(s.roll - s0.roll) / DEG); }
      st[label] = { dAtt };
      return dAtt;
    };
    const gs = (): number => r.physics.state.groundSpeed / KT;
    st.liftS = liftOffKeys(r, keys, 0);
    flyHover(r, keys, 3, hoverBeginner(r, keys));
    const s1 = { ...r.physics.state, z: r.physics.state.position.z }, tA = r.t;
    const accel = targetBeginner(r, keys, 1, () => ({ pitch: s1.pitch - 8 * DEG, roll: 0, hdg: s1.heading, z: Math.max(s1.z - 60, s1.z - 1.5 * (r.t - tA)) }));
    st.accel = fly(60, accel, () => gs() > 35);
    keys.releaseAll();
    if (st.accel !== true) return { st, crashed };
    r.physics.setAutoflight(true);
    fly(15, null, () => false);
    st.engagedKt = gs();
    const target = wrap(r.physics.state.heading + Math.PI), targetDeg = ((target / DEG) + 360) % 360;
    st.turn = fly(120, () => { const d = ((targetDeg - r.c.headingBugDeg + 540) % 360) - 180; if (Math.abs(d) > 3) keys.tap('KeyG', 2 / 60); },
      () => Math.abs(wrap(r.physics.state.heading - target)) < 5 * DEG && Math.abs(r.physics.state.angularVelocity.z) < DEG);
    keys.releaseAll();
    fly(10, null, () => false);
    st.engagedAfterTurn = r.physics.autoflight.engaged;
    r.physics.setAutoflight(false);
    handover('offAtCruise');
    st.decel = decelKeys(r, keys, { interval: 1, noseUpDeg: 5, stopKt: 28, maxS: r.t + 60 }) !== null;
    keys.releaseAll();
    if (st.decel !== true || r.physics.state.crashed) return { st, crashed: r.physics.state.crashed };
    r.physics.setAutoflight(true);
    st.slowToHover = fly(45, null, () => gs() < 1 && Math.abs(r.physics.state.velocity.z) < 0.3);
    // The hold arrives with the nose still up from its stop (9 deg); the beginner lets it settle a few seconds first.
    fly(5, null, () => false);
    r.physics.setAutoflight(false);
    handover('offAtHover');
    const h2 = flyHover(r, keys, 5, hoverBeginner(r, keys));
    st.hover = { lostS: h2.lostS, driftM: h2.driftM };
    const sL = { pitch: r.physics.state.pitch, roll: r.physics.state.roll, hdg: r.physics.state.heading };
    const att = targetBeginner(r, keys, 1, () => ({ pitch: sL.pitch, roll: sL.roll, hdg: sL.hdg, z: null }));
    let touchVz: number | null = null;
    st.landed = fly(120, () => { att(); keys.tap('F5', 2 / 60); }, () => { if (r.physics.state.onGround) touchVz = r.physics.state.velocity.z; return touchVz !== null; });
    keys.releaseAll();
    st.touchVz = touchVz;
    return { st, crashed: crashed || r.physics.state.crashed };
  }
  it('calm and in a 6 kt wind: every stage done, no crash, A off moves the attitude under 3 deg in 2 s, touchdown under 1.5 m/s', () => {
    const rows: Record<string, unknown> = {};
    for (const [name, wind] of [['calm', undefined], ['wind6', { fromDeg: 100, kt: 6 }]] as const) {
      const { st, crashed } = aRoute(wind);
      rows[name] = { ...st, crashed };
      report.aRoute = rows;
      expect(crashed, name).toBe(false);
      expect(st.accel, name).toBe(true); expect(st.turn, name).toBe(true); expect(st.engagedAfterTurn, name).toBe(true);
      expect(st.decel, name).toBe(true); expect(st.slowToHover, name).toBe(true); expect(st.landed, name).toBe(true);
      expect((st.offAtCruise as { dAtt: number }).dAtt, name).toBeLessThan(3); expect((st.offAtHover as { dAtt: number }).dAtt, name).toBeLessThan(3);
      expect((st.hover as { lostS: number | null }).lostS, name).toBeNull();
      expect(st.touchVz as number, name).toBeLessThan(1.5);
    }
  }, 600_000);
});

/**
 * Tune round 2 (the round-1 gate's g6_cruise, issue 3's "either owner" should; StabilityAssistTuning.cruiseHold): the
 * keyboard cyclic keeps the STAB ASSIST's attitude hold through cruise. The gate's tapping beginner (looks 0.3 s late
 * every 1 / 2 / 3 s, taps toward the trimmed attitude, wings level, the heading and the height) at 60 / 80 / 100 KIAS:
 * without it 10 of 15 of the gate's cases crashed at 14-52 s (the raw aircraft departs on the taps' couplings, gate1
 * g11); with it none in 60 s (W/tune/bo105 r2 p12_ch1). Above about 110 KIAS the 1 s tapper still loses it (KNOWN_ISSUES).
 */
describe('cruise on the keys (the keyboard cyclic\'s cruise attitude hold)', () => {
  function cruise(kias: number, interval: number, dd?: AircraftDefinition) {
    const r = keyRig({ start: 'level', kias, heightM: 100, dd }), keys = new Keys(r);
    for (let i = 0; i < 60; i++) frame(r);
    const s0 = { pitch: r.physics.state.pitch, hdg: r.physics.state.heading, z: r.physics.state.position.z };
    const step = targetBeginner(r, keys, interval, () => ({ pitch: s0.pitch, roll: 0, hdg: s0.hdg, z: s0.z }));
    let maxAtt = 0, crashedS: number | null = null;
    const t0 = r.t;
    while (r.t - t0 < 60) {
      step(); keys.update(); frame(r);
      const s = r.physics.state;
      maxAtt = Math.max(maxAtt, Math.abs(s.roll) / DEG, Math.abs(s.pitch - s0.pitch) / DEG);
      if (s.crashed) { crashedS = r.t - t0; break; }
    }
    keys.releaseAll();
    return { crashedS, maxAtt, endKias: r.physics.state.ias / KT };
  }
  it('the tapping beginner holds 60 / 80 / 100 KIAS for 60 s with taps every 1 / 2 / 3 s, the attitude within 20 deg (without the cruise hold the 1 s tapper at 80 KIAS crashes)', () => {
    const rows: Record<string, unknown> = {};
    for (const kias of [60, 80, 100]) for (const interval of [1, 2, 3]) {
      const c = cruise(kias, interval);
      rows[`${kias}/${interval}`] = c;
      expect(c.crashedS, `${kias} KIAS, ${interval} s`).toBeNull(); expect(c.maxAtt, `${kias} KIAS, ${interval} s`).toBeLessThanOrEqual(20);
    }
    const without = cruise(80, 1, withTuning({ cruiseHold: undefined }));
    rows.withoutCruiseHold80 = without;
    report.cruiseKeys = rows;
    expect(without.crashedS).not.toBeNull();
  }, 600_000);
});
