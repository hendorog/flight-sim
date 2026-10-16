// The per-type hook of the dev instruments page: src/aircraft/<id>/devMock.ts exports `devMock`, which the page
// calls after its generic scripted mock flight, so a type can fill readings the generic mock does not know
// (turboshaft N1/N2/TOT/torque, beta and reverse). Types only: an aircraft file may import this.
import type { AircraftDefinition } from '../aircraft/types';
import type { AircraftState, ControlInputs } from '../core/types';

/** Writes mock readings into `s` / `c` for mock-flight time `t`, s. */
export type DevMock = (s: AircraftState, c: ControlInputs, t: number, aircraft: AircraftDefinition | undefined) => void;
