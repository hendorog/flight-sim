// URL parameters of index.html (automation hooks and screenshot set-ups). All optional.
//
//   aircraft=c172s|c152|pa38|da20|pa34|da42       aircraft type (default: the type chosen in the menu, else c172s)
//   scenario=runway|apron|final|cruise|downwind   start scenario (default runway)
//   cam=cockpit|chase|orbit|flyby|tower           camera mode (default cockpit)
//   tod=9.5        local solar time, hours          doy=172      day of year
//   cover=0.35     cloud cover 0..1                 base=1500    cloud base, m MSL (the layer keeps its depth)
//   cirrus=0.1     cirrus deck cover 0..1 (independent of cover)
//   vis=60000      visibility, m                    qnh=1013.25  sea-level pressure, hPa
//   wind=100,6[,12]  wind FROM direction deg true, speed kt[, gusts kt]
//   turb=0.1       turbulence 0..1                  temp=0       ISA deviation, K
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
//   run=30         after loading, advance the simulation this many seconds as fast as possible
//   freeze=1       pause once loading (and run=) is done; the PAUSED badge is hidden
//   mute=1         no sound
//   camPos=n,e,alt & camLook=n,e,alt   fixed free camera (NED metres, alt MSL); overrides cam
//   fov=60         camera vertical field of view for the fixed camera, degrees
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

const CAMERA_MODES: readonly CameraMode[] = ['cockpit', 'chase', 'orbit', 'flyby', 'tower'];
const QUALITIES: readonly QualityLevel[] = ['low', 'medium', 'high', 'ultra'];

export interface SimParams {
  /** aircraft=<id>, or null when it is absent or not a known id. */
  aircraft: AircraftId | null;
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
  run: number;
  freeze: boolean;
  mute: boolean;
  camPos: [number, number, number] | null;
  camLook: [number, number, number] | null;
  fov: number | null;
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

  const weather: Partial<WeatherSettings> = {};
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
  if (base !== null) weather.cloudBaseM = base;

  const camPos = triple('camPos');
  const aircraft = q.get('aircraft');
  return {
    aircraft: isAircraftId(aircraft) ? aircraft : null,
    scenario: oneOf('scenario', SCENARIO_IDS, 'runway'),
    explicitScenario: SCENARIO_IDS.includes(q.get('scenario') as ScenarioId),
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
    run: Math.max(0, num('run') ?? 0),
    freeze: q.get('freeze') === '1',
    mute: q.get('mute') === '1',
    camPos,
    camLook: triple('camLook'),
    fov: num('fov'),
    weather,
    school: {
      open: q.get('school') === '1' ? true : q.get('school') === '0' ? false : null,
      lesson: q.get('lesson')?.trim() || null,
      phase: q.get('phase')?.trim() || null,
      brief: q.get('brief') !== '0',
      voice: q.get('voice') !== '0',
      standard: q.get('standard') === 'easa' || q.get('standard') === 'faa' ? (q.get('standard') as 'easa' | 'faa') : null,
      memoryStore: q.get('tstore') === 'mem',
      unlock: q.get('unlock') === '1',
      autoStudent: q.get('student') === 'auto',
    },
  };
}
