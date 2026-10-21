// The Bo 105's STAB ASSIST (a laptop sim aid, not a modelled system: src/sim/rotorcraft/stabilityAssist.ts; the
// flyability pass's F1, W/bofly/fix-plan.md) through the REAL InputSystem and SimPhysics, as the app runs it: the hover
// scenario (2500 kg, about 16 m), 60 frames per second, the assist's toggle linked as the Simulator links it. The raw
// aircraft's hands-off divergence is the real Bo 105's (ERF 1995 VII-7, P; bo105Derivatives' hover-modes row) and stays;
// these rows pin what the aid adds and that it adds nothing anywhere else. Pilot units throughout.
import { describe, expect, it } from 'vitest';
import { DEG, KT } from '../../src/core/math';
import { createEventBus, type SimContext } from '../../src/core/context';
import { defaultWeather, type WeatherSettings } from '../../src/core/types';
import type { AircraftDefinition } from '../../src/aircraft/types';
import { BO105_DEFINITION as def } from '../../src/aircraft/bo105';
import { MD500_DEFINITION } from '../../src/aircraft/md500';
import { R22_DEFINITION } from '../../src/aircraft/r22';
import { InputSystem } from '../../src/input/InputSystem';
import { SimPhysics } from '../../src/sim/SimPhysics';
import { demoScenario, hoverScenario } from '../../src/sim/rotorcraft/starts';
import { writeTrace } from './bo105Rig';
import { afterAll } from 'vitest';

const FRAME = 1 / 60;
const report: Record<string, unknown> = {};
afterAll(() => writeTrace('bo105Assist', report));

function rig(o: { wind?: boolean; assist: boolean; payload?: 'typical' | 'maxGross'; dd?: AircraftDefinition; ige?: boolean }) {
  const dd = o.dd ?? def;
  const w: WeatherSettings = { ...defaultWeather(), windSpeedKt: o.wind ? 8 : 0, gustKt: o.wind ? 5 : 0,
    turbulence: o.wind ? 0.3 : 0, isaDeviation: 0, cloudCover: 0 };
  const events = createEventBus(), physics = new SimPhysics({ aircraft: dd, weather: w, events });
  // ige: the R22 demo's hover start (skids about 1 m up); else the 15 m hover-hold scenario.
  const sc = o.ige ? demoScenario('hover', physics.env, dd.rotorcraft!) : hoverScenario(physics.env, dd.rotorcraft!);
  physics.resetTo(o.payload ? { ...sc, payload: o.payload } : sc, w);
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
  it('the series term never reaches the pilot\'s controls: hands off, the keyboard stick and pedals stay exactly at the trim while the assist works', () => {
    const r = rig({ wind: true, assist: true }), c0 = { a: r.c.aileron, e: r.c.elevator, r: r.c.rudder };
    let worked = 0;
    for (let i = 0; i < 300; i++) {
      frame(r);
      const o = r.physics.stabilityAssist!.output;
      worked = Math.max(worked, Math.abs(o.aileron), Math.abs(o.elevator), Math.abs(o.rudder));
      expect([r.c.aileron, r.c.elevator, r.c.rudder]).toEqual([c0.a, c0.e, c0.r]);
    }
    expect(worked).toBeGreaterThan(0);
    expect(r.input.pilotFlying(1e6)).toBe(false);
  }, 60_000);
});

describe('STAB ASSIST with the keys (attitude command, attitude hold; the pedal term damps the yaw rate)', () => {
  /** Fly with an optional key held from `at` for `hold` s; samples every frame. */
  function fly(T: number, assist: boolean, key?: { code: string; hold: number; at: number; shift?: boolean }, payload?: 'typical') {
    const r = rig({ assist, payload }), out: { roll: number; pitch: number; r: number }[] = [];
    for (let i = 0, n = Math.round(T / FRAME); i < n; i++) {
      const t = i * FRAME;
      if (key && Math.abs(t - key.at) < FRAME / 2) r.input.keyDown(key.code, key.shift);
      if (key && Math.abs(t - (key.at + key.hold)) < FRAME / 2) r.input.keyUp(key.code);
      frame(r);
      const s = r.physics.state;
      out.push({ roll: s.roll / DEG, pitch: s.pitch / DEG, r: s.angularVelocity.z / DEG });
    }
    return out;
  }
  const at = <T>(xs: T[], t: number): T => xs[Math.round(t / FRAME) - 1];
  it('a 1 s roll key tap banks 7-11 deg by 3 s and the bank is held (the raw aircraft: 8.9 deg at 3 s and diverging)', () => {
    const base = fly(9, true), tap = fly(9, true, { code: 'ArrowRight', hold: 1, at: 1 });
    const bank = (t: number) => at(tap, t).roll - at(base, t).roll;
    report.rollTap = { at3: bank(4), at5: bank(6), at8: bank(9) };
    expect(bank(4)).toBeGreaterThanOrEqual(7); expect(bank(4)).toBeLessThanOrEqual(11);
    expect(Math.abs(bank(9) - bank(4))).toBeLessThan(3);
  }, 60_000);
  it('a 10 % pedal step in the hover (2200 kg) reaches 16-31 deg/s at 3 s and is at least 85 % settled (ERF 1995 Nr -0.97 / -1.10 with N_ped 0.042: about 23 deg/s); the raw aircraft is still rising', () => {
    const step = (assist: boolean) => {
      const a = rig({ assist, payload: 'typical' }), b = rig({ assist, payload: 'typical' }), r0 = a.c.rudder, rates: Record<number, number> = {};
      for (let i = 0; i < 9 / FRAME; i++) {
        const t = (i + 1) * FRAME;
        a.input.update(FRAME, a.ctx); if (t > 1) a.c.rudder = r0 + 0.2; a.physics.advance(FRAME);
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
