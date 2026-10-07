// Test-bed pieces of the instruments area for the later stages: the two synthetic panels (twin piston, FADEC
// diesel twin) with their instrument systems and the low panel face they fit, a mock state of two engines with
// retractable gear, and a stepping helper.

import { makeMockState, type MockStateOptions } from '../../src/core/mockState';
import { defaultControls, defaultWeather, type AircraftState, type ControlInputs } from '../../src/core/types';
import type { InstrumentSet } from '../../src/instruments/dynamics/instrumentSet';

export {
  FADEC_TESTBED_PANEL,
  FADEC_TESTBED_SYSTEMS,
  TESTBED_PX_RECT,
  TWIN_TESTBED_PANEL,
  TWIN_TESTBED_SYSTEMS,
} from '../../src/instruments/panels/testbed';

/** A mock state of two engines and two alternators, the gear retractable, down and locked. */
export function twinState(o: MockStateOptions = {}): AircraftState {
  const s = makeMockState({ ...o, engines: 2 });
  s.electrical.alternators[1] = s.electrical.alternators[0];
  s.electrical.alternatorAmps = s.electrical.alternators[0];
  s.gear = { retractable: true, lever: 'down', extension: [1, 1, 1], locked: [true, true, true], inTransit: false, warning: false };
  return s;
}

/** The controls of a twin: one (empty) override record per engine. */
export const twinControls = (): ControlInputs => defaultControls({ engineCount: 2, controlDefaults: {} });

const WEATHER = defaultWeather();

/** Step an instrument set for `seconds` of an unchanging state. */
export function run(set: InstrumentSet, seconds: number, s: AircraftState, c: ControlInputs = twinControls(), dt = 1 / 60): void {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) set.step(dt, s, c, WEATHER);
}
