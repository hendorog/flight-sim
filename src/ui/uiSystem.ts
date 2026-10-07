// DOM user interface layered over the 3D canvas: HUD, pause menu, loading screen, crash dialog, toasts
// and the frame-time readout.
//
// Keyboard: the UI only listens for its own hotkeys (menu, HUD, FPS) and never takes focus while the menu
// is closed; every UI element that could hold focus is hidden then, and focus is dropped when the menu or
// dialog closes. While the menu is open, key events are stopped in the capture phase so flight controls
// do not react to typing in the menu. While the crash dialog is open, Enter, R and Shift+R restart the
// scenario that crashed and Escape dismisses the dialog (a CRASHED chip then keeps the restart key on screen).
//
// Pilot cues for every view (the HUD is for external views only): the parking-brake / crashed annunciators,
// a control-position widget while flying with the keyboard, toasts for switch and mixture changes, advice
// when the starter is held but an engine cannot start, and the engine-start card when the engines are off.
//
// The type flown: what the UI says and shows of it comes from ctx.aircraft / ctx.presentation, read once in
// init() (its UiProfile: switches, levers, read-outs, start-up card, hints; its reference speeds, resting
// height and limits for the HUD; its panel for the cockpit clicks unless the `panel` option names one). A
// context without them (test fakes) gets the Cessna 172S, as does everything built before init().
//
// Flight School (section 5): `schoolLayer` is the mount point for SchoolUi (above the HUD and cockpit cues,
// below toasts, the crash dialog, the menu and the loading screen). attachSchool() wires it in: per-frame
// update, the panel projection for instrument rings and the hood, the HUD moved below the lesson strip, the
// control widget forced visible while the instructor flies ("follow me through"), the menu's School tab,
// and the first-flight hints suppressed once a training profile exists. `crashActions` lets the school
// replace the crash dialog's buttons during a lesson.

import { C172S_UI } from '../aircraft/c172s/ui';
import type { AircraftDefinition, AircraftPresentation, AircraftSummary, UiProfile } from '../aircraft/types';
import type { CameraMode, ScenarioId, SimContext, Subsystem } from '../core/context';
import { engineControl, type AircraftState } from '../core/types';
import type { InputAction } from '../input/bindings';
import type { PanelDef } from '../instruments/panelDef';
import { CockpitClicks } from './cockpitClicks';
import { mixtureLabel, switchMessages, switchReads } from './cues';
import { el, setText } from './dom';
import type { GamepadSettings } from './gamepadPage';
import { Hud } from './hud';
import { PauseMenu, type AutopilotLink, type KeyBinding, type MenuHost, type MenuTab, type ResumePreferenceLink, type SchoolMenuLink } from './menu';
import { CrashDialog, FpsMeter, HintsCard, LoadingScreen, Toasts, type CrashAction } from './overlays';
import type { SchoolUi } from './school/schoolUi';
import { Annunciators, ControlsWidget, type WidgetAircraft, type YokeSource } from './status';
import { UI_CSS } from './styles';

export interface UIHotkeys {
  /** KeyboardEvent.code that toggles the pause menu. null disables. Default 'Escape'. */
  menu?: string | null;
  /** Toggles the external-view HUD. Default 'F9'. */
  hud?: string | null;
  /** Toggles the FPS readout. Default 'F8'. */
  fps?: string | null;
}

export interface UISystemOptions {
  /** Key-binding reference shown in the Controls tab. */
  bindings: KeyBinding[];
  /** Loading-screen and menu title: the name of the type flown (the UI is constructed before the context exists). Absent: today's text. */
  title?: string;
  hotkeys?: UIHotkeys;
  /** Element to mount into. Default document.body. */
  parent?: HTMLElement;
  /**
   * First-flight hints card after loading: 'auto' (default) shows it once per browser unless the page is
   * driven by automation (navigator.webdriver) or the URL has hints=0; hints=1 in the URL forces it.
   */
  hints?: 'auto' | 'always' | 'never';
  /**
   * Scenario flying at start-up (what the crash dialog restarts until the next 'reset' event). Default: the
   * URL's scenario= parameter, else 'runway'. The shell can also set UISystem.scenario.
   */
  scenario?: ScenarioId;
  /**
   * Holds or releases a momentary action of the cockpit clicks (START, PUSH-TO-TEST, DG align) for one engine:
   * the shell passes InputSystem.hold (request B-B5a-m-01). Absent: the click presses the action's key, whose
   * engine is then the keyboard's selection.
   */
  hold?: (action: InputAction, down: boolean, engine?: number) => void;
  /** The panel on the cockpit's 3D face, whose switches and knobs the clicks operate. Absent: ctx.presentation.panel (the C172S's without one). */
  panel?: PanelDef;
}

const SCENARIO_NAMES: Record<ScenarioId, string> = {
  runway: 'runway',
  apron: 'apron',
  final: 'final approach',
  cruise: 'cruise',
  downwind: 'downwind',
};
function isScenario(s: string | null | undefined): s is ScenarioId {
  return !!s && Object.prototype.hasOwnProperty.call(SCENARIO_NAMES, s);
}

/** How far the HUD's top-centre elements move down while the lesson strip is shown, px. */
const STRIP_CLEARANCE = 62;

/** Seconds of cranking before the UI explains why the engine does not start. */
const STARTER_ADVICE_DELAY_S = 1.2;

/** Some engine runs (engine 0 is also engines[0]). */
function anyEngineRunning(s: AircraftState): boolean {
  if (s.engine.running) return true;
  for (const e of s.engines) if (e.running) return true;
  return false;
}

const CAMERA_NAMES: Record<CameraMode, string> = {
  cockpit: 'Cockpit',
  chase: 'Chase',
  orbit: 'Orbit',
  flyby: 'Fly-by',
  tower: 'Tower',
};

export class UISystem implements Subsystem, MenuHost {
  readonly root: HTMLDivElement;
  private readonly hud: Hud;
  private readonly loading: LoadingScreen;
  private readonly toasts: Toasts;
  private readonly fps: FpsMeter;
  private readonly crash: CrashDialog;
  private readonly pausedBadge: HTMLElement;
  private readonly apChip: HTMLElement;
  private readonly hints: HintsCard;
  private readonly hintsMode: 'auto' | 'always' | 'never';
  /** Built in init(), from the flown type's panel. */
  private clicks: CockpitClicks | null = null;
  private readonly panel: PanelDef | undefined;
  private readonly hold: UISystemOptions['hold'];
  private menu: PauseMenu | null = null;
  private gamepads: GamepadSettings | null = null;
  private autopilotLink: AutopilotLink | null = null;
  /** Show the PAUSED badge while paused (the shell turns it off for frozen screenshots). */
  pausedBadgeEnabled = true;
  private context: SimContext | null = null;
  private readonly hotkeys: Required<UIHotkeys>;
  private readonly bindings: KeyBinding[];
  private readonly unsubscribe: (() => void)[] = [];
  private hudOn = true;
  private weatherDirty = false;
  private pausedBeforeMenu = false;
  private lastScenario: ScenarioId;
  private lastParkingBrake: boolean | null = null;
  /** The flown type's UiProfile (switches, starter advice), and its engine count. */
  private profile: UiProfile = C172S_UI;
  private engineCount = 1;
  private lastSwitches: string[] | null = null;
  private spareSwitches: string[] | undefined;
  /** Mixture per engine at the last frame; NaN = not yet seen. */
  private lastMixture: number[] = [NaN];
  private starterSince = -1;
  /** Re-evaluate the engine-start card on the next frame (after load and after each reset). */
  private startupCheck = false;
  /** The hints card was opened for the engine start only (hide it once the engine runs). */
  private hintsForStartup = false;
  private startupShown = false;
  private readonly annunciators: Annunciators;
  private readonly controlsWidget: ControlsWidget;
  /** Mount point of the Flight School UI (see the header). */
  readonly schoolLayer: HTMLDivElement;
  private schoolUi: SchoolUi | null = null;
  private yokeSource: (() => YokeSource) | null = null;
  /**
   * During a lesson the school can replace the crash dialog: an action set (the lesson crash panel), or
   * 'none' when the lesson ends on a crash without a dialog (solo, check, test). null: the generic dialog.
   */
  crashActions: ((reason: string) => CrashAction[] | 'none' | null) | null = null;

  constructor(opts: UISystemOptions) {
    this.bindings = opts.bindings;
    this.hotkeys = { menu: 'Escape', hud: 'F9', fps: 'F8', ...opts.hotkeys };
    if (!document.getElementById('fsui-style')) {
      const style = el('style', undefined, document.head, UI_CSS);
      style.id = 'fsui-style';
    }
    this.root = el('div', undefined, opts.parent ?? document.body);
    this.root.id = 'fsui';
    this.hud = new Hud(this.root);
    this.hud.visible = false;
    this.pausedBadge = el('div', 'chip info paused-badge hidden', this.root, 'PAUSED');
    this.apChip = el('div', 'chip ap ap-badge hidden', this.root, 'AP');
    this.annunciators = new Annunciators(this.root);
    this.controlsWidget = new ControlsWidget(this.root);
    this.panel = opts.panel;
    this.hold = opts.hold;
    this.schoolLayer = el('div', 'school-layer', this.root);
    this.schoolLayer.style.cssText = 'position:absolute;inset:0;pointer-events:none';
    // The control widget reads the yoke source through this wrapper, which also forces it visible while the
    // instructor flies (a "mouse yoke" reading shows it and keeps it updating).
    this.controlsWidget.yoke = () => {
      const y = this.yokeSource?.();
      const othersFlying = this.schoolUi?.instructorFlying === true;
      if (!this.schoolUi?.followMeThrough) return { ...(y ?? { mouseYoke: false, source: 'keyboard' as const }), othersFlying };
      return { ...(y ?? { source: 'keyboard' as const }), mouseYoke: true, othersFlying };
    };
    this.hints = new HintsCard(this.root, () => this.openMenu('controls'));
    const params = new URLSearchParams(location.search);
    const q = params.get('hints');
    this.hintsMode = q === '1' ? 'always' : q === '0' ? 'never' : (opts.hints ?? 'auto');
    const urlScenario = params.get('scenario');
    this.lastScenario = opts.scenario ?? (isScenario(urlScenario) ? urlScenario : 'runway');
    this.toasts = new Toasts(this.root);
    this.fps = new FpsMeter(this.root);
    this.crash = new CrashDialog(this.root, {
      restart: () => {
        this.crash.close();
        this.ctx.commands.reset(this.lastScenario);
      },
      chooseScenario: () => {
        this.crash.close();
        this.openMenu('flight');
      },
    });
    // The loading screen exists from construction so it can cover the page while other modules load.
    this.loading = new LoadingScreen(this.root, opts.title);
    window.addEventListener('keydown', this.onKeyCapture, true);
    window.addEventListener('keydown', this.onKey);
  }

  get ctx(): SimContext {
    if (!this.context) throw new Error('UISystem used before init()');
    return this.context;
  }

  init(ctx: SimContext): void {
    this.context = ctx;
    const { aircraft: def, presentation } = ctx as Partial<Pick<SimContext, 'aircraft' | 'presentation'>>;
    this.setAircraft(def, presentation);
    // The clicks' tooltip keeps its place under the school layer, toasts and dialogs.
    const clicks = (this.clicks = new CockpitClicks(this.root, this.panel ?? presentation?.panel, this.hold));
    this.root.insertBefore(this.root.lastElementChild!, this.schoolLayer);
    this.menu = new PauseMenu(this.root, this.bindings, this);
    this.menu.setGamepads(this.gamepads);
    clicks.attach(ctx);
    // Keep the loading screen on top of everything created after it.
    this.root.appendChild(this.root.querySelector('.loading')!);
    const ev = ctx.events;
    this.unsubscribe.push(
      ev.on('crash', (e) => {
        this.menu?.close();
        this.hints.hide();
        const custom = this.crashActions?.(e.reason) ?? null;
        if (custom === 'none') return;
        if (custom) this.crash.openWith(e.reason, custom);
        else this.crash.open(e.reason, `Restart ${SCENARIO_NAMES[this.lastScenario]}`);
      }),
      ev.on('reset', (e) => {
        this.lastScenario = e.scenario;
        this.crash.close();
        this.lastParkingBrake = null;
        this.lastSwitches = null;
        this.lastMixture.fill(NaN);
        this.startupCheck = true;
      }),
      ev.on('cameraMode', (e) => this.showToast(`${CAMERA_NAMES[e.mode]} view`)),
      ev.on('qualityChanged', (e) => this.showToast(`Graphics quality: ${e.quality}`)),
      ev.on('weatherChanged', () => {
        if (this.menu?.isOpen) this.menu.refresh();
      }),
    );
  }

  update(dt: number, ctx: SimContext): void {
    this.fps.frame(performance.now());
    if (this.weatherDirty) {
      this.weatherDirty = false;
      ctx.events.emit('weatherChanged', {});
    }
    const pb = ctx.controls.parkingBrake;
    if (this.lastParkingBrake !== null && pb !== this.lastParkingBrake) {
      this.showToast(pb ? 'Parking brake set' : 'Parking brake released');
    }
    this.lastParkingBrake = pb;
    this.announceControls(ctx);
    this.updateStartup(ctx);

    const menuOpen = !!this.menu?.isOpen;
    const school = this.schoolUi;
    // A school screen (home, briefing, debrief...) is modal like the menu: no flight cues over it.
    const schoolModal = !!school?.screen;
    if (school) school.update(dt);
    const showHud = this.hudOn && ctx.cameraMode !== 'cockpit' && !menuOpen && !schoolModal;
    this.hud.visible = showHud;
    this.hud.topOffset = school?.stripVisible ? STRIP_CLEARANCE : 0;
    if (showHud) this.hud.update(dt, ctx);
    // Cockpit (or HUD off): the HUD's annunciations still matter.
    const showAnnunc = !showHud && !menuOpen && !schoolModal;
    this.annunciators.visible = showAnnunc;
    if (showAnnunc) this.annunciators.update(ctx, this.crash.isOpen);
    this.controlsWidget.update(ctx, !menuOpen && !this.crash.isOpen && !schoolModal);
    this.pausedBadge.classList.toggle('hidden', !this.pausedBadgeEnabled || !ctx.paused || menuOpen || this.crash.isOpen || schoolModal);
    if (menuOpen) this.menu!.update();
    if (menuOpen || this.crash.isOpen || schoolModal) this.hints.hide();

    // Autopilot status: visible in every view.
    const ap = this.autopilotLink;
    const apOn = !!ap && ap.engaged() && !menuOpen;
    this.apChip.classList.toggle('hidden', !apOn);
    if (apOn) {
      const mode = ap!.mode?.() ?? '';
      setText(this.apChip, mode ? `AP  ${mode.toUpperCase()}` : 'AP');
    }

    const clicks = this.clicks!;
    clicks.enabled = !menuOpen && !this.crash.isOpen && !schoolModal;
    clicks.update();
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyCapture, true);
    window.removeEventListener('keydown', this.onKey);
    this.controlsWidget.dispose();
    this.clicks?.dispose();
    for (const u of this.unsubscribe) u();
    this.root.remove();
  }

  // --- Public API ----------------------------------------------------------------------------------

  setLoadingProgress(fraction: number, label?: string): void {
    this.loading.setProgress(fraction, label);
  }

  hideLoading(): void {
    this.loading.hide();
    if (this.hintsMode === 'always') this.hints.show(true);
    else if (this.hintsMode === 'auto' && !this.automated && !this.schoolUi?.hasProfile) this.hints.show();
    this.startupCheck = true;
  }

  /**
   * Wire the Flight School UI (constructed on `schoolLayer`) into the shell: see the header. Call once,
   * after init(); null detaches it.
   */
  attachSchool(school: SchoolUi | null): void {
    if (this.schoolUi) {
      this.schoolUi.setView(null);
      this.schoolUi.toastSink = null;
    }
    this.schoolUi = school;
    if (!school) return;
    school.toastSink = (t) => this.showToast(t);
    school.setView({
      cockpit: () => this.context?.cameraMode === 'cockpit',
      project: (px, py) => this.clicks?.panelPointToClient(px, py) ?? null,
    });
    this.menu?.refresh();
  }

  get school(): SchoolMenuLink | null {
    return this.schoolUi;
  }

  private get automated(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.webdriver;
  }

  /** Scenario the crash dialog restarts (kept current by 'reset' events). */
  get scenario(): ScenarioId {
    return this.lastScenario;
  }

  set scenario(id: ScenarioId) {
    this.lastScenario = id;
  }

  /**
   * Input-module link for the control-position widget (InputSystem.getYokeIndicator): with it the widget
   * also shows in mouse-yoke mode. Without it the widget follows the flight keys only.
   */
  setYokeIndicator(source: (() => YokeSource) | null): void {
    this.yokeSource = source;
  }

  /** Toasts on screen, newest first (automation). */
  get toastTexts(): string[] {
    return this.toasts.texts;
  }

  /** Control-position widget on screen (automation). */
  get controlsWidgetVisible(): boolean {
    return this.controlsWidget.visible;
  }

  /**
   * The type flown (init; also for tests and dev pages). Each piece falls back to the Cessna 172S's when the
   * definition or the presentation is missing.
   */
  private setAircraft(def: AircraftDefinition | undefined, presentation: AircraftPresentation | undefined): void {
    const ui = presentation?.ui ?? C172S_UI;
    this.profile = ui;
    this.engineCount = def?.engineCount ?? 1;
    this.lastMixture = new Array<number>(this.engineCount).fill(NaN);
    this.lastSwitches = null;
    this.spareSwitches = undefined;
    if (!def) return;
    this.hud.setAircraft({
      ui,
      reference: def.reference,
      restHeight: def.geometry.restHeight,
      limits: def.limits,
      flapDetents: def.controls.flaps.detents,
      engines: def.engineCount,
      carbHeat: def.input.has.carbHeat,
    });
    this.hints.setAircraft({ ui, vr: def.reference.vr, vy: def.reference.vy });
    const levers: WidgetAircraft['levers'][number][] = ['throttle'];
    if (def.input.has.propeller) levers.push('propeller');
    if (def.input.has.mixture) levers.push('mixture');
    this.controlsWidget.setAircraft({ engines: def.engineCount, levers, rudderTrim: def.input.has.rudderTrim });
  }

  /** Switch / mixture toasts for keyboard pilots, and why a start cannot work while the starter is held. */
  private announceControls(ctx: SimContext): void {
    const c = ctx.controls;
    const ui = this.profile;
    // A panel switch under the pointer already shows its state in the tooltip.
    const quiet = this.clicks?.hovering ?? false;
    const reads = switchReads(ui, c, this.spareSwitches);
    if (this.lastSwitches && !quiet) for (const m of switchMessages(ui, this.lastSwitches, reads)) this.showToast(m);
    // Swap the two read-out buffers (no per-frame allocation).
    this.spareSwitches = this.lastSwitches ?? switchReads(ui, c);
    this.lastSwitches = reads;
    const apFlying = !!this.autopilotLink?.engaged();
    const n = this.engineCount;
    for (let i = 0; i < n; i++) {
      const m = engineControl(c, i, 'mixture');
      const last = this.lastMixture[i];
      if (!Number.isNaN(last) && Math.abs(m - last) > 1e-4 && !apFlying && !quiet) {
        // One toast per engine on a twin ("L Mixture 45%"), updated in place while the lever moves.
        if (n > 1) this.toasts.show(`${i === 0 ? 'L' : 'R'} ${mixtureLabel(m)}`, 1800, `mixture${i}`);
        else this.toasts.show(mixtureLabel(m), 1800, 'mixture');
      }
      this.lastMixture[i] = m;
    }

    const now = performance.now() / 1000;
    const s = ctx.state;
    // The first engine whose starter is held while it does not run (one starter at a time on a twin).
    let cranking = -1;
    if (!s.crashed) {
      for (let i = 0; i < n; i++) {
        if (engineControl(c, i, 'starter') && !(s.engines[i] ?? s.engine).running) {
          cranking = i;
          break;
        }
      }
    }
    if (cranking < 0) {
      this.starterSince = -1;
      return;
    }
    if (this.starterSince < 0) this.starterSince = now;
    const advice = ui.starterAdvice(c, cranking);
    // No power: nothing turns at all, say so at once; otherwise give the engine a moment to catch.
    if (advice && (!c.masterBattery || now - this.starterSince > STARTER_ADVICE_DELAY_S)) this.toasts.show(advice, 3500, 'starter');
  }

  /** Engine-start card: opened after load / reset when the engines are off on the ground; closed once one runs. */
  private updateStartup(ctx: SimContext): void {
    const running = anyEngineRunning(ctx.state);
    this.hints.parkingBrake = ctx.controls.parkingBrake;
    if (this.startupCheck) {
      this.startupCheck = false;
      const coldStart = !running && !ctx.state.crashed && ctx.state.wheels.some((w) => w.onGround);
      this.hints.startupVisible = coldStart;
      // A training profile means the Flight School teaches the start; the card stays away (section 5.4).
      const allowed = this.hintsMode === 'always' || (this.hintsMode === 'auto' && !this.automated && !this.schoolUi?.hasProfile);
      // Opened by itself once per page (every time with hints=1); the Controls tab keeps the procedure.
      if (coldStart && allowed && !this.hints.isOpen && (this.hintsMode === 'always' || !this.startupShown)) {
        this.hints.show(true);
        this.hintsForStartup = true;
        this.startupShown = true;
      } else if (!coldStart && this.hintsForStartup) {
        this.hints.hide();
        this.hintsForStartup = false;
      }
      return;
    }
    if (running && this.hints.startupVisible) {
      this.hints.startupVisible = false;
      if (this.hintsForStartup) this.hints.hide();
      this.hintsForStartup = false;
    }
  }

  /** Show the first-flight hints card (again). */
  showHints(): void {
    this.hints.show(true);
  }

  /**
   * Give the Joysticks & yokes page the input module's controller manager (InputSystem.gamepads).
   * Until then the page says controllers are unavailable.
   */
  setGamepads(manager: GamepadSettings | null): void {
    this.gamepads = manager;
    this.menu?.setGamepads(manager);
  }

  /** Keyboard-flying assists shown as menu toggles (the shell passes InputSystem.assists; null hides them). */
  assists: { groundSteering: boolean; rollTrim: boolean } | null = null;

  /** The shell's "Resume where I left off on reload" preference, shown as a menu toggle (null hides it). */
  resumeOnReload: ResumePreferenceLink | null = null;

  /** The types the menu's aircraft chooser offers (null: the catalogue's available ones; dev pages set all). */
  aircraftChoices: readonly AircraftSummary[] | null = null;

  /** Autopilot link for the AP status chip and the menu toggle (null hides both). */
  get autopilot(): AutopilotLink | null {
    return this.autopilotLink;
  }

  set autopilot(link: AutopilotLink | null) {
    this.autopilotLink = link;
  }

  showToast(text: string, durationMs?: number): void {
    this.toasts.show(text, durationMs);
  }

  get menuOpen(): boolean {
    return !!this.menu?.isOpen;
  }

  openMenu(tab?: MenuTab): void {
    // During a lesson the menu opens on the School tab (section 5.9).
    if (!tab && this.schoolUi?.lessonActive) tab = 'school';
    if (!this.menu || this.menu.isOpen) {
      if (tab) this.menu?.show(tab);
      return;
    }
    this.pausedBeforeMenu = this.ctx.paused;
    if (!this.ctx.paused) this.ctx.commands.setPaused(true);
    this.menu.open(tab, this.pausedBeforeMenu);
  }

  closeMenu(): void {
    if (!this.menu?.isOpen) return;
    this.menu.close();
    if (!this.pausedBeforeMenu) this.ctx.commands.setPaused(false);
  }

  toggleMenu(): void {
    if (this.menuOpen) this.closeMenu();
    else this.openMenu();
  }

  /** HUD enabled for external views (it is never shown in the cockpit view). */
  get hudEnabled(): boolean {
    return this.hudOn;
  }

  set hudEnabled(v: boolean) {
    this.hudOn = v;
  }

  toggleHud(): void {
    this.hudOn = !this.hudOn;
    this.showToast(this.hudOn ? 'HUD on' : 'HUD off');
  }

  get fpsVisible(): boolean {
    return this.fps.visible;
  }

  set fpsVisible(v: boolean) {
    this.fps.visible = v;
  }

  /** Extra diagnostic text for the F8 readout. */
  set fpsExtra(fn: (() => string) | null) {
    this.fps.extra = fn;
  }

  toggleFps(): void {
    this.fps.visible = !this.fps.visible;
  }

  // --- MenuHost ------------------------------------------------------------------------------------

  close(): void {
    this.closeMenu();
  }

  toast(text: string): void {
    this.showToast(text);
  }

  weatherEdited(): void {
    this.weatherDirty = true;
  }

  // --- Keyboard ------------------------------------------------------------------------------------

  /**
   * While a modal is open, swallow keys before the flight controls see them. The crash dialog's own keys
   * (by default Enter / R / Shift+R restart the scenario that crashed; a lesson crash panel brings its own),
   * and Escape dismisses it.
   */
  private readonly onKeyCapture = (e: KeyboardEvent): void => {
    if (!this.menuOpen && !this.crash.isOpen) return;
    if (this.crash.isOpen && !this.menuOpen && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (this.crash.handleKey(e.code)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
    }
    if (e.code === this.hotkeys.menu && !e.repeat) {
      e.preventDefault();
      if (this.crash.isOpen) this.crash.close();
      else this.closeMenu();
    }
    // F1-F6 are flight keys (throttle, flaps). In flight the input system blocks their browser defaults
    // (help, find, reload, address bar); do the same while a modal swallows them, so F5 can't reload the page.
    if (/^F[1-6]$/.test(e.code)) e.preventDefault();
    e.stopImmediatePropagation();
  };

  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || !this.context) return;
    // School screens take their own keys (they capture them before this listener while open).
    if (this.schoolUi?.screen) return;
    const h = this.hotkeys;
    if (e.code === h.menu) this.openMenu();
    else if (e.code === h.hud) this.toggleHud();
    else if (e.code === h.fps) this.toggleFps();
    else return;
    e.preventDefault();
  };
}
