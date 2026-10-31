// The Career's entry for the shell (docs/career.md "Integration"): what src/sim/Simulator.ts imports to load the
// store, plan the boot, run the CareerSystem and expose it to automation. The pure core, the job runtime and the
// pages stay importable from their own modules; this file only gathers the shell-facing surface and adds the two
// small adapters the Simulator needs:
//
//   chainCrashActions(host, career)   the Career's crash-dialog actions before whatever the host had (the
//                                     Flight School's), never overwriting it: UISystem.crashActions is one slot
//   careerAutomation(career)          window.__sim.career (docs/career.md "Automation")

import type { CrashAction } from '../ui/overlays';
import type { CareerAnswer, CareerSystem } from './CareerSystem';
import type { CareerStore } from './store';
import type { ActiveJob, CareerCommand, CareerPage, CareerSave, JobOffer, JobStripModel, LoadSheet, Settlement } from './types';
import { defaultFuelKg } from './ui/widgets';

export { careerBootPlan, type CareerBootSnapshot, type CareerBootUrl } from './boot';
export { CareerSystem, CAREER_SYNC_S, isCareerType, type CareerAfterBoot, type CareerAnswer, type CareerShell } from './CareerSystem';
export { CareerStore, careerKv } from './store';
export { validateCareerBlock } from './block';
export { CAREER_STRIP_CLEARANCE } from './ui/strip';
export type { CareerBootPlan, CareerMenuLink, CareerModalLink, CareerResumeBlock, CareerStoreKind } from './types';

/** UISystem's crash slot (the part chainCrashActions touches). */
export interface CrashActionsHost {
  crashActions: ((reason: string) => CrashAction[] | 'none' | null) | null;
}

/**
 * Put the Career's crash actions in front of the host's present ones (call after training.init, which sets the
 * school's): the Career answers while a job is placed, otherwise the previous function does (or the generic dialog).
 */
export function chainCrashActions(host: CrashActionsHost, career: Pick<CareerSystem, 'crashActions'>): void {
  const prev = host.crashActions;
  host.crashActions = (reason) => career.crashActions(reason) ?? prev?.(reason) ?? null;
}

/** window.__sim.career (docs/career.md "Automation"). */
export interface CareerAutomation {
  /** A copy of the save (null: no career). */
  state(): CareerSave | null;
  /** Today's board at the selected aircraft's field. */
  board(): JobOffer[];
  loadSheet(offerId: string, uid: string, fuelKg: number): LoadSheet | null;
  /** Accept an offer; the aircraft defaults to the selected one, the fuel to the dispatch page's default. */
  accept(offerId: string, opts?: { uid?: string; fuelKg?: number }): Promise<CareerAnswer>;
  active(): { job: ActiveJob; strip: JobStripModel | null; monitor: unknown } | null;
  abandon(): void;
  /** The last debrief. */
  settlement(): Settlement | null;
  command(cmd: CareerCommand): Promise<CareerAnswer>;
  open(page?: CareerPage): void;
  close(): void;
  /** Create a career (declaring a licence when none is held). */
  create(opts?: Partial<{ pilotName: string; companyName: string; callsign: string; start: 'c152' | 'c172s' }>): Promise<CareerAnswer>;
  /** cstore=mem or session only: the job completes at the destination's stand as a test. */
  testArrive(): Promise<CareerAnswer>;
  readonly store: CareerStore;
  readonly system: CareerSystem;
}

/** The automation API over a CareerSystem. */
export function careerAutomation(career: CareerSystem): CareerAutomation {
  return {
    state: () => (career.save ? structuredClone(career.save) : null),
    board: () => career.board(),
    loadSheet: (offerId, uid, fuelKg) => career.loadSheetFor(offerId, uid, fuelKg),
    accept: async (offerId, opts = {}) => {
      const s = career.save;
      const uid = opts.uid ?? s?.selectedUid ?? '';
      let fuelKg = opts.fuelKg;
      if (fuelKg === undefined) {
        const ac = s?.fleet.find((a) => a.uid === uid);
        const probe = ac ? career.loadSheetFor(offerId, uid, ac.fuelKg) : null;
        fuelKg = probe && ac ? defaultFuelKg(probe, ac.fuelKg) : 0;
      }
      return career.run({ kind: 'accept', offerId, uid, fuelKg });
    },
    active: () => {
      const job = career.save?.active;
      if (!job) return null;
      const m = career.jobMonitor;
      return { job: structuredClone(job), strip: m?.strip() ?? null, monitor: m?.exportState() ?? null };
    },
    abandon: () => {
      career.abandonJob(true, null);
    },
    settlement: () => career.save?.lastSettlement ?? null,
    command: (cmd) => career.run(cmd),
    open: (page) => career.open(page ?? 'hub'),
    close: () => career.close(),
    create: async (opts = {}) => {
      if (!career.licence()) await career.run({ kind: 'declareLicence' });
      return career.run({ kind: 'create', pilotName: opts.pilotName ?? '', companyName: opts.companyName ?? '', callsign: opts.callsign ?? '', start: opts.start ?? 'c152' });
    },
    testArrive: () => career.testArrive(),
    get store() {
      return career.store;
    },
    system: career,
  };
}
