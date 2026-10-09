// Raven II IO-540-AE1A5. Published installed ratings/geometry, with estimated induction and heat paths.
// The IO-360 supplies generic Lycoming combustion/friction laws, not the R22 carburetted installation.
import { C172_ENGINE, C172_POWERPLANT, C172_PROPELLER } from '../../physics/propulsion/c172Powerplant';
import type { EngineDef, PowerplantDef } from '../../physics/propulsion/defs';
import { LB } from '../../core/math';
import { R44_REFERENCE as V } from './reference';
import { R44_FUEL_CAPACITY } from './mass';

const displacement = 541.5 * 0.000016387064;
const scale = displacement / C172_ENGINE.displacement;
const GPH = 6 * LB / 3600;
export const R44_ENGINE: EngineDef = {
  ...C172_ENGINE, name: 'Lycoming IO-540-AE1A5 (installed derating)',
  // POH 1-5/2-2: six cylinders, 245 hp for five minutes; MM 6.002 says capable of 300 hp.
  // Do not calibrate WOT to the installed rating: the pilot limits MAP, not an artificial torque cap.
  // Lycoming PC-IO-540-AE1A5 (Oct 2025), 72-30 p23: 14D23908 pistons, 8.70:1.
  cylinders: 6, displacement, compressionRatio: 8.7, ratedPower: V.takeoffPower, ratedRpm: 2718,
  // POH 2-9 SL/15 C interpolation at 102%; independent TOP check uses MCP MAP + 2.8 inHg.
  calibration: { power: V.continuousPower, rpm: 2718, manifoldPressure: 22.75 * 3386.389 },
  airStartRpm: V.engineRpm100 * 1.015, groundStartRpm: V.engineRpm100 * 1.015,
  // ESTIMATES: crank/fan inertia and low-speed resistance scaled from the 360 cubic-inch engine.
  rotatingInertia: 0.8, compressionLossTorque: 30 * scale, breakawayTorque: 60 * scale,
  // 24 V starter, not the R22's 12 V motor. Electrical motor constants are estimates.
  starter: { k: 0.00145 * scale, r: 0.072 },
  induction: { ...C172_ENGINE.induction, carburettor: undefined,
    // ESTIMATES: equal flow speed through a larger filter and throttle, equal exhaust back pressure.
    inletArea: C172_ENGINE.induction.inletArea * scale,
    throttleBoreArea: C172_ENGINE.induction.throttleBoreArea * scale,
    exhaustCoeff: C172_ENGINE.induction.exhaustCoeff / scale ** 2,
    idleArea: 0.000028, ramRecovery: 0.1 },
  // Full-rich operation, POH 4. Enrichment and 7.5 GPH static priming flow are estimates;
  // the latter scales the existing IO-360 priming model to six ports, not a published flow measurement.
  metering: { kind: 'rsaInjection', fullRichPhi: 1.15, leanestFraction: 0.35, primeFlow: 7.5 * GPH },
  thermal: { ...C172_ENGINE.thermal,
    headCapacity: C172_ENGINE.thermal.headCapacity * scale,
    headConductance: C172_ENGINE.thermal.headConductance * scale,
    oilCapacity: C172_ENGINE.thermal.oilCapacity * scale,
    oilCoolerConductance: C172_ENGINE.thermal.oilCoolerConductance * scale,
    crankcaseConductance: C172_ENGINE.thermal.crankcaseConductance * scale,
    // Mid-flight oil pressure, not the POH red lines (55–95 psi; 115 psi cold).
    oilReliefPsi: 85, oilColdOverdrivePsi: 30 },
};

export const R44_POWERPLANT: PowerplantDef = {
  engines: [{ engine: R44_ENGINE, hub: { x: 0, y: 0, z: 0 }, rotation: 1,
    // Compatibility carrier: the external-drive path disables propeller aerodynamics.
    propeller: { ...C172_PROPELLER, inertia: 0.05 } }],
  fuel: { tanks: [
    // POH 6-4 arms about the 100 in mast datum; vertical locations remain estimates.
    { id: 'main', side: 'left', capacity: R44_FUEL_CAPACITY[0], position: { x: -6 * 0.0254, y: -13.5 * 0.0254, z: -0.1 } },
    { id: 'aux', side: 'right', capacity: R44_FUEL_CAPACITY[1], position: { x: -2 * 0.0254, y: 13 * 0.0254, z: -0.1 } },
  ], feeds: [{ ...C172_POWERPLANT.fuel.feeds[0], positions: { on: [0, 1], both: [0, 1] },
    // Mechanical + electric pump, POH 7-10. Pressures/volumes are engineering estimates.
    // Shared input still switches the electric pump manually; clutch/oil-pressure automation is absent.
    lineCapacity: 0.225, lineUnusable: 0.0225,
    enginePump: { psi: 25 }, auxPump: { psi: 25, minVolts: 18 },
    delivery: { kind: 'injector', capacity: 0.054, openPsi: 1, fullPsi: 4 },
    film: { fraction: 0.3, time: 0.35, cold: {
      temperatureC: [-20, 0, 15, 40, 70], fraction: [0.92, 0.86, 0.78, 0.6, 0.3],
      time: [55, 32, 25, 6, 0.35], capacity: 0.045,
    } },
  }] },
  // POH 7-13: 28 V. Capacity, regulator, alternator and current loads remain estimates.
  electrical: { ...C172_POWERPLANT.electrical,
    loads: { ...C172_POWERPLANT.electrical.loads, avionics: 4, fuelPump: 3 } },
};
