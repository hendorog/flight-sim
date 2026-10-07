// School UI pure formatters (spec section 6.3, module 7): tolerance text, deviation bars, trace scaling,
// strip choice, logbook pages with totals and CSV, plus the small helpers the screens share. DOM-free.

import { describe, expect, it } from 'vitest';
import { runwayCoords } from '../../src/core/world';
import { DOWNWIND_OFFSET } from '../../src/sim/scenarios';
import type { CareerTotals, Lesson, LogbookEntry, TraceBand, TraceChannel, TraceData } from '../../src/training/types';
import { captionHoldS } from '../../src/ui/school/captions';
import { impression, showsTrack } from '../../src/ui/school/debrief';
import {
  barPosition, chooseStrips, filterLogbook, formatClock, formatHM, formatNumber, formatSigned, formatTol, formatValue,
  gradeName, initials, licenceTitle, linearScale, logbookCsv, logbookPages, logColumns, niceStep, niceTicks, outcomeLabel,
  starString, stripRange, timeTicks, TOL_INFO, unwrapAngles, zoneFor,
} from '../../src/ui/school/format';
import { fromRunway, idealCircuit } from '../../src/ui/school/trackMap';
import { keyCaps } from '../../src/ui/school/widgets';
import { STANDARDS } from '../../src/training/grading/standards';

const M = '−';

describe('tolerance and value text', () => {
  it('prints symmetric, asymmetric and zero-sided bands with units', () => {
    expect(formatTol({ minus: 150, plus: 150 }, 'ft')).toBe('±150 ft');
    expect(formatTol({ minus: 5, plus: 15 }, 'kt')).toBe(`${M}5/+15 kt`);
    expect(formatTol({ minus: 0, plus: 400 }, 'ft')).toBe('0/+400 ft');
    expect(formatTol({ minus: 10, plus: 10 }, 'deg')).toBe('±10°');
    expect(formatTol({ minus: 0.2, plus: 0.2 }, 'SR')).toBe('±0.2 SR');
    expect(formatTol({ minus: 1000, plus: 1000 }, 'fpm')).toBe('±1,000 fpm');
  });

  it('labels every tolerance key of the standards table with a unit', () => {
    for (const key of Object.keys(STANDARDS.easa.test)) {
      const info = TOL_INFO[key as keyof typeof TOL_INFO];
      expect(info, key).toBeDefined();
      expect(info.label.length).toBeGreaterThan(2);
    }
  });

  it('groups thousands, uses a true minus and three-digit headings', () => {
    expect(formatNumber(3500)).toBe('3,500');
    expect(formatNumber(-500)).toBe(`${M}500`);
    expect(formatNumber(-0.2)).toBe('0');
    expect(formatNumber(1234567.891, 2)).toBe('1,234,567.89');
    expect(formatValue(3500, 'ft')).toBe('3,500 ft');
    expect(formatValue(90, 'deg', true)).toBe('090°');
    expect(formatValue(0, 'deg', true)).toBe('360°');
    expect(formatValue(-2, 'deg', true)).toBe('358°');
    expect(formatValue(30, 'deg')).toBe('30°');
  });

  it('signs deviations explicitly and never prints "-0"', () => {
    expect(formatSigned(40, 'ft')).toBe('+40 ft');
    expect(formatSigned(-3, 'kt')).toBe(`${M}3 kt`);
    expect(formatSigned(0.3, 'ft')).toBe('+0.3 ft');
    expect(formatSigned(-0.04, 'kt')).toBe('0.0 kt');
  });

  it('formats clock and logbook times', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(192.4)).toBe('3:12');
    expect(formatHM(3900)).toBe('1:05');
    expect(formatHM(29)).toBe('0:00');
    expect(formatHM(31)).toBe('0:01');
  });
});

describe('deviation bars', () => {
  const tol = { minus: 100, plus: 100 };
  it('puts the target in the middle and the tolerance edges at the quarter marks', () => {
    expect(barPosition(3500, 3500, tol)).toEqual({ pos: 0.5, n: 0, zone: 'green' });
    expect(barPosition(3500, 3600, tol).pos).toBeCloseTo(0.75);
    expect(barPosition(3500, 3400, tol).pos).toBeCloseTo(0.25);
    expect(barPosition(3500, 3600, tol).zone).toBe('green');
  });

  it('turns amber to 1.5 tolerances and red beyond, clamping at the bar end', () => {
    expect(barPosition(0, 125, tol).zone).toBe('amber');
    expect(barPosition(0, 151, tol).zone).toBe('red');
    expect(barPosition(0, 900, tol).pos).toBe(1);
    expect(barPosition(0, -900, tol).pos).toBe(0);
    expect([zoneFor(1), zoneFor(1.5), zoneFor(1.51)]).toEqual(['green', 'amber', 'red']);
  });

  it('uses the side of an asymmetric band and floors a zero side at half a unit', () => {
    const vy = { minus: 5, plus: 15 };
    expect(barPosition(74, 81, vy).n).toBeCloseTo(7 / 15);
    expect(barPosition(74, 69, vy).n).toBeCloseTo(1);
    expect(barPosition(0, -1, { minus: 0, plus: 400 }).n).toBeCloseTo(2);
  });

  it('wraps angles through north', () => {
    expect(barPosition(355, 5, { minus: 10, plus: 10 }, true).n).toBeCloseTo(1);
    expect(barPosition(355, 5, { minus: 10, plus: 10 }, true).pos).toBeCloseTo(0.75);
  });
});

describe('trace scaling', () => {
  it('maps a domain onto a range and back', () => {
    const x = linearScale(0, 100, 70, 570);
    expect(x(0)).toBe(70);
    expect(x(50)).toBe(320);
    expect(x.invert(320)).toBe(50);
    const flat = linearScale(5, 5, 0, 10);
    expect(flat(5)).toBe(5);
  });

  it('picks nice steps and ticks', () => {
    expect(niceStep(1000, 4)).toBe(250);
    expect(niceStep(7, 3)).toBe(2.5);
    expect(niceTicks(2480, 4620, 3)).toEqual([3000, 4000]);
    expect(niceTicks(-20, 20, 4)).toEqual([-20, -10, 0, 10, 20]);
    expect(timeTicks(930, 8)).toEqual([0, 120, 240, 360, 480, 600, 720, 840]);
    expect(timeTicks(930, 6)).toEqual([0, 180, 360, 540, 720, 900]);
    expect(timeTicks(100, 8)).toEqual([0, 15, 30, 45, 60, 75, 90]);
  });

  it('unwraps headings through north', () => {
    expect(unwrapAngles([350, 355, 2, 10])).toEqual([350, 355, 362, 370]);
    expect(unwrapAngles([10, 2, 355])).toEqual([10, 2, -5]);
    const withGap = unwrapAngles([359, NaN, 1]);
    expect(withGap[2]).toBe(361);
  });

  it('fits a strip to the data and its bands, with a minimum span', () => {
    const [lo, hi] = stripRange([3490, 3510], [], 200);
    expect(lo).toBeLessThanOrEqual(3400);
    expect(hi).toBeGreaterThanOrEqual(3600);
    const [blo, bhi] = stripRange([3500, 3500], [{ target: 3500, minus: 150, plus: 150 }], 10);
    expect(blo).toBeLessThanOrEqual(3350);
    expect(bhi).toBeGreaterThanOrEqual(3650);
    expect(stripRange([NaN], [], 20)).toEqual([0, 20]);
  });
});

function trace(bands: TraceBand['sig'][], channels: TraceChannel[] = ['altFt', 'asiKt', 'hdgDeg', 'aiBankDeg', 'vsiFpm', 'gpDevFt', 'rwyAcrossM', 'pitchDeg']): Pick<TraceData, 'bands' | 'channels'> {
  const ch = Object.fromEntries(channels.map((c) => [c, [1, 2, 3]])) as unknown as TraceData['channels'];
  return { channels: ch, bands: bands.map((sig) => ({ sig, fromS: 0, toS: 1, target: 0, minus: 1, plus: 1, taskId: 't' })) };
}

describe('debrief strips', () => {
  it('shows altitude, IAS, heading and VS when nothing is graded', () => {
    expect(chooseStrips(trace([]))).toEqual(['altFt', 'asiKt', 'hdgDeg', 'vsiFpm']);
  });

  it('prefers the graded member of each pair and puts graded strips first', () => {
    expect(chooseStrips(trace(['bankDeg', 'kias']))).toEqual(['asiKt', 'aiBankDeg', 'altFt', 'vsiFpm']);
    expect(chooseStrips(trace(['gpDevFt', 'asiKt', 'altFt']))).toEqual(['altFt', 'asiKt', 'gpDevFt', 'hdgDeg']);
  });

  it('adds the centreline only when it is graded, and never more than four strips', () => {
    const s = chooseStrips(trace(['rwyAcrossM', 'gpDevFt', 'asiKt', 'altFt']));
    expect(s).toEqual(['altFt', 'asiKt', 'gpDevFt', 'rwyAcrossM']);
    expect(chooseStrips(trace([]), 2)).toHaveLength(2);
  });

  it('skips channels without data', () => {
    const s = chooseStrips(trace([], ['altFt', 'asiKt']));
    expect(s).toEqual(['altFt', 'asiKt']);
  });
});

// ---- Logbook ------------------------------------------------------------------------------------------------

const T0 = { blockS: 0, airborneS: 0, nightS: 0, instrumentS: 0, landingsDay: 0, landingsNight: 0, takeoffs: 0 };
function entry(i: number, lesson: boolean, minutes = 30): LogbookEntry {
  return {
    id: `e${i}`, date: new Date(Date.UTC(2026, 8, 1, 10) + i * 86_400_000).toISOString(), aircraftType: 'C172', registration: 'G-FSCK',
    from: 'KFBL', to: 'KFBL', role: lesson ? 'dual' : 'solo', times: { ...T0, blockS: minutes * 60, landingsDay: 1, nightS: i % 3 === 0 ? 600 : 0 },
    lessonId: lesson ? 'L01' : null, lessonVersion: lesson ? 1 : null, exercise: lesson ? 'Ex 3-4 Effects of controls' : 'Free flight',
    outcome: lesson ? 'competent' : 'freeFlight', stars: lesson ? 2 : null, remarks: '', signedBy: lesson ? 'K. Mercer FI(A)' : null,
  };
}
/** The career totals rule (module 2 owns the real one): dual for dual/test, solo, pic. */
function totalsFn(l: readonly LogbookEntry[]): CareerTotals {
  const t: CareerTotals = { totalS: 0, dualS: 0, soloS: 0, picS: 0, nightS: 0, instrumentS: 0, landingsDay: 0, landingsNight: 0, takeoffs: 0, flights: 0 };
  for (const e of l) {
    t.totalS += e.times.blockS;
    if (e.role === 'dual' || e.role === 'test') t.dualS += e.times.blockS;
    else if (e.role === 'solo') t.soloS += e.times.blockS;
    else t.picS += e.times.blockS;
    t.nightS += e.times.nightS;
    t.landingsDay += e.times.landingsDay;
    t.flights++;
  }
  return t;
}

describe('logbook pages', () => {
  const book = Array.from({ length: 23 }, (_, i) => entry(i, i % 4 !== 0));

  it('pages ten lines, oldest first, with page, brought-forward and to-date totals', () => {
    const shuffled = [...book].reverse();
    const pages = logbookPages(shuffled, totalsFn);
    expect(pages).toHaveLength(3);
    expect(pages.map((p) => p.rows.length)).toEqual([10, 10, 3]);
    expect(pages[0].rows[0].id).toBe('e0');
    expect(pages[2].rows[2].id).toBe('e22');
    for (const p of pages) {
      expect(p.toDate.totalS).toBe(p.broughtForward.totalS + p.page.totalS);
      expect(p.toDate.flights).toBe(p.broughtForward.flights + p.page.flights);
    }
    expect(pages[0].broughtForward.flights).toBe(0);
    expect(pages[2].toDate.totalS).toBe(totalsFn(book).totalS);
  });

  it('has one empty page for an empty logbook', () => {
    const pages = logbookPages([], totalsFn);
    expect(pages).toHaveLength(1);
    expect(pages[0].rows).toEqual([]);
    expect(pages[0].toDate.flights).toBe(0);
  });

  it('formats the totals columns (solo and PIC share a column)', () => {
    const t: CareerTotals = { totalS: 0, dualS: 3900, soloS: 600, picS: 1200, nightS: 0, instrumentS: 90, landingsDay: 7, landingsNight: 2, takeoffs: 0, flights: 3 };
    expect(logColumns(t)).toEqual({ dual: '1:05', solo: '0:30', night: '0:00', instr: '0:02', ldg: '7/2' });
  });

  it('filters lessons and free flights', () => {
    expect(filterLogbook(book, 'lessons').every((e) => e.lessonId)).toBe(true);
    expect(filterLogbook(book, 'free')).toHaveLength(6);
    expect(filterLogbook(book, 'all')).toHaveLength(23);
  });

  it('exports CSV with a header and escaped cells', () => {
    const e = { ...entry(1, true), remarks: 'Trim, "always" trim' };
    const csv = logbookCsv([entry(2, false), e], totalsFn).split('\n');
    expect(csv).toHaveLength(3);
    expect(csv[0].startsWith('Date,Type,Reg,From,To,Dual')).toBe(true);
    expect(csv[1]).toContain('"Trim, ""always"" trim"');
    expect(csv[1]).toContain('Competent');
    expect(csv[2]).toContain('Free flight');
  });
});

describe('words', () => {
  it('names grades, outcomes, stars and licences', () => {
    expect(gradeName(2)).toBe('Satisfactory');
    expect(gradeName(null)).toBe('Not graded');
    expect(outcomeLabel('notYet')).toBe('Not yet competent');
    expect(outcomeLabel('testPartial')).toBe('PARTIAL PASS');
    expect(starString(2)).toBe('★★☆');
    expect(starString(7)).toBe('★★★');
    expect(initials('Alex  Morgan')).toBe('AM');
    expect(initials('Cher')).toBe('C');
    expect(initials('  ')).toBe('?');
    expect(licenceTitle('easa', true)).toBe('PPL(A) SEP (land)');
    expect(licenceTitle('faa', true)).toBe('Private Pilot ASEL');
    expect(licenceTitle('faa', false)).toBe('Student Pilot');
  });

  it('holds captions for their reading time', () => {
    expect(captionHoldS('Rotate.')).toBe(2);
    expect(captionHoldS('Speed’s high, 81. Raise the nose a touch.')).toBeCloseTo(8 / 2.6);
  });

  it('shows briefing key caps from the bindings and the training keys', () => {
    expect(keyCaps('throttleUp')).toEqual({ label: 'Throttle up', keys: [['F3'], ['Page Up']] });
    expect(keyCaps('handback')!.keys).toEqual([['Shift', 'Enter']]);
    expect(keyCaps('parkingBrake')!.keys).toEqual([['Shift', 'B']]);
    expect(keyCaps('nope')).toBeNull();
  });
});

describe('debrief helpers', () => {
  const lesson = {
    id: 'L04', stage: 'handling', briefing: { diagram: { kind: 'climb' } },
    exercises: [{ id: 'a', weight: 1 }, { id: 'b', weight: 2 }, { id: 'demo', weight: 0 }],
  } as unknown as Lesson;

  it('weights the overall impression and ignores demos and ungraded exercises', () => {
    const ex = (exerciseId: string, grade: 1 | 2 | 3 | 4 | null) => ({ exerciseId, grade }) as never;
    expect(impression(lesson, [ex('a', 4), ex('b', 1), ex('demo', 4)])).toBe('Satisfactory (2.0 of 4)');
    expect(impression(lesson, [ex('a', null)])).toBeNull();
    // Not passed: never "Good" or better beside "Not yet competent".
    expect(impression(lesson, [ex('a', 4), ex('b', 2)], false)).toBe('Satisfactory (2.7 of 4)');
  });

  it('shows the ground track for circuit, forced-landing and route lessons only', () => {
    expect(showsTrack(lesson)).toBe(false);
    expect(showsTrack({ ...lesson, stage: 'circuits' } as Lesson)).toBe(true);
    expect(showsTrack({ ...lesson, briefing: { diagram: { kind: 'pfl' } } } as Lesson)).toBe(true);
    expect(showsTrack({ ...lesson, route: {} } as Lesson)).toBe(true);
  });

  it('draws the ideal circuit left of runway 07 at the downwind offset', () => {
    const pts = idealCircuit();
    const across = pts.map((p) => runwayCoords(p.north, p.east).across);
    expect(Math.min(...across)).toBeCloseTo(-DOWNWIND_OFFSET, 6);
    expect(Math.max(...across)).toBeCloseTo(0, 6);
    const p = fromRunway(500, -200);
    const back = runwayCoords(p.north, p.east);
    expect(back.along).toBeCloseTo(500, 6);
    expect(back.across).toBeCloseTo(-200, 6);
  });
});
