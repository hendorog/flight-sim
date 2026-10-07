// Navigation log card for route lessons (L20): the planned legs with headings and times from the lesson's
// NavRoute, shown on the briefing. (The spec's interactive nav-log form needs a SchoolCommand to hand the
// student's figures to the runner; until the contract has one, the planned log is shown read-only.)

import type { NavRoute } from '../../training/types';
import { el } from '../dom';
import { formatNumber, formatValue } from './format';

export function renderNavLog(parent: HTMLElement, route: NavRoute): HTMLElement {
  const box = el('div', '', parent);
  const t = el('table', 'sc-table', box);
  const head = el('tr', '', el('thead', '', t));
  for (const [h, r] of [['Leg', false], ['Heading', true], ['Time', true]] as const) el('th', r ? 'r' : '', head, h);
  const body = el('tbody', '', t);
  const n = route.waypoints.length;
  let total = 0;
  for (let i = 0; i < n - 1; i++) {
    const tr = el('tr', '', body);
    el('td', '', tr, `${route.waypoints[i].name} → ${route.waypoints[i + 1].name}`);
    const hdg = route.legHeadingsDeg[i];
    const min = route.legMinutes[i];
    el('td', 'r', tr, Number.isFinite(hdg) ? `${formatValue(hdg, 'deg', true)}M` : '—');
    el('td', 'r', tr, Number.isFinite(min) ? `${formatNumber(min)} min` : '—');
    if (Number.isFinite(min)) total += min;
  }
  el('div', 'sc-foot-note', box, `${route.name}: cruise ${formatNumber(route.altFt)} ft, about ${formatNumber(total)} min en route.`);
  return box;
}
