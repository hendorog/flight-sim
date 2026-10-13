// The era of this thread (the townMask.ts pattern): one module-level value, set once at boot, read on hot paths
// without allocation or lookup. See types.ts for who sets it and when.
//
//   setEra(id)   main thread: Simulator constructor (from eraChoice.ts), right after parseParams.
//                terrain workers: terrainWorker.ts on the setup message, before setTownSite and any job.
//                dev pages: src/dev/harness.ts from ?era=.  node tests: directly (restore 'present' after).
//   era()        the current EraParams (PRESENT until set).
//   isPresent()  the present day: take today's code path verbatim.
//
// Pure (no three.js, no DOM).

import { PRESENT } from './present';
import { eraById } from './registry';
import type { EraParams } from './types';

let E: EraParams = PRESENT;

/** The era this thread is set in. */
export const era = (): EraParams => E;

/** True in the present day (the default). */
export const isPresent = (): boolean => E.id === 'present';

/**
 * Set this thread's era. Unknown ids (and null / undefined) are the present day. Idempotent; returns the era set.
 * Call it before anything era-dependent is built: nothing rebuilds when it changes.
 */
export function setEra(id: unknown): EraParams {
  E = eraById(id);
  return E;
}
