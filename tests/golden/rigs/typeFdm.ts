// FROZEN rig of the type goldens (see README.md): the scripted-flight rig of fdm.ts for the flight model of any
// definition, taken from the definition branch of tests/fdm/helpers.ts on 2026-10-07. Do not "improve" it: the
// loading, the frame length and the calm weather are part of the recorded numbers.

import type { AircraftDefinition, MassDef } from '../../../src/aircraft/types';
import { FT, KT } from '../../../src/core/math';
import { copyControls, defaultControls, type ControlInputs, type InitialConditions } from '../../../src/core/types';
import { BladeElementFlightModel, type SimEnvironment } from '../../../src/physics';
import { ELEVATION, at, flatEnvironment } from './fdm';

export interface TypeRig {
  fm: BladeElementFlightModel;
  env: SimEnvironment;
  controls: ControlInputs;
}

/** `def`'s flight model at its named loading (default 'maxGross'), on flat ground in calm ISA. */
export function makeTypeRig(def: AircraftDefinition, loading: keyof MassDef['loadings'] = 'maxGross'): TypeRig {
  const l = def.mass.loadings[loading];
  const fm = new BladeElementFlightModel(def, { payload: l.payload, payloadPosition: l.payloadPosition });
  // One per-engine entry per engine of the type, and the type's own control defaults (fuel selector).
  return { fm, env: flatEnvironment(), controls: defaultControls(def) };
}

/** Reset and copy the trimmed controls into the rig's controls. Defaults: 1000 ft AGL, 100 KTAS, heading north. */
export function resetTypeTo(rig: TypeRig, ic: Partial<InitialConditions> = {}): void {
  const full: InitialConditions = {
    position: at(ELEVATION + 1000 * FT),
    heading: 0,
    airspeed: 100 * KT,
    onGround: false,
    engineRunning: true,
    ...ic,
  };
  rig.fm.reset(full, rig.env);
  copyControls(rig.controls, rig.fm.trimControls);
}
