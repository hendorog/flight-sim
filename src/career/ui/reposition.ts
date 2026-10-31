// Reposition (docs/career.md "Reposition"), the hub's view for moving the selected aircraft to another field on
// the company's account: an unpaid positioning job (fuel, fees and hours at the company's cost). It is how a player
// gets an aircraft home, or out of a field with no suitable work. Each field is listed with its distance, bearing,
// runway, the estimated time and cost and any reason the aircraft cannot go there (runway, grass, tanks); the map
// shows the route. "Fly there" sends 'reposition'; the CareerSystem builds the real `-own` offer and dispatches it.
//
// repositionOffer is exported pure so the CareerSystem can build the same offer it estimates here.

import { el } from '../../ui/dom';
import type { Airfield } from '../../world/airfields';
import { bearingDeg, distanceNm, placeName } from '../geo';
import { offerDeadlineMin } from '../jobs';
import { CAREER_PERF } from '../perf';
import type { CareerSave, FleetAircraft, JobOffer, LoadSheet } from '../types';
import { boardMapSvg } from './boardMap';
import { bearing, careerClock, groupNum, minutes, nm, typeName, usd } from './format';
import type { CareerCtx, CareerPageView } from './models';
import { badge, bareKey, button, departuresClosed, modal, selectedAircraft, sheetAtDefault, spacer } from './widgets';

/** Memo key of the highlighted field code. */
const SEL = 'reposition.to';

/**
 * The unpaid positioning offer that moves `ac` from its field to `to` today (id `${day}-${origin}-own${ownNo}`):
 * no payload, no pay, the aircraft's own class, calm clear weather (the company's own flight), and the
 * positioning deadline (jobs.ts offerDeadlineMin, generous slack).
 */
export function repositionOffer(save: CareerSave, fields: readonly Airfield[], ac: FleetAircraft, to: string): JobOffer {
  const from = fields.find((f) => f.code === ac.field);
  const dest = fields.find((f) => f.code === to);
  const day = Math.floor(save.clockMin / 1440);
  const perf = CAREER_PERF[ac.type];
  const offer: JobOffer = {
    id: `${day}-${ac.field}-own${save.ownNo}`, kind: 'positioning', day, origin: ac.field, destination: { kind: 'field', code: to },
    client: save.company.name, title: `Position ${ac.registration} to ${dest ? placeName(dest) : to}`,
    pax: 0, payload: [], payloadKg: 0, distanceNm: from && dest ? distanceNm(from, dest) : 0, pay: 0, deadlineMin: 0,
    minClass: perf.cls, refType: ac.type, repRequired: 0, premium: false, weather: 'clear', windDirDeg: 0, windKt: 0,
  };
  return { ...offer, deadlineMin: offerDeadlineMin(offer, fields) };
}

/** The reposition view. Enter flies to the highlighted field when it can; Esc returns to the hub. */
export function renderReposition(parent: HTMLElement, ctx: CareerCtx): CareerPageView {
  const { model } = ctx;
  const save = model.save!;
  const ac = selectedAircraft(save);
  const back = (): void => ctx.go('hub');
  const here = model.fields.find((f) => f.code === ac?.field);
  const m = modal(parent, ctx, 'Reposition', ac
    ? `Fly ${ac.registration} (${typeName(ac.type)}) from ${here?.name ?? ac.field} to another field: no pay, the fuel, fees and hours are the company’s. ${careerClock(save.clockMin)}.`
    : 'No aircraft to move.', { cls: 'cr-reposition', onClose: back });
  if (ac) badge(m.right, `${Math.round(ac.fuelKg)} kg aboard`, 'dim');
  const closed = departuresClosed(save);
  if (closed) {
    const b = el('div', 'sc-banner info', m.body);
    el('span', '', b, 'Departures are between 07:00 and 18:00. Rest until tomorrow first.');
  }
  const grid = el('div', 'cr-board-grid', m.body);
  const list = el('div', 'cr-offers', grid);
  const side = el('div', 'cr-board-side', grid);
  const map = el('div', 'cr-map', side);
  const detail = el('div', 'cr-detail', side);

  const rows = new Map<string, HTMLElement>();
  const sheets = new Map<string, { offer: JobOffer; sheet: LoadSheet }>();
  const others = model.fields.filter((f) => f.code !== ac?.field);
  const table = el('table', 'sc-table cr-offer-table', list);
  const hr = el('tr', '', el('thead', '', table));
  for (const [t, c] of [['Field', ''], ['Runway', ''], ['NM', 'r'], ['Track', 'r'], ['Time', 'r'], ['Fuel', 'r'], ['Cost', 'r']] as const) el('th', c, hr, t);
  const tbody = el('tbody', '', table);
  for (const f of others) {
    if (!ac || !here) break;
    const offer = repositionOffer(save, model.fields, ac, f.code);
    const sheet = sheetAtDefault(offer, ac, model);
    sheets.set(f.code, { offer, sheet });
    const blocker = sheet.warnings.find((w) => w.severity === 'block' && w.code !== 'lateInDay');
    const tr = el('tr', `cr-offer${blocker ? ' locked' : ''}`, tbody);
    rows.set(f.code, tr);
    const name = el('td', 'cr-offer-job', tr);
    const top = el('div', 'cr-offer-top', name);
    el('span', `cr-kind ${f.kind === 'grass' ? 'grass' : f.kind === 'home' ? 'home' : 'sealed'}`, top, f.kind === 'home' ? 'Home' : f.kind === 'grass' ? 'Grass' : 'Sealed');
    el('b', '', top, f.name);
    el('div', 'cr-offer-sub', name, `${f.code} · ${f.frequency.toFixed(3)} MHz`);
    if (blocker) el('div', 'cr-offer-why', name, blocker.text);
    el('td', 'num', tr, `${f.ids[0]}/${f.ids[1]} · ${groupNum(f.length)} m`);
    el('td', 'r num', tr, nm(offer.distanceNm));
    el('td', 'r num', tr, bearing(bearingDeg(here, f)));
    el('td', 'r num', tr, minutes(sheet.flightTimeMin));
    el('td', 'r num', tr, `${groupNum(sheet.requiredFuelKg)} kg`);
    el('td', 'r num cr-pay bad', tr, usd(sheet.netEst));
    tr.addEventListener('click', () => highlight(f.code));
    tr.addEventListener('dblclick', () => fly(f.code));
  }
  if (others.length === 0 || !ac) el('div', 'sc-empty', list, 'Nowhere to go.');

  button(m.foot, 'Hub', back, { key: 'Esc' });
  spacer(m.foot);
  const note = el('span', 'sc-note', m.foot, '');
  const go = button(m.foot, 'Fly there', () => fly(sel), { cls: 'primary', key: 'Enter' });

  let sel = (ctx.memo.get(SEL) as string | undefined) ?? '';
  if (!sheets.has(sel)) sel = homeFirst(others, ac?.field) ?? '';

  function blocked(code: string): string | null {
    const s = sheets.get(code)?.sheet;
    if (!s) return 'Not available';
    if (closed) return 'Departures closed for today';
    return s.warnings.find((w) => w.severity === 'block')?.text ?? null;
  }

  function fly(code: string): void {
    if (!sheets.has(code) || blocked(code)) return;
    ctx.send({ kind: 'reposition', to: code });
  }

  function highlight(code: string): void {
    sel = code;
    ctx.memo.set(SEL, code);
    for (const [k, tr] of rows) tr.classList.toggle('sel', k === code);
    const entry = sheets.get(code);
    map.innerHTML = boardMapSvg(model.fields, ac?.field ?? null, entry?.offer ?? null);
    detail.replaceChildren();
    const why = blocked(code);
    go.disabled = why !== null;
    note.textContent = why ?? '';
    if (!entry) return;
    const s = entry.sheet;
    el('b', 'cr-detail-title', detail, entry.offer.title);
    const facts = el('div', 'cr-detail-facts', detail);
    const fact = (label: string, v: string): void => {
      const d = el('div', '', facts);
      el('span', '', d, label);
      el('b', 'num', d, v);
    };
    fact('Fuel to buy', s.upliftKg > 0.05 ? `${groupNum(s.upliftKg)} kg · ${usd(s.fuelCost)}` : 'None');
    fact('Landing fee', usd(s.landingFeeEst));
    fact('Aircraft hours', usd(s.hoursCostEst));
    fact('Total', usd(-s.netEst));
  }
  highlight(sel);

  const move = (d: number): void => {
    const codes = [...sheets.keys()];
    if (codes.length === 0) return;
    const i = codes.indexOf(sel);
    highlight(codes[Math.max(0, Math.min(codes.length - 1, (i < 0 ? 0 : i) + d))]);
  };

  return {
    root: m.scrim,
    onKey(e) {
      if (bareKey(e, 'Escape')) {
        back();
        return true;
      }
      if (bareKey(e, 'Enter', 'NumpadEnter')) {
        fly(sel);
        return true;
      }
      if (bareKey(e, 'ArrowDown')) {
        move(1);
        return true;
      }
      if (bareKey(e, 'ArrowUp')) {
        move(-1);
        return true;
      }
      return false;
    },
  };
}

/** The home field when the aircraft is away (the usual reason to reposition), else the first other field. */
function homeFirst(others: readonly Airfield[], here: string | undefined): string | null {
  const home = others.find((f) => f.kind === 'home' && f.code !== here);
  return home?.code ?? others[0]?.code ?? null;
}
