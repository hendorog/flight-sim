// Career totals, always derived from the logbook (never stored).
//
// Columns follow the logbook (section 5.7): flight time is block time; dual, solo and PIC by role. A skill
// test is flown with an examiner who is not instructing, so it counts toward the total only (spec silent).

import type { CareerTotals, LogbookEntry } from '../types';

export function totals(logbook: readonly LogbookEntry[]): CareerTotals {
  const t: CareerTotals = {
    totalS: 0, dualS: 0, soloS: 0, picS: 0, nightS: 0, instrumentS: 0,
    landingsDay: 0, landingsNight: 0, takeoffs: 0, flights: 0,
  };
  for (const e of logbook) {
    const x = e.times;
    t.totalS += x.blockS;
    if (e.role === 'dual') t.dualS += x.blockS;
    else if (e.role === 'solo') t.soloS += x.blockS;
    else if (e.role === 'pic') t.picS += x.blockS;
    t.nightS += x.nightS;
    t.instrumentS += x.instrumentS;
    t.landingsDay += x.landingsDay;
    t.landingsNight += x.landingsNight;
    t.takeoffs += x.takeoffs;
    t.flights++;
  }
  return t;
}
