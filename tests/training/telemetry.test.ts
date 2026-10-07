// Telemetry (section 2.3): every core signal defined and sampled, SI -> pilot units checked against
// mockState, indicated vs truth with and without an instrument panel, the airfield geometry signals at the
// airport layout's named positions, the derived signals (untrimmedS, night, step.*), filtered rates, the
// provider registry, and the nav provider's leg sequencing.

import { describe, expect, it } from 'vitest';
import { DEG, FPM, FT, KT, NM } from '../../src/core/math';
import { makeMockEnvironment, makeMockState } from '../../src/core/mockState';
import { defaultControls, defaultWeather, type AircraftState, type ControlInputs, type WeatherSettings } from '../../src/core/types';
import { AIRPORT } from '../../src/core/world';
import { KG_PER_GAL } from '../../src/instruments/dynamics/engineSystems';
import { InstrumentSet, type InstrumentReadings } from '../../src/instruments/dynamics/instrumentSet';
import { buildScenario } from '../../src/sim/scenarios';
import { SimPhysics } from '../../src/sim/SimPhysics';
import { legGeometry } from '../../src/training/geo/route';
import { Telemetry } from '../../src/training/telemetry/telemetry';
import { createNavProvider } from '../../src/training/telemetry/providers/nav';
import type { AircraftTypeDef, CoreSignalId, NavRoute, SignalFrame, SignalProvider, TelemetrySources } from '../../src/training/types';
import { HOLD_SHORT, LINE_UP, PARKING, localToNed } from '../../src/world/airport/layout';

const AIRCRAFT = { id: 'test', vspeeds: {}, settings: {} } as unknown as AircraftTypeDef;

/** Every CoreSignalId (a Record, so the compiler fails here if the contract adds one this test misses). */
const CORE_IDS: Record<CoreSignalId, true> = {
  asiKt: true, altFt: true, vsiFpm: true, hdgDeg: true, aiPitchDeg: true, aiBankDeg: true, turnRate: true, ball: true, rpm: true,
  oilPsi: true, oilTempF: true, fuelLGal: true, fuelRGal: true, suctionInHg: true, ammeterA: true,
  kias: true, tasKt: true, gsKt: true, altMslFt: true, aglFt: true, hafFt: true, vsFpm: true,
  pitchDeg: true, bankDeg: true, hdgTrueDeg: true, trackDeg: true, driftDeg: true,
  aoaDeg: true, gLoad: true, stallWarn: true, stallFrac: true, onGround: true, mainsOnGround: true, noseOnGround: true, crashed: true,
  engineRunning: true, pitchRateDps: true, rollRateDps: true,
  throttle: true, mixture: true, flapLever: true, flapsDeg: true, trim: true, elevator: true, aileron: true, rudder: true, brakes: true,
  parkingBrake: true, mags: true, starter: true, master: true, alternator: true, avionics: true,
  fuelSel: true, fuelPump: true, pitotHeat: true, lightNav: true, lightBeacon: true,
  lightStrobe: true, lightLanding: true, lightTaxi: true, qnhErrHpa: true, dgErrDeg: true,
  rwyAlongM: true, rwyAcrossM: true, distAimFt: true, gpDevFt: true,
  onRunway: true, onPaved: true, pastHoldLine: true, circuitLeg: true, downwindOffsetNm: true, headwindKt: true, crosswindKt: true,
  untrimmedS: true, studentInput: true, night: true, sunElevDeg: true, timeScale: true,
  'step.t': true, 'step.turnDeg': true, 'step.altChangeFt': true, 'step.maxBankAbsDeg': true,
  'nav.xtkNm': true, 'nav.distNm': true, 'nav.bearingDeg': true, 'nav.etaErrMin': true, 'nav.leg': true,
};

function sources(state: AircraftState, over: Partial<TelemetrySources> = {}): TelemetrySources {
  return {
    state,
    controls: defaultControls(),
    readings: null,
    weather: { ...defaultWeather(), windSpeedKt: 0 },
    env: makeMockEnvironment(),
    aircraft: AIRCRAFT,
    studentInput: false,
    timeScale: 1,
    route: null,
    ...over,
  };
}

/** A mock state on the ground at a named NED position and true heading (rad). */
function onGroundAt(p: { north: number; east: number; heading: number }): AircraftState {
  return makeMockState({ north: p.north, east: p.east, heading: p.heading, heightAGL: 0 });
}

describe('signal registry', () => {
  it('defines every core signal once, with a value after one sample', () => {
    const tel = new Telemetry();
    const f = tel.sample(sources(makeMockState()), 0.1);
    const ids = new Set(tel.defs().map((d) => d.id));
    expect(ids.size).toBe(tel.defs().length);
    for (const id of Object.keys(CORE_IDS)) {
      expect(tel.def(id as CoreSignalId), id).toBeDefined();
      expect(f[id], id).not.toBeUndefined();
    }
    // The only signals that may be NaN on an airborne frame without a route are the nav and taxi ones.
    const nan = Object.entries(f).filter(([, x]) => typeof x === 'number' && Number.isNaN(x)).map(([k]) => k);
    expect(nan.sort()).toEqual(['nav.bearingDeg', 'nav.distNm', 'nav.etaErrMin', 'nav.leg', 'nav.xtkNm',
      'taxi.alongM', 'taxi.holdShortDistM', 'taxi.nextWp', 'taxi.nextWpDistM', 'taxi.nextWpRelBrgDeg', 'taxi.routeDistM', 'taxi.xtrackM']);
  });

  it('has the section 2.3 default hysteresis and rate constants', () => {
    const tel = new Telemetry();
    const h = (id: CoreSignalId): [number, number | undefined] => [tel.def(id)!.hyst, tel.def(id)!.rateTau];
    expect(h('asiKt')).toEqual([1, 1]);
    expect(h('kias')).toEqual([1, 1]);
    expect(h('altFt')).toEqual([20, 1.5]);
    expect(h('hdgDeg')[0]).toBe(2);
    expect(h('bankDeg')).toEqual([2, 0.5]);
    expect(h('aiBankDeg')).toEqual([2, 0.5]);
    expect(h('vsFpm')[0]).toBe(50);
    expect(h('vsiFpm')[0]).toBe(50);
    expect(h('pitchDeg')[0]).toBe(1);
    expect(h('rwyAcrossM')[0]).toBe(1);
    expect(h('aglFt')[0]).toBe(10);
    expect(h('gLoad')[0]).toBe(0.05);
    expect(h('ball')[0]).toBe(0.05);
    expect(h('rpm')[0]).toBe(0);
    expect(tel.def('hdgDeg')!.kind).toBe('angle');
    expect(tel.def('trackDeg')!.kind).toBe('angle');
    expect(tel.def('fuelSel')!.kind).toBe('enum');
    expect(tel.def('onGround')!.kind).toBe('bool');
    expect(tel.def('x.nope')).toBeUndefined();
  });

  it('accepts a namespaced provider and rejects collisions and the reserved vars. namespace', () => {
    const tel = new Telemetry();
    const xpdr: SignalProvider = {
      id: 'xpdr',
      defs: [{ id: 'xpdr.code', kind: 'number', unit: '', hyst: 0, describe: 'Squawk' }],
      sample: (out) => {
        out['xpdr.code'] = 7000;
      },
    };
    tel.addProvider(xpdr);
    expect(tel.sample(sources(makeMockState()), 0.1)['xpdr.code']).toBe(7000);
    expect(() => tel.addProvider(xpdr)).toThrow(/already defined/);
    expect(() => tel.addProvider({ ...xpdr, id: 'xpdr2' })).toThrow(/already defined/);
    expect(() => tel.addProvider({ id: 'xpdr', defs: [], sample() {} })).toThrow(/already registered/);
    expect(() => tel.addProvider({ id: 'v', defs: [{ id: 'vars.x', kind: 'number', unit: '', hyst: 0, describe: '' }], sample() {} })).toThrow(/reserved/);
    expect(() => new Telemetry([{ id: 'dup', defs: [{ id: 'step.t', kind: 'number', unit: '', hyst: 0, describe: '' }], sample() {} }])).toThrow();
  });
});

describe('core provider: SI to pilot units (mockState)', () => {
  const s = makeMockState({ north: 100, east: 200, heightAGL: 1000 * FT, heading: 90 * DEG, roll: 20 * DEG, pitch: 5 * DEG, tas: 100 * KT, rpm: 2400, flaps: 10 * DEG });
  s.verticalSpeed = 500 * FPM;
  s.velocity.z = -500 * FPM;
  s.alpha = 4 * DEG;
  s.gLoad = 1.06;
  s.angularVelocity = { x: 2 * DEG, y: -1 * DEG, z: 0 };
  const f = new Telemetry().sample(sources(s), 0.1);

  it('converts the truth signals', () => {
    expect(f.kias).toBeCloseTo(97, 6); // mockState ias = 0.97 tas
    expect(f.tasKt).toBeCloseTo(100, 6);
    expect(f.gsKt).toBeCloseTo(100, 6);
    expect(f.altMslFt).toBeCloseTo(AIRPORT.elevation / FT + 1000, 6);
    expect(f.hafFt).toBeCloseTo(1000, 6);
    expect(f.aglFt).toBeCloseTo(1000, 6);
    expect(f.vsFpm).toBeCloseTo(500, 6);
    expect(f.bankDeg).toBeCloseTo(20, 6);
    expect(f.pitchDeg).toBeCloseTo(5, 6);
    expect(f.hdgTrueDeg).toBeCloseTo(90, 6);
    expect(f.trackDeg).toBeCloseTo(90, 6);
    expect(f.driftDeg).toBeCloseTo(0, 6);
    expect(f.aoaDeg).toBeCloseTo(4, 6);
    expect(f.gLoad).toBe(1.06);
    expect(f.rollRateDps).toBeCloseTo(2, 6);
    expect(f.pitchRateDps).toBeCloseTo(-1, 6);
    expect(f.flapsDeg).toBeCloseTo(10, 6);
    expect([f.onGround, f.mainsOnGround, f.noseOnGround, f.crashed, f.engineRunning, f.stallWarn]).toEqual([false, false, false, false, true, false]);
  });

  it('falls back to truth for the indicated signals without readings (headless)', () => {
    expect(f.asiKt).toBe(f.kias);
    expect(f.altFt).toBe(f.altMslFt);
    expect(f.vsiFpm).toBe(f.vsFpm);
    expect(f.hdgDeg).toBe(f.hdgTrueDeg);
    expect(f.aiBankDeg).toBe(f.bankDeg);
    expect(f.aiPitchDeg).toBe(f.pitchDeg);
    expect(f.rpm).toBe(2400);
    expect(f.oilTempF).toBeCloseTo((85 * 9) / 5 + 32, 6);
    expect(f.oilPsi).toBe(60);
    expect(f.fuelLGal).toBeCloseTo(68 / KG_PER_GAL, 6);
    expect(f.fuelRGal).toBeCloseTo(68 / KG_PER_GAL, 6);
    expect(f.suctionInHg).toBeGreaterThan(4.5);
    expect(f.dgErrDeg).toBe(0);
    // Turn rate from the body rates: r = 0, q = -1 deg/s at 20 deg bank -> -0.34 deg/s heading rate.
    expect(f.turnRate).toBeCloseTo((-1 * Math.sin(20 * DEG)) / Math.cos(5 * DEG) / 3, 6);
  });

  it('reports a coordinated standard-rate turn as 1', () => {
    const t = makeMockState({ roll: 15 * DEG, pitch: 0 });
    const r = 3 * DEG; // heading rate, level turn: q = psiDot sin(phi), r = psiDot cos(phi)
    t.angularVelocity = { x: 0, y: r * Math.sin(15 * DEG), z: r * Math.cos(15 * DEG) };
    expect(new Telemetry().sample(sources(t), 0.1).turnRate).toBeCloseTo(1, 6);
  });

  it('uses the instrument readings when there are some', () => {
    const r = new InstrumentSet().readings as InstrumentReadings;
    Object.assign(r, { airspeedKt: 88, altitudeFt: 1500, verticalSpeedFpm: -200, headingDeg: 95, attitudeRoll: 0.1, attitudePitch: 0.05, turnRate: 0.4, ball: 0.2, rpm: 2310, oilPressurePsi: 55, oilTempF: 190, fuelLeftGal: 20, fuelRightGal: 21, suctionInHg: 5, ammeterAmps: 1.5 });
    const g = new Telemetry().sample(sources(s, { readings: r }), 0.1);
    expect([g.asiKt, g.altFt, g.vsiFpm, g.hdgDeg, g.turnRate, g.ball, g.rpm, g.oilPsi, g.oilTempF, g.fuelLGal, g.fuelRGal, g.suctionInHg, g.ammeterA]).toEqual([
      88, 1500, -200, 95, 0.4, 0.2, 2310, 55, 190, 20, 21, 5, 1.5,
    ]);
    expect(g.aiBankDeg).toBeCloseTo(0.1 / DEG, 6);
    expect(g.aiPitchDeg).toBeCloseTo(0.05 / DEG, 6);
    expect(g.dgErrDeg).toBeCloseTo(5, 6); // DG 095, true 090
    expect(g.kias).toBeCloseTo(97, 6); // truth unaffected
  });

  it('maps the controls and switches', () => {
    const c: ControlInputs = { ...defaultControls(), throttle: 0.7, mixture: 0.9, flaps: 2 / 3, elevatorTrim: 0.1, elevator: -0.2, aileron: 0.3, rudder: -0.1, brakeLeft: 0.2, brakeRight: 0.6, parkingBrake: true, magnetos: 2, starter: true, masterBattery: false, alternator: false, avionics: false, fuelSelector: 'left', fuelPump: true, pitotHeat: true, kollsmanHpa: 1015.25 };
    c.lights = { nav: true, beacon: false, strobe: true, landing: true, taxi: false, panel: 0 };
    const g = new Telemetry().sample(sources(s, { controls: c, weather: { ...defaultWeather(), qnhHpa: 1013.25 }, studentInput: true, timeScale: 4 }), 0.1);
    expect([g.throttle, g.mixture, g.flapLever, g.trim, g.elevator, g.aileron, g.rudder, g.brakes]).toEqual([0.7, 0.9, 2 / 3, 0.1, -0.2, 0.3, -0.1, 0.6]);
    expect([g.parkingBrake, g.mags, g.starter, g.master, g.alternator, g.avionics, g.fuelSel, g.fuelPump, g.pitotHeat]).toEqual([true, 2, true, false, false, false, 'left', true, true]);
    expect([g.lightNav, g.lightBeacon, g.lightStrobe, g.lightLanding, g.lightTaxi]).toEqual([true, false, true, true, false]);
    expect(g.qnhErrHpa).toBeCloseTo(2, 6);
    expect([g.studentInput, g.timeScale]).toEqual([true, 4]);
  });

  it('reads drift as heading minus track, 0 at rest', () => {
    const d = makeMockState({ heading: 70 * DEG });
    d.track = 62 * DEG;
    expect(new Telemetry().sample(sources(d), 0.1).driftDeg).toBeCloseTo(8, 6);
    const still = onGroundAt({ north: 0, east: 0, heading: 70 * DEG });
    still.track = 200 * DEG;
    expect(new Telemetry().sample(sources(still), 0.1).driftDeg).toBe(0);
  });
});

describe('geo provider at the airport layout positions', () => {
  const sample = (s: AircraftState, w?: Partial<WeatherSettings>): SignalFrame =>
    new Telemetry().sample(sources(s, { weather: { ...defaultWeather(), ...w } }), 0.1);

  it('lined up on 07: on the runway, inside the hold lines, 20 m past the threshold', () => {
    const p = LINE_UP.find((l) => l.runway === '07')!;
    const f = sample(onGroundAt(p));
    expect(f.rwyAlongM).toBeCloseTo(20, 6);
    expect(f.rwyAcrossM).toBeCloseTo(0, 6);
    expect([f.onRunway, f.onPaved, f.pastHoldLine, f.circuitLeg]).toEqual([true, true, true, 'ground']);
    expect(f.distAimFt).toBeCloseTo((20 - 150) / FT, 6);
  });

  it('holding short of A1: paved, not past the hold line until the nose crosses it', () => {
    const h = HOLD_SHORT.find((x) => x.name === 'A1')!;
    let f = sample(onGroundAt(h));
    expect([f.onRunway, f.onPaved, f.pastHoldLine]).toEqual([false, true, false]);
    // The reference point is 4 m behind the line and the spinner 2.25 m ahead of it: 2 m more crosses it.
    const fwd = { north: h.north + 2 * Math.cos(h.heading), east: h.east + 2 * Math.sin(h.heading), heading: h.heading };
    f = sample(onGroundAt(fwd));
    expect(f.pastHoldLine).toBe(true);
    // Airborne over the same point is not a hold-line incursion.
    expect(sample(makeMockState({ ...fwd, heightAGL: 100 })).pastHoldLine).toBe(false);
  });

  it('parked: paved, off the runway', () => {
    const f = sample(onGroundAt(PARKING));
    expect([f.onRunway, f.onPaved, f.pastHoldLine]).toEqual([false, true, false]);
    const grass = localToNed(0, -60); // between the runway edge and the parallel taxiway
    expect(sample(onGroundAt({ ...grass, heading: 0 })).onPaved).toBe(false);
  });

  it('the final scenario starts on the 3 deg path to the aim point', () => {
    const sc = buildScenario('final', makeMockEnvironment());
    const p = sc.ic.position;
    const f = sample(makeMockState({ north: p.x, east: p.y, heightAGL: -p.z - AIRPORT.elevation, heading: sc.ic.heading }));
    expect(f.gpDevFt).toBeCloseTo(0, 6);
    expect(f.rwyAlongM).toBeCloseTo(-3 * NM, 3);
    expect(f.rwyAcrossM).toBeCloseTo(0, 6);
    expect(f.distAimFt).toBeCloseTo((-3 * NM - 150) / FT, 3);
    expect(f.circuitLeg).toBe('final');
    // 100 ft above the path is +100.
    const high = sample(makeMockState({ north: p.x, east: p.y, heightAGL: -p.z - AIRPORT.elevation + 100 * FT, heading: sc.ic.heading }));
    expect(high.gpDevFt).toBeCloseTo(100, 6);
  });

  it('the downwind scenario is 900 m (0.49 NM) on the downwind side', () => {
    const sc = buildScenario('downwind', makeMockEnvironment());
    const p = sc.ic.position;
    const f = sample(makeMockState({ north: p.x, east: p.y, heightAGL: -p.z - AIRPORT.elevation, heading: sc.ic.heading }));
    expect(f.downwindOffsetNm).toBeCloseTo(900 / NM, 6);
    expect(f.circuitLeg).toBe('downwind');
  });

  it('resolves the steady wind into runway 07 components', () => {
    const s = makeMockState();
    let f = sample(s, { windDirectionDeg: 160, windSpeedKt: 10 });
    expect(f.crosswindKt).toBeCloseTo(10, 6);
    expect(f.headwindKt).toBeCloseTo(0, 6);
    f = sample(s, { windDirectionDeg: 70, windSpeedKt: 12 });
    expect(f.headwindKt).toBeCloseTo(12, 6);
    f = sample(s, { windDirectionDeg: 250, windSpeedKt: 5 });
    expect(f.headwindKt).toBeCloseTo(-5, 6);
    f = sample(s, { windDirectionDeg: 340, windSpeedKt: 8 });
    expect(f.crosswindKt).toBeCloseTo(-8, 6); // from the left
  });
});

describe('derived signals', () => {
  it('untrimmedS counts steady elevator pressure, survives a short break, resets after 1 s', () => {
    const tel = new Telemetry();
    const s = makeMockState();
    const c = { ...defaultControls(), elevator: 0.1 };
    const src = sources(s, { controls: c });
    const step = (n: number): number => {
      let f: SignalFrame = tel.frame;
      for (let i = 0; i < n; i++) f = tel.sample(src, 0.1);
      return f.untrimmedS as number;
    };
    expect(step(50)).toBeCloseTo(5, 6);
    c.elevator = 0.05; // trimmed out
    expect(step(5)).toBeCloseTo(5, 6); // held through 0.5 s
    c.elevator = -0.1; // pushing counts too
    expect(step(10)).toBeCloseTo(6, 6);
    c.elevator = 0;
    expect(step(9)).toBeCloseTo(6, 6);
    expect(step(1)).toBe(0); // 1 s break
    c.elevator = 0.2;
    s.roll = 20 * DEG; // turning: not steady flight
    expect(step(30)).toBe(0);
    s.roll = 0;
    s.verticalSpeed = 600 * FPM; // climbing
    expect(step(30)).toBe(0);
    s.verticalSpeed = 0;
    s.onGround = true;
    expect(step(30)).toBe(0);
  });

  it('night is the sun below -6 deg', () => {
    const tel = new Telemetry();
    const s = makeMockState();
    const day = tel.sample(sources(s, { weather: { ...defaultWeather(), timeOfDay: 12, dayOfYear: 172 } }), 0.1);
    expect([day.night, (day.sunElevDeg as number) > 60]).toEqual([false, true]); // 46.5 N at midsummer noon: 67 deg
    const night = tel.sample(sources(s, { weather: { ...defaultWeather(), timeOfDay: 23, dayOfYear: 172 } }), 0.1);
    expect(night.night).toBe(true);
    expect(night.sunElevDeg as number).toBeLessThan(-6);
  });
});

describe('step signals and rates', () => {
  it('integrates step.turnDeg through north, step.altChangeFt and step.maxBankAbsDeg; markStep zeroes them', () => {
    const tel = new Telemetry();
    const s = makeMockState({ heading: 350 * DEG, roll: -10 * DEG });
    const src = sources(s);
    tel.sample(src, 0.1);
    tel.markStep();
    for (let h = 350; h <= 380; h += 5) {
      s.heading = (h % 360) * DEG;
      s.roll = (h - 350) * DEG;
      s.altitudeMSL += 10 * FT;
      tel.sample(src, 0.5);
    }
    expect(tel.frame['step.turnDeg']).toBeCloseTo(30, 6);
    expect(tel.frame['step.altChangeFt']).toBeCloseTo(70, 6);
    expect(tel.frame['step.maxBankAbsDeg']).toBeCloseTo(30, 6);
    expect(tel.frame['step.t']).toBeCloseTo(3.5, 6);
    tel.markStep();
    expect([tel.frame['step.t'], tel.frame['step.turnDeg'], tel.frame['step.altChangeFt'], tel.frame['step.maxBankAbsDeg']]).toEqual([0, 0, 0, 0]);
    // A left turn counts negative: 020 round to 260.
    for (let h = 20; h >= -100; h -= 10) {
      s.heading = (((h % 360) + 360) % 360) * DEG;
      tel.sample(src, 0.5);
    }
    expect(tel.frame['step.turnDeg']).toBeCloseTo(-120, 6);
  });

  it('a teleport while sim time is paused (dt 0) is not a turn, a climb or a rate', () => {
    const tel = new Telemetry();
    const s = makeMockState({ heading: 90 * DEG });
    const src = sources(s);
    tel.sample(src, 0.1);
    tel.markStep();
    s.heading = 270 * DEG;
    s.altitudeMSL += 3000 * FT;
    tel.sample(src, 0); // the curtain: reposition
    tel.markStep();
    tel.sample(src, 0.1);
    expect(tel.frame['step.turnDeg']).toBe(0);
    expect(tel.frame['step.altChangeFt']).toBe(0);
    expect(tel.frame['step.t']).toBeCloseTo(0.1, 9);
    expect(tel.rate('altFt')).toBe(0);
    expect(tel.rate('hdgDeg')).toBe(0);
  });

  it('filters the rate of a numeric signal with the signal rateTau, unwrapping angles', () => {
    const tel = new Telemetry();
    const s = makeMockState({ heading: 350 * DEG });
    const src = sources(s);
    for (let i = 0; i < 400; i++) {
      s.altitudeMSL += 600 * FPM * 0.05; // 600 fpm = 10 ft/s
      s.heading = ((350 + 3 * 0.05 * i) % 360) * DEG; // 3 deg/s through north
      tel.sample(src, 0.05);
    }
    expect(tel.rate('altFt')).toBeCloseTo(10, 3);
    expect(tel.rate('hdgDeg')).toBeCloseTo(3, 3);
    expect(tel.rate('onGround')).toBe(0);
    expect(tel.rate('fuelSel')).toBe(0);
    expect(tel.rate('x.nope')).toBe(0);
    // Time constant: after a step change in the rate, about 63 % of it after tau (altFt: 1.5 s).
    for (let i = 0; i < 30; i++) tel.sample(src, 0.05); // altitude now constant
    expect(tel.rate('altFt')).toBeGreaterThan(10 * Math.exp(-1.5 / 1.5) - 0.3);
    expect(tel.rate('altFt')).toBeLessThan(10 * Math.exp(-1.5 / 1.5) + 0.3);
  });
});

describe('real flight model and instrument panel', () => {
  it('indicated signals track the truth in steady cruise (QNH set, standard day)', () => {
    const w = { ...defaultWeather(), windSpeedKt: 0, turbulence: 0, gustKt: 0, isaDeviation: 0, qnhHpa: 1013.25 };
    const p = new SimPhysics({ weather: w });
    p.reset('cruise', w);
    p.setAutoflight(true, true);
    const inst = new InstrumentSet();
    inst.reset(p.state);
    const tel = new Telemetry();
    const src: TelemetrySources = { ...sources(p.state, { controls: p.controls, weather: w, env: p.env }), readings: inst.readings };
    for (let i = 0; i < 20 * 30; i++) {
      p.step(1 / 30);
      inst.step(1 / 30, p.state, p.controls, w);
      tel.sample(src, 1 / 30);
    }
    const f = tel.frame;
    expect(Math.abs((f.asiKt as number) - (f.kias as number))).toBeLessThan(2);
    expect(Math.abs((f.altFt as number) - (f.altMslFt as number))).toBeLessThan(40);
    expect(Math.abs((f.hdgDeg as number) - (f.hdgTrueDeg as number))).toBeLessThan(2);
    expect(Math.abs((f.aiBankDeg as number) - (f.bankDeg as number))).toBeLessThan(1);
    expect(Math.abs(f.vsiFpm as number)).toBeLessThan(150);
    expect(Math.abs(f.turnRate as number)).toBeLessThan(0.1);
    expect(f.kias as number).toBeGreaterThan(100);
    expect(f.circuitLeg).toBe('none');
    expect(f.hafFt as number).toBeGreaterThan(4000);
  }, 30000);
});

describe('nav provider and route geometry', () => {
  // A square route north then east then back, legs of 10 NM.
  const route: NavRoute = {
    id: 'square', name: 'Square',
    waypoints: [
      { id: 'a', name: 'A', north: 0, east: 0 },
      { id: 'b', name: 'B', north: 10 * NM, east: 0 },
      { id: 'c', name: 'C', north: 10 * NM, east: 10 * NM, passRadiusNm: 0.5 },
      { id: 'a2', name: 'A', north: 0, east: 0 },
    ],
    altFt: 3500, legMinutes: [6, 6, 8.5], legHeadingsDeg: [0, 90, 225],
  };

  it('legGeometry: cross-track + right, distance and bearing to the leg end, overhead and abeam', () => {
    const g = legGeometry(route, 0, 5 * NM, 0.3 * NM);
    expect(g.xtkNm).toBeCloseTo(0.3, 9);
    expect(g.distNm).toBeCloseTo(Math.hypot(5, 0.3), 9);
    expect(g.bearingDeg).toBeCloseTo(360 - (Math.atan2(0.3, 5) * 180) / Math.PI, 6);
    expect(g.overhead).toBe(false);
    expect(g.alongPastEndNm).toBeCloseTo(-5, 9);
    expect(legGeometry(route, 0, 9.5 * NM, -0.2 * NM).overhead).toBe(true);
    expect(legGeometry(route, 0, 10.5 * NM, -3 * NM).alongPastEndNm).toBeCloseTo(0.5, 9);
    expect(legGeometry(route, 1, 10 * NM, 9.6 * NM).overhead).toBe(true); // within 0.5 NM of C
    expect(legGeometry(route, 1, 10 * NM, 9.4 * NM).overhead).toBe(false);
    expect(legGeometry(route, 99, 0, 0).distNm).toBeCloseTo(0, 9); // clamped to the last leg
    expect(legGeometry({ ...route, waypoints: [] }, 0, 0, 0).xtkNm).toBeNaN();
  });

  it('is NaN without a route, starts the clock on departure, sequences overhead or abeam, estimates the leg time', () => {
    const nav = createNavProvider();
    const out: SignalFrame = {};
    const s = onGroundAt({ north: 0, east: 0, heading: 0 });
    const src = sources(s);
    nav.sample(out, src, 0.1);
    expect(out['nav.leg']).toBeNaN();
    src.route = route;
    nav.sample(out, src, 0.1);
    expect(out['nav.leg']).toBe(0);
    expect(out['nav.etaErrMin']).toBeNaN(); // on the ground: clock not started
    // Airborne, still overhead the departure point: no clock yet.
    Object.assign(s, makeMockState({ north: 0.5 * NM, east: 0, heading: 0, tas: 120 * KT }));
    nav.sample(out, src, 60);
    expect(out['nav.etaErrMin']).toBeNaN();
    // 2 NM out at 120 kt (2 NM/min): clock starts, 8 NM to go = 4 min, planned 6 -> 2 min early.
    s.position.x = 2 * NM;
    nav.sample(out, src, 0);
    expect(out['nav.etaErrMin']).toBeCloseTo(-2, 6);
    // 3 min later, 1 NM right of track at 8 NM.
    s.position.x = 8 * NM;
    s.position.y = 1 * NM;
    nav.sample(out, src, 180);
    expect(out['nav.xtkNm']).toBeCloseTo(1, 9);
    expect(out['nav.etaErrMin']).toBeCloseTo(3 + Math.hypot(2, 1) / 2 - 6, 6);
    // Overhead B: leg 1, timer restarted.
    s.position.x = 9.8 * NM;
    s.position.y = 0;
    nav.sample(out, src, 60);
    expect(out['nav.leg']).toBe(1);
    expect(out['nav.distNm']).toBeCloseTo(Math.hypot(0.2, 10), 6);
    expect(out['nav.bearingDeg'] as number).toBeCloseTo(90 - (Math.atan2(0.2, 10) * 180) / Math.PI, 6);
    // Missing C by 2 NM (outside its 0.5 NM radius) but going abeam it still sequences.
    s.position.x = 12 * NM;
    s.position.y = 10.01 * NM;
    nav.sample(out, src, 60);
    expect(out['nav.leg']).toBe(2);
    // Back overhead A: the route is complete.
    s.position.x = 0.3 * NM;
    s.position.y = 0.3 * NM;
    nav.sample(out, src, 60);
    expect(out['nav.leg']).toBe(3);
    expect(out['nav.etaErrMin']).toBeNaN();
  });

  it('times a route set in flight (a diversion) from that moment', () => {
    const nav = createNavProvider();
    const out: SignalFrame = {};
    const s = makeMockState({ north: 0, east: 0, heading: 0, tas: 120 * KT });
    nav.sample(out, sources(s, { route }), 0.1);
    expect(out['nav.etaErrMin']).toBeCloseTo(10 / 2 - 6, 6);
  });
});


