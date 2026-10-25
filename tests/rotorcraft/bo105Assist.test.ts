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
import { parseSnapshot } from '../../src/sim/resume';
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
    expect(off.crash).not.toBeNull(); expect(off.crash!).toBeLessThan(50); // 41.7 s after the final fix round's in-plane force vector (was under 40)
  }, 120_000);
  /**
   * Tune round 2: the keyboard cyclic's translational rate command (TRC) also holds the position over the ground hands off
   * in this wind (2.9 m after 60 s; round 1 drifted with the gusts). Without the input module (bo105Rig's physics alone)
   * there is no keyboard stick and no TRC.
   */
  it('8 kt wind with 5 kt gusts and turbulence 0.3, 60 s: attitude within 5 deg, no crash, and (the TRC) within 10 m of the start', () => {
    const r = rig({ wind: true, assist: true }), x0 = r.physics.state.position.x, y0 = r.physics.state.position.y;
    const on = handsOff(r, 60), s = r.physics.state;
    const driftM = Math.hypot(s.position.x - x0, s.position.y - y0);
    report.handsOffWind = { ...on, driftM, groundSpeedKt: s.groundSpeed / KT };
    expect(on.crash).toBeNull(); expect(on.maxAttDeg).toBeLessThanOrEqual(5); expect(on.seriesPctTravel).toBeLessThanOrEqual(10);
    expect(driftM).toBeLessThanOrEqual(10);
  }, 120_000);
  /**
   * Round 3: the trim follow-up (followUp) walks the keyboard controls when the low-passed series term leaves its dead
   * band (20 % of the authority); hands off in this wind it hardly does. What reaches the controls is that walk (the
   * assist's `followed` readout; the stick follows the spring anchor at the input module's next frame), never the series
   * term itself.
   */
  /**
   * The tune pass: the height hold walks the keyboard collective and the crossfeed moves the pedals with it, so `followed`
   * (the walk) now carries those too; the series term still never leaks. The hover scenario now starts into the wind
   * (BO105_SIM.hoverIntoWind), trimmed at the start's wind, whose turbulence then varies the headwind: there the stick
   * and pedals are walked 0.034 of the axis in 5 s (measured). Drifting with the air mass (round 3's start, the
   * definition without hoverIntoWind) they stayed within round 3's 0.02.
   * Tune round 2: drifting with the air mass is now what the keyboard cyclic's translational rate command stops; its walk
   * of the datum is limited to 2 deg/s, so the stick walk stays inside round 3's 0.02 (0.013 in 5 s) while the ground
   * speed falls from 14.0 to 3.7 kt, which the row now checks too. The leak check is unchanged.
   */
  it('the series term never reaches the pilot\'s controls: hands off in gusts the keyboard stick and pedals move only by the trim follow-up and the crossfeed, and that stays small', () => {
    const drifting: AircraftDefinition = { ...def, sim: { ...def.sim, hoverIntoWind: undefined } };
    const fly = (dd?: AircraftDefinition) => {
      const r = rig({ wind: true, assist: true, dd }), c0 = { a: r.c.aileron, e: r.c.elevator, r: r.c.rudder }, a = r.physics.stabilityAssist!;
      const gs0Kt = r.physics.state.groundSpeed / KT;
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
      expect(r.input.pilotFlying(1e6)).toBe(false);
      return { worked, leak, moved, gs0Kt, gsKt: r.physics.state.groundSpeed / KT };
    };
    const intoWind = fly(), withTheAir = fly(drifting);
    report.seriesNeverReaches = { intoWind, withTheAir };
    for (const x of [intoWind, withTheAir]) { expect(x.worked).toBeGreaterThan(0); expect(x.leak).toBeLessThanOrEqual(0.1 / 60 + 1e-9); }
    expect(withTheAir.moved).toBeLessThanOrEqual(0.02);
    expect(intoWind.moved).toBeLessThanOrEqual(0.05);
    expect(withTheAir.gsKt).toBeLessThan(withTheAir.gs0Kt - 2);
  }, 60_000);
});

const wrapDeg = (a: number): number => ((a + 540) % 360) - 180;

describe('STAB ASSIST with the keys (attitude command, attitude hold; the pedal term damps the yaw rate and holds the heading)', () => {
  /** Fly with an optional key held from `at` for `hold` s; samples every frame. */
  function fly(T: number, assist: boolean, key?: { code: string; hold: number; at: number; shift?: boolean }, payload?: 'typical') {
    const r = rig({ assist, payload }), out: { roll: number; pitch: number; r: number; hdg: number; x: number; y: number; gsKt: number }[] = [];
    for (let i = 0, n = Math.round(T / FRAME); i < n; i++) {
      const t = i * FRAME;
      if (key && Math.abs(t - key.at) < FRAME / 2) r.input.keyDown(key.code, key.shift);
      if (key && Math.abs(t - (key.at + key.hold)) < FRAME / 2) r.input.keyUp(key.code);
      frame(r);
      const s = r.physics.state;
      out.push({ roll: s.roll / DEG, pitch: s.pitch / DEG, r: s.angularVelocity.z / DEG, hdg: s.heading / DEG, x: s.position.x, y: s.position.y, gsKt: s.groundSpeed / KT });
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
   * The tune pass (W/tune/bo105): the drift's translational lift no longer becomes a climb and a torque swing (the height
   * hold takes it back, the crossfeed pedals it), so the nose stays within 3.0 deg at 8 s (round 2: 40) and the drift
   * stays purely sideward: its airflow rolls the bank back to level by 8 s (9.6 deg at 3 s, 5.9 at 5 s, -0.01 at 8 s).
   * Round 2's "stays on the tapped side" (bank at 8 s >= 0) was a description, not a source; restated as "not past
   * level by more than 1 deg", with the heading band tightened from 50 to 10 deg.
   * Tune round 2 (the translational rate command, TRC; W/tune/bo105 r2): the keyboard stick left after the tap now leans
   * the datum against the sideward drift and, once it has rested 2.5 s, walks it to the zero-ground-speed trim, so the bank
   * goes PAST level to stop the drift (9.6 / 5.9 / -0.01 deg at 3 / 5 / 8 s before; now 7.1 / -0.0 / -4.6) and the
   * helicopter comes back to a hover over the ground (25.1 m at most, 0.05 kt at 40 s). "Not past level by more than 1 deg" described the attitude hold's
   * drift; restated as the TRC's: the drift stopped (ground speed under 1 kt) within 40 s and within 30 m (the gate's
   * position criterion), the bank at 3 s and the nose band kept.
   */
  it('a 1 s roll key tap banks 7-11 deg by 3 s; hands off the TRC rolls it back past level and stops the drift: ground speed under 1 kt by 40 s, within 30 m, the nose within 10 deg (round 1: 84 deg at 8 s, round 2: 40)', () => {
    const base = fly(41, true), tap = fly(41, true, { code: 'ArrowRight', hold: 1, at: 1 });
    const bank = (t: number) => at(tap, t).roll - at(base, t).roll;
    const hdg8 = Math.abs(wrapDeg(at(tap, 9).hdg - at(base, 9).hdg));
    const driftM = Math.max(...tap.map((p, i) => Math.hypot(p.x - base[i].x, p.y - base[i].y)));
    const peakKt = Math.max(...tap.map((p) => p.gsKt)), endKt = at(tap, 41).gsKt;
    report.rollTap = { at3: bank(4), at5: bank(6), at8: bank(9), hdg8, driftM, peakKt, endKt };
    expect(bank(4)).toBeGreaterThanOrEqual(7); expect(bank(4)).toBeLessThanOrEqual(11);
    expect(bank(9)).toBeLessThan(0);
    expect(hdg8).toBeLessThanOrEqual(10);
    expect(endKt).toBeLessThan(1); expect(driftM).toBeLessThanOrEqual(30);
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
    // Round 1's law for the contrast: no heading hold, and none of the tune pass's height hold and crossfeed (with them the
    // tap's torque is taken back and pedalled, so even round 1's law would not spin).
    const up = tapAgainstTwin('F6', 0.3), down = tapAgainstTwin('F5', 0.3), r1 = tapAgainstTwin('F6', 0.3, withoutTuning('kpsi', 'kpsiI', 'heightHold', 'pedalCrossfeed'));
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
   * The tune pass (W/tune/bo105 h_rows_final): the height hold takes the tap's climb back and the crossfeed pedals the
   * collective change while the pedal keys rest, so the 0.5 / 0.6 / 1.0 s taps peak at 2.0 / 2.4 / 4.1 deg (round 3:
   * 11.4 / 13.5 / 20.2); the peak band tightened from 25 to 6 deg.
   */
  it('0.5, 0.6 and 1.0 s collective taps (F6) with the pedals untouched: the heading within 6 deg, back within 4 deg and the turn stopped by 15 s (round 2: 0.5 s spun 180 deg; round 3: 20 deg peak)', () => {
    const now: Record<string, Record<string, number>> = {}, held: Record<string, Record<string, number>> = {};
    for (const hold of [0.5, 0.6, 1.0]) now[hold] = tapAgainstTwin('F6', hold, undefined, 17);
    for (const hold of [0.5, 0.6]) held[hold] = tapAgainstTwin('F6', hold, withoutTuning('followUp'), 17);
    // Round 2's law for the contrast, without the tune pass's height hold and crossfeed too.
    const r2 = tapAgainstTwin('F6', 0.5, withoutTuning('followUp', 'holdAuthority', 'heightHold', 'pedalCrossfeed'), 17);
    report.headingHoldCollectiveTapRound3 = { now, handPedalsHoldAuthorityOnly: held, roundTwoLaw05: r2 };
    for (const hold of [0.5, 0.6, 1.0]) {
      expect(Math.abs(now[hold].hdg15)).toBeLessThanOrEqual(4); expect(Math.abs(now[hold].r15)).toBeLessThan(1);
      expect(now[hold].maxHdg).toBeLessThanOrEqual(6);
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
  /**
   * Tune round 2: above 50 KIAS this holds for a hand-held stick or the physics alone (no keyboard cyclic, as here); the
   * keyboard cyclic keeps its attitude hold through cruise (cruiseHold: the row in the cruise describe), with the pedal
   * term and the height hold still silent above their fades.
   */
  it('off while the hover hold flies, on the ground, above 50 KIAS without a keyboard cyclic (full gain below 30), and when switched off', () => {
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
    expect(cruise.stabilityAssist!.output.gain).toBe(0); expect(cruise.stabilityAssist!.output.cyclicGain).toBe(0);
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

/**
 * The tune pass (W/tune/bo105, item 1; the law and its measured tuning in src/aircraft/bo105/input.ts): the STAB ASSIST's
 * height hold on the keyboard collective (ADS-33E's rate command / height hold, full below 30 KIAS, gone at 40) and the
 * washed-out collective-to-pedal crossfeed on the keyboard pedals. The keyboard deceleration it was built for is in
 * bo105KeyTransitions.test.ts; here what it does in the hover and where it stays out.
 */
describe('STAB ASSIST height hold and collective crossfeed (the keyboard collective and pedals)', () => {
  const noHeight = (): AircraftDefinition => withoutTuning('heightHold', 'pedalCrossfeed');
  /** Hands off for `seconds` from the hover scenario; the largest height change (m) and the collective walked. */
  function heightHandsOff(o: { wind: boolean; dd?: AircraftDefinition }, seconds: number) {
    const r = rig({ assist: true, wind: o.wind, dd: o.dd }), z0 = r.physics.state.position.z, c0 = r.c.collective ?? 0;
    let dh = 0;
    for (let i = 0; i < seconds / FRAME; i++) { frame(r); dh = Math.max(dh, Math.abs(r.physics.state.position.z - z0)); }
    return { dhM: dh, collectiveWalk: (r.c.collective ?? 0) - c0, crashed: r.physics.state.crashed, mode: r.physics.stabilityAssist!.heightMode };
  }
  it('hands off in the hover scenario the height is held: within 0.5 m calm and 3 m in 8 kt of wind with 5 kt gusts over 60 s (without it: measured beside)', () => {
    const calm = heightHandsOff({ wind: false }, 60), gusty = heightHandsOff({ wind: true }, 60);
    const calmWithout = heightHandsOff({ wind: false, dd: noHeight() }, 60), gustyWithout = heightHandsOff({ wind: true, dd: noHeight() }, 60);
    report.heightHandsOff = { calm, gusty, calmWithout, gustyWithout };
    expect(calm.crashed).toBe(false); expect(gusty.crashed).toBe(false);
    expect(calm.dhM).toBeLessThanOrEqual(0.5); expect(gusty.dhM).toBeLessThanOrEqual(3);
    expect(calm.mode).toBe('hold');
  }, 120_000);
  /**
   * F6 held 2 s in the 2200 kg hover, then let go: the key moves the lever (the hold damps it by 0.03 of the travel per
   * second per m/s while held), the climb stops after the release and the new height is held. Without the hold the lever
   * stays up and the climb goes on.
   */
  it('F6 held 2 s then let go: it climbs while held, levels off within 4 s of the release and holds that height within 0.5 m (without the hold it keeps climbing)', () => {
    const fly = (dd?: AircraftDefinition) => {
      const r = rig({ assist: true, payload: 'typical', dd }), z0 = r.physics.state.position.z;
      let climbHeld = 0, levelS: number | null = null, hAt: number | null = null, dhAfter = 0;
      for (let i = 0; i < 16 / FRAME; i++) {
        const t = i * FRAME;
        if (Math.abs(t - 1) < FRAME / 2) r.input.keyDown('F6');
        if (Math.abs(t - 3) < FRAME / 2) r.input.keyUp('F6');
        frame(r);
        const s = r.physics.state, climb = -s.velocity.z;
        if (t < 3) climbHeld = Math.max(climbHeld, climb);
        else if (levelS === null && Math.abs(climb) < 0.3) { levelS = t - 3; hAt = z0 - s.position.z; }
        else if (hAt !== null && t > 3 + (levelS ?? 0) + 2) dhAfter = Math.max(dhAfter, Math.abs(z0 - s.position.z - hAt));
      }
      return { climbHeld, levelS, heightStep: hAt, dhAfter, climbEnd: -r.physics.state.velocity.z, collective: r.c.collective };
    };
    const held = fly(), without = fly(noHeight());
    report.heightF6Held = { held, without };
    expect(held.climbHeld).toBeGreaterThan(0.5);
    expect(held.levelS).not.toBeNull(); expect(held.levelS!).toBeLessThanOrEqual(4);
    expect(held.dhAfter).toBeLessThanOrEqual(0.5);
    expect(without.climbEnd).toBeGreaterThan(0.5);
  }, 60_000);
  /**
   * Where it stays out: without an input module (physics alone, as bo105Rig flies) nothing is walked; above 40 KIAS and on
   * the ground (the runway, the skids loaded) it is off; a double engine failure in the hover (both levers OFF) switches
   * it off within a frame (the engines stop running and the needles split) and the NR decay is the same as without it
   * (W/tune/bo105 i_dualfail.log: 55.9 % at 10 s, 2200 kg).
   */
  it('off without a keyboard collective, above 40 KIAS, on the ground and after a double engine failure (NR as without it)', () => {
    const w = { ...defaultWeather(), windSpeedKt: 0, gustKt: 0, turbulence: 0 };
    const bare = new SimPhysics({ aircraft: def, weather: w, events: createEventBus() });
    bare.resetTo(hoverScenario(bare.env, def.rotorcraft!), w);
    bare.controls.collective! += 0.03; bare.step(5);
    expect(bare.stabilityAssist!.followed.collective).toBe(0);
    const fast = rig({ assist: true, level: { kias: 45, heightM: 30 } });
    const c0 = fast.c.collective;
    for (let i = 0; i < 300; i++) frame(fast);
    expect(fast.physics.stabilityAssist!.heightMode).toBe('off'); expect(fast.c.collective).toBe(c0);
    const ground = rig({ assist: true, runway: true });
    for (let i = 0; i < 120; i++) frame(ground);
    expect(ground.physics.state.onGround).toBe(true); expect(ground.physics.stabilityAssist!.heightMode).toBe('off');
    const dual = (dd?: AircraftDefinition) => {
      const r = rig({ assist: true, payload: 'typical', dd });
      for (let i = 0; i < 120; i++) frame(r);
      for (const e of r.c.engines) e.throttle = 0;
      r.c.throttle = 0;
      let offAfter: number | null = null, nrMin = Infinity;
      const c1 = r.c.collective;
      for (let i = 0; i < 60; i++) {
        frame(r);
        if (offAfter === null && r.physics.stabilityAssist!.heightMode === 'off') offAfter = (i + 1) * FRAME;
        nrMin = Math.min(nrMin, r.physics.state.rotorcraft!.turboshaft!.nrPct);
      }
      return { offAfter, nrMin, collectiveRise: (r.c.collective ?? 0) - (c1 ?? 0) };
    };
    const withIt = dual(), without = dual(noHeight());
    report.heightGuards = { dual: { withIt, without } };
    expect(withIt.offAfter).not.toBeNull(); expect(withIt.offAfter!).toBeLessThanOrEqual(2 * FRAME);
    expect(withIt.collectiveRise).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(withIt.nrMin - without.nrMin)).toBeLessThanOrEqual(0.1);
  }, 60_000);
  /**
   * The law's limits on one step (StabilityAssist.before on a live hover state, the flight model not stepped): in a sink
   * it raises the lever, but not while above the maximum continuous power (takeoffPowerSeconds > 0) or the power limit;
   * climbing it lowers the lever, but never below its floor (0.1 of the travel); at most `rate` x dt.
   */
  it('one step: raises in a sink at most rate x dt, never above the maximum continuous power, never lowers below the floor', () => {
    const r = rig({ assist: true, payload: 'typical' });
    for (let i = 0; i < 60; i++) frame(r);
    const hh = def.input.stabilityAssist!.heightHold!;
    const step = (vz: number, collective: number, mcp: boolean): number => {
      const a = new StabilityAssist(def.input.stabilityAssist!), s = structuredClone(r.physics.state);
      s.velocity.z = vz; if (mcp) s.rotorcraft!.takeoffPowerSeconds = 1;
      const c = { ...r.c, collective, keyboardCollective: true, collectiveWorked: false };
      a.before(DT, s, c, true); a.after(c);
      return c.collective! - collective;
    };
    const sink = step(3, 0.4, false), sinkMcp = step(3, 0.4, true), climbAtFloor = step(-3, hh.floor, false), climb = step(-3, 0.4, false);
    report.heightStep = { sink, sinkMcp, climbAtFloor, climb, rateDt: hh.rate * DT };
    expect(sink).toBeGreaterThan(0); expect(sink).toBeLessThanOrEqual(hh.rate * DT + 1e-12);
    expect(sinkMcp).toBe(0);
    expect(climb).toBeLessThan(0); expect(climbAtFloor).toBe(0);
  });
  /** The crossfeed is airborne and keyboard-pedal only; a pedal key held makes the collective change the pilot's. */
  it('the crossfeed pedals a collective change while the pedal keys rest (airborne), not while a pedal key is held', () => {
    const r = rig({ assist: true, payload: 'typical' });
    for (let i = 0; i < 60; i++) frame(r);
    const a = r.physics.stabilityAssist!, f0 = a.followed.rudder;
    r.c.collective! += 0.05; frame(r);
    const resting = a.followed.rudder - f0;
    const xf = def.input.stabilityAssist!.pedalCrossfeed!;
    r.input.keyDown('KeyX'); frame(r);
    const f1 = a.followed.rudder;
    r.c.collective! += 0.05; frame(r);
    const keyed = a.followed.rudder - f1;
    r.input.keyUp('KeyX');
    report.crossfeed = { resting, expected: xf.perCollective * 0.05, keyed };
    expect(resting).toBeCloseTo(xf.perCollective * 0.05, 1);
    expect(Math.abs(keyed)).toBeLessThan(0.01);
  }, 60_000);
  /**
   * Tune round 2 (pedalCrossfeed.onLightSkids; the round-1 gate's lift-off item): on light skids the crossfeed pedals the
   * lift-off's collective too, unless a pedal key was worked since the skids last left the ground (the pilot who set the
   * pedal before raising the collective pedals the lift-off; crossfeeding it as well pushed the 2 s left-pedal lift-off's
   * first 6 s from 24 to 54 deg, W/tune/bo105 r2 p3_trcx.log). Runway start, the collective raised until the skids carry
   * under half the weight, then 0.03 more.
   */
  it('on light skids the crossfeed pedals a collective rise, unless a pedal key was worked on the skids (forgotten at a new flight)', () => {
    const lift = (pedalFirst: boolean, resetAfterPedal = false) => {
      const r = rig({ assist: true, runway: true, payload: 'typical' }), a = r.physics.stabilityAssist!;
      for (let i = 0; i < 30; i++) frame(r);
      if (pedalFirst) { r.input.keyDown('KeyZ'); for (let i = 0; i < 6; i++) frame(r); r.input.keyUp('KeyZ'); }
      // A new flight on the runway (as the Simulator resets: the physics, then the input module told).
      if (resetAfterPedal) { r.physics.resetTo(r.physics.scenario, r.ctx.weather); r.ctx.events.emit('reset', { scenario: 'runway' }); for (let i = 0; i < 30; i++) frame(r); }
      const load = (): number => { const w = r.physics.state.wheels; return (w[0].load + w[1].load + w[2].load) / (r.physics.state.mass * G0); };
      while (load() > 0.4 && r.c.collective! < 0.5) { r.c.collective! += 0.005; frame(r); }
      for (let i = 0; i < 30; i++) frame(r);
      const f0 = a.followed.rudder;
      r.c.collective! += 0.03; frame(r);
      return { onGround: r.physics.state.onGround, load: load(), crossfed: a.followed.rudder - f0 };
    };
    const untouched = lift(false), pedalled = lift(true), newFlight = lift(true, true);
    report.crossfeedLightSkids = { untouched, pedalled, newFlight, expected: def.input.stabilityAssist!.pedalCrossfeed!.perCollective * 0.03 };
    expect(untouched.onGround).toBe(true); expect(pedalled.onGround).toBe(true); expect(newFlight.onGround).toBe(true);
    expect(untouched.crossfed).toBeCloseTo(def.input.stabilityAssist!.pedalCrossfeed!.perCollective * 0.03, 1);
    expect(newFlight.crossfed).toBeCloseTo(def.input.stabilityAssist!.pedalCrossfeed!.perCollective * 0.03, 1);
    expect(Math.abs(pedalled.crossfed)).toBeLessThan(0.01);
  }, 60_000);
  /**
   * Tune round 2 (heightHold.held; the round-1 gate's must item): a bare F5 / F6 held airborne below 30 KIAS is a
   * climb-rate command (2 m/s), the key's own move of the lever taken back and the lever walked by the hold; the sink
   * falls to 0.7 m/s over the 4 m above 4 m of AGL. Round 1 only damped a held key (0.03 of the travel per second per m/s
   * against the key's 0.12 per second): held from the 16 m hover F5 crashed in a 5.9 m/s sink, from 3 ft it touched at
   * 2.2 m/s, and F5 held 4 s then released was not caught (W/tune/bo105 gate1 g3_land; now r2 p4_lb05).
   */
  it('F5 held from the 16 m hover and from 3 ft lands softly (touchdown under 1.5 m/s, not crashed); F5 held 4 s then released is caught (round 1: crashed, 2.2 m/s, crashed)', () => {
    const land = (o: { ige: boolean; heldS: number }) => {
      const r = rig({ assist: true, ige: o.ige });
      for (let i = 0; i < 60; i++) frame(r);
      let t = 0, touchVz: number | null = null, caught: number | null = null, maxSink = 0;
      r.input.keyDown('F5');
      while (t < 60) {
        if (t >= o.heldS && touchVz === null) r.input.keyUp('F5');
        frame(r); t += FRAME;
        const s = r.physics.state;
        maxSink = Math.max(maxSink, s.velocity.z);
        if (touchVz === null && s.onGround) { touchVz = s.velocity.z; break; }
        if (s.crashed) break;
        if (t > o.heldS + 0.5 && caught === null && s.velocity.z < 0.05) { caught = s.altitudeAGL; break; }
      }
      r.input.keyUp('F5');
      return { touchVz, caught, maxSink, crashed: r.physics.state.crashed };
    };
    const hover = land({ ige: false, heldS: 60 }), ige = land({ ige: true, heldS: 60 }), held4 = land({ ige: false, heldS: 4 });
    report.heightF5Held = { hover, ige, held4 };
    for (const x of [hover, ige]) { expect(x.crashed).toBe(false); expect(x.touchVz).not.toBeNull(); expect(x.touchVz!).toBeLessThan(1.5); }
    expect(held4.crashed).toBe(false); expect(held4.caught).not.toBeNull(); expect(held4.maxSink).toBeLessThan(3);
  }, 120_000);
  /**
   * F6 held 5 s in the 16 m hover (2500 kg): the climb-rate command stops raising the lever at the power limit and backs
   * it off while F6 stays held past it (limitBackRate: the torque lags the lever), so the torque peaks at the 86 % AEO
   * limit (P5 FM 2-10) rather than past it (round 1, the key moving the lever: 118.6 % and a 122 m climb; without the back
   * off 88.7 %). Released, the climb stops. Shift+F6 stays the pilot's hand-rate key (below).
   */
  it('F6 held 5 s climbs at the torque limit, not past it (peak within 0.5 % of 86 %; round 1: 118.6 %), and levels off within 4 s of the release', () => {
    const r = rig({ assist: true });
    for (let i = 0; i < 60; i++) frame(r);
    let t = 0, maxTq = 0, climbMax = 0, levelS: number | null = null;
    r.input.keyDown('F6');
    while (t < 12) {
      if (Math.abs(t - 5) < FRAME / 2) r.input.keyUp('F6');
      frame(r); t += FRAME;
      const s = r.physics.state, rc = s.rotorcraft!;
      maxTq = Math.max(maxTq, rc.turboshaft!.torquePsi, rc.twinTurboshaft?.second.torquePsi ?? 0);
      climbMax = Math.max(climbMax, -s.velocity.z);
      if (t > 5 && levelS === null && Math.abs(s.velocity.z) < 0.3) levelS = t - 5;
    }
    report.heightF6Held5 = { maxTq, climbMax, levelS };
    expect(maxTq).toBeLessThanOrEqual(86.5);
    expect(climbMax).toBeGreaterThan(0.5);
    expect(levelS).not.toBeNull(); expect(levelS!).toBeLessThanOrEqual(4);
  }, 60_000);
  /** The hand-rate keys stay raw with the assist on: Shift+F5 for 0.2 s lowers the lever 0.2 (1.0 per second), as off. */
  it('Shift+F5 stays the pilot\'s: the lever moves at the hand rate with the assist on, as with it off', () => {
    const lower = (assist: boolean) => {
      const r = rig({ assist });
      for (let i = 0; i < 60; i++) frame(r);
      const c0 = r.c.collective!;
      r.input.keyDown('F5', true);
      for (let i = 0; i < 12; i++) frame(r);
      r.input.keyUp('F5');
      return r.c.collective! - c0;
    };
    const on = lower(true), off = lower(false);
    report.shiftF5 = { on, off };
    expect(off).toBeCloseTo(-0.2, 2);
    expect(Math.abs(on - off)).toBeLessThanOrEqual(0.005);
  }, 60_000);
});

describe('STAB ASSIST cruise attitude hold on the keyboard cyclic (tune round 2: StabilityAssistTuning.cruiseHold)', () => {
  /**
   * One step at 80 KIAS (above the 30-50 KIAS fade) on a live trimmed state with 5 deg of roll and pitch error put on it:
   * the keyboard stick's cyclic terms keep full gain (cyclicGain 1) and command against the error, while the pedal term
   * stays faded (gain 0, no rudder). A hand-held stick (keyboardCyclic false: the mouse yoke, a hardware stick) got
   * nothing above the fade (tune round 2); since the tune pass 2 fix (cruiseHold.handHeld, W/tune2/bo105 fix1 f_h5) it
   * keeps the same hold, and without handHeld it gets none, as before.
   */
  it('above the fade the keyboard cyclic keeps the attitude hold (cyclic gain 1, the pedal term silent); a hand-held stick too with cruiseHold.handHeld, none without', () => {
    const r = rig({ assist: true, level: { kias: 80, heightM: 100 } });
    for (let i = 0; i < 30; i++) frame(r);
    expect(r.physics.state.ias / KT).toBeGreaterThan(70);
    const step = (keyboard: boolean, tuning = def.input.stabilityAssist!) => {
      const a = new StabilityAssist(tuning), s = structuredClone(r.physics.state);
      const c = { ...r.c, keyboardCyclic: keyboard, keyboardPedals: keyboard, keyboardCollective: false };
      a.before(DT, s, c, true);
      s.roll += 5 * DEG; s.pitch += 5 * DEG;
      a.after(c); a.before(DT, s, c, true);
      const out = { ...a.output };
      a.after(c);
      return out;
    };
    const t = def.input.stabilityAssist!;
    const kb = step(true), hand = step(false), handWithout = step(false, { ...t, cruiseHold: { gain: t.cruiseHold!.gain } });
    report.cruiseStep = { kb, hand, handWithout };
    expect(kb.cyclicGain).toBe(1); expect(kb.gain).toBe(0); expect(Math.abs(kb.rudder)).toBe(0);
    expect(kb.aileron).toBeLessThan(-0.05); expect(kb.elevator).toBeLessThan(-0.05);
    expect(t.cruiseHold!.handHeld).toBe(true);
    expect(hand.cyclicGain).toBe(1); expect(hand.gain).toBe(0); expect(hand.aileron).toBeLessThan(-0.05); expect(hand.elevator).toBeLessThan(-0.05);
    expect(handWithout.cyclicGain).toBe(0); expect(handWithout.aileron).toBe(0); expect(handWithout.elevator).toBe(0);
  });
});

describe('STAB ASSIST translational rate command on the keyboard cyclic (tune round 2: ADS-33E TRC at hover and low speed)', () => {
  /** Hands off 60 s after a key knock at 2 s in the hover scenario: the largest distance from the start, the ground speed at the end. */
  function knock(code: string, hold: number, dd?: AircraftDefinition) {
    const r = rig({ assist: true, dd }), s0 = r.physics.state, x0 = s0.position.x, y0 = s0.position.y;
    let t = 0, driftM = 0, maxKias = 0;
    while (t < 62) {
      if (Math.abs(t - 2) < FRAME / 2) r.input.keyDown(code);
      if (Math.abs(t - 2 - hold) < FRAME / 2) r.input.keyUp(code);
      frame(r); t += FRAME;
      const s = r.physics.state;
      driftM = Math.max(driftM, Math.hypot(s.position.x - x0, s.position.y - y0)); maxKias = Math.max(maxKias, s.ias / KT);
      if (s.crashed) break;
    }
    return { driftM, maxKias, endKt: r.physics.state.groundSpeed / KT, crashed: r.physics.state.crashed };
  }
  /**
   * The round-1 gate (gate1 g5_letgo): a 1 s ArrowUp knock in the hover, hands off, reached 35 KIAS and 490 m in 60 s and a
   * 0.3 s knock 65 m (the attitude hold kept the knocked attitude). The TRC leans the datum against the ground speed (1 deg
   * per kt, at most 6) and walks it to the zero-ground-speed trim once the keyboard stick has rested 2.5 s (0.3 deg per
   * s per kt, at most 2 deg/s): back to a hover within the gate's 30 m (W/tune/bo105 r2 p1_m2: 27.7 / 3.4 m). Without the
   * TRC (the cruise attitude hold on) the 1 s knock now runs away to 69 kt and 1,040 m.
   */
  it('hands off after a 1 s or 0.3 s ArrowUp knock in the hover it comes back to a hover over the ground within 30 m (round 1: 490 / 65 m)', () => {
    const one = knock('ArrowUp', 1), short = knock('ArrowUp', 0.3), without = knock('ArrowUp', 1, withoutTuning('translationalRate'));
    report.trcKnock = { one, short, without };
    for (const k of [one, short]) { expect(k.crashed).toBe(false); expect(k.driftM).toBeLessThanOrEqual(30); expect(k.endKt).toBeLessThan(1); }
    expect(without.driftM).toBeGreaterThan(100);
  }, 120_000);
  /**
   * One step on a live hover state with the ground velocity set (StabilityAssist.before, the flight model not stepped): 5 kt
   * forward leans the datum 5 deg nose up, so the series elevator is katt x 5 deg aft on the keyboard stick; a hand-held
   * stick (keyboardCyclic false: a mouse yoke or hardware stick) keeps the attitude command alone; at 35 kt of ground
   * speed (above fadeKt) there is none; 5 kt to the right leans the roll datum left.
   */
  it('keyboard stick and low speed only: 5 kt forward gives katt x 5 deg of aft series elevator; none for a hand-held stick or at 35 kt; 5 kt right rolls the datum left', () => {
    const r = rig({ assist: true, payload: 'typical' });
    for (let i = 0; i < 60; i++) frame(r);
    const t = def.input.stabilityAssist!;
    const step = (fwdKt: number, rightKt: number, keyboard: boolean) => {
      const a = new StabilityAssist(t), s = structuredClone(r.physics.state), h = s.heading;
      s.velocity.x = (fwdKt * Math.cos(h) - rightKt * Math.sin(h)) * KT; s.velocity.y = (fwdKt * Math.sin(h) + rightKt * Math.cos(h)) * KT;
      s.angularVelocity.x = s.angularVelocity.y = s.angularVelocity.z = 0;
      const c = { ...r.c, keyboardCyclic: keyboard, keyboardPedals: keyboard, keyboardCollective: false };
      a.before(DT, s, c, true);
      const out = { e: a.output.elevator, a: a.output.aileron };
      a.after(c);
      return out;
    };
    const kb = step(5, 0, true), hand = step(5, 0, false), fast = step(35, 0, true), right = step(0, 5, true);
    const expected = t.katt * 5 * t.translationalRate!.degPerKt * DEG;
    report.trcStep = { kb, hand, fast, right, expected };
    expect(kb.e).toBeCloseTo(expected, 2);
    expect(Math.abs(hand.e)).toBeLessThan(1e-9); expect(Math.abs(fast.e)).toBeLessThan(1e-9);
    expect(right.a).toBeCloseTo(-expected, 2);
  });
});

describe('STAB ASSIST through a resume (src/sim/resume.ts: the snapshot carries its datums)', () => {
  /**
   * The hover scenario (2500 kg, 16 m), the stick held 0.1 of the axis right from 1 s (an attitude command, so the datum
   * and the stick reference matter), saved at 4 s through JSON and restored into a fresh SimPhysics. Imported, the
   * assist's state is the saved one and its first series command after the restore is the unbroken flight's; without
   * the block (an older snapshot) it re-captures the datum at the restore and its command steps (the old T11
   * workaround's 0.25 % Nr step: tests/rotorcraft/twinGovernor.test.ts T11 now runs with the assist on). The attitude
   * itself is not compared: the restore's own transient (inflow and lags from rest) moves the unstable hover 1.8 deg in 5
   * s with or without the assist (raw aircraft: 7.7 deg). A malformed block is dropped; a type without the assist writes
   * none; ControlInputs.pedalFollowUp is zeroed.
   */
  it('a restore goes on with the saved datums: the state round-trips and the first series command matches the unbroken flight (re-captured: steps)', () => {
    const w = { ...defaultWeather(), windSpeedKt: 0, gustKt: 0, turbulence: 0 };
    const fly = (keep: 'import' | 'recapture') => {
      const a = new SimPhysics({ aircraft: def, weather: w, events: createEventBus() });
      a.resetTo(hoverScenario(a.env, def.rotorcraft!), w);
      a.step(1); a.controls.aileron += 0.1; a.step(3);
      const snap = a.captureSnapshot({ weather: w, cameraMode: 'chase', quality: 'high', renderScale: null, resume: true, now: 1_800_000_000_000 });
      snap.controls.pedalFollowUp = 0.01;
      const back = parseSnapshot(JSON.stringify(snap))!;
      expect(back.assist?.captured).toBe(true);
      if (keep === 'recapture') delete back.assist;
      const b = new SimPhysics({ aircraft: def, weather: { ...back.weather }, events: createEventBus() });
      b.restore(back);
      const same = JSON.stringify(a.stabilityAssist!.exportState()) === JSON.stringify(b.stabilityAssist!.exportState());
      a.step(DT); b.step(DT);
      const oa = a.stabilityAssist!.output, ob = b.stabilityAssist!.output;
      return { same, step: Math.max(Math.abs(oa.aileron - ob.aileron), Math.abs(oa.elevator - ob.elevator), Math.abs(oa.rudder - ob.rudder)),
        series: { a: oa.aileron, b: ob.aileron }, pedalFollowUp: b.controls.pedalFollowUp };
    };
    const imported = fly('import'), recaptured = fly('recapture');
    report.resume = { imported, recaptured };
    expect(imported.same).toBe(true); expect(recaptured.same).toBe(false);
    expect(imported.step).toBeLessThanOrEqual(0.002);
    expect(recaptured.step).toBeGreaterThan(0.01);
    expect(imported.pedalFollowUp).toBe(0);
    // A malformed block is dropped (the assist captures afresh); a type without the assist writes none.
    const s0 = new SimPhysics({ aircraft: def, weather: w, events: createEventBus() });
    s0.resetTo(hoverScenario(s0.env, def.rotorcraft!), w); s0.step(0.5);
    const raw = s0.captureSnapshot({ weather: w, cameraMode: 'chase', quality: 'high', renderScale: null, resume: true, now: 1_800_000_000_000 });
    expect(parseSnapshot(JSON.stringify({ ...raw, assist: { captured: 'yes' } }))!.assist).toBeUndefined();
    const md = new SimPhysics({ aircraft: MD500_DEFINITION, weather: w, events: createEventBus() });
    md.resetTo(hoverScenario(md.env, MD500_DEFINITION.rotorcraft!), w); md.step(0.5);
    expect(md.captureSnapshot({ weather: w, cameraMode: 'chase', quality: 'high', renderScale: null, resume: true, now: 1_800_000_000_000 }).assist).toBeUndefined();
  }, 60_000);
});
