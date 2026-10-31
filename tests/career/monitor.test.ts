// The job monitor (src/career/runtime/monitor.ts) on synthetic flights at the seed-0 fields (a mock state moved
// frame by frame, touchdowns delivered as the sim's events would be): cold at the origin with the brake set and the
// engines off for a minute decides nothing, nor does an engine run and shut down before take-off; a flight to the
// destination completes 3 s after shutdown with the brake (12 s without, the strip asking for the brake from 5 s);
// a shutdown at another field stops the job, Continue carries on and the job completes at the destination; a home
// destination reports the PARKING stand as on the apron; an outlanding, a crash and a reset from outside the Career
// each end the job, while the Career's own reset only re-places it; a helicopter lifts off and completes with no
// throttle and no brake; the exported state restores and carries on identically; one 0.25 s frame and twenty
// 0.0125 s frames give the same phases and job time; and the strip names the target, the turning points and the
// helicopter's spot, its ETA running to the end of the job through any turning points still to fly.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fieldStand } from '../../src/career/geo';
import { blankReport, JobMonitor, type JobMonitorEvent, type MonitorAircraft } from '../../src/career/runtime/monitor';
import { validateReport } from '../../src/career/validate';
import { CAREER_RESET_PREFIX, type JobOffer, type JobPhase } from '../../src/career/types';
import { createEventBus } from '../../src/core/context';
import { FPM, KT, NM } from '../../src/core/math';
import { makeMockEnvironment, makeMockState } from '../../src/core/mockState';
import { defaultControls, defaultWeather, type AircraftState } from '../../src/core/types';
import { setGpsTarget } from '../../src/instruments/dynamics/navigation';
import { setStartField } from '../../src/sim/startField';
import { airfields, fieldPoint, HOME_AIRFIELD, type Airfield } from '../../src/world/airfields';
import { PARKING } from '../../src/world/airport/layout';
import { setEra } from '../../src/world/era/eraState';
import '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';

const AEROPLANE: MonitorAircraft = { helicopter: false, vneKt: 163, mainsBody: { x: -0.32, y: 0, z: 1.25 }, noseX: 1.9 };
const HELI: MonitorAircraft = { helicopter: true, vneKt: 130, mainsBody: { x: 0, y: 0, z: 1.0 }, noseX: 2 };

let FIELDS: readonly Airfield[] = [];
let ORIGIN: Airfield;
let DEST: Airfield;
let OTHER: Airfield;

beforeAll(() => {
  setEra('present');
  setWorldSeed(0);
  FIELDS = airfields();
  const sealed = FIELDS.filter((f) => f.kind === 'sealed');
  ORIGIN = sealed[0];
  DEST = sealed[1];
  OTHER = FIELDS.find((f) => f.kind === 'grass')!;
});
afterAll(() => {
  setStartField(null);
  setGpsTarget(null);
  setWorldSeed(0);
});

function offer(to: Airfield, over: Partial<JobOffer> = {}): JobOffer {
  return {
    id: '3-KXXX-1', kind: 'charter', day: 3, origin: ORIGIN.code, destination: { kind: 'field', code: to.code }, client: 'Test client',
    title: `1 passenger to ${to.name}`, pax: 1, payload: [{ kind: 'passenger', label: 'Passenger 1', kg: 77 }], payloadKg: 77,
    distanceNm: 20, pay: 280, deadlineMin: 50, minClass: 'tourer', refType: 'c172s', repRequired: 0, premium: false,
    weather: 'clear', windDirDeg: 0, windKt: 0, ...over,
  };
}

/** A synthetic flight: a mock state moved by hand, fed to a monitor frame by frame. */
class Rig {
  readonly s: AircraftState = makeMockState({ heightAGL: 0 });
  readonly c = defaultControls();
  readonly weather = { ...defaultWeather(), turbulence: 0, timeOfDay: 12, windSpeedKt: 0 };
  readonly env = makeMockEnvironment();
  readonly events = createEventBus();
  readonly log: JobMonitorEvent[] = [];
  readonly phases: { phase: JobPhase; t: number }[] = [];
  monitor: JobMonitor;
  t = 0;
  elevation = 0;

  constructor(o: JobOffer, readonly aircraft: MonitorAircraft = AEROPLANE, readonly dt = 1 / 30) {
    this.monitor = this.make(o);
    this.monitor.connect(this.events, () => this.s);
    this.ground(fieldStand(this.field(o.origin)), { engine: false, brake: true });
  }

  make(o: JobOffer): JobMonitor {
    return new JobMonitor({ offer: o, type: this.aircraft.helicopter ? 'r44' : 'c172s', aircraft: this.aircraft, fields: FIELDS, onEvent: (e) => this.log.push(e) });
  }

  field(code: string): Airfield {
    return FIELDS.find((f) => f.code === code)!;
  }

  /** Put the state somewhere (height above `elevation`, m). */
  set(p: { north: number; east: number }, heightM: number, gsKt: number, vsFpm = 0, heading = 0): void {
    const s = this.s;
    const onGround = heightM <= 0;
    s.position.x = p.north;
    s.position.y = p.east;
    s.altitudeAGL = onGround ? 1.25 : heightM + 1.25;
    s.altitudeMSL = this.elevation + s.altitudeAGL;
    s.position.z = -s.altitudeMSL;
    s.onGround = onGround;
    for (const w of s.wheels) w.onGround = onGround;
    s.groundSpeed = gsKt * KT;
    s.ias = s.tas = gsKt * KT;
    s.verticalSpeed = vsFpm * FPM;
    s.heading = heading;
    s.track = heading;
  }

  engines(on: boolean): void {
    for (const e of this.s.engines) e.running = on;
  }

  /** Frames for `seconds` (whole frames of this rig's dt). */
  run(seconds: number): void {
    const n = Math.round(seconds / this.dt);
    for (let i = 0; i < n; i++) {
      this.t += this.dt;
      this.monitor.update(this.dt, { state: this.s, controls: this.c, weather: this.weather, env: this.env });
      const p = this.monitor.phase;
      if (this.phases.at(-1)?.phase !== p) this.phases.push({ phase: p, t: this.t });
    }
  }

  ground(p: { north: number; east: number }, o: { engine: boolean; brake: boolean; gsKt?: number }, seconds = 0): void {
    this.elevation = 0;
    this.set(p, 0, o.gsKt ?? 0);
    this.engines(o.engine);
    this.c.parkingBrake = o.brake;
    this.c.throttle = o.engine ? 0.2 : 0;
    if (seconds > 0) this.run(seconds);
  }

  /** Start up at `from`, take off, fly (positions jump; the monitor only samples), and land at `to`, rolling out on its runway. */
  flyTo(from: Airfield, to: Airfield): void {
    this.ground(fieldStand(from), { engine: true, brake: false }, 10);
    // Take-off roll and climb-out at full power.
    this.c.throttle = 1;
    this.set(fieldPoint(from, -from.length / 2 + 100, 0), 0, 50);
    this.run(5);
    this.set(fieldPoint(from, -from.length / 2 + 500, 0), 10, 65, 700);
    this.run(2);
    this.set(fieldPoint(from, 0, 0), 150, 75, 700);
    this.run(20);
    // Cruise, then down final to 60 ft.
    this.c.throttle = 0.6;
    this.set(fieldPoint(to, -to.length / 2 - 3000, 0), 300, 100);
    this.run(60);
    this.set(fieldPoint(to, -to.length / 2 - 200, 0), 18.3, 65, -400, to.heading);
    this.run(1);
    this.land(to);
  }

  /** From 60 ft on final: below 50 ft, mains contact 120 m past the threshold, roll-out to a stop on the runway. */
  land(to: Airfield, sinkFpm = 200): void {
    this.c.throttle = 0;
    this.set(fieldPoint(to, -to.length / 2 - 60, 0), 9, 62, -350, to.heading);
    this.run(1);
    this.set(fieldPoint(to, -to.length / 2 + 120, 0.5), 0, 55, -sinkFpm, to.heading);
    this.monitor.onTouchdown(this.s, 'left', sinkFpm);
    this.run(2);
    this.set(fieldPoint(to, -to.length / 2 + 300, 0.5), 0, 2, 0, to.heading);
    this.run(5);
  }

  /** Taxi to the stand and shut down (brake as given). */
  park(to: Airfield, brake: boolean, seconds: number): void {
    this.set(fieldStand(to), 0, 0);
    this.c.parkingBrake = brake;
    this.engines(false);
    this.run(seconds);
  }
}

describe('nothing before the job has flown', () => {
  it('decides nothing cold at the origin with the brake set and the engines off for 60 s', () => {
    const r = new Rig(offer(DEST));
    r.run(60);
    expect(r.monitor.phase).toBe('dispatched');
    expect(r.log).toEqual([]);
    expect(r.monitor.ended).toBeNull();
  });

  it('decides nothing for an engine run and shutdown at the origin before take-off', () => {
    const r = new Rig(offer(DEST));
    r.ground(fieldStand(ORIGIN), { engine: true, brake: true }, 20);
    expect(r.monitor.phase).toBe('ground');
    r.ground(fieldStand(ORIGIN), { engine: false, brake: true }, 60);
    expect(r.monitor.phase).toBe('ground');
    expect(r.log).toEqual([]);
  });
});

describe('arriving', () => {
  it('completes 3 s after shutdown with the parking brake set', () => {
    const r = new Rig(offer(DEST));
    r.flyTo(ORIGIN, DEST);
    expect(r.monitor.phase).toBe('landed');
    r.park(DEST, true, 2.9);
    expect(r.monitor.ended).toBeNull();
    r.park(DEST, true, 0.2);
    const end = r.monitor.ended!;
    expect(end.outcome).toBe('completed');
    expect(end.atField).toBe(DEST.code);
    expect([end.onApron, end.onRunway]).toEqual([true, false]);
    expect([end.takeoffs, end.landingsDay, end.landingsNight]).toEqual([1, 1, 0]);
    expect(end.landing?.helicopter).toBe(false);
    expect(end.landing?.onTarget).toBe(true);
    expect(end.landing!.score).toBeGreaterThan(70);
    // Completed within the last frames run (the rig keeps counting after the end).
    expect(end.elapsedMin * 60).toBeGreaterThan(r.t - 0.2);
    expect(end.elapsedMin * 60).toBeLessThanOrEqual(r.t + 1e-9);
    expect(end.comfort.score).toBeLessThanOrEqual(100);
    expect(r.monitor.phase).toBe('done');
    expect(r.log.at(-1)).toEqual({ kind: 'ended', report: end });
  });

  it('completes after 12 s with no brake, the strip asking for it from 5 s', () => {
    const r = new Rig(offer(DEST));
    r.flyTo(ORIGIN, DEST);
    r.park(DEST, false, 4.8);
    expect(r.monitor.strip()!.hint).not.toMatch(/parking brake/);
    r.park(DEST, false, 0.3);
    expect(r.monitor.strip()!.hint).toBe('Set the parking brake (or wait) to finish');
    r.park(DEST, false, 6.8);
    expect(r.monitor.ended).toBeNull();
    r.park(DEST, false, 0.2);
    expect(r.monitor.ended?.outcome).toBe('completed');
  });

  it('stops at another field, continues, and completes at the destination', () => {
    const r = new Rig(offer(DEST));
    r.flyTo(ORIGIN, OTHER);
    r.park(OTHER, true, 4);
    expect(r.monitor.phase).toBe('stopped');
    expect(r.monitor.stoppedAt).toBe(OTHER.code);
    expect(r.log).toEqual([{ kind: 'stopped', field: OTHER.code }]);
    expect(r.monitor.strip()!.hint).toMatch(/^Stopped at/);
    // Held: more time shut down there decides nothing further.
    r.run(30);
    expect(r.monitor.ended).toBeNull();
    expect(r.monitor.continueJob()).toBe(true);
    expect(r.monitor.phase).toBe('ground');
    r.flyTo(OTHER, DEST);
    r.park(DEST, true, 3.1);
    const end = r.monitor.ended!;
    expect([end.outcome, end.atField, end.takeoffs, end.landingsDay]).toEqual(['completed', DEST.code, 2, 2]);
  });

  it('reports the home PARKING stand as on the apron', () => {
    const r = new Rig(offer(HOME_AIRFIELD));
    r.flyTo(ORIGIN, HOME_AIRFIELD);
    r.set(PARKING, 0, 0);
    r.engines(false);
    r.c.parkingBrake = true;
    r.run(3.1);
    const end = r.monitor.ended!;
    expect([end.outcome, end.atField, end.onApron, end.onRunway]).toEqual(['completed', HOME_AIRFIELD.code, true, false]);
  });

  it('reports a stop on the runway', () => {
    const r = new Rig(offer(DEST));
    r.flyTo(ORIGIN, DEST);
    r.engines(false);
    r.set(fieldPoint(DEST, 0, 2), 0, 0);
    r.c.parkingBrake = true;
    r.run(3.1);
    expect([r.monitor.ended?.outcome, r.monitor.ended?.onRunway]).toEqual(['completed', true]);
  });
});

describe('when it goes wrong', () => {
  it('outlands 10 s after shutting down away from every field', () => {
    const r = new Rig(offer(DEST));
    r.flyTo(ORIGIN, DEST);
    const away = fieldPoint(DEST, 0, 4000);
    r.set(away, 0, 0);
    r.engines(false);
    r.run(9.9);
    expect(r.monitor.ended).toBeNull();
    r.run(0.2);
    expect([r.monitor.ended?.outcome, r.monitor.ended?.atField]).toEqual(['outlanded', null]);
    expect(r.monitor.ended?.position.north).toBeCloseTo(away.north, 6);
  });

  it('ends crashed on the crash event, with the reason', () => {
    const r = new Rig(offer(DEST));
    r.flyTo(ORIGIN, DEST);
    r.events.emit('crash', { reason: 'Impact with the ground' });
    expect([r.monitor.ended?.outcome, r.monitor.ended?.crashReason, r.monitor.ended?.atField]).toEqual(['crashed', 'Impact with the ground', null]);
    // Nothing afterwards changes it.
    r.park(DEST, true, 5);
    expect(r.monitor.ended?.outcome).toBe('crashed');
    expect(r.log.filter((e) => e.kind === 'ended')).toHaveLength(1);
  });

  it('abandons on a reset from outside the Career, and only re-places on its own', () => {
    const r = new Rig(offer(DEST));
    r.ground(fieldStand(ORIGIN), { engine: true, brake: true }, 5);
    r.events.emit('reset', { scenario: 'apron', lessonId: `${CAREER_RESET_PREFIX}${r.monitor.offer.id}` });
    expect(r.monitor.ended).toBeNull();
    expect(r.monitor.elapsedS).toBeCloseTo(5, 6);
    r.run(5);
    expect(r.monitor.elapsedS).toBeCloseTo(10, 6);
    r.events.emit('reset', { scenario: 'runway' });
    expect(r.monitor.ended?.outcome).toBe('abandoned');
    expect(r.monitor.ended?.atField).toBe(ORIGIN.code);
    const lesson = new Rig(offer(DEST));
    lesson.events.emit('reset', { scenario: 'runway', lessonId: 'L04' });
    expect(lesson.monitor.ended?.outcome).toBe('abandoned');
  });

  it('abandons on request, at the field it stands in', () => {
    const r = new Rig(offer(DEST));
    r.run(1);
    const rep = r.monitor.abandon();
    expect([rep.outcome, rep.atField, r.monitor.phase]).toEqual(['abandoned', ORIGIN.code, 'done']);
    expect(r.monitor.abandon()).toBe(rep);
  });
});

describe('helicopters', () => {
  it('lift off with no throttle and complete with no brake', () => {
    const r = new Rig(offer(DEST, { minClass: 'heli', refType: 'r44' }), HELI);
    const stand = fieldStand(DEST);
    r.ground(fieldStand(ORIGIN), { engine: true, brake: false }, 30);
    r.c.throttle = 0.3;
    r.set(fieldStand(ORIGIN), 2, 0, 200);
    r.run(1);
    r.set(fieldStand(ORIGIN), 7, 0);
    r.run(2.5);
    expect(r.monitor.phase).toBe('ground');
    r.run(1);
    expect(r.monitor.phase).toBe('airborne');
    r.set(stand, 7, 0, -150);
    r.run(5);
    r.set(stand, 0, 0, -150);
    r.monitor.onTouchdown(r.s, 'left', 150);
    r.set(stand, 0, 0);
    r.run(4);
    expect(r.monitor.phase).toBe('landed');
    r.engines(false);
    r.run(2.9);
    expect(r.monitor.ended).toBeNull();
    r.run(0.2);
    const end = r.monitor.ended!;
    expect([end.outcome, end.atField, end.takeoffs]).toEqual(['completed', DEST.code, 1]);
    expect(end.landing?.helicopter).toBe(true);
    expect(end.landing?.spotDistM).toBeCloseTo(0, 6);
    expect(end.landing!.score).toBeGreaterThan(90);
  });
});

describe('state and timing', () => {
  it('restores its exported state and carries on identically', () => {
    const o = offer(DEST);
    const a = new Rig(o);
    a.ground(fieldStand(ORIGIN), { engine: true, brake: false }, 10);
    a.set(fieldPoint(ORIGIN, 0, 0), 150, 75, 700);
    a.run(20);
    a.set(fieldPoint(DEST, -3000, 0), 300, 100);
    a.run(10);
    const saved = JSON.parse(JSON.stringify(a.monitor.exportState()));
    const b = new Rig(o);
    // The flight resumed as the snapshot restores it: where it was, engine running, the same controls.
    Object.assign(b.s.position, a.s.position);
    b.engines(true);
    Object.assign(b.c, { throttle: a.c.throttle, parkingBrake: a.c.parkingBrake });
    b.monitor = b.make(o);
    b.monitor.connect(b.events, () => b.s);
    expect(b.monitor.restoreState(saved)).toBe(true);
    expect([b.monitor.phase, b.monitor.everAirborne, b.monitor.elapsedS]).toEqual([a.monitor.phase, true, a.monitor.elapsedS]);
    for (const r of [a, b]) {
      r.set(fieldPoint(DEST, -3000, 0), 300, 100);
      r.run(30);
      r.set(fieldPoint(DEST, -DEST.length / 2 - 200, 0), 18.3, 65, -400, DEST.heading);
      r.run(1);
      r.land(DEST);
      r.park(DEST, true, 3.1);
    }
    expect(b.monitor.ended).toEqual(a.monitor.ended);
    expect(b.monitor.ended?.outcome).toBe('completed');
  });

  it('refuses another job\'s state or a malformed one, staying fresh', () => {
    const a = new Rig(offer(DEST));
    a.run(2);
    const st = a.monitor.exportState();
    const b = new Rig(offer(DEST, { id: '3-KXXX-2' }));
    expect(b.monitor.restoreState(st)).toBe(false);
    expect(b.monitor.restoreState({ ...st, offerId: '3-KXXX-2', phase: 'flying' })).toBe(false);
    expect(b.monitor.restoreState({ ...st, offerId: '3-KXXX-2', simT: -1 })).toBe(false);
    expect(b.monitor.restoreState(null)).toBe(false);
    expect(b.monitor.phase).toBe('dispatched');
  });

  it('gives the same phases and job time with 0.25 s frames as with 0.0125 s frames', () => {
    const run = (dt: number) => {
      const r = new Rig(offer(DEST), AEROPLANE, dt);
      r.flyTo(ORIGIN, DEST);
      r.park(DEST, true, 3.5);
      return r;
    };
    const coarse = run(0.25);
    const fine = run(0.0125);
    expect(fine.phases.map((p) => p.phase)).toEqual(coarse.phases.map((p) => p.phase));
    expect(fine.phases.map((p) => p.t).every((t, i) => Math.abs(t - coarse.phases[i].t) <= 0.25 + 1e-6)).toBe(true);
    expect(fine.monitor.ended?.outcome).toBe('completed');
    expect(fine.monitor.ended!.elapsedMin).toBeCloseTo(coarse.monitor.ended!.elapsedMin, 6);
  });
});

describe('the strip', () => {
  it('names the destination, the deadline and the comfort of a passenger job', () => {
    const r = new Rig(offer(DEST));
    r.run(60);
    const m = r.monitor.strip()!;
    expect(m.target).toBe(`${DEST.code} ${DEST.name}`);
    expect(m.remainingMin).toBeCloseTo(50 - 1, 6);
    expect(m.comfort).toBe(100);
    expect(m.waypointIndex).toBeNull();
    expect(m.spotDistM).toBeNull();
    expect(m.phase).toBe('dispatched');
    expect(m.hint).toBe(`Start the engine and taxi out for ${DEST.code} ${DEST.name}`);
    expect(m.enduranceMin).toBeGreaterThan(0);
    expect(m.projectedReserveMin).toBeLessThan(m.enduranceMin);
    const freight = new Rig(offer(DEST, { kind: 'freight' }));
    freight.run(1);
    expect(freight.monitor.strip()!.comfort).toBeNull();
  });

  it('counts scenic turning points in order and shows "2 of 3"', () => {
    const p = (a: number) => fieldPoint(ORIGIN, a, 6000);
    const wps = [0, 3000, 6000].map((a, i) => ({ name: `Point ${'ABC'[i]}`, ...p(a), radiusM: 1500, maxAglFt: 2500 }));
    const r = new Rig(offer(ORIGIN, { kind: 'scenic', waypoints: wps }));
    r.ground(fieldStand(ORIGIN), { engine: true, brake: false }, 5);
    r.set(fieldPoint(ORIGIN, 0, 0), 150, 75, 700);
    r.run(5);
    r.set(wps[0], 300, 90);
    r.run(1);
    let m = r.monitor.strip()!;
    expect([m.waypointIndex, m.waypointsTotal, m.target]).toEqual([1, 3, 'Point B']);
    expect(m.hint).toBe('Fly over Point B (2 of 3)');
    // The ETA is the whole job's (B, then C, then the destination), at the present 90 kt, not just to B.
    const d = (a: { north: number; east: number }, b: { north: number; east: number }) => Math.hypot(a.north - b.north, a.east - b.east) / NM;
    const routeNm = d(wps[0], wps[1]) + d(wps[1], wps[2]) + d(wps[2], ORIGIN);
    expect(m.etaMin).toBeCloseTo((routeNm / 90) * 60, 6);
    expect(m.distanceNm).toBeCloseTo(d(wps[0], wps[1]), 6);
    // Too high over B does not count; C low enough does (B is then missed).
    r.set(wps[1], 1000, 90);
    r.run(1);
    r.set(wps[2], 300, 90);
    r.run(1);
    m = r.monitor.strip()!;
    expect(r.monitor.waypoints).toEqual({ done: 2, next: 3, total: 3 });
    expect(m.target).toBe(`${ORIGIN.code} ${ORIGIN.name}`);
    // No turning point left: no "n of 3" on the target line.
    expect([m.waypointIndex, m.waypointsTotal]).toEqual([null, 3]);
    expect(r.monitor.report('completed').waypointsDone).toBe(2);
  });

  it('shows a helicopter its distance to the spot near the destination', () => {
    const r = new Rig(offer(DEST, { minClass: 'heli', refType: 'r44' }), HELI);
    const stand = fieldStand(DEST);
    r.set({ north: stand.north + 300, east: stand.east }, 50, 20);
    r.run(1);
    expect(r.monitor.strip()!.spotDistM).toBeCloseTo(300, 6);
    r.set({ north: stand.north + 3000, east: stand.east }, 50, 20);
    r.run(1);
    expect(r.monitor.strip()!.spotDistM).toBeNull();
  });
});

describe('reports without a monitor', () => {
  it('builds a valid blank report for lost, diverted or unplaced endings', () => {
    const b = blankReport('lost', { north: 10, east: 20 }, 600, 40, null, 3);
    expect([b.outcome, b.elapsedMin, b.fuelAtEndKg, b.waypointsTotal, b.maxG, b.minG, b.comfort.score]).toEqual(['lost', 10, 40, 3, 1, 1, 100]);
    expect(validateReport(JSON.parse(JSON.stringify(b)))).toEqual(b);
  });

  it('hands over reports the save validator accepts', () => {
    const r = new Rig(offer(DEST));
    r.flyTo(ORIGIN, DEST);
    r.park(DEST, true, 3.1);
    const end = r.monitor.ended!;
    expect(validateReport(JSON.parse(JSON.stringify(end)))).toEqual(end);
    const cold = new Rig(offer(DEST));
    cold.run(1);
    const ab = cold.monitor.abandon();
    expect(validateReport(JSON.parse(JSON.stringify(ab)))).toEqual(ab);
  });
});
