// Richard Pearse 1903 Monoplane: powerplant definition.
//
// Wing-leading-edge mounted horizontally-opposed 2-cylinder double-acting petrol engine (~24 hp at 1150 rpm) driving
// Pearse's two-vane diamond-paddle airscrew directly on the forward shaft, gravity-fed from the cylindrical petrol tank
// mounted atop the centre wing. Plain data.

import { DEG, HP, LB } from '../../core/math';
import { C172_BLADE_SECTION, C172_ENGINE, C172_PROPELLER } from '../../physics/propulsion/c172Powerplant';
import { AVGAS_100LL, type BladeSectionDef, type EngineDef, type PowerplantDef, type PropellerDef } from '../../physics/propulsion/defs';
import { PEARSE_GEOMETRY } from './geometry';

const INCH = 0.0254;
const GPH = (3.785411784e-3 * AVGAS_100LL.density) / 3600;
const PROP = PEARSE_GEOMETRY.propellers[0];

export const PEARSE_ENGINE: EngineDef = {
  ...C172_ENGINE,
  name: 'Pearse 2-cyl Double-Acting Horizontal Twin (24 hp)',
  cylinders: 4,
  ratedPower: 24 * HP,
  ratedRpm: 1150,
  idleRpm: 450,
  displacement: 3.8e-3,
  compressionRatio: 4.6,
  induction: {
    ...C172_ENGINE.induction,
    throttleBoreArea: Math.PI * 0.019 * 0.019,
    idleArea: undefined,
    inletArea: 0.65e-3,
    exhaustCoeff: 2.8e5,
    inductionHeating: 4,
    ramRecovery: 0.15,
    veReferenceT: 288.15 + 4,
    veRpm: [0, 400, 750, 1000, 1150, 1450],
    ve: [0.72, 0.78, 0.82, 0.81, 0.79, 0.7],
    carburettor: undefined,
  },
  metering: { kind: 'floatCarburettor', takeoffFuelFlow: 2.6 * GPH, leanestFraction: 0.35 },
  ignition: {
    kind: 'magnetos',
    minFiringRpm: 65,
    singleLoss: 0.06,
    singleDilutionLoss: 1.5,
    dilutionSensitivity: 1.1,
  },
  thermal: {
    ...C172_ENGINE.thermal,
    headCapacity: 18e3,
    headConductance: 95,
    referenceMassFlux: 28,
    oilCapacity: 14e3,
    oilCoolerConductance: 45,
    crankcaseConductance: 12,
    oilPsiPerRpm: 0.045,
    oilReliefPsi: 45,
    cowlFlapClosedFactor: 1,
    warm: { egt: 540, cht: 145, oilTemp: 72, oilPressure: 36 },
  },
  fmep: [0.32e5, 0.08e5, 0.04e5],
  coldFrictionFactor: 1.5,
  compressionLossTorque: 12,
  breakawayTorque: 24,
  rotatingInertia: 0.28,
  gearRatio: 1,
  runningRpm: 220,
  airStartRpm: 900,
  groundStartRpm: 460,
  starter: { k: 0.0012, r: 0.045 },
};

const PEARSE_BLADE_SECTION: BladeSectionDef = {
  ...C172_BLADE_SECTION,
  alpha0: -4.2 * DEG,
  clMaxLowSpeed: 1.45,
  clMaxMachLoss: 1.2,
  clMin: -0.8,
  cdMax: 1.5,
  dragDueToLift: 0.028,
};

export const PEARSE_PROPELLER: PropellerDef = {
  ...C172_PROPELLER,
  name: 'Pearse Two-Vane Variable-Pitch Paddle Airscrew',
  diameter: PROP.diameter,
  blades: PROP.blades,
  hubRadius: 0.14,
  stationX: [0.14, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.85, 0.92, 0.97, 1.0],
  chordOverR: [0.05, 0.06, 0.07, 0.09, 0.14, 0.21, 0.26, 0.24, 0.18, 0.12, 0.07],
  thicknessX: [0.14, 0.3, 0.5, 0.75, 1.0],
  thickness: [0.16, 0.10, 0.06, 0.04, 0.03],
  twist: { kind: 'helix', pitch: 65 * INCH },
  section: PEARSE_BLADE_SECTION,
  inertia: 0.72,
  pitchControl: { kind: 'fixed' },
};

const TANK_USABLE = 3.2 * 6.0 * LB;

export const PEARSE_POWERPLANT: PowerplantDef = {
  engines: [{ engine: PEARSE_ENGINE, propeller: PEARSE_PROPELLER, hub: PROP.hub, rotation: PROP.rotation }],
  fuel: {
    tanks: [{ id: 'main', side: 'centre', capacity: TANK_USABLE, position: { x: 0.15, y: 0, z: -1.02 } }],
    feeds: [
      {
        positions: { on: [0], both: [0] },
        gravityHeadPsi: 0.65,
        feedCapacity: 0.025,
        lineCapacity: 0.05,
        lineUnusable: 0.005,
        delivery: { kind: 'carburettorBowl', capacity: 0.04, minHeadPsi: 0.25 },
        film: { fraction: 0.38, time: 0.4 },
      },
    ],
  },
  electrical: {
    nominalVolts: 14,
    regulatorVolts: 14.2,
    battery: {
      capacityAh: 12,
      ocvEmpty: 11.6,
      ocvSpan: 1.3,
      rDischarge: 0.03,
      rChargeBase: 0.09,
      rChargeFull: 1.6,
    },
    alternators: [{ engine: 0, maxAmps: 20, cutInRpm: 320, fullRpm: 750, efficiency: 0.55 }],
    loads: {
      master: 0.8,
      avionics: 0.5,
      nav: 1.2,
      beacon: 0.8,
      strobe: 1.0,
      landing: 2.0,
      taxi: 1.5,
      panelFull: 0.8,
      pitotHeat: 2.0,
      fuelPump: 0,
    },
    lowVoltsLamp: 12.2,
    overVolts: 16,
    busDeadVolts: 9,
  },
};
