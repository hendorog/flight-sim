// Pure helpers behind the World chooser on the menu's Flight page, the era gates of the menu and the era's
// loading and spawn text (Deep Time). No DOM here (tests/ui/eraChooser.test.ts).

import type { ScenarioId } from '../core/context';
import type { AircraftState } from '../core/types';
import { eraSwitchUrl } from '../sim/eraChoice';
import { ERAS } from '../world/era/registry';
import { ERA_IDS, type EraId, type EraParams } from '../world/era/types';

export interface EraRow {
  id: EraId;
  label: string;
  /** '~67 Ma', or '' for the present day. */
  epoch: string;
  blurb: string;
  /** The world being flown now. */
  current: boolean;
}

/** The chooser's rows: every era, the present day first, with the flown one marked. */
export function eraRows(current: EraId): EraRow[] {
  return ERA_IDS.map((id) => {
    const e = ERAS[id];
    return { id, label: e.label, epoch: e.epoch, blurb: e.blurb, current: id === current };
  });
}

/**
 * The page a change of world reloads into: the current address without `era`, `scenario`, `lesson`, `phase`,
 * `brief`, `resume`, `demo` and `trace` (the choice is stored instead, see eraChoice.eraSwitchUrl). The aircraft
 * and every other parameter are kept; the new world starts its default scenario.
 */
export function eraChoiceUrl(current: string): string {
  return eraSwitchUrl(current);
}

/**
 * The same for a dev page (no commands.setEra): src/dev/harness.ts reads only the URL's `era`, not the stored
 * preference, so the address names the chosen era (the present day: none, its default).
 */
export function eraDevChoiceUrl(current: string, id: EraId): string {
  const url = new URL(eraSwitchUrl(current));
  if (id !== 'present') url.searchParams.set('era', id);
  return url.toString();
}

/** What the menu hides in an era (the School tab and the tower camera only exist where there is an airport). */
export interface EraGates {
  school: boolean;
  towerCamera: boolean;
}

export function eraGates(era: Pick<EraParams, 'world'> | undefined): EraGates {
  return { school: era?.world.school ?? true, towerCamera: era?.world.towerCamera ?? true };
}

/** The scenario a world starts with when the pilot chooses it (absent: the usual one). */
export function eraDefaultScenario(id: EraId): ScenarioId | undefined {
  return ERAS[id].world.defaultScenario;
}

/** Ground speed below which the aircraft counts as standing still, m/s (as chooser.ts). */
const STANDING_STILL = 0.5;

/** What to say before reloading into another world, or null to go straight away (standing still on the ground). */
export function eraConfirmation(s: AircraftState, lessonActive: boolean, current: EraRow, chosen: EraRow): { kind: 'flight' | 'lesson'; text: string } | null {
  const reload = 'Reloads the world.';
  if (lessonActive) return { kind: 'lesson', text: `${reload} Abandon the lesson and go to ${chosen.label}? The flight so far is logged.` };
  const airborne = !s.wheels.some((w) => w.onGround);
  if (airborne || s.groundSpeed > STANDING_STILL) return { kind: 'flight', text: `${reload} Leave this flight in ${current.label} and go to ${chosen.label}? It is not resumed later.` };
  return null;
}

/** Flavour lines that rotate under an era's loading title (the present day keeps the usual flying tips). */
export const ERA_LOADING_LINES: Readonly<Record<EraId, readonly string[]>> = {
  present: [],
  cretaceous: [
    'There is no airfield: the dry mud flats are all the runway you get, and the dark game trail is your centreline.',
    'Hadrosaur herds graze the river plain; they scatter from low, fast aircraft.',
    'The giant pterosaurs ride the same thermals you do. Follow a kettle and you will find lift.',
    'The volcano 17 km to the west is a handy landmark; at dusk (about 19:30) it stands black against the sunset.',
    'Dirt is rougher than pavement: expect a longer take-off roll.',
    'There is no snow here, and no tower: the wind is yours to read.',
  ],
};

/** The loading screen's title and tag for an era: its name, and its epoch with the aircraft (the present day: null, the usual screen). */
export function eraLoadingTitle(e: Pick<EraParams, 'id' | 'label' | 'epoch'>, aircraft: string): { title: string; tag: string } | null {
  if (e.id === 'present') return null;
  return { title: e.label, tag: `${e.epoch} · ${aircraft}` };
}

const norm360 = (d: number): number => ((d % 360) + 360) % 360;

/**
 * The one-time toast at the start on the Flats: the surface wind (from, degrees / knots) and which way to take
 * off (into the wind, along the runway axis the trail follows; 250 points at the volcano).
 */
export function spawnWindAdvice(windFromDeg: number, windKt: number, runwayHeadingDeg = 70, volcanoBearingDeg = 276): string {
  const ends = [norm360(runwayHeadingDeg), norm360(runwayHeadingDeg + 180)];
  const angle = (a: number, b: number): number => Math.abs(((a - b + 540) % 360) - 180);
  const toward = (end: number): string => (angle(end, volcanoBearingDeg) < 60 ? ' toward the volcano' : '');
  if (windKt < 3) return `Wind calm - take off either way along the trail; the volcano lies west`;
  const into = angle(windFromDeg, ends[0]) <= angle(windFromDeg, ends[1]) ? ends[0] : ends[1];
  const hdg = String(Math.round(into)).padStart(3, '0');
  const w = `${String(Math.round(norm360(windFromDeg)) || 360).padStart(3, '0')}/${Math.round(windKt)}`;
  return `Wind ${w} - take off heading ${hdg}${toward(into)}`;
}
