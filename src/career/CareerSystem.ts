// The CareerSystem (docs/career.md "Integration", "Persistence, boot and reloads"): the orchestrator of the Career.
// It owns the career store's save while the sim runs, answers the Career pages' commands (src/career/ui), dispatches
// jobs and places the player through the shell's curtain, runs the job monitor (src/career/runtime/monitor.ts) each
// frame, holds a job at a stop, settles it (src/career/economy.ts), and keeps the UI model, the resume block, the
// boot plan's follow-up, the crash dialog's actions, the radio identity and the job's destination for the shell.
//
// SHELL. Every dependency arrives as a closure in CareerShell (the TrafficDeps / RadioDeps / TrainingShell idiom):
// the physics, the live weather, the store, the UI layer (null: no pages, as in node tests), startFrom (curtain,
// physics.resetTo, a 'reset' event carrying the lessonId), setAircraft / setSeed (reloads), setHold (the shell's
// careerHold), persist (the resume snapshot, which asks resumeBlock()), frameSimDt (the frame's simulated time) and
// small read-outs (readings, the school's licence and lesson, the authority, toasts, a confirm). It never reaches
// into the Simulator and tolerates every optional closure being absent.
//
// JOB LIFE. Accept (or Reposition) checks the load sheet at the exact fuel, records the job (`charges` = the
// sheet's fuel cost and defuel credit, lead decision 4), saves the store and persists at once. A job for another
// type is saved unplaced and the page reloads into that type (`setAircraft(type, { open: 'career' })`); the boot
// plan places it after the reload. Placement copies the scenario's loading into `active.loading` and marks the job
// placed before the first save, then runs startFrom (`career:<jobId>`, "Loading job"); while the curtain is up no
// resume block is written, so a reload then falls back to a re-placement. After the curtain: the GPS direct-to the
// destination, the COM the MIC is on to [origin, destination] (home origin: ground; home destination: tower), the
// job's weather on a first placement (the offer's preset over the player's weather without extras, the offer's
// wind, the career clock's time of day and the season's day of year), then a save and a persist with the block.
// One monitor watches the whole job: a refuel at a stop re-places through the same 'career:' reset, which the
// monitor takes as its own placement and folds the time across.
//
// ENDINGS. Completed: settled at once and the debrief opens. Crashed or outlanded: the report is kept as
// `active.pendingReport` and settled when the player picks Debrief or Hub (the crash dialog's actions come from
// crashActions(), chained before the school's by chainCrashActions in index.ts), or at the next boot. A reset from
// outside the Career abandons it; Abandon (strip or menu), Give up and Rest settle it too. Every ending disposes the
// monitor, gives the player's weather back, sets the start field to where the aircraft now stands (null at home),
// hides the strip, adds the idle lease the settlement's clock advance charged as its own debrief line (lead
// decision 3: the lines then add up to cashAfter - cashBefore, so `net` includes it; the logbook keeps the job's
// own net), saves and persists. The flight number is settleJob's (lead decision 4).
//
// STOPS. A stop's landing fee is charged when the job leaves the stop (Continue, Refuel, or a lift-off from there),
// never at the stop itself: a Give up settles 'diverted' and the settlement charges that field's fee, so it is
// paid once either way. A refuel adds the stop's fuel price (grass and fuel-truck surcharges) to `charges`.
//
// Node-safe apart from the pages (CareerUi, built only with a layer); imports no aircraft module: the booted type's
// definition is the shell's.

import type { AircraftDefinition } from '../aircraft/types';
import type { EventBus, SimContext, Subsystem } from '../core/context';
import type { AircraftId, WeatherSettings } from '../core/types';
import { setGpsTarget } from '../instruments/dynamics/navigation';
import { HOME_GROUND, radioTuning, setCom, type ComRadio } from '../instruments/dynamics/radios';
import type { InstrumentReadings } from '../instruments/dynamics/instrumentSet';
import type { FlightSnapshot } from '../sim/resume';
import type { Scenario } from '../sim/scenarios';
import type { SimPhysics } from '../sim/SimPhysics';
import { setStartField } from '../sim/startField';
import { applyWeatherPreset, reanchorStorms, restoreWeather, weatherPresetById, withoutExtras } from '../sim/weatherPresets';
import type { AuthorityId } from '../training/types';
import type { CrashAction } from '../ui/overlays';
import { airfields, HOME_AIRFIELD, type Airfield } from '../world/airfields';
import { worldSeed } from '../world/worldSeed';
import { validateCareerBlock } from './block';
import { normaliseCallsign } from './create';
import { fuelCost, landingFee } from './costs';
import { settleJob } from './economy';
import { fieldAt, fieldByCode, fieldStand } from './geo';
import { boardFor } from './jobs';
import { loadSheet } from './loadsheet';
import { CAREER_PERF } from './perf';
import { careerLoading, jobScenario, PLACEMENT_LABEL, placementLessonId, placementScenario } from './placement';
import {
  bankruptcySellOwned, buyAircraft, buyRating, dayOf, defuelAircraft, isBankrupt, leaseAircraft, minuteOfDay, rest, returnLease,
  seasonDayOfYear, sellAircraft, type ProgressionResult,
} from './progression';
import { blankReport, fuelOnBoardKg, JobMonitor, monitorAircraftOf, type JobMonitorEvent } from './runtime/monitor';
import { careerExportFileName, type CareerStore } from './store';
import {
  OCCUPANT_KG, type ActiveJob, type CareerAircraftId, type CareerBootPlan, type CareerCommand, type CareerMenuLink,
  type CareerModalLink, type CareerPage, type CareerResumeBlock, type CareerSave, type FleetAircraft, type JobFlightReport,
  type JobOffer, type LicenceSource, type LoadSheet, type Settlement,
} from './types';
import { CareerUi } from './ui/careerUi';
import type { CareerUiModel } from './ui/models';
import { repositionOffer } from './ui/reposition';
import { defaultFuelKg } from './ui/widgets';

/** The job state is copied into the save this often, s of job time (the fallback if no snapshot resumes). */
export const CAREER_SYNC_S = 5;
/** Build string written into exports (as the school's). */
const APP_BUILD = 'fs-dev';
/** Below this ground speed the aircraft counts as standing (the strip's Abandon), m/s. */
const STANDING_MS = 1;

/** What the Simulator gives the Career (see the header). */
export interface CareerShell {
  readonly physics: SimPhysics;
  /** The live weather object (shared with the physics, the sky and the UI). */
  readonly weather: WeatherSettings;
  /** The career store, loaded by the shell before the boot plan. */
  readonly store: CareerStore;
  /** The booted type's definition (the type is fixed for the session). */
  readonly aircraft: AircraftDefinition;
  /** UISystem.schoolLayer, where the pages mount; null: no pages (node tests). */
  readonly layer: HTMLElement | null;
  /** Curtain, physics.resetTo(sc), the 'reset' event with the lessonId; resolves once flying again. */
  startFrom(sc: Scenario, opts: { lessonId: string; label: string }): Promise<void>;
  /** Reload into another type (commands.setAircraft); absent: a type switch is refused. */
  setAircraft?(id: AircraftId, opts: { open: 'career' }): void;
  /** Reload into another world seed (commands.setSeed). */
  setSeed?(seed: number): void;
  /** Hold the simulation while a Career page is open (the shell's careerHold). */
  setHold(on: boolean): void;
  /** Write the resume snapshot now (it carries resumeBlock()). */
  persist(): void;
  /** The frame's simulated time, s (physics.lastAdvance, or the whole run= fast-forward; 0 while held). */
  frameSimDt(): number;
  /** Add an object to the 3D scene (wave 4's smoke marker); absent headless. */
  addToScene?(obj: unknown): void;
  /** Indicated panel readings (null before the panel exists or headless). */
  readings?(): InstrumentReadings | null;
  /** A short notice (UISystem.showToast). */
  toast?(text: string): void;
  /** The school's ppl endorsement is held (the L21 skill test passed). */
  hasPpl?(): boolean;
  /** `unlock=1`: the Career is unlocked for this session. */
  readonly unlock?: boolean;
  /** A Flight School lesson is running (the Career refuses to act). */
  inLesson?(): boolean;
  /** The school's registration authority (default EASA). */
  authority?(): AuthorityId;
  /** The school profile's student name, the create form's default. */
  suggestedPilotName?(): string | null;
  /** Ask a yes/no question ("Abandon the job?"); `yes` runs on yes. Absent: window.confirm. */
  confirm?(text: string, yes: () => void): void;
  /** Offer a text file to save (the export). Absent: the export is refused with a toast. */
  download?(fileName: string, text: string): void;
  /** The world's fields (default airfields()). */
  fields?(): readonly Airfield[];
  /** The world seed booted (default worldSeed()). */
  worldSeed?(): number;
  /** Wall time, ms since the epoch (default Date.now()). */
  now?(): number;
}

/** What afterBoot gets: the snapshot the boot resumed (null: none) and the plan careerBootPlan made. */
export interface CareerAfterBoot {
  resumed: FlightSnapshot | null;
  plan: CareerBootPlan;
}

/** A command's answer for automation: 'placed', 'reloading', 'ok', or the refusal text. */
export type CareerAnswer = string;

const clone = <T>(v: T): T => structuredClone(v);

/** The Career (see the header). One per session, present day only. */
export class CareerSystem implements Subsystem {
  private readonly shell: CareerShell;
  readonly store: CareerStore;
  private events: EventBus | null = null;
  private ui: CareerUi | null = null;
  private monitor: JobMonitor | null = null;
  /** A placement's curtain is up (no resume block, no frames). */
  private placing = false;
  /** "I already hold a licence" was chosen this session. */
  private declared = false;
  /** Job seconds since the save last took the job's state. */
  private syncS = 0;
  /** The stop field whose landing fee has been charged (once per stop). */
  private stopCharged: string | null = null;
  /** physics.time when the job's weather replaced the player's (storms re-anchor from it). */
  private playerWeatherTime: number | null = null;
  private boardCache: { key: string; offers: JobOffer[] } | null = null;
  private plan: CareerBootPlan | null = null;

  /** The Escape menu's link (MenuHost.career). */
  readonly menuLink: CareerMenuLink = {
    available: () => true,
    open: () => this.open('hub'),
    jobActive: () => this.jobActive(),
    abandon: () => {
      this.abandonJob(true, null);
    },
  };

  /** UISystem's link (attachCareer): a page open makes the UI modal. */
  readonly modalLink: CareerModalLink = { screenOpen: () => this.ui?.screenOpen() ?? false, stripVisible: () => this.ui?.stripVisible ?? false };

  constructor(shell: CareerShell) {
    this.shell = shell;
    this.store = shell.store;
  }

  // ------------------------------------------------------------------------------------------- read-outs

  /** The save (null: no career). */
  get save(): CareerSave | null {
    return this.store.current;
  }

  /** The type booted. */
  get bootedType(): AircraftId {
    return this.shell.aircraft.id;
  }

  /** The UI (null without a layer). */
  get pages(): CareerUi | null {
    return this.ui;
  }

  /** The live job monitor (null when no job is being watched). */
  get jobMonitor(): JobMonitor | null {
    return this.monitor;
  }

  /** The boot plan afterBoot was given (null before). */
  get bootPlan(): CareerBootPlan | null {
    return this.plan;
  }

  /** The world's fields. */
  fields(): readonly Airfield[] {
    return this.shell.fields?.() ?? airfields();
  }

  private seedNow(): number {
    return this.shell.worldSeed?.() ?? worldSeed();
  }

  /** The career lives in the world booted (its fields are the ones its codes name). */
  private worldOk(): boolean {
    const s = this.save;
    return !!s && s.seed === this.seedNow();
  }

  private inLesson(): boolean {
    return this.shell.inLesson?.() ?? false;
  }

  private toast(text: string): void {
    if (this.shell.toast) this.shell.toast(text);
    else this.ui?.toast(text);
  }

  /** How the player holds a licence (null: the locked page). */
  licence(): LicenceSource | null {
    const s = this.save;
    if (s) return s.pilot.licence;
    if (this.shell.hasPpl?.()) return 'school';
    if (this.shell.unlock) return 'unlock';
    return this.declared ? 'declared' : null;
  }

  /** A placed job is in progress (not yet ended): the menu confirms before anything that would end it. */
  jobActive(): boolean {
    const j = this.save?.active;
    return !!j && j.placed && !j.pendingReport && !this.unwatched();
  }

  /**
   * An explicit start (scenario=, lesson=, demo=, career=0) booted past the Career and no monitor watches its job:
   * the flight is not the job's, so the crash dialog, Shift+R, the menu, the snapshots and the radio behave as in
   * free flight until the Career is opened again (reconcileOrphan).
   */
  private unwatched(): boolean {
    return !!this.plan?.explicit && !this.monitor && !this.placing;
  }

  /** A placed job is active (the shell keeps writing snapshots while it is, even with the resume preference off). */
  jobPlaced(): boolean {
    return !!this.save?.active?.placed && !this.unwatched();
  }

  /** Today's board at the selected aircraft's field (empty without a career, an aircraft or in another world). */
  board(): JobOffer[] {
    const s = this.save;
    const ac = s ? selectedOf(s) : null;
    if (!s || !ac || s.seed !== this.seedNow()) return [];
    const day = dayOf(s.clockMin);
    const key = `${s.seed}|${day}|${ac.field}`;
    if (this.boardCache?.key !== key) this.boardCache = { key, offers: boardFor(s.seed, day, ac.field, this.fields()) };
    return this.boardCache.offers;
  }

  /** The load sheet of an offer (today's board at the aircraft's field, or the active job's) for an aircraft and fuel. */
  loadSheetFor(offerId: string, uid: string, fuelKg: number): LoadSheet | null {
    const s = this.save;
    const ac = s?.fleet.find((a) => a.uid === uid);
    if (!s || !ac) return null;
    const offer = this.offerFor(offerId, ac);
    return offer ? loadSheet(offer, ac, fuelKg, s, this.fields()) : null;
  }

  /**
   * The radio's identity while in Career mode with the job's (or the selected) aircraft booted: the airframe's
   * registration, its ICAO type, and the company callsign with the flight number when `settings.companyCallsign`
   * ("Fable 12"), else null. Null outside Career mode and during a lesson.
   */
  radioIdentity(): { registration: string; icaoType: string; callsign: string | null } | null {
    const s = this.save;
    if (!s || this.inLesson() || this.unwatched()) return null;
    const uid = s.active?.aircraftUid ?? (s.inCareer ? s.selectedUid : null);
    const ac = s.fleet.find((a) => a.uid === uid);
    if (!ac || ac.type !== this.bootedType) return null;
    return {
      registration: ac.registration,
      icaoType: CAREER_PERF[ac.type].icaoType,
      callsign: s.settings.companyCallsign ? `${s.company.callsign} ${s.flightNo}` : null,
    };
  }

  /** The placed job's destination field (null: no job, one waiting for another type, a site, or a field this world lacks). */
  destination(): Airfield | null {
    const j = this.save?.active;
    const d = j?.placed && !j.pendingReport && !this.unwatched() ? j.offer.destination : undefined;
    return d?.kind === 'field' ? fieldByCode(d.code, this.fields()) ?? null : null;
  }

  /**
   * The resume snapshot's Career block: null unless the store is 'local', a job is placed and watched (not behind a
   * placement's curtain) and its type is the one booted.
   */
  resumeBlock(): CareerResumeBlock | null {
    const j = this.save?.active;
    if (this.store.kind !== 'local' || !j || !j.placed || j.pendingReport || j.type !== this.bootedType) return null;
    if (!this.monitor || this.placing) return null;
    return { v: 1, jobId: j.offer.id, aircraftUid: j.aircraftUid, monitor: this.monitor.exportState() };
  }

  /** The UI model now (CareerUi.setModel). */
  uiModel(): CareerUiModel {
    const s = this.save;
    const job = s?.active;
    const m: CareerUiModel = {
      save: s, fields: this.fields(), board: this.board(), worldSeed: this.seedNow(), bootedType: this.bootedType,
      storeKind: this.store.kind, storage: this.store.status, authority: this.authority(), licence: this.licence(),
      inLesson: this.inLesson(),
    };
    const name = this.shell.suggestedPilotName?.();
    if (name) m.suggestedPilotName = name;
    if (job?.phase === 'stopped' && this.monitor) m.liveFuelKg = fuelOnBoardKg(this.shell.physics.state);
    return m;
  }

  private authority(): AuthorityId {
    return this.shell.authority?.() ?? 'easa';
  }

  // ------------------------------------------------------------------------------------------- subsystem

  init(ctx: SimContext): void {
    this.events = ctx.events;
    if (this.shell.layer) {
      const ui = new CareerUi(this.shell.layer);
      ui.onCommand = (cmd) => this.command(cmd);
      ui.onScreenChange = (open) => this.shell.setHold(open);
      if (this.shell.toast) ui.toastSink = this.shell.toast;
      this.ui = ui;
    }
    this.refresh();
  }

  /** One frame: the monitor on the frame's simulated time, the strip, the save every CAREER_SYNC_S. */
  update(): void {
    const m = this.monitor;
    const job = this.save?.active;
    if (!m || !job || this.placing) {
      this.ui?.setStrip(null);
      return;
    }
    const dt = Math.max(0, this.shell.frameSimDt() || 0);
    const p = this.shell.physics;
    const wasStopped = m.phase === 'stopped';
    m.update(dt, { state: p.state, controls: p.controls, weather: this.shell.weather, env: p.env, readings: this.shell.readings?.() ?? null });
    if (this.monitor !== m || !this.save?.active) return;   // it ended in this frame
    if (wasStopped && m.phase !== 'stopped') this.leftStop(job.stoppedAt ?? null);
    const s = p.state;
    const canAbandon = s.onGround && s.groundSpeed < STANDING_MS && m.phase !== 'airborne' && fieldAt(s.position.x, s.position.y, this.fields()) !== null;
    this.ui?.setStrip(m.strip(), { canAbandon });
    this.syncS += dt;
    if (this.syncS >= CAREER_SYNC_S) {
      this.syncS = 0;
      this.syncJob(false);
    }
  }

  dispose(): void {
    this.detachMonitor();
    this.ui?.dispose();
    this.ui = null;
  }

  /** The job's state from the monitor into the save (`now`: saved at once, else debounced). */
  private syncJob(now: boolean): void {
    const m = this.monitor;
    const s = this.save;
    if (!m || !s?.active) return;
    const next = clone(s);
    const j = next.active!;
    j.elapsedS = m.elapsedS;
    j.lastKnown = m.position;
    if (m.phase !== 'done') j.phase = m.phase;
    j.everAirborne = m.everAirborne;
    if (m.stoppedAt) j.stoppedAt = m.stoppedAt;
    else delete j.stoppedAt;
    // Held at a stop, the fuel aboard is what a re-placement there must put back (a reload's fallback, a type
    // parked and booted again), what Give up and the day's end settle with, and what the stop page starts from.
    if (m.phase === 'stopped') j.fuelKg = fuelOnBoardKg(this.shell.physics.state);
    if (now) this.commit(next);
    else this.store.saveSoon(next);
  }

  // ------------------------------------------------------------------------------------------- boot

  /**
   * After the boot resumed or started a flight (after training.afterBoot): settle a pending report, settle or park
   * a placed job of another type (not under an explicit start), then act on the plan: resume the monitor from the
   * snapshot's block (or fall back: a stopped or never-airborne job is placed again, an airborne one is lost),
   * place an unplaced job, place the selected aircraft, or open the hub.
   */
  async afterBoot(o: CareerAfterBoot): Promise<void> {
    this.plan = o.plan;
    const s = this.save;
    if (!s) {
      if (o.plan.action === 'hub') this.open('hub');
      return;
    }
    if (!this.worldOk()) {
      // Another world: its fields are not this career's, so nothing is settled, parked or placed (the seed page).
      if (o.plan.action === 'hub') this.open('hub');
      return;
    }
    // A crash or outlanding the player never acknowledged: settled now, and its debrief shown once the boot's own
    // placement (if any) is done.
    const settledAtBoot = s.active?.pendingReport ? this.settle(s.active.pendingReport, null) : null;
    if (!o.plan.explicit) this.parkOtherType();
    switch (o.plan.action) {
      case 'resume':
        await this.resumeOrFallBack(o.resumed);
        break;
      case 'place':
        // A job parked at a stop (its type was not booted) comes back held there.
        if ((await this.placeActive(true)) && this.save?.active?.phase === 'stopped') this.open('stop');
        break;
      case 'placeSelected':
        if (!o.resumed) await this.placeSelected();
        break;
      case 'hub':
        this.open('hub');
        break;
      case 'none':
        break;
    }
    if (settledAtBoot && this.ui?.page() !== 'debrief') this.open('debrief');
    this.refresh();
  }

  /** A placed job of another type than the booted one: lost if it had flown (and is not held at a stop), else waiting. */
  private parkOtherType(): void {
    const j = this.save?.active;
    if (!j || !j.placed || j.pendingReport || j.type === this.bootedType) return;
    if (j.everAirborne && j.phase !== 'stopped') {
      this.settle(this.lostReport(j), null);
      return;
    }
    const next = clone(this.save!);
    next.active!.placed = false;
    this.commit(next);
  }

  private lostReport(j: ActiveJob): JobFlightReport {
    return blankReport('lost', j.lastKnown, j.elapsedS, j.fuelKg, null, j.offer.waypoints?.length ?? 0);
  }

  private async resumeOrFallBack(resumed: FlightSnapshot | null): Promise<void> {
    const j = this.save?.active;
    if (!j || !j.placed || j.type !== this.bootedType) return;
    const block = resumed ? validateCareerBlock(resumed.career) : null;
    if (block && block.jobId === j.offer.id && block.aircraftUid === j.aircraftUid) {
      const m = this.attachMonitor(j);
      m.restoreState(block.monitor);   // false: the fresh monitor (the store's elapsed time) carries on
      this.setRadiosAndGps(j, false);
      if (m.phase === 'stopped') this.open('stop');
      return;
    }
    await this.fallBack(j);
  }

  /** A placed job no snapshot resumed: held at a stop or never flown, placed again; airborne, lost. */
  private async fallBack(j: ActiveJob): Promise<void> {
    if (j.everAirborne && j.phase !== 'stopped') {
      this.settle(this.lostReport(j), 'debrief');
      return;
    }
    await this.placeActive(true);
    if (this.save?.active?.phase === 'stopped') this.open('stop');
  }

  /** A placed job nobody watches (an explicit start booted past it, or an import): reconciled when the Career opens. */
  private reconcileOrphan(): void {
    // Opening the Career takes the session back from the explicit start: its jobs and radio identity count again.
    if (this.plan?.explicit && !this.inLesson()) this.plan = { ...this.plan, explicit: false };
    const j = this.save?.active;
    // Never during a lesson: a re-placement would end it (the hub refuses to act then anyway).
    if (!j || !j.placed || j.pendingReport || this.monitor || this.placing || !this.worldOk() || this.inLesson()) return;
    if (j.type !== this.bootedType) {
      this.parkOtherType();
      return;
    }
    void this.fallBack(j);
  }

  // ------------------------------------------------------------------------------------------- placement

  private def(): AircraftDefinition {
    return this.shell.aircraft;
  }

  /** A monitor for the job at its state in the save, connected to the sim's events. */
  private attachMonitor(j: ActiveJob): JobMonitor {
    this.detachMonitor();
    const def = this.def();
    const m: JobMonitor = new JobMonitor({
      offer: j.offer, type: j.type, aircraft: monitorAircraftOf(def), fields: this.fields(), elapsedBaseS: j.elapsedS,
      phase: j.phase, everAirborne: j.everAirborne, stoppedAt: j.stoppedAt, onEvent: (e) => this.onMonitorEvent(m, e),
    });
    if (this.events) m.connect(this.events, () => this.shell.physics.state);
    this.monitor = m;
    this.syncS = 0;
    return m;
  }

  private detachMonitor(): void {
    this.monitor?.dispose();
    this.monitor = null;
  }

  /**
   * Place the active job (booted type) at its origin, or at its stop: loading and `placed` saved first, then the
   * curtain; afterwards the radios, the GPS and (`firstWeather`) the job's weather, then a save and a persist with
   * the block. Resolves false when the job is gone or of another type.
   */
  private async placeActive(firstWeather: boolean): Promise<boolean> {
    const s = this.save;
    const j0 = s?.active;
    if (!s || !j0 || j0.type !== this.bootedType || j0.pendingReport) return false;
    let sc: Scenario;
    try {
      sc = jobScenario(j0, this.def(), this.shell.physics.env, this.fields());
    } catch (e) {
      this.toast(`The job cannot be placed: ${(e as Error).message}`);
      return false;
    }
    const next = clone(s);
    const j = next.active!;
    j.loading = sc.loading ?? j.loading;
    j.placed = true;
    if (this.monitor) j.elapsedS = j.elapsedBaseS = this.monitor.elapsedS;
    else j.elapsedBaseS = j.elapsedS;
    const m = this.monitor ?? this.attachMonitor(j);
    this.placing = true;
    this.commit(next);
    try {
      await this.shell.startFrom(sc, { lessonId: placementLessonId(j.offer.id), label: PLACEMENT_LABEL });
    } finally {
      this.placing = false;
    }
    const now = this.save?.active;
    if (!now || now.offer.id !== j.offer.id || this.monitor !== m) return false;
    this.setRadiosAndGps(now, true);
    if (firstWeather) this.applyJobWeather(now);
    if (firstWeather) this.events?.emit('career', { kind: 'start', jobId: now.offer.id });
    this.commit(this.save!);
    return true;
  }

  /** Place the selected aircraft cold at its field with no job (the Career's own start after a reload). */
  private async placeSelected(): Promise<void> {
    const s = this.save;
    const ac = s ? selectedOf(s) : null;
    if (!s || !ac || ac.type !== this.bootedType || s.seed !== this.seedNow()) return;
    // Out of service (a crash's grounding): not flown; the hub says why.
    if (ac.groundedUntilDay !== undefined && dayOf(s.clockMin) < ac.groundedUntilDay) {
      this.open('hub');
      return;
    }
    let sc: Scenario;
    try {
      sc = placementScenario({ field: ac.field, loading: careerLoading(this.def(), []), fuelKg: ac.fuelKg, jobId: null }, this.def(), this.shell.physics.env, this.fields());
    } catch {
      return;
    }
    await this.shell.startFrom(sc, { lessonId: placementLessonId(null), label: PLACEMENT_LABEL });
  }

  /** The GPS direct to the destination; on a placement (`tune`), the COM the MIC is on to [origin, destination]. */
  private setRadiosAndGps(j: ActiveJob, tune: boolean): void {
    const dest = j.offer.destination.kind === 'field' ? j.offer.destination.code : j.offer.origin;
    setGpsTarget(dest);
    if (!tune) return;
    const fields = this.fields();
    const here = fieldByCode(j.stoppedAt ?? j.offer.origin, fields);
    const there = fieldByCode(dest, fields);
    const active = here?.kind === 'home' ? HOME_GROUND : here?.frequency;
    const standby = there?.kind === 'home' ? HOME_AIRFIELD.frequency : there?.frequency;
    if (active === undefined || standby === undefined) return;
    const mic: ComRadio = radioTuning().mic;
    setCom(mic, [active, standby]);
  }

  /** The job's weather over the player's (see the header), emitted. */
  private applyJobWeather(j: ActiveJob): void {
    const w = withoutExtras(j.playerWeather);
    const preset = weatherPresetById(j.offer.weather);
    const t = this.shell.physics.time;
    if (preset) applyWeatherPreset(w, preset, t);
    w.windDirectionDeg = j.offer.windDirDeg;
    w.windSpeedKt = j.offer.windKt;
    const clock = j.acceptedAtMin + j.elapsedS / 60;
    w.timeOfDay = minuteOfDay(clock) / 60;
    w.dayOfYear = seasonDayOfYear(dayOf(clock));
    if (this.playerWeatherTime === null) this.playerWeatherTime = t;
    restoreWeather(this.shell.weather, w);
    this.events?.emit('weatherChanged', {});
  }

  /** The player's own weather back (the job's end), emitted. */
  private restorePlayerWeather(j: ActiveJob): void {
    if (!j.placed) return;
    restoreWeather(this.shell.weather, j.playerWeather);
    const t = this.shell.physics.time;
    reanchorStorms(this.shell.weather, this.playerWeatherTime ?? t, t);
    this.playerWeatherTime = null;
    this.events?.emit('weatherChanged', {});
  }

  // ------------------------------------------------------------------------------------------- monitor events

  private onMonitorEvent(m: JobMonitor, e: JobMonitorEvent): void {
    if (m !== this.monitor) return;
    const s = this.save;
    if (!s?.active) return;
    if (e.kind === 'stopped') {
      this.stopCharged = null;
      this.syncJob(true);
      this.open('stop');
      return;
    }
    const r = e.report;
    this.syncJob(false);   // the save's copy of the job lags the monitor by up to CAREER_SYNC_S
    const job = this.save!.active!;
    if (r.outcome === 'crashed' || r.outcome === 'outlanded') {
      const next = clone(this.save!);
      next.active!.pendingReport = r;
      this.detachMonitor();
      this.ui?.setStrip(null);
      // A crash arrives from inside the physics step: the store is saved now, the snapshot by the shell's own
      // periodic persist (a crashed or pending job writes no block, and a crashed snapshot never resumes).
      this.store.save(next);
      this.refresh();
      if (r.outcome === 'outlanded') {
        // A frame's ending, not the physics step's: the snapshot (now without a block) is written at once.
        this.shell.persist();
        this.open('hub');
      }
      return;
    }
    this.detachMonitor();
    if (r.outcome === 'abandoned') {
      this.settle(this.abandonAt(job, r), null);
      this.toast('Job abandoned');
      return;
    }
    this.settle(r, 'debrief');
  }

  /** An abandoned report with the field it rests at: the stop or the origin whenever the job is on the ground there. */
  private abandonAt(j: ActiveJob, r: JobFlightReport): JobFlightReport {
    if (!j.everAirborne || j.phase === 'stopped') return { ...r, atField: j.stoppedAt ?? j.offer.origin };
    return r;
  }

  /** The job left a stop (Continue, Refuel or a lift-off from there): the stop's landing fee, once. */
  private leftStop(code: string | null): void {
    const s = this.save;
    if (!s?.active || !code || this.stopCharged === code) return;
    this.stopCharged = code;
    const next = clone(s);
    const j = next.active!;
    const f = fieldByCode(code, this.fields());
    const ch = j.charges ?? { fuelUsd: 0, defuelCreditUsd: 0, stopFeesUsd: 0 };
    j.charges = { ...ch, stopFeesUsd: ch.stopFeesUsd + landingFee(f?.kind ?? 'sealed', CAREER_PERF[j.type].mtowKg) };
    if (this.monitor && this.monitor.phase !== 'done') j.phase = this.monitor.phase;
    if (j.phase !== 'stopped') delete j.stoppedAt;
    this.commit(next);
  }

  // ------------------------------------------------------------------------------------------- settlement

  /**
   * Settle the active job with `report` and open `page` (null: none). Adds the idle lease the clock's advance
   * charged as its own line; ends the job's monitor, weather and strip; sets the start field to the aircraft's.
   */
  private settle(report: JobFlightReport, page: 'debrief' | 'hub' | null): Settlement | null {
    const s = this.save;
    const j = s?.active;
    if (!s || !j) return null;
    if (!this.worldOk()) {
      this.toast(`This career lives in world seed ${s.seed}: switch the world back first`);
      return null;
    }
    const cashBefore = s.cash;
    const out = settleJob(s, j, report, this.fields());
    let st = out.settlement;
    const idle = Math.round(st.cashAfter - cashBefore - st.net);
    if (idle !== 0) {
      st = { ...st, lines: [...st.lines, { id: 'leaseIdle', label: 'Idle lease', amount: idle }], net: st.net + idle };
      out.save.lastSettlement = st;
    }
    this.detachMonitor();
    this.restorePlayerWeather(j);
    this.ui?.setStrip(null);
    setStartField(startFieldOf(st.aircraftAt));
    this.stopCharged = null;
    this.commit(out.save);
    this.events?.emit('career', { kind: 'end', jobId: j.offer.id });
    if (page) this.open(page);
    return st;
  }

  /**
   * End the active job as abandoned (`force`: also in the air, as the menu's confirmed reset does; otherwise only on
   * the ground). A pending report is settled instead. Returns the settlement, or null when refused or no job.
   */
  abandonJob(force: boolean, page: 'debrief' | 'hub' | null = 'debrief'): Settlement | null {
    this.syncJob(false);
    const j = this.save?.active;
    if (!j) return null;
    if (j.pendingReport) return this.settle(j.pendingReport, page);
    const m = this.monitor;
    let r: JobFlightReport;
    if (m) {
      const st = this.shell.physics.state;
      if (!force && !st.onGround) {
        this.toast('Land first: a job can only be abandoned on the ground');
        return null;
      }
      this.detachMonitor();
      r = m.abandon();
    } else if (!j.placed) {
      const stand = this.standOf(j.offer.origin);
      r = blankReport('abandoned', stand, 0, j.fuelKg, j.offer.origin, j.offer.waypoints?.length ?? 0);
    } else {
      r = blankReport('abandoned', j.lastKnown, j.elapsedS, j.fuelKg, null, j.offer.waypoints?.length ?? 0);
    }
    return this.settle(this.abandonAt(j, r), page);
  }

  private standOf(code: string): { north: number; east: number } {
    const f = fieldByCode(code, this.fields());
    return f ? fieldStand(f) : { north: 0, east: 0 };
  }

  /** Settle a crash or outlanding the player has acknowledged (the crash dialog, the hub's Debrief). */
  private settlePending(then: 'debrief' | 'hub'): Settlement | null {
    const j = this.save?.active;
    if (!j) {
      this.open(then === 'debrief' && this.save?.lastSettlement ? 'debrief' : 'hub');
      return null;
    }
    let r = j.pendingReport ?? this.monitor?.ended ?? null;
    if (!r && this.monitor && this.shell.physics.state.crashed) {
      const m = this.monitor;
      this.detachMonitor();
      r = m.onCrash(this.shell.physics.state.crashReason, this.shell.physics.state);
    }
    if (!r) return null;
    return this.settle(r, then);
  }

  // ------------------------------------------------------------------------------------------- dispatch

  /** An offer by id for an aircraft: today's board at its field, or the active job's (a waiting job re-dispatched). */
  private offerFor(offerId: string, ac: FleetAircraft): JobOffer | null {
    const s = this.save!;
    if (s.active?.offer.id === offerId) return s.active.offer;
    if (s.seed !== this.seedNow()) return null;
    return boardFor(s.seed, dayOf(s.clockMin), ac.field, this.fields()).find((o) => o.id === offerId) ?? null;
  }

  /** Why nothing may be dispatched now, or null. */
  private dispatchRefusal(): string | null {
    const s = this.save;
    if (!s) return 'Start a career first';
    if (s.seed !== this.seedNow()) return `This career lives in world seed ${s.seed}: switch the world back first`;
    if (this.inLesson()) return 'Finish or end the lesson first';
    if (isBankrupt(s)) return 'The company is below its overdraft';
    return null;
  }

  /**
   * Accept an offer for an aircraft at a fuel (the dispatch's exact figure). Resolves 'placed' once the player stands
   * at the origin, 'reloading' when the page reloads into the job's type, or the refusal's text.
   */
  async accept(offerId: string, uid: string, fuelKg: number): Promise<CareerAnswer> {
    const no = this.dispatchRefusal();
    if (no) return this.refuse(no);
    const s = this.save!;
    // Only a job still waiting at its origin (dispatched for another type) may be accepted again; one that has flown
    // (parked at a stop while another type was booted) keeps its progress and is placed by the boot or Switch to.
    const a = s.active;
    if (a && (a.offer.id !== offerId || a.placed || a.phase !== 'dispatched' || a.everAirborne)) return this.refuse('One job at a time: finish the job in progress first');
    const ac = s.fleet.find((a) => a.uid === uid);
    if (!ac) return this.refuse('No such aircraft');
    const offer = this.offerFor(offerId, ac);
    if (!offer) return this.refuse('This offer is no longer on the board');
    if (s.taken.includes(offer.id) && s.active?.offer.id !== offer.id) return this.refuse('That offer has been taken');
    return this.dispatch(offer, ac, fuelKg, false);
  }

  /** Self-dispatch an unpaid positioning flight of the selected aircraft to `to` at the reposition page's fuel. */
  async reposition(to: string): Promise<CareerAnswer> {
    const no = this.dispatchRefusal();
    if (no) return this.refuse(no);
    const s = this.save!;
    if (s.active) return this.refuse('One job at a time: finish the job in progress first');
    const ac = selectedOf(s);
    if (!ac) return this.refuse('No aircraft selected');
    if (to === ac.field) return this.refuse(`${ac.registration} is at ${to} already`);
    const fields = this.fields();
    if (!fieldByCode(to, fields)) return this.refuse(`No field ${to} in this world`);
    const offer = repositionOffer(s, fields, ac, to);
    // The page's own fuel rule (widgets.ts defaultFuelKg): what is aboard, raised to Required, capped by the load.
    const fuel = defaultFuelKg(loadSheet(offer, ac, ac.fuelKg, s, fields), ac.fuelKg);
    return this.dispatch(offer, ac, fuel, true);
  }

  private refuse(text: string): CareerAnswer {
    this.toast(text);
    return text;
  }

  /** The shared tail of Accept and Reposition (see the header). */
  private async dispatch(offer: JobOffer, ac: FleetAircraft, fuelKg: number, own: boolean): Promise<CareerAnswer> {
    const s = this.save!;
    const fields = this.fields();
    const switching = ac.type !== this.bootedType;
    if (switching && (this.store.kind === 'mem' || !this.shell.setAircraft)) {
      return this.refuse(`The ${CAREER_PERF[ac.type].icaoType} needs a reload, and this career is kept in memory only`);
    }
    const sheet = loadSheet(offer, ac, fuelKg, s, fields);
    if (!sheet.ok) return this.refuse(sheet.warnings.find((w) => w.severity === 'block')?.text ?? 'The load sheet does not allow it');
    const next = clone(s);
    const stand = this.standOf(offer.origin);
    next.active = {
      offer: clone(offer), aircraftUid: ac.uid, type: ac.type, fuelKg, loading: null, items: clone(sheet.items),
      phase: 'dispatched', placed: false, acceptedAtMin: s.clockMin, elapsedBaseS: 0, elapsedS: 0,
      lastKnown: { north: stand.north, east: stand.east, onGround: true }, everAirborne: false,
      playerWeather: s.active?.playerWeather ?? clone(this.shell.weather),
      charges: { fuelUsd: sheet.fuelCost, defuelCreditUsd: sheet.defuelCredit, stopFeesUsd: 0 },
    };
    next.selectedUid = ac.uid;
    next.inCareer = true;
    if (own) next.ownNo += 1;
    else if (!next.taken.includes(offer.id)) next.taken.push(offer.id);
    this.commit(next);
    this.ui?.close();
    if (switching) {
      this.store.flush();
      this.shell.setAircraft!(ac.type, { open: 'career' });
      return 'reloading';
    }
    const ok = await this.placeActive(true);
    return ok ? 'placed' : 'The job could not be placed';
  }

  // ------------------------------------------------------------------------------------------- stops

  private stopped(): ActiveJob | null {
    const j = this.save?.active;
    return j && j.phase === 'stopped' && this.monitor?.phase === 'stopped' ? j : null;
  }

  /** At a stop: carry on from here. */
  private continueJob(): CareerAnswer {
    const j = this.stopped();
    if (!j) return this.refuse('No job is stopped');
    this.monitor!.continueJob();
    this.leftStop(j.stoppedAt ?? null);
    this.ui?.close();
    return 'ok';
  }

  /** At a stop: re-place at the stand with `fuelKg` aboard (the stop's price), then carry on. */
  async refuel(fuelKg: number): Promise<CareerAnswer> {
    const j = this.stopped();
    if (!j) return this.refuse('No job is stopped');
    const m = this.monitor!;
    const perf = CAREER_PERF[j.type];
    const aboard = fuelOnBoardKg(this.shell.physics.state);
    const zfw = perf.emptyKg + OCCUPANT_KG + j.items.reduce((a, it) => a + it.kg, 0);
    const maxFuel = Math.max(aboard, Math.min(perf.usableFuelKg, perf.mtowKg - zfw));
    if (!(fuelKg > aboard) || fuelKg > maxFuel + 1e-9) return this.refuse('Choose more fuel than is aboard, up to what the load allows');
    const f = fieldByCode(j.stoppedAt!, this.fields());
    const next = clone(this.save!);
    const nj = next.active!;
    const ch = nj.charges ?? { fuelUsd: 0, defuelCreditUsd: 0, stopFeesUsd: 0 };
    nj.charges = { ...ch, fuelUsd: ch.fuelUsd + fuelCost(fuelKg - aboard, perf.fuel, f?.kind ?? 'sealed') };
    nj.fuelKg = fuelKg;
    nj.elapsedS = m.elapsedS;
    this.commit(next);
    this.leftStop(j.stoppedAt ?? null);
    this.ui?.close();
    const ok = await this.placeActive(false);
    if (!ok || this.monitor !== m) return 'The job could not be placed';
    m.continueJob();
    this.syncJob(true);
    return 'placed';
  }

  // ------------------------------------------------------------------------------------------- commands

  /** Open a Career page (the hub by default), reconciling a job nobody watches first. */
  open(page: CareerPage | 'reposition' = 'hub'): void {
    this.reconcileOrphan();
    this.refresh();
    this.ui?.open(page);
  }

  /** Close the pages. */
  close(): void {
    this.ui?.close();
  }

  /** A command from the pages or automation (see CareerCommand). */
  command(cmd: CareerCommand): void {
    void this.run(cmd);
  }

  /** A command, with its answer ('ok', 'placed', 'reloading' or the refusal's text). */
  async run(cmd: CareerCommand): Promise<CareerAnswer> {
    const answer = await this.dispatchCommand(cmd);
    this.refresh();
    return answer;
  }

  private async dispatchCommand(cmd: CareerCommand): Promise<CareerAnswer> {
    const s = this.save;
    switch (cmd.kind) {
      case 'open':
        this.reconcileOrphan();
        if (!this.ui) return 'ok';
        if (this.ui.page() !== (cmd.page ?? 'hub')) this.ui.open(cmd.page ?? 'hub');
        return 'ok';
      // The pages navigate on their own for these (CareerUi.send); from automation the system does it.
      case 'close':
        this.ui?.close();
        return 'ok';
      case 'dispatch':
        if (this.ui && this.ui.page() !== 'dispatch') {
          this.ui.setDispatchOffer(cmd.offerId);
          this.ui.open('dispatch');
        }
        return 'ok';
      case 'freeFlight':
        this.ui?.close();
        return this.freeFlight();
      case 'declareLicence':
        this.declared = true;
        return 'ok';
      case 'create':
        return this.create(cmd);
      case 'select': {
        if (!s) return this.refuse('Start a career first');
        if (s.active) return this.refuse('One job at a time: the job’s aircraft stays selected until it ends');
        if (!s.fleet.some((a) => a.uid === cmd.uid)) return this.refuse('No such aircraft');
        this.store.saveSoon({ ...clone(s), selectedUid: cmd.uid });
        return 'ok';
      }
      case 'accept':
        return this.accept(cmd.offerId, cmd.uid, cmd.fuelKg);
      case 'reposition':
        return this.reposition(cmd.to);
      case 'switchTo': {
        const j = s?.active;
        if (!j || j.placed || j.type === this.bootedType) return this.refuse('No job waits for another type');
        if (this.store.kind === 'mem' || !this.shell.setAircraft) return this.refuse('A type switch needs a reload, and this career is kept in memory only');
        this.commit(s!);
        this.store.flush();
        this.shell.setAircraft(j.type, { open: 'career' });
        return 'reloading';
      }
      case 'abandon':
        if (!s?.active) return this.refuse('No job to abandon');
        return this.abandonJob(false) ? 'ok' : 'Land first';
      case 'continueJob':
        return this.continueJob();
      case 'refuel':
        return this.refuel(cmd.fuelKg);
      case 'giveUp': {
        this.syncJob(false);
        const j = this.save?.active;
        if (!j || j.phase !== 'stopped') return this.refuse('No job is stopped');
        const m = this.monitor;
        this.detachMonitor();
        const r = m ? { ...m.report('diverted', j.stoppedAt ?? null) } : blankReport('diverted', j.lastKnown, j.elapsedS, j.fuelKg, j.stoppedAt ?? null, j.offer.waypoints?.length ?? 0);
        this.settle(r, 'debrief');
        return 'ok';
      }
      case 'rest':
        return this.restUntilTomorrow();
      case 'defuel':
        return this.progress(s && defuelAircraft(s, cmd.uid, cmd.fuelKg));
      case 'buyRating':
        return this.progress(s && buyRating(s, cmd.rating));
      case 'lease':
        return this.progress(s && leaseAircraft(s, cmd.type, this.authority()));
      case 'buy':
        return this.progress(s && buyAircraft(s, cmd.type, this.authority()));
      case 'sell':
        return this.progress(s && sellAircraft(s, cmd.uid));
      case 'returnLease':
        return this.progress(s && returnLease(s, cmd.uid));
      case 'settings': {
        if (!s) return 'ok';
        const next = clone(s);
        next.settings = { ...next.settings, ...cmd.settings };
        const name = cmd.companyName?.replace(/\s+/g, ' ').trim();
        if (name) next.company.name = name;
        if (cmd.callsign !== undefined) next.company.callsign = normaliseCallsign(cmd.callsign, next.company.name);
        this.store.saveSoon(next);
        return 'ok';
      }
      case 'switchWorld':
        if (!s || !this.shell.setSeed) return this.refuse('The world cannot be switched from here');
        this.store.flush();
        this.shell.setSeed(s.seed);
        return 'reloading';
      case 'exportSave': {
        if (!s) return 'ok';
        if (!this.shell.download) return this.refuse('Export is not available here');
        const now = new Date(this.shell.now?.() ?? Date.now());
        this.shell.download(careerExportFileName(s, now), this.store.exportJson(s, APP_BUILD, now));
        return 'ok';
      }
      case 'importSave':
        return this.importSave(cmd.json);
      case 'bankruptcy':
        if (cmd.choice === 'restart') return this.newCareer();
        return this.progress(s && bankruptcySellOwned(s), 'hub');
      case 'settlePending':
        this.settlePending(cmd.then);
        return 'ok';
      case 'reset':
        return this.newCareer();
    }
  }

  /** Apply a progression action's result (toast its refusal); `page` opens after a success. */
  private progress(r: ProgressionResult | null, page?: CareerPage): CareerAnswer {
    if (!r) return this.refuse('Start a career first');
    if (!r.ok) return this.refuse(r.text);
    this.commit(r.save);
    if (page) this.ui?.open(page);
    return 'ok';
  }

  /** Free flight: the pages close; with no job, Career mode ends (the start field becomes the aircraft's). */
  private freeFlight(): CareerAnswer {
    const s = this.save;
    if (!s || s.active || isBankrupt(s)) return 'ok';
    const ac = selectedOf(s);
    if (ac && s.seed === this.seedNow()) setStartField(startFieldOf(ac.field));
    if (s.inCareer) this.store.saveSoon({ ...clone(s), inCareer: false });
    return 'ok';
  }

  /** A new career from the form (refused while one exists or without a licence). */
  private create(cmd: Extract<CareerCommand, { kind: 'create' }>): CareerAnswer {
    if (this.save) return this.refuse('A career exists already');
    const licence = this.licence();
    if (!licence) return this.refuse('A licence is needed first');
    const save = this.store.create(
      { pilotName: cmd.pilotName, companyName: cmd.companyName, callsign: cmd.callsign, start: cmd.start },
      { seed: this.seedNow(), licence, authority: this.authority(), homeCode: HOME_AIRFIELD.code, now: this.shell.now?.() ?? Date.now() },
    );
    this.commit(save);
    this.ui?.open('hub');
    return 'ok';
  }

  /** "Start a new career" (the seed page, the bankruptcy page): the old save and any job go; the form opens. */
  private newCareer(): CareerAnswer {
    const s = this.save;
    if (s?.pilot.licence === 'declared') this.declared = true;
    this.dropLiveJob();
    this.store.reset();
    this.boardCache = null;
    this.shell.persist();
    this.ui?.open('create');
    return 'ok';
  }

  /** Forget a watched job without settling it (the save it belonged to is being replaced). */
  private dropLiveJob(): void {
    const j = this.save?.active;
    if (j && this.monitor) this.restorePlayerWeather(j);
    this.detachMonitor();
    this.ui?.setStrip(null);
  }

  private importSave(json: string): CareerAnswer {
    try {
      this.store.previewImport(json);   // throws with the reason; nothing is written
    } catch (e) {
      return this.refuse((e as Error).message);
    }
    this.dropLiveJob();
    this.store.importJson(json);
    this.boardCache = null;
    this.shell.persist();
    this.toast('Career imported');
    this.open('hub');
    return 'ok';
  }

  /** Rest until tomorrow: a stopped job is given up first (settled with its own idle line), then the clock moves on. */
  private restUntilTomorrow(): CareerAnswer {
    this.syncJob(false);
    let s = this.save;
    if (!s) return this.refuse('Start a career first');
    let settled: Settlement | null = null;
    const j = s.active;
    if (j?.phase === 'stopped') {
      const m = this.monitor;
      this.detachMonitor();
      const r = m ? m.report('diverted', j.stoppedAt ?? null) : blankReport('diverted', j.lastKnown, j.elapsedS, j.fuelKg, j.stoppedAt ?? null, j.offer.waypoints?.length ?? 0);
      settled = this.settle(r, null);
      s = this.save!;
    }
    const r = rest(s, this.fields());
    if (!r.ok) return this.refuse(r.text);
    this.commit(r.save);
    if (settled) this.ui?.open('debrief');
    return 'ok';
  }

  // ------------------------------------------------------------------------------------------- shell links

  /**
   * The crash dialog's actions while a job is placed (Debrief, Career hub), else null so the school's (or the
   * generic dialog) answers. Chain it before the school's (index.ts chainCrashActions).
   */
  crashActions(reason: string): CrashAction[] | 'none' | null {
    void reason;
    const j = this.save?.active;
    if (!j || !j.placed || this.inLesson() || this.unwatched()) return null;
    return [
      { label: 'Debrief', primary: true, keys: ['Enter', 'NumpadEnter'], run: () => this.command({ kind: 'settlePending', then: 'debrief' }) },
      { label: 'Career hub', run: () => this.command({ kind: 'settlePending', then: 'hub' }) },
    ];
  }

  /**
   * Shift+R (and any reset from outside the Career) while a job is in progress: asks "Abandon the job?" and on yes
   * abandons it and runs `proceed`. Returns false when no job is in progress (the caller resets as usual).
   */
  confirmReset(proceed: () => void): boolean {
    if (!this.jobActive()) return false;
    const yes = (): void => {
      this.abandonJob(true, null);
      proceed();
    };
    if (this.shell.confirm) this.shell.confirm('Abandon the job?', yes);
    else if ((globalThis as { confirm?: (t: string) => boolean }).confirm?.('Abandon the job?')) yes();
    return true;
  }

  /**
   * Automation only (`__sim.career.testArrive`, cstore=mem or session): the job's aircraft stands cold at the
   * destination's stand and the job completes there as a test (logged "(test)").
   */
  async testArrive(): Promise<CareerAnswer> {
    const j = this.save?.active;
    if (this.store.kind === 'local') return this.refuse('testArrive needs cstore=mem or cstore=session');
    if (!j || !j.placed || !this.monitor || j.type !== this.bootedType) return this.refuse('No job in progress');
    const dest = j.offer.destination.kind === 'field' ? j.offer.destination.code : j.offer.origin;
    const m = this.monitor;
    const fuel = fuelOnBoardKg(this.shell.physics.state);
    const sc = placementScenario({ field: dest, loading: j.loading ?? careerLoading(this.def(), j.items), fuelKg: fuel, jobId: j.offer.id }, this.def(), this.shell.physics.env, this.fields());
    this.placing = true;
    try {
      await this.shell.startFrom(sc, { lessonId: placementLessonId(j.offer.id), label: PLACEMENT_LABEL });
    } finally {
      this.placing = false;
    }
    if (this.monitor !== m) return 'The job ended meanwhile';
    this.detachMonitor();
    const st = this.shell.physics.state;
    m.update(0, { state: st, controls: this.shell.physics.controls, weather: this.shell.weather, env: this.shell.physics.env });
    const r: JobFlightReport = { ...m.report('completed', dest), fuelAtEndKg: fuel, onApron: true, onRunway: false, test: true };
    r.waypointsDone = r.waypointsTotal;
    this.settle(r, 'debrief');
    return 'ok';
  }

  // ------------------------------------------------------------------------------------------- inside

  /** Save at once, persist (the snapshot asks resumeBlock()), and refresh the pages. */
  private commit(save: CareerSave): void {
    this.store.save(save);
    this.shell.persist();
    this.refresh();
  }

  /** The pages' model again (cheap; the board is cached per day and field). */
  refresh(): void {
    this.ui?.setModel(this.uiModel());
  }
}

/** The selected fleet aircraft, or null. */
function selectedOf(s: CareerSave): FleetAircraft | null {
  return s.fleet.find((a) => a.uid === s.selectedUid) ?? null;
}

/** setStartField's argument for a field code: null at home. */
function startFieldOf(code: string): string | null {
  return code === HOME_AIRFIELD.code ? null : code;
}

/** The types a CareerAircraftId list may hold (for callers narrowing an AircraftId). */
export function isCareerType(id: AircraftId): id is CareerAircraftId {
  return id in CAREER_PERF;
}
