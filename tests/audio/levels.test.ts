// Audio levels from REAL flight: the real flight model (SimPhysics in the real world) drives the real
// parameter mapping and synthesis worklet, and the mix model (mixModel.ts, built from src/audio/mix.ts)
// gives what reaches the master limiter at volume 1. Checks that nothing clips in normal operation, that
// the relative loudness of flight phases is plausible for a C172 cockpit, and that start-up, shut-down,
// stall horn, flap motor, touchdown and ground roll are triggered by the real simulation.

import { describe, expect, it } from 'vitest';
import { KT, quat } from '../../src/core/math';
import { AIRPORT, runwayDirection } from '../../src/core/world';
import { FlightRecorder, renderRecording, STEM, type Recording } from './flightAudio';
import { biquad, dbfs, exteriorMix, interiorMix } from './mixModel';
import { peak, rms, SR } from './workletHost';

interface Levels {
  intRms: number;
  intPeak: number;
  extRms: number;
  extPeak: number;
  stems: Float32Array[];
  interior: Float32Array;
}

function levels(rec: Recording, settle = 0.4): Levels {
  const stems = renderRecording(rec);
  const interior = interiorMix(stems);
  const exterior = exteriorMix(stems, 15);
  const from = Math.floor(settle * SR);
  return {
    intRms: dbfs(rms(interior, from)),
    intPeak: dbfs(peak(interior.subarray(from))),
    extRms: dbfs(rms(exterior, from)),
    extPeak: dbfs(peak(exterior.subarray(from))),
    stems,
    interior,
  };
}

const stemDb = (l: Levels, stem: number, from = 0.4, to?: number): number =>
  dbfs(rms(l.stems[stem], Math.floor(from * SR), to === undefined ? undefined : Math.floor(to * SR)));

/** Interior energy in the stall-horn band (2-3.5 kHz). */
const hornBand = (l: Levels): number => dbfs(rms(biquad(biquad(l.interior, { type: 'highpass', frequency: 1800, Q: 0 }), { type: 'lowpass', frequency: 3500, Q: 0 }), SR / 2));

describe('audio levels from the real flight model', () => {
  const f = new FlightRecorder();
  const c = f.physics.controls;
  const phase: Record<string, Levels> = {};

  it('records and renders the flight phases', () => {
    f.reset('runway');
    const spawn = f.record('spawn', 1);
    phase.idle = levels(spawn);
    // A ground spawn must not produce touchdown chirps.
    expect(spawn.frames.flatMap((x) => x.messages)).toHaveLength(0);
    c.throttle = 1;
    phase.fullPower = levels(f.record('static', 2.5));
    c.parkingBrake = false;
    phase.roll = levels(f.record('roll', 3));
    f.reset('cruise');
    phase.cruise = levels(f.record('cruise', 2));
    f.reset('final');
    phase.approach = levels(f.record('approach', 2));
    c.flaps = 1;
    phase.flapMotor = levels(f.record('flaps', 2));
    c.throttle = 0;
    f.skip(3);
    const stall = f.record('stall', 5, () => void (c.elevator = 0.7));
    expect(stall.marks.stall.filter(Boolean).length).toBeGreaterThan(60); // the flight model's warning fired
    phase.stall = levels(stall);
  }, 60_000);

  it('never reaches the limiter in normal operation (peaks below -2 dBFS at full volume)', () => {
    for (const [name, l] of Object.entries(phase)) {
      expect(l.intPeak, `${name} interior`).toBeLessThan(-2);
      expect(l.extPeak, `${name} exterior`).toBeLessThan(-2);
    }
  });

  it('cockpit loudness: full power ~ -13 dBFS RMS, idle 12-18 dB quieter, cruise close to full power', () => {
    expect(phase.fullPower.intRms).toBeGreaterThan(-17);
    expect(phase.fullPower.intRms).toBeLessThan(-9);
    const idleDrop = phase.fullPower.intRms - phase.idle.intRms;
    expect(idleDrop).toBeGreaterThan(12);
    expect(idleDrop).toBeLessThan(18);
    expect(Math.abs(phase.cruise.intRms - phase.fullPower.intRms)).toBeLessThan(3);
    expect(phase.approach.intRms).toBeLessThan(phase.cruise.intRms - 2);
  });

  it('ground roll, flap motor and stall horn are audible', () => {
    // Tyre noise on the runway: airframe stem rises from standstill to the roll.
    expect(stemDb(phase.roll, STEM.airframe) - stemDb(phase.fullPower, STEM.airframe)).toBeGreaterThan(12);
    // Flap motor: the cabin stem rises while the flaps travel (20 -> 30 degrees takes ~3.3 s).
    expect(stemDb(phase.flapMotor, STEM.cabin) - stemDb(phase.approach, STEM.cabin)).toBeGreaterThan(8);
    // Stall horn: the 2-3.5 kHz band stands out in the cockpit.
    expect(hornBand(phase.stall) - hornBand(phase.approach)).toBeGreaterThan(12);
  });

  it('start-up and shut-down follow the engine', () => {
    f.reset('apron');
    const cold = levels(f.record('cold', 0.6), 0.1);
    expect(stemDb(cold, STEM.engine, 0.1)).toBeLessThan(-100);
    c.masterBattery = c.alternator = true;
    c.mixture = 1;
    c.throttle = 0.1;
    c.magnetos = 3;
    c.starter = true;
    const start = f.record('start', 4, (t) => void (t > 3 && (c.starter = false)));
    expect(f.physics.state.engine.running).toBe(true);
    const s = levels(start, 0.1);
    // Cranking (starter whine and compression chug) before the engine fires, louder once it runs.
    expect(stemDb(s, STEM.engine, 0.2, 1)).toBeGreaterThan(-45);
    expect(stemDb(s, STEM.engine, 3, 4)).toBeGreaterThan(stemDb(s, STEM.engine, 0.2, 1));
    expect(s.intPeak).toBeLessThan(-3);
    c.mixture = 0;
    const stop = levels(f.record('stop', 6), 0.1);
    expect(stemDb(stop, STEM.engine, 5, 6)).toBeLessThan(stemDb(stop, STEM.engine, 0.1, 0.6) - 30);
  }, 30_000);

  it('touchdown chirps come from the real touchdown events, scaled by sink rate', () => {
    f.reset('runway');
    const fm = f.physics.fm;
    const s = f.physics.state;
    const d = runwayDirection();
    const v = 55 * KT;
    fm.setKinematics({
      position: { x: s.position.x, y: s.position.y, z: -(AIRPORT.elevation + 1.25 + 1.2) },
      orientation: quat.fromEuler(0, 4 * (Math.PI / 180), AIRPORT.runway.heading),
      velocity: { x: d.x * v, y: d.y * v, z: 1.0 },
      angularVelocity: { x: 0, y: 0, z: 0 },
    });
    c.throttle = 0;
    c.parkingBrake = false;
    const rec = f.record('touchdown', 3, () => void (c.elevator = 0.4)); // hold the nosewheel off
    expect(s.crashed).toBe(false);
    const chirps = rec.frames.flatMap((x) => x.messages) as { type: string; amp: number }[];
    expect(chirps.length).toBeGreaterThanOrEqual(2);
    expect(chirps.map((m) => m.type)).not.toContain('crash');
    expect(Math.max(...chirps.map((m) => m.amp))).toBeGreaterThan(0.4); // 1 m/s sink is a firm arrival
    const l = levels(rec, 0.1);
    expect(l.intPeak).toBeLessThan(-3);
  }, 30_000);
});
