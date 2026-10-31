// The Career's block in the resume snapshot (FlightSnapshot.career, opaque to src/sim/resume.ts; docs/career.md
// "Persistence, boot and reloads"). The block only names the job and the airframe and carries the job runtime's
// own monitor state; the payload is never in it (the store's `active.loading` is the only copy), so a block
// written by an older build with a `loading` field loses that field here, like every other unknown field.
//
// The monitor is passed through untouched: its owner (the job runtime's JobMonitor) validates it, and a malformed
// one resumes the flight with a fresh monitor rather than losing the job. Pure: no storage, no DOM.

import type { CareerResumeBlock } from './types';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isId = (v: unknown): v is string => typeof v === 'string' && v !== '';

/**
 * FlightSnapshot.career rebuilt as exactly `{ v, jobId, aircraftUid, monitor }`; null when absent or invalid
 * (not an object, `v !== 1`, or a missing or empty `jobId` or `aircraftUid`). An absent monitor becomes null.
 */
export function validateCareerBlock(v: unknown): CareerResumeBlock | null {
  if (!isObj(v) || v.v !== 1 || !isId(v.jobId) || !isId(v.aircraftUid)) return null;
  return { v: 1, jobId: v.jobId, aircraftUid: v.aircraftUid, monitor: v.monitor ?? null };
}
