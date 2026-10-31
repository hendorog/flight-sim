// The Career pages' view model and the context every page renders with (docs/career.md "UI pages").
//
// The CareerSystem (wave 3) hands the UI one CareerUiModel whenever something changes (setModel) and the job
// strip's JobStripModel every frame (setStrip). The model is deliberately raw: the save itself, the world's
// fields and today's board. Everything derived (rank, hours by class, the load sheet as the fuel slider moves,
// the market's refusals, the bankruptcy options) is computed inside the pages with the pure core
// (progression.ts, loadsheet.ts, costs.ts), so the board, the dispatch and the settlement can never disagree
// with what the UI shows, and the integrator has a small surface to fill.
//
// Pages are functions `render<Page>(parent, ctx): CareerView`; the view's onKey sees keys while it is open
// (Escape back, Enter the primary action), as the school's ScreenView does.

import type { AircraftId } from '../../core/types';
import type { AuthorityId } from '../../training/types';
import type { Airfield } from '../../world/airfields';
import type { CareerCommand, CareerPage, CareerSave, CareerStoreKind, JobOffer, LicenceSource } from '../types';

/** Everything the Career pages show, from the CareerSystem. */
export interface CareerUiModel {
  /** The save, or null before a career exists (the create or locked page). */
  save: CareerSave | null;
  /** The world's fields: the home field first, then the generated ones (src/world/airfields.ts airfields()). */
  fields: readonly Airfield[];
  /** Today's board at the selected aircraft's field (jobs.ts boardFor); offers in `save.taken` are hidden by the board page. */
  board: readonly JobOffer[];
  /** The world seed now loaded (src/world/worldSeed.ts); another than `save.seed` shows the seed page. */
  worldSeed: number;
  /** The aircraft type the sim has booted (a job for another type shows "Switch to <type>"). */
  bootedType: AircraftId;
  /** Where the save is kept: 'mem' refuses a type switch (the dispatch page says so). */
  storeKind: CareerStoreKind;
  /** The store's state: 'memoryOnly' and 'readOnly' show a banner on the hub. */
  storage: 'ok' | 'memoryOnly' | 'readOnly';
  /** The school's registration authority (marks and the market's new airframes). */
  authority: AuthorityId;
  /** How the player holds a licence (the school's ppl, `unlock=1`), or null: the locked page until "I already hold a licence". */
  licence: LicenceSource | null;
  /** The create form's default pilot name (the school profile's student name), if any. */
  suggestedPilotName?: string;
  /** A Flight School lesson is running: the hub says "Finish or end the lesson first" and offers nothing else. */
  inLesson?: boolean;
  /** Fuel aboard the placed aircraft now, kg (the stop page's starting figure); absent: the job's placement fuel. */
  liveFuelKg?: number;
}

/** The pages CareerUi can show: the contract's CareerPage plus the hub's reposition view (a UI-only page). */
export type CareerView = CareerPage | 'reposition';

/** A rendered page. `onKey` sees keys while it is open and returns true when it used one. */
export interface CareerPageView {
  root: HTMLElement;
  onKey?(e: KeyboardEvent): boolean;
  dispose?(): void;
}

/** What a page may use: the model, the UI-local navigation state and the ways out. */
export interface CareerCtx {
  model: CareerUiModel;
  /** Send a command to the CareerSystem (the UI has already done its own share, e.g. navigation). */
  send(cmd: CareerCommand): void;
  /** Open another page (UI-local; the system is not told). */
  go(page: CareerView): void;
  /** A short notice (the shell's toasts when attached). */
  toast(text: string): void;
  /** The offer the dispatch page shows (set by the board; the system may also set it with a 'dispatch' command). */
  dispatchOfferId: string | null;
  /**
   * Page state that outlives a re-render (setModel re-renders the open page): the board's highlighted offer, the
   * dispatch's aircraft and fuel, the fleet tab, the logbook page. Kept by CareerUi until the Career closes.
   */
  memo: Map<string, unknown>;
}
