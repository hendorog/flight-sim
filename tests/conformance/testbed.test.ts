// The conformance blocks the Cessna 172S cannot exercise, run on the synthetic test-beds of tests/fixtures
// (contract 3.10), so that their first execution is here and not in a Stage D type's file:
//
//   twin       pedal fractions, Vmca by secant, left against right, one-engine climb, windmilling loss, zero-thrust
//              setting, flown engine cut: the counter-rotating, the co-rotating fixed-pitch and the diesel twin
//   systems    magneto and carburettor-heat drops (carburettor test-bed), gear transit and gear-down climb loss
//              (retractable test-bed)
//   castering  parked drift, brake-steered taxi, take-off and landing rolls (castering test-bed)
//   keyboard   keyboard.ts: the circuit and the taxi on the castering test-bed, the engine-out on two twins
//
// The bands are LOOSE and synthetic: the test-beds are C172S airframes with mechanisms switched on, not aircraft,
// so the numbers only have to be physically sensible around what the test-beds measured when this file was written
// (in the comments). A C172S fin against 200 hp 1.9 m out gives a Vmca far above a real light twin's: the twin
// speeds below are those measured on the test-beds at sea level, aft loading (the twin block's condition).
// Quick blocks always run; flown blocks and the keyboard blocks with FS_AIRCRAFT=testbed or all.

import { describe } from 'vitest';
import { CARB_TESTBED, CASTER_TESTBED, DIESEL_TESTBED, RETRACT_TESTBED, TWIN_TESTBED } from '../fixtures/testbeds';
import { keyboardCircuit, keyboardEngineOut, keyboardTaxi } from './keyboard';
import { groundRollBlock, parkedTaxiBlock, systemsBlock, twinBlocks } from './plan';
import { describeBlocks } from './suite';
import { band, below, range, type TwinTargets } from './targets';

/** The FS_AIRCRAFT entry that runs the flown tier of this file. */
const TIER = 'testbed';
const SYNTHETIC = 'synthetic test-bed band';

const CR_CS = TWIN_TESTBED('crCS');
const CO_FP = TWIN_TESTBED('coFP');

/** Loose twin bands for a test-bed with a sea-level Vmca and a Vyse (KCAS). */
function twinTargets(critical: TwinTargets['criticalEngine'], vmca: number, vyse: number, more: Partial<TwinTargets> = {}): TwinTargets {
  return {
    criticalEngine: critical,
    vmcaKcas: vmca,
    vyseKcas: vyse,
    pedalAt110Vmca: range(0.4, 0.9, SYNTHETIC),
    pedalAtVyse: range(0.3, 0.9, SYNTHETIC),
    vmca: band(vmca, 8, SYNTHETIC),
    sides: { vmcaKt: 1, pedal: 0.01, source: 'counter-rotation: the two sides mirror' },
    oeiClimb: [{ altitudeFt: 0, fpm: band(450, 450, SYNTHETIC) }],
    windmillingLossFpm: range(100, 600, SYNTHETIC),
    engineCut: { maxHeadingChangeDeg: below(30, SYNTHETIC), source: SYNTHETIC },
    ...more,
  };
}

describe('conformance blocks on the test-beds', () => {
  // Measured: pedal 0.65 at 110 KCAS either side, Vmca 100.8 rudder-limited either side, OEI 449 fpm, windmilling
  // costs 323 fpm, the zero-thrust setting 137 fpm less than feathered, engine cut 15 deg.
  describe('twin, counter-rotating constant speed', () => {
    const t = twinTargets('none', 100, 110, { zeroThrust: { controls: { throttle: 0.05, propeller: 0.6 }, withinFpm: 300, source: SYNTHETIC } });
    describeBlocks('TWIN_crCS', twinBlocks('TWIN_crCS', t, () => CR_CS), TIER);
  });

  // Measured: pedal at 107.8 KCAS 0.67 left failed / 0.52 right failed, Vmca 98.4 / 92.7, OEI about 0 fpm. A fixed
  // pitch propeller cannot feather: "feathered" and windmilling are the same.
  describe('twin, co-rotating fixed pitch', () => {
    const t = twinTargets('left', 98, 110, {
      vmca: band(95, 8, SYNTHETIC),
      oeiClimb: [{ altitudeFt: 0, fpm: band(0, 200, SYNTHETIC) }],
      windmillingLossFpm: range(-1, 1, 'fixed pitch: no feathering'),
    });
    describeBlocks('TWIN_coFP', twinBlocks('TWIN_coFP', t, () => CO_FP), TIER);
  });

  // Measured: pedal at 112.2 KCAS 0.61 / 0.47, Vmca 100.8 / 94.9, OEI 79 / 66 fpm, windmilling (ENGINE MASTER on,
  // fuel off) costs 349 fpm, the zero-thrust setting 190 fpm more than feathered.
  describe('twin, FADEC diesels', () => {
    const t = twinTargets('left', 102, 115, {
      vmca: band(98, 8, SYNTHETIC),
      oeiClimb: [{ altitudeFt: 0, fpm: band(150, 250, SYNTHETIC) }],
      zeroThrust: { controls: { throttle: 0.1 }, withinFpm: 300, source: SYNTHETIC },
    });
    describeBlocks('DIESEL', twinBlocks('DIESEL', t, () => DIESEL_TESTBED), TIER);
  });

  // Measured: magneto drop 102 rpm each, carburettor heat 158 rpm at full throttle and 92 at 1700 rpm; the gear
  // travels in 6.5 s each way, the gear down costs 65 fpm at 80 KCAS.
  describe('systems', () => {
    const carb = systemsBlock(
      {
        magnetoDrop: { rpm: 1700, drop: range(25, 175, SYNTHETIC), difference: range(0, 50, SYNTHETIC) },
        carbHeat: { runUpRpm: 1700, fullThrottle: range(50, 300, SYNTHETIC), runUp: range(25, 200, SYNTHETIC) },
      },
      () => CARB_TESTBED,
    );
    const retract = systemsBlock({ gearTransit: { kias: 100, up: range(3, 12, SYNTHETIC), down: range(3, 12, SYNTHETIC) }, gearDownClimb: { kcas: 80, lossFpm: range(30, 300, SYNTHETIC) } }, () => RETRACT_TESTBED);
    describeBlocks('CARB', [carb], TIER);
    describeBlocks('RETRACT', [retract], TIER);
  });

  // Measured: parked drift 0.13 mm; taxi brake difference 0.03, heading error 2.0 deg, 10.3 kt, turn radius 5.4 m;
  // take-off roll 373 m, landing roll 169 m.
  describe('castering nosewheel', () => {
    const taxi = parkedTaxiBlock(
      {
        parkedDriftMm: below(5, SYNTHETIC),
        parkedRateDegS: below(0.05, SYNTHETIC),
        taxi: { meanSteer: range(-0.3, 0.3, SYNTHETIC), maxHeadingErrorDeg: below(3, SYNTHETIC), speedKt: band(10, 1.5, SYNTHETIC), radiusM: range(2, 15, SYNTHETIC), maxYawAccelDegS2: below(5, SYNTHETIC) },
      },
      () => CASTER_TESTBED,
    );
    const rolls = groundRollBlock(
      {
        takeoff: { flapDeg: 10, rotateKias: 48, pitchDeg: 8, staticRunUp: true, groundRollM: band(350, 100, SYNTHETIC) },
        landing: { flapDeg: 30, approachKt: 61, touchdownPitchDeg: 7, groundRollM: band(180, 80, SYNTHETIC) },
      },
      () => CASTER_TESTBED,
    );
    describeBlocks('CASTER', [taxi, rolls], TIER);
  });
});

describe('keyboard blocks on the test-beds', () => {
  keyboardCircuit({ aircraft: CASTER_TESTBED, name: 'castering test-bed', tier: TIER });
  keyboardTaxi({ aircraft: CASTER_TESTBED, name: 'castering test-bed', tier: TIER });
  keyboardEngineOut({ aircraft: CR_CS, name: 'twin test-bed, constant speed', tier: TIER });
  // 135 hp on the C172S airframe: one engine only just holds the climb (measured -17 / -38 fpm by the keyboard
  // pilot, 66-79 fpm in the zero-sideslip trim).
  keyboardEngineOut({ aircraft: DIESEL_TESTBED, name: 'diesel twin test-bed', tier: TIER, bands: { climbFpm: -100 } });
});
