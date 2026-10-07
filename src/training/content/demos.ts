// Demonstration scripts flown by the copilot (section 2.7) and the recovery scripts used by safety
// interventions (section 3.8). Every script is flown in node tests with the real flight model
// (tests/training/instructorPilot*.test.ts), from the start its lesson uses.
//
// HOW THE COPILOT READS THESE (src/training/copilot/instructorPilot.ts)
//   - `ap` fields merge onto the previous segment's: `ap: {}` keeps flying what was set. A mode switched on
//     without its target holds the present value (vertical 'altitude' without altFt holds this altitude).
//     A script starts from wings level, altitude hold at the present altitude, no autothrottle.
//   - Headings are DG headings and altitudes indicated (what the student reads); the copilot converts.
//   - `set` writes a control every step of the segment (a Ramp moves it linearly from where it was); the
//     control then stays where the segment left it.
//   - Refs are resolved once, at segment start. Besides the lesson's vars, a script may use the values
//     captured when it started: DEMO_START_VARS (`v('demo.altFt')` = the altitude when the demo began).
//   - `until` predicates are evaluated with the runner's EvalContext; `timeoutS` ends the demo 'timeout'.
//     `abortWhen` switches to the recovery script.
//   - Autoflight plans are in SI, as sim/scenarios.ts defines them (runway 07 only).
//
// Spoken cues are line ids; DEMO_LINES gives each a default line in the instructor's voice, which
// content/lines.ts may override.

import { DEG, FT } from '../../core/math';
import { AIRPORT } from '../../core/world';
import { PATTERN_ALTITUDE } from '../../sim/scenarios';
import { all, any, eq, ge, gt, held, le, lt, near, sig, speechIdle, v, vs } from '../engine/dsl';
import type { DemoAp, DemoScript, DemoSegment, InlineCue, LineTable, Pred } from '../types';

/** Variables every script may refer to: captured from the telemetry frame when the script starts. */
export const DEMO_START_VARS = ['demo.altFt', 'demo.hdgDeg', 'demo.kias', 'demo.aglFt', 'demo.throttle', 'demo.flapsDeg'] as const;

const RWY_HDG = AIRPORT.runway.heading;
/** Runway 07 headings, DG degrees (no magnetic variation in this world). */
const HDG_RWY = 70;
const HDG_CROSSWIND = 340;
const HDG_DOWNWIND = 250;
const HDG_BASE = 160;
/** Height above the field (ft) of the field-relative levels used below. */
const fieldFt = (ft: number): number => Math.round(AIRPORT.elevation / FT + ft);

/** Ever true: a segment that only applies `set`s and moves on (the next tick). */
const now: Pred = { const: true };
/** True `s` seconds after the segment started (held from segment start). */
const after = (s: number): Pred => held(now, s);
/** Wings level within `deg` for `s` seconds. */
const wingsLevel = (deg = 3, s = 3): Pred => held(near('bankDeg', 0, deg), s);
/** Settled: wings level and no vertical speed to speak of. */
const settled = (s = 3): Pred => held(all(near('bankDeg', 0, 3), near('vsFpm', 0, 150)), s);
/**
 * Settled, and the instructor has finished speaking: the segment before a control movement waits for both,
 * so the next movement's line is heard as the control moves (wave-3 playtest: in the effects-of-controls
 * demos the lines queued behind each other and the captions ran about 5 s behind the movements).
 */
const settledQuiet = (s = 3): Pred => all(settled(s), speechIdle());
/** |bank| above `deg` (no abs in the predicate language). */
const bankBeyond = (deg: number): Pred => any(gt('bankDeg', deg), lt('bankDeg', -deg));
/** Keep demos in the training envelope; anything worse goes to the recovery. */
const upperAirAbort = (minAglFt = 1000, maxBank = 50): Pred => any(lt('aglFt', minAglFt), bankBeyond(maxBank), gt('kias', 135), gt('stallFrac', 0.3));

// =============================================================================================================
// Stage 1: handling
// =============================================================================================================

/** L01: the primary effect of each control, one at a time, hands-off in between (training area, 100 kt). */
const primaryEffects: DemoScript = {
  id: 'primaryEffects',
  segments: [
    { kind: 'ap', say: 'demo.primaryEffects.intro', ap: { lateral: 'wingLeveler', vertical: 'altitude', altFt: v('demo.altFt') }, until: settledQuiet(3), timeoutS: 30 },
    { kind: 'pulse', say: 'demo.primaryEffects.elevator', control: 'elevator', amount: 0.05, holdS: 2 },
    { kind: 'pause', s: 2 },
    { kind: 'ap', say: 'demo.primaryEffects.recover', ap: {}, until: settledQuiet(3), timeoutS: 40 },
    { kind: 'pulse', say: 'demo.primaryEffects.aileron', control: 'aileron', amount: 0.15, holdS: 2 },
    { kind: 'pause', s: 2 },
    { kind: 'ap', say: 'demo.primaryEffects.recover', ap: {}, until: settledQuiet(3), timeoutS: 40 },
    { kind: 'pulse', say: 'demo.primaryEffects.rudder', control: 'rudder', amount: 0.3, holdS: 2.5 },
    { kind: 'ap', say: 'demo.primaryEffects.done', ap: {}, until: settled(3), timeoutS: 40 },
  ],
  abortWhen: upperAirAbort(1000, 45),
};

/**
 * The climb attitude held on the elevator and the wings held level on the ailerons, feet off (no yaw damper):
 * the yaw shows as yaw, the nose swinging left with the ball out to the right (round 7, item 9: with the wings
 * free as well, the yaw rolled into a left turn, the ball barely moved and right rudder did not stop the swing).
 */
const CLIMB_PITCH_FEET_OFF: DemoAp = { lateral: 'wingLeveler', vertical: 'pitch', pitchDeg: 8, yawDamper: false, autoTrim: false };

/** L01: further effects: rudder rolls, aileron yaws, power pitches and yaws, flap pitches, trim holds. */
const furtherEffects: DemoScript = {
  id: 'furtherEffects',
  segments: [
    { kind: 'ap', say: 'demo.furtherEffects.intro', ap: { lateral: 'wingLeveler', vertical: 'altitude', altFt: v('demo.altFt') }, until: settledQuiet(3), timeoutS: 30 },
    { kind: 'pulse', say: 'demo.furtherEffects.rudderRoll', control: 'rudder', amount: 0.35, holdS: 4 },
    { kind: 'ap', ap: {}, until: settledQuiet(3), timeoutS: 40 },
    { kind: 'pulse', say: 'demo.furtherEffects.adverseYaw', control: 'aileron', amount: -0.25, holdS: 1.5 },
    { kind: 'ap', ap: {}, until: settledQuiet(3), timeoutS: 40 },
    // Power: from climb speed, level and trimmed, then hands and feet off, so the yaw and the skid show (owner
    // playtest: "the yaw from adding power looks much too low"; playtest 3: flown at 102 KIAS with the autopilot's
    // 0.064 of right rudder still in, the heading did not move). Then right rudder, power still on, stops it and
    // centres the ball (about a quarter of the pedal at climb speed).
    { kind: 'ap', say: 'demo.furtherEffects.powerSlow', ap: { lateral: 'wingLeveler', vertical: 'altitude', altFt: v('demo.altFt'), kias: 68, autothrottle: true }, until: held(lt('kias', 71), 3), timeoutS: 90 },
    // The nose is held at the climb attitude (hands-off it rose past 30 degrees in 9 s) and the wings level;
    // the feet are off. Then a quarter of right pedal (the balanced full-power climb, README) centres the ball
    // and stops the swing.
    { kind: 'raw', say: 'demo.furtherEffects.power', hold: { throttle: 1, rudder: 0 }, ap: CLIMB_PITCH_FEET_OFF, forS: 6 },
    { kind: 'raw', say: 'demo.furtherEffects.powerRudder', hold: { throttle: 1, rudder: 0.25 }, ap: CLIMB_PITCH_FEET_OFF, forS: 6 },
    // Feet back to the yaw damper as the power comes off (the 0.25 of pedal stayed in through the level-off).
    { kind: 'ap', say: 'demo.furtherEffects.powerBack', ap: { lateral: 'wingLeveler', vertical: 'altitude', altFt: v('demo.altFt'), kias: 78, autothrottle: true, yawDamper: true }, until: settledQuiet(3), timeoutS: 60 },
    // Flap only inside the white arc: slow to below VfeFull first, holding the height (the copilot's flap gate
    // would hold the lever anyway, but the patter must teach the speed check).
    { kind: 'ap', say: 'demo.furtherEffects.flapSpeed', ap: { lateral: 'wingLeveler', vertical: 'altitude', altFt: v('demo.altFt'), kias: 78, autothrottle: true }, until: held(lt('kias', 84), 2), timeoutS: 90 },
    // Hands off (no autopilot axes) while the flap runs: the nose pitches up and the aircraft balloons.
    { kind: 'ap', say: 'demo.furtherEffects.flap', ap: { lateral: 'off', vertical: 'off', yawDamper: false, autoTrim: false }, set: { flapsDeg: { to: 10, overS: 4 } }, until: any(after(5), gt('pitchDeg', 15)), timeoutS: 8 },
    // Level the balloon off gently: the nose back to the cruise attitude at a slewed rate first, then hold
    // the vertical speed at zero (back to the old altitude at once would push toward zero g).
    { kind: 'ap', say: 'demo.furtherEffects.flapUp', ap: { lateral: 'wingLeveler', vertical: 'pitch', pitchDeg: 2, yawDamper: true, autoTrim: true }, set: { flapsDeg: { to: 0, overS: 6 } }, until: held(near('pitchDeg', 2, 1.5), 2), timeoutS: 20 },
    { kind: 'ap', ap: { vertical: 'verticalSpeed', vsFpm: 0 }, set: { throttle: { to: v('demo.throttle'), overS: 3 } }, until: all(lt('flapsDeg', 1), settledQuiet(3)), timeoutS: 60 },
    { kind: 'ap', say: 'demo.furtherEffects.trim', ap: { vertical: 'altitude' }, until: held(lt('untrimmedS', 1), 5), timeoutS: 40 },
  ],
  abortWhen: upperAirAbort(1000, 45),
};

/** L03 (and L19 radial scan): straight and level, a power reduction to 80 kt, then back to cruise. */
const straightLevel: DemoScript = {
  id: 'straightLevel',
  segments: [
    { kind: 'ap', say: 'demo.straightLevel.attitude', ap: { lateral: 'heading', hdgDeg: v('demo.hdgDeg'), vertical: 'altitude', altFt: v('demo.altFt') }, until: settled(10), timeoutS: 40 },
    { kind: 'ap', say: 'demo.straightLevel.slow', ap: { autothrottle: true, kias: 80 }, until: held(near('kias', 80, 3), 5), timeoutS: 120 },
    { kind: 'ap', say: 'demo.straightLevel.cruise', ap: { kias: v('demo.kias') }, until: held(near('kias', v('demo.kias'), 3), 5), timeoutS: 150 },
  ],
  abortWhen: upperAirAbort(1000, 35),
};

/**
 * L04, section 2.12, with the entry flown as a pilot would: the nose raised to the climb attitude at a hand's
 * rate first, and the airspeed mode only once the speed is near Vy. (Wave-3 calibration: the airspeed mode
 * straight from cruise zoomed, 2.4 g and 25 degrees a second of pitch.) Needs the lesson vars alt0 and hdg0
 * (captured just before the demo step).
 */
const climbLevelOff: DemoScript = {
  id: 'climbLevelOff',
  segments: [
    { kind: 'ap', say: 'L04.demoClimbEntry', ap: { lateral: 'heading', hdgDeg: v('hdg0'), vertical: 'pitch', pitchDeg: 11, autoTrim: true },
      set: { throttle: { to: 1, overS: 2 } }, until: lt('kias', vs('Vy', 10)), timeoutS: 40 },
    { kind: 'ap', ap: { vertical: 'airspeed', kias: vs('Vy') }, until: all(gt('vsFpm', 400), held(near('kias', vs('Vy'), 4), 5)), timeoutS: 40 },
    { kind: 'ap', say: 'L04.demoLeadLevelOff', ap: {}, until: ge('altFt', v('alt0', 950)), timeoutS: 150 },
    { kind: 'ap', say: 'L04.demoApt', ap: { vertical: 'altitude', altFt: v('alt0', 1000) }, set: { throttle: { to: 0.72, overS: 4 } },
      until: held(near('vsFpm', 0, 100), 8), timeoutS: 40 },
  ],
  abortWhen: lt('aglFt', 1500),
};

/**
 * L04: glide at best glide speed, level off 500 ft lower with power (APT). The throttle closes with the
 * height held until the speed is near Vglide, then the nose goes down to the glide attitude: pitching to
 * Vglide straight from cruise would zoom.
 */
const glideLevelOff: DemoScript = {
  id: 'glideLevelOff',
  segments: [
    { kind: 'ap', say: 'demo.glide.entry', ap: { lateral: 'heading', hdgDeg: v('demo.hdgDeg'), vertical: 'altitude', altFt: v('demo.altFt') },
      set: { throttle: { to: 0, overS: 2 } }, until: lt('kias', vs('Vglide', 4)), timeoutS: 60 },
    { kind: 'ap', say: 'demo.glide.attitude', ap: { vertical: 'airspeed', kias: vs('Vglide') }, until: le('altFt', v('demo.altFt', -450)), timeoutS: 120 },
    { kind: 'ap', say: 'demo.glide.levelOff', ap: { vertical: 'altitude', altFt: v('demo.altFt', -500), autothrottle: true, kias: v('demo.kias') },
      until: held(near('vsFpm', 0, 100), 6), timeoutS: 90 },
  ],
  abortWhen: upperAirAbort(1000, 35),
};

/** L05: a 30 degree turn left through 180 with the roll-out lead (half the bank), then back to the right. */
const mediumTurn: DemoScript = {
  id: 'mediumTurn',
  segments: [
    { kind: 'ap', say: 'demo.mediumTurn.lookout', ap: { lateral: 'heading', hdgDeg: v('demo.hdgDeg'), vertical: 'altitude', altFt: v('demo.altFt') }, until: settled(3), timeoutS: 30 },
    { kind: 'ap', say: 'demo.mediumTurn.rollIn', ap: { lateral: 'bank', bankDeg: -30, maxBankDeg: 35 }, until: near('hdgDeg', v('demo.hdgDeg', 195), 3), timeoutS: 90 },
    { kind: 'ap', say: 'demo.mediumTurn.rollOut', ap: { lateral: 'heading', hdgDeg: v('demo.hdgDeg', 180), maxBankDeg: 30 }, until: wingsLevel(3, 3), timeoutS: 30 },
    { kind: 'ap', say: 'demo.mediumTurn.right', ap: { lateral: 'bank', bankDeg: 30, maxBankDeg: 35 }, until: near('hdgDeg', v('demo.hdgDeg', -15), 3), timeoutS: 90 },
    { kind: 'ap', say: 'demo.mediumTurn.rollOut', ap: { lateral: 'heading', hdgDeg: v('demo.hdgDeg'), maxBankDeg: 30 }, until: wingsLevel(3, 3), timeoutS: 30 },
  ],
  abortWhen: upperAirAbort(1000, 45),
};

/** L06: slow flight at Vslow with power, a gentle turn, and back to cruise. */
const slowFlight: DemoScript = {
  id: 'slowFlight',
  segments: [
    { kind: 'ap', say: 'demo.slowFlight.entry', ap: { lateral: 'heading', hdgDeg: v('demo.hdgDeg'), vertical: 'altitude', altFt: v('demo.altFt'), autothrottle: true, kias: vs('Vslow') },
      until: held(near('kias', vs('Vslow'), 3), 8), timeoutS: 150 },
    { kind: 'ap', say: 'demo.slowFlight.turn', ap: { lateral: 'bank', bankDeg: -15, maxBankDeg: 20 }, until: near('hdgDeg', v('demo.hdgDeg', -25), 3), timeoutS: 60 },
    { kind: 'ap', ap: { lateral: 'heading', hdgDeg: v('demo.hdgDeg', -30), maxBankDeg: 15 }, until: wingsLevel(3, 3), timeoutS: 40 },
    { kind: 'ap', say: 'demo.slowFlight.recover', ap: { kias: v('demo.kias') }, until: held(near('kias', v('demo.kias'), 4), 5), timeoutS: 150 },
  ],
  abortWhen: upperAirAbort(1500, 30),
};

/**
 * L07: power-off clean stall. Autopilot-levelled entry (idle, altitude held until the break: benign at the
 * forward payload), recovery at the break: nose down to unstall, full power, wings level, climb away at Vy.
 */
const powerOffStall: DemoScript = {
  id: 'powerOffStall',
  segments: [
    { kind: 'ap', say: 'demo.stall.entry', ap: { lateral: 'heading', hdgDeg: v('demo.hdgDeg'), vertical: 'altitude', altFt: v('demo.altFt'), autothrottle: false },
      // The break (the stallBreak rule: stallFrac >= 0.5, or the warning with the nose dropping), or a mushing
      // stall: the warning on and sinking fast with the nose held up (seen in light turbulence).
      set: { throttle: { to: 0, overS: 2 } }, until: any(ge('stallFrac', 0.5), all(eq('stallWarn', true), any(lt('pitchRateDps', -4), lt('vsFpm', -700)))), timeoutS: 120 },
    { kind: 'ap', say: 'demo.stall.recover', ap: { lateral: 'bank', bankDeg: 0, maxBankDeg: 20, vertical: 'pitch', pitchDeg: -3 },
      set: { throttle: { to: 1, overS: 1 } }, until: gt('kias', vs('Vs1', 17)), timeoutS: 20 },
    { kind: 'ap', say: 'demo.stall.climb', ap: { lateral: 'heading', hdgDeg: v('demo.hdgDeg'), vertical: 'airspeed', kias: vs('Vy') }, until: held(gt('vsFpm', 200), 3), timeoutS: 30 },
    { kind: 'ap', ap: { vertical: 'altitude', altFt: v('demo.altFt'), autothrottle: true, kias: v('demo.kias') }, until: settled(3), timeoutS: 120 },
  ],
  abortWhen: any(lt('aglFt', 1500), bankBeyond(30)),
};

// =============================================================================================================
// Stage 2: circuits (runway 07; the autoflight flies take-off, approach, flare and roll-out)
// =============================================================================================================

/** The autoflight's take-off from the 07 line-up: rotate at Vr, Vy climb on the centreline. */
const takeoffPlan = { kind: 'takeoff', heading: RWY_HDG, climbTo: PATTERN_ALTITUDE, cruiseKias: 90 } as const;

/** L08: normal take-off and climb to 500 ft above the field. */
const takeoff: DemoScript = {
  id: 'takeoff',
  segments: [
    { kind: 'autoflight', say: 'demo.takeoff.roll', plan: takeoffPlan, until: ge('hafFt', 500), timeoutS: 150 },
  ],
};

/** L09: from a final start: landing flap, the autoflight's stabilised approach, flare, roll-out to a stop. */
const landing: DemoScript = {
  id: 'landing',
  segments: [
    { kind: 'ap', say: 'demo.landing.flap', ap: {}, set: { flapsDeg: 30 }, until: now, timeoutS: 2 },
    // The approach is cut into stages only to say what is happening (the autoflight re-engages on the same
    // path from where it is); one engagement from 200 ft carries the flare and the roll-out.
    { kind: 'autoflight', say: 'demo.landing.approach', plan: { kind: 'approach', kias: 65 }, until: le('hafFt', 500), timeoutS: 200 },
    { kind: 'autoflight', say: 'demo.landing.stable', plan: { kind: 'approach', kias: 65 }, until: le('hafFt', 200), timeoutS: 120 },
    { kind: 'autoflight', say: 'demo.landing.flare', plan: { kind: 'approach', kias: 65 }, until: all(eq('onGround', true), lt('gsKt', 1)), timeoutS: 150 },
  ],
};

/** L17: the same approach in a crosswind: the autoflight crabs on final and holds the centreline on the roll. */
const crosswindLanding: DemoScript = {
  id: 'crosswindLanding',
  segments: [
    { kind: 'ap', say: 'demo.crosswind.flap', ap: {}, set: { flapsDeg: 30 }, until: now, timeoutS: 2 },
    // Staged only to say what is happening (see `landing`).
    { kind: 'autoflight', say: 'demo.crosswind.crab', plan: { kind: 'approach', kias: 65 }, until: le('hafFt', 500), timeoutS: 200 },
    { kind: 'autoflight', say: 'demo.crosswind.stable', plan: { kind: 'approach', kias: 65 }, until: le('hafFt', 200), timeoutS: 120 },
    { kind: 'autoflight', say: 'demo.crosswind.flare', plan: { kind: 'approach', kias: 65 }, until: all(eq('onGround', true), lt('gsKt', 1)), timeoutS: 150 },
  ],
};

/**
 * L10: one left-hand circuit from the 07 line-up to a full stop. Upwind to 500 ft, crosswind climbing,
 * downwind at circuit height and 90 kt, flap 10 abeam the threshold descending at 400 fpm to 650 ft, base
 * flap 20 descending to 550 ft,
 * final flap 30 at Vref on the autoflight's approach. The downwind is extended so the final intercept is
 * close to the 3 degree path the autoflight's approach flies.
 */
const circuit: DemoScript = {
  id: 'circuit',
  segments: [
    { kind: 'autoflight', say: 'demo.circuit.takeoff', plan: takeoffPlan, until: ge('hafFt', 500), timeoutS: 150 },
    { kind: 'ap', say: 'demo.circuit.crosswind', ap: { lateral: 'heading', hdgDeg: HDG_CROSSWIND, maxBankDeg: 20, vertical: 'airspeed', kias: vs('Vy'), autothrottle: false },
      set: { throttle: 1 }, until: le('rwyAcrossM', -750), timeoutS: 150 },
    { kind: 'ap', say: 'demo.circuit.downwind', ap: { lateral: 'heading', hdgDeg: HDG_DOWNWIND, maxBankDeg: 20, vertical: 'altitude', altFt: fieldFt(1000), vsFpm: 600, autothrottle: true, kias: vs('Vdownwind') },
      until: all(le('rwyAlongM', 900), held(near('altFt', fieldFt(1000), 100), 5)), timeoutS: 150 },
    { kind: 'ap', say: 'demo.circuit.downwindChecks', ap: {}, until: le('rwyAlongM', 0), timeoutS: 150 },
    // Descents are altitude captures with a rate limit, so a headwind on base cannot leave us low on final.
    { kind: 'ap', say: 'demo.circuit.abeam', ap: { vertical: 'altitude', altFt: fieldFt(650), vsFpm: 400, kias: 80 }, set: { flapsDeg: { to: 10, overS: 4 } },
      until: le('rwyAlongM', -2400), timeoutS: 150 },
    { kind: 'ap', say: 'demo.circuit.base', ap: { lateral: 'heading', hdgDeg: HDG_BASE, altFt: fieldFt(550), vsFpm: 350, kias: vs('Vapp') }, set: { flapsDeg: { to: 20, overS: 4 } },
      until: ge('rwyAcrossM', -350), timeoutS: 120 },
    { kind: 'ap', say: 'demo.circuit.final', ap: {}, set: { flapsDeg: 30 }, until: now, timeoutS: 2 },
    { kind: 'autoflight', plan: { kind: 'approach', kias: 65 }, until: le('hafFt', 200), timeoutS: 200 },
    { kind: 'autoflight', say: 'demo.landing.flare', plan: { kind: 'approach', kias: 65 }, until: all(eq('onGround', true), lt('gsKt', 1)), timeoutS: 150 },
  ],
  // Low and slow, but not the flare (the speed decays toward the stall in the last few feet by design).
  abortWhen: any(bankBeyond(35), all(lt('aglFt', 300), gt('aglFt', 60), lt('kias', vs('Vs1')))),
};

/** L11: go-around from 200 ft on a final approach: full power, attitude, flap in stages, climb at Vy. */
const goAround: DemoScript = {
  id: 'goAround',
  segments: [
    { kind: 'autoflight', say: 'demo.goAround.approach', plan: { kind: 'approach', kias: 70 }, until: le('hafFt', 400), timeoutS: 200 },
    { kind: 'autoflight', say: 'demo.goAround.ready', plan: { kind: 'approach', kias: 70 }, until: le('hafFt', 200), timeoutS: 120 },
    { kind: 'ap', say: 'demo.goAround.call', ap: { lateral: 'heading', hdgDeg: HDG_RWY, maxBankDeg: 15, vertical: 'pitch', pitchDeg: 7, autothrottle: false },
      set: { throttle: { to: 1, overS: 2 }, flapsDeg: { to: 10, overS: 4 } }, until: held(gt('vsFpm', 200), 3), timeoutS: 20 },
    { kind: 'ap', say: 'demo.goAround.cleanUp', ap: { vertical: 'airspeed', kias: vs('Vy') }, set: { flapsDeg: { to: 0, overS: 6 } }, until: ge('hafFt', 500), timeoutS: 90 },
  ],
};

/**
 * L12: engine failure after take-off. The throttle is closed at 500 ft (the demo writes it itself; the
 * lesson's own EFATO tasks use a throttle hold), glide straight ahead at Vglide, go-around at 200 ft.
 */
const efato: DemoScript = {
  id: 'efato',
  segments: [
    { kind: 'autoflight', say: 'demo.efato.takeoff', plan: takeoffPlan, until: ge('hafFt', 500), timeoutS: 150 },
    { kind: 'ap', say: 'demo.efato.failure', ap: { lateral: 'heading', hdgDeg: HDG_RWY, maxBankDeg: 15, vertical: 'airspeed', kias: vs('Vglide'), autothrottle: false },
      // Go around at 250 ft: the idle glide sinks at about 950 fpm, and below 200 ft more than 1,000 fpm is the
      // safety envelope's sink limit (the demonstration would be stopped by it).
      set: { throttle: 0 }, until: le('hafFt', 250), timeoutS: 90 },
    { kind: 'ap', say: 'demo.efato.goAround', ap: { vertical: 'airspeed', kias: vs('Vy') }, set: { throttle: { to: 1, overS: 2 } }, until: ge('hafFt', 500), timeoutS: 90 },
  ],
};

// =============================================================================================================
// Stage 3: advanced
// =============================================================================================================

/** L15: a steep turn, 45 degrees through 360 to the left, autothrottle at VsteepTurn and back pressure. */
const steepTurn: DemoScript = {
  id: 'steepTurn',
  segments: [
    { kind: 'ap', say: 'demo.steepTurn.entry', ap: { lateral: 'heading', hdgDeg: v('demo.hdgDeg'), vertical: 'altitude', altFt: v('demo.altFt'), autothrottle: true, kias: vs('VsteepTurn') },
      until: held(near('kias', vs('VsteepTurn'), 4), 3), timeoutS: 90 },
    { kind: 'ap', say: 'demo.steepTurn.rollIn', ap: { lateral: 'bank', bankDeg: -45, maxBankDeg: 50 }, until: near('hdgDeg', v('demo.hdgDeg', 180), 6), timeoutS: 60 },
    { kind: 'ap', say: 'demo.steepTurn.lookout', ap: {}, until: near('hdgDeg', v('demo.hdgDeg', 25), 6), timeoutS: 60 },
    { kind: 'ap', say: 'demo.steepTurn.rollOut', ap: { lateral: 'heading', hdgDeg: v('demo.hdgDeg'), maxBankDeg: 45 }, until: wingsLevel(3, 3), timeoutS: 30 },
  ],
  abortWhen: upperAirAbort(1500, 55),
};

/** L15: set up a spiral dive for the student to recover (bank 50, nose -15, idle); the copilot holds it until the handover. */
const spiralSetup: DemoScript = {
  id: 'spiralSetup',
  segments: [
    { kind: 'ap', say: 'demo.spiral.setup', ap: { lateral: 'bank', bankDeg: 50, maxBankDeg: 55, vertical: 'pitch', pitchDeg: -15, autothrottle: false },
      set: { throttle: { to: 0, overS: 1 } }, until: all(gt('bankDeg', 45), lt('pitchDeg', -12)), timeoutS: 20 },
  ],
  abortWhen: any(gt('kias', 125), lt('aglFt', 1500)),
};

/** L19: copilot puts the aircraft nose-high (25 degrees, 30 bank, slowing toward 60 kt), then hands over. */
const unusualNoseHigh: DemoScript = {
  id: 'unusualNoseHigh',
  segments: [
    { kind: 'ap', say: 'demo.unusual.eyesClosed', ap: { lateral: 'bank', bankDeg: 30, maxBankDeg: 35, vertical: 'pitch', pitchDeg: 25, autothrottle: false },
      set: { throttle: { to: 0.6, overS: 2 } }, until: all(gt('pitchDeg', 20), lt('kias', 65)), timeoutS: 30 },
  ],
  abortWhen: any(gt('stallFrac', 0.2), lt('kias', 48), lt('aglFt', 1500)),
};

/** L19: nose-low (-20 degrees, 45 bank, speed building), then hands over. */
const unusualNoseLow: DemoScript = {
  id: 'unusualNoseLow',
  segments: [
    { kind: 'ap', say: 'demo.unusual.eyesClosed', ap: { lateral: 'bank', bankDeg: 45, maxBankDeg: 50, vertical: 'pitch', pitchDeg: -20, autothrottle: false },
      set: { throttle: { to: 0.6, overS: 2 } }, until: all(lt('pitchDeg', -15), gt('bankDeg', 40)), timeoutS: 20 },
  ],
  abortWhen: any(gt('kias', 130), lt('aglFt', 1500)),
};

/** L19: selective radial scan: straight and level, a rate-one turn through 90 degrees, level again. */
const instrumentScan: DemoScript = {
  id: 'instrumentScan',
  segments: [
    { kind: 'ap', say: 'demo.scan.level', ap: { lateral: 'heading', hdgDeg: v('demo.hdgDeg'), vertical: 'altitude', altFt: v('demo.altFt') }, until: settled(10), timeoutS: 40 },
    { kind: 'ap', say: 'demo.scan.turn', ap: { lateral: 'bank', bankDeg: 15, maxBankDeg: 20 }, until: near('hdgDeg', v('demo.hdgDeg', 82), 3), timeoutS: 60 },
    { kind: 'ap', say: 'demo.scan.rollOut', ap: { lateral: 'heading', hdgDeg: v('demo.hdgDeg', 90), maxBankDeg: 15 }, until: settled(5), timeoutS: 40 },
  ],
  abortWhen: upperAirAbort(1000, 30),
};

/**
 * L16: practice forced landing from above the high key (deadside, abeam the 07 upwind end). Idle, best
 * glide, a descending orbit away from the runway to reach the high key at 2,000 ft, the deadside leg (a
 * right-hand pattern) past the threshold, base with flap 20, a 30 degree intercept onto final with flap 30,
 * and the go-around at 200 ft (or over the runway if still high).
 */
const pfl: DemoScript = {
  id: 'pfl',
  segments: [
    // Throttle closed: hold a gentle nose-up attitude while the cruise speed bleeds off, then the glide speed
    // (the airspeed mode straight from cruise zoomed: 2.3 g).
    { kind: 'ap', say: 'demo.pfl.failure', ap: { lateral: 'heading', hdgDeg: HDG_DOWNWIND, maxBankDeg: 20, vertical: 'pitch', pitchDeg: 4, autothrottle: false },
      set: { throttle: { to: 0, overS: 1 } }, until: lt('kias', vs('Vglide', 8)), timeoutS: 40 },
    { kind: 'ap', ap: { vertical: 'airspeed', kias: vs('Vglide') }, until: held(near('kias', vs('Vglide'), 4), 3), timeoutS: 40 },
    { kind: 'ap', say: 'demo.pfl.highKey', ap: { lateral: 'bank', bankDeg: -25, maxBankDeg: 30 }, until: all(le('hafFt', 2100), near('hdgDeg', HDG_DOWNWIND - 10, 25)), timeoutS: 240 },
    { kind: 'ap', ap: { lateral: 'heading', hdgDeg: HDG_DOWNWIND, maxBankDeg: 25 }, until: near('hdgDeg', HDG_DOWNWIND, 5), timeoutS: 60 },
    // The low-key call where the low key is (abeam the threshold), not as the dead-side leg begins.
    { kind: 'ap', say: 'demo.pfl.deadside', ap: {}, until: le('rwyAlongM', 0), timeoutS: 180 },
    { kind: 'ap', say: 'demo.pfl.lowKey', ap: {}, until: le('rwyAlongM', -500), timeoutS: 90 },
    { kind: 'ap', say: 'demo.pfl.base', ap: { lateral: 'heading', hdgDeg: HDG_CROSSWIND, vertical: 'airspeed', kias: vs('Vapp') }, set: { flapsDeg: { to: 20, overS: 4 } },
      until: le('rwyAcrossM', 250), timeoutS: 120 },
    { kind: 'ap', ap: { lateral: 'heading', hdgDeg: HDG_RWY - 30 }, until: le('rwyAcrossM', 40), timeoutS: 90 },
    // Flap 20, not 30, and the go-around from 250 ft: at idle with full flap the sink passes 1,000 fpm, which
    // below 200 ft is a safety breach that aborts the demonstration (wave-2 integration fix, seen in L16).
    { kind: 'ap', say: 'demo.pfl.final', ap: { lateral: 'heading', hdgDeg: HDG_RWY, vertical: 'airspeed', kias: vs('Vref', 3) }, set: { flapsDeg: { to: 20, overS: 4 } },
      until: any(le('hafFt', 250), ge('rwyAlongM', 900)), timeoutS: 150 },
    { kind: 'ap', say: 'demo.pfl.goAround', ap: { vertical: 'airspeed', kias: vs('Vy') }, set: { throttle: { to: 1, overS: 2 }, flapsDeg: { to: 0, overS: 8 } }, until: ge('hafFt', 500), timeoutS: 90 },
  ],
  abortWhen: any(bankBeyond(40), gt('stallFrac', 0.3)),
};

const ALL: DemoScript[] = [
  primaryEffects, furtherEffects, straightLevel, climbLevelOff, glideLevelOff, mediumTurn, slowFlight, powerOffStall,
  takeoff, landing, crosswindLanding, circuit, goAround, efato, steepTurn, spiralSetup, unusualNoseHigh, unusualNoseLow,
  instrumentScan, pfl,
];

/** Demo scripts by id (DemoStep.script and Outcome { demo } name these). */
export const DEMOS: Readonly<Record<string, DemoScript>> = Object.freeze(Object.fromEntries(ALL.map((d) => [d.id, d])));

// =============================================================================================================
// Recovery (section 3.8): one script per situation; each ends in the common hold. The copilot ends a
// recovery 'done' when its `stable` monitor holds (wings ±5, 65-100 kt, VS >= 0, above 500 ft for 5 s;
// InstructorPilot.stable), so the hold itself never ends on a predicate. The ground case is flown in code
// (idle, brakes, the autoflight's centreline rudder) because it needs the runway geometry.
// =============================================================================================================

/**
 * The hold every recovery ends in: wings level, altitude capture at the present altitude, 90 kt on the
 * autothrottle (inside the stable band; 'cruise' at 105 would sit outside it), flaps up in stages.
 */
const RECOVERY_HOLD: DemoSegment = {
  kind: 'ap',
  ap: { lateral: 'wingLeveler', vertical: 'altitude', altFt: sig('altFt'), vsFpm: 700, autothrottle: true, kias: vs('Vdownwind'), yawDamper: true, autoTrim: true },
  set: { flapsDeg: { to: 0, overS: 9 } },
  until: { const: false },
  timeoutS: 90,
};

export type RecoveryScriptKind = 'noseLow' | 'slow' | 'low' | 'hold';

export const RECOVERY: Readonly<Record<RecoveryScriptKind, DemoScript>> = {
  /**
   * Nose low (pitch < -10 or IAS > Vno): idle, roll wings level, raise the nose to the horizon; then trade
   * the excess speed for height with a gentle climb attitude before the hold (levelling at 130 kt would take
   * long to slow down at idle). Pitch changes are slewed segments: the autopilot's airspeed or altitude
   * modes would zoom and push (seen at -0.6 g).
   */
  noseLow: {
    id: 'recovery.noseLow',
    segments: [
      { kind: 'ap', ap: { lateral: 'bank', bankDeg: 0, maxBankDeg: 60, vertical: 'pitch', pitchDeg: 0, autothrottle: false }, set: { throttle: 0 },
        until: all(near('bankDeg', 0, 10), any(gt('vsFpm', -500), ge('pitchDeg', -1))), timeoutS: 20 },
      { kind: 'ap', ap: { vertical: 'pitch', pitchDeg: 8 }, until: le('kias', 100), timeoutS: 20 },
      { kind: 'ap', ap: { vertical: 'pitch', pitchDeg: 2 }, until: near('pitchDeg', 2, 1), timeoutS: 10 },
      RECOVERY_HOLD,
    ],
  },
  /** Slow, stalled or nose-high and slowing: lower the nose to unstall, full power, wings level, until Vs1 + 15. */
  slow: {
    id: 'recovery.slow',
    segments: [
      { kind: 'ap', ap: { lateral: 'bank', bankDeg: 0, maxBankDeg: 60, vertical: 'pitch', pitchDeg: -3, autothrottle: false }, set: { throttle: 1 },
        until: gt('kias', vs('Vs1', 15)), timeoutS: 20 },
      RECOVERY_HOLD,
    ],
  },
  /**
   * Low (below the minimum height, low and slow, or sinking fast near the ground): full power and a level
   * attitude to accelerate without losing height, then climb at Vy; flaps up in stages after 5 s of climb.
   */
  low: {
    id: 'recovery.low',
    // Every segment sets full power: a fixed `set` lasts only for its segment, and the first segment can end
    // on the step it starts (a sink-rate breach on final is already above Vx), so full power written only
    // there never reached the engine and the Vy airspeed mode then dived at idle into the ground (wave-3
    // playtest). The first segment also waits for the sink to stop before the airspeed mode may lower the nose.
    segments: [
      { kind: 'ap', ap: { lateral: 'bank', bankDeg: 0, maxBankDeg: 30, vertical: 'pitch', pitchDeg: 4, autothrottle: false }, set: { throttle: 1 },
        until: all(gt('kias', vs('Vx')), gt('vsFpm', 0)), timeoutS: 15 },
      { kind: 'ap', ap: { vertical: 'airspeed', kias: vs('Vy') }, set: { throttle: 1 }, until: held(gt('vsFpm', 0), 5), timeoutS: 30 },
      { kind: 'ap', ap: {}, set: { throttle: 1, flapsDeg: { to: 0, overS: 9 } }, until: all(lt('flapsDeg', 1), gt('aglFt', 600)), timeoutS: 120 },
      RECOVERY_HOLD,
    ],
  },
  /** Nothing urgent (e.g. over-banked at a normal speed): straight to the hold. */
  hold: { id: 'recovery.hold', segments: [RECOVERY_HOLD] },
};

// =============================================================================================================
// Default lines for the cues the scripts speak (instructor persona, 20 words or fewer). content/lines.ts
// may override any of them; ids are `demo.<script>.<moment>` except the spec's own L04 lines.
// =============================================================================================================

const line = (text: string | string[]): InlineCue => ({ text });

export const DEMO_LINES: LineTable = {
  'demo.primaryEffects.intro': line('Watch the nose against the horizon as I move each control.'),
  'demo.primaryEffects.elevator': line('Elevator: back on the yoke, the nose rises. Forward, it falls.'),
  'demo.primaryEffects.recover': line('Back to level. Attitude first, then let it settle.'),
  'demo.primaryEffects.aileron': line('Ailerons: turn the yoke and the aircraft rolls. Centre it and the bank stays.'),
  'demo.primaryEffects.rudder': line('Rudder: press a pedal and the nose yaws. See the ball move?'),
  'demo.primaryEffects.done': line('Those are the primary effects. Pitch, roll and yaw.'),
  'demo.furtherEffects.intro': line('Now the further effects. Each control does a little more than its main job.'),
  'demo.furtherEffects.rudderRoll': line('Rudder alone: the nose yaws, then the aircraft starts to roll.'),
  'demo.furtherEffects.adverseYaw': line('Aileron alone: watch the nose swing the wrong way first. Adverse yaw.'),
  'demo.furtherEffects.powerSlow': line("Now power. First I'll slow to climb speed, level. Then feet off the pedals."),
  'demo.furtherEffects.power': line('Full power: watch the nose rise and swing left, and the ball go out to the right.'),
  'demo.furtherEffects.powerRudder': line("That's slipstream and P-factor. Right rudder stops it: the ball comes back to the middle."),
  'demo.furtherEffects.powerBack': line('Power back, level again. The nose settles, and the rudder comes off.'),
  'demo.furtherEffects.flapSpeed': line('Flap only in the white arc. Power back, hold the height, speed below 85.'),
  'demo.furtherEffects.flap': line('In the white arc: flap ten, hands off. The nose pitches up and we balloon.'),
  'demo.furtherEffects.flapUp': line('Flaps up. Expect the nose to drop a little; hold the attitude.'),
  'demo.furtherEffects.trim': line('Now trim: hold the attitude, then trim the pressure away until it flies hands off.'),
  'demo.straightLevel.attitude': line('Straight and level: wings level, nose on the horizon, check the altimeter.'),
  'demo.straightLevel.slow': line('Power back. Raise the nose as the speed falls to hold the height. Trim.'),
  'demo.straightLevel.cruise': line('Power up to cruise. Lower the nose as it accelerates. Attitude, power, trim.'),
  'demo.glide.entry': line('Throttle closed. Hold the height while the speed falls toward best glide.'),
  'demo.glide.attitude': line('Now lower the nose to the glide attitude: sixty-eight knots. Trim.'),
  'demo.glide.levelOff': line('Fifty feet to go: power on, nose up to the level attitude, trim.'),
  'demo.mediumTurn.lookout': line('Lookout left, clear. Roll in to thirty degrees and hold the nose up a touch.'),
  'demo.mediumTurn.rollIn': line('Thirty degrees of bank, ball in the middle, a little back pressure.'),
  'demo.mediumTurn.rollOut': line('Roll out about fifteen degrees early: half the bank angle.'),
  'demo.mediumTurn.right': line('And to the right. Lookout right first.'),
  'demo.slowFlight.entry': line('Power back, nose up to hold height as we slow to fifty-five knots.'),
  'demo.slowFlight.turn': line('Gentle turn, fifteen degrees. Controls feel soft; use more rudder.'),
  'demo.slowFlight.recover': line('Back to cruise: full power, lower the nose, trim.'),
  'demo.stall.entry': line('Throttle closed, holding the height. Watch the speed fall and listen for the warning.'),
  'demo.stall.recover': line('There is the break. Nose down, full power, wings level.'),
  'demo.stall.climb': line('Speed is back. Climb away at Vy and level off.'),
  'demo.takeoff.roll': line('Full power, centreline with the rudder. Rotate at fifty-five, climb at seventy-four.'),
  'demo.landing.flap': line('Flap thirty. Sixty-five knots on final.'),
  'demo.landing.approach': line('Aim point steady in the windscreen. Power for the path, attitude for the speed.'),
  'demo.landing.stable': line('Five hundred feet: stable. On speed, on the slope, on the centreline. Landing.'),
  'demo.landing.flare': line('Two hundred feet. At about fifteen feet: throttle closed, flare, and hold it off.'),
  'demo.crosswind.flap': line('Flap thirty. Wind from the right, so we crab into it on final.'),
  'demo.crosswind.crab': line('Crabbed into wind, tracking the centreline. Into-wind aileron on the roll.'),
  'demo.crosswind.stable': line('Five hundred feet, stable. The nose points into wind; the track stays on the centreline.'),
  'demo.crosswind.flare': line('In the flare: rudder to straighten the nose, a little wing down into wind.'),
  'demo.circuit.takeoff': line('One circuit to a full stop. Full power, rotate at fifty-five.'),
  'demo.circuit.crosswind': line('Five hundred feet. Lookout left, turning crosswind.'),
  'demo.circuit.downwind': line('Turning downwind. Level at a thousand feet, power back to twenty-two hundred.'),
  'demo.circuit.downwindChecks': line('Downwind checks: brakes off, mixture rich, fuel both, harnesses secure.'),
  'demo.circuit.abeam': line('Abeam the threshold: power back, speed into the white arc, then flap ten, descend.'),
  'demo.circuit.base': line('Turning base. Flap twenty, seventy knots.'),
  'demo.circuit.final': line('Final. Flap thirty, sixty-five knots, runway clear.'),
  'demo.goAround.approach': line('A normal approach. At two hundred feet I will go around.'),
  'demo.goAround.ready': line('Four hundred feet. Hand on the throttle: the go-around is full power, attitude, flap.'),
  'demo.goAround.call': line('Going around. Full power, climb attitude, flap ten.'),
  'demo.goAround.cleanUp': line('Climbing. Flaps up in stages, seventy-four knots.'),
  'demo.efato.takeoff': line('Normal take-off. At five hundred feet I will close the throttle.'),
  'demo.efato.failure': line('Engine failure. Nose down, best glide, land ahead. Fuel, mixture, mags, pump.'),
  'demo.efato.goAround': line('Go around. Full power, climb away.'),
  'demo.steepTurn.entry': line('Ninety-five knots. Lookout. Steep turn to the left, forty-five degrees.'),
  'demo.steepTurn.rollIn': line('Rolling in. Passing thirty, back pressure and a little power. Nose on the horizon.'),
  'demo.steepTurn.lookout': line('Keep the lookout going. Hold the attitude; the altimeter confirms it.'),
  'demo.steepTurn.rollOut': line('Roll out about twenty degrees early. Ease the back pressure off.'),
  'demo.spiral.setup': line('I am putting us in a spiral dive. Watch the speed build.'),
  'demo.unusual.eyesClosed': line('Close your eyes. I am going to put us in an unusual attitude.'),
  'demo.scan.level': line('Selective radial scan: attitude indicator, out to one instrument, back to the attitude.'),
  'demo.scan.turn': line('Rate one turn: fifteen degrees of bank. Attitude, turn coordinator, attitude, heading.'),
  'demo.scan.rollOut': line('Roll out, attitude level, check the heading and the altimeter.'),
  'demo.pfl.failure': line('Simulated engine failure. Best glide first, then trim.'),
  'demo.pfl.highKey': line('Losing height at the high key. Keep the field in sight.'),
  'demo.pfl.deadside': line('High key. Now along the dead side, judging the height for the low key.'),
  'demo.pfl.lowKey': line('Low key abeam the threshold. Judge the turn onto base from here.'),
  'demo.pfl.base': line('Base leg, flap twenty. If we are high, more flap on final.'),
  'demo.pfl.final': line('Final: we will make the field. Now the security checks; I leave them on for the go-around.'),
  'demo.pfl.goAround': line('Go around. Full power, climb away.'),
  'L04.demoClimbEntry': line('Full power. Raise the nose to the climb attitude; let the speed settle at seven four.'),
  'L04.demoLeadLevelOff': line("Settled at seven four, full power, trimmed. Fifty feet before the altitude I'll start levelling."),
  'L04.demoApt': line('Fifty feet to go: lower the nose to the level attitude, power back, trim. Attitude, power, trim.'),
};

/** Every cue id the scripts (demos and recoveries) speak, for the linter. */
export function demoCueIds(): string[] {
  const ids = new Set<string>();
  for (const d of [...ALL, ...Object.values(RECOVERY)]) {
    for (const s of d.segments) if (typeof s.say === 'string') ids.add(s.say);
  }
  return [...ids].sort();
}
