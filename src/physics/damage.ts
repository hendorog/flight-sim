// Landing damage: what a hard landing, a gear collapse, a propeller strike or an airframe scrape has done to the
// aircraft, as plain data. LandingGear (gear/landingGear.ts) writes it for a type whose GearConfig carries a
// `damage` block; the flight model exposes it (AircraftState.damage) and keeps integrating, because damage is
// not a crash: a crash (terrain impact, flipped over, ditching, structural failure) still ends the flight.
//
// Each landing-gear leg moves one way through ok -> hard -> bent (spring leg) or bottomed (oleo) -> collapsed;
// each propeller can be struck (a tip strike: the engine runs on) and then stopped (the blades dug in: a piston
// engine stops, a free turbine's propeller and power turbine stop while its gas generator runs); the airframe
// items (wingtips, tail, nose / firewall, belly) carry the worst severity they have taken. Every change appends
// one event {time, item, severity, text} to `events`, which a host reads as new items appear.
//
// Severity: 'inspection' (fly on, but an inspection is due before the next flight), 'damage' (the aircraft is
// unairworthy but still under control), 'disabling' (it cannot go on: a collapsed leg, a stopped engine, a
// belly slide).

/** State of one landing-gear leg, in the order it can only move. */
export type LegStatus = 'ok' | 'hard' | 'bent' | 'bottomed' | 'collapsed';

export type DamageSeverity = 'inspection' | 'damage' | 'disabling';

/** Airframe items that a ground contact at landing energy damages. */
export type AirframeItem = 'wingtipLeft' | 'wingtipRight' | 'tail' | 'nose' | 'belly';

/** What an event is about: the landing as a whole, a leg, a propeller (by disc index) or an airframe item. */
export type DamageItem = 'hardLanding' | 'noseGear' | 'leftMain' | 'rightMain' | `propeller${number}` | AirframeItem;

export interface LegDamage {
  status: LegStatus;
  /**
   * Permanent set of a bent spring leg: how far its extended contact point has moved along the leg axis (up and
   * outboard, the way the leg flexes), m.
   */
  set: number;
  /** Toe-out of the bent leg's wheel, rad (+ = the wheel points outboard; 0 unless LegDamageConfig.toePerSet). */
  toe: number;
  /** Highest axial leg load seen, N. */
  peakLoad: number;
}

export interface PropDamage {
  /** The disc touched the ground. */
  struck: boolean;
  /** The blades dug in: the engine (a free turbine's propeller and power turbine) is stopped for good. */
  stopped: boolean;
}

export interface DamageEvent {
  /** Flight-model time of the event, s. */
  time: number;
  item: DamageItem;
  severity: DamageSeverity;
  /** What the pilot is told ("Nose gear collapsed", "Propeller strike: engine stopped"). */
  text: string;
}

export interface DamageState {
  /** Nose (or tail wheel), left main, right main: the order of AircraftState.wheels. */
  legs: [LegDamage, LegDamage, LegDamage];
  /** One per propeller disc of the gear configuration (the engine order). */
  props: PropDamage[];
  /** Worst severity each airframe item has taken (null: untouched). */
  airframe: Record<AirframeItem, DamageSeverity | null>;
  /** Every change, oldest first. */
  events: DamageEvent[];
}

const RANK: Record<DamageSeverity, number> = { inspection: 1, damage: 2, disabling: 3 };

/** 0 for none, 1 inspection, 2 damage, 3 disabling. */
export function severityRank(s: DamageSeverity | null | undefined): number {
  return s ? RANK[s] : 0;
}

/** Event item of the leg in slot `index` (0 nose, 1 left main, 2 right main). */
export const LEG_ITEMS = ['noseGear', 'leftMain', 'rightMain'] as const satisfies readonly DamageItem[];

function emptyLeg(): LegDamage {
  return { status: 'ok', set: 0, toe: 0, peakLoad: 0 };
}

/** An undamaged aircraft with `propellers` discs. */
export function emptyDamage(propellers: number): DamageState {
  return {
    legs: [emptyLeg(), emptyLeg(), emptyLeg()],
    props: Array.from({ length: propellers }, () => ({ struck: false, stopped: false })),
    airframe: { wingtipLeft: null, wingtipRight: null, tail: null, nose: null, belly: null },
    events: [],
  };
}

/** Deep copy (plain data: what a snapshot keeps). */
export function cloneDamage(d: DamageState): DamageState {
  return {
    legs: [{ ...d.legs[0] }, { ...d.legs[1] }, { ...d.legs[2] }],
    props: d.props.map((p) => ({ ...p })),
    airframe: { ...d.airframe },
    events: d.events.map((e) => ({ ...e })),
  };
}

/** Worst severity of any event so far (null: undamaged). */
export function worstSeverity(d: DamageState): DamageSeverity | null {
  let worst: DamageSeverity | null = null;
  for (const e of d.events) if (severityRank(e.severity) > severityRank(worst)) worst = e.severity;
  return worst;
}

/** The live damage record of one flight: the state plus the bookkeeping that writes it. */
export class DamageModel {
  readonly state: DamageState;

  constructor(readonly propellers: number) {
    this.state = emptyDamage(propellers);
  }

  /** Back to an undamaged aircraft (a new flight). */
  reset(): void {
    this.restore(emptyDamage(this.propellers));
  }

  capture(): DamageState {
    return cloneDamage(this.state);
  }

  /** Put a captured state back (props beyond the snapshot's count are undamaged). */
  restore(s: DamageState): void {
    const d = this.state;
    for (let i = 0; i < 3; i++) Object.assign(d.legs[i], s.legs[i] ?? emptyLeg());
    for (let i = 0; i < d.props.length; i++) Object.assign(d.props[i], s.props[i] ?? { struck: false, stopped: false });
    Object.assign(d.airframe, s.airframe);
    d.events.length = 0;
    for (const e of s.events) d.events.push({ ...e });
  }

  /** Append an event. */
  note(time: number, item: DamageItem, severity: DamageSeverity, text: string): void {
    this.state.events.push({ time, item, severity, text });
  }

  /** Raise an airframe item to `severity` (never lower it); true (and an event) when it rose. */
  airframe(time: number, item: AirframeItem, severity: DamageSeverity, text: string): boolean {
    const a = this.state.airframe;
    if (severityRank(severity) <= severityRank(a[item])) return false;
    a[item] = severity;
    this.note(time, item, severity, text);
    return true;
  }

  /** True when no event has been recorded. */
  get clean(): boolean {
    return this.state.events.length === 0;
  }
}

/**
 * The aircraft cannot go on (a collapsed leg, a stopped engine, a belly slide): what blocks the aircraft hot swap,
 * as a crash does. False without a damage record (a type without damage limits).
 */
export function disabled(d: DamageState | null | undefined): boolean {
  return !!d && worstSeverity(d) === 'disabling';
}

/** The aircraft carries damage beyond an inspection note (the DAMAGED chip). */
export function damaged(d: DamageState | null | undefined): boolean {
  return !!d && severityRank(worstSeverity(d)) >= RANK.damage;
}

/**
 * What the pilot is told now, one line per item (the latest event of each, in the order the items were first
 * damaged): the flight cues' DAMAGE list.
 */
export function damageLines(d: DamageState | null | undefined): string[] {
  if (!d) return [];
  const byItem = new Map<DamageItem, string>();
  for (const e of d.events) byItem.set(e.item, e.text);
  return [...byItem.values()];
}

const LEG_STATUSES: readonly LegStatus[] = ['ok', 'hard', 'bent', 'bottomed', 'collapsed'];
const AIRFRAME_ITEMS: readonly AirframeItem[] = ['wingtipLeft', 'wingtipRight', 'tail', 'nose', 'belly'];
const isSeverity = (v: unknown): v is DamageSeverity => v === 'inspection' || v === 'damage' || v === 'disabling';
const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** An event item: the landing, a leg, a propeller by index, or an airframe item. */
export function isDamageItem(v: unknown): v is DamageItem {
  return typeof v === 'string' && (v === 'hardLanding' || (LEG_ITEMS as readonly string[]).includes(v) ||
    (AIRFRAME_ITEMS as readonly string[]).includes(v) || /^propeller\d+$/.test(v));
}

/** A well-formed DamageState as plain data (a stored snapshot's `damage.landing`). */
export function isDamageState(v: unknown): v is DamageState {
  if (!isRecord(v) || !Array.isArray(v.legs) || v.legs.length !== 3 || !Array.isArray(v.props) || !isRecord(v.airframe) || !Array.isArray(v.events)) return false;
  for (const l of v.legs as unknown[]) {
    if (!isRecord(l) || !LEG_STATUSES.includes(l.status as LegStatus) || !isFiniteNum(l.set) || !isFiniteNum(l.toe) || !isFiniteNum(l.peakLoad)) return false;
  }
  if (!(v.props as unknown[]).every((p) => isRecord(p) && typeof p.struck === 'boolean' && typeof p.stopped === 'boolean')) return false;
  const a = v.airframe;
  if (!AIRFRAME_ITEMS.every((k) => a[k] === null || isSeverity(a[k]))) return false;
  return (v.events as unknown[]).every((e) => isRecord(e) && isFiniteNum(e.time) && isDamageItem(e.item) && isSeverity(e.severity) && typeof e.text === 'string');
}
