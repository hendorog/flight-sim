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
  private lastSetup: WorkerSetup | null = null;
  private disposed = false;
  private nextId = 1;
  /** Jobs each worker may hold at once (one running, one queued keeps them busy between messages). */
  private readonly depth = 2;

  constructor(size: number) {
    for (let i = 0; i < size; i++) {
      this.load.push(0);
      this.workers.push(this.spawnWorker(i));
    }
  }

  private spawnWorker(index: number): Worker {
    const w = new Worker(new URL('./terrainWorker.ts', import.meta.url), { type: 'module', name: `terrain-${index}` });
    w.onmessage = (e: MessageEvent<{ id: number; result?: WorkerResult; error?: string }>) => {
      if (e.data.error !== undefined) this.failJob(e.data.id, new Error(e.data.error));
      else this.finish(e.data.id, e.data.result!);
    };
    w.onerror = (e) => {
      e.preventDefault?.();
      this.failWorker(index, e.message || 'worker uncaught error');
    };
    w.onmessageerror = () => {
      this.failWorker(index, 'worker message deserialization error');
    };
    if (this.lastSetup) w.postMessage(this.lastSetup);
    return w;
  }

  get freeSlots(): number {
    let free = 0;
    for (const l of this.load) free += this.depth - l;
    return free;
  }

  /** Workers in the pool. */
  get size(): number {
    return this.workers.length;
  }

  get busy(): boolean {
    return this.pending.size > 0;
  }

  /** Send shared settings to every worker; messages are ordered, so later jobs see them. */
  broadcast(setup: WorkerSetup): void {
    this.lastSetup = setup;
    for (const w of this.workers) w.postMessage(setup);
  }

  /** Run a job on the least loaded worker, or on worker `prefer` (negative: from the last) while it has a free slot (a job that reuses what that
   * worker kept from the last one: rills.ts's raster blocks). */
  run(job: WorkerJob, prefer?: number): Promise<WorkerResult> {
    let best = 0;
    for (let i = 1; i < this.workers.length; i++) if (this.load[i] < this.load[best]) best = i;
    if (prefer !== undefined) {
      const n = this.workers.length;
      const w = ((prefer % n) + n) % n;
      if (this.load[w] < this.depth) best = w;
    }
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
    this.load[p.worker] = Math.max(0, this.load[p.worker] - 1);
    p.resolve(result);
  }

  private failJob(id: number, err: unknown): void {
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    this.load[p.worker] = Math.max(0, this.load[p.worker] - 1);
    p.reject(err);
  }

  private failWorker(index: number, reason: string): void {
    if (this.disposed) return;
    console.warn(`[terrain] worker ${index} failed (${reason}); respawning`);
    try {
      this.workers[index]?.terminate();
    } catch {
      // ignore termination failure
    }
    this.load[index] = 0;
    const failed: Array<Pending & { worker: number }> = [];
    for (const [id, p] of this.pending) {
      if (p.worker === index) {
        this.pending.delete(id);
        failed.push(p);
      }
    }
    this.workers[index] = this.spawnWorker(index);
    const err = new Error(reason);
    for (const p of failed) p.reject(err);
  }

  dispose(): void {
    this.disposed = true;
    for (const w of this.workers) w.terminate();
    for (const p of this.pending.values()) p.reject(new Error('worker pool disposed'));
    this.pending.clear();
  }
}
