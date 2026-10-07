// The Flight School UI (section 5): mounts under UISystem's school layer, renders the welcome card, home,
// syllabus, challenges, briefing, debrief, logbook, licence and settings screens, and the in-flight strip,
// card, captions, instrument highlight, hood and follow-through label from the models the runner publishes.
// User actions leave through onCommand as SchoolCommand.
//
// Wiring (TrainingSystem, wave 2):
//   const school = new SchoolUi(ui.schoolLayer, { ...storeServices });  // progress fns default to module 2
//   ui.attachSchool(school);          // projection for highlight/hood, per-frame update, HUD offset, menu tab
//   school.onCommand = (cmd) => ...;  school.setCareer({...});  school.open('home' | 'welcome')
//
// Navigation that is purely the UI's own happens here at once: hub screens switch locally; 'closeSchool' and
// 'dismissWelcome' close the modal; 'home' / 'openHome' / 'createProfile' open the home screen. Everything else
// (briefing, flight, debrief) waits for TrainingSystem to call showBriefing / hideBriefing / showDebrief...
//
// Keyboard: while a modal screen is open, SchoolUi captures keys on window (after UISystem's own capture
// listener, which owns the pause menu) so the flight controls never see them; text fields still get their
// characters. Buttons never keep focus, and focus is dropped when a screen closes.

import { lessonStatuses, missingPrerequisites, nextLesson, rank } from '../../training/career/progress';
import { totals } from '../../training/career/totals';
import type {
  BriefingModel, CalloutModel, Caption, CardModel, DebriefModel, InstrumentId, Lesson, LessonStripModel, PointTarget, SchoolCommand,
  TaxiGuideModel, TrainingUiPort,
} from '../../training/types';
import { el } from '../dom';
import { Toasts } from '../overlays';
import { renderBriefing } from './briefing';
import { ControlCallout, type CalloutProjector } from './callout';
import { CaptionBar } from './captions';
import { checklistItemKeys } from './checklistKeys';
import { renderDebrief } from './debrief';
import { InstrumentHighlight } from './highlight';
import { renderHome } from './home';
import { glareshieldY, Hood } from './hood';
import { guidedCaps, LessonCard } from './lessonCard';
import { LessonStrip } from './lessonStrip';
import { renderLicence } from './licence';
import { renderLogbook } from './logbook';
import { renderMenuPage } from './menuPage';
import type { HoodMode, SchoolCareer, SchoolScreen, SchoolUiDeps, SchoolViewHost } from './models';
import { SCHOOL_CSS } from './schoolStyles';
import { renderSettings } from './settings';
import { renderChallenges, renderSyllabus } from './syllabus';
import { TaxiHud } from './taxiHud';
import { renderWelcome } from './welcome';
import { typing, type ScreenCtx, type ScreenView } from './widgets';

export type { SchoolScreen } from './models';

/** Lesson card cycle on Tab (section 5.4): strip only -> strip and card -> nothing. */
export type CardMode = 'compact' | 'expanded' | 'hidden';

/** The in-flight models are applied at most this often (section 8: strip DOM at 10 Hz, only on change). */
const MODEL_PERIOD_MS = 100;

const EMPTY_CAREER: SchoolCareer = { save: null, syllabus: [], challenges: [], authority: 'easa', storage: 'ok', resume: null, voices: [] };

export class SchoolUi implements TrainingUiPort {
  /** Wired by TrainingSystem. */
  onCommand?: (cmd: SchoolCommand) => void;
  /** Told whenever the open modal screen changes (null: closed), e.g. to pause and hold the sim. */
  onScreenChange?: (screen: SchoolScreen | null) => void;
  /** Where toasts go (UISystem.attachSchool routes them to the shell's toasts); a local stack otherwise. */
  toastSink: ((text: string) => void) | null = null;

  readonly root: HTMLElement;
  private readonly deps: SchoolUiDeps;
  private readonly flight: HTMLElement;
  private readonly modalHost: HTMLElement;
  private readonly hood: Hood;
  private readonly highlight: InstrumentHighlight;
  private readonly strip: LessonStrip;
  private readonly card: LessonCard;
  private readonly captions: CaptionBar;
  private readonly follow: HTMLElement;
  private readonly callout: ControlCallout;
  private readonly taxi: TaxiHud;
  private projector: CalloutProjector | null = null;
  private localToasts: Toasts | null = null;
  private view: SchoolViewHost | null = null;
  private career: SchoolCareer = EMPTY_CAREER;
  private current: { screen: SchoolScreen; view: ScreenView } | null = null;
  private briefing: BriefingModel | null = null;
  private debrief: DebriefModel | null = null;
  private stripModel: LessonStripModel | null = null;
  private cardModel: CardModel | null = null;
  private dirty = false;
  private lastApply = 0;
  private cardMode: CardMode = 'compact';
  private followMe = false;
  /** The lesson last briefed (the menu's objective). */
  private lesson: Lesson | null = null;

  constructor(root: HTMLElement, deps: Partial<SchoolUiDeps> = {}) {
    this.deps = { lessonStatuses, missingPrerequisites, nextLesson, rank, totals, ...deps };
    if (!document.getElementById('fsui-school-style')) {
      const style = el('style', undefined, document.head, SCHOOL_CSS);
      style.id = 'fsui-school-style';
    }
    this.root = el('div', 'sc-layer', root);
    // In-flight layer first (under the modals): hood, highlight rings, strip, card, captions, labels.
    this.flight = el('div', 'sc-layer', this.root);
    this.hood = new Hood(this.flight);
    this.highlight = new InstrumentHighlight(this.flight);
    this.strip = new LessonStrip(this.flight);
    this.card = new LessonCard(this.flight);
    this.captions = new CaptionBar(this.flight);
    this.taxi = new TaxiHud(this.flight);
    this.callout = new ControlCallout(this.flight);
    this.follow = el('div', 'sc-follow hidden', this.flight, 'FOLLOW ME THROUGH');
    this.modalHost = el('div', 'sc-layer', this.root);
    window.addEventListener('keydown', this.onKeyCapture, true);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyCapture, true);
    this.callout.dispose();
    this.current?.view.dispose?.();
    this.root.remove();
  }

  // ---- Career and view -------------------------------------------------------------------------------

  /** New career data: the open hub screen re-renders (briefing and debrief keep their models). */
  setCareer(c: SchoolCareer): void {
    this.career = c;
    this.captions.enabled = c.save ? c.save.settings.voice.captions || c.save.settings.voice.captionsOnly : true;
    const s = this.current?.screen;
    if (s && s !== 'briefing' && s !== 'debrief') this.open(s);
  }

  get careerData(): SchoolCareer {
    return this.career;
  }

  /** A training profile exists (the shell suppresses its first-flight hints then). */
  get hasProfile(): boolean {
    return !!this.career.save;
  }

  /** UISystem provides the panel projection (highlight rings, hood line). */
  setView(v: SchoolViewHost | null): void {
    this.view = v;
  }

  // ---- Screens ---------------------------------------------------------------------------------------

  /** The open modal screen, or null in flight / free flight. */
  get screen(): SchoolScreen | null {
    return this.current?.screen ?? null;
  }

  open(screen: SchoolScreen): void {
    if (screen === 'briefing' && !this.briefing) return;
    if (screen === 'debrief' && !this.debrief) return;
    const prev = this.current?.screen ?? null;
    this.current?.view.dispose?.();
    this.modalHost.replaceChildren();
    const sc = this.screenCtx();
    let view: ScreenView;
    switch (screen) {
      case 'welcome': view = renderWelcome(this.modalHost, sc); break;
      case 'home': view = renderHome(this.modalHost, sc); break;
      case 'syllabus': view = renderSyllabus(this.modalHost, sc); break;
      case 'challenges': view = renderChallenges(this.modalHost, sc); break;
      case 'briefing': view = renderBriefing(this.modalHost, sc, this.briefing!); break;
      case 'debrief': view = renderDebrief(this.modalHost, sc, this.debrief!); break;
      case 'logbook': view = renderLogbook(this.modalHost, sc); break;
      case 'licence': view = renderLicence(this.modalHost, sc); break;
      case 'settings': view = renderSettings(this.modalHost, sc); break;
    }
    this.current = { screen, view };
    this.flight.classList.add('hidden');
    if (prev !== screen) this.onScreenChange?.(screen);
  }

  close(): void {
    if (!this.current) return;
    this.current.view.dispose?.();
    this.current = null;
    this.modalHost.replaceChildren();
    this.flight.classList.remove('hidden');
    this.dropFocus();
    this.onScreenChange?.(null);
  }

  // ---- TrainingUiPort --------------------------------------------------------------------------------

  showBriefing(m: BriefingModel): void {
    this.briefing = m;
    this.lesson = m.lesson;
    this.open('briefing');
  }

  hideBriefing(): void {
    if (this.current?.screen === 'briefing') this.close();
  }

  setStrip(m: LessonStripModel | null): void {
    this.stripModel = m;
    this.dirty = true;
    if (!m) this.applyModels();
  }

  setCard(m: CardModel | null): void {
    this.cardModel = m;
    this.dirty = true;
    if (!m) this.applyModels();
  }

  showDebrief(m: DebriefModel): void {
    this.debrief = m;
    this.open('debrief');
  }

  hideDebrief(): void {
    if (this.current?.screen === 'debrief') this.close();
  }

  /**
   * A new caption. `opts.safety` draws a Safety-priority line in red (the Caption type carries no priority:
   * TrainingSystem passes it from the SpeechRequest).
   */
  showCaption(c: Caption, opts: { safety?: boolean } = {}): void {
    this.captions.show(c, !!opts.safety, performance.now() / 1000);
  }

  setHighlight(ids: readonly InstrumentId[]): void {
    this.highlight.set(ids);
  }

  /** The control the instructor is pointing at (callout with state, key and why), or null. */
  setCallout(c: CalloutModel | null): void {
    this.callout.set(c);
  }

  /** The taxi guidance HUD, or null. */
  setTaxiGuide(m: TaxiGuideModel | null): void {
    this.taxi.set(m);
  }

  /**
   * Where each control is on screen (TrainingSystem projects the cockpit's control positions), and the camera
   * glance toward an off-screen one (null target: look back).
   */
  setCalloutView(project: CalloutProjector | null, glance: ((target: PointTarget | null) => boolean | void) | null): void {
    this.projector = project;
    this.callout.onGlance = glance;
  }

  /** Automation: the callout and taxi HUD on screen, and the glance in progress. */
  get guidanceState(): { callout: CalloutModel | null; taxi: TaxiGuideModel | null; glancing: string | null } {
    return { callout: this.callout.current, taxi: this.taxi.current, glancing: this.callout.glancing };
  }

  setFollowMeThrough(on: boolean): void {
    this.followMe = on;
    this.follow.classList.toggle('hidden', !on);
  }

  toast(text: string): void {
    if (this.toastSink) {
      this.toastSink(text);
      return;
    }
    this.localToasts ??= new Toasts(this.root);
    this.localToasts.show(text);
  }

  // ---- Beyond the port -------------------------------------------------------------------------------

  /** Instrument hood or "close your eyes" (SetupStep.hood; the unusual-attitude set-up). */
  setHood(mode: HoodMode): void {
    this.hood.set(mode);
  }

  /** Tab during a lesson (section 5.9): strip -> strip and card -> hidden. Returns the new mode. */
  cycleCard(): CardMode {
    this.cardMode = this.cardMode === 'compact' ? 'expanded' : this.cardMode === 'expanded' ? 'hidden' : 'compact';
    this.applyModels();
    return this.cardMode;
  }

  get cardState(): CardMode {
    return this.cardMode;
  }

  /** A lesson is being flown (the runner publishes a strip). */
  get lessonActive(): boolean {
    return !!this.stripModel;
  }

  /** The strip is on screen (the HUD moves down below it). */
  get stripVisible(): boolean {
    return this.strip.visible && !this.current;
  }

  get followMeThrough(): boolean {
    return this.followMe;
  }

  /** The instructor has control in a lesson (her hold, a recovery, a demonstration): no trim hints for the student. */
  get instructorFlying(): boolean {
    const a = this.stripModel?.authority;
    return a === 'instructor' || a === 'followMe' || a === 'offered';
  }

  /** The text on the caption bar now (automation), or null. */
  get captionText(): string | null {
    return this.captions.visibleText;
  }

  /** Fill the pause menu's School tab (section 5.6); `close` closes the menu. */
  renderMenuPage(parent: HTMLElement, close: () => void): void {
    // After a reload the lesson resumes without a briefing: find it in the syllabus for the objective.
    const id = this.stripModel?.lessonId;
    const lesson = !id ? null : this.lesson?.id === id ? this.lesson : this.career.syllabus.find((l) => l.id === id) ?? null;
    renderMenuPage(parent, this.screenCtx(), {
      strip: this.stripModel, card: this.cardModel, lesson, captions: this.captions.log,
    }, close);
  }

  /** Send a command as if a screen had (the menu's School tab, the shell's lesson crash panel). */
  command(cmd: SchoolCommand): void {
    this.send(cmd);
  }

  /** Per frame (wall time): in-flight models at 10 Hz, caption fades, highlight and hood projection. */
  update(dt: number): void {
    void dt; // Wall time is read directly so a second caller cannot speed the fades up.
    const now = performance.now();
    if (this.dirty && now - this.lastApply >= MODEL_PERIOD_MS) this.applyModels();
    this.captions.update(now / 1000, this.current ? null : glareshieldY(this.view));
    if (!this.current) {
      this.highlight.update(this.view);
      this.hood.update(this.view);
      this.callout.update(this.projector, !!this.view?.cockpit(), this.root.clientWidth || window.innerWidth, this.root.clientHeight || window.innerHeight);
    }
  }

  // ---- Internals -------------------------------------------------------------------------------------

  private applyModels(): void {
    this.dirty = false;
    this.lastApply = performance.now();
    const s = this.stripModel;
    this.strip.visible = !!s && this.cardMode !== 'hidden';
    if (s) this.strip.render(s);
    const c = this.cardModel;
    this.card.visible = !!c && !!s && this.cardMode === 'expanded';
    if (c && this.card.visible) this.card.render(c);
    // A running checklist: the compact strip names the item being challenged and its key (the card lists
    // them all when it is open).
    const item = !this.card.visible ? c?.checklist?.items.find((i) => i.state === 'active') : undefined;
    this.strip.setPrompt(item ? { text: item.required ? `${item.label.split(':')[0]} → ${item.required}` : item.label, keys: item.key ? guidedCaps(item.key) : checklistItemKeys(item.id) } : null);
    // The expanded card lists the latest captions itself; the bar would only cover it.
    this.captions.root.classList.toggle('hidden', this.card.visible);
  }

  private screenCtx(): ScreenCtx {
    return {
      career: this.career,
      deps: this.deps,
      send: (cmd) => this.send(cmd),
      go: (screen) => this.open(screen),
      toast: (t) => this.toast(t),
    };
  }

  private send(cmd: SchoolCommand): void {
    // The UI's own share of a command first, so the screen never waits on a missing handler.
    switch (cmd.kind) {
      case 'closeSchool':
      case 'dismissWelcome':
        this.close();
        break;
      case 'home':
      case 'openHome':
      case 'createProfile':
        this.open('home');
        break;
    }
    this.onCommand?.(cmd);
  }

  private dropFocus(): void {
    const a = document.activeElement as HTMLElement | null;
    if (a && this.root.contains(a)) a.blur();
  }

  private readonly onKeyCapture = (e: KeyboardEvent): void => {
    const cur = this.current;
    if (!cur) return;
    if (typing(e)) {
      // Text fields keep their characters; Enter commits (blur fires 'change') and Esc leaves the field.
      if (e.code === 'Escape' || e.code === 'Enter' || e.code === 'NumpadEnter') {
        (e.target as HTMLElement).blur();
        if (e.code === 'Escape') {
          e.preventDefault();
          e.stopImmediatePropagation();
          return;
        }
      } else {
        e.stopImmediatePropagation();
        return;
      }
    }
    if (cur.view.onKey?.(e)) e.preventDefault();
    // Browser defaults that would hurt here: F1-F6 (help, find, reload...) and Tab focus traversal.
    if (/^F[1-6]$/.test(e.code) || e.code === 'Tab') e.preventDefault();
    e.stopImmediatePropagation();
  };
}
