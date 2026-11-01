// The job runtime against the real flight model (tests/career/headlessJob.ts): a C172S placed cold at the stand of
// a generated sealed field decides nothing until it has flown; started there, re-placed lined up by a Career
// placement, flown once round the field's circuit by the scripted pilot, stopped and shut down with the brake set,
// it completes the job at that field with the landing graded from the sim's own touchdown events; a C172S on the
// 'final' scenario at a generated field with the throttle closed lands or crashes (hands off at idle it dives into
// the ground short of every seed-0 field) and the report agrees with the sim's own touchdown and crash events; and an R44 placed cold at a
// grass strip, started, lifted to a hover, set down and shut down completes with no brake. (About 25 s of CPU in
// all, under the 40 s of tests/slow-tests.txt.)

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { R44_REFERENCE } from '../../src/aircraft/r44/reference';
import { loadAircraft } from '../../src/aircraft/registry';
import { fieldStand } from '../../src/career/geo';
import { setGpsTarget } from '../../src/instruments/dynamics/navigation';
import { setStartField } from '../../src/sim/startField';
import { generatedAirfields, type Airfield } from '../../src/world/airfields';
import { setEra } from '../../src/world/era/eraState';
import '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
import { CircuitPilot, HeadlessJob, HeliPilot, hostOffer, shutDownPiston, startPiston } from './headlessJob';

const LONG = 240_000;

let SEALED: Airfield;
let GRASS: Airfield;

beforeAll(() => {
  setEra('present');
  setWorldSeed(0);
  SEALED = [...generatedAirfields()].filter((f) => f.kind === 'sealed').sort((a, b) => b.length - a.length)[0];
  GRASS = generatedAirfields().find((f) => f.kind === 'grass')!;
});
afterAll(() => {
  setStartField(null);
  setGpsTarget(null);
  setWorldSeed(0);
});

describe('C172S', () => {
  it('placed cold at a generated field, started, flown round the circuit and shut down with the brake set, completes', async () => {
    const def = await loadAircraft('c172s');
    const job = new HeadlessJob({ type: 'c172s', def, offer: hostOffer(`1-${SEALED.code}-0`, SEALED) });
    const stand = fieldStand(SEALED);
    expect(Math.hypot(job.state.position.x - stand.north, job.state.position.y - stand.east)).toBeLessThan(5);
    expect(job.state.engine.running).toBe(false);
    expect(job.controls.parkingBrake).toBe(true);
    // Cold and dark with the brake set for a minute: nothing.
    job.run(60);
    expect(job.monitor.phase).toBe('dispatched');
    expect(job.monitor.ended).toBeNull();
    expect(startPiston(job)).toBeLessThan(10);
    job.run(2);
    expect(job.monitor.phase).toBe('ground');
    // Taxiing is not scripted: a Career placement puts it lined up, engine running; the job carries on.
    job.place('runway', SEALED, 0.8);
    expect(job.monitor.phase).toBe('ground');
    const pilot = new CircuitPilot(job, SEALED);
    pilot.begin();
    job.pilot = (_j, dt) => pilot.step(dt);
    let downwind: ReturnType<typeof job.monitor.strip> = null;
    job.run(900, (j) => {
      if (!downwind && pilot.leg === 2) downwind = j.monitor.strip();
      return !!j.monitor.ended || j.crashes.length > 0;
    });
    expect(job.crashes).toEqual([]);
    expect(pilot.phase).toBe('done');
    const end = job.monitor.ended!;
    expect(end.outcome).toBe('completed');
    expect(end.atField).toBe(SEALED.code);
    expect(end.onRunway).toBe(true);
    expect([end.takeoffs, end.landingsDay]).toEqual([1, 1]);
    expect(end.landing?.onTarget).toBe(true);
    expect(end.landing!.score).toBeGreaterThan(50);
    // The landing graded is the sim's own: the first wheel of its contacts and the sink of the first main wheel.
    const contacts = job.touchdowns.filter((t) => t.t > 100);
    expect(end.landing?.firstWheel).toBe(contacts[0].wheel);
    expect(end.landing!.sinkFpm).toBeCloseTo(contacts.find((t) => t.wheel !== 'nose')!.sinkFpm, 6);
    expect(end.airborneS).toBeGreaterThan(120);
    // The sim's units read as the runtime expects them: a calm scripted circuit is a smooth ride inside the limits,
    // and on downwind the live fuel flow leaves a projected reserve short of the endurance but well above zero.
    expect(end.comfort.score).toBeGreaterThan(90);
    expect(end.maxG).toBeLessThan(1.5);
    expect(end.minG).toBeGreaterThan(0.5);
    expect([end.overspeedS, end.stallWarningS]).toEqual([0, 0]);
    expect(downwind).not.toBeNull();
    expect(downwind!.phase).toBe('airborne');
    expect(downwind!.projectedReserveMin).toBeGreaterThan(60);
    expect(downwind!.projectedReserveMin).toBeLessThan(downwind!.enduranceMin);
    expect(end.fuelAtEndKg).toBeLessThan(0.8 * 144);
    // Job time is the whole of it, the minute at the stand included (the re-placement carried it).
    expect(end.elapsedMin * 60).toBeGreaterThan(job.t - 0.2);
    expect(end.elapsedMin * 60).toBeLessThanOrEqual(job.t + 1e-6);
    expect(job.monitorEvents).toEqual([{ kind: 'ended', report: end }]);
  }, LONG);

  it('on final at a generated field with the throttle closed lands or crashes, and the report agrees with the touchdown events', async () => {
    const def = await loadAircraft('c172s');
    const job = new HeadlessJob({ type: 'c172s', def, offer: hostOffer(`1-${SEALED.code}-1`, SEALED), start: 'final' });
    job.controls.throttle = 0;
    job.run(240, (j) => j.crashes.length > 0 || (j.state.onGround && j.state.groundSpeed < 0.3));
    if (!job.crashes.length) {
      expect(job.monitor.phase).toBe('landed');
      shutDownPiston(job.controls);
      job.controls.parkingBrake = true;
      job.run(20, (j) => !!j.monitor.ended);
    }
    const end = job.monitor.ended!;
    expect(end).not.toBeNull();
    const contacts = job.touchdowns.filter((t) => t.t > 0);
    if (job.crashes.length) {
      // A crash is the sim's crash, with its reason; no landing is logged or graded for it.
      expect(end.outcome).toBe('crashed');
      expect(end.crashReason).toBe(job.crashes[0]);
      expect(end.atField).toBeNull();
      expect(end.landingsDay + end.landingsNight).toBe(0);
      if (contacts.length === 0) expect(end.landing).toBeNull();
    } else {
      expect(contacts.length).toBeGreaterThan(0);
      expect(['completed', 'outlanded']).toContain(end.outcome);
      // The landing graded is the sim's: its first wheel, and the sink of its first main-wheel contact.
      const mains = contacts.find((t) => t.wheel !== 'nose')!;
      expect(end.landing?.firstWheel).toBe(contacts[0].wheel);
      expect(end.landing!.sinkFpm).toBeCloseTo(mains.sinkFpm, 6);
      expect(end.landingsDay).toBe(1);
      expect(end.takeoffs).toBe(1);
    }
  }, LONG);
});

describe('R44', () => {
  it('placed cold, started, lifted to a hover, set down and shut down completes with no brake', async () => {
    const def = await loadAircraft('r44');
    const job = new HeadlessJob({ type: 'r44', def, offer: hostOffer(`1-${GRASS.code}-0`, GRASS, GRASS, { minClass: 'heli', refType: 'r44' }) });
    expect(job.state.engine.running).toBe(false);
    const pilot = new HeliPilot(job, R44_REFERENCE.engineRpm100);
    pilot.install();
    let hovered = 0;
    let gripAirborne = 0;
    job.run(600, (j) => {
      if (pilot.phase === 'hover' && pilot.height() > 5) hovered += 1 / 30;
      if (!j.state.onGround) gripAirborne = Math.max(gripAirborne, j.controls.throttle);
      return !!j.monitor.ended || j.crashes.length > 0;
    });
    expect(job.crashes).toEqual([]);
    expect(hovered).toBeGreaterThan(5);
    // The governed grip never reaches the liftoff detector's 0.5: the monitor's own airborne rule saw the lift-off.
    expect(gripAirborne).toBeLessThan(0.5);
    const end = job.monitor.ended!;
    expect(end.outcome).toBe('completed');
    expect(end.atField).toBe(GRASS.code);
    expect([end.takeoffs, end.landingsDay]).toEqual([1, 1]);
    expect(end.landing?.helicopter).toBe(true);
    expect(end.landing!.spotDistM!).toBeLessThan(15);
    expect(end.landing!.score).toBeGreaterThan(80);
    expect(end.onApron).toBe(true);
  }, LONG);
});
