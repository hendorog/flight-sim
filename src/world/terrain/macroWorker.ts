// The model worker: works out a seeded world's macro model cells (erosion.ts steadyLattice, about 0.6 s here) once,
// so the main thread and the terrain workers need not (macroCache.ts hands them on). It builds nothing else.

import { setEra } from '../era/eraState';
import type { EraId } from '../era/types';
import { computeSeededModel, type SeededModel } from './heightfield';

export type ModelRequest = { seed: number; era: EraId };
export type ModelReply = { model: SeededModel | null; ms: number };

self.onmessage = (e: MessageEvent<ModelRequest>) => {
  const t0 = performance.now();
  setEra(e.data.era);
  const model = computeSeededModel(e.data.seed);
  const reply: ModelReply = { model, ms: performance.now() - t0 };
  (self as unknown as Worker).postMessage(reply, model ? [model.lattice.buffer] : []);
};
