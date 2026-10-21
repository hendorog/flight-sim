// The Bo 105's STAB ASSIST (a laptop sim aid, not a modelled system: src/sim/rotorcraft/stabilityAssist.ts; the
// flyability pass's F1, W/bofly/fix-plan.md) through the REAL InputSystem and SimPhysics, as the app runs it: the hover
// scenario (2500 kg, about 16 m), 60 frames per second, the assist's toggle linked as the Simulator links it. The raw
// aircraft's hands-off divergence is the real Bo 105's (ERF 1995 VII-7, P; bo105Derivatives' hover-modes row) and stays;
// these rows pin what the aid adds and that it adds nothing anywhere else. Pilot units throughout.
import { describe, expect, it } from 'vitest';
import { DEG, G0, KT, clamp } from '../../src/core/math';
import { createEventBus, type SimContext } from '../../src/core/context';
import { defaultWeather, type WeatherSettings } from '../../src/core/types';
import type { AircraftDefinition } from '../../src/aircraft/types';
import { BO105_DEFINITION as def } from '../../src/aircraft/bo105';
import { MD500_DEFINITION } from '../../src/aircraft/md500';
import { R22_DEFINITION } from '../../src/aircraft/r22';
import { InputSystem } from '../../src/input/InputSystem';
import { SimPhysics } from '../../src/sim/SimPhysics';
import { demoScenario, hoverScenario } from '../../src/sim/rotorcraft/starts';
import { DT, gauges as gaugesOf, positionHold, rig as rotorRig, writeTrace } from './bo105Rig';
import { StabilityAssist } from '../../src/sim/rotorcraft/stabilityAssist';
import { afterAll } from 'vitest';

const FRAME = 1 / 60;
const report: Record<string, unknown> = {};
afterAll(() => writeTrace('bo105Assist', report));

function rig(o: { wind?: boolean; assist: boolean; payload?: 'typical' | 'maxGross'; dd?: AircraftDefinition; ige?: boolean;
  runway?: boolean; level?: { kias: number; heightM: number } }) {
  const dd = o.dd ?? def;
  const w: WeatherSettings = { ...defaultWeather(), windSpeedKt: o.wind ? 8 : 0, gustKt: o.wind ? 5 : 0,
    turbulence: o.wind ? 0.3 : 0, isaDeviation: 0, cloudCover: 0 };
  const events = createEventBus(), physics = new SimPhysics({ aircraft: dd, weather: w, events });
  // ige: the R22 demo's hover start (skids about 1 m up); runway: on the ground, engines running; level: the hover
  // scenario's place at kias and heightM; else the 15 m hover-hold scenario.
  const sc = o.ige ? demoScenario('hover', physics.env, dd.rotorcraft!) : hoverScenario(physics.env, dd.rotorcraft!);
  if (o.runway) physics.reset('runway', w);
  else if (o.level) physics.resetTo({ ...sc, payload: o.payload ?? 'typical', ic: { ...sc.ic, airspeed: o.level.kias * KT,
    position: { ...sc.ic.position, z: sc.ic.position.z - (o.level.heightM - 15) } } }, w);
  else physics.resetTo(o.payload ? { ...sc, payload: o.payload } : sc, w);
  const noop = (): void => {};
  const ctx = { state: physics.renderState, controls: physics.controls, weather: w, env: physics.env, events, paused: false, timeScale: 1,
    cameraMode: 'cockpit', simTime: 0, commands: { reset: noop, setPaused: noop, setCameraMode: noop, setTimeScale: noop, setQuality: noop } } as unknown as SimContext;
  const toasts: string[] = [];
  const input = new InputSystem({ profile: dd.input, shell: { toast: (t) => void toasts.push(t) } });
  input.attach(ctx);
  if (physics.stabilityAssist) {
    input.assists.stabilityAssist = o.assist;
    physics.stabilityAssistOn = () => input.assists.stabilityAssist === true;
  }
  return { physics, input, ctx, c: physics.controls, toasts };
}
type Rig = ReturnType<typeof rig>;
const frame = (r: Rig): void => { r.input.update(FRAME, r.ctx); r.physics.advance(FRAME); };

/** Hands-off for `seconds`: the largest attitude change, the crash time, the largest series command (% of travel). */
function handsOff(r: Rig, seconds: number) {
  const s0 = r.physics.state, roll0 = s0.roll, pitch0 = s0.pitch;
  let maxAtt = 0, crash: number | null = null, series = 0;
  for (let i = 0; i < seconds / FRAME; i++) {
    frame(r);
    const s = r.physics.state, o = r.physics.stabilityAssist?.output;
    maxAtt = Math.max(maxAtt, Math.abs(s.roll - roll0) / DEG, Math.abs(s.pitch - pitch0) / DEG);
    if (o) series = Math.max(series, Math.abs(o.aileron), Math.abs(o.elevator), Math.abs(o.rudder));
    if (s.crashed) { crash = (i + 1) * FRAME; break; }
  }
  return { maxAttDeg: maxAtt, crash, seriesPctTravel: 50 * series };
}

describe('STAB ASSIST, hands off in the hover scenario (2500 kg, about 16 m; gains from W/bofly/probes sas2.log)', () => {
  it('calm, 60 s: attitude within 2 deg, no crash, at most 10 % of travel used (raw aircraft: crashes, the real Bo 105\'s divergence)', () => {
    const on = handsOff(rig({ assist: true }), 60), off = handsOff(rig({ assist: false }), 60);
    report.handsOffCalm = { on, off };
    expect(on.crash).toBeNull(); expect(on.maxAttDeg).toBeLessThanOrEqual(2); expect(on.seriesPctTravel).toBeLessThanOrEqual(10);
    expect(off.crash).not.toBeNull(); expect(off.crash!).toBeLessThan(40);
  }, 120_000);
  it('8 kt wind with 5 kt gusts and turbulence 0.3, 60 s: attitude within 5 deg, no crash (it holds attitude, not position: it drifts with the wind)', () => {
    const r = rig({ wind: true, assist: true }), x0 = r.physics.state.position.x, y0 = r.physics.state.position.y;
    const on = handsOff(r, 60), s = r.physics.state;
    report.handsOffWind = { ...on, driftM: Math.hypot(s.position.x - x0, s.position.y - y0), groundSpeedKt: s.groundSpeed / KT };
    expect(on.crash).toBeNull(); expect(on.maxAttDeg).toBeLessThanOrEqual(5); expect(on.seriesPctTravel).toBeLessThanOrEqual(10);
  }, 120_000);
  /**
   * Round 3: the trim follow-up (followUp) walks the keyboard controls when the low-passed series term leaves its dead
   * band (20 % of the authority); hands off in this wind it hardly does. What reaches the controls is that walk (the
   * assist's `followed` readout; the stick follows the spring anchor at the input module's next frame), never the series
   * term itself.
   */
  it('the series term never reaches the pilot\'s controls: hands off in gusts the keyboard stick and pedals move only by the trim follow-up, and that stays small', () => {
    const r = rig({ wind: true, assist: true }), c0 = { a: r.c.aileron, e: r.c.elevator, r: r.c.rudder }, a = r.physics.stabilityAssist!;
    const f0 = { ...a.followed };
    let worked = 0, leak = 0;
    for (let i = 0; i < 300; i++) {
      frame(r);
      const o = a.output, f = a.followed;
      worked = Math.max(worked, Math.abs(o.aileron), Math.abs(o.elevator), Math.abs(o.rudder));
      // One frame of the cyclic follow-up (at most cyclicRate / 60) may not have reached the stick yet.
      leak = Math.max(leak, Math.abs(r.c.aileron - c0.a - (f.aileron - f0.aileron)), Math.abs(r.c.elevator - c0.e - (f.elevator - f0.elevator)),
        Math.abs(r.c.rudder - c0.r - (f.rudder - f0.rudder)));
    }
    const moved = Math.max(Math.abs(a.followed.aileron - f0.aileron), Math.abs(a.followed.elevator - f0.elevator), Math.abs(a.followed.rudder - f0.rudder));
    report.seriesNeverReaches = { worked, leak, moved };
    expect(worked).toBeGreaterThan(0);
    expect(leak).toBeLessThanOrEqual(0.1 / 60 + 1e-9);
    expect(moved).toBeLessThanOrEqual(0.02);
    expect(r.input.pilotFlying(1e6)).toBe(false);
  }, 60_000);
});

const wrapDeg = (a: number): number => ((a + 540) % 360) - 180;

describe('STAB ASSIST with the keys (attitude command, attitude hold; the pedal term damps the yaw rate and holds the heading)', () => {
  /** Fly with an optional key held from `at` for `hold` s; samples every frame. */
  function fly(T: number, assist: boolean, key?: { code: string; hold: number; at: number; shift?: boolean }, payload?: 'typical') {
    const r = rig({ assist, payload }), out: { roll: number; pitch: number; r: number; hdg: number }[] = [];
    for (let i = 0, n = Math.round(T / FRAME); i < n; i++) {
      const t = i * FRAME;
      if (key && Math.abs(t - key.at) < FRAME / 2) r.input.keyDown(key.code, key.shift);
      if (key && Math.abs(t - (key.at + key.hold)) < FRAME / 2) r.input.keyUp(key.code);
      frame(r);
      const s = r.physics.state;
      out.push({ roll: s.roll / DEG, pitch: s.pitch / DEG, r: s.angularVelocity.z / DEG, hdg: s.heading / DEG });
    }
    return out;
  }
  const at = <T>(xs: T[], t: number): T => xs[Math.round(t / FRAME) - 1];
  /**
   * Round 2 (W/bofly/r2 rolltap.log): with the heading hold the 1 s tap's bank is no longer "held" at 8 s. It never was by
   * the attitude hold alone: round 1's 9.0 deg at 8 s came with the nose weathercocking 84 deg into the sideward drift
   * (14.8 kt by 8 s), and a 0.3 / 0.5 s tap's bank was back to level by 8 s with or without the hold. Holding the heading
   * keeps the drift sideward, and its airflow (the rotor's dihedral, Lv) rolls the bank back toward level against the
   * assist's 10 % of travel: 9.4 deg at 3 s, 5.6 at 5 s, 2.5 at 8 s, the nose 40 deg round instead of 84.
   */
  it('a 1 s roll key tap banks 7-11 deg by 3 s; the bank stays on the tapped side while the sideward drift rolls it back, and the heading hold keeps the nose from weathercocking round (round 1: 84 deg at 8 s)', () => {
    const base = fly(9, true), tap = fly(9, true, { code: 'ArrowRight', hold: 1, at: 1 });
    const bank = (t: number) => at(tap, t).roll - at(base, t).roll;
    const hdg8 = Math.abs(wrapDeg(at(tap, 9).hdg - at(base, 9).hdg));
    report.rollTap = { at3: bank(4), at5: bank(6), at8: bank(9), hdg8 };
    expect(bank(4)).toBeGreaterThanOrEqual(7); expect(bank(4)).toBeLessThanOrEqual(11);
    expect(bank(9)).toBeGreaterThanOrEqual(0); expect(bank(9)).toBeLessThan(bank(4));
    expect(hdg8).toBeLessThanOrEqual(50);
  }, 60_000);
  it('a 10 % pedal step held by the pilot in the hover (2200 kg) reaches 16-31 deg/s at 3 s and is at least 85 % settled (ERF 1995 Nr -0.97 / -1.10 with N_ped 0.042: about 23 deg/s); the raw aircraft is still rising', () => {
    // The pilot's foot on the pedal (ControlInputs.pedalWorked, as the input module sets it for a held key or a hardware
    // pedal in use): the heading hold waits and the rate damping alone answers, the response this row is about.
    const step = (assist: boolean) => {
      const a = rig({ assist, payload: 'typical' }), b = rig({ assist, payload: 'typical' }), r0 = a.c.rudder, rates: Record<number, number> = {};
      for (let i = 0; i < 9 / FRAME; i++) {
        const t = (i + 1) * FRAME;
        a.input.update(FRAME, a.ctx); if (t > 1) { a.c.rudder = r0 + 0.2; a.c.pedalWorked = true; } a.physics.advance(FRAME);
        frame(b);
        for (const k of [1, 2, 3, 5, 8]) if (Math.abs(t - 1 - k) < FRAME / 2) rates[k] = (a.physics.state.angularVelocity.z - b.physics.state.angularVelocity.z) / DEG;
      }
      return rates;
    };
    const on = step(true), off = step(false);
    report.pedalStep10 = { on, off };
    expect(on[3]).toBeGreaterThanOrEqual(16); expect(on[3]).toBeLessThanOrEqual(31);
    expect(on[3] / on[8]).toBeGreaterThanOrEqual(0.85);
    expect(off[3] / off[8]).toBeLessThan(0.85);
  }, 60_000);
  /**
   * The yaw term's series authority (0.13 of the axis, 6.5 % of the pedal travel) is the knob between this row and the
   * pedal-step row: it stays unsaturated through the 10 % step (yaw rates to 25 deg/s) and leaves a full left pedal
   * (only 21 % of the travel beyond the hover trim) enough to reach 90 deg/s. At 16 m (OGE) the left turn takes 3.6 s
   * with the assist against 2.0 s raw (W/bofly/probes-fix turn.log).
   */
  it('a full pedal step still turns the 2200 kg IGE hover at 90 deg/s within 3 s with the assist on (P5 FM 2-16: hover turns to 90 deg/s; bo105Handling\'s raw-aircraft row)', () => {
    for (const side of [1, -1]) {
      const a = rig({ assist: true, payload: 'typical', ige: true });
      let t90: number | null = null, peak = 0;
      for (let i = 0; i < 4 / FRAME; i++) {
        const t = (i + 1) * FRAME;
        a.input.update(FRAME, a.ctx); if (t > 1) a.c.rudder = side; a.physics.advance(FRAME);
        const r = Math.abs(a.physics.state.angularVelocity.z) / DEG;
        peak = Math.max(peak, r);
        if (t90 === null && t > 1 && r >= 90) t90 = t - 1;
      }
      report[side > 0 ? 'hoverTurnRight' : 'hoverTurnLeft'] = { t90, peak };
      expect(t90).not.toBeNull(); expect(t90!).toBeLessThanOrEqual(3);
    }
  }, 60_000);
});

/** The tuning with some fields removed (a definition copy: the shared profile object is left alone). */
function withoutTuning(...keys: (keyof NonNullable<typeof def.input.stabilityAssist>)[]): AircraftDefinition {
  const t = { ...def.input.stabilityAssist! };
  for (const k of keys) delete t[k];
  return { ...def, input: { ...def.input, stabilityAssist: t } };
}
/** A side gust from `at` s (east, 2 s ramp) on top of the rig's weather. */
function sideGust(r: Rig, at: number, eastMs: number): void {
  const env = r.physics.env, base = env.wind.bind(env);
  env.wind = (p, t) => { const w = base(p, t), k = Math.min(1, Math.max(0, (t - at) / 2)); return { x: w.x, y: w.y + k * eastMs, z: w.z }; };
}

/**
 * Round 2 (the pilot gate's follow-ups, W/bofly/r2): the pedal term holds the heading once the pedal keys rest (kpsi 1.0
 * per rad, kpsiI 0.3 per rad s, inside the same 6.5 % of pedal travel), so the torque change of a collective tap and a
 * gust no longer swing the nose, and a pedal tap ends in a new heading instead of a steady turn (yaw.log).
 */
describe('STAB ASSIST heading hold (rate command / direction hold below 30 KIAS)', () => {
  /** Heading change (deg) and yaw rate (deg/s) `k` s after a key tap at 1 s, against an untapped twin (2200 kg). */
  function tapAgainstTwin(code: string, hold: number, dd?: AircraftDefinition, T = 9) {
    const a = rig({ assist: true, payload: 'typical', dd }), b = rig({ assist: true, payload: 'typical', dd }), out: Record<string, number> = {};
    let maxHdg = 0;
    for (let i = 0; i < T / FRAME; i++) {
      const t = i * FRAME;
      if (Math.abs(t - 1) < FRAME / 2) a.input.keyDown(code);
      if (Math.abs(t - 1 - hold) < FRAME / 2) a.input.keyUp(code);
      frame(a); frame(b);
      maxHdg = Math.max(maxHdg, Math.abs(wrapDeg((a.physics.state.heading - b.physics.state.heading) / DEG)));
      for (const k of [3, 8, 15]) if (Math.abs(t + FRAME - 1 - k) < FRAME / 2) {
        out[`hdg${k}`] = wrapDeg((a.physics.state.heading - b.physics.state.heading) / DEG);
        out[`r${k}`] = (a.physics.state.angularVelocity.z - b.physics.state.angularVelocity.z) / DEG;
      }
    }
    return { ...out, maxHdg } as Record<string, number>;
  }
  it('a 0.3 s collective tap (F6 up, F5 down) with the pedals untouched leaves the heading within 3 deg at 8 s (round 1: +84 / -79 deg and turning)', () => {
    const up = tapAgainstTwin('F6', 0.3), down = tapAgainstTwin('F5', 0.3), r1 = tapAgainstTwin('F6', 0.3, withoutTuning('kpsi', 'kpsiI'));
    report.headingHoldCollectiveTap = { up, down, roundOneUp: r1 };
    expect(Math.abs(up.hdg8)).toBeLessThanOrEqual(3); expect(Math.abs(down.hdg8)).toBeLessThanOrEqual(3);
    expect(Math.abs(r1.hdg8)).toBeGreaterThan(30);
  }, 60_000);
  /**
   * Round 3 (the round-2 gate: a 0.5 s F6 tap spun the nose 180 deg, still turning at 22 deg/s at 15 s; W/bofly/pilot-r3
   * yaw.log): a 0.6 s tap (0.07 of the collective, +16 % torque) needs about 0.26 of the pedal axis, twice round 2's 6.5 %
   * of travel. The hold's own authority (holdAuthority, 15 %) holds the 0.5 / 0.6 s taps on its own (the hand-held pedal,
   * whose integral stays: withoutTuning('followUp')); the keyboard pedals' trim follow-up takes the trim off the series
   * term and holds the 1 s tap too. Round 2's law (no hold authority, no follow-up) recorded beside them.
   */
  it('0.5, 0.6 and 1.0 s collective taps (F6) with the pedals untouched: the heading back within 4 deg and the turn stopped by 15 s (round 2: 0.5 s spun 180 deg)', () => {
    const now: Record<string, Record<string, number>> = {}, held: Record<string, Record<string, number>> = {};
    for (const hold of [0.5, 0.6, 1.0]) now[hold] = tapAgainstTwin('F6', hold, undefined, 17);
    for (const hold of [0.5, 0.6]) held[hold] = tapAgainstTwin('F6', hold, withoutTuning('followUp'), 17);
    const r2 = tapAgainstTwin('F6', 0.5, withoutTuning('followUp', 'holdAuthority'), 17);
    report.headingHoldCollectiveTapRound3 = { now, handPedalsHoldAuthorityOnly: held, roundTwoLaw05: r2 };
    for (const hold of [0.5, 0.6, 1.0]) {
      expect(Math.abs(now[hold].hdg15)).toBeLessThanOrEqual(4); expect(Math.abs(now[hold].r15)).toBeLessThan(1);
      expect(now[hold].maxHdg).toBeLessThanOrEqual(25);
    }
    for (const hold of [0.5, 0.6]) { expect(Math.abs(held[hold].hdg8)).toBeLessThanOrEqual(3); expect(Math.abs(held[hold].r15)).toBeLessThan(1); }
    expect(r2.maxHdg).toBeGreaterThan(90);
  }, 120_000);
  it('a 0.5 s pedal key tap turns the nose 1-6 deg and stops there (yaw rate under 0.5 deg/s at 8 s; round 1: 29 deg and still turning at 3.8 deg/s)', () => {
    const right = tapAgainstTwin('KeyX', 0.5), left = tapAgainstTwin('KeyZ', 0.5);
    report.headingHoldPedalTap = { right, left };
    expect(right.hdg8).toBeGreaterThanOrEqual(1); expect(right.hdg8).toBeLessThanOrEqual(6);
    expect(left.hdg8).toBeLessThanOrEqual(-1); expect(left.hdg8).toBeGreaterThanOrEqual(-6);
    expect(Math.abs(right.r8)).toBeLessThan(0.5); expect(Math.abs(left.r8)).toBeLessThan(0.5);
  }, 60_000);
  it('hands off through an 8 kt side gust (calm 15 s, 2 s ramp; 2500 kg): the heading stays within 6 deg over 45 s (round 1: 42 deg)', () => {
    const r = rig({ assist: true }), h0 = r.physics.state.heading;
    sideGust(r, 15, 8 * KT);
    let maxHdg = 0;
    for (let i = 0; i < 45 / FRAME; i++) {
      frame(r);
      maxHdg = Math.max(maxHdg, Math.abs(wrapDeg((r.physics.state.heading - h0) / DEG)));
    }
    report.headingHoldGust = { maxHdg, crashed: r.physics.state.crashed };
    expect(r.physics.state.crashed).toBe(false);
    expect(maxHdg).toBeLessThanOrEqual(6);
  }, 60_000);
});

/**
 * Round 2 (W/bofly/r2 decel.log): the cyclic datum tracks the trim while the pilot flies through a slowing. The trim stick
 * moves with speed far more than the trim attitude (0 -> 30 KIAS: 0.26 of the axis forward against 0.8 deg of pitch), so
 * round 1's pair captured on the way down left the series term at its limit in the hover and the pilot's stick 10 % of
 * travel forward of the hover trim. Hands off nothing relaxes (the raw hover diverges): the gate is the pilot's stick.
 */
describe('STAB ASSIST datum on a decelerating approach', () => {
  it('captured at 30 KIAS, then a hover flown by a position-hold pilot: the series term falls to 1 % of travel or less (round 1: 7.3 %), and hands off afterwards it holds', () => {
    const run = (dd: AircraftDefinition) => {
      const assist = new StabilityAssist(dd.input.stabilityAssist!);
      const r0 = rotorRig(2200, { kt: 30, height: 15 });
      assist.before(DT, r0.fm.state, r0.c, true); assist.after(r0.c);
      const r = rotorRig(2200, { kt: 0, height: 15 }), hold = positionHold(r);
      for (let i = 0; i < 20 / DT; i++) { hold(DT); assist.before(DT, r.fm.state, r.c, true); r.fm.step(DT, r.c, r.env); assist.after(r.c); }
      const series = 50 * Math.max(Math.abs(assist.output.elevator), Math.abs(assist.output.aileron));
      const roll0 = r.fm.state.roll, pitch0 = r.fm.state.pitch;
      let maxAtt = 0;
      for (let i = 0; i < 40 / DT; i++) {
        assist.before(DT, r.fm.state, r.c, true); r.fm.step(DT, r.c, r.env); assist.after(r.c);
        maxAtt = Math.max(maxAtt, Math.abs(r.fm.state.roll - roll0) / DEG, Math.abs(r.fm.state.pitch - pitch0) / DEG);
      }
      return { seriesPctTravel: series, handsOffMaxAttDeg: maxAtt, crashed: r.fm.state.crashed };
    };
    const now = run(def), r1 = run(withoutTuning('datumRelaxKt'));
    report.datumStale30 = { now, roundOne: r1 };
    expect(now.seriesPctTravel).toBeLessThanOrEqual(1); expect(r1.seriesPctTravel).toBeGreaterThan(5);
    expect(now.crashed).toBe(false); expect(now.handsOffMaxAttDeg).toBeLessThanOrEqual(1);
  }, 120_000);
  it('a hand pilot slows from 45 KIAS to the hover at 1.5 kt/s (30 m): in the hover the series term is under 3.5 % of travel and the stick within 0.06 of the raw hover trim (round 1: 10 %, at its limit, and 0.2 forward); let go, it holds', () => {
    const fly = (dd: AircraftDefinition) => {
      const r = rig({ assist: true, payload: 'typical', dd, level: { kias: 45, heightM: 30 } });
      const s0 = r.physics.state, z0 = s0.position.z, hdg0 = s0.heading, e0 = r.c.elevator, a0 = r.c.aileron, p0 = r.c.rudder, c0 = r.c.collective ?? 0;
      let eI = 0, aI = 0, pI = 0, cI = 0, t = 0, stopT = -1, letGo = -1, sx = 0, sy = 0, frozen = { e: 0, a: 0 }, roll0 = 0, pitch0 = 0, maxAtt = 0;
      const acc = { n: 0, ser: 0, e: 0, a: 0 };
      while (t < 120) {
        r.input.update(FRAME, r.ctx);
        // A hand pilot: the stick and pedals are where the hand and feet put them (as a joystick and pedals set it), so
        // the keyboard trim follow-up leaves them alone and the datum tracks the slowing (round 3).
        r.c.keyboardCyclic = false; r.c.keyboardPedals = false;
        const s = r.physics.state, ch = Math.cos(s.heading), sh = Math.sin(s.heading);
        const vf = s.velocity.x * ch + s.velocity.y * sh, vr = -s.velocity.x * sh + s.velocity.y * ch;
        const vCmd = Math.max(0, 45 - 1.5 * t) * KT;
        if (stopT < 0 && vCmd === 0 && Math.abs(vf) < KT) { stopT = t; sx = s.position.x; sy = s.position.y; }
        if (stopT >= 0 && letGo < 0 && t > stopT + 15) { letGo = t; frozen = { e: r.c.elevator, a: r.c.aileron }; roll0 = s.roll; pitch0 = s.pitch; }
        const dx = stopT >= 0 ? s.position.x - sx : 0, dy = stopT >= 0 ? s.position.y - sy : 0, xf = dx * ch + dy * sh, xr = -dx * sh + dy * ch;
        if (letGo < 0) {
          const pitchT = clamp(3 * DEG - 0.045 * DEG * (vCmd / KT) + 0.03 * (vf - vCmd) + 0.01 * xf, -8 * DEG, 12 * DEG);
          const lat = clamp(1 - Math.abs(vf) / (20 * KT), 0, 1);
          const rollT = clamp(-3 * DEG * lat - lat * (0.03 * vr + 0.01 * xr), -10 * DEG, 10 * DEG);
          eI += (pitchT - s.pitch) * 0.3 * FRAME; aI += (rollT - s.roll) * 0.3 * FRAME;
          r.c.elevator = clamp(e0 + 1.2 * (pitchT - s.pitch) - 0.4 * s.angularVelocity.y + eI, -1, 1);
          r.c.aileron = clamp(a0 + 1.2 * (rollT - s.roll) - 0.3 * s.angularVelocity.x + aI, -1, 1);
        } else { r.c.elevator = frozen.e; r.c.aileron = frozen.a; }
        const he = Math.atan2(Math.sin(s.heading - hdg0), Math.cos(s.heading - hdg0));
        pI -= he * 0.5 * FRAME;
        r.c.rudder = clamp(p0 - 1.5 * he - 0.6 * s.angularVelocity.z + pI, -1, 1);
        cI += (s.position.z - z0) * 0.003 * FRAME;
        r.c.collective = clamp(c0 + 0.05 * s.velocity.z + 0.02 * (s.position.z - z0) + cI, 0, 1);
        r.physics.advance(FRAME); t += FRAME;
        const o = r.physics.stabilityAssist!.output, st = r.physics.state;
        if (stopT >= 0 && letGo < 0 && t > stopT + 10) { acc.n++; acc.ser = Math.max(acc.ser, Math.abs(o.elevator), Math.abs(o.aileron)); acc.e += r.c.elevator; acc.a += r.c.aileron; }
        if (letGo >= 0) { maxAtt = Math.max(maxAtt, Math.abs(st.roll - roll0) / DEG, Math.abs(st.pitch - pitch0) / DEG); if (t > letGo + 20) break; }
        if (st.crashed) break;
      }
      return { stopS: stopT, seriesPctTravel: 50 * acc.ser, stick: { e: acc.e / Math.max(1, acc.n), a: acc.a / Math.max(1, acc.n) }, handsOffMaxAttDeg: maxAtt, crashed: r.physics.state.crashed };
    };
    const hover = gaugesOf(rotorRig(2200, { kt: 0, height: 30 }));
    const now = fly(def), r1 = fly(withoutTuning('datumRelaxKt'));
    report.datumDecel = { now, roundOne: r1, rawHoverTrim: { e: hover.elevator, a: hover.aileron } };
    expect(now.stopS).toBeGreaterThan(0); expect(now.crashed).toBe(false);
    expect(now.seriesPctTravel).toBeLessThan(3.5); expect(r1.seriesPctTravel).toBeGreaterThan(8);
    expect(Math.abs(now.stick.e - hover.elevator)).toBeLessThanOrEqual(0.06); expect(Math.abs(now.stick.a - hover.aileron)).toBeLessThanOrEqual(0.06);
    expect(now.handsOffMaxAttDeg).toBeLessThanOrEqual(1);
  }, 120_000);
});

/**
 * Round 2 (W/bofly/r2 liftoff.log): the pedal term works on the ground once the skids carry less than half the weight, so
 * the heading is held from before lift-off. The runway start's pedal is at its centre and the hover wants 21 % of the
 * travel of left pedal, three times round 2's 6.5 %: lifting off with the pedal untouched still yawed (about 9 deg/s at
 * lift-off against 10.6, 43 deg/s at most against 68). Round 3 (W/bofly/pilot-r3 liftoff.log): the cyclic works there
 * too, its datum kept through a skid touch (groundLoad; the keyboard beginner's 3 ft hover after a runway lift-off ran
 * with the skids touching at 1-17 % of the weight, pitched to 16 deg and rolled to 23 with the cyclic term off, and was
 * lost at 20.7 s). On the ground the skids hold the yaw, so the keyboard pedal follow-up starts at lift-off.
 */
describe('STAB ASSIST on light skids', () => {
  function liftOff(dd: AircraftDefinition) {
    const r = rig({ assist: true, runway: true, dd });
    let t = 0, onGroundActive = false, loadedActive = false, rateAtLift = NaN, pedalAtLift = NaN;
    r.input.keyDown('F6');
    while (t < 20) {
      frame(r); t += FRAME;
      const s = r.physics.state, o = r.physics.stabilityAssist!.output, load = (s.wheels[0].load + s.wheels[1].load + s.wheels[2].load) / (s.mass * G0);
      if (s.onGround && load < 0.45 && o.gain > 0 && o.rudder !== 0 && (o.aileron !== 0 || o.elevator !== 0)) onGroundActive = true;
      if (s.onGround && load > 0.55 && o.gain > 0) loadedActive = true;
      if (!s.onGround && s.altitudeAGL > 0.9) { rateAtLift = Math.abs(s.angularVelocity.z) / DEG; pedalAtLift = r.c.rudder; break; }
    }
    r.input.keyUp('F6');
    return { onGroundActive, loadedActive, rateAtLift, pedalAtLift };
  }
  it('active below half the weight on the skids (cyclic and pedal terms), off above; the yaw rate at lift-off lower than with it off on the ground', () => {
    const now = liftOff(def), r1 = liftOff(withoutTuning('groundLoad'));
    report.groundLoad = { now, offOnTheGround: r1 };
    expect(now.onGroundActive).toBe(true); expect(now.loadedActive).toBe(false);
    expect(r1.onGroundActive).toBe(false);
    expect(now.rateAtLift).toBeLessThan(r1.rateAtLift - 1);
  }, 60_000);
});

describe('STAB ASSIST is silent where it should be', () => {
  it('off while the hover hold flies, on the ground, above 50 KIAS (full gain below 30), and when switched off', () => {
    const held = rig({ assist: true });
    held.physics.setAutoflight(true);
    for (let i = 0; i < 60; i++) frame(held);
    expect(held.physics.autoflight.engaged).toBe(true);
    expect(held.physics.stabilityAssist!.output.gain).toBe(0);
    const off = rig({ assist: false });
    for (let i = 0; i < 60; i++) frame(off);
    expect(off.physics.stabilityAssist!.output.gain).toBe(0);
    const on = rig({ assist: true });
    for (let i = 0; i < 60; i++) frame(on);
    expect(on.physics.stabilityAssist!.output.gain).toBe(1);
    const w = { ...defaultWeather(), windSpeedKt: 0, gustKt: 0, turbulence: 0 };
    const cruise = new SimPhysics({ aircraft: def, weather: w, events: createEventBus() });
    cruise.reset('cruise', w);
    expect(cruise.state.ias / KT).toBeGreaterThan(50);
    cruise.step(1);
    expect(cruise.stabilityAssist!.output.gain).toBe(0);
    const ground = new SimPhysics({ aircraft: def, weather: w, events: createEventBus() });
    ground.reset('runway', w);
    ground.step(1);
    expect(ground.state.onGround).toBe(true);
    expect(ground.stabilityAssist!.output.gain).toBe(0);
  }, 60_000);
  it('no other type builds one (R22, MD 500E): their physics never runs any of it', () => {
    for (const dd of [R22_DEFINITION, MD500_DEFINITION]) {
      const p = new SimPhysics({ aircraft: dd, weather: defaultWeather(), events: createEventBus() });
      expect(p.stabilityAssist).toBeNull();
      expect(p.stabilityAssistOn()).toBe(false);
    }
  });
});
