// The dispatch page (docs/career.md "Dispatch"): choose the aircraft (the fleet standing at the origin; the others
// listed but disabled with where they are), choose the fuel (a slider in kg and litres from 0 to the most the
// load allows, with Required and Full; below what is aboard it defuels, credited at half price), and read the load
// sheet (src/career/loadsheet.ts, recomputed as the slider moves): masses against MTOW and MLW, the take-off CG
// against the type's figures, the fuel plan, the wind components, times against the deadline, the money and the
// estimated net, and the warnings (blocking ones, red, disable Accept; the others amber). Accept sends 'accept'.
// A chosen type other than the booted one reloads into it first; with the memory store that is refused here.

import { el } from '../../ui/dom';
import { loadSheet } from '../loadsheet';
import { CAREER_PERF } from '../perf';
import type { FleetAircraft, JobOffer, LoadSheet } from '../types';
import { destText, openOffers } from './board';
import { cgM, fuelKgL, groupNum, kg, kindLabel, minutes, nm, signedUsd, stationLabel, typeName, usd, weatherLabel, wind } from './format';
import type { CareerCtx, CareerPageView } from './models';
import { badge, bareKey, button, defaultFuelKg, departuresClosed, kv, modal, section, spacer } from './widgets';

/** Memo key of the dispatch choices ({ offerId, uid, fuelKg }). */
const CHOICE = 'dispatch.choice';

interface Choice {
  offerId: string;
  uid: string;
  fuelKg: number;
}

/** Slider resolution, kg. */
const FUEL_STEP_KG = 0.5;

/** Why an aircraft cannot be chosen at all (elsewhere, grounded), or null. */
function unavailable(ac: FleetAircraft, offer: JobOffer, day: number): string | null {
  if (ac.field !== offer.origin) return `At ${ac.field}`;
  if (ac.groundedUntilDay !== undefined && day < ac.groundedUntilDay) return `Out of service to day ${ac.groundedUntilDay}`;
  return null;
}

/** Why Accept is refused for a type switch, or null: the memory store does not survive the reload. */
export function typeSwitchRefusal(ctx: CareerCtx, ac: FleetAircraft): string | null {
  if (ac.type === ctx.model.bootedType) return null;
  return ctx.model.storeKind === 'mem'
    ? `The ${typeName(ac.type)} needs a reload, and this career is kept in memory only (cstore=mem): it would be lost.`
    : null;
}

/** The dispatch page for ctx.dispatchOfferId. Enter accepts when allowed; Esc returns to the board. */
export function renderDispatch(parent: HTMLElement, ctx: CareerCtx): CareerPageView {
  const { model } = ctx;
  const save = model.save!;
  const back = (): void => ctx.go('board');
  const offer = openOffers(ctx).find((o) => o.id === ctx.dispatchOfferId)
    ?? (save.active && !save.active.placed && save.active.offer.id === ctx.dispatchOfferId ? save.active.offer : undefined);
  if (!offer) {
    const m = modal(parent, ctx, 'Dispatch', 'This offer is no longer on the board.', { fit: true, cls: 'cr-dispatch', onClose: back });
    el('div', 'sc-empty', m.body, 'Taken, or the day has changed. Pick another job from the board.');
    button(m.foot, 'Job board', back, { key: 'Esc' });
    return { root: m.scrim, onKey: (e) => (bareKey(e, 'Escape') ? (back(), true) : false) };
  }
  const day = Math.floor(save.clockMin / 1440);
  const closed = departuresClosed(save);

  // The remembered choice for this offer, else the selected aircraft (if here) or the first here, at its default fuel.
  const memo = ctx.memo.get(CHOICE) as Choice | undefined;
  const usable = save.fleet.filter((a) => unavailable(a, offer, day) === null);
  let ac = (memo?.offerId === offer.id ? usable.find((a) => a.uid === memo.uid) : undefined)
    ?? usable.find((a) => a.uid === save.selectedUid) ?? usable[0] ?? null;
  let fuelKg = memo?.offerId === offer.id && ac && memo.uid === ac.uid ? memo.fuelKg : NaN;

  const m = modal(parent, ctx, offer.title, `${kindLabel(offer.kind)} for ${offer.client} · ${destText(offer)} · ${nm(offer.distanceNm)} · ${minutes(offer.deadlineMin)} allowed · ${weatherLabel(offer.weather)}, ${wind(offer.windDirDeg, offer.windKt)}`, {
    cls: 'cr-dispatch', onClose: back,
  });
  badge(m.right, usd(offer.pay), 'ok');
  if (offer.premium) badge(m.right, 'Regular client', 'warn');

  const grid = el('div', 'cr-dispatch-grid', m.body);
  const left = el('div', 'cr-col', grid);
  const mid = el('div', 'cr-col', grid);
  const right = el('div', 'cr-col', grid);

  // Aircraft.
  section(left, 'Aircraft');
  const fleet = el('div', 'cr-fleetpick', left);
  const pickButtons = new Map<string, HTMLButtonElement>();
  for (const a of save.fleet) {
    const why = unavailable(a, offer, day);
    const b = button(fleet, '', () => choose(a), { cls: 'cr-pick' });
    b.replaceChildren();
    const top = el('div', 'cr-pick-top', b);
    el('b', '', top, a.registration);
    el('span', 'cr-icao', top, CAREER_PERF[a.type].icaoType);
    el('div', 'cr-pick-sub', b, why ?? `${typeName(a.type)} · ${Math.round(a.fuelKg)} kg aboard · ${a.tenure}`);
    b.disabled = why !== null;
    pickButtons.set(a.uid, b);
  }
  const switchNote = el('div', 'cr-note-box', left);

  // Fuel.
  section(left, 'Fuel');
  const fuelBox = el('div', 'cr-fuel', left);
  const fuelHead = el('div', 'cr-fuel-head', fuelBox);
  const fuelBig = el('b', 'num', fuelHead, '');
  const fuelMax = el('span', 'num', fuelHead, '');
  const slider = el('input', 'cr-slider', fuelBox);
  slider.type = 'range';
  slider.step = String(FUEL_STEP_KG);
  slider.min = '0';
  const quick = el('div', 'cr-fuel-quick', fuelBox);
  const reqBtn = button(quick, 'Required', () => setFuel(sheet.requiredFuelKg));
  const aboardBtn = button(quick, 'As aboard', () => setFuel(ac?.fuelKg ?? 0));
  const fullBtn = button(quick, 'Full', () => setFuel(sheet.maxFuelKg));
  const fuelMoney = el('div', 'cr-fuel-money', fuelBox);
  slider.addEventListener('input', () => setFuel(Number(slider.value)));

  // Payload.
  section(left, 'Payload');
  const payload = el('div', 'cr-payload', left);

  // Accept.
  button(m.foot, 'Job board', back, { key: 'Esc' });
  spacer(m.foot);
  const footNote = el('span', 'sc-note cr-foot-note', m.foot, '');
  const accept = button(m.foot, 'Accept', () => doAccept(), { cls: 'primary', key: 'Enter' });

  let sheet: LoadSheet = probe();

  function probe(): LoadSheet {
    if (!ac) return emptySheet();
    const p = loadSheet(offer!, ac, ac.fuelKg, save, model.fields);
    if (!Number.isFinite(fuelKg)) fuelKg = defaultFuelKg(p, ac.fuelKg);
    fuelKg = Math.max(0, Math.min(fuelKg, Math.max(p.maxFuelKg, 0)));
    return loadSheet(offer!, ac, fuelKg, save, model.fields);
  }

  function choose(a: FleetAircraft): void {
    if (ac?.uid === a.uid) return;
    ac = a;
    fuelKg = NaN;
    sheet = probe();
    refresh();
  }

  function setFuel(v: number): void {
    if (!ac) return;
    fuelKg = Math.max(0, Math.min(v, sheet.maxFuelKg));
    sheet = loadSheet(offer!, ac, fuelKg, save, model.fields);
    refresh();
  }

  function refusal(): string | null {
    if (!ac) return 'No aircraft of yours stands here';
    if (save.active && save.active.offer.id !== offer!.id) return 'One job at a time: finish the job in progress first';
    if (closed) return 'Departures are between 07:00 and 18:00';
    const sw = typeSwitchRefusal(ctx, ac);
    if (sw) return 'Type switch refused with the memory store';
    if (!sheet.ok) return sheet.warnings.find((w) => w.severity === 'block')?.text ?? 'Blocked';
    return null;
  }

  function doAccept(): void {
    if (!ac || refusal()) return;
    // The exact figure: the system recomputes the sheet with no tolerance, so a rounded Full or Required (0.1 kg)
    // could come back overMtow or fuelShort.
    ctx.send({ kind: 'accept', offerId: offer!.id, uid: ac.uid, fuelKg });
  }

  function refresh(): void {
    if (ac) ctx.memo.set(CHOICE, { offerId: offer!.id, uid: ac.uid, fuelKg } satisfies Choice);
    for (const [uid, b] of pickButtons) b.classList.toggle('sel', uid === ac?.uid);
    const perf = ac ? CAREER_PERF[ac.type] : null;

    switchNote.replaceChildren();
    switchNote.className = 'cr-note-box hidden';
    if (ac && ac.type !== model.bootedType) {
      const refused = typeSwitchRefusal(ctx, ac);
      switchNote.className = `cr-note-box${refused ? ' bad' : ''}`;
      switchNote.textContent = refused ?? `Accept reloads the sim into the ${typeName(ac.type)} first; the job waits in the save.`;
    }

    // Fuel readouts.
    const grade = perf?.fuel ?? 'avgas';
    slider.max = String(Math.max(0, sheet.maxFuelKg));
    slider.value = String(fuelKg);
    slider.disabled = !ac;
    const pct = sheet.maxFuelKg > 0 ? (fuelKg / sheet.maxFuelKg) * 100 : 0;
    slider.style.setProperty('--p', `${pct}%`);
    fuelBig.textContent = fuelKgL(fuelKg, grade);
    fuelMax.textContent = `of ${kg(sheet.maxFuelKg)} the load allows${perf && sheet.maxFuelKg < perf.usableFuelKg - 0.05 ? ` (tanks ${kg(perf.usableFuelKg)})` : ''}`;
    (reqBtn.children[0] as HTMLElement).textContent = `Required ${groupNum(sheet.requiredFuelKg)} kg`;
    (aboardBtn.children[0] as HTMLElement).textContent = `As aboard ${groupNum(ac?.fuelKg ?? 0)} kg`;
    (fullBtn.children[0] as HTMLElement).textContent = `Full ${groupNum(sheet.maxFuelKg)} kg`;
    reqBtn.disabled = !ac || sheet.requiredFuelKg > sheet.maxFuelKg;
    aboardBtn.disabled = !ac;
    fullBtn.disabled = !ac;
    fuelMoney.replaceChildren();
    if (sheet.upliftKg > 0.05) kv(fuelMoney, `Buy ${groupNum(sheet.upliftKg)} kg at ${offer!.origin}`, usd(-sheet.fuelCost), 'warn');
    else if (sheet.defuelKg > 0.05) kv(fuelMoney, `Drain ${groupNum(sheet.defuelKg)} kg (half-price credit)`, signedUsd(sheet.defuelCredit), 'ok');
    else kv(fuelMoney, 'No fuel bought or drained', '$0', 'dim');

    // Payload table.
    payload.replaceChildren();
    const pt = el('table', 'sc-table', payload);
    const ph = el('tr', '', el('thead', '', pt));
    el('th', '', ph, 'Item');
    el('th', '', ph, 'Station');
    el('th', 'r', ph, 'Mass');
    const pb = el('tbody', '', pt);
    const prow = (a: string, b: string, c: string, cls = ''): void => {
      const tr = el('tr', cls, pb);
      el('td', '', tr, a);
      el('td', '', tr, b);
      el('td', 'r num', tr, c);
    };
    prow(save.pilot.name, 'Pilot seat', kg(sheet.pilotKg), 'cr-dim');
    if (sheet.items.length > 0) for (const it of sheet.items) prow(it.label, stationLabel(it.station), kg(it.kg));
    else for (const it of offer!.payload) prow(it.label, '—', kg(it.kg), 'cr-bad');
    if (offer!.payload.length === 0) prow('No payload', '', '', 'cr-dim');

    // Mass and balance, fuel plan.
    mid.replaceChildren();
    section(mid, 'Mass and balance');
    const mb = el('div', 'cr-sheet', mid);
    kv(mb, 'Empty', kg(sheet.emptyKg));
    kv(mb, 'Pilot', kg(sheet.pilotKg));
    kv(mb, 'Payload', kg(sheet.payloadKg));
    kv(mb, 'Zero fuel', kg(sheet.zeroFuelKg), 'strong');
    kv(mb, 'Fuel', kg(sheet.fuelKg));
    const over = sheet.takeoffKg > sheet.mtowKg + 1e-6;
    kv(mb, 'Take-off', `${kg(sheet.takeoffKg)} / ${groupNum(sheet.mtowKg)}`, over ? 'bad' : 'strong');
    massBar(mb, sheet.takeoffKg, sheet.mtowKg);
    kv(mb, 'Landing', `${kg(sheet.landingKg)} / ${groupNum(sheet.mlwKg)}`, sheet.landingKg > sheet.mlwKg + 1e-6 ? 'warn' : '');
    cgBar(mb, sheet);

    section(mid, 'Fuel plan');
    const fp = el('div', 'cr-sheet', mid);
    kv(fp, 'Trip', kg(sheet.tripFuelKg));
    kv(fp, 'Climb', kg(sheet.climbFuelKg));
    kv(fp, 'Taxi', kg(sheet.taxiFuelKg));
    kv(fp, 'Reserve', kg(sheet.reserveFuelKg));
    kv(fp, 'Required', kg(sheet.requiredFuelKg), sheet.fuelKg < sheet.requiredFuelKg - 1e-6 ? 'bad' : 'strong');
    kv(fp, 'Endurance', minutes(sheet.enduranceMin));

    // Time and money, warnings.
    right.replaceChildren();
    section(right, 'Time');
    const tm = el('div', 'cr-sheet', right);
    kv(tm, sheet.headwindKt >= 0 ? 'Headwind' : 'Tailwind', `${Math.round(Math.abs(sheet.headwindKt))} kt`);
    kv(tm, 'Crosswind', `${Math.round(sheet.crosswindKt)} kt`, sheet.warnings.some((w) => w.code === 'crosswind') ? 'warn' : '');
    kv(tm, 'Flight time', minutes(sheet.flightTimeMin));
    kv(tm, 'Block', `${sheet.blockHoursEst.toFixed(2)} h`);
    kv(tm, 'Deadline margin', `${Math.round(sheet.deadlineMarginMin)} min`, sheet.deadlineMarginMin < 5 ? 'warn' : 'ok');

    section(right, 'Money (estimate)');
    const mo = el('div', 'cr-sheet', right);
    kv(mo, 'Pay', usd(offer!.pay));
    kv(mo, 'Fuel', usd(-sheet.fuelCost));
    if (sheet.defuelCredit > 0) kv(mo, 'Defuel credit', signedUsd(sheet.defuelCredit), 'ok');
    kv(mo, 'Landing fee', usd(-sheet.landingFeeEst));
    kv(mo, `Aircraft hours${perf && ac ? ` (${usd(ac.tenure === 'owned' ? perf.ownedHourly : perf.leaseHourly)}/h)` : ''}`, usd(-sheet.hoursCostEst));
    kv(mo, 'Estimated net', signedUsd(sheet.netEst), sheet.netEst < 0 ? 'bad' : 'ok').classList.add('cr-total');

    const warn = el('div', 'cr-warnings', right);
    if (sheet.warnings.length === 0) el('div', 'cr-warn ok', warn, 'Load sheet checks out.');
    for (const w of sheet.warnings) el('div', `cr-warn ${w.severity === 'block' ? 'block' : 'warn'}`, warn, w.text);

    const no = refusal();
    accept.disabled = no !== null;
    footNote.textContent = no ?? (ac && ac.type !== model.bootedType ? `Reloads into the ${typeName(ac.type)}` : 'Places you at the stand, cold and dark');
    footNote.classList.toggle('bad', no !== null);
  }
  refresh();

  return {
    root: m.scrim,
    onKey(e) {
      if (bareKey(e, 'Escape')) {
        back();
        return true;
      }
      if (bareKey(e, 'Enter', 'NumpadEnter')) {
        doAccept();
        return true;
      }
      return false;
    },
  };
}

/** A take-off mass bar against MTOW (red past it). */
function massBar(parent: HTMLElement, kgNow: number, max: number): void {
  const bar = el('div', `cr-massbar${kgNow > max + 1e-6 ? ' over' : ''}`, parent);
  el('i', '', bar).style.width = `${Math.max(0, Math.min(100, (kgNow / max) * 100))}%`;
}

/** The take-off CG between the type's aft and forward figures (aft left, forward right). */
function cgBar(parent: HTMLElement, s: LoadSheet): void {
  const row = el('div', 'cr-cg', parent);
  const label = el('div', 'cr-kv', row);
  el('span', '', label, 'Take-off CG');
  const inside = s.cgX <= s.cgFwdX + 1e-9 && s.cgX >= s.cgAftX - 1e-9;
  el('b', `num ${inside ? '' : 'warn'}`.trim(), label, cgM(s.cgX));
  const span = Math.max(1e-3, s.cgFwdX - s.cgAftX);
  const lo = s.cgAftX - span * 0.6;
  const hi = s.cgFwdX + span * 0.6;
  const at = (x: number): number => Math.max(0, Math.min(100, ((x - lo) / (hi - lo)) * 100));
  const bar = el('div', 'cr-cgbar', row);
  const band = el('i', 'band', bar);
  band.style.left = `${at(s.cgAftX)}%`;
  band.style.width = `${at(s.cgFwdX) - at(s.cgAftX)}%`;
  const mark = el('i', `mark${inside ? '' : ' out'}`, bar);
  mark.style.left = `${at(s.cgX)}%`;
  const ends = el('div', 'cr-cg-ends', row);
  el('span', '', ends, `Aft ${cgM(s.cgAftX)}`);
  el('span', '', ends, `Fwd ${cgM(s.cgFwdX)}`);
}

/** A sheet of zeros for the page with no aircraft here (everything disabled). */
function emptySheet(): LoadSheet {
  return {
    offerId: '', aircraftUid: '', type: 'c152', emptyKg: 0, pilotKg: 0, payloadKg: 0, zeroFuelKg: 0, fuelKg: 0, takeoffKg: 0, landingKg: 0,
    mtowKg: 1, mlwKg: 1, cgX: 0, cgFwdX: 0, cgAftX: 0, maxFuelKg: 0, tripFuelKg: 0, climbFuelKg: 0, taxiFuelKg: 0, reserveFuelKg: 0,
    requiredFuelKg: 0, upliftKg: 0, fuelCost: 0, defuelKg: 0, defuelCredit: 0, headwindKt: 0, crosswindKt: 0, flightTimeMin: 0,
    blockHoursEst: 0, enduranceMin: 0, deadlineMarginMin: 0, landingFeeEst: 0, hoursCostEst: 0, netEst: 0, items: [],
    warnings: [{ code: 'notHere', severity: 'block', text: 'No aircraft of yours stands here' }], ok: false,
  };
}

