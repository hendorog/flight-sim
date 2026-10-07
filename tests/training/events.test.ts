// Derived training events and the landing detector (section 2.5; engine/events.ts).
//
// "Recorded fixtures": the flights below are recorded live in node from the real flight model (SimPhysics,
// the existing autoflight and the physics autopilot), in calm air, so they are deterministic and need no JSON
// fixture files: a take-off (liftoff), an approach to a full stop (thresholdCrossed, mainsTouchdown,
// landing, stopped), a go-around from 200 ft (goAround) and an autopilot-held idle-power stall
// (stallWarnOn, stallBreak, stallWarnOff). Synthetic frame series then pin down each rule's edges.

import { describe, expect, it } from 'vitest';
import { createEventBus } from '../../src/core/context';
import { FPM, FT, KT } from '../../src/core/math';
import { makeMockState } from '../../src/core/mockState';
import { defaultWeather, type WeatherSettings } from '../../src/core/types';
import { AIRPORT } from '../../src/core/world';
import { Autopilot, defaultAutopilotSettings } from '../../src/physics';
import type { ScenarioId } from '../../src/core/context';
import { SimPhysics } from '../../src/sim/SimPhysics';
import { TrainingBus } from '../../src/training/engine/bus';
import { DerivedEventDetector, LandingDetector, REST_AGL_FT, touchdownData } from '../../src/training/engine/events';
import { Telemetry } from '../../src/training/telemetry/telemetry';
import type { AircraftTypeDef, SignalFrame, TelemetrySources, TouchdownData, TrainingEventName, TrainingEventRecord } from '../../src/training/types';
import { LINE_UP } from '../../src/world/airport/layout';

const AIRCRAFT = { id: 'test', vspeeds: {}, settings: {} } as unknown as AircraftTypeDef;
const CALM: Partial<WeatherSettings> = { windSpeedKt: 0, gustKt: 0, turbulence: 0 };
const FRAME = 1 / 30;

// ---- live recording rig -------------------------------------------------------------------------------------

function rig(id: ScenarioId) {
  const w = { ...defaultWeather(), ...CALM };
  const simEvents = createEventBus();
  const p = new SimPhysics({ weather: w, events: simEvents });
  p.reset(id, w);
  const tel = new Telemetry();
  const bus = new TrainingBus();
  const det = new DerivedEventDetector(bus);
  const land = new LandingDetector(bus);
  // A second landing detector fed by frames only (no step-exact contacts), as on recorded frames.
  const frameBus = new TrainingBus();
  const frameLand = new LandingDetector(frameBus);
  // As TrainingSystem will: the touchdown handler runs inside the physics step and reads the exact state.
  simEvents.on('touchdown', (e) => land.onTouchdown(touchdownData(p.state, e.wheel, e.sinkRate / FPM), p.state.time));
  const src: TelemetrySources = {
    state: p.state, controls: p.controls, readings: null, weather: w, env: p.env, aircraft: AIRCRAFT,
    studentInput: false, timeScale: 1, route: null,
  };
  const log: TrainingEventRecord[] = [];
  bus.on('*', (r) => log.push(r));
  /** One rendered frame: physics (optionally with a per-step controller), then telemetry and the detectors. */
  const tick = (perStep?: (h: number) => void): SignalFrame => {
    if (perStep) {
      for (let i = 0; i < 8; i++) {
        perStep(1 / 240);
        p.step(1 / 240);
      }
    } else p.step(FRAME);
    const f = tel.sample(src, FRAME);
    det.update(f, p.state.time, FRAME);
    land.update(f, p.state.time, FRAME);
    frameLand.update(f, p.state.time, FRAME);
    return f;
  };
  const of = <K extends TrainingEventName>(type: K): TrainingEventRecord<K>[] => log.filter((r) => r.type === type) as TrainingEventRecord<K>[];
  const types = (): string[] => log.map((r) => r.type);
  return { p, tel, bus, frameBus, tick, of, types };
}

describe('recorded flights (real flight model)', () => {
  it('take-off: one liftoff, near Vr, on the runway; nothing else', () => {
    const r = rig('runway');
    r.p.setAutoflight(true, true);
    for (let i = 0; i < 90 / FRAME; i++) r.tick();
    expect(r.p.state.altitudeAGL / FT).toBeGreaterThan(300);
    const lo = r.of('liftoff');
    expect(lo).toHaveLength(1);
    expect(lo[0].data.kias).toBeGreaterThan(50);
    expect(lo[0].data.kias).toBeLessThan(70);
    const startAlong = 20; // LINE_UP is 20 m inside the threshold
    expect(LINE_UP[0].runway).toBe('07');
    expect(lo[0].data.rwyAlongM).toBeGreaterThan(startAlong + 100);
    expect(lo[0].data.rwyAlongM).toBeLessThan(AIRPORT.runway.length);
    expect(new Set(r.types())).toEqual(new Set(['liftoff']));
  }, 60000);

  it('approach to a full stop: thresholdCrossed, mainsTouchdown, landing, stopped', () => {
    const r = rig('final');
    r.p.setAutoflight(true, true);
    const done = (): boolean => r.p.autoflight.phase === 'stopped' || r.p.autoflight.phase === 'parked';
    for (let i = 0; i < 260 / FRAME && !done(); i++) r.tick();
    for (let i = 0; i < 5 / FRAME; i++) r.tick();
    expect(done()).toBe(true);

    const thr = r.of('thresholdCrossed');
    expect(thr).toHaveLength(1);
    expect(thr[0].data.heightFt).toBeGreaterThan(15);
    expect(thr[0].data.heightFt).toBeLessThan(70);
    expect(thr[0].data.kias).toBeGreaterThan(55);
    expect(thr[0].data.kias).toBeLessThan(75);

    const td = r.of('mainsTouchdown');
    expect(td).toHaveLength(1);
    const t = td[0].data;
    expect(t.firstWheel).not.toBe('nose');
    expect(t.onRunway).toBe(true);
    expect(t.sinkFpm).toBeGreaterThan(0);
    expect(t.sinkFpm).toBeLessThan(500);
    expect(Math.abs(t.rwyAcrossM)).toBeLessThan(5);
    expect(t.distAimFt).toBeGreaterThan(-400);
    expect(t.distAimFt).toBeLessThan(1500);
    expect(Math.abs(t.bankDeg)).toBeLessThan(5);
    expect(t.pitchDeg).toBeGreaterThan(-2);

    const ld = r.of('landing');
    expect(ld).toHaveLength(1);
    const l = ld[0].data;
    expect(l.fullStop).toBe(true);
    expect(l.crashed).toBe(false);
    expect(l.bounces).toBe(0);
    expect(l.kiasAt50Ft).toBeGreaterThan(55);
    expect(l.kiasAt50Ft).toBeLessThan(80);
    expect(Math.abs(l.gpDevFtAt300)).toBeLessThan(50);
    expect(l.floatS).toBeGreaterThanOrEqual(0);
    expect(l.floatS).toBeLessThan(10);
    expect(l.rolloutMaxAcrossM).toBeLessThan(8);
    expect(l.sinkFpm).toBe(t.sinkFpm);

    expect(r.of('stopped')).toHaveLength(1);
    const order = r.types().filter((x) => x !== 'stopped');
    expect(order).toEqual(['thresholdCrossed', 'mainsTouchdown', 'landing']);
    expect(r.of('stopped')[0].seq).toBeGreaterThan(td[0].seq);

    // Frames alone (no step-exact contact) give nearly the same touchdown.
    const ft = r.frameBus.since(0).filter((x) => x.type === 'mainsTouchdown') as TrainingEventRecord<'mainsTouchdown'>[];
    expect(ft).toHaveLength(1);
    expect(Math.abs(ft[0].data.distAimFt - t.distAimFt)).toBeLessThan(15);
    expect(Math.abs(ft[0].data.sinkFpm - t.sinkFpm)).toBeLessThan(250);
    expect(r.frameBus.since(0).filter((x) => x.type === 'landing')).toHaveLength(1);
  }, 60000);

  it('go-around from 200 ft: one goAround with the height of the throttle push; no touchdown', () => {
    const r = rig('final');
    r.p.setAutoflight(true, true);
    let f = r.tick();
    while ((f.aglFt as number) > 200) f = r.tick();
    r.p.setAutoflight(false);
    const ap = new Autopilot();
    ap.settings = { ...defaultAutopilotSettings(), lateral: 'heading', heading: AIRPORT.runway.heading, vertical: 'airspeed', airspeed: 65 * KT };
    r.p.controls.throttle = 1;
    for (let i = 0; i < 40 / FRAME; i++) f = r.tick((h) => ap.update(h, r.p.state, r.p.controls));
    expect(f.aglFt as number).toBeGreaterThan(300);
    const ga = r.of('goAround');
    expect(ga).toHaveLength(1);
    expect(ga[0].data.aglFt).toBeGreaterThan(180);
    expect(ga[0].data.aglFt).toBeLessThanOrEqual(200);
    expect(r.of('mainsTouchdown')).toHaveLength(0);
    expect(r.of('landing')).toHaveLength(0);
    expect(r.of('liftoff')).toHaveLength(0);
  }, 60000);

  it('idle-power stall held by the autopilot: stallWarnOn, stallBreak, then stallWarnOff in the recovery', () => {
    const r = rig('cruise');
    const alt0 = r.p.state.altitudeMSL;
    const ap = new Autopilot();
    ap.settings = { ...defaultAutopilotSettings(), lateral: 'wingLeveler', vertical: 'altitude', altitude: alt0 };
    r.p.setAutoflight(false);
    r.p.controls.throttle = 0;
    let f = r.tick();
    for (let i = 0; i < 150 / FRAME && r.of('stallBreak').length === 0; i++) f = r.tick((h) => ap.update(h, r.p.state, r.p.controls));
    const on = r.of('stallWarnOn');
    const brk = r.of('stallBreak');
    expect(on.length).toBeGreaterThanOrEqual(1);
    expect(brk).toHaveLength(1);
    expect(on[0].seq).toBeLessThan(brk[0].seq);
    expect(brk[0].data.kias).toBeLessThan(60);
    expect(Math.abs(brk[0].data.altFt - alt0 / FT)).toBeLessThan(300);
    // Recovery: nose down, full power, wings level.
    r.p.controls.elevator = -0.3;
    r.p.controls.aileron = 0;
    r.p.controls.throttle = 1;
    for (let i = 0; i < 8 / FRAME; i++) f = r.tick();
    r.p.controls.elevator = 0;
    for (let i = 0; i < 10 / FRAME; i++) f = r.tick();
    expect(r.p.state.crashed).toBe(false);
    const off = r.of('stallWarnOff');
    expect(off.length).toBeGreaterThanOrEqual(1);
    expect(off[off.length - 1].seq).toBeGreaterThan(brk[0].seq);
    expect(f.stallWarn).toBe(false);
    expect(r.of('liftoff')).toHaveLength(0);
    expect(r.of('goAround')).toHaveLength(0);
  }, 60000);
});

// ---- synthetic frames ---------------------------------------------------------------------------------------

/** An airborne frame on a 3 deg final unless overridden. */
function fr(over: Partial<Record<string, number | boolean | string>> = {}): SignalFrame {
  return {
    onGround: false, mainsOnGround: false, noseOnGround: false, crashed: false, onRunway: false,
    asiKt: 70, kias: 70, gsKt: 70, throttle: 0.3, altFt: 1000, aglFt: 500, vsFpm: -400,
    rwyAlongM: -1000, rwyAcrossM: 0, gpDevFt: 0, distAimFt: -3800,
    hdgTrueDeg: 70, hdgDeg: 70, aiBankDeg: 0, bankDeg: 0, pitchDeg: 0, driftDeg: 0,
    stallWarn: false, stallFrac: 0, pitchRateDps: 0,
    ...over,
  };
}

function detectors() {
  const bus = new TrainingBus();
  const det = new DerivedEventDetector(bus);
  const land = new LandingDetector(bus);
  let t = 0;
  const feed = (frames: SignalFrame[], dt = 0.1): void => {
    for (const f of frames) {
      t += dt;
      det.update(f, t, dt);
      land.update(f, t, dt);
    }
  };
  const repeat = (f: SignalFrame, s: number, dt = 0.1): SignalFrame[] => Array.from({ length: Math.round(s / dt) }, () => f);
  const of = <K extends TrainingEventName>(type: K): TrainingEventRecord<K>[] => bus.since(0).filter((r) => r.type === type) as TrainingEventRecord<K>[];
  return { bus, det, land, feed, repeat, of, now: () => t };
}

describe('DerivedEventDetector rules', () => {
  const ground = (over = {}): SignalFrame => fr({ onGround: true, mainsOnGround: true, noseOnGround: true, aglFt: REST_AGL_FT, vsFpm: 0, ...over });

  it('liftoff: 1 s airborne with power; payload from the last wheel contact; hops and idle bounces are not lift-offs', () => {
    const d = detectors();
    d.feed([ground({ asiKt: 50, rwyAlongM: 300, throttle: 1 }), fr({ throttle: 1, asiKt: 56, rwyAlongM: 340 })]);
    d.feed(d.repeat(fr({ throttle: 1 }), 0.5));
    d.feed([ground({ throttle: 1 })]); // a 0.6 s hop
    expect(d.of('liftoff')).toHaveLength(0);
    d.feed([ground({ asiKt: 57, rwyAlongM: 420, throttle: 1 })]);
    d.feed(d.repeat(fr({ throttle: 1 }), 1.2));
    expect(d.of('liftoff')).toHaveLength(1);
    expect(d.of('liftoff')[0].data).toEqual({ kias: 57, rwyAlongM: 420 });
    // A bounced landing at idle.
    d.feed([ground({ throttle: 0 })]);
    d.feed(d.repeat(fr({ throttle: 0 }), 2));
    expect(d.of('liftoff')).toHaveLength(1);
  });

  it('stopped: only after moving, after 2 s below 1 kt; once per stop', () => {
    const d = detectors();
    d.feed(d.repeat(ground({ gsKt: 0 }), 5)); // parked at the start
    expect(d.of('stopped')).toHaveLength(0);
    d.feed(d.repeat(ground({ gsKt: 10 }), 5));
    d.feed(d.repeat(ground({ gsKt: 0.5 }), 1.9));
    expect(d.of('stopped')).toHaveLength(0);
    d.feed(d.repeat(ground({ gsKt: 0.5 }), 5));
    expect(d.of('stopped')).toHaveLength(1);
    d.feed(d.repeat(ground({ gsKt: 2 }), 2)); // creeping, not taxiing: not re-armed
    d.feed(d.repeat(ground({ gsKt: 0 }), 3));
    expect(d.of('stopped')).toHaveLength(1);
    d.feed(d.repeat(ground({ gsKt: 8 }), 2));
    d.feed(d.repeat(ground({ gsKt: 0 }), 3));
    expect(d.of('stopped')).toHaveLength(2);
  });

  it('stall warning on at once, off after 0.5 s of silence (no chatter)', () => {
    const d = detectors();
    const pattern = [true, false, true, false, false, true, false, false, false, false, false, false];
    d.feed(pattern.map((w) => fr({ stallWarn: w, asiKt: 52 })));
    expect(d.of('stallWarnOn')).toHaveLength(1);
    expect(d.of('stallWarnOn')[0].data.kias).toBe(52);
    expect(d.of('stallWarnOff')).toHaveLength(1);
  });

  it('stallBreak: stallFrac >= 0.5, or the horn with the nose dropping; re-armed after recovery; never on the ground', () => {
    const d = detectors();
    d.feed([fr({ stallWarn: true, pitchRateDps: -3 }), fr({ stallWarn: true, pitchRateDps: -5, asiKt: 48, altFt: 4400 })]);
    expect(d.of('stallBreak').map((r) => r.data)).toEqual([{ kias: 48, altFt: 4400 }]);
    d.feed(d.repeat(fr({ stallWarn: true, stallFrac: 0.6 }), 1)); // still the same stall
    expect(d.of('stallBreak')).toHaveLength(1);
    d.feed([fr({ stallWarn: false, stallFrac: 0.1 })]); // recovered: re-armed
    d.feed([fr({ stallWarn: true, stallFrac: 0.55 })]); // secondary stall
    expect(d.of('stallBreak')).toHaveLength(2);
    d.feed([fr({ stallWarn: false, stallFrac: 0 }), ground({ stallWarn: true, pitchRateDps: -8, stallFrac: 0.7 })]);
    expect(d.of('stallBreak')).toHaveLength(2);
  });

  it('stallBreak: horn chatter with the nose pitching in the recovery, no wing stalled, is not a secondary stall', () => {
    const d = detectors();
    d.feed([fr({ stallWarn: true, pitchRateDps: -6, stallFrac: 0.3 })]);
    expect(d.of('stallBreak')).toHaveLength(1);
    // Horn off for a moment (re-armed), back on as the nose bobs at -5 deg/s with nothing stalled.
    d.feed([fr({ stallWarn: false, stallFrac: 0 }), fr({ stallWarn: true, pitchRateDps: -5, stallFrac: 0 })]);
    expect(d.of('stallBreak')).toHaveLength(1);
    // The same with part of the wing stalled is a secondary stall.
    d.feed([fr({ stallWarn: true, pitchRateDps: -5, stallFrac: 0.1 })]);
    expect(d.of('stallBreak')).toHaveLength(2);
  });

  it('goAround: throttle pushed airborne low near the runway, then a climb within 5 s', () => {
    const d = detectors();
    d.feed([fr({ aglFt: 220, throttle: 0.3 }), fr({ aglFt: 210, throttle: 0.95, vsFpm: -300 })]);
    d.feed(d.repeat(fr({ aglFt: 205, throttle: 1, vsFpm: -100 }), 2));
    expect(d.of('goAround')).toHaveLength(0);
    d.feed([fr({ aglFt: 204, throttle: 1, vsFpm: 50 })]);
    expect(d.of('goAround').map((r) => r.data)).toEqual([{ aglFt: 210 }]);
    // Full power held: no second event without a new push.
    d.feed(d.repeat(fr({ aglFt: 300, throttle: 1, vsFpm: 600 }), 3));
    expect(d.of('goAround')).toHaveLength(1);
  });

  it('goAround: not a take-off, not high, not far from the runway, not without a climb, cancelled by closing the throttle', () => {
    const cases: SignalFrame[][] = [
      [ground({ throttle: 0.2 }), ground({ throttle: 1 }), fr({ throttle: 1, vsFpm: 500, aglFt: 20 })], // take-off
      [fr({ aglFt: 700 }), fr({ aglFt: 700, throttle: 1, vsFpm: 300 })], // high
      [fr({ rwyAcrossM: 3000 }), fr({ rwyAcrossM: 3000, throttle: 1, vsFpm: 300 })], // abeam, 1.6 NM out
      [fr(), fr({ throttle: 1 }), ...Array(55).fill(fr({ throttle: 1, vsFpm: -50 })), fr({ throttle: 1, vsFpm: 100 })], // no climb in 5 s
      [fr(), fr({ throttle: 1 }), fr({ throttle: 0.5 }), fr({ throttle: 0.5, vsFpm: 100 })], // throttle closed again
    ];
    for (const frames of cases) {
      const d = detectors();
      d.feed(frames);
      expect(d.of('goAround')).toHaveLength(0);
    }
  });

  it('thresholdCrossed: interpolated to the threshold, airborne and aligned only', () => {
    const d = detectors();
    d.feed([fr({ rwyAlongM: -20, aglFt: 40, asiKt: 66 }), fr({ rwyAlongM: 10, aglFt: 31, asiKt: 63 })]);
    expect(d.of('thresholdCrossed')).toHaveLength(1);
    expect(d.of('thresholdCrossed')[0].data.heightFt).toBeCloseTo(34, 9);
    expect(d.of('thresholdCrossed')[0].data.kias).toBeCloseTo(64, 9);
    const none = [
      [ground({ rwyAlongM: -5 }), ground({ rwyAlongM: 5 })],
      [fr({ rwyAlongM: -5, hdgTrueDeg: 160 }), fr({ rwyAlongM: 5, hdgTrueDeg: 160 })],
      [fr({ rwyAlongM: -5, rwyAcrossM: 150 }), fr({ rwyAlongM: 5, rwyAcrossM: 150 })],
      [fr({ rwyAlongM: 5 }), fr({ rwyAlongM: -5 })],
    ];
    for (const frames of none) {
      const e = detectors();
      e.feed(frames);
      expect(e.of('thresholdCrossed')).toHaveLength(0);
    }
  });

  it('rolloutComplete: armed, after the turn is seen, wings level for 2 s; heading error at the roll-out', () => {
    const d = detectors();
    d.det.armRollout(160);
    d.feed(d.repeat(fr({ aiBankDeg: 0, hdgDeg: 70 }), 3)); // not turning yet
    expect(d.of('rolloutComplete')).toHaveLength(0);
    d.feed(d.repeat(fr({ aiBankDeg: 30, hdgDeg: 120 }), 3));
    d.feed([fr({ aiBankDeg: 2, hdgDeg: 166 })]);
    d.feed(d.repeat(fr({ aiBankDeg: 1, hdgDeg: 167 }), 1.5));
    d.feed([fr({ aiBankDeg: 5, hdgDeg: 168 })]); // a wobble restarts the 2 s
    d.feed(d.repeat(fr({ aiBankDeg: -1, hdgDeg: 155 }), 1.8));
    expect(d.of('rolloutComplete')).toHaveLength(0);
    d.feed([fr({ aiBankDeg: -1, hdgDeg: 155 }), fr({ aiBankDeg: -1, hdgDeg: 155 })]);
    expect(d.of('rolloutComplete').map((r) => r.data)).toEqual([{ hdgErrDeg: -5 }]);
    d.feed(d.repeat(fr({ aiBankDeg: 30 }), 2));
    d.feed(d.repeat(fr({ aiBankDeg: 0 }), 3));
    expect(d.of('rolloutComplete')).toHaveLength(1); // disarmed
    // Through north: target 010, rolled out on 355.
    d.det.armRollout(10);
    d.feed([fr({ aiBankDeg: -25 }), ...d.repeat(fr({ aiBankDeg: 0, hdgDeg: 355 }), 2.1)]);
    expect(d.of('rolloutComplete')[1].data.hdgErrDeg).toBeCloseTo(-15, 9);
    d.det.armRollout(90);
    d.det.reset();
    d.feed([fr({ aiBankDeg: 25 }), ...d.repeat(fr({ aiBankDeg: 0 }), 3)]);
    expect(d.of('rolloutComplete')).toHaveLength(2);
  });
});

describe('LandingDetector rules', () => {
  const td = (over: Partial<TouchdownData> = {}): TouchdownData => ({
    sinkFpm: 200, kias: 60, firstWheel: 'left', distAimFt: 300, rwyAcrossM: 1, driftDeg: 0, bankDeg: 0, pitchDeg: 4, onRunway: true, ...over,
  });
  /** Descend from 400 ft through 300 and 50 ft to `toFt`, 10 ft per 0.1 s tick. */
  const descend = (toFt: number, over = {}): SignalFrame[] => {
    const out: SignalFrame[] = [];
    for (let h = 400; h >= toFt; h -= 10) out.push(fr({ aglFt: h, gpDevFt: h > 300 ? 20 : 30, asiKt: h > 50 ? 68 : 64, ...over }));
    return out;
  };
  const roll = (over = {}): SignalFrame => fr({ onGround: true, mainsOnGround: true, noseOnGround: true, onRunway: true, aglFt: REST_AGL_FT, vsFpm: 0, gsKt: 40, ...over });

  it('a normal landing: kias at 50 ft, glide path at 300 ft, float, then a full stop', () => {
    const d = detectors();
    d.feed(descend(10));
    d.feed([fr({ aglFt: 8 }), fr({ aglFt: 7 }), fr({ aglFt: 6 })]); // floating
    d.land.onTouchdown(td({ firstWheel: 'right' }), d.now());
    d.feed(d.repeat(roll({ rwyAcrossM: 3 }), 2));
    d.feed(d.repeat(roll({ rwyAcrossM: -4 }), 2));
    expect(d.of('mainsTouchdown').map((r) => r.data.firstWheel)).toEqual(['right']);
    expect(d.of('landing')).toHaveLength(0); // still rolling
    d.feed(d.repeat(roll({ gsKt: 2 }), 0.5));
    const l = d.of('landing');
    expect(l).toHaveLength(1);
    expect(l[0].data).toMatchObject({ fullStop: true, crashed: false, bounces: 0, maxBounceFt: 0, kiasAt50Ft: 64, rolloutMaxAcrossM: 4, sinkFpm: 200 });
    expect(l[0].data.gpDevFtAt300).toBeCloseTo(30, 9);
    expect(l[0].data.floatS).toBeCloseTo(0.2, 6); // first below 10 ft two ticks before the contact
  });

  it('the first wheel of the landing is reported even when the nose touches first', () => {
    const d = detectors();
    d.feed(descend(10));
    d.land.onTouchdown(td({ firstWheel: 'nose' }), d.now());
    expect(d.of('mainsTouchdown')).toHaveLength(0);
    d.land.onTouchdown(td({ firstWheel: 'left', sinkFpm: 640 }), d.now());
    d.land.onTouchdown(td({ firstWheel: 'right' }), d.now());
    expect(d.of('mainsTouchdown').map((r) => [r.data.firstWheel, r.data.sinkFpm])).toEqual([['nose', 640]]);
  });

  it('counts bounces and their height, then a touch-and-go ends it without a full stop', () => {
    const d = detectors();
    d.feed(descend(10));
    d.land.onTouchdown(td(), d.now());
    d.feed([roll()]);
    // Bounce 1: 0.5 s up to 5 ft wheel height.
    d.feed([fr({ aglFt: REST_AGL_FT + 2 }), fr({ aglFt: REST_AGL_FT + 5 }), fr({ aglFt: REST_AGL_FT + 4 }), fr({ aglFt: REST_AGL_FT + 1 }), fr({ aglFt: REST_AGL_FT + 0.2 })]);
    d.feed([roll()]);
    // A skip of 0.1 s and a few inches is not a bounce.
    d.feed([fr({ aglFt: REST_AGL_FT + 0.3 }), roll()]);
    d.feed(d.repeat(roll({ throttle: 1 }), 4)); // touch-and-go: power, roll, lift-off
    d.feed(d.repeat(fr({ aglFt: 15, throttle: 1, vsFpm: 500 }), 1));
    expect(d.of('landing')).toHaveLength(0);
    d.feed([fr({ aglFt: 21, throttle: 1, vsFpm: 500 })]);
    const l = d.of('landing');
    expect(l).toHaveLength(1);
    expect(l[0].data.bounces).toBe(1);
    expect(l[0].data.maxBounceFt).toBeCloseTo(5, 9);
    expect(l[0].data.fullStop).toBe(false);
  });

  it('ends a roll-out that vacates the runway at taxi speed as a full-stop landing', () => {
    const d = detectors();
    d.feed(descend(10));
    d.land.onTouchdown(td(), d.now());
    d.feed(d.repeat(roll({ gsKt: 30 }), 4));
    d.feed(d.repeat(roll({ gsKt: 12, onRunway: false }), 0.2));
    expect(d.of('landing').map((r) => r.data.fullStop)).toEqual([true]);
  });

  it('a crash ends the landing (crashed) even before any wheel contact', () => {
    const d = detectors();
    d.feed(descend(20));
    d.feed([fr({ aglFt: 2, crashed: true, onGround: true, mainsOnGround: false, noseOnGround: true, vsFpm: -1500 })]);
    const l = d.of('landing');
    expect(l).toHaveLength(1);
    expect(l[0].data.crashed).toBe(true);
    expect(l[0].data.firstWheel).toBe('nose');
    expect(l[0].data.sinkFpm).toBe(1500);
  });

  it('ignores wheel contacts on the ground (placing the aircraft, taxi bumps) and low passes', () => {
    const d = detectors();
    d.land.onTouchdown(td({ sinkFpm: 0 }), 0);
    d.feed(d.repeat(roll({ gsKt: 0 }), 5));
    d.land.onTouchdown(td(), d.now());
    d.feed(d.repeat(roll({ gsKt: 0 }), 5));
    // A low pass: down to 30 ft and away again.
    d.feed(descend(30));
    d.feed(d.repeat(fr({ aglFt: 80, throttle: 1, vsFpm: 500 }), 1));
    d.feed(d.repeat(fr({ aglFt: 300, throttle: 1, vsFpm: 500 }), 1));
    expect(d.of('mainsTouchdown')).toHaveLength(0);
    expect(d.of('landing')).toHaveLength(0);
  });

  it('frames only: the first frame with a main wheel down stands in for the contact', () => {
    const d = detectors();
    d.feed(descend(10));
    d.feed([fr({ aglFt: REST_AGL_FT, mainsOnGround: true, onGround: true, vsFpm: -240, kias: 61, distAimFt: 420, rwyAcrossM: -2, onRunway: true })]);
    expect(d.of('mainsTouchdown').map((r) => r.data)).toEqual([
      { sinkFpm: 240, kias: 61, firstWheel: 'left', distAimFt: 420, rwyAcrossM: -2, driftDeg: 0, bankDeg: 0, pitchDeg: 0, onRunway: true },
    ]);
  });
});

describe('touchdownData', () => {
  it('reads the main gear midpoint on the runway, drift, attitude and speed from the exact state', () => {
    const p = LINE_UP[0];
    const s = makeMockState({ north: p.north, east: p.east, heading: p.heading, heightAGL: 0, pitch: 0, roll: 0 });
    s.ias = 60 * KT;
    s.groundSpeed = 60 * KT;
    const d = touchdownData(s, 'left', 180);
    // The mains are 0.44 m behind the reference point, which is 20 m past the threshold.
    expect(d.distAimFt).toBeCloseTo((20 - 0.44 - 150) / FT, 3);
    expect(d.rwyAcrossM).toBeCloseTo(0, 6);
    expect(d).toMatchObject({ sinkFpm: 180, firstWheel: 'left', onRunway: true, driftDeg: 0 });
    expect(d.kias).toBeCloseTo(60, 9);
    s.track = s.heading - (6 * Math.PI) / 180;
    expect(touchdownData(s, 'right', 0).driftDeg).toBeCloseTo(6, 9);
  });
});
