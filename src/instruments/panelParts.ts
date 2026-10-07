// Where the parts of a panel definition are on the canvas: the rectangle each component owns, the place of
// every toggle of a toggle / engine-master ignition group, the lever values of a flap switch. Pure (types
// only): the artwork (render/), the click hotspots (hotspots.ts) and the layout check (panelLayout.ts) all
// read these rules, so they cannot disagree.

import type { GaugeDef, IgnitionPanelDef, PanelDef, Rect } from './panelDef';
import { gaugeRecess } from './panelDef';

/** Bezel of a 3-1/8" instrument and of a 2-1/4" one, px. */
export const LARGE_BEZEL = 172;
export const SMALL_BEZEL = 120;
/** Clear margin around a bezel for its drop shadow; part of the gauge's rectangle. */
export const BEZEL_MARGIN = 6;

/** The square a round instrument owns: its bezel and the shadow margin, on whole pixels. */
export function roundGaugeRect(cx: number, cy: number, bezel: number): Rect {
  const size = bezel + 2 * BEZEL_MARGIN;
  return { x: Math.round(cx - size / 2), y: Math.round(cy - size / 2), w: size, h: size };
}

const centred = (at: readonly [number, number], w: number, h: number): Rect => ({ x: Math.round(at[0] - w / 2), y: Math.round(at[1] - h / 2), w, h });

/** The gear selector: a wheel-shaped knob in a vertical slot, UP at the top. */
export const GEAR_LEVER = { w: 64, h: 116, travel: 52 };
export const gearLeverRect = (at: readonly [number, number]): Rect => centred(at, GEAR_LEVER.w, GEAR_LEVER.h);

/** The flap switch: a paddle in a vertical slot, one detent per position, the first (flaps up) at the top. */
export const FLAP_SWITCH = { w: 64, pitch: 26, pad: 30 };
export const flapSwitchRect = (at: readonly [number, number], positions: number): Rect =>
  centred(at, FLAP_SWITCH.w, FLAP_SWITCH.pitch * (positions - 1) + 2 * FLAP_SWITCH.pad);

/** A guarded knob: the knob at `at`, its legend under it. */
export const GUARDED_KNOB = { w: 76, h: 80, r: 17, above: 30 };
export const guardedKnobRect = (at: readonly [number, number]): Rect => ({ x: Math.round(at[0] - GUARDED_KNOB.w / 2), y: Math.round(at[1] - GUARDED_KNOB.above), w: GUARDED_KNOB.w, h: GUARDED_KNOB.h });

type FlapLights = Extract<GaugeDef, { kind: 'flapLights' }>;

/**
 * Flap lever value [0, 1] of each position of a flap switch: its deflection over the last one's, or evenly
 * spaced where the definition gives no deflections.
 */
export function flapLeverValues(g: FlapLights): number[] {
  const n = g.positions.length;
  const d = g.degrees;
  if (d) return g.positions.map((_, i) => d[i] / d[n - 1]);
  return g.positions.map((_, i) => (n > 1 ? i / (n - 1) : 0));
}

/** The position of a flap switch nearest to a lever value. */
export function flapPositionOf(levers: readonly number[], lever: number): number {
  let best = 0;
  for (let i = 1; i < levers.length; i++) if (Math.abs(levers[i] - lever) < Math.abs(levers[best] - lever)) best = i;
  return best;
}

/** One switch of a toggle / engine-master ignition group, panel px. */
export interface IgnitionToggle {
  engine: number;
  /** A magneto of the engine (the bit it has in MagnetoPosition: 2 = left, 1 = right), or its ENGINE MASTER. */
  kind: 'magnetoLeft' | 'magnetoRight' | 'engineMaster';
  x: number;
  y: number;
}
/** The starter control of the group: one half of the rocker (or of the START key) per engine, panel px. */
export interface IgnitionStarter {
  engine: number;
  x: number;
  y: number;
  hw: number;
  hh: number;
}
export interface IgnitionLayout {
  rect: Rect;
  toggles: IgnitionToggle[];
  starters: IgnitionStarter[];
  /** Centre of the starter control. */
  starter: { x: number; y: number };
}

const IGNITION_H = 104;
const MAG_SLOT = 30;
const MASTER_SLOT = 58;
const START_SLOT = 66;

/**
 * The switches of a 'toggles' or 'engineMaster' ignition group, centred on its `at`: the engines of the left
 * side, the starter, the engines of the right side (one engine: its switches, then the starter). null for a key.
 */
export function ignitionLayout(ign: IgnitionPanelDef): IgnitionLayout | null {
  if (ign.kind === 'key') return null;
  const n = ign.engines;
  const perEngine = ign.kind === 'toggles' ? 2 * MAG_SLOT : MASTER_SLOT;
  const w = n * perEngine + START_SLOT;
  const x0 = ign.at[0] - w / 2;
  const y = ign.at[1];
  const left = n > 1 ? Math.ceil(n / 2) : n;
  const toggles: IgnitionToggle[] = [];
  let x = x0;
  let starterX = 0;
  for (let e = 0; e <= n; e++) {
    if (e === left) {
      starterX = x + START_SLOT / 2;
      x += START_SLOT;
    }
    if (e === n) break;
    if (ign.kind === 'toggles') {
      toggles.push({ engine: e, kind: 'magnetoLeft', x: x + MAG_SLOT / 2, y });
      toggles.push({ engine: e, kind: 'magnetoRight', x: x + 1.5 * MAG_SLOT, y });
    } else {
      toggles.push({ engine: e, kind: 'engineMaster', x: x + MASTER_SLOT / 2, y });
    }
    x += perEngine;
  }
  // One engine: the whole control cranks it. Two: its left half cranks the left engine, its right half the right one.
  const starters: IgnitionStarter[] =
    n === 1
      ? [{ engine: 0, x: starterX, y, hw: 22, hh: 22 }]
      : [
          { engine: 0, x: starterX - 13, y, hw: 13, hh: 22 },
          { engine: 1, x: starterX + 13, y, hw: 13, hh: 22 },
        ];
  return { rect: { x: Math.round(x0), y: Math.round(y - IGNITION_H / 2), w, h: IGNITION_H }, toggles, starters, starter: { x: starterX, y } };
}

/** A rectangle a component of the panel owns, with the round flange inside it where the part is a small round instrument. */
export interface PanelPart {
  id: string;
  rect: Rect;
  /** The body of a round-flanged instrument (the rectangle's corners are empty). */
  round?: { x: number; y: number; r: number };
  /**
   * Where the artwork is, for a part that does not fill its rectangle (the switch row: its rockers, key and
   * dimmers). Only this has to stay clear of the keep-out circles. Empty: nothing has to (the flap lever's slot
   * is itself behind a 3D part, its slot plate).
   */
  solid?: Rect[];
}

/** Id of the component a `lever` member of a gauge makes: the gear selector or the flap switch. */
export const leverId = (gaugeId: string): string => `${gaugeId}Lever`;

/** The rectangles a gauge's components own, in the order the panel builds them. */
export function gaugeParts(g: GaugeDef, apertures: PanelDef['apertures']): PanelPart[] {
  const recess = gaugeRecess(g, apertures);
  if (recess) {
    const large = isLargeGauge(g);
    const bezel = large ? LARGE_BEZEL : SMALL_BEZEL;
    const rect = roundGaugeRect(recess.x, recess.y, bezel);
    // A 3-1/8" instrument has a square bezel; a 2-1/4" one a round flange.
    return [large ? { id: g.id, rect } : { id: g.id, rect, round: { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2, r: bezel / 2 } }];
  }
  switch (g.kind) {
    case 'gearLights':
      return g.lever ? [{ id: g.id, rect: g.bounds }, { id: leverId(g.id), rect: gearLeverRect(g.lever) }] : [{ id: g.id, rect: g.bounds }];
    case 'flapLights':
      return g.lever
        ? [{ id: g.id, rect: g.bounds }, { id: leverId(g.id), rect: flapSwitchRect(g.lever, g.positions.length) }]
        : [{ id: g.id, rect: g.bounds }];
    case 'guardedKnob':
      return [{ id: g.id, rect: guardedKnobRect(g.at) }];
    case 'flapLever':
      return [{ id: g.id, rect: g.bounds, solid: [] }];
    case 'trimBar': case 'engineDisplay': case 'gps': case 'navcom': case 'xpdr':
      return [{ id: g.id, rect: g.bounds }];
    default:
      return [];
  }
}

/** Whether a round gauge has the 3-1/8" case (the rule of gaugeRecess, by kind and size). */
export function isLargeGauge(g: GaugeDef): boolean {
  switch (g.kind) {
    case 'asi': case 'attitude': case 'altimeter': case 'turn': case 'heading': case 'vsi': case 'cdi':
      return true;
    case 'tach': case 'single': case 'twinNeedle':
      return g.size === 'large';
    default:
      return false;
  }
}

/** Ids of the annunciator strip, the switch row and the ignition group as components. */
export const ANNUNCIATOR_ID = 'annunciator';
export const SWITCH_ROW_ID = 'switches';
export const IGNITION_ID = 'ignition';

/** The artwork of the switch row, panel px: each rocker with its legend, the dimmers, the key with its lettering. */
function switchRowSolids(def: PanelDef): Rect[] {
  const row = def.switchRow;
  const { x, y } = row.bounds;
  const solids: Rect[] = row.switches.map((s) => ({ x: x + s.x - row.rockerW / 2 - 3, y: y + row.rockerTop - 30, w: row.rockerW + 6, h: row.rockerH + 33 }));
  if (row.dimmers) for (const dx of [row.dimmers.panel, row.dimmers.radio]) solids.push({ x: x + dx - 14, y: y + row.dimmers.y - 14, w: 28, h: 28 });
  if (def.ignition.kind === 'key') solids.push({ x: def.ignition.at[0] - 50, y: def.ignition.at[1] - 42, w: 100, h: 68 });
  return solids;
}

/**
 * Every rectangle of the panel a component owns, in the order InstrumentPanel builds its components: the dials
 * and knobs (gauges with `at`), the annunciator strip, the switch row, the ignition group where it is not the
 * key of the switch row, then the gauges with `bounds`.
 */
export function panelParts(def: PanelDef): PanelPart[] {
  const dials: PanelPart[] = [];
  const rest: PanelPart[] = [];
  for (const g of def.gauges) ('at' in g ? dials : rest).push(...gaugeParts(g, def.apertures));
  if (def.annunciator) dials.push({ id: ANNUNCIATOR_ID, rect: def.annunciator.bounds });
  dials.push({ id: SWITCH_ROW_ID, rect: def.switchRow.bounds, solid: switchRowSolids(def) });
  const ignition = ignitionLayout(def.ignition);
  if (ignition) dials.push({ id: IGNITION_ID, rect: ignition.rect });
  return [...dials, ...rest];
}
