// The wave-4 jobs (src/career/jobs.ts wave4BoardFor), their runtime and the site's smoke. It proves: boardFor is the
// base offers (deep-equal to baseBoardFor, so boards.golden.json is untouched) followed by the `|w4` stream's offers
// with contiguous `${day}-${origin}-w${n}` ids, the same every time; on 6 days at every field of seeds 0 and 7 each
// medevac is a helicopter job out to one landing waypoint (60 m, 30 s) at a valid site and on to the home or sealed
// field nearest it, with the paramedic, the patient and a kit aboard; each utility job is a helicopter survey of 3 or
// 4 low-level points along the river or a road, clear of every field, back to the origin; each landmark scenic flies
// 2 or 3 of 4b's landmarks within reach, no higher than the class may go, in a loop of at most 40 NM, never in a
// twin; every one fits its reference type, pays and allows the time the rules say, and all three kinds turn up at
// both seeds. A save round trip keeps the landing waypoint. A helicopter flown (synthetically) to the site counts it
// after 30 s on the ground, not by overflight nor before, may shut down there without outlanding, and completes at
// the hospital field, settling 'completed' with the aircraft there; a site destination completes after its hold
// with the engines off instead of outlanding. The strip asks to land at the site and stay. The CareerSystem shows the
// smoke only while a medevac's site is the job's next point (never for another job, hidden once the pickup counts
// or the job ends), and the plume rises in calm air and drifts downwind in a breeze.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadAircraft } from '../../src/aircraft/registry';
import type { AircraftDefinition } from '../../src/aircraft/types';
import { CareerSystem, type CareerShell } from '../../src/career/CareerSystem';
import { createCareer } from '../../src/career/create';
import { settleJob } from '../../src/career/economy';
import { fitOffer } from '../../src/career/fit';
import { fieldStand } from '../../src/career/geo';
import {
  baseBoardFor, boardFor, classTypes, offerDeadlineMin, offerPayUsd, W4_RULES, wave4BoardFor,
} from '../../src/career/jobs';
import { landmarks } from '../../src/career/landmarks';
import { loadSheet } from '../../src/career/loadsheet';
import { SmokeMarker } from '../../src/career/render/smokeMarker';
import { CompletionTracker } from '../../src/career/runtime/completion';
import { JobMonitor, type JobMonitorEvent, type MonitorAircraft } from '../../src/career/runtime/monitor';
import { jobHint } from '../../src/career/runtime/strip';
import { siteRefusal } from '../../src/career/sites';
import { CareerStore } from '../../src/career/store';
import {
  BOARD_RULES, CLASS_RULES, COMPLETION_RULES, OCCUPANT_KG, PAY_RULES, ROTORCRAFT_CLASS_ORDER,
  type ActiveJob, type CareerSave, type JobOffer,
} from '../../src/career/types';
import { validateOffer } from '../../src/career/validate';
import { createEventBus, type SimContext } from '../../src/core/context';
import { FT, KT, NM } from '../../src/core/math';
import { makeMockEnvironment, makeMockState } from '../../src/core/mockState';
import { defaultControls, defaultWeather, type AircraftState } from '../../src/core/types';
import { setGpsTarget } from '../../src/instruments/dynamics/navigation';
import { resetRadios } from '../../src/instruments/dynamics/radios';
import { SimPhysics } from '../../src/sim/SimPhysics';
import { setStartField } from '../../src/sim/startField';
import { memoryStore } from '../../src/training/career/store';
import { airfields, HOME_AIRFIELD, type Airfield } from '../../src/world/airfields';
import { setEra } from '../../src/world/era/eraState';
import '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';

const HELI: MonitorAircraft = { helicopter: true, vneKt: 130, mainsBody: { x: 0, y: 0, z: 1.0 }, noseX: 2 };
const DAYS = 6;

beforeAll(() => {
  setEra('present');
  setWorldSeed(0);
});
afterAll(() => {
  setStartField(null);
  setGpsTarget(null);
  setWorldSeed(0);
  resetRadios();
});

const W4_ID = /^(\d+)-([A-Z]+)-w(\d+)$/;
const nmBetween = (a: { north: number; east: number }, b: { north: number; east: number }) => Math.hypot(a.north - b.north, a.east - b.east) / NM;

/** Every wave-4 offer on DAYS days at every field of the world booted. */
function w4Offers(seed: number): { offer: JobOffer; fields: readonly Airfield[] }[] {
  const fields = airfields();
  const out: { offer: JobOffer; fields: readonly Airfield[] }[] = [];
  for (let day = 1; day <= DAYS; day++) for (const f of fields) for (const offer of wave4BoardFor(seed, day, f.code, fields)) out.push({ offer, fields });
  return out;
}

/** The first piston-helicopter medevac on the home board from day 1 on (seed 0). */
function homeMedevac(): JobOffer {
  for (let day = 1; day < 60; day++) {
    const o = wave4BoardFor(0, day, HOME_AIRFIELD.code, airfields()).find((x) => x.kind === 'medevac' && x.minClass === 'heli');
    if (o) return o;
  }
  throw new Error('no medevac at home');
}

// --------------------------------------------------------------------------------------------- the stream

describe('the wave-4 stream', () => {
  it('follows the base offers with contiguous -w ids and leaves the base offers as they are', () => {
    const fields = airfields();
    for (let day = 1; day <= 3; day++) {
      for (const f of fields) {
        const all = boardFor(0, day, f.code, fields);
        const base = baseBoardFor(0, day, f.code, fields);
        expect(all.slice(0, base.length)).toEqual(base);
        const w4 = all.slice(base.length);
        expect(w4).toEqual(wave4BoardFor(0, day, f.code, fields));
        w4.forEach((o, n) => expect(o.id).toBe(`${day}-${f.code}-w${n}`));
        expect(w4.length).toBeLessThanOrEqual(W4_RULES.count[1]);
        expect(boardFor(0, day, f.code, fields)).toEqual(all);
      }
    }
  });

  for (const seed of [0, 7]) {
    it(`gives valid medevac, utility and landmark scenic offers at seed ${seed}`, () => {
      setWorldSeed(seed);
      try {
        const list = w4Offers(seed);
        const kinds = new Set(list.map((x) => x.offer.kind));
        expect([...kinds].sort()).toEqual(['medevac', 'scenic', 'utility']);
        for (const { offer: o, fields } of list) {
          const at = `${o.id} ${o.title}`;
          const origin = fields.find((f) => f.code === o.origin)!;
          expect(o.id, at).toMatch(W4_ID);
          expect(o.destination.kind).toBe('field');
          const dest = fields.find((f) => o.destination.kind === 'field' && f.code === o.destination.code)!;
          const wps = o.waypoints ?? [];
          // Fits its reference type (the first of its class that does); pay, time and reputation by the rules.
          expect(fitOffer(o, o.refType, fields), at).toBeNull();
          expect(classTypes(o.minClass).includes(o.refType)).toBe(true);
          expect(o.pay).toBe(offerPayUsd(o, fields, 1));
          expect(o.deadlineMin).toBe(offerDeadlineMin(o, fields));
          expect(o.repRequired).toBe(CLASS_RULES[o.minClass].rep + PAY_RULES[o.kind].rep);
          expect(o.premium).toBe(false);
          expect(o.payloadKg).toBe(o.payload.reduce((s, p) => s + p.kg, 0));
          if (o.kind === 'medevac') {
            expect((ROTORCRAFT_CLASS_ORDER as readonly string[]).includes(o.minClass), at).toBe(true);
            expect(wps).toHaveLength(1);
            const w = wps[0];
            expect(w.landS).toBe(COMPLETION_RULES.siteHoldS);
            expect(w.radiusM).toBe(COMPLETION_RULES.siteRadiusM);
            expect(siteRefusal(w, fields), at).toBeNull();
            const d = nmBetween(origin, w);
            expect(d).toBeGreaterThanOrEqual(W4_RULES.medevacNm[0] - 1);   // the anchor is within reach; the site a ring off it
            expect(d).toBeLessThanOrEqual(W4_RULES.medevacNm[1] + 1);
            // The hospital: the home or sealed field nearest the site.
            const nearest = fields.filter((f) => f.kind !== 'grass').sort((a, b) => nmBetween(a, w) - nmBetween(b, w))[0];
            expect(dest.code).toBe(nearest.code);
            expect(o.distanceNm).toBeCloseTo(nmBetween(origin, w) + nmBetween(w, dest), 1);
            expect(o.payload.map((p) => p.kind)).toEqual(['passenger', 'patient', 'equipment']);
            expect(o.pax).toBe(2);
            expect(o.payload[2].kg).toBeGreaterThanOrEqual(W4_RULES.kitKg[0]);
            expect(o.payload[2].kg).toBeLessThanOrEqual(W4_RULES.kitKg[1]);
          } else if (o.kind === 'utility') {
            expect((ROTORCRAFT_CLASS_ORDER as readonly string[]).includes(o.minClass), at).toBe(true);
            expect(dest.code).toBe(origin.code);
            expect(wps.length).toBeGreaterThanOrEqual(W4_RULES.patrolPoints[0]);
            expect(wps.length).toBeLessThanOrEqual(W4_RULES.patrolPoints[1]);
            for (const w of wps) {
              expect(w.maxAglFt).toBe(W4_RULES.patrolMaxAglFt);
              expect(w.radiusM).toBe(W4_RULES.patrolRadiusM);
              expect(w.landS).toBeUndefined();
              for (const f of fields) expect(Math.hypot(f.north - w.north, f.east - w.east), at).toBeGreaterThanOrEqual(BOARD_RULES.scenicFieldClearM);
            }
            expect(o.payload.map((p) => p.kind)).toEqual(['passenger', 'equipment']);
          } else {
            expect(o.kind).toBe('scenic');
            expect(o.minClass).not.toBe('twin');
            expect(dest.code).toBe(origin.code);
            expect(wps.length).toBeGreaterThanOrEqual(2);
            expect(wps.length).toBeLessThanOrEqual(3);
            const marks = landmarks(fields);
            for (const w of wps) {
              const l = marks.find((m) => m.name === w.name);
              expect(l, `${at}: ${w.name}`).toBeDefined();
              expect(w.north).toBe(l!.north);
              const d = nmBetween(origin, l!);
              expect(d).toBeGreaterThanOrEqual(W4_RULES.landmarkNm[0]);
              expect(d).toBeLessThanOrEqual(W4_RULES.landmarkNm[1]);
              expect(l!.elevationM).toBeLessThanOrEqual(W4_RULES.landmarkMaxFt[o.minClass] * FT);
            }
            expect(o.distanceNm).toBeLessThanOrEqual(W4_RULES.landmarkLoopMaxNm);
            expect(o.pax).toBeGreaterThanOrEqual(1);
          }
        }
      } finally {
        setWorldSeed(0);
      }
    }, 120_000);
  }

  it('keeps the landing waypoint through a save round trip', () => {
    const o = homeMedevac();
    const back = validateOffer(JSON.parse(JSON.stringify(o)));
    expect(back).toEqual(o);
    expect(back!.waypoints![0].landS).toBe(COMPLETION_RULES.siteHoldS);
  });
});

// --------------------------------------------------------------------------------------------- the runtime

/** A synthetic helicopter flight (as tests/career/monitor.test.ts's rig): a mock state moved by hand, frame by frame. */
class Rig {
  readonly s: AircraftState = makeMockState({ heightAGL: 0 });
  readonly c = defaultControls();
  readonly weather = { ...defaultWeather(), turbulence: 0, timeOfDay: 12, windSpeedKt: 0 };
  readonly env = makeMockEnvironment();
  readonly log: JobMonitorEvent[] = [];
  readonly monitor: JobMonitor;
  readonly dt = 1 / 30;

  constructor(readonly offer: JobOffer, readonly fields: readonly Airfield[]) {
    this.monitor = new JobMonitor({ offer, type: 'r44', aircraft: HELI, fields, onEvent: (e) => this.log.push(e) });
    this.monitor.connect(createEventBus(), () => this.s);
  }

  at(p: { north: number; east: number }, heightM: number, gsKt: number, engines: boolean): void {
    const s = this.s;
    const onGround = heightM <= 0;
    s.position.x = p.north;
    s.position.y = p.east;
    s.altitudeAGL = onGround ? 1.0 : heightM + 1.0;
    s.altitudeMSL = s.altitudeAGL;
    s.position.z = -s.altitudeMSL;
    s.onGround = onGround;
    for (const w of s.wheels) w.onGround = onGround;
    s.groundSpeed = gsKt * KT;
    s.ias = s.tas = gsKt * KT;
    s.verticalSpeed = 0;
    for (const e of s.engines) e.running = engines;
  }

  run(seconds: number): void {
    const n = Math.round(seconds / this.dt);
    for (let i = 0; i < n; i++) this.monitor.update(this.dt, { state: this.s, controls: this.c, weather: this.weather, env: this.env });
  }

  hint(): string {
    return this.monitor.strip()!.hint;
  }
}

describe('a medevac flown to its site', () => {
  it('counts the site after 30 s on the ground there, never by overflight, and completes at the hospital', () => {
    const fields = airfields();
    const o = homeMedevac();
    const site = o.waypoints![0];
    const dest = fields.find((f) => o.destination.kind === 'field' && f.code === o.destination.code)!;
    const r = new Rig(o, fields);
    const stand = fieldStand(fields.find((f) => f.code === o.origin)!);
    // On the site before flying: nothing (the site is ≥ 300 m from fields, so this is only a check of the rule).
    r.at(site, 0, 0, true);
    r.run(40);
    expect(r.monitor.waypoints.done).toBe(0);
    r.at(stand, 0, 0, true);
    r.run(5);
    r.at(stand, 30, 20, true);
    r.run(5);
    expect(r.monitor.phase).toBe('airborne');
    expect(r.hint()).toBe(`Land at ${site.name} (1 of 1)`);
    expect(r.monitor.strip()!.target).toBe(site.name);
    // Overflying it low does not count.
    r.at(site, 20, 30, true);
    r.run(30);
    expect(r.monitor.waypoints.done).toBe(0);
    // Down within 60 m: the strip asks to stay; 29 s is not enough, 30 s is.
    r.at({ north: site.north + 40, east: site.east }, 0, 0, true);
    r.run(11);
    expect(r.monitor.phase).toBe('landed');
    expect(r.hint()).toBe(`Stay on the ground within ${COMPLETION_RULES.siteRadiusM} m of ${site.name} for ${COMPLETION_RULES.siteHoldS} s`);
    r.run(18);
    expect(r.monitor.waypoints.done).toBe(0);
    r.run(1.1);
    expect(r.monitor.waypoints).toEqual({ done: 1, next: 1, total: 1 });
    // Picked up, off any field: the strip asks to take off for the hospital (a shutdown here decides nothing).
    expect(r.hint()).toBe(`The patient is aboard: take off for ${dest.code} ${dest.name}`);
    // Shut down at the site for a minute: no outlanding.
    r.at({ north: site.north + 40, east: site.east }, 0, 0, false);
    r.run(60);
    expect(r.log).toEqual([]);
    expect(r.monitor.strip()!.target).toBe(`${dest.code} ${dest.name}`);
    // On to the hospital and shut down at its stand.
    r.at(site, 30, 20, true);
    r.run(5);
    r.at(fieldStand(dest), 0, 0, true);
    r.run(12);
    r.at(fieldStand(dest), 0, 0, false);
    r.run(4);
    const end = r.monitor.ended!;
    expect(end.outcome).toBe('completed');
    expect(end.atField).toBe(dest.code);
    expect(end.waypointsDone).toBe(1);
    expect(end.waypointsTotal).toBe(1);
    // Settled: completed (not a missed route), the aircraft at the hospital.
    const save: CareerSave = createCareer({ pilotName: 'T', companyName: 'Fable Air', callsign: '', start: 'c172s' }, { seed: 0, licence: 'declared', authority: 'easa', homeCode: HOME_AIRFIELD.code, now: 0 });
    const ac = { ...save.fleet[0], type: 'r44' as const };
    const job: ActiveJob = {
      offer: o, aircraftUid: ac.uid, type: 'r44', fuelKg: 60, loading: null, items: [], phase: 'landed', placed: true, acceptedAtMin: save.clockMin,
      elapsedBaseS: 0, elapsedS: 0, lastKnown: { ...fieldStand(dest), onGround: true }, everAirborne: true, playerWeather: defaultWeather(),
    };
    const out = settleJob({ ...save, fleet: [ac] }, job, end, fields);
    expect(out.settlement.outcome).toBe('completed');
    expect(out.settlement.aircraftAt).toBe(dest.code);
  });

  it('shows the distance to the site as the spot; a shutdown just outside the ring is not an outlanding', () => {
    const fields = airfields();
    const o = homeMedevac();
    const site = o.waypoints![0];
    const r = new Rig(o, fields);
    r.at(fieldStand(fields.find((f) => f.code === o.origin)!), 0, 0, true);
    r.run(2);
    r.at(site, 30, 20, true);
    r.run(5);
    // Landed 70 m upwind of the smoke, outside the 60 m ring: the spot reads 70 m, and the hold does not count.
    const near = { north: site.north + 70, east: site.east };
    r.at(near, 0, 0, true);
    r.run(15);
    expect(r.monitor.strip()!.spotDistM).toBeCloseTo(70, 6);
    expect(r.monitor.waypoints.done).toBe(0);
    r.at(near, 0, 0, false);
    r.run(30);
    expect(r.monitor.ended).toBeNull();
    expect(r.log).toEqual([]);
  });

  it('outlands when shut down away from the site and every field', () => {
    const fields = airfields();
    const o = homeMedevac();
    const site = o.waypoints![0];
    const r = new Rig(o, fields);
    r.at(fieldStand(fields.find((f) => f.code === o.origin)!), 0, 0, true);
    r.run(2);
    r.at(site, 30, 20, true);
    r.run(5);
    r.at({ north: site.north + 500, east: site.east }, 0, 0, false);
    r.run(25);   // 10 s on the ground to count as landed (no touchdown event here), then 10 s shut down
    expect(r.monitor.ended?.outcome).toBe('outlanded');
  });

  it('completes a site destination after the hold with the engines off, instead of outlanding', () => {
    const fields = airfields();
    const site = homeMedevac().waypoints![0];
    const t = new CompletionTracker({ kind: 'site', id: 's', name: site.name, north: site.north, east: site.east, elevation: 0 }, fields);
    const x = { phase: 'landed' as const, everAirborne: true, onGround: true, gsMs: 0, enginesStopped: true, parkingBrake: false, helicopter: true, north: site.north, east: site.east };
    let d = null;
    let s = 0;
    for (; s < 40 && !d; s += 0.1) d = t.update(x, 0.1);
    expect(d).toEqual({ kind: 'completed', field: null, area: 'site' });
    expect(s).toBeCloseTo(COMPLETION_RULES.siteHoldS, 1);
  });

  it('words the landing point in the strip', () => {
    const wp = { name: 'Roadside 3.0 NM west of Elmley', index: 0, total: 1, land: { radiusM: 60, holdS: 30 } };
    const base = { everAirborne: true, helicopter: true, destination: 'KELM Elmley Aerodrome', atDestination: false, brakeHint: false };
    expect(jobHint({ ...base, phase: 'dispatched', waypoint: wp })).toBe('Start up, then depart for Roadside 3.0 NM west of Elmley');
    expect(jobHint({ ...base, phase: 'ground', waypoint: wp })).toBe('Take off for Roadside 3.0 NM west of Elmley');
    expect(jobHint({ ...base, phase: 'airborne', waypoint: wp })).toBe('Land at Roadside 3.0 NM west of Elmley (1 of 1)');
    expect(jobHint({ ...base, phase: 'landed', waypoint: wp })).toBe('Stay on the ground within 60 m of Roadside 3.0 NM west of Elmley for 30 s');
    expect(jobHint({ ...base, phase: 'landed', waypoint: null, pickedUp: true })).toBe('The patient is aboard: take off for KELM Elmley Aerodrome');
    expect(jobHint({ ...base, phase: 'landed', waypoint: null })).toBe('Shut down here to stop, or take off again for KELM Elmley Aerodrome');
    // A turning point with a height limit (a survey, a landmark) names it.
    const low = { name: 'River point 1', index: 0, total: 3, maxAglFt: 500 };
    expect(jobHint({ ...base, phase: 'airborne', waypoint: low })).toBe('Fly over River point 1 below 500 ft AGL (1 of 3)');
    expect(jobHint({ ...base, phase: 'airborne', waypoint: { ...low, maxAglFt: 2500 } })).toBe('Fly over River point 1 below 2,500 ft AGL (1 of 3)');
  });
});

// --------------------------------------------------------------------------------------------- the smoke

describe('the smoke marker', () => {
  let r44: AircraftDefinition;
  beforeAll(async () => {
    r44 = await loadAircraft('r44');
  });

  /** A CareerSystem around a real R44 SimPhysics with a scene to add to; an R44 leased at home on the medevac's day. */
  function host(offer: JobOffer) {
    const weather = { ...defaultWeather(), windSpeedKt: 0, gustKt: 0, turbulence: 0, timeOfDay: 12 };
    const events = createEventBus();
    const physics = new SimPhysics({ weather, events, aircraft: r44 });
    const scene: unknown[] = [];
    let dt = 0;
    const store = new CareerStore(memoryStore(), 'mem');
    const base = createCareer({ pilotName: 'T', companyName: 'Fable Air', callsign: '', start: 'c172s' }, { seed: 0, licence: 'declared', authority: 'easa', homeCode: HOME_AIRFIELD.code, now: 0 });
    const save: CareerSave = {
      ...base, clockMin: offer.day * 1440 + 10 * 60, reputation: 100, cash: 1e6, ratings: ['sep', 'heli'],
      fleet: [{ ...base.fleet[0], type: 'r44', field: HOME_AIRFIELD.code, fuelKg: 0 }],
    };
    store.save(save);
    const shell: CareerShell = {
      physics, weather, store, aircraft: r44, layer: null,
      startFrom: async (sc, o) => {
        physics.resetTo(sc, weather);
        events.emit('reset', { scenario: sc.id, lessonId: o.lessonId });
      },
      setHold: () => {},
      persist: () => {},
      frameSimDt: () => dt,
      addToScene: (obj) => scene.push(obj),
    };
    const system = new CareerSystem(shell);
    system.init({ events } as unknown as SimContext);
    const sky = { sunColor: { r: 9000, g: 8500, b: 8000 }, skyColor: { r: 400, g: 500, b: 700 } };
    const frame = (seconds: number) => {
      for (let t = 0; t < seconds; t += 0.1) {
        dt = 0.1;
        physics.step(0.1);
        system.update(0.1, { sky } as unknown as SimContext);
        dt = 0;
      }
    };
    return { system, scene, frame, save, physics };
  }

  async function accepted(offer: JobOffer) {
    const h = host(offer);
    const ac = h.save.fleet[0];
    const fields = airfields();
    const fuel = loadSheet(offer, ac, 0, h.save, fields).requiredFuelKg;
    expect(await h.system.accept(offer.id, ac.uid, fuel)).toBe('placed');
    return h;
  }

  it('burns at the site while the job flies to it, and goes out once the pickup counts or the job ends', async () => {
    const o = homeMedevac();
    const h = await accepted(o);
    h.frame(1);
    const smoke = h.system.smokeMarker!;
    expect(smoke).not.toBeNull();
    expect(h.scene).toEqual([smoke.object]);
    expect(smoke.visible).toBe(true);
    expect(smoke.livePuffs()).toBeGreaterThan(0);
    // The canister is on the site's ground (three: x east, y up, z -north).
    const site = o.waypoints![0];
    expect(smoke.object.position.x).toBeCloseTo(site.east, 3);
    expect(smoke.object.position.z).toBeCloseTo(-site.north, 3);
    // The pickup counted: the monitor's state with the site behind it.
    const m = h.system.jobMonitor!;
    const st = { ...m.exportState(), waypointsDone: 1, nextWaypoint: 1 };
    expect(m.restoreState(st)).toBe(true);
    h.frame(0.2);
    expect(smoke.visible).toBe(false);
    expect(h.scene).toHaveLength(1);   // added once
    // A fresh medevac shows it again; abandoning it puts it out.
    const h2 = await accepted(o);
    h2.frame(0.5);
    expect(h2.system.smokeMarker!.visible).toBe(true);
    h2.system.abandonJob(true, null);
    h2.frame(0.2);
    expect(h2.system.save!.active).toBeNull();
    expect(h2.system.smokeMarker!.visible).toBe(false);
  });

  it('is never made for a job without a site', async () => {
    const fields = airfields();
    let offer: JobOffer | undefined;
    for (let day = 1; day < 30 && !offer; day++) {
      offer = boardFor(0, day, HOME_AIRFIELD.code, fields).find((x) => (x.minClass === 'heli') && !x.waypoints?.some((w) => w.landS !== undefined));
    }
    const h = await accepted(offer!);
    h.frame(1);
    expect(h.system.smokeMarker).toBeNull();
    expect(h.scene).toEqual([]);
  });

  it('rises in calm air and drifts downwind in a breeze', () => {
    const s = new SmokeMarker();
    s.update(5, 0, 0, null);
    expect(s.livePuffs()).toBe(0);   // hidden: nothing moves
    s.visible = true;
    s.place(1000, 2000, 50);
    s.update(20, 0, 0, null);
    expect(s.livePuffs()).toBeGreaterThan(50);
    const calm = s.drift();
    expect(Math.hypot(calm.north, calm.east)).toBeLessThan(3);
    expect(calm.up).toBeGreaterThan(5);
    // A westerly (from 270) at 12 kt: the plume lies to the east of the canister, and lower.
    s.update(1, 270, 12, null);
    const breeze = s.drift();
    expect(breeze.east).toBeGreaterThan(10);
    expect(Math.abs(breeze.north)).toBeLessThan(breeze.east / 4);
    expect(breeze.up).toBeLessThan(calm.up);
    s.dispose();
  });
});
