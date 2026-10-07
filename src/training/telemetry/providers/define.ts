// Compact signal tables for the providers: one tuple per signal instead of a six-field object literal.

import type { SignalDef, SignalId, SignalKind } from '../../types';

/** [id, kind, unit, hyst, describe, rateTau?] */
export type SignalRow = readonly [SignalId, SignalKind, string, number, string, number?];

export function defineSignals(rows: readonly SignalRow[]): readonly SignalDef[] {
  return Object.freeze(
    rows.map(([id, kind, unit, hyst, describe, rateTau]) =>
      Object.freeze(rateTau === undefined ? { id, kind, unit, hyst, describe } : { id, kind, unit, hyst, describe, rateTau }),
    ),
  );
}
