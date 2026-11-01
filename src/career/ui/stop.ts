// The stop page (docs/career.md "Stops"): landing and shutting down at a field that is not the destination holds
// the job. The page shows where the aircraft is, what is left (distance to the destination, the deadline, the
// fuel for the rest of the way at the type's planning figures in the job's wind) and offers Refuel (re-placed at
// the stand, cold, with the fuel added; a fuel truck where the grade is not sold), Continue (carry on from here)
// and Give up (a failed diversion: no pay, -4 reputation, the aircraft stays here; asks once).

import { el } from '../../ui/dom';
import { flightTimeMin, fuelCost, fuelPlan, fuelPricePerKg, groundSpeedKt, windComponents } from '../costs';
import { bearingDeg, distanceNm } from '../geo';
import { CAREER_PERF } from '../perf';
import { FUEL_RULES, OCCUPANT_KG, REP_RULES } from '../types';
import { fuelKgL, groupNum, kg, minutes, nm, typeName, usd, wind } from './format';
import type { CareerCtx, CareerPageView } from './models';
import { badge, bareKey, button, confirmButton, kv, modal, section, spacer } from './widgets';

/** Memo key of the refuel target, kg. */
const TARGET = 'stop.fuel';

/** The stop page. Enter continues (or refuels when short); Esc returns to the hub. */
export function renderStop(parent: HTMLElement, ctx: CareerCtx): CareerPageView {
  const { model } = ctx;
  const save = model.save!;
  const job = save.active;
  const back = (): void => ctx.go('hub');
  if (!job || job.phase !== 'stopped') {
    const m = modal(parent, ctx, 'Stop', 'No job is stopped.', { fit: true, cls: 'cr-stop', onClose: back });
    el('div', 'sc-empty', m.body, 'The stop page opens when a job is held at another field.');
    button(m.foot, 'Hub', back, { key: 'Esc' });
    return { root: m.scrim, onKey: (e) => (bareKey(e, 'Escape') ? (back(), true) : false) };
  }
  const perf = CAREER_PERF[job.type];
  const ac = save.fleet.find((a) => a.uid === job.aircraftUid);
  const here = model.fields.find((f) => f.code === job.stoppedAt);
  const destCode = job.offer.destination.kind === 'field' ? job.offer.destination.code : null;
  const dest = model.fields.find((f) => f.code === (destCode ?? job.offer.origin));
  const aboard = Math.max(0, model.liveFuelKg ?? job.fuelKg);
  const leftMin = job.offer.deadlineMin - job.elapsedS / 60;

  // The rest of the way at the planning figures, in the job's wind.
  const dist = here && dest ? distanceNm(here, dest) : 0;
  const track = here && dest ? bearingDeg(here, dest) : 0;
  const gs = groundSpeedKt(perf.cruiseTasKt, { kind: 'leg', trackDeg: track }, job.offer.windDirDeg, job.offer.windKt);
  const plan = fuelPlan(perf, dist, gs);
  const zfw = perf.emptyKg + OCCUPANT_KG + job.items.reduce((s, it) => s + it.kg, 0);
  const maxFuel = Math.max(aboard, Math.min(perf.usableFuelKg, perf.mtowKg - zfw));
  const price = here ? fuelPricePerKg(perf.fuel, here.kind) : { perKg: 0, truck: false };
  const short = aboard < plan.requiredKg - 1e-6;

  const m = modal(parent, ctx, `Stopped at ${here?.name ?? job.stoppedAt ?? '?'}`, `${job.offer.title} · ${ac?.registration ?? ''} ${typeName(job.type)} · the deadline keeps running`, {
    cls: 'cr-stop', fit: true, onClose: back,
  });
  badge(m.right, leftMin < 0 ? `${minutes(-leftMin)} late` : `${minutes(leftMin)} left`, leftMin < 0 ? 'bad' : leftMin < 15 ? 'warn' : 'ok');

  const grid = el('div', 'cr-stop-grid', m.body);
  const a = el('div', 'cr-col', grid);
  section(a, 'The rest of the way');
  const way = el('div', 'cr-sheet', a);
  kv(way, 'Destination', dest ? `${dest.name} (${dest.code})` : '?');
  kv(way, 'Distance', `${nm(dist)} · ${String(Math.round(track) || 360).padStart(3, '0')}°`);
  const hw = windComponents(track, job.offer.windDirDeg, job.offer.windKt).headwind;
  kv(way, 'Wind', `${wind(job.offer.windDirDeg, job.offer.windKt)}${Math.abs(hw) >= 1 ? ` · ${hw > 0 ? 'head' : 'tail'} ${Math.round(Math.abs(hw))} kt` : ''}`);
  kv(way, 'Flight time', minutes(flightTimeMin(dist, gs)));
  kv(way, 'Time left', leftMin < 0 ? `${minutes(-leftMin)} late` : minutes(leftMin), leftMin < 0 ? 'bad' : '');
  kv(way, 'Fuel required', kg(plan.requiredKg), 'strong');
  kv(way, 'Fuel aboard', kg(aboard), short ? 'bad' : 'ok');

  const b = el('div', 'cr-col', grid);
  section(b, 'Refuel here');
  const fuelBox = el('div', 'cr-fuel', b);
  const head = el('div', 'cr-fuel-head', fuelBox);
  const big = el('b', 'num', head, '');
  el('span', 'num', head, `of ${kg(maxFuel)} the load allows`);
  const slider = el('input', 'cr-slider', fuelBox);
  slider.type = 'range';
  slider.min = String(aboard);
  slider.max = String(maxFuel);
  slider.step = '0.5';
  const quick = el('div', 'cr-fuel-quick', fuelBox);
  button(quick, `Required ${groupNum(plan.requiredKg)} kg`, () => set(plan.requiredKg)).disabled = plan.requiredKg <= aboard || plan.requiredKg > maxFuel;
  button(quick, `Full ${groupNum(maxFuel)} kg`, () => set(maxFuel));
  const money = el('div', 'cr-fuel-money', fuelBox);
  el('div', 'cr-fine', b, price.truck
    ? `${here?.code ?? ''} does not sell ${perf.fuel === 'jetA1' ? 'Jet A-1' : 'avgas'}: a fuel truck brings it (+50 %).`
    : `${perf.fuel === 'jetA1' ? 'Jet A-1' : 'Avgas'} at $${(price.perKg * FUEL_RULES.densityKgL[perf.fuel]).toFixed(2)} a litre here. Refuelling re-places you at the stand, cold and dark.`);

  let target = Number(ctx.memo.get(TARGET));
  if (!Number.isFinite(target) || target < aboard) target = short ? Math.min(maxFuel, plan.requiredKg) : aboard;
  function set(v: number): void {
    target = Math.max(aboard, Math.min(maxFuel, v));
    ctx.memo.set(TARGET, target);
    slider.value = String(target);
    slider.style.setProperty('--p', `${maxFuel > aboard ? ((target - aboard) / (maxFuel - aboard)) * 100 : 0}%`);
    big.textContent = fuelKgL(target, perf.fuel);
    money.replaceChildren();
    const up = target - aboard;
    kv(money, up > 0.05 ? `Buy ${groupNum(up)} kg` : 'Nothing to buy', usd(-fuelCost(up, perf.fuel, here?.kind ?? 'sealed')), up > 0.05 ? 'warn' : 'dim');
    refuel.disabled = up <= 0.05;
  }
  slider.addEventListener('input', () => set(Number(slider.value)));

  confirmButton(m.foot, 'Give up', `Confirm: no pay, ${REP_RULES.diverted} reputation`, () => ctx.send({ kind: 'giveUp' }), {
    cls: 'cr-danger', title: 'A failed diversion: no pay, the aircraft stays here',
  });
  spacer(m.foot);
  button(m.foot, 'Hub', back, { key: 'Esc' });
  const refuel = button(m.foot, 'Refuel', () => doRefuel(), { cls: short ? 'primary' : '', key: short ? 'Enter' : undefined });
  const cont = button(m.foot, 'Continue', () => ctx.send({ kind: 'continueJob' }), { cls: short ? '' : 'primary', key: short ? undefined : 'Enter' });
  if (short) cont.title = 'Not enough fuel for the rest of the way at the planning figures';
  function doRefuel(): void {
    if (target - aboard <= 0.05) return;
    // The exact figure (a rounded Full could pass the most the load allows).
    ctx.send({ kind: 'refuel', fuelKg: target });
  }
  set(target);

  return {
    root: m.scrim,
    onKey(e) {
      if (bareKey(e, 'Escape')) {
        back();
        return true;
      }
      if (bareKey(e, 'Enter', 'NumpadEnter')) {
        if (short) doRefuel();
        else ctx.send({ kind: 'continueJob' });
        return true;
      }
      return false;
    },
  };
}
