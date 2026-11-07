// The model worker: works out a seeded world's macro model cells (erosion.ts steadyLattice, about 0.6 s here) and the
// mountains' threshold hillslopes on the fine grid (hillslopes.ts, about 1 s) once, so the main thread and the terrain
// workers need not (macroCache.ts hands them on). It builds nothing else.

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
  const moved: ArrayBuffer[] = model ? [model.lattice.buffer as ArrayBuffer] : [];
  if (model?.slopes) moved.push(model.slopes.h.buffer as ArrayBuffer, model.slopes.w.buffer as ArrayBuffer, model.slopes.chan.buffer as ArrayBuffer, model.slopes.core.buffer as ArrayBuffer);
  (self as unknown as Worker).postMessage(reply, moved);
};
