// Pause menu: flight (aircraft, resume, scenarios, sim rate), the Flight School tab, weather, time of day,
// display (quality, camera, HUD) and the controls reference.

import { SAFARI as SAFARI_START } from '../world/era/cretaceousAnchors';
import { R22_DEMOS, DEMO_TITLES, type R22DemoId } from '../sim/rotorcraft/flights';
import { AIRCRAFT_CATALOGUE, AIRCRAFT_PREF_KEY, aircraftSummary } from '../aircraft/registry';
import type { AircraftDefinition, AircraftPresentation, AircraftSummary } from '../aircraft/types';
import type { CameraMode, QualityLevel, ScenarioId, SimContext } from '../core/context';
import { DEG } from '../core/math';
import { DEFAULT_AIRCRAFT_ID, type CloudType, type MidCloudType, type PrecipType, type WeatherSettings } from '../core/types';
import { FOG_TOP_MAX_M, FOG_VIS_MAX_M, FOG_VIS_MIN_M, NO_STORMS, PRECIP_RATE_MAX_MMH, cloudTypeOf, fogOf, midLayerOf, precipOf, stormsOf, type FogLayer, type MidLayer, type Precip } from '../core/weatherFields';
import { convectiveState, emptyConvectiveState, proceduralStorms } from '../physics/weather/stormField';
import { WEATHER_PRESETS, applyWeatherPreset } from '../sim/weatherPresets';
import type { SchoolCommand } from '../training/types';
import { AIRPORT, sunDirectionNED } from '../core/world';
import { el, formatHours } from './dom';
import { aircraftChoiceUrl, choiceConfirmation, chooserRows } from './chooser';
import { eraConfirmation, eraDevChoiceUrl, eraGates, eraRows, seedConfirmation, type EraGates, type EraRow } from './eraChooser';
import { randomSeed, SEED_PREF_KEY, seedDevChoiceUrl, seedLabel } from '../sim/seedChoice';
import { setStartField } from '../sim/startField';
import { gpsTarget, setGpsTarget } from '../instruments/dynamics/navigation';
import { HOME_ATIS, HOME_GROUND, tuneCom1 } from '../instruments/dynamics/radios';
import { generatedAirfields, HOME_AIRFIELD } from '../world/airfields';
import { normalizeSeed, worldSeed } from '../world/worldSeed';
import { ERA_PREF_KEY } from '../sim/eraChoice';
import { DEFAULT_MOON_SCALE, MOON_SCALE_MAX, MOON_SCALE_MIN, MOON_SCALE_STEP } from '../sim/skyPrefs';
import { SKY_DAYS_IN_YEAR, skyDateLabel } from '../render/sky/skyTime';
import { ERAS } from '../world/era/registry';
import type { EraId } from '../world/era/types';
import { achievedRateLabel, SIM_RATES, splitKeyAlternatives, splitKeyCombo, STARTUP_STEPS } from './cues';
import type { FieldGuide } from './fieldGuide';
import { FIELD_GUIDE_SPECIES, fieldGuideEntry } from '../world/fauna/fieldGuideData';
import { GamepadPage, type GamepadSettings } from './gamepadPage';

export type MenuTab = 'flight' | 'school' | 'weather' | 'time' | 'display' | 'controls' | 'controllers' | 'fieldguide';

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
  helicopter?: {
    hoverUrl: string;
    get(): { heading: number; altitude: number; speed: number; adaptive: boolean };
    set(key: 'heading' | 'altitude' | 'speed' | 'adaptive', value: number | boolean): void;
    status(): string;
  };
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
  readonly r22Demos?: { start(id: R22DemoId): void };
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
  showChecklist?(): void;
  /** Keyboard-flying assists (InputSystem.assists), if the shell provided them. */
  readonly assists?: { groundSteering: boolean; rollTrim: boolean } | null;
  /** "Resume where I left off on reload", if the shell provided it. */
  readonly resumeOnReload?: ResumePreferenceLink | null;
  /** The Flight School, if the shell attached one (School tab, abandon-lesson confirmation). */
  readonly school?: SchoolMenuLink | null;
  /** The types the aircraft chooser offers. Absent: AIRCRAFT_CATALOGUE (its available rows). */
  readonly aircraftChoices?: readonly AircraftSummary[] | null;
  /** Deep Time field guide store (absent in tests); its tab shows outside the present era only. */
  readonly fieldGuide?: FieldGuide | null;
}

/** The type flown and its presentation, when the context carries them (test fakes may not). */
function flownType(ctx: SimContext): { def: AircraftDefinition | null; presentation: AircraftPresentation | null } {
  const c = ctx as Partial<Pick<SimContext, 'aircraft' | 'presentation'>>;
  return { def: c.aircraft ?? null, presentation: c.presentation ?? null };
}

/** Scenario names and texts on the Flats, where there is no runway or apron (and 'safari' exists). */
const FLATS_SCENARIOS: Partial<Record<ScenarioId, { name: string; text: string }>> = {
  runway: { name: 'The Flats', text: 'Lined up on the game trail on the mud flats, ready for take-off.' },
  apron: { name: 'Off the trail', text: 'Parked on the mud flats, cold and dark: start the engine and take off from anywhere.' },
  final: { name: 'Final approach', text: 'On a 3 degree approach to the mud flats, configured to land.' },
  downwind: { name: 'Circuit', text: 'In the circuit over the flats at pattern altitude.' },
};
const SAFARI = { id: 'safari' as ScenarioId, name: 'Safari', text: `Airborne at ${SAFARI_START.aglFt} ft over the river valley at dusk, the herds ahead and the volcano beyond.` };

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

/** Rate the menu sets when a precipitation type is chosen at rate 0, mm/h (a menu choice: light to moderate). */
const MENU_PRECIP_RATE_MMH: Readonly<Record<Exclude<PrecipType, 'none'>, number>> = { drizzle: 0.5, rain: 4, snow: 2 };
/** Range of the mid-level altitude slider, m MSL. */
const MENU_MID_ALT_M = [2000, 12_000] as const;
/** Left end of the precipitation-rate slider (log10 mm/h); values below -1 (0.1 mm/h) mean none. */
const PRECIP_SLIDER_OFF = -1.2;
function precipSliderRate(v: number): number {
  return v < -1 ? 0 : Math.min(PRECIP_RATE_MAX_MMH, 10 ** v);
}

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
    const world = ERAS[host.ctx.era ?? 'present'];
    el('span', '', brand, world.id === 'present' ? `${AIRPORT.name} · ${AIRPORT.icao}` : `${world.label} · ${world.epoch}`);
    const tabs: [MenuTab, string][] = [
      ['flight', 'Flight'],
      ['school', 'Flight School'],
      ['weather', 'Weather'],
      ['time', 'Time of day'],
      ['display', 'Display & camera'],
      ['controls', 'Controls'],
      ['controllers', 'Joysticks & yokes'],
      ['fieldguide', 'Field Guide'],
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
    this.pages.set('fieldguide', this.buildFieldGuide(card));
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
    if (tab === 'school' && (!this.host.school || !this.gates().school)) tab = 'flight';
    if (tab === 'fieldguide' && this.eraId() === 'present') tab = 'flight';
    this.tab = tab;
    for (const [id, b] of this.nav) b.classList.toggle('active', id === tab);
    for (const [id, p] of this.pages) p.classList.toggle('hidden', id !== tab);
    this.refresh();
  }

  refresh(): void {
    this.nav.get('school')?.classList.toggle('hidden', !this.host.school || !this.gates().school);
    this.nav.get('fieldguide')?.classList.toggle('hidden', this.eraId() === 'present');
    for (const r of this.refreshers) r();
  }

  private buildFieldGuide(card: HTMLElement): HTMLElement {
    const p = this.page(card, 'Field Guide', 'Creatures you have spotted from the air. Fly close enough to a new species to add it.');
    const list = el('div', '', p);
    this.refreshers.push(() => {
      list.textContent = '';
      const g = this.host.fieldGuide;
      if (!g) return;
      for (const id of FIELD_GUIDE_SPECIES) {
        const e = fieldGuideEntry(id);
        const rec = g.get(id);
        const row = el('div', 'fg-row', list);
        el('b', '', row, rec ? e.name : '? ? ?');
        if (!rec) {
          el('p', 'sub', row, 'Not seen yet.');
          continue;
        }
        el('p', 'sub', row, `${e.size}. First seen ${rec.firstSeen.slice(0, 10)}, closest ${Math.round(rec.closestM)} m.`);
        for (const f of e.facts) el('p', 'sub', row, `- ${f}`);
      }
    });
    return p;
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
    this.buildWorld(p);
    const checklist = el('button', '', p, 'Open aircraft checklist · F');
    checklist.addEventListener('click', () => { this.host.close(); this.host.showChecklist?.(); });
    const schoolRow = el('div', 'chips', p);
    const openSchool = el('button', '', schoolRow, 'Open Flight School');
    openSchool.addEventListener('click', () => {
      this.host.close();
      this.host.school?.command({ kind: 'openHome' });
    });
    this.refreshers.push(() => schoolRow.classList.toggle('hidden', !this.host.school || !this.gates().school));
    if (flownType(this.host.ctx).def?.id === 'r22') {
      el('h3', '', p, 'R22 demonstrations');
      el('p', 'sub', p, 'Watch the scripted pilot. Moving a control or pressing Enter gives you control. Pause, rate and view keys remain available.');
      const demos = el('div', 'scenarios', p);
      for (const id of R22_DEMOS) {
        const b = el('button', '', demos, DEMO_TITLES[id]);
        b.dataset.demo = id;
        b.addEventListener('click', () => { this.host.close(); this.host.r22Demos?.start(id); });
      }
    }
    el('h3', '', p, 'Scenario');
    // During a lesson a scenario ends it: ask first (section 5.6).
    const confirm = el('div', 'sc-confirm hidden', p);
    const confirmText = el('span', '', confirm);
    let pending: (() => void) | null = null;
    const keep = el('button', '', confirm, 'Keep flying the lesson');
    keep.addEventListener('click', () => confirm.classList.add('hidden'));
    const abandon = el('button', 'danger', confirm, 'Abandon');
    /** Start a scenario: at the home field, or (runway, apron, final) at a generated one (startField.ts). */
    const go = (id: ScenarioId, name: string, field: string | null = null): void => {
      setStartField(field);
      this.host.ctx.commands.reset(id);
      this.host.close();
      this.host.toast(`Scenario: ${name}`);
    };
    const start = (s: (typeof SCENARIOS)[number]): void => go(s.id, s.name);
    /** Ask first during a lesson (a scenario ends it). */
    const ask = (name: string, run: () => void): void => {
      if (!this.host.school?.lessonActive) {
        run();
        return;
      }
      pending = run;
      confirmText.textContent = `Abandon the lesson and start ${name}? The flight so far is logged.`;
      confirm.classList.remove('hidden');
    };
    abandon.addEventListener('click', () => {
      confirm.classList.add('hidden');
      if (!pending) return;
      this.host.school?.command({ kind: 'runner', cmd: 'abandon' });
      pending();
    });
    this.refreshers.push(() => confirm.classList.add('hidden'));
    const grid = el('div', 'scenarios', p);
    const eraId = this.eraId();
    const scenarios = eraId === 'present' ? SCENARIOS : [SAFARI, ...SCENARIOS.map((sc) => ({ ...sc, ...FLATS_SCENARIOS[sc.id] }))];
    for (const s of scenarios) {
      const b = el('button', '', grid);
      el('b', '', b, s.name);
      el('span', '', b, s.text);
      b.addEventListener('click', () => ask(s.name, () => start(s)));
    }
    // The generated airfields (airfields.ts): start parked there, or lined up on its runway.
    const fields = eraId === 'present' ? generatedAirfields() : [];
    if (fields.length) {
      el('h3', '', p, 'Airfields');
      el('p', 'sub', p, `Other fields in this world, to fly to or start from. Runway, Apron and Final above start at ${AIRPORT.icao}. Direct to sends the panel GPS there; Tune sets COM1 to the field's frequency.`);
      const list = el('div', 'fields', p);
      // Direct-to buttons (the GPS destination, navigation.ts), the chosen one marked.
      const directs: { code: string; b: HTMLButtonElement }[] = [];
      const markDirect = (): void => {
        for (const d of directs) d.b.classList.toggle('sel', d.code === gpsTarget().code);
      };
      const direct = (parent: HTMLElement, code: string, label: string): void => {
        const b = el('button', '', parent, label);
        b.addEventListener('click', () => {
          setGpsTarget(code);
          markDirect();
          this.host.toast(`GPS direct to ${code}`);
        });
        directs.push({ code, b });
      };
      // Tune buttons set COM1 (radios.ts); the old frequency goes to standby.
      const tune = (parent: HTMLElement, mhz: number, label: string): void => {
        const b = el('button', '', parent, label);
        b.addEventListener('click', () => {
          tuneCom1(mhz);
          this.host.toast(`COM1 ${mhz.toFixed(3)}`);
        });
      };
      const home = el('div', 'chips', p);
      direct(home, AIRPORT.icao, `Direct to ${AIRPORT.icao} (home)`);
      tune(home, HOME_AIRFIELD.frequency, `Tower ${HOME_AIRFIELD.frequency.toFixed(1)}`);
      tune(home, HOME_GROUND, `Ground ${HOME_GROUND.toFixed(1)}`);
      tune(home, HOME_ATIS, `ATIS ${HOME_ATIS.toFixed(1)}`);
      p.insertBefore(home, list);
      this.refreshers.push(markDirect);
      for (const f of [...fields].sort((a, b) => Math.hypot(a.north, a.east) - Math.hypot(b.north, b.east))) {
        const row = el('div', 'field-row', list);
        const info = el('div', '', row);
        el('b', '', info, `${f.name} · ${f.code}`);
        const km = Math.hypot(f.north, f.east) / 1000;
        const brg = Math.round(((Math.atan2(f.east, f.north) * 180) / Math.PI + 360) % 360);
        el('span', '', info, `${f.kind === 'sealed' ? 'Sealed' : 'Grass'} ${f.length} m, runway ${f.ids.join('/')}, elevation ${Math.round(f.elevation / 0.3048)} ft · ${km.toFixed(0)} km (${(km / 1.852).toFixed(0)} NM) ${String(brg).padStart(3, '0')}° from ${AIRPORT.icao} · ${f.frequency.toFixed(3)}`);
        const chips = el('div', 'chips', row);
        const parked = el('button', '', chips, 'Parked');
        parked.addEventListener('click', () => ask(f.name, () => go('apron', `${f.name}, parked`, f.code)));
        const lined = el('button', '', chips, `Runway ${f.ids[0]}`);
        lined.addEventListener('click', () => ask(f.name, () => go('runway', `${f.name}, runway ${f.ids[0]}`, f.code)));
        direct(chips, f.code, 'Direct to');
        tune(chips, f.frequency, `Tune ${f.frequency.toFixed(3)}`);
      }
      markDirect();
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
      apState.textContent = !link ? 'Not available' : on ? `Engaged${mode ? ` · ${mode}` : ''}` : link.helicopter ? 'Helicopter position/speed, heading and altitude hold (key A).' : 'Holds the current track, altitude and speed once airborne (key A).';
    });
    this.refreshers.push(() => this.liveRefreshers.forEach((r) => r()));

    if (this.host.autopilot?.helicopter) {
      const link = this.host.autopilot.helicopter;
      const start = el('a', 'button', p, 'Start helicopter hover test (15 m)');
      start.href = link.hoverUrl;
      el('p', '', p, 'Experimental hold: A engages or disconnects. At zero speed, holds position. Cyclic, pedals or collective movement gives you control. Keep rotor RPM in the normal range; throttle remains yours.');
      for (const [key, title, min, max, step] of [
        ['heading', 'Heading (degrees)', 0, 360, 5],
        ['altitude', 'Altitude MSL (ft)', -1000, 20000, 10],
        ['speed', 'Forward speed (kt; 0 = hover)', 0, 80, 5],
      ] as const) {
        const label = el('label', 'toggle', p, title);
        const input = el('input', '', label); input.type = 'number';
        input.min = String(min); input.max = String(max); input.step = String(step);
        input.addEventListener('change', () => { if (input.value.trim()) link.set(key, Number(input.value)); });
        this.liveRefreshers.push(() => {
          input.disabled = !this.host.autopilot?.engaged();
          if (document.activeElement !== input) {
            const value = link.get()[key]; input.value = Number.isFinite(value) ? String(Math.round(value)) : '';
          }
        });
      }
      const label = el('label', 'toggle', p);
      const adaptive = el('input', '', label); adaptive.type = 'checkbox';
      el('span', '', label, 'Experimental adaptation (bounded ±20%; off by default)');
      adaptive.addEventListener('change', () => link.set('adaptive', adaptive.checked));
      const status = el('p', '', p);
      this.liveRefreshers.push(() => { adaptive.checked = link.get().adaptive; status.textContent = link.status(); });
    }
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

  /** The era flown (ctx.era; the present day in a shell or fake without one). */
  private eraId(): EraId {
    return this.host.ctx.era ?? 'present';
  }

  /** What the era hides: the School tab and the tower camera (eraChooser.eraGates). */
  private gates(): EraGates {
    return eraGates(ERAS[this.eraId()]);
  }

  /**
   * The World chips below the aircraft chooser: the present day or a prehistoric era. Another world is a reload
   * (commands.setEra), so it asks first unless the aircraft stands still on the ground.
   */
  private buildWorld(p: HTMLElement): void {
    const ctx = (): SimContext => this.host.ctx;
    const rows = eraRows(this.eraId());
    el('h3', '', p, 'World');
    const confirm = el('div', 'sc-confirm hidden', p);
    const confirmText = el('span', '', confirm);
    const keep = el('button', '', confirm, 'Keep flying');
    keep.addEventListener('click', () => confirm.classList.add('hidden'));
    const go = el('button', 'danger', confirm, 'Go');
    let pending: { row: EraRow; lesson: boolean } | null = null;
    const choose = (row: EraRow): void => {
      if (ctx().commands.setEra) {
        ctx().commands.setEra?.(row.id);
        return;
      }
      // A shell without the command (dev pages): store the preference and reload with ?era= (the dev harness
      // reads only the URL).
      try {
        localStorage.setItem(ERA_PREF_KEY, row.id);
      } catch {
        // Storage unavailable: the URL still names the era.
      }
      location.replace(eraDevChoiceUrl(location.href, row.id));
    };
    go.addEventListener('click', () => {
      confirm.classList.add('hidden');
      if (!pending) return;
      if (pending.lesson) this.host.school?.command({ kind: 'runner', cmd: 'abandon' });
      choose(pending.row);
    });
    this.refreshers.push(() => confirm.classList.add('hidden'));
    const current = rows.find((r) => r.current)!;
    const chips = el('div', 'chips', p);
    for (const row of rows) {
      const b = el('button', row.current ? 'sel' : '', chips, row.epoch ? `${row.label} · ${row.epoch}` : row.label);
      b.dataset.era = row.id;
      b.title = row.blurb;
      if (row.current) continue;
      b.addEventListener('click', () => {
        const ask = eraConfirmation(ctx().state, !!this.host.school?.lessonActive, current, row);
        if (!ask) {
          choose(row);
          return;
        }
        pending = { row, lesson: ask.kind === 'lesson' };
        confirmText.textContent = ask.text;
        keep.textContent = 'Keep flying';
        go.textContent = ask.kind === 'lesson' ? 'Abandon and go' : 'Go';
        confirm.classList.remove('hidden');
      });
    }
    el('p', 'sub', p, current.blurb);
    this.buildSeed(p);
  }

  /**
   * The Seed row under the World chips: the seed the world is built from (0, today's world, or any other number for
   * another landscape), a box to type one and a Random button. Another seed is a reload (commands.setSeed), so it
   * asks first unless the aircraft stands still on the ground, as the World chips do.
   */
  private buildSeed(p: HTMLElement): void {
    const ctx = (): SimContext => this.host.ctx;
    const current = worldSeed();
    const row = el('div', 'seed-row', p);
    el('span', '', row, 'Seed');
    const input = el('input', '', row);
    input.type = 'number';
    input.min = '0';
    input.step = '1';
    input.value = String(current);
    input.title = "The number the world is generated from: 0 is today's world, any other number another landscape.";
    const go = el('button', '', row, 'Go');
    const random = el('button', '', row, 'Random');
    const confirm = el('div', 'sc-confirm hidden', p);
    const confirmText = el('span', '', confirm);
    const keep = el('button', '', confirm, 'Keep flying');
    keep.addEventListener('click', () => confirm.classList.add('hidden'));
    const leave = el('button', 'danger', confirm, 'Go');
    let pending: number | null = null;
    const choose = (seed: number): void => {
      if (ctx().commands.setSeed) {
        ctx().commands.setSeed?.(seed);
        return;
      }
      // A shell without the command (dev pages): store the preference and reload with ?seed=.
      try {
        localStorage.setItem(SEED_PREF_KEY, String(seed));
      } catch {
        // Storage unavailable: the URL still names the seed.
      }
      location.replace(seedDevChoiceUrl(location.href, seed));
    };
    const ask = (seed: number): void => {
      if (seed === current) return;
      const q = seedConfirmation(ctx().state, !!this.host.school?.lessonActive, current, seed);
      if (!q) {
        choose(seed);
        return;
      }
      pending = seed;
      confirmText.textContent = q.text;
      leave.textContent = q.kind === 'lesson' ? 'Abandon and go' : 'Go';
      confirm.classList.remove('hidden');
    };
    leave.addEventListener('click', () => {
      confirm.classList.add('hidden');
      if (pending === null) return;
      if (this.host.school?.lessonActive) this.host.school?.command({ kind: 'runner', cmd: 'abandon' });
      choose(pending);
    });
    go.addEventListener('click', () => ask(normalizeSeed(input.value)));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') ask(normalizeSeed(input.value));
    });
    random.addEventListener('click', () => {
      const s = randomSeed();
      input.value = String(s);
      ask(s);
    });
    this.refreshers.push(() => {
      confirm.classList.add('hidden');
      input.value = String(current);
    });
    el('p', 'sub', p, `Flying world ${seedLabel(current)}. Every number gives its own hills, coast, woods and fields; 0 is today's world.`);
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
      // A shell without the command (dev pages): store the preference and reload with ?era= (the dev harness
      // reads only the URL).
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
        applyWeatherPreset(w(), preset, this.host.ctx.simTime);
        this.host.weatherEdited();
        this.refresh();
        this.host.toast(`Weather: ${preset.name}`);
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
    this.buildWeatherExtras(p, w, edit);

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

  /**
   * The optional weather fields (core/weatherFields.ts): cloud type and the mid-level sheet under "Clouds &
   * visibility", then precipitation, ground fog and storm cells. Read through the accessors, written through edit().
   */
  private buildWeatherExtras(p: HTMLElement, w: () => WeatherSettings, edit: (fn: (w: WeatherSettings) => void) => void): void {
    const mid: MidLayer = { cover: 0, type: 'altostratus', altM: 0 };
    const precip: Precip = { type: 'none', rateMmH: 0 };
    const fog: FogLayer = { topM: 0, visibilityM: 0 };
    const chipRow = <T extends string>(options: readonly (readonly [T, string])[], current: () => T, pick: (v: T) => void): void => {
      const row = el('div', 'chips', p);
      for (const [v, label] of options) {
        const b = el('button', '', row, label);
        b.addEventListener('click', () => {
          pick(v);
          this.refresh();
        });
        this.refreshers.push(() => b.classList.toggle('sel', current() === v));
      }
    };

    el('p', 'sub', p, 'Cloud type. Auto follows the cover: scattered cumulus at low cover, a stratocumulus deck near overcast.');
    chipRow<CloudType>(
      [['auto', 'Auto'], ['stratus', 'Stratus'], ['stratocumulus', 'Stratocumulus'], ['cumulus', 'Cumulus'], ['towering', 'Towering cumulus'], ['nimbostratus', 'Nimbostratus']],
      () => cloudTypeOf(w()),
      (v) => edit((x) => (x.cloudType = v)),
    );
    this.slider(p, 'Mid-level cloud', [0, 1, 0.05], () => midLayerOf(w(), mid).cover, (v) => edit((x) => (x.midCover = v)), (v) =>
      v <= 0 ? 'none' : `${Math.round(v * 8)}/8`,
    );
    this.slider(p, 'Mid-level altitude', [MENU_MID_ALT_M[0], MENU_MID_ALT_M[1], 100], () => midLayerOf(w(), mid).altM, (v) => edit((x) => (x.midAltM = v)), (v) =>
      `${Math.round(v / 0.3048 / 100) * 100} ft`,
    );
    chipRow<MidCloudType>([['altostratus', 'Altostratus'], ['altocumulus', 'Altocumulus']], () => midLayerOf(w(), mid).type, (v) => edit((x) => (x.midType = v)));

    el('h3', '', p, 'Precipitation, fog and storms');
    chipRow<PrecipType>(
      [['none', 'No precipitation'], ['drizzle', 'Drizzle'], ['rain', 'Rain'], ['snow', 'Snow']],
      () => precipOf(w(), precip).type,
      (v) =>
        edit((x) => {
          x.precipType = v;
          if (v === 'none') x.precipRateMmH = 0;
          else if (!((x.precipRateMmH ?? 0) > 0)) x.precipRateMmH = MENU_PRECIP_RATE_MMH[v];
        }),
    );
    // Rate on a log scale (slider value log10(mm/h)); the left end, below 0.1 mm/h, is none.
    this.slider(
      p,
      'Precipitation rate',
      [PRECIP_SLIDER_OFF, Math.log10(PRECIP_RATE_MAX_MMH), 0.01],
      () => {
        const r = precipOf(w(), precip).rateMmH;
        return r > 0 ? Math.max(-1, Math.log10(r)) : PRECIP_SLIDER_OFF;
      },
      (v) =>
        edit((x) => {
          const rate = precipSliderRate(v);
          x.precipRateMmH = rate;
          if (rate > 0 && precipOf(x, precip).type === 'none') x.precipType = 'rain';
          else if (rate === 0) x.precipType = 'none';
        }),
      (v) => {
        const r = precipSliderRate(v);
        return r <= 0 ? 'none' : `${r < 1 ? r.toFixed(1) : Math.round(r)} mm/h`;
      },
    );
    this.slider(p, 'Ground fog depth', [0, FOG_TOP_MAX_M, 10], () => fogOf(w(), fog).topM, (v) => edit((x) => (x.fogTopM = v)), (v) =>
      v <= 0 ? 'none' : `${Math.round(v / 0.3048 / 10) * 10} ft`,
    );
    // Visibility inside the fog on a log scale: slider value log10(metres).
    this.slider(
      p,
      'Fog visibility',
      [Math.log10(FOG_VIS_MIN_M), Math.log10(FOG_VIS_MAX_M), 0.01],
      () => Math.log10(fogOf(w(), fog).visibilityM),
      (v) => edit((x) => (x.fogVisibilityM = Math.min(FOG_VIS_MAX_M, Math.max(FOG_VIS_MIN_M, 10 ** v)))),
      (v) => `${Math.round(Math.min(FOG_VIS_MAX_M, Math.max(FOG_VIS_MIN_M, 10 ** v)) / 10) * 10} m`,
    );
    // Storm cells: derived from the conditions above unless the weather holds an explicit list (URL cb=, setWeather).
    el('p', 'sub', p, 'Storm cells form from the conditions: a warm afternoon, a low cloud base, deep cumulus or towering cumulus. They drift with the wind.');
    chipRow<'auto' | 'none' | 'other'>(
      [['auto', 'From conditions'], ['none', 'No storms']],
      () => (proceduralStorms(w()) ? 'auto' : stormsOf(w()).length === 0 ? 'none' : 'other'),
      (v) => {
        if (v === 'other') return;
        edit((x) => (x.storms = v === 'none' ? NO_STORMS : undefined));
      },
    );
    const activity = el('p', 'sub', p, '');
    const conv = emptyConvectiveState();
    this.refreshers.push(() => {
      const a = convectiveState(w(), conv).activity;
      const placed = stormsOf(w()).length;
      activity.textContent = proceduralStorms(w())
        ? `Convective activity from these conditions: ${Math.round(a * 100)} %`
        : placed > 0
          ? `${placed} placed cell${placed > 1 ? 's' : ''} (URL cb= or setWeather); the conditions are not used`
          : '';
    });
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
    this.slider(p, 'Date', [1, SKY_DAYS_IN_YEAR, 1], () => w().dayOfYear, (v) => {
      w().dayOfYear = v;
      this.host.weatherEdited();
    }, skyDateLabel);
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
    if (ctx().commands.setCockpitSharpness) {
      el('h3', '', p, '3D cockpit sharpness');
      const sharp = el('div', 'chips', p);
      for (const [v, label] of [['auto', 'Auto'], [1, 'Standard'], [1.25, '1.25x'], [1.5, '1.5x']] as const) {
        const b = el('button', '', sharp, label);
        b.addEventListener('click', () => { ctx().commands.setCockpitSharpness?.(v); this.refresh(); });
        this.refreshers.push(() => b.classList.toggle('sel', (ctx().cockpitSharpness ?? 'auto') === v));
      }
      const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
      el('p', 'sub', p, `On a high-resolution screen (this one: ${Number(dpr.toFixed(2))}x) the 3D cockpit can render finer than the page's pixels, `
        + 'so the dial markings stay crisp. High and Ultra only, never above the screen\'s own resolution; external views are unchanged. '
        + 'Auto: 1.25x on High. 1.5x costs about twice the GPU time of Standard.');
    }
    el('h3', '', p, 'Camera');
    const cams = el('div', 'chips', p);
    for (const cam of CAMERAS) {
      // The tower camera stands in the airport's tower: not where there is no airport.
      if (cam.id === 'tower' && !this.gates().towerCamera) continue;
      const b = el('button', '', cams, cam.name);
      b.addEventListener('click', () => {
        ctx().commands.setCameraMode(cam.id);
        this.refresh();
      });
      this.refreshers.push(() => b.classList.toggle('sel', ctx().cameraMode === cam.id));
    }
    if (ctx().commands.setPanelView) {
      el('h3', '', p, 'Cockpit panel');
      const panels = el('div', 'chips', p);
      for (const [view, label] of [['3d', '3D cockpit'], ['upper', 'Fixed: Upper'], ['lower', 'Fixed: Lower'], ['hidden', 'Fixed: panel hidden']] as const) {
        const b = el('button', '', panels, label);
        b.addEventListener('click', () => { ctx().commands.setPanelView?.(view); this.refresh(); });
        this.refreshers.push(() => b.classList.toggle('sel', ctx().cameraMode === 'cockpit' && (ctx().panelView ?? '3d') === view));
      }
      el('p', 'sub', p, 'Shift+V: 3D / fixed. ]: Upper / Lower / hidden. Fixed view looks ahead; use 3D for mouse-look and zoom.');
    }
    if (ctx().commands.setMoonScale) {
      el('h3', '', p, 'Sky');
      this.slider(
        p,
        'Moon size',
        [MOON_SCALE_MIN, MOON_SCALE_MAX, MOON_SCALE_STEP],
        () => ctx().moonScale ?? DEFAULT_MOON_SCALE,
        (v) => ctx().commands.setMoonScale?.(v),
        (v) => (v <= MOON_SCALE_MIN ? 'Real size' : `${Number(v.toFixed(2))}x`),
      );
      el('p', 'sub', p, 'Larger than life, and larger still near the horizon. Real size: 1x.');
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
