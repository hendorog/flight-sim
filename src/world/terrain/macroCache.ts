// A seeded world's macro model cells (erosion.ts steadyLattice) for the main thread, before the Simulator builds the
// world (main.ts): worked out once in one worker (macroWorker.ts) and handed to this thread's build
// (heightfield.ts provideSeededModel); the terrain workers get them in their setup message (TerrainSystem.ts). Seed 0
// has no model. Node (the tests) never comes here: each build works the model out itself, synchronously.

import { provideSeededModel, type SeededModel } from './heightfield';
import type { EraId } from '../era/types';
import type { ModelReply, ModelRequest } from './macroWorker';

/** What prepareSeededModel did, for the automation API and the boot log. */
export interface ModelPrep {
  seed: number;
  source: 'none' | 'worker' | 'failed';
  ms: number;
}
export let modelPrep: ModelPrep = { seed: 0, source: 'none', ms: 0 };

/** Work out the seed's model cells in a worker and hand them to this thread's next build. Never throws. */
export async function prepareSeededModel(seed: number, era: EraId): Promise<ModelPrep> {
  const t0 = performance.now();
  if (seed === 0) return (modelPrep = { seed, source: 'none', ms: 0 });
  try {
    const model = await computeInWorker(seed, era);
    if (model) provideSeededModel(model);
    modelPrep = { seed, source: model ? 'worker' : 'failed', ms: performance.now() - t0 };
  } catch (err) {
    console.warn('[terrain] the model worker failed; the world builds its model itself', err);
    modelPrep = { seed, source: 'failed', ms: performance.now() - t0 };
  }
  return modelPrep;
}

function computeInWorker(seed: number, era: EraId): Promise<SeededModel | null> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./macroWorker.ts', import.meta.url), { type: 'module', name: 'terrain-model' });
    w.onmessage = (e: MessageEvent<ModelReply>) => {
      w.terminate();
      resolve(e.data.model);
    };
    w.onerror = (e) => {
      w.terminate();
      reject(new Error(e.message));
    };
    const req: ModelRequest = { seed, era };
    w.postMessage(req);
  });
}
