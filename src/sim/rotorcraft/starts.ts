// Scenery placement for the live flights. Starts and weather are shared with the app integration tests;
// the original sea-level acceptance fixtures still exercise the same pilot independently of terrain.
import { KT } from '../../core/math';
import { defaultWeather, type Environment, type WeatherSettings } from '../../core/types';
import { AIRPORT, runwayThreshold, runwayDirection } from '../../core/world';
import { SKID_Z } from '../../aircraft/r22/dimensions';
import { PARKING } from '../../world/airport/layout';
import type { Scenario } from '../scenarios';
import { DEMO_TITLES, type R22DemoId } from './flights';

export function demoWeather(): WeatherSettings {
  return { ...defaultWeather(), windSpeedKt: 0, gustKt: 0, turbulence: 0, isaDeviation: 0,
    qnhHpa: 1013.25, cloudCover: 0, cirrusCover: 0 };
}

export function demoScenario(id: R22DemoId, env: Environment): Scenario {
  const cold = id === 'startup' || id === 'circuit';
  const thr = runwayThreshold(0), dir = runwayDirection();
  const along = id === 'autorotation' ? -850 : id === 'approach' ? -250 : 300;
  const north = cold ? PARKING.north : thr.x + dir.x * along;
  const east = cold ? PARKING.east : thr.y + dir.y * along;
  const ground = env.groundElevation(north, east);
  const height = cold ? 0 : id === 'autorotation' ? 350 : id === 'approach' ? 90 : 3 + SKID_Z;
  return {
    id: cold ? 'apron' : id === 'hover' ? 'runway' : 'cruise', title: DEMO_TITLES[id], payload: 'maxGross',
    ic: { position: { x: north, y: east, z: -ground - height }, heading: AIRPORT.runway.heading,
      airspeed: (id === 'autorotation' ? 65 : id === 'approach' ? 60 : 0) * KT,
      onGround: cold, engineRunning: !cold, fuelFraction: 1 },
    autoflight: { kind: 'parked' },
  };
}
