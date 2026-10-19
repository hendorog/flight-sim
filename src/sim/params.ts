// URL parameters of index.html (automation hooks and screenshot set-ups). All optional.
//
//   aircraft=c172s|c152|pa38|da20|pa34|da42       aircraft type (default: the type chosen in the menu, else c172s)
//   era=present|cretaceous                        world era (default: the era chosen in the menu, else present;
//                                                 see src/sim/eraChoice.ts and src/world/era/types.ts)
//   scenario=runway|apron|final|cruise|downwind|safari   start scenario (default runway, or the era's default
//                                                 start, e.g. safari in the Cretaceous)
//   cam=cockpit|chase|orbit|flyby|tower           camera mode (default cockpit)
//   tod=9.5        local solar time, hours          doy=172      day of year
//   cover=0.35     cloud cover 0..1                 base=1500    cloud base, m MSL (the layer keeps its depth)
//   cirrus=0.1     cirrus deck cover 0..1 (independent of cover)
//   vis=60000      visibility, m                    qnh=1013.25  sea-level pressure, hPa
//   wind=100,6[,12]  wind FROM direction deg true, speed kt[, gusts kt]
//   turb=0.1       turbulence 0..1                  temp=0       ISA deviation, K
//   top=2600       cloud top, m MSL (at least base + 100 when a base is also given by base= or wx=)
// Optional weather fields (core/weatherFields.ts, docs/weather.md); absent, the weather has none of them:
//   wx=fog         a free-flight preset (src/sim/weatherPresets.ts ids: clear, fair, overcast, gusty, lowifr,
//                  fog, drizzle, rain, snow, thunderstorm), applied first: the other weather parameters override it
//   ctype=stratus  low layer type: auto|stratus|stratocumulus|cumulus|towering|nimbostratus
//   mid=as,0.8[,4500]   mid-level sheet: as (altostratus) or ac (altocumulus), cover 0..1[, altitude m MSL]
//   precip=rain,4  precipitation: drizzle|rain|snow, rate mm/h 0..50 (precip=none: none)
//   fog=60[,200]   ground fog depth above the field, m 0..300[, visibility inside it, m 50..1000]
//   cb=-12,0[,11[,0.8[,3[,270,15]]]]   a cumulonimbus cell: north km, east km from the airport[, top km MSL
//                  6..14[, intensity 0..1[, core radius km 1..5[, moving FROM deg, kt]]]]; repeat cb= for up to 4
//                  cells. Without cb= the cells are derived from the conditions (physics/weather/stormField.ts);
//                  any cb= replaces them with the listed cells, and cb=none gives no cells at all
//   quality=low|medium|high|ultra (default high)    dpr=1.5      device-pixel-ratio cap (default 1: the 3D
//                                                                  view renders at CSS-pixel resolution)
//   scale=0.75     3D render scale 0.5..1 (times the capped pixel ratio; the DOM UI stays at native DPR;
//                  default 0.75 on quality=low, 1 otherwise)
//   depth=log|reversed   depth-buffer convention (default: reversed-Z where EXT_clip_control exists)
//   clock=0        freeze the local time of day (default: it runs with the simulation)
//   assist=0       keyboard assists off: no ground-steering auto-rudder (feet off the pedals: the rudder and
//                  nosewheel float) and no roll trim
//   hud=0|1        external-view HUD                ui=0         hide every DOM overlay (clean screenshots)
//   ap=1           autoflight: fly the scenario by itself (see src/sim/autoflight.ts)
//   demo=startup|hover|approach|autorotation|circuit   R22 scripted flights; trace=1 opens the live graph
//   run=30         after loading, advance the simulation this many seconds as fast as possible
//   freeze=1       pause once loading (and run=) is done; the PAUSED badge is hidden
//   mute=1         no sound
//   camPos=n,e,alt & camLook=n,e,alt   fixed free camera (NED metres, alt MSL); overrides cam
//   fov=60         camera vertical field of view for the fixed camera, degrees
//   moon=4         Moon size, a multiple of its real size, 1..5 (default: the menu's setting, else 4; it grows
//                  further toward the horizon; not stored, see src/sim/skyPrefs.ts)
//   resume=0|1     resume on reload (see resume.ts). Absent: the last flight is resumed unless scenario= is given
//                  or the menu's "Resume where I left off on reload" is off; resume=1 resumes even then;
//                  resume=0 neither resumes nor saves
//
// Flight School (docs/instructor-spec.md section 5.10; testing and dev):
//   school=0|1     0: never open the welcome card or the school home on boot; 1: open the home even with a
//                  resumed flight. Absent: the boot path of section 1.1 (welcome / home unless scenario= is
//                  given; automated browsers, navigator.webdriver, behave as school=0 unless school=1)
//   lesson=L04     open that lesson's briefing directly (locks ignored: practice credit unless available)
//   phase=climb    with lesson=: start at that phase (no logbook credit)
//   brief=0        with lesson=: skip the briefing and start flying
//   voice=0        captions only
//   standard=easa|faa   authority for this session (the saved profile is not changed)
//   tstore=mem     in-memory training store (nothing written to localStorage)
//   unlock=1       every lesson available this session (practice credit only)
//   student=auto   dev: the AutoStudent flies the student's tasks (screenshots and smoke runs)

import type { CameraMode, QualityLevel, ScenarioId } from '../core/context';
import { isAircraftId, type AircraftId, type WeatherSettings } from '../core/types';
import { SCENARIO_IDS } from './scenarios';
import { ERA_IDS, type EraId } from '../world/era/types';
import { ERA_SCENARIO_IDS } from './eraChoice';
import { isR22Demo, type R22DemoId } from './rotorcraft/flights';
import { sanitizeMoonScale } from './skyPrefs';
import type { CloudType, MidCloudType, StormCell } from '../core/types';
import { FOG_TOP_MAX_M, FOG_VIS_MAX_M, FOG_VIS_MIN_M, MAX_STORMS, MID_ALT_MAX_M, NO_STORMS, PRECIP_RATE_MAX_MMH } from '../core/weatherFields';
import { CB_DEFAULT_INTENSITY, CB_DEFAULT_RADIUS_M, CB_DEFAULT_TOP_M, stormCell, weatherPresetById } from './weatherPresets';

const CAMERA_MODES: readonly CameraMode[] = ['cockpit', 'chase', 'orbit', 'flyby', 'tower'];
const CLOUD_TYPES: readonly CloudType[] = ['auto', 'stratus', 'stratocumulus', 'cumulus', 'towering', 'nimbostratus'];
const MID_KINDS: Readonly<Record<string, MidCloudType>> = { as: 'altostratus', ac: 'altocumulus' };
/** top= is raised to at least the base plus this, m (a layer needs a depth). */
export const MIN_LAYER_DEPTH_M = 100;
const QUALITIES: readonly QualityLevel[] = ['low', 'medium', 'high', 'ultra'];
/**
 * Every scenario a URL may name: SCENARIO_IDS plus the era starts (eraChoice.ts ERA_SCENARIO_IDS: 'safari'),
 * which are not in SCENARIO_IDS (the present-day suites and goldens iterate that list).
 */
export const URL_SCENARIO_IDS: readonly ScenarioId[] = [...new Set([...SCENARIO_IDS, ...ERA_SCENARIO_IDS])];

export interface SimParams {
  /** aircraft=<id>, or null when it is absent or not a known id. */
  aircraft: AircraftId | null;
  /** era=<id>, or undefined when it is absent or not a known id (eraChoice.ts then uses the stored choice). */
  era: EraId | undefined;
  scenario: ScenarioId;
  /** scenario= was given (a valid id): the URL asks for that scenario, not for the resumed flight. */
  explicitScenario: boolean;
  /** resume=1 (true), resume=0 (false) or absent (null). */
  resume: boolean | null;
  cam: CameraMode;
  quality: QualityLevel;
  dprCap: number | null;
  /** 3D render scale, 0.5..1; null when scale= is absent (the per-quality default applies: low 0.75, else 1). */
  renderScale: number | null;
  depth: 'auto' | 'log' | 'reversed';
  /** Advance weather.timeOfDay with the simulation. */
  clock: boolean;
  /** Keyboard-flying assists (ground steering, roll trim); assist=0 turns both off. */
  assists: boolean;
  hud: boolean;
  ui: boolean;
  autoflight: boolean;
  helicopterHover: boolean;
  /** Explicit R22 scripted flight (ignored for other aircraft). */
  demo: R22DemoId | null;
  demoTrace: boolean;
  run: number;
  freeze: boolean;
  mute: boolean;
  camPos: [number, number, number] | null;
  camLook: [number, number, number] | null;
  fov: number | null;
  /** moon=<1..5> (clamped, step 0.25), or null when absent or not a number (skyPrefs.ts uses the stored setting). */
  moonScale: number | null;
  /** Weather overrides to apply to the defaults. */
  weather: Partial<WeatherSettings>;
  /** Flight School parameters (section 5.10). */
  school: SchoolParams;
}

export interface SchoolParams {
  /** school=0 (false), school=1 (true) or absent (null). */
  open: boolean | null;
  /** lesson=<id>, or null. */
  lesson: string | null;
  /** phase=<phaseId> (with lesson=), or null. */
  phase: string | null;
  /** brief=0 skips the briefing (with lesson=). */
  brief: boolean;
  /** voice=0: captions only. */
  voice: boolean;
  /** standard=easa|faa for this session, or null (the profile's authority). */
  standard: 'easa' | 'faa' | null;
  /** tstore=mem: in-memory training store. */
  memoryStore: boolean;
  /** unlock=1: every lesson available (practice credit only). */
  unlock: boolean;
  /** student=auto: the AutoStudent flies student tasks (dev). */
  autoStudent: boolean;
}

export function parseParams(search: string): SimParams {
  const q = new URLSearchParams(search);
  const num = (k: string): number | null => {
    const v = q.get(k);
    if (v === null || v.trim() === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const list = (k: string): number[] | null => {
    const v = q.get(k);
    if (!v) return null;
    const p = v.split(',').map(Number);
    return p.every(Number.isFinite) ? p : null;
  };
  const triple = (k: string): [number, number, number] | null => {
    const p = list(k);
    return p && p.length === 3 ? [p[0], p[1], p[2]] : null;
  };
  const oneOf = <T extends string>(k: string, options: readonly T[], fallback: T): T => {
    const v = q.get(k) as T | null;
    return v && options.includes(v) ? v : fallback;
  };

  // A preset first (wx=): every other weather parameter overrides it.
  const preset = weatherPresetById(q.get('wx'));
  const weather: Partial<WeatherSettings> = preset ? { ...preset.settings } : {};
  const tod = num('tod');
  if (tod !== null) weather.timeOfDay = ((tod % 24) + 24) % 24;
  const doy = num('doy');
  if (doy !== null) weather.dayOfYear = doy;
  const cover = num('cover');
  if (cover !== null) weather.cloudCover = Math.min(1, Math.max(0, cover));
  const cirrus = num('cirrus');
  if (cirrus !== null) weather.cirrusCover = Math.min(1, Math.max(0, cirrus));
  const vis = num('vis');
  if (vis !== null) weather.visibilityM = Math.max(100, vis);
  const qnh = num('qnh');
  if (qnh !== null) weather.qnhHpa = qnh;
  const temp = num('temp');
  if (temp !== null) weather.isaDeviation = temp;
  const turb = num('turb');
  if (turb !== null) weather.turbulence = Math.min(1, Math.max(0, turb));
  const wind = list('wind');
  if (wind && wind.length >= 2) {
    weather.windDirectionDeg = ((wind[0] % 360) + 360) % 360;
    weather.windSpeedKt = Math.max(0, wind[1]);
    weather.gustKt = wind.length >= 3 ? Math.max(0, wind[2]) : 0;
  }
  const base = num('base');
  const top = num('top');
  // base= without top= keeps the preset's layer depth (with no preset, the Simulator keeps the current depth).
  if (base !== null && top === null && weather.cloudBaseM !== undefined && weather.cloudTopM !== undefined) {
    weather.cloudTopM = base + (weather.cloudTopM - weather.cloudBaseM);
  }
  if (base !== null) weather.cloudBaseM = base;
  if (top !== null) weather.cloudTopM = weather.cloudBaseM !== undefined ? Math.max(weather.cloudBaseM + MIN_LAYER_DEPTH_M, top) : top;
  const ctype = q.get('ctype');
  if ((CLOUD_TYPES as readonly string[]).includes(ctype ?? '')) weather.cloudType = ctype as CloudType;
  const mid = q.get('mid')?.split(',');
  if (mid && Object.hasOwn(MID_KINDS, mid[0]) && mid.length >= 2 && mid.slice(1).every((v) => v.trim() !== '' && Number.isFinite(Number(v)))) {
    weather.midType = MID_KINDS[mid[0]];
    weather.midCover = Math.min(1, Math.max(0, Number(mid[1])));
    if (mid.length >= 3) weather.midAltM = Math.min(MID_ALT_MAX_M, Math.max(0, Number(mid[2])));
  }
  const precip = q.get('precip')?.split(',');
  if (precip?.[0] === 'none') {
    weather.precipType = 'none';
    weather.precipRateMmH = 0;
  } else if (precip && (precip[0] === 'drizzle' || precip[0] === 'rain' || precip[0] === 'snow') && precip.length === 2 && precip[1].trim() !== '' && Number.isFinite(Number(precip[1]))) {
    weather.precipType = precip[0];
    weather.precipRateMmH = Math.min(PRECIP_RATE_MAX_MMH, Math.max(0, Number(precip[1])));
  }
  const fog = list('fog');
  if (fog && fog.length >= 1 && fog.length <= 2) {
    weather.fogTopM = Math.min(FOG_TOP_MAX_M, Math.max(0, fog[0]));
    if (fog.length === 2) weather.fogVisibilityM = Math.min(FOG_VIS_MAX_M, Math.max(FOG_VIS_MIN_M, fog[1]));
  }
  const cb = q.getAll('cb');
  if (cb.includes('none')) weather.storms = NO_STORMS;
  else if (cb.length > 0) {
    const storms: StormCell[] = [];
    for (const v of cb) {
      const c = v.split(',').map((x) => (x.trim() === '' ? NaN : Number(x)));
      if (c.length < 2 || c.length === 6 || c.length > 7 || !c.every(Number.isFinite)) continue;
      if (storms.length < MAX_STORMS) {
        storms.push(stormCell({
          northM: c[0] * 1000,
          eastM: c[1] * 1000,
          topM: c.length > 2 ? c[2] * 1000 : CB_DEFAULT_TOP_M,
          intensity: c.length > 3 ? c[3] : CB_DEFAULT_INTENSITY,
          radiusM: c.length > 4 ? c[4] * 1000 : CB_DEFAULT_RADIUS_M,
          motionDeg: c.length > 6 ? c[5] : 0,
          motionKt: c.length > 6 ? c[6] : 0,
        }));
      }
    }
    if (storms.length > 0) weather.storms = Object.freeze(storms);
  }

  const camPos = triple('camPos');
  const aircraft = q.get('aircraft');
  return {
    aircraft: isAircraftId(aircraft) ? aircraft : null,
    era: (ERA_IDS as readonly string[]).includes(q.get('era') ?? '') ? (q.get('era') as EraId) : undefined,
    scenario: oneOf('scenario', URL_SCENARIO_IDS, 'runway'),
    explicitScenario: URL_SCENARIO_IDS.includes(q.get('scenario') as ScenarioId),
    resume: q.get('resume') === '1' ? true : q.get('resume') === '0' ? false : null,
    cam: oneOf('cam', CAMERA_MODES, camPos ? 'tower' : 'cockpit'),
    quality: oneOf('quality', QUALITIES, 'high'),
    dprCap: num('dpr'),
    renderScale: num('scale') === null ? null : Math.min(1, Math.max(0.5, num('scale')!)),
    depth: oneOf('depth', ['auto', 'log', 'reversed'] as const, 'auto'),
    clock: q.get('clock') !== '0',
    assists: q.get('assist') !== '0',
    hud: q.get('hud') !== '0',
    ui: q.get('ui') !== '0',
    autoflight: q.get('ap') === '1',
    helicopterHover: q.get('hover') === '1',
    demo: isR22Demo(q.get('demo')) ? q.get('demo') as R22DemoId : null,
    demoTrace: q.get('trace') === '1',
    run: Math.max(0, num('run') ?? 0),
    freeze: q.get('freeze') === '1',
    mute: q.get('mute') === '1',
    camPos,
    camLook: triple('camLook'),
    fov: num('fov'),
    moonScale: sanitizeMoonScale(q.get('moon')),
    weather,
    school: {
      open: q.get('school') === '1' ? true : q.get('school') === '0' ? false : null,
      lesson: q.get('lesson')?.trim() || null,
      phase: q.get('phase')?.trim() || null,
      brief: q.get('brief') !== '0',
      voice: q.get('voice') !== '0' && q.get('mute') !== '1',
      standard: q.get('standard') === 'easa' || q.get('standard') === 'faa' ? (q.get('standard') as 'easa' | 'faa') : null,
      memoryStore: q.get('tstore') === 'mem',
      unlock: q.get('unlock') === '1',
      autoStudent: q.get('student') === 'auto',
    },
  };
}
