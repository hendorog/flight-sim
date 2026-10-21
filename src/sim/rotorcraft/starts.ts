// Scenery placement for the live flights. Starts and weather are shared with the app integration tests;
// the original sea-level acceptance fixtures still exercise the same pilot independently of terrain.
import { KT } from '../../core/math';
import { defaultWeather, type Environment, type WeatherSettings } from '../../core/types';
import { AIRPORT, runwayThreshold, runwayDirection } from '../../core/world';
import { R22_ROTORCRAFT } from '../../aircraft/r22/rotorcraft';
import type { RotorcraftDefinition } from '../../physics/rotorcraft/definition';
import { PARKING } from '../../world/airport/layout';
import type { Scenario } from '../scenarios';
import { DEMO_TITLES, type R22DemoId } from './flights';

export function demoWeather(): WeatherSettings {
  return { ...defaultWeather(), windSpeedKt: 0, gustKt: 0, turbulence: 0, isaDeviation: 0,
    qnhHpa: 1013.25, cloudCover: 0, cirrusCover: 0 };
}

export function demoScenario(id: R22DemoId, env: Environment, d: Pick<RotorcraftDefinition, 'skids'> = R22_ROTORCRAFT): Scenario {
  const cold = id === 'startup' || id === 'circuit';
  const thr = runwayThreshold(0), dir = runwayDirection();
  const along = id === 'autorotation' ? -850 : id === 'approach' ? -250 : 300;
  const north = cold ? PARKING.north : thr.x + dir.x * along;
  const east = cold ? PARKING.east : thr.y + dir.y * along;
  const ground = env.groundElevation(north, east);
  const height = cold ? 0 : id === 'autorotation' ? 350 : id === 'approach' ? 90 : 3 + d.skids.z;
  return {
    id: cold ? 'apron' : id === 'hover' ? 'runway' : 'cruise', title: DEMO_TITLES[id], payload: 'maxGross',
    ic: { position: { x: north, y: east, z: -ground - height }, heading: AIRPORT.runway.heading,
      airspeed: (id === 'autorotation' ? 65 : id === 'approach' ? 60 : 0) * KT,
      onGround: cold, engineRunning: !cold, fuelFraction: 1 },
    autoflight: { kind: 'parked' },
  };
}

/** Opt-in airborne start for trying helicopter hold; no demonstration pilot. A wheeled rotorcraft (AH-56A: retractable
 *  gear) hovers with its gear down; `skids.z` is its tyre contact at rest, so the 15 m is to the wheels. A control-gyro
 *  type (AH-56A) hovers at its 'typical' loading (18,300 lb, the AMCS test weight its gyro and hover rows are measured
 *  at; 'maxGross' is the ICS release's 20,500 lb, above the AMCS's 19,200 lb); the others keep 'maxGross'. */
export function hoverScenario(env: Environment, d: Pick<RotorcraftDefinition, 'skids' | 'landingGear' | 'controlGyro'>): Scenario {
  const sc = demoScenario('hover', env, d);
  return { ...sc, title: 'Helicopter hold test · 15 m hover', ...(d.controlGyro ? { payload: 'typical' as const } : {}),
    ic: { ...sc.ic, position: { ...sc.ic.position, z: sc.ic.position.z - 12 },
      ...(d.landingGear === 'wheels' ? { gearDown: true } : {}) } };
}
