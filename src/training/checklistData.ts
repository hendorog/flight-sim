// Optional presentation metadata on the existing school checklist contract. Procedures remain plain data;
// `live` is an audited check for the free-flight panel, independent of lesson grading / acknowledgements.
import type { ChecklistDef, ChecklistItem, Pred } from './types';

export interface FlightChecklistItem extends ChecklistItem {
  live?: Pred | null;
}
export interface FlightChecklist extends ChecklistDef {
  items: FlightChecklistItem[];
  category?: 'normal' | 'emergency';
  source?: string;
  sourceUrl?: string;
  note?: string;
}

export function checkItem(id: string, challenge: string, response: string, live: Pred | null = null): FlightChecklistItem {
  return { id, challenge, response, state: null, live, control: null, key: null,
    why: { text: 'Use the cited POH procedure; confirm any inspection or judgement manually.' } };
}

export function checklist(id: string, title: string, items: FlightChecklistItem[],
  meta: Omit<FlightChecklist, 'id' | 'title' | 'items'> = {}): FlightChecklist {
  return { id, title, items, ...meta };
}

/** Keep the existing school lists and keys intact while attaching their shared POH citation. */
export function citeChecklists<T extends Record<string, ChecklistDef>>(lists: T, source: { source: string; sourceUrl: string }): T {
  const result = { ...lists };
  for (const id in result) result[id] = { ...source, ...result[id] };
  return result;
}
