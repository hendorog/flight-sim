// The in-flight job strip (docs/career.md "In flight"), top centre where the lesson strip sits (lessons and jobs
// never run together): the phase, the job's title, the destination or the next scenic turning point ("2 of 3")
// with its distance and bearing, one line of what to do next, and chips for the time (ETA against the time left:
// early, late, or already past the deadline), the fuel (endurance and the projected reserve at arrival), the wind,
// the passengers' comfort and, for helicopters near the stand, the distance to the landing spot. Abandon shows only
// when the CareerSystem says it may be used (on the ground at a field).
//
// The text of every chip is a pure function exported for the tests. The DOM is touched only when a text changes
// (the model arrives every frame).

import { el, setText } from '../../ui/dom';
import type { JobStripModel } from '../types';
import { bearing, minutes, nm, phaseLabel, wind } from './format';

/** Projected reserve at arrival below this (min of cruise flow) turns the fuel chip amber. */
export const RESERVE_AMBER_MIN = 20;
/** Projected reserve at arrival below this (min of cruise flow) turns the fuel chip red. */
export const RESERVE_RED_MIN = 10;
/**
 * How far the HUD's top-centre elements should move down while the job strip shows, px (the strip is two rows; the
 * school's lesson strip needs uiSystem's STRIP_CLEARANCE, 104).
 */
export const CAREER_STRIP_CLEARANCE = 136;
/** ETA within this of the time left turns the time chip amber, min. */
export const TIME_AMBER_MIN = 5;

/** A chip's colour: in hand, getting tight, past the limit, or neutral. */
export type ChipTone = 'green' | 'amber' | 'red' | '';

/** The target line: "KHOL Holthurst · 12.4 NM · 087°", or "2 of 3 · Point B, 7 NM north-east · 4.1 NM · 120°". */
export function stripTargetText(m: JobStripModel): string {
  const wp = m.waypointIndex !== null && m.waypointsTotal ? `${m.waypointIndex + 1} of ${m.waypointsTotal} · ` : '';
  return `${wp}${m.target} · ${nm(m.distanceNm)} · ${bearing(m.bearingDeg)}`;
}

/** The time chip: "8 min early" / "3 min late" (projected at the ETA), "6 min late" past the deadline, with the ETA. */
export function stripTime(m: JobStripModel): { text: string; sub: string; tone: ChipTone } {
  if (m.remainingMin < 0) return { text: `${minutes(-m.remainingMin)} late`, sub: `ETA ${minutes(m.etaMin)}`, tone: 'red' };
  const margin = m.remainingMin - m.etaMin;
  const sub = `ETA ${minutes(m.etaMin)} · ${minutes(m.remainingMin)} left`;
  if (margin < 0) return { text: `${minutes(-margin)} late`, sub, tone: 'amber' };
  return { text: `${minutes(margin)} early`, sub, tone: margin < TIME_AMBER_MIN ? 'amber' : 'green' };
}

/** The fuel chip: "Reserve 38 min" at arrival, with the endurance. */
export function stripFuel(m: JobStripModel): { text: string; sub: string; tone: ChipTone } {
  const r = m.projectedReserveMin;
  return {
    text: r < 0 ? `Short ${minutes(-r)}` : `Reserve ${minutes(r)}`,
    sub: `Endurance ${minutes(m.enduranceMin)}`,
    tone: r < RESERVE_RED_MIN ? 'red' : r < RESERVE_AMBER_MIN ? 'amber' : 'green',
  };
}

/** The helicopter spot line: "Spot 42 m" (null when not near the destination). */
export function stripSpotText(m: JobStripModel): string | null {
  return m.spotDistM === null ? null : `Spot ${Math.round(m.spotDistM)} m`;
}

/** The strip. Created hidden; `update(null)` hides it again. */
export class JobStrip {
  /** Called when the strip's Abandon button is pressed. */
  onAbandon: (() => void) | null = null;
  readonly root: HTMLElement;
  private readonly phase: HTMLElement;
  private readonly title: HTMLElement;
  private readonly target: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly time: HTMLElement;
  private readonly timeSub: HTMLElement;
  private readonly fuel: HTMLElement;
  private readonly fuelSub: HTMLElement;
  private readonly windChip: HTMLElement;
  private readonly comfort: HTMLElement;
  private readonly comfortFill: HTMLElement;
  private readonly comfortNum: HTMLElement;
  private readonly spot: HTMLElement;
  private readonly abandon: HTMLButtonElement;
  private last = '';

  constructor(parent: HTMLElement) {
    this.root = el('div', 'cr-strip hidden', parent);
    const left = el('div', 'cr-strip-left', this.root);
    this.phase = el('span', 'cr-phase', left, '');
    this.abandon = el('button', 'cr-abandon hidden', left, 'Abandon');
    this.abandon.tabIndex = -1;
    this.abandon.title = 'End the job here (no pay; reputation -2)';
    this.abandon.addEventListener('click', (e) => {
      e.stopPropagation();
      this.abandon.blur();
      this.onAbandon?.();
    });
    const mid = el('div', 'cr-strip-mid', this.root);
    this.title = el('b', '', mid, '');
    this.target = el('span', 'cr-strip-target num', mid, '');
    this.hint = el('span', 'cr-strip-hint', mid, '');
    const chips = el('div', 'cr-strip-chips', this.root);
    const chip = (cls: string): [HTMLElement, HTMLElement, HTMLElement] => {
      const c = el('div', `cr-chip2 ${cls}`, chips);
      return [c, el('b', 'num', c, ''), el('span', 'num', c, '')];
    };
    [, this.time, this.timeSub] = chip('time');
    [, this.fuel, this.fuelSub] = chip('fuel');
    this.windChip = el('div', 'cr-chip2 wind', chips);
    this.comfort = el('div', 'cr-chip2 comfort', chips);
    el('span', '', this.comfort, 'Comfort');
    const bar = el('div', 'cr-bar', this.comfort);
    this.comfortFill = el('i', '', bar);
    this.comfortNum = el('b', 'num', this.comfort, '');
    this.spot = el('div', 'cr-chip2 spot hidden', chips);
  }

  /** True while the strip shows (uiSystem moves the HUD down by CAREER_STRIP_CLEARANCE). */
  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  /** Show the strip for this model (null hides it); `canAbandon` shows the Abandon button. */
  update(m: JobStripModel | null, opts: { canAbandon?: boolean } = {}): void {
    if (!m) {
      this.root.classList.add('hidden');
      this.last = '';
      return;
    }
    this.root.classList.remove('hidden');
    const key = JSON.stringify([m, !!opts.canAbandon]);
    if (key === this.last) return;
    this.last = key;
    setText(this.phase, phaseLabel(m.phase));
    this.phase.className = `cr-phase ${m.phase}`;
    this.abandon.classList.toggle('hidden', !opts.canAbandon);
    setText(this.title, m.title);
    setText(this.target, stripTargetText(m));
    setText(this.hint, m.hint);
    const t = stripTime(m);
    setText(this.time, t.text);
    setText(this.timeSub, t.sub);
    (this.time.parentElement as HTMLElement).className = `cr-chip2 time ${t.tone}`;
    const f = stripFuel(m);
    setText(this.fuel, f.text);
    setText(this.fuelSub, f.sub);
    (this.fuel.parentElement as HTMLElement).className = `cr-chip2 fuel ${f.tone}`;
    setText(this.windChip, wind(m.windDirDeg, m.windKt));
    this.comfort.classList.toggle('hidden', m.comfort === null);
    if (m.comfort !== null) {
      const v = Math.max(0, Math.min(100, m.comfort));
      this.comfortFill.style.width = `${v}%`;
      this.comfort.className = `cr-chip2 comfort ${v >= 85 ? 'green' : v >= 50 ? 'amber' : 'red'}`;
      setText(this.comfortNum, String(Math.round(v)));
    }
    const spot = stripSpotText(m);
    this.spot.classList.toggle('hidden', spot === null);
    if (spot) setText(this.spot, spot);
  }
}
