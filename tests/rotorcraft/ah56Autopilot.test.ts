// The AH-56A hold (A; src/sim/rotorcraft/autopilot.ts with AH56_SIM.heliHold), flown through the shell's path: the REAL
// SimPhysics and InputSystem at 60 frames per second (tests/rotorcraft/bo105KeyPilot.ts keyRig's wiring), the STAB ASSIST
// linked as the Simulator links it, and the Simulator's autopilotFlying link (the input module puts the cyclic, pedals and
// collective back where the hold left them every frame). No keys while A is on. Starts trimmed at the hover scenario's place
// (typical load), 2 s hands off, then A (SimPhysics.setAutoflight(true), the A key's call).
//
// BEFORE (main 69aca96, the shared law of the R22 family; W/rigid/ah56ap notes.md): the AMCS rocked +/-3 deg in pitch and roll
// about once a second at every speed (the cyclic sawing +/-0.3 at the 1/s hand-rate limit), heading-bug turns were flat pedal
// turns (a 90 at 100 kt: 19 deg of sideslip, the pedal at its stop 24 % of the time), engaging in a 21 deg bank swung the roll
// 37 deg (aileron step 0.55), engaging in a climb kicked 11-12 deg of roll and stepped the collective 0.11, A off stepped the
// stick 0.12-0.27, and the pusher was left to the PROP SCHEDULE input aid (or frozen once the grip was touched).
import { describe, expect, it } from 'vitest';
import { DEG, KT, interp1 } from '../../src/core/math';
import { createEventBus, type SimContext } from '../../src/core/context';
import { defaultWeather, type WeatherSettings } from '../../src/core/types';
import { AH56_DEFINITION } from '../../src/aircraft/ah56';
import { R22_DEFINITION } from '../../src/aircraft/r22';
import { R44_DEFINITION } from '../../src/aircraft/r44';
import { S269_DEFINITION } from '../../src/aircraft/s269';
import { MD500_DEFINITION } from '../../src/aircraft/md500';
import { BO105_DEFINITION } from '../../src/aircraft/bo105';
import { InputSystem } from '../../src/input/InputSystem';
import { SimPhysics } from '../../src/sim/SimPhysics';
import { hoverScenario } from '../../src/sim/rotorcraft/starts';

const FRAME = 1 / 60;
const wrapDeg = (a: number): number => Math.atan2(Math.sin(a * DEG), Math.cos(a * DEG)) / DEG;
const log = (label: string, values: Record<string, number | string | boolean>): void =>
  console.log(`[ah56Autopilot] ${label}: ${Object.entries(values).map(([k, v]) => `${k}=${typeof v === 'number' ? +v.toPrecision(3) : v}`).join('  ')}`);

/** The rig: `kias` at `heightM` (wheels) on `headingDeg`, the AMCS unless `config`; gear up above 90 kt. */
function rig(o: { kias: number; heightM: number; config?: 'amcs' | 'ics'; headingDeg?: number; wind?: { fromDeg: number; kt: number; gustKt?: number; turbulence?: number } }) {
  const dd = AH56_DEFINITION;
  const w: WeatherSettings = { ...defaultWeather(), windSpeedKt: o.wind?.kt ?? 0, windDirectionDeg: o.wind?.fromDeg ?? 100, gustKt: o.wind?.gustKt ?? 0,
    turbulence: o.wind?.turbulence ?? 0, isaDeviation: 0, cloudCover: 0 };
  const events = createEventBus(), physics = new SimPhysics({ aircraft: dd, weather: w, events, rotorcraftConfig: o.config });
  const sc = hoverScenario(physics.env, dd.rotorcraft!);
  physics.resetTo({ ...sc, ic: { ...sc.ic, airspeed: o.kias * KT, position: { ...sc.ic.position, z: sc.ic.position.z - (o.heightM - 15) },
    ...(o.headingDeg !== undefined ? { heading: o.headingDeg * DEG } : {}), ...(o.kias > 90 ? { gearDown: false } : {}) } }, w);
  if (o.kias > 90) physics.controls.gearLever = 'up';
  const noop = (): void => {};
  const ctx = { state: physics.renderState, controls: physics.controls, weather: w, env: physics.env, events, paused: false, timeScale: 1,
    cameraMode: 'cockpit', simTime: 0, commands: { reset: noop, setPaused: noop, setCameraMode: noop, setTimeScale: noop, setQuality: noop } } as unknown as SimContext;
  const input = new InputSystem({ profile: dd.input });
  input.attach(ctx);
  input.assists.stabilityAssist = true;
  physics.stabilityAssistOn = () => input.assists.stabilityAssist === true;
  input.autopilotFlying = () => !!physics.autoflight.helicopter && physics.autoflight.engaged;
  return { physics, input, c: physics.controls, ctx, t: 0 };
}
type Rig = ReturnType<typeof rig>;
function frame(r: Rig): void { r.input.update(FRAME, r.ctx); r.physics.advance(FRAME); r.t += FRAME; }

interface Sample { t: number; kias: number; alt: number; vs: number; hdg: number; n: number; e: number; pitch: number; roll: number; beta: number;
  elev: number; ail: number; rud: number; coll: number; prop: number }
function sample(r: Rig): Sample {
  const s = r.physics.state, c = r.c;
  return { t: r.t, kias: s.ias / KT, alt: s.altitudeMSL, vs: s.verticalSpeed, hdg: s.heading / DEG, n: s.position.x, e: s.position.y,
    pitch: s.pitch / DEG, roll: s.roll / DEG, beta: s.beta / DEG, elev: c.elevator, ail: c.aileron, rud: c.rudder, coll: c.collective ?? 0, prop: c.propLever ?? NaN };
}
/** Fly `seconds`, a sample every frame; `each(t since start)` before each frame. */
function fly(r: Rig, seconds: number, each?: (t: number) => void): Sample[] {
  const out: Sample[] = [], t0 = r.t;
  for (let i = 0; i < Math.round(seconds / FRAME); i++) { each?.(r.t - t0); frame(r); out.push(sample(r)); expect(r.physics.state.crashed).toBe(false); }
  return out;
}
const range = (xs: Sample[], f: (x: Sample) => number): number => Math.max(...xs.map(f)) - Math.min(...xs.map(f));
const maxAbs = (xs: Sample[], f: (x: Sample) => number): number => Math.max(...xs.map((x) => Math.abs(f(x))));

/** Start, 2 s hands off (`pre` then runs), A; returns the samples from A on and the engagement sample. */
function engage(r: Rig, pre?: (r: Rig) => void): Sample {
  fly(r, 2);
  pre?.(r);
  // The input module counts a key released within the last 100 ms of WALL time as the pilot still flying (pilotFlying), and then
  // does not put the hold's controls back: the shell would not engage then (the A key comes later). Let that time pass.
  for (const t = performance.now(); performance.now() - t < 150;) { /* wait */ }
  const s0 = sample(r);
  r.physics.setAutoflight(true);
  expect(r.physics.autoflight.engaged).toBe(true);
  return s0;
}

describe('AH-56A hold (AMCS)', () => {
  it('the tuning is what fixes it: the shared law alone (no AH56_SIM.heliHold) rocks at 100 kt, the tuned hold is still (pitch range under a tenth)', () => {
    const run = (tuned: boolean) => {
      const r = rig({ kias: 100, heightM: 150 });
      if (!tuned) r.physics.autoflight.helicopter!.tuning = null;
      engage(r);
      const late = fly(r, 40).filter((x) => x.t > r.t - 20);
      return { pitch: range(late, (x) => x.pitch), roll: range(late, (x) => x.roll), elev: range(late, (x) => x.elev) };
    };
    const shared = run(false), tuned = run(true);
    log('shared law 100 kt', shared); log('tuned 100 kt', tuned);
    // Before (main 69aca96): the shared law's 5.9 deg of pitch and 0.62 of elevator swing (5.4-7.4 deg at every speed).
    expect(tuned.pitch).toBeLessThan(0.1 * shared.pitch);
    expect(tuned.roll).toBeLessThan(0.1 * shared.roll);
  }, 120_000);

  it('hovers (15 m and 3 ft) without rocking: attitude range < 0.5 deg, position within 1 m, height within 0.2 m, for 90 s', () => {
    for (const h of [15, 3]) {
      const r = rig({ kias: 0, heightM: h });
      const s0 = engage(r);
      const all = fly(r, 90), late = all.filter((x) => x.t > s0.t + 30);
      const v = { pitch: range(late, (x) => x.pitch), roll: range(late, (x) => x.roll), pos: maxAbs(all, (x) => Math.hypot(x.n - s0.n, x.e - s0.e)),
        alt: maxAbs(all, (x) => x.alt - s0.alt), elev: range(late, (x) => x.elev), ail: range(late, (x) => x.ail) };
      log(`hover ${h} m`, v);
      expect(v.pitch).toBeLessThan(0.5); // before 5.4 / 6.0
      expect(v.roll).toBeLessThan(0.5); // before 6.8 / 8.1
      expect(v.pos).toBeLessThan(1);
      expect(v.alt).toBeLessThan(0.2);
    }
  }, 240_000);

  it('cruise at 35, 60, 100 and 150 KIAS: steady (attitude range < 0.5 deg), IAS within 1 kt, height within 1 m, heading within 1 deg', () => {
    for (const kias of [35, 60, 100, 150]) {
      const r = rig({ kias, heightM: kias > 50 ? 150 : 60 });
      const s0 = engage(r);
      const all = fly(r, 60), late = all.filter((x) => x.t > s0.t + 30);
      const held = r.physics.autoflight.autopilot.settings.airspeed / KT;
      const v = { held, pitch: range(late, (x) => x.pitch), roll: range(late, (x) => x.roll), kias: maxAbs(late, (x) => x.kias - held),
        alt: maxAbs(all, (x) => x.alt - s0.alt), hdg: maxAbs(late, (x) => wrapDeg(x.hdg - s0.hdg)), pitchTr: maxAbs(all, (x) => x.pitch - s0.pitch) };
      log(`cruise ${kias}`, v);
      expect(v.pitch).toBeLessThan(0.5); // before 5.2-7.4
      expect(v.roll).toBeLessThan(0.5); // before 4.8-8.0
      expect(v.kias).toBeLessThan(kias > 50 ? 1 : 2); // the held speed is the IAS from 40 KIAS up (35: the forward ground speed)
      expect(v.alt).toBeLessThan(1);
      expect(v.hdg).toBeLessThan(1); // before: the bank-for-heading law without its trim left 0.6-5.8 deg
    }
  }, 300_000);

  it('a 90 deg heading-bug turn at 100 kt and a 180 at 60 kt are coordinated standard-rate turns: sideslip < 1.5 deg, bank <= 25 deg, height within 3 m, IAS within 3 kt', () => {
    for (const [kias, turn, secs] of [[100, 90, 60], [60, 180, 90]] as const) {
      const r = rig({ kias, heightM: 150 });
      const s0 = engage(r);
      const bug0 = r.c.headingBugDeg;
      const all = fly(r, secs, (t) => { if (Math.abs(t - 5) < FRAME / 2) r.c.headingBugDeg = (bug0 + turn) % 360; });
      const turning = all.filter((x) => x.t > s0.t + 10 && x.t < s0.t + 10 + turn / 3 - 5);
      const rate = (wrapDeg(turning[turning.length - 1].hdg - turning[0].hdg)) / (turning[turning.length - 1].t - turning[0].t);
      const end = all[all.length - 1];
      const v = { rate, beta: maxAbs(all, (x) => x.beta), bank: maxAbs(all, (x) => x.roll), alt: maxAbs(all, (x) => x.alt - s0.alt),
        kias: maxAbs(all, (x) => x.kias - s0.kias), hdgEnd: wrapDeg(end.hdg - s0.hdg - turn), rud: maxAbs(all, (x) => x.rud) };
      log(`turn ${turn} at ${kias}`, v);
      expect(v.rate).toBeGreaterThan(2.5); expect(v.rate).toBeLessThan(3.3); // standard rate (before: 8 deg/s on the pedals)
      expect(v.beta).toBeLessThan(1.5); // before 19 / 38 deg
      expect(v.bank).toBeLessThan(25);
      expect(v.alt).toBeLessThan(3); // before 2.4 / 3.9
      expect(v.kias).toBeLessThan(3); // before 4.8 / 14
      expect(Math.abs(v.hdgEnd)).toBeLessThan(1.5);
    }
  }, 240_000);

  it('engaged in a 20 deg bank at 100 kt: rolls level smoothly at 5 deg/s (aileron change < 0.2 in the first second, no roll past level by more than 3 deg) and holds the heading it rolled out on', () => {
    const r = rig({ kias: 100, heightM: 150 });
    const s0 = engage(r, (rr) => { for (let i = 0; i < 600 && rr.physics.state.roll < 20 * DEG; i++) { rr.input.keyDown('ArrowRight'); frame(rr); } rr.input.keyUp('ArrowRight'); fly(rr, 0.5); });
    expect(s0.roll).toBeGreaterThan(18);
    const all = fly(r, 60), first = all.filter((x) => x.t < s0.t + 1), late = all.filter((x) => x.t > s0.t + 30);
    const bug = r.physics.autoflight.autopilot.settings.heading / DEG;
    const v = { ail1s: maxAbs(first, (x) => x.ail - s0.ail), overshoot: Math.max(0, -Math.min(...all.map((x) => x.roll))) , hdgLate: maxAbs(late, (x) => wrapDeg(x.hdg - bug)),
      rollLate: range(late, (x) => x.roll), bugMoved: wrapDeg(bug - s0.hdg) };
    log('engaged in a bank', v);
    expect(v.ail1s).toBeLessThan(0.2); // 0.12-0.15: the 5 deg/s roll-out ramp; before 0.53 at once
    expect(v.overshoot).toBeLessThan(4); // 2.75 (the trim roll is -1); before: rolled 16 deg past level
    expect(v.hdgLate).toBeLessThan(1);
    expect(v.rollLate).toBeLessThan(0.5);
  }, 120_000);

  it('engaged in a climb and in a descent (F6 / F5 held 1 s at 60 kt): no collective step (< 0.05 in 1 s), levels off smoothly and holds within 0.5 m', () => {
    for (const key of ['F6', 'F5']) {
      const r = rig({ kias: 60, heightM: 120 });
      const s0 = engage(r, (rr) => { rr.input.keyDown(key); fly(rr, 1); rr.input.keyUp(key); fly(rr, 3); });
      expect(Math.abs(s0.vs)).toBeGreaterThan(1);
      const all = fly(r, 60), first = all.filter((x) => x.t < s0.t + 1), late = all.filter((x) => x.t > s0.t + 40);
      const held = r.physics.autoflight.autopilot.settings.altitude;
      const v = { vs0: s0.vs, coll1s: maxAbs(first, (x) => x.coll - s0.coll), levelOffM: held - s0.alt, altLate: maxAbs(late, (x) => x.alt - held), rollTr: maxAbs(all, (x) => x.roll - s0.roll) };
      log(`engaged in ${key === 'F6' ? 'a climb' : 'a descent'}`, v);
      expect(v.coll1s).toBeLessThan(0.05); // before 0.11
      expect(v.altLate).toBeLessThan(0.5);
      expect(Math.abs(v.levelOffM)).toBeLessThan(15); // where the 0.3 m/s/s walk levels off
    }
  }, 240_000);

  it('a 100 ft height change (T) at 100 kt: climbs at <= 2.1 m/s, overshoot < 1 m, attitude steady', () => {
    const r = rig({ kias: 100, heightM: 150 });
    const s0 = engage(r);
    const all = fly(r, 50, (t) => { if (Math.abs(t - 5) < FRAME / 2) r.physics.autoflight.adjustAltitude(100 * 0.3048); });
    const target = s0.alt + 30.48;
    const v = { maxVs: Math.max(...all.map((x) => x.vs)), overshoot: Math.max(...all.map((x) => x.alt)) - target, end: all[all.length - 1].alt - target,
      pitch: range(all, (x) => x.pitch), kias: maxAbs(all, (x) => x.kias - s0.kias) };
    log('height +100 ft', v);
    expect(v.maxVs).toBeLessThan(2.1);
    expect(v.overshoot).toBeLessThan(1);
    expect(Math.abs(v.end)).toBeLessThan(0.5);
    expect(v.kias).toBeLessThan(2);
  }, 120_000);

  it('hands back without a step: A off after 60 s at 100 kt and after the hover moves no control more than 0.02 in 2 s', () => {
    for (const kias of [100, 0]) {
      const r = rig({ kias, heightM: kias ? 150 : 15 });
      engage(r);
      fly(r, 60);
      const before = sample(r);
      r.physics.setAutoflight(false);
      const after = fly(r, 10), d2 = after.filter((x) => x.t < before.t + 2);
      const v = { elev: maxAbs(d2, (x) => x.elev - before.elev), ail: maxAbs(d2, (x) => x.ail - before.ail), rud: maxAbs(d2, (x) => x.rud - before.rud),
        coll: maxAbs(d2, (x) => x.coll - before.coll), prop: maxAbs(d2, (x) => x.prop - before.prop), pitch10: after[after.length - 1].pitch - before.pitch };
      log(`hand-back ${kias}`, v);
      for (const k of ['elev', 'ail', 'rud', 'coll', 'prop'] as const) expect(v[k], k).toBeLessThan(0.02); // before: elev 0.15-0.27
      expect(Math.abs(v.pitch10)).toBeLessThan(1); // before 1.7-3.1 deg
    }
  }, 240_000);

  it('flies the pusher grip: on the PROP SCHEDULE table at the held speed, even with the grip touched (a dev-panel 100 -> 130 kt change), and the hover detent in the hover', () => {
    const sched = AH56_DEFINITION.input.propLever!.schedule!;
    const r = rig({ kias: 100, heightM: 150 });
    const s0 = engage(r, (rr) => { rr.input.keyDown('Semicolon'); fly(rr, 0.1); rr.input.keyUp('Semicolon'); fly(rr, 2); });
    const st = r.physics.autoflight.autopilot.settings;
    const all = fly(r, 50, (t) => { if (Math.abs(t - 5) < FRAME / 2) st.airspeed = 130 * KT; });
    const end = all[all.length - 1];
    const v = { lever0: s0.prop, leverEnd: end.prop, want: interp1(sched.kias, sched.lever, 130), kiasEnd: end.kias, alt: maxAbs(all, (x) => x.alt - s0.alt),
      pitch: range(all, (x) => x.pitch) };
    log('pusher 100 -> 130', v);
    expect(Math.abs(v.leverEnd - v.want)).toBeLessThan(0.005);
    expect(Math.abs(v.kiasEnd - 130)).toBeLessThan(2);
    expect(v.alt).toBeLessThan(6); // before (a step, no rate): 59-74 m
    expect(v.pitch).toBeLessThan(12); // before 36-37 deg
    const h = rig({ kias: 0, heightM: 15 });
    engage(h, (rr) => { rr.input.keyDown('Slash', true); frame(rr); rr.input.keyUp('Slash'); fly(rr, 1); }); // grip snapped to +8 deg
    const hv = fly(h, 20);
    log('pusher hover', { lever: hv[hv.length - 1].prop, detent: sched.lever[0] });
    expect(Math.abs(hv[hv.length - 1].prop - sched.lever[0])).toBeLessThan(0.002);
  }, 180_000);

  it('engaged drifting with the wind in the hover (15 kt, gusts 5): stops gently (pitch within 8 deg) and holds within 5 m of where it stopped', () => {
    const r = rig({ kias: 0, heightM: 15, wind: { fromDeg: 280, kt: 15, gustKt: 5, turbulence: 0.2 } });
    const s0 = engage(r);
    expect(s0.kias).toBeLessThan(3);
    // Stopped by 30 s (0.5 m/s per s from about 8 m/s); the point it holds is where it is then.
    const all = fly(r, 120), stop = all.find((x) => x.t > s0.t + 30)!;
    const late = all.filter((x) => x.t > s0.t + 30);
    const v = { pitch: maxAbs(all, (x) => x.pitch - s0.pitch), pos: maxAbs(late, (x) => Math.hypot(x.n - stop.n, x.e - stop.e)), alt: maxAbs(all, (x) => x.alt - s0.alt) };
    log('engaged drifting', v);
    expect(v.pitch).toBeLessThan(8); // before 21 deg, flying 46 m back to where A was pressed
    expect(v.pos).toBeLessThan(5);
    expect(v.alt).toBeLessThan(2);
  }, 180_000);
});

describe('AH-56A hold (ICS)', () => {
  it('the ICS keeps the shared inner gains and holds the hover and 100 kt steady; turns coordinated', () => {
    const h = rig({ kias: 0, heightM: 15, config: 'ics' });
    const h0 = engage(h);
    const hv = fly(h, 40).filter((x) => x.t > h0.t + 10);
    const r = rig({ kias: 100, heightM: 150, config: 'ics' });
    const s0 = engage(r);
    const bug0 = r.c.headingBugDeg;
    const all = fly(r, 60, (t) => { if (Math.abs(t - 5) < FRAME / 2) r.c.headingBugDeg = (bug0 + 90) % 360; });
    const v = { hoverPitch: range(hv, (x) => x.pitch), hoverPos: maxAbs(hv, (x) => Math.hypot(x.n - h0.n, x.e - h0.e)), beta: maxAbs(all, (x) => x.beta),
      alt: maxAbs(all, (x) => x.alt - s0.alt), hdgEnd: wrapDeg(all[all.length - 1].hdg - s0.hdg - 90) };
    log('ics', v);
    expect(v.hoverPitch).toBeLessThan(0.3);
    expect(v.hoverPos).toBeLessThan(0.5);
    expect(v.beta).toBeLessThan(1.5); // before 17 deg
    expect(v.alt).toBeLessThan(3);
    expect(Math.abs(v.hdgEnd)).toBeLessThan(1.5);
  }, 180_000);
});

it('only the AH-56A opts into the tuned hold (every other helicopter flies the shared law, digest-exact)', () => {
  for (const d of [R22_DEFINITION, R44_DEFINITION, S269_DEFINITION, MD500_DEFINITION, BO105_DEFINITION]) expect(d.sim.heliHold, d.id).toBeUndefined();
  expect(AH56_DEFINITION.sim.heliHold?.inner?.amcs).toBeDefined();
  expect(AH56_DEFINITION.sim.heliHold?.inner?.ics).toBeUndefined();
});
