// A fixed pool of tile workers. Callers decide priorities and only submit as many jobs as `freeSlots`
// allows, so the most important work (nearest, in view) always goes first.

import type { WorkerJob, WorkerResult, WorkerSetup } from './terrainWorker';

interface Pending {
  resolve: (r: WorkerResult) => void;
  reject: (e: unknown) => void;
}

export class WorkerPool {
  private readonly workers: Worker[] = [];
  private readonly load: number[] = [];
  private readonly pending = new Map<number, Pending & { worker: number }>();
  private nextId = 1;
  /** Jobs each worker may hold at once (one running, one queued keeps them busy between messages). */
  private readonly depth = 2;

  constructor(size: number) {
    for (let i = 0; i < size; i++) {
      const w = new Worker(new URL('./terrainWorker.ts', import.meta.url), { type: 'module', name: `terrain-${i}` });
      w.onmessage = (e: MessageEvent<{ id: number; result: WorkerResult }>) => this.finish(e.data.id, e.data.result);
      w.onerror = (e) => console.error('[terrain] worker error', e.message);
      this.workers.push(w);
      this.load.push(0);
    }
  }

  get freeSlots(): number {
    let free = 0;
    for (const l of this.load) free += this.depth - l;
    return free;
  }

  get busy(): boolean {
    return this.pending.size > 0;
  }

  /** Send shared settings to every worker; messages are ordered, so later jobs see them. */
  broadcast(setup: WorkerSetup): void {
    for (const w of this.workers) w.postMessage(setup);
  }

  run(job: WorkerJob): Promise<WorkerResult> {
    let best = 0;
    for (let i = 1; i < this.workers.length; i++) if (this.load[i] < this.load[best]) best = i;
    const id = this.nextId++;
    this.load[best]++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, worker: best });
      this.workers[best].postMessage({ id, job });
    });
  }

  private finish(id: number, result: WorkerResult): void {
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    this.load[p.worker]--;
    p.resolve(result);
  }

  dispose(): void {
    for (const w of this.workers) w.terminate();
    for (const p of this.pending.values()) p.reject(new Error('worker pool disposed'));
    this.pending.clear();
  }
}
