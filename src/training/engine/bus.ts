// The training event bus: a typed, sequence-numbered log of TrainingEventMap events for one run. Predicates
// scan it from a step mark (TrainingEventLog); the grader, coach, trace recorder and UI subscribe.
//
// Sequence numbers start at 0 and only ever increase, also across clear() and trim(): a mark taken before a
// clear can never see events emitted after it as "old", and an `event` predicate's incremental scan
// (predicates.ts) stays valid across a checkpoint restore.

import type { TrainingEventLog, TrainingEventMap, TrainingEventName, TrainingEventRecord } from '../types';

type AnyHandler = (r: TrainingEventRecord) => void;

export class TrainingBus implements TrainingEventLog {
  /** Records still held, oldest first; `log[i].seq === base + i`. */
  private log: TrainingEventRecord[] = [];
  /** Seq of log[0] (the next seq when the log is empty). */
  private base = 0;
  private readonly handlers = new Map<TrainingEventName | '*', Set<AnyHandler>>();

  /** Append an event at run sim time `simT` and notify subscribers synchronously. */
  emit<K extends TrainingEventName>(type: K, data: TrainingEventMap[K], simT: number): TrainingEventRecord<K> {
    const rec: TrainingEventRecord<K> = { seq: this.base + this.log.length, type, data, simT };
    this.log.push(rec as TrainingEventRecord);
    // Snapshot the handler sets so a handler that unsubscribes (or subscribes) during dispatch is safe.
    // A handler may emit further events: they are appended (and dispatched) before this call returns.
    for (const key of [type, '*'] as const) {
      const set = this.handlers.get(key);
      if (set) for (const h of [...set]) h(rec as TrainingEventRecord);
    }
    return rec;
  }

  /** Subscribe to one event type ('*' for all); returns the unsubscribe function. */
  on<K extends TrainingEventName>(type: K | '*', handler: (r: TrainingEventRecord<K>) => void): () => void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    const h = handler as unknown as AnyHandler;
    set.add(h);
    return () => {
      set.delete(h);
    };
  }

  mark(): number {
    return this.base + this.log.length;
  }

  since(mark: number): readonly TrainingEventRecord[] {
    const i = Math.max(0, Math.ceil(mark) - this.base);
    return i === 0 ? this.log.slice() : this.log.slice(i);
  }

  /** Forget events older than `mark` (the runner trims at step entry; keeps memory bounded). */
  trim(mark: number): void {
    const n = Math.min(this.log.length, Math.max(0, Math.floor(mark) - this.base));
    if (n === 0) return;
    this.log = this.log.slice(n);
    this.base += n;
  }

  /** Drop everything (new run, checkpoint restore). Sequence numbers keep increasing. */
  clear(): void {
    this.base += this.log.length;
    this.log = [];
  }

  /** Number of records currently held (tests and diagnostics). */
  get size(): number {
    return this.log.length;
  }
}
