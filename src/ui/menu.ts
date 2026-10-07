// Pause menu: flight (aircraft, resume, scenarios, sim rate), the Flight School tab, weather, time of day,
// display (quality, camera, HUD) and the controls reference.

import { AIRCRAFT_CATALOGUE, AIRCRAFT_PREF_KEY, aircraftSummary } from '../aircraft/registry';
import type { AircraftDefinition, AircraftPresentation, AircraftSummary } from '../aircraft/types';
import type { CameraMode, QualityLevel, ScenarioId, SimContext } from '../core/context';
import { DEG } from '../core/math';
import { DEFAULT_AIRCRAFT_ID, type WeatherSettings } from '../core/types';
import type { SchoolCommand } from '../training/types';
import { AIRPORT, sunDirectionNED } from '../core/world';
import { el, formatHours } from './dom';
import { aircraftChoiceUrl, choiceConfirmation, chooserRows } from './chooser';
import { achievedRateLabel, SIM_RATES, splitKeyAlternatives, splitKeyCombo, STARTUP_STEPS } from './cues';
import { GamepadPage, type GamepadSettings } from './gamepadPage';

export type MenuTab = 'flight' | 'school' | 'weather' | 'time' | 'display' | 'controls' | 'controllers';

/** The Flight School's side of the menu (SchoolUi implements it; UISystem.attachSchool provides it). */
export interface SchoolMenuLink {
  /** A lesson is being flown: scenario buttons ask before abandoning it. */
  readonly lessonActive: boolean;
  /** Fill the School tab; `close` closes the menu. */
  renderMenuPage(parent: HTMLElement, close: () => void): void;
  command(cmd: SchoolCommand): void;
}

/** Autopilot link the shell may give the UI (status chip, menu toggle). */
export interface AutopilotLink {
  /** True while the autopilot flies the aircraft. */
  engaged(): boolean;
  /** Short mode / phase text, e.g. 'HDG 070 ALT 1500' or 'climb'. Optional. */
  mode?(): string;
  /** Engage / disengage (holds the current track, altitude and speed). Optional. */
  toggle?(): void;
}

/** A preference the shell owns and the menu shows as a toggle (resume on reload). */
export interface ResumePreferenceLink {
  get(): boolean;
  set(on: boolean): void;
}

export interface KeyBinding {
  /** Human-readable keys, e.g. "Shift+F" or "Page Up / Page Down"; "+" and "/" separate keys. */
  keys: string;
  action: string;
  category: string;
}

/** What the menu needs from its owner. */
export interface MenuHost {
  readonly ctx: SimContext;
  close(): void;
  toast(text: string): void;
  /** ctx.weather was edited; the host emits 'weatherChanged' (coalesced to once per frame). */
  weatherEdited(): void;
  hudEnabled: boolean;
  fpsVisible: boolean;
  /** Autopilot link, if the shell provided one. */
  readonly autopilot: AutopilotLink | null;
  /** Show the first-flight hints card again. */
  showHints(): void;
  /** Keyboard-flying assists (InputSystem.assists), if the shell provided them. */
  readonly assists?: { groundSteering: boolean; rollTrim: boolean } | null;
  /** "Resume where I left off on reload", if the shell provided it. */
  readonly resumeOnReload?: ResumePreferenceLink | null;
  /** The Flight School, if the shell attached one (School tab, abandon-lesson confirmation). */
  readonly school?: SchoolMenuLink | null;
  /** The types the aircraft chooser offers. Absent: AIRCRAFT_CATALOGUE (its available rows). */
  readonly aircraftChoices?: readonly AircraftSummary[] | null;
}

/** The type flown and its presentation, when the context carries them (test fakes may not). */
function flownType(ctx: SimContext): { def: AircraftDefinition | null; presentation: AircraftPresentation | null } {
  const c = ctx as Partial<Pick<SimContext, 'aircraft' | 'presentation'>>;
  return { def: c.aircraft ?? null, presentation: c.presentation ?? null };
}

const SCENARIOS: { id: ScenarioId; name: string; text: string }[] = [
  { id: 'runway', name: 'Runway 07', text: 'Lined up on the runway, ready for take-off.' },
  { id: 'apron', name: 'Apron', text: 'Parked on the apron, cold and dark: start the engine and taxi out.' },
  { id: 'final', name: 'Final approach', text: 'On final for runway 07, configured to land.' },
  { id: 'downwind', name: 'Downwind', text: 'In the circuit on the downwind leg at pattern altitude.' },
  { id: 'cruise', name: 'Cruise', text: 'Straight and level at cruise power.' },
];

const QUALITIES: QualityLevel[] = ['low', 'medium', 'high', 'ultra'];
const CAMERAS: { id: CameraMode; name: string }[] = [
  { id: 'cockpit', name: 'Cockpit' },
  { id: 'chase', name: 'Chase' },
  { id: 'orbit', name: 'Orbit' },
  { id: 'flyby', name: 'Fly-by' },
  { id: 'tower', name: 'Tower' },
];

type WeatherPreset = Partial<WeatherSettings> & { name: string };
const WEATHER_PRESETS: WeatherPreset[] = [
  { name: 'Clear & calm', windSpeedKt: 0, gustKt: 0, turbulence: 0.03, cloudCover: 0.05, visibilityM: 80000, cirrusCover: 0 },
  { name: 'Fair', windDirectionDeg: 100, windSpeedKt: 8, gustKt: 0, turbulence: 0.15, cloudCover: 0.35, cloudBaseM: 1500, cloudTopM: 2600, visibilityM: 50000, cirrusCover: 0.15 },
  { name: 'Overcast', windDirectionDeg: 230, windSpeedKt: 12, gustKt: 4, turbulence: 0.3, cloudCover: 0.95, cloudBaseM: 700, cloudTopM: 2200, visibilityM: 15000, cirrusCover: 0 },
  { name: 'Gusty crosswind', windDirectionDeg: 160, windSpeedKt: 15, gustKt: 10, turbulence: 0.5, cloudCover: 0.3, cloudBaseM: 1400, cloudTopM: 2400, visibilityM: 40000, cirrusCover: 0.1 },
  { name: 'Low IFR', windDirectionDeg: 60, windSpeedKt: 5, gustKt: 0, turbulence: 0.2, cloudCover: 1, cloudBaseM: 200, cloudTopM: 1500, visibilityM: 1500, cirrusCover: 0 },
];

/** Local solar hour at which the sun crosses `altDeg` in the morning (rising) or evening. */
function sunCrossing(altDeg: number, day: number, morning: boolean): number {
  const alt = (h: number): number => Math.asin(-sunDirectionNED(h, day).z) / DEG - altDeg;
  let lo = morning ? 0 : 12;
  let hi = morning ? 12 : 24;
  if (Math.sign(alt(lo)) === Math.sign(alt(hi))) return morning ? 6 : 18;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (Math.sign(alt(mid)) === Math.sign(alt(lo))) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

function initialRenderScale(): number {
  try {
    const v = Number(new URLSearchParams(location.search).get('scale'));
    return v > 0 ? Math.min(1, Math.max(0.5, v)) : 1;
  } catch {
    return 1;
  }
}

export class PauseMenu {
  readonly root: HTMLDivElement;
  private readonly nav = new Map<MenuTab, HTMLButtonElement>();
  private readonly pages = new Map<MenuTab, HTMLElement>();
  /** Re-read displayed values from the context (after opening, presets, external changes). */
  private readonly refreshers: (() => void)[] = [];
  /** Cheap refreshers run every frame while their page is shown. */
  private readonly liveRefreshers: (() => void)[] = [];
  private tab: MenuTab = 'flight';
  /** Last render scale set here (the context does not expose the current one); starts from ?scale=. */
  private renderScale = initialRenderScale();
  /** Requested and achieved simulation rate when the menu was opened. */
  private readonly rateAtOpen: { requested: number; achieved: number | undefined } = { requested: 1, achieved: undefined };
  private readonly gamepadPage: GamepadPage;

  constructor(
    parent: HTMLElement,
    bindings: KeyBinding[],
    private readonly host: MenuHost,
  ) {
    this.root = el('div', 'scrim hidden', parent);
    this.root.addEventListener('mousedown', (e) => {
      if (e.target === this.root) host.close();
    });
    const card = el('div', 'card menu', this.root);
    const nav = el('nav', '', card);
    const brand = el('div', 'brand', nav);
    el('b', '', brand, flownType(host.ctx).def?.shortName ?? 'Cessna 172S');
    el('span', '', brand, `${AIRPORT.name} · ${AIRPORT.icao}`);
    const tabs: [MenuTab, string][] = [
      ['flight', 'Flight'],
      ['school', 'Flight School'],
      ['weather', 'Weather'],
      ['time', 'Time of day'],
      ['display', 'Display & camera'],
      ['controls', 'Controls'],
      ['controllers', 'Joysticks & yokes'],
    ];
    for (const [id, name] of tabs) {
      const b = el('button', '', nav, name);
      b.addEventListener('click', () => this.show(id));
      this.nav.set(id, b);
    }
    el('div', 'spacer', nav);
    const resume = el('button', 'primary', nav, 'Resume');
    resume.addEventListener('click', () => host.close());

    this.pages.set('flight', this.buildFlight(card));
    this.pages.set('school', this.buildSchool(card));
    this.pages.set('weather', this.buildWeather(card));
    this.pages.set('time', this.buildTime(card));
    this.pages.set('display', this.buildDisplay(card));
    this.pages.set('controls', this.buildControls(card, bindings));
    const pads = this.page(card, 'Joysticks & yokes', 'Assign and calibrate game controllers, yokes, pedals and throttle quadrants. Settings are saved per device.');
    this.gamepadPage = new GamepadPage(pads);
    this.pages.set('controllers', pads);
  }

  /** The input module's controller manager (null: the page says it is unavailable). */
  setGamepads(m: GamepadSettings | null): void {
    this.gamepadPage.setManager(m);
  }

  /** Per frame while open: live controller read-outs and the autopilot state. */
  update(): void {
    if (this.tab === 'controllers') this.gamepadPage.update();
    if (this.tab === 'flight') for (const r of this.liveRefreshers) r();
  }

  get isOpen(): boolean {
    return !this.root.classList.contains('hidden');
  }

  /**
   * @param wasPaused whether the simulation was already paused before the menu opened (then the last
   *   achieved-rate window measured a pause, not flying, and is not shown).
   */
  open(tab: MenuTab = this.tab, wasPaused = false): void {
    // The menu pauses the simulation, so the achieved rate is the one measured just before it opened.
    const c = this.host.ctx;
    this.rateAtOpen.requested = c.timeScale;
    this.rateAtOpen.achieved = wasPaused ? undefined : c.achievedTimeScale;
    this.root.classList.remove('hidden');
    this.show(tab);
    this.nav.get(tab)?.focus({ preventScroll: true });
  }

  close(): void {
    this.root.classList.add('hidden');
    // Never leave focus on a hidden control: keys must go back to the flight controls.
    if (this.root.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
  }

  show(tab: MenuTab): void {
    if (tab === 'school' && !this.host.school) tab = 'flight';
    this.tab = tab;
    for (const [id, b] of this.nav) b.classList.toggle('active', id === tab);
    for (const [id, p] of this.pages) p.classList.toggle('hidden', id !== tab);
    this.refresh();
  }

  refresh(): void {
    this.nav.get('school')?.classList.toggle('hidden', !this.host.school);
    for (const r of this.refreshers) r();
  }

  private page(card: HTMLElement, title: string, sub: string): HTMLElement {
    const p = el('section', 'hidden', card);
    el('h2', '', p, title);
    el('p', 'sub', p, sub);
    return p;
  }

  // ------------------------------------------------------------------------------------------------
  private buildFlight(card: HTMLElement): HTMLElement {
    const p = this.page(card, 'Flight', 'Resume, or start again from one of the scenarios below.');
    this.buildChooser(p);
    const schoolRow = el('div', 'chips', p);
    const openSchool = el('button', '', schoolRow, 'Open Flight School');
    openSchool.addEventListener('click', () => {
      this.host.close();
      this.host.school?.command({ kind: 'openHome' });
    });
    this.refreshers.push(() => schoolRow.classList.toggle('hidden', !this.host.school));
    el('h3', '', p, 'Scenario');
    // During a lesson a scenario ends it: ask first (section 5.6).
    const confirm = el('div', 'sc-confirm hidden', p);
    const confirmText = el('span', '', confirm);
    let pending: (typeof SCENARIOS)[number] | null = null;
    const keep = el('button', '', confirm, 'Keep flying the lesson');
    keep.addEventListener('click', () => confirm.classList.add('hidden'));
    const abandon = el('button', 'danger', confirm, 'Abandon');
    const start = (s: (typeof SCENARIOS)[number]): void => {
      this.host.ctx.commands.reset(s.id);
      this.host.close();
      this.host.toast(`Scenario: ${s.name}`);
    };
    abandon.addEventListener('click', () => {
      confirm.classList.add('hidden');
      if (!pending) return;
      this.host.school?.command({ kind: 'runner', cmd: 'abandon' });
      start(pending);
    });
    this.refreshers.push(() => confirm.classList.add('hidden'));
    const grid = el('div', 'scenarios', p);
    for (const s of SCENARIOS) {
      const b = el('button', '', grid);
      el('b', '', b, s.name);
      el('span', '', b, s.text);
      b.addEventListener('click', () => {
        if (this.host.school?.lessonActive) {
          pending = s;
          confirmText.textContent = `Abandon the lesson and start ${s.name}? The flight so far is logged.`;
          confirm.classList.remove('hidden');
          return;
        }
        start(s);
      });
    }
    el('h3', '', p, 'Autopilot');
    const ap = el('div', 'chips', p);
    const apButton = el('button', '', ap, 'Engage autopilot');
    const apState = el('span', 'ap-state', ap);
    apButton.addEventListener('click', () => {
      const link = this.host.autopilot;
      if (!link?.toggle) return;
      link.toggle();
      this.host.close();
    });
    this.liveRefreshers.push(() => {
      const link = this.host.autopilot;
      const on = !!link?.engaged();
      apButton.textContent = on ? 'Disengage autopilot' : 'Engage autopilot';
      apButton.classList.toggle('sel', on);
      apButton.disabled = !link?.toggle;
      const mode = on ? (link?.mode?.() ?? '') : '';
      apState.textContent = !link ? 'Not available' : on ? `Engaged${mode ? ` · ${mode}` : ''}` : 'Holds the current track, altitude and speed once airborne (key A).';
    });
    this.refreshers.push(() => this.liveRefreshers.forEach((r) => r()));

    el('h3', '', p, 'Cabin & assists');
    const flightToggle = (text: string, get: () => boolean, set: (v: boolean) => void, enabled: () => boolean = () => true): void => {
      const l = el('label', 'toggle', p);
      const i = el('input', '', l);
      i.type = 'checkbox';
      el('span', '', l, text);
      i.addEventListener('change', () => set(i.checked));
      this.refreshers.push(() => {
        i.checked = get();
        i.disabled = !enabled();
      });
    };
    flightToggle('Cabin dome light (key H)', () => !!this.host.ctx.controls.lights.dome, (v) => (this.host.ctx.controls.lights.dome = v));
    const assists = (): { groundSteering: boolean; rollTrim: boolean } | null => this.host.assists ?? null;
    flightToggle(
      'Keyboard ground steering (off: feet off the pedals, the rudder and nosewheel float)',
      () => assists()?.groundSteering ?? true,
      (v) => {
        const a = assists();
        if (a) a.groundSteering = v;
      },
      () => !!assists(),
    );
    flightToggle(
      'Keyboard roll trim (holds the bank you leave)',
      () => assists()?.rollTrim ?? true,
      (v) => {
        const a = assists();
        if (a) a.rollTrim = v;
      },
      () => !!assists(),
    );
    // Realism: carburettor icing, on the types that have a carburettor (and so carburettor heat).
    if (flownType(this.host.ctx).def?.input.has.carbHeat) {
      flightToggle(
        'Carburettor icing (off: the carburettor never ices)',
        () => this.host.ctx.carbIcing !== false,
        (v) => this.host.ctx.commands.setCarbIcing?.(v),
        () => !!this.host.ctx.commands.setCarbIcing,
      );
    }
    flightToggle(
      'Resume where I left off on reload',
      () => this.host.resumeOnReload?.get() ?? false,
      (v) => this.host.resumeOnReload?.set(v),
      () => !!this.host.resumeOnReload,
    );

    el('h3', '', p, 'Simulation rate');
    const rates = el('div', 'chips', p);
    for (const r of SIM_RATES) {
      const b = el('button', '', rates, `${r}×`);
      b.addEventListener('click', () => {
        this.host.ctx.commands.setTimeScale(r);
        this.refresh();
      });
      this.refreshers.push(() => b.classList.toggle('sel', this.host.ctx.timeScale === r));
    }
    // What the CPU actually delivers: at 8-16x the physics may hit its per-frame budget.
    const achieved = el('span', 'ap-state', rates);
    this.liveRefreshers.push(() => {
      const c = this.host.ctx;
      const at = this.rateAtOpen;
      // Only for the rate that was flying when the menu opened (a new choice has not been measured yet).
      achieved.textContent = achievedRateLabel(c.timeScale, at.requested === c.timeScale ? at.achieved : undefined, false);
    });
    return p;
  }

  /**
   * The aircraft chooser at the top of the Flight page: the available types, the one flown first. Choosing
   * another reloads the page into it (commands.setAircraft); airborne or moving it asks first, during a lesson
   * it asks to abandon the lesson. Hidden while there is nothing else to choose.
   */
  private buildChooser(p: HTMLElement): void {
    const ctx = this.host.ctx;
    const current = flownType(ctx).def?.id ?? DEFAULT_AIRCRAFT_ID;
    const rows = chooserRows(this.host.aircraftChoices ?? AIRCRAFT_CATALOGUE, current);
    if (rows.length === 0) return;
    el('h3', '', p, 'Aircraft');
    const confirm = el('div', 'sc-confirm hidden', p);
    const confirmText = el('span', '', confirm);
    const keep = el('button', '', confirm, 'Keep flying');
    keep.addEventListener('click', () => confirm.classList.add('hidden'));
    const leave = el('button', 'danger', confirm, 'Leave');
    let pending: { row: AircraftSummary; lesson: boolean } | null = null;
    const choose = (row: AircraftSummary): void => {
      const c = this.host.ctx;
      if (c.commands.setAircraft) {
        c.commands.setAircraft(row.id);
        return;
      }
      // A shell without the command (dev pages): store the preference and reload as the command would.
      try {
        localStorage.setItem(AIRCRAFT_PREF_KEY, row.id);
      } catch {
        // Storage unavailable: the reload falls back to the default type.
      }
      location.replace(aircraftChoiceUrl(location.href));
    };
    leave.addEventListener('click', () => {
      confirm.classList.add('hidden');
      if (!pending) return;
      if (pending.lesson) this.host.school?.command({ kind: 'runner', cmd: 'abandon' });
      choose(pending.row);
    });
    this.refreshers.push(() => confirm.classList.add('hidden'));
    const flown = rows.find((r) => r.id === current) ?? aircraftSummary(current);
    const grid = el('div', 'scenarios', p);
    for (const row of rows) {
      const b = el('button', row.id === current ? 'current' : '', grid);
      el('b', '', b, row.name);
      el('span', '', b, row.id === current ? `Flying now. ${row.blurb}` : row.blurb);
      if (row.id === current) continue;
      b.addEventListener('click', () => {
        const ask = choiceConfirmation(this.host.ctx.state, !!this.host.school?.lessonActive, flown, row);
        if (!ask) {
          choose(row);
          return;
        }
        pending = { row, lesson: ask.kind === 'lesson' };
        confirmText.textContent = ask.text;
        keep.textContent = ask.kind === 'lesson' ? 'Keep flying the lesson' : 'Keep flying';
        leave.textContent = ask.kind === 'lesson' ? 'Abandon' : 'Leave';
        confirm.classList.remove('hidden');
      });
    }
  }

  // ------------------------------------------------------------------------------------------------
  /** The Flight School tab: filled by the school itself each time it is shown (section 5.6). */
  private buildSchool(card: HTMLElement): HTMLElement {
    const p = el('section', 'hidden', card);
    this.refreshers.push(() => {
      if (this.tab !== 'school') return;
      const link = this.host.school;
      if (link) link.renderMenuPage(p, () => this.host.close());
      else p.replaceChildren();
    });
    return p;
  }

  // ------------------------------------------------------------------------------------------------
  private slider(
    parent: HTMLElement,
    label: string,
    range: [number, number, number],
    get: () => number,
    set: (v: number) => void,
    format: (v: number) => string,
  ): void {
    const row = el('div', 'row', parent);
    const id = `fsui-${label.replace(/\W+/g, '-').toLowerCase()}`;
    const l = el('label', '', row, label);
    l.htmlFor = id;
    const input = el('input', '', row);
    input.type = 'range';
    input.id = id;
    [input.min, input.max, input.step] = range.map(String);
    const out = el('output', 'num', row);
    const paint = (v: number): void => {
      out.textContent = format(v);
      input.style.setProperty('--p', `${((v - range[0]) / (range[1] - range[0])) * 100}%`);
    };
    input.addEventListener('input', () => {
      const v = Number(input.value);
      set(v);
      paint(v);
    });
    this.refreshers.push(() => {
      const v = get();
      input.value = String(v);
      paint(v);
    });
  }

  private buildWeather(card: HTMLElement): HTMLElement {
    const p = this.page(card, 'Weather', 'Changes apply immediately to the flight model, sky and clouds.');
    const w = (): WeatherSettings => this.host.ctx.weather;
    const edit = (fn: (w: WeatherSettings) => void): void => {
      fn(w());
      this.host.weatherEdited();
    };
    const presets = el('div', 'chips', p);
    for (const preset of WEATHER_PRESETS) {
      const b = el('button', '', presets, preset.name);
      b.addEventListener('click', () => {
        const { name, ...values } = preset;
        Object.assign(w(), values);
        this.host.weatherEdited();
        this.refresh();
        this.host.toast(`Weather: ${name}`);
      });
    }

    el('h3', '', p, 'Wind');
    this.slider(p, 'Direction', [0, 360, 5], () => w().windDirectionDeg, (v) => edit((x) => (x.windDirectionDeg = v % 360)), (v) => `${String(Math.round(v) % 360).padStart(3, '0')}°`);
    this.slider(p, 'Speed', [0, 40, 1], () => w().windSpeedKt, (v) => edit((x) => (x.windSpeedKt = v)), (v) => `${v} kt`);
    this.slider(p, 'Gusts', [0, 25, 1], () => w().gustKt, (v) => edit((x) => (x.gustKt = v)), (v) => (v ? `+${v} kt` : 'none'));
    this.slider(p, 'Turbulence', [0, 1, 0.05], () => w().turbulence, (v) => edit((x) => (x.turbulence = v)), (v) =>
      v < 0.05 ? 'none' : v < 0.3 ? 'light' : v < 0.6 ? 'moderate' : 'severe',
    );

    el('h3', '', p, 'Clouds & visibility');
    this.slider(p, 'Cloud cover', [0, 1, 0.05], () => w().cloudCover, (v) => edit((x) => (x.cloudCover = v)), (v) =>
      `${Math.round(v * 8)}/8`,
    );
    this.slider(
      p,
      'Cloud base',
      [150, 4000, 50],
      () => w().cloudBaseM,
      (v) =>
        edit((x) => {
          const depth = Math.max(300, x.cloudTopM - x.cloudBaseM);
          x.cloudBaseM = v;
          x.cloudTopM = v + depth;
        }),
      (v) => `${Math.round(v / 0.3048 / 100) * 100} ft`,
    );
    this.slider(p, 'Cirrus', [0, 1, 0.05], () => w().cirrusCover ?? 0.1, (v) => edit((x) => (x.cirrusCover = v)), (v) =>
      v <= 0 ? 'none' : `${Math.round(v * 8)}/8`,
    );
    // Visibility on a log scale: slider value is log10(metres).
    this.slider(p, 'Visibility', [2.9, 5, 0.01], () => Math.log10(w().visibilityM), (v) => edit((x) => (x.visibilityM = 10 ** v)), (v) => {
      const m = 10 ** v;
      return m >= 9999 ? `${Math.round(m / 1000)} km` : `${(m / 1000).toFixed(1)} km`;
    });

    el('h3', '', p, 'Temperature & pressure');
    const fieldIsa = 15 - 0.0065 * AIRPORT.elevation;
    this.slider(p, 'Temperature', [-30, 30, 1], () => w().isaDeviation, (v) => edit((x) => (x.isaDeviation = v)), (v) =>
      `${Math.round(fieldIsa + v)} °C`,
    );
    this.slider(p, 'QNH', [950, 1050, 1], () => w().qnhHpa, (v) => edit((x) => (x.qnhHpa = v)), (v) =>
      `${Math.round(v)} hPa`,
    );
    return p;
  }

  // ------------------------------------------------------------------------------------------------
  private buildTime(card: HTMLElement): HTMLElement {
    const p = this.page(card, 'Time of day', 'Local solar time at the airfield. Presets follow the date.');
    const w = (): WeatherSettings => this.host.ctx.weather;
    const chips = el('div', 'chips', p);
    const presets: [string, () => number][] = [
      ['Dawn', () => sunCrossing(2, w().dayOfYear, true)],
      ['Morning', () => 9.5],
      ['Noon', () => 12],
      ['Golden hour', () => sunCrossing(8, w().dayOfYear, false)],
      ['Sunset', () => sunCrossing(0.5, w().dayOfYear, false)],
      ['Night', () => 23.5],
    ];
    for (const [name, at] of presets) {
      const b = el('button', '', chips, name);
      b.addEventListener('click', () => {
        w().timeOfDay = at();
        this.host.weatherEdited();
        this.refresh();
      });
    }
    el('h3', '', p, 'Time');
    el('div', 'timebar', p);
    this.slider(p, 'Local time', [0, 23.95, 0.05], () => w().timeOfDay, (v) => {
      w().timeOfDay = v;
      this.host.weatherEdited();
    }, formatHours);
    this.slider(p, 'Date', [1, 365, 1], () => w().dayOfYear, (v) => {
      w().dayOfYear = v;
      this.host.weatherEdited();
    }, (v) => new Date(Date.UTC(2025, 0, v)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }));
    return p;
  }

  // ------------------------------------------------------------------------------------------------
  private buildDisplay(card: HTMLElement): HTMLElement {
    const p = this.page(card, 'Display & camera', 'Rendering quality, view and overlays.');
    const ctx = (): SimContext => this.host.ctx;
    el('h3', '', p, 'Graphics quality');
    const q = el('div', 'chips', p);
    for (const level of QUALITIES) {
      const b = el('button', '', q, level[0].toUpperCase() + level.slice(1));
      b.addEventListener('click', () => {
        ctx().commands.setQuality(level);
        this.refresh();
      });
      this.refreshers.push(() => b.classList.toggle('sel', ctx().quality === level));
    }
    if (ctx().commands.setRenderScale) {
      this.slider(
        p,
        'Render scale',
        [0.5, 1, 0.05],
        () => (ctx() as SimContext & { renderScale?: number }).renderScale ?? this.renderScale,
        (v) => {
          this.renderScale = v;
          ctx().commands.setRenderScale?.(v);
        },
        (v) => `${Math.round(v * 100)}%`,
      );
      el('p', 'sub', p, 'Lower it for more frames per second on a weaker GPU; the menus and HUD stay sharp.');
    }
    el('h3', '', p, 'Camera');
    const cams = el('div', 'chips', p);
    for (const cam of CAMERAS) {
      const b = el('button', '', cams, cam.name);
      b.addEventListener('click', () => {
        ctx().commands.setCameraMode(cam.id);
        this.refresh();
      });
      this.refreshers.push(() => b.classList.toggle('sel', ctx().cameraMode === cam.id));
    }
    el('h3', '', p, 'Overlays');
    const toggle = (text: string, get: () => boolean, set: (v: boolean) => void): void => {
      const l = el('label', 'toggle', p);
      const i = el('input', '', l);
      i.type = 'checkbox';
      el('span', '', l, text);
      i.addEventListener('change', () => set(i.checked));
      this.refreshers.push(() => (i.checked = get()));
    };
    toggle('Flight HUD in external views', () => this.host.hudEnabled, (v) => (this.host.hudEnabled = v));
    toggle('Frame time / FPS readout', () => this.host.fpsVisible, (v) => (this.host.fpsVisible = v));
    return p;
  }

  // ------------------------------------------------------------------------------------------------
  private buildControls(card: HTMLElement, bindings: KeyBinding[]): HTMLElement {
    const p = this.page(card, 'Controls', 'Keyboard and mouse reference.');
    const hint = el('div', 'chips', p);
    el('button', '', hint, 'Show the first-flight hints').addEventListener('click', () => {
      this.host.close();
      this.host.showHints();
    });
    el('h3', '', p, 'Engine start (apron, cold and dark)');
    const start = el('div', 'keys', p);
    const type = flownType(this.host.ctx);
    (type.presentation?.ui.startupSteps ?? STARTUP_STEPS).forEach(([what, how], i) => {
      const row = el('div', 'k', start);
      el('span', '', row, `${i + 1}. ${what}`);
      el('div', 'mouse', row, how);
    });
    el('h3', '', p, 'Mouse');
    const mouse = el('div', 'keys', p);
    for (const [what, how] of [
      ['Look around', 'Drag (either button)'],
      ['Zoom', 'Wheel'],
      ['Recentre the view', 'Middle click'],
      ['Panel switches (master, lights, avionics…)', 'Click'],
      ['Knobs (altimeter, heading bug, OBS, dimmers)', 'Wheel over knob / click left or right half'],
      type.def && type.def.input.ignition !== 'key'
        ? ['Ignition and engine switches, starter', 'Click; hold the START button']
        : ['Magneto key and starter', 'Click right half; hold at START'],
      ['Align heading indicator (PUSH knob)', 'Hold click'],
    ]) {
      const row = el('div', 'k', mouse);
      el('span', '', row, what);
      el('div', 'mouse', row, how);
    }
    const byCategory = new Map<string, KeyBinding[]>();
    for (const b of bindings) {
      if (!byCategory.has(b.category)) byCategory.set(b.category, []);
      byCategory.get(b.category)!.push(b);
    }
    for (const [cat, list] of byCategory) {
      el('h3', '', p, cat);
      const grid = el('div', 'keys', p);
      for (const b of list) {
        const row = el('div', 'k', grid);
        el('span', '', row, b.action);
        const keys = el('div', '', row);
        // "Shift+F" -> two caps; "A / D" -> two alternatives; "Num +" is one cap.
        splitKeyAlternatives(b.keys).forEach((alt, i) => {
          if (i > 0) keys.appendChild(document.createTextNode(' / '));
          splitKeyCombo(alt).forEach((k) => el('kbd', '', keys, k));
        });
      }
    }
    if (bindings.length === 0) el('p', 'sub', p, 'No key bindings were provided.');
    return p;
  }
}
