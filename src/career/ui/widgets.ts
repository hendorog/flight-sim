// Small building blocks shared by the Career pages: the modal shell (the school's scrim, wide card, header and
// foot, with the company as the kicker), label-value rows with aligned figures, a two-step confirm button for the
// actions that cannot be undone, a reputation bar, and the board's eligibility rule (which fleet aircraft could
// take an offer here, or the one-line reason none can).
//
// The school's widgets (button with a key-cap hint, badge, section, header) are reused by import, unchanged.

import { button, header } from '../../ui/school/widgets';
import { el } from '../../ui/dom';
import { loadSheet } from '../loadsheet';
import { CAREER_PERF } from '../perf';
import { departureOpen } from '../progression';
import type { CareerSave, FleetAircraft, JobOffer, LoadSheet } from '../types';
import { classArticle, typeName } from './format';
import type { CareerCtx, CareerUiModel } from './models';

export { badge, bareKey, button, header, section, typing } from '../../ui/school/widgets';

/** The pieces of a modal page. */
export interface ModalParts {
  /** The page's outermost element (`.scrim.cr-root`). */
  scrim: HTMLElement;
  card: HTMLElement;
  /** The header's right-hand slot (badges, the close cross). */
  right: HTMLElement;
  body: HTMLElement;
  foot: HTMLElement;
}

/**
 * The school's modal shell: a scrim, a wide card with the kicker (the company, or "Career"), title and
 * subtitle, a close cross that runs `onClose`, a scrolling body and a foot. `fit` sizes the card to its content.
 */
export function modal(parent: HTMLElement, ctx: CareerCtx, title: string, sub: string, opts: { cls?: string; fit?: boolean; onClose?: () => void } = {}): ModalParts {
  const scrim = el('div', `scrim cr-root ${opts.cls ?? ''}`.trim(), parent);
  const card = el('div', `card sc-card sc-wide cr-card${opts.fit ? ' sc-fit' : ''}`, scrim);
  const h = header(card, title, sub, ctx.model.save?.company.name ?? 'Career');
  if (opts.onClose) button(h.root, '×', opts.onClose, { cls: 'sc-x', title: 'Back (Esc)' });
  const body = el('div', 'sc-body', card);
  const foot = el('div', 'sc-foot', card);
  return { scrim, card, right: h.right, body, foot };
}

/** A flexible gap in a foot or bar. */
export function spacer(parent: HTMLElement): HTMLElement {
  return el('div', 'sc-spacer', parent);
}

/** One label-value row with the value right-aligned in tabular figures; `tone` colours the value. */
export function kv(parent: HTMLElement, label: string, value: string, tone: '' | 'ok' | 'warn' | 'bad' | 'dim' | 'strong' = ''): HTMLElement {
  const row = el('div', 'cr-kv', parent);
  el('span', '', row, label);
  el('b', `num ${tone}`.trim(), row, value);
  return row;
}

/**
 * A button that asks once before acting: the first click turns it into "<confirmText>" (amber), the second
 * runs `onConfirm`. Used for Give up, Rest with a stopped job, Sell, Return, Start a new career.
 */
export function confirmButton(parent: HTMLElement, text: string, confirmText: string, onConfirm: () => void, opts: { cls?: string; key?: string; title?: string } = {}): HTMLButtonElement {
  let armed = false;
  const b = button(parent, text, () => {
    if (!armed) {
      armed = true;
      b.classList.add('cr-armed');
      const label = b.children[0] as HTMLElement | undefined;
      if (label) label.textContent = confirmText;
      return;
    }
    onConfirm();
  }, opts);
  return b;
}

/** A reputation bar (0..100) with its figure. */
export function repBar(parent: HTMLElement, rep: number): HTMLElement {
  const wrap = el('div', 'cr-rep', parent);
  const bar = el('div', 'cr-bar', wrap);
  const fill = el('i', '', bar);
  fill.style.width = `${Math.max(0, Math.min(100, rep))}%`;
  el('b', 'num', wrap, String(Math.round(rep)));
  return wrap;
}

/** True outside the departure window (07:00 to 18:00): the board and the dispatch say rest until tomorrow. */
export function departuresClosed(save: CareerSave): boolean {
  return !departureOpen(save.clockMin);
}

/** The fleet aircraft standing at a field (in fleet order). */
export function aircraftAt(save: CareerSave, code: string): FleetAircraft[] {
  return save.fleet.filter((a) => a.field === code);
}

/** The aircraft the player is with (`selectedUid`), or the first of the fleet. */
export function selectedAircraft(save: CareerSave): FleetAircraft | null {
  return save.fleet.find((a) => a.uid === save.selectedUid) ?? save.fleet[0] ?? null;
}

/**
 * The fuel a dispatch starts at for an aircraft: what is aboard, raised to the required fuel, never above the
 * most the load allows (kg). `sheet` is any load sheet of this offer and aircraft (the plan does not depend on fuel).
 */
export function defaultFuelKg(sheet: LoadSheet, aboardKg: number): number {
  return Math.max(0, Math.min(sheet.maxFuelKg, Math.max(sheet.requiredFuelKg, aboardKg)));
}

/** A load sheet at the default fuel. */
export function sheetAtDefault(offer: JobOffer, ac: FleetAircraft, model: CareerUiModel): LoadSheet {
  const save = model.save!;
  const probe = loadSheet(offer, ac, ac.fuelKg, save, model.fields);
  return loadSheet(offer, ac, defaultFuelKg(probe, ac.fuelKg), save, model.fields);
}

/** Codes the board does not grey an offer for (the whole board shows them once instead). */
const BOARD_IGNORES = new Set(['lateInDay']);

/** Whether an offer can be taken, with the aircraft that would fly it, or the reason none can. */
export interface OfferStatus {
  ok: boolean;
  /** The aircraft the dispatch would start with (the selected one when it can, else the first that can). */
  uid: string | null;
  /** Short pilot-facing reason when not ok ("Needs reputation 25", "Needs a twin", "Too heavy for the C152"). */
  reason: string | null;
}

/** The board's short reason for a load-sheet refusal of one aircraft (the first blocking code). */
function reasonOf(sheet: LoadSheet, offer: JobOffer): string {
  const block = sheet.warnings.find((w) => w.severity === 'block' && !BOARD_IGNORES.has(w.code));
  if (!block) return '';
  const icao = CAREER_PERF[sheet.type].icaoType;
  switch (block.code) {
    case 'class': return `Needs ${classArticle(offer.minClass)}`;
    case 'heliOnly': return 'Needs a helicopter';
    case 'fixedWingOnly': return 'Needs an aeroplane';
    case 'seats': return `Too many passengers for the ${icao}`;
    case 'stationLimit':
    case 'overMtow':
    case 'fuelShort': return `Too heavy for the ${icao}`;
    case 'runwayShort': return `Runway too short for the ${icao}`;
    case 'grass': return `No grass strips for the ${icao}`;
    default: return block.text;
  }
}

/** How close a refusal is to flying (the board names the nearest miss: a class match before a type mismatch). */
function missRank(sheet: LoadSheet): number {
  const codes = sheet.warnings.filter((w) => w.severity === 'block' && !BOARD_IGNORES.has(w.code)).map((w) => w.code);
  if (codes.some((c) => c === 'heliOnly' || c === 'fixedWingOnly')) return 3;
  if (codes.includes('class')) return 2;
  return codes.length > 0 ? 1 : 0;
}

/** Whether the player can take `offer` today with an aircraft at its origin, and which; else why not. */
export function offerStatus(offer: JobOffer, model: CareerUiModel): OfferStatus {
  const save = model.save;
  if (!save) return { ok: false, uid: null, reason: 'No career' };
  if (save.active) return { ok: false, uid: null, reason: 'Finish the job in progress first' };
  if (save.reputation < offer.repRequired) return { ok: false, uid: null, reason: `Needs reputation ${offer.repRequired}` };
  const here = aircraftAt(save, offer.origin);
  if (here.length === 0) return { ok: false, uid: null, reason: 'No aircraft of yours here' };
  const ordered = [...here].sort((a, b) => (a.uid === save.selectedUid ? -1 : b.uid === save.selectedUid ? 1 : 0));
  let best: { sheet: LoadSheet; rank: number } | null = null;
  for (const ac of ordered) {
    const sheet = sheetAtDefault(offer, ac, model);
    const rank = missRank(sheet);
    if (rank === 0) return { ok: true, uid: ac.uid, reason: null };
    if (!best || rank < best.rank) best = { sheet, rank };
  }
  return { ok: false, uid: null, reason: best ? reasonOf(best.sheet, offer) || `Not for the ${typeName(best.sheet.type)}` : null };
}
