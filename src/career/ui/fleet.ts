// The fleet and the market (docs/career.md "Progression: Fleet"). Fleet: every aircraft with its marks, type,
// tenure, where it stands, fuel, hours and state, and its actions: select it (its field becomes "here"), defuel it
// (drain to a chosen figure, credited at half price), sell an owned one (75 % of the buy-in) or return a lease
// (free); none for the aircraft on the active job, and the irreversible ones ask once. Market: every Career type
// with its list price, buy-in, owned and lease hourly rates and the lease sign-on fee; Lease and Buy are refused
// with the reason (progression.ts acquireRefusal: fleet full, rating, reputation, cash).

import { el } from '../../ui/dom';
import { defuelCredit } from '../costs';
import { CAREER_PERF } from '../perf';
import { acquireRefusal, leaseSignOnFee, saleValue } from '../progression';
import { CAREER_AIRCRAFT_IDS, START_RULES, type FleetAircraft } from '../types';
import { classShort, groupNum, kg, typeName, usd } from './format';
import type { CareerCtx, CareerPageView } from './models';
import { badge, bareKey, button, confirmButton, modal, spacer } from './widgets';

/** Memo keys: the tab, and the aircraft whose defuel row is open. */
const TAB = 'fleet.tab';
const DEFUEL = 'fleet.defuel';

/** The fleet and market page. Esc returns to the hub; Tab-free: the two tabs are buttons. */
export function renderFleet(parent: HTMLElement, ctx: CareerCtx): CareerPageView {
  const { model } = ctx;
  const save = model.save!;
  const back = (): void => ctx.go('hub');
  let tab = (ctx.memo.get(TAB) as 'fleet' | 'market' | undefined) ?? 'fleet';
  const m = modal(parent, ctx, 'Fleet and market', `${save.fleet.length} of ${START_RULES.maxFleet} aircraft · cash ${usd(save.cash)} · reputation ${Math.round(save.reputation)}`, {
    cls: 'cr-fleet', onClose: back,
  });
  const bar = el('div', 'sc-pager cr-tabs', m.body);
  const seg = el('div', 'sc-seg', bar);
  const content = el('div', '', m.body);
  const tabs = new Map<string, HTMLButtonElement>();
  for (const [id, text] of [['fleet', 'Your fleet'], ['market', 'Market']] as const) {
    tabs.set(id, button(seg, text, () => show(id), { cls: id === tab ? 'sel' : '' }));
  }
  const show = (id: 'fleet' | 'market'): void => {
    tab = id;
    ctx.memo.set(TAB, id);
    for (const [k, b] of tabs) b.classList.toggle('sel', k === id);
    content.replaceChildren();
    if (id === 'fleet') fleetTable(content, ctx);
    else marketTable(content, ctx);
  };
  show(tab);

  button(m.foot, 'Hub', back, { key: 'Esc' });
  spacer(m.foot);
  el('span', 'sc-note', m.foot, `Leases cost at least ${START_RULES.leaseIdleHoursPerDay} h a day while idle. Selling returns ${Math.round(START_RULES.saleFraction * 100)} % of the buy-in.`);
  return {
    root: m.scrim,
    onKey(e) {
      if (bareKey(e, 'Escape')) {
        back();
        return true;
      }
      return false;
    },
  };
}

function fleetTable(parent: HTMLElement, ctx: CareerCtx): void {
  const save = ctx.model.save!;
  if (save.fleet.length === 0) {
    el('div', 'sc-empty', parent, 'No aircraft. Lease or buy one from the market.');
    return;
  }
  const day = Math.floor(save.clockMin / 1440);
  const t = el('table', 'sc-table cr-fleet-table', parent);
  const hr = el('tr', '', el('thead', '', t));
  for (const [c, cls] of [['Aircraft', ''], ['Tenure', ''], ['At', ''], ['Fuel', 'r'], ['Hours', 'r'], ['State', ''], ['', 'r']] as const) el('th', cls, hr, c);
  const tb = el('tbody', '', t);
  const openUid = ctx.memo.get(DEFUEL) as string | undefined;
  for (const a of save.fleet) {
    const p = CAREER_PERF[a.type];
    const onJob = save.active?.aircraftUid === a.uid;
    const grounded = a.groundedUntilDay !== undefined && day < a.groundedUntilDay;
    const tr = el('tr', a.uid === save.selectedUid ? 'cr-selrow' : '', tb);
    const name = el('td', 'cr-offer-job', tr);
    const top = el('div', 'cr-offer-top', name);
    el('b', '', top, a.registration);
    el('span', 'cr-icao', top, p.icaoType);
    el('div', 'cr-offer-sub', name, `${typeName(a.type)} · ${classShort(p.cls)}`);
    el('td', '', tr, a.tenure === 'owned' ? 'Owned' : 'Leased');
    el('td', '', tr, a.field);
    el('td', 'r num', tr, `${groupNum(a.fuelKg)} / ${groupNum(p.usableFuelKg)} kg`);
    el('td', 'r num', tr, a.hours.toFixed(1));
    const st = el('td', '', tr);
    if (onJob) badge(st, 'On a job', 'warn');
    else if (grounded) badge(st, `Repairs to day ${a.groundedUntilDay}`, 'bad');
    else if (a.uid === save.selectedUid) badge(st, 'Selected', 'ok');
    else badge(st, 'Ready', 'dim');
    const acts = el('td', 'r cr-acts', tr);
    if (a.uid !== save.selectedUid) button(acts, 'Select', () => ctx.send({ kind: 'select', uid: a.uid }), { cls: 'cr-small-btn' }).disabled = !!save.active;
    const df = button(acts, 'Defuel', () => {
      ctx.memo.set(DEFUEL, openUid === a.uid ? '' : a.uid);
      parent.replaceChildren();
      fleetTable(parent, ctx);
    }, { cls: `cr-small-btn${openUid === a.uid ? ' sel' : ''}` });
    df.disabled = onJob || a.fuelKg < 0.5;
    if (a.tenure === 'owned') {
      const s = confirmButton(acts, 'Sell', `Sell for ${usd(saleValue(a.type))}`, () => ctx.send({ kind: 'sell', uid: a.uid }), { cls: 'cr-small-btn cr-danger' });
      s.disabled = onJob;
    } else {
      const r = confirmButton(acts, 'Return', 'Confirm return', () => ctx.send({ kind: 'returnLease', uid: a.uid }), { cls: 'cr-small-btn cr-danger' });
      r.disabled = onJob;
    }
    if (openUid === a.uid && !onJob) defuelRow(tb, ctx, a);
  }
}

/** The inline defuel row: a slider from 0 to what is aboard, the credit, and Drain. */
function defuelRow(tb: HTMLElement, ctx: CareerCtx, a: FleetAircraft): void {
  const p = CAREER_PERF[a.type];
  const tr = el('tr', 'cr-defuel-row', tb);
  const td = el('td', '', tr);
  td.colSpan = 7;
  const box = el('div', 'cr-defuel', td);
  el('span', '', box, `Drain ${a.registration} to`);
  const slider = el('input', 'cr-slider', box);
  slider.type = 'range';
  slider.min = '0';
  slider.max = String(a.fuelKg);
  slider.step = '0.5';
  const out = el('b', 'num', box, '');
  const go = button(box, 'Drain', () => ctx.send({ kind: 'defuel', uid: a.uid, fuelKg: target }), { cls: 'primary cr-small-btn' });
  let target = Math.max(0, Math.round(a.fuelKg / 2));
  const set = (v: number): void => {
    target = Math.max(0, Math.min(a.fuelKg, v));
    slider.value = String(target);
    slider.style.setProperty('--p', `${a.fuelKg > 0 ? (target / a.fuelKg) * 100 : 0}%`);
    const drained = a.fuelKg - target;
    out.textContent = `${kg(target)} · credit ${usd(defuelCredit(drained, p.fuel))}`;
    go.disabled = drained < 0.05;
  };
  slider.addEventListener('input', () => set(Number(slider.value)));
  set(target);
}

function marketTable(parent: HTMLElement, ctx: CareerCtx): void {
  const save = ctx.model.save!;
  const t = el('table', 'sc-table cr-market-table', parent);
  const hr = el('tr', '', el('thead', '', t));
  for (const [c, cls] of [['Type', ''], ['Seats', 'r'], ['Cruise', 'r'], ['List price', 'r'], ['Buy-in', 'r'], ['Owned', 'r'], ['Lease', 'r'], ['Sign-on', 'r'], ['', 'r']] as const) el('th', cls, hr, c);
  const tb = el('tbody', '', t);
  let lastCls = '';
  for (const id of CAREER_AIRCRAFT_IDS) {
    const p = CAREER_PERF[id];
    if (p.cls !== lastCls) {
      const g = el('tr', 'cr-group', tb);
      const td = el('td', '', g, classShort(p.cls));
      td.colSpan = 9;
      lastCls = p.cls;
    }
    const lease = acquireRefusal(save, id, 'lease');
    const buy = acquireRefusal(save, id, 'buy');
    const tr = el('tr', lease && buy ? 'cr-dimrow' : '', tb);
    const name = el('td', 'cr-offer-job', tr);
    const top = el('div', 'cr-offer-top', name);
    el('b', '', top, typeName(id));
    el('span', 'cr-icao', top, p.icaoType);
    if (lease && buy) el('div', 'cr-offer-why', name, lease.code === buy.code || buy.code === 'cash' ? lease.text : `${lease.text}; ${buy.text.toLowerCase()}`);
    else el('div', 'cr-offer-sub', name, `${kg(p.mtowKg)} MTOW · ${p.fuel === 'jetA1' ? 'Jet A-1' : 'avgas'} · ${p.fuelFlowKgH} kg/h${p.leaseRep ? ` · lessor wants rep ${p.leaseRep}` : ''}`);
    el('td', 'r num', tr, `1 + ${p.paxSeats}`);
    el('td', 'r num', tr, `${p.cruiseTasKt} kt`);
    el('td', 'r num cr-dim', tr, usd(p.listPrice));
    el('td', 'r num', tr, usd(p.buyIn));
    el('td', 'r num', tr, `${usd(p.ownedHourly)}/h`);
    el('td', 'r num', tr, `${usd(p.leaseHourly)}/h`);
    el('td', 'r num', tr, usd(leaseSignOnFee(id)));
    const acts = el('td', 'r cr-acts', tr);
    const l = confirmButton(acts, 'Lease', `Lease for ${usd(leaseSignOnFee(id))}`, () => ctx.send({ kind: 'lease', type: id }), { cls: 'cr-small-btn', title: lease?.text });
    l.disabled = lease !== null;
    const b = confirmButton(acts, 'Buy', `Buy for ${usd(p.buyIn)}`, () => ctx.send({ kind: 'buy', type: id }), { cls: 'cr-small-btn', title: buy?.text });
    b.disabled = buy !== null;
  }
}
