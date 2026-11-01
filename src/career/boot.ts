// The Career's boot plan (docs/career.md "Persistence, boot and reloads", the boot table): what the Simulator does
// with the resume snapshot and the Flight School's welcome before decideBoot runs, decided from the career store,
// the snapshot's Career block, the type being booted and the URL. Pure: no storage, no DOM, no physics, so every
// row of the table is a one-line test (tests/career/boot.test.ts).
//
// The rows, first match wins (X = an explicit start in the URL: scenario=, lesson=, demo=, hover= on a helicopter,
// or career=0):
//
//   the Career unavailable here (era)                delete a block if present; nothing else (the default path)
//   X                                                delete; nothing (a placed job not resumed is handled at the
//                                                    next Career open)
//   no career                                        delete a block if present; the hub (locked or create page)
//                                                    if career=1, else nothing
//   store kind not 'local'                           the block is always deleted (only 'local' ever writes one);
//                                                    the rows below decide the rest as if it were missing
//   another world seed                               delete; the hub (seed page) if career=1
//   a pending report (crash, outlanding)             delete; afterBoot settles it, then as "no job" below, but
//                                                    with resumeParam false (the settlement moved the aircraft)
//   placed job, booted type, block matches           keep; resumeParam true (null under resume=0); action resume
//   placed job, booted type, no matching block       delete; resumeParam false; action resume (falls back at once:
//                                                    never airborne or standing at a field -> re-placed there,
//                                                    in the air -> lost)
//   placed job, other type                           delete; the hub if career=1 (afterBoot settles an airborne
//                                                    one as lost and shows a grounded one waiting)
//   unplaced job, booted type                        delete; resumeParam false (this type's stale snapshot and its
//                                                    lesson are ignored); action place
//   unplaced job, other type                         delete; the hub if career=1
//   in Career, no job, selected type booted          delete; action placeSelected (nothing if the boot resumed)
//   otherwise                                        delete; the hub if career=1
//
// trainingExplicit (the Career takes the boot: no school home or welcome card) is true wherever the Career acts
// at this boot and, on the hub-only rows, when career=1 asked for it. `explicit` (contract addition, 3a) carries
// the X gate to CareerSystem.afterBoot, which leaves an orphaned placed job alone under X.

import type { AircraftId } from '../core/types';
import { validateCareerBlock } from './block';
import type { CareerAircraftId, CareerBootAction, CareerBootPlan, CareerSave, CareerStoreKind } from './types';

/** What the boot plan reads from the URL and the shell (src/sim/params.ts SimParams and the era). */
export interface CareerBootUrl {
  /**
   * An explicit start: `scenario=`, `lesson=`, `demo=`, `hover=1` on a helicopter, or `career=0`
   * (`p.career.open === false`). The Career stays out of the way of it.
   */
  explicit: boolean;
  /** `career=1`: open the hub at boot (also what a Career type switch adds). */
  open: boolean;
  /** `resume=` (SimParams.resume): false under `resume=0`, null when absent. */
  resume: boolean | null;
  /** The Career exists in this era (`era().world.school`); default true. */
  available?: boolean;
  /** The world seed booted (src/world/worldSeed.ts); another than the save's keeps the Career to its seed page. Absent: not checked. */
  worldSeed?: number;
}

/** The snapshot as far as the plan reads it (src/sim/resume.ts FlightSnapshot). */
export interface CareerBootSnapshot {
  career?: unknown;
}

/** One plan. */
function plan(deleteBlock: boolean, resumeParam: boolean | null, trainingExplicit: boolean, action: CareerBootAction, explicit = false): CareerBootPlan {
  return { deleteBlock, resumeParam, trainingExplicit, action, explicit };
}

/** The hub-only rows: delete the block; the hub (and the Career takes the boot) only when career=1 asked. */
function hubOnly(url: CareerBootUrl): CareerBootPlan {
  return plan(true, null, url.open, url.open ? 'hub' : 'none');
}

/**
 * The boot plan (see the header): `save` the career store's save (null: no career), `snap` the stored resume
 * snapshot of the booted type (null: none), `bootType` the type booted, `url` the URL's Career inputs, `storeKind`
 * where the save is kept (`cstore=`).
 */
export function careerBootPlan(
  save: CareerSave | null, snap: CareerBootSnapshot | null, bootType: AircraftId, url: CareerBootUrl, storeKind: CareerStoreKind,
): CareerBootPlan {
  const hasBlock = snap?.career !== undefined;
  if (url.available === false) return plan(hasBlock, null, false, 'none');
  if (url.explicit) return plan(hasBlock || !!save, null, false, 'none', true);
  // No career yet: career=1 still opens it (the locked page or the new-career form).
  if (!save) return plan(hasBlock, null, url.open, url.open ? 'hub' : 'none');
  if (url.worldSeed !== undefined && url.worldSeed !== save.seed) return hubOnly(url);

  const job = save.active;
  const booted = (t: CareerAircraftId): boolean => t === bootType;
  if (job?.pendingReport) {
    // Settled by afterBoot; what follows is the "no job" row with the job's aircraft selected (settleJob selects it).
    // resumeParam false: an outlanding's snapshot stands where the settlement no longer has the aircraft.
    return save.inCareer && booted(job.type) ? plan(true, false, true, 'placeSelected') : hubOnly(url);
  }
  if (job?.placed) {
    if (!booted(job.type)) return hubOnly(url);
    const block = storeKind === 'local' ? validateCareerBlock(snap?.career) : null;
    if (block && block.jobId === job.offer.id && block.aircraftUid === job.aircraftUid) {
      return plan(false, url.resume === false ? null : true, true, 'resume');
    }
    return plan(true, false, true, 'resume');
  }
  if (job) return booted(job.type) ? plan(true, false, true, 'place') : hubOnly(url);
  const selected = save.fleet.find((a) => a.uid === save.selectedUid);
  if (save.inCareer && selected && booted(selected.type)) return plan(true, null, true, 'placeSelected');
  return hubOnly(url);
}
