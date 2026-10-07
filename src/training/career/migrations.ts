// Career file migrations (section 3.11). MIGRATIONS[n] upgrades a schema-n file to n + 1; the store writes
// `fs.training.v1.backup.s<n>` before running them. Schema 1 is current, so the table is empty.

export const TRAINING_SCHEMA = 1;

export const MIGRATIONS: Readonly<Record<number, (v: Record<string, unknown>) => Record<string, unknown>>> = {};

/** Run the migrations from `from` up to TRAINING_SCHEMA. Returns the migrated object (not yet validated). */
export function migrate(v: Record<string, unknown>, from: number): Record<string, unknown> {
  let out = v;
  for (let n = from; n < TRAINING_SCHEMA; n++) {
    const m = MIGRATIONS[n];
    if (!m) throw new Error(`no migration from training schema ${n}`);
    out = { ...m(out), schema: n + 1 };
  }
  return out;
}

