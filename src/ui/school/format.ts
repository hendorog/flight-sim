// Pure formatters and scales of the school screens (no DOM): tolerance and value text, grade and outcome
// words, deviation bars, trace-graph scaling, logbook pages with totals and CSV. Kept apart from the DOM code
// so node tests can pin them (tests/training/schoolFormat.test.ts).

import type {
  AuthorityId, CareerTotals, EndorsementId, Grade, LessonResult, LogbookEntry, Pattern, SignalId, Tol, TolKey,
  TraceChannel, TraceData,
} from '../../training/types';

// ---- Words -------------------------------------------------------------------------------------------------

export const GRADE_NAMES: Record<Grade, string> = { 1: 'Not yet', 2: 'Satisfactory', 3: 'Good', 4: 'Excellent' };

/** Grade word; null is a demonstration or too little data to grade. */
export function gradeName(g: Grade | null): string {
  return g === null ? 'Not graded' : GRADE_NAMES[g];
}

const OUTCOMES: Record<LessonResult['outcome'], { word: string; tone: 'ok' | 'warn' | 'bad' }> = {
  competent: { word: 'Competent', tone: 'ok' },
  notYet: { word: 'Not yet competent', tone: 'warn' },
  incomplete: { word: 'Incomplete', tone: 'warn' },
  abandoned: { word: 'Abandoned', tone: 'warn' },
  crashed: { word: 'Crashed', tone: 'bad' },
  testPass: { word: 'PASS', tone: 'ok' },
  testPartial: { word: 'PARTIAL PASS', tone: 'warn' },
  testFail: { word: 'NOT PASSED', tone: 'bad' },
};

export function outcomeLabel(o: LessonResult['outcome'] | 'freeFlight'): string {
  return o === 'freeFlight' ? 'Free flight' : OUTCOMES[o].word;
}

export function outcomeTone(o: LessonResult['outcome'] | 'freeFlight'): 'ok' | 'warn' | 'bad' {
  return o === 'freeFlight' ? 'ok' : OUTCOMES[o].tone;
}

const PATTERN_NOTES: Record<Pattern, string> = {
  ok: '',
  biasHigh: 'Consistently high',
  biasLow: 'Consistently low',
  oscillation: 'Chasing the target',
  drift: 'Slow drift',
  late: 'Late to settle',
};

export function patternNote(p: Pattern): string {
  return PATTERN_NOTES[p];
}

export function authorityName(a: AuthorityId): string {
  return a === 'easa' ? 'EASA Part-FCL' : 'FAA ACS';
}

export const ENDORSEMENT_TITLES: Record<string, string> = {
  firstSolo: 'First solo',
  soloAreaSolo: 'Solo in the local area',
  crosswind15: 'Crosswind 15 kt',
  night: 'Night',
  ppl: 'Private pilot skill test',
};

export function endorsementTitle(id: EndorsementId): string {
  return ENDORSEMENT_TITLES[id] ?? id;
}

/** Licence title by authority (section 5.7). */
export function licenceTitle(authority: AuthorityId, ppl: boolean): string {
  if (!ppl) return 'Student Pilot';
  return authority === 'easa' ? 'PPL(A) SEP (land)' : 'Private Pilot ASEL';
}

/** Course minimums shown next to the hours (section 4.2), labelled "simulation; not creditable". */
export const COURSE_MINIMUMS: Record<AuthorityId, { totalH: number; dualH: number; soloH: number }> = {
  easa: { totalH: 45, dualH: 25, soloH: 10 },
  faa: { totalH: 40, dualH: 20, soloH: 10 },
};

/** Up to two initials for the licence avatar. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

/** "★★☆" for 0-3 stars. */
export function starString(n: number): string {
  const k = Math.max(0, Math.min(3, Math.round(n)));
  return '★'.repeat(k) + '☆'.repeat(3 - k);
}

// ---- Numbers, units and tolerances ------------------------------------------------------------------------

const MINUS = '−';

/** Thousands-grouped number ("3,500"), fixed decimals, true minus sign. Locale-independent. */
export function formatNumber(v: number, decimals = 0): string {
  if (!Number.isFinite(v)) return '—';
  const neg = v < 0 && Math.abs(v) >= 0.5 * 10 ** -decimals;
  const fixed = Math.abs(v).toFixed(decimals);
  const [int, frac] = fixed.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? MINUS : '') + grouped + (frac ? `.${frac}` : '');
}

/** Units the school prints. 'deg' prints as a degree sign; 'SR' is standard-rate turns. */
export type SchoolUnit = 'ft' | 'kt' | 'deg' | 'fpm' | 'm' | 'NM' | 'min' | 'rpm' | 'SR' | 'g' | '%' | '';

function unitSuffix(unit: string): string {
  if (!unit) return '';
  if (unit === 'deg' || unit === '°') return '°';
  return ` ${unit}`;
}

/** Decimals that suit a unit's usual magnitudes. */
function decimalsFor(unit: string, v: number): number {
  if (unit === 'SR' || unit === 'g') return 1;
  if (unit === 'NM') return Math.abs(v) < 10 ? 1 : 0;
  return Math.abs(v) < 1 && v !== 0 ? 1 : 0;
}

/** "3,500 ft", "74 kt", "090°" (headings are three digits), "−500 fpm". */
export function formatValue(v: number, unit: string, heading = false): string {
  if (heading && (unit === 'deg' || unit === '°')) {
    const h = ((Math.round(v) % 360) + 360) % 360;
    return `${String(h === 0 ? 360 : h).padStart(3, '0')}°`;
  }
  return formatNumber(v, decimalsFor(unit, v)) + unitSuffix(unit);
}

/** A deviation with an explicit sign: "+40 ft", "−3 kt", "0 ft". */
export function formatSigned(v: number, unit: string): string {
  const d = decimalsFor(unit, v);
  const r = Number(v.toFixed(d));
  const body = formatNumber(Math.abs(r), d) + unitSuffix(unit);
  return r > 0 ? `+${body}` : r < 0 ? `${MINUS}${body}` : body;
}

/** "±150 ft", "−5/+15 kt", "0/+400 ft". */
export function formatTol(t: Tol, unit: string): string {
  const u = unitSuffix(unit);
  const d = Math.max(decimalsFor(unit, t.minus), decimalsFor(unit, t.plus));
  if (t.minus === t.plus) return `±${formatNumber(t.plus, d)}${u}`;
  const minus = t.minus === 0 ? '0' : `${MINUS}${formatNumber(t.minus, d)}`;
  return `${minus}/+${formatNumber(t.plus, d)}${u}`;
}

export const TOL_INFO: Record<TolKey, { label: string; unit: SchoolUnit }> = {
  altitude: { label: 'Altitude', unit: 'ft' },
  altitudeEngineOut: { label: 'Altitude, engine out', unit: 'ft' },
  heading: { label: 'Heading', unit: 'deg' },
  headingEngineOut: { label: 'Heading, engine out', unit: 'deg' },
  speed: { label: 'Airspeed', unit: 'kt' },
  speedClimbApproach: { label: 'Climb and approach speed', unit: 'kt' },
  slowFlightSpeed: { label: 'Slow-flight speed', unit: 'kt' },
  bankMedium: { label: 'Bank, medium turns', unit: 'deg' },
  bankSteep: { label: 'Bank, steep turns', unit: 'deg' },
  rollout: { label: 'Roll-out heading', unit: 'deg' },
  vs: { label: 'Vertical speed', unit: 'fpm' },
  touchdownZoneFt: { label: 'Touchdown beyond the aim point', unit: 'ft' },
  touchdownZoneShortFt: { label: 'Short-field touchdown', unit: 'ft' },
  centrelineM: { label: 'Centreline (main gear)', unit: 'm' },
  glidepathFt: { label: '3° glide path', unit: 'ft' },
  stallHeightLossFt: { label: 'Height loss in a stall', unit: 'ft' },
  navAltitude: { label: 'Cruise altitude', unit: 'ft' },
  navHeading: { label: 'Cruise heading', unit: 'deg' },
  xtkNm: { label: 'Track error', unit: 'NM' },
  etaMin: { label: 'Time at turning points', unit: 'min' },
  instrAltitude: { label: 'Altitude, instruments only', unit: 'ft' },
  instrHeading: { label: 'Heading, instruments only', unit: 'deg' },
  turnRate: { label: 'Turn rate', unit: 'SR' },
  sinkFpm: { label: 'Sink rate at touchdown', unit: 'fpm' },
};

const SIG_UNITS: Record<string, SchoolUnit> = {
  asiKt: 'kt', kias: 'kt', tasKt: 'kt', gsKt: 'kt', headwindKt: 'kt', crosswindKt: 'kt',
  altFt: 'ft', altMslFt: 'ft', aglFt: 'ft', hafFt: 'ft', distAimFt: 'ft', gpDevFt: 'ft', 'step.altChangeFt': 'ft',
  vsiFpm: 'fpm', vsFpm: 'fpm',
  hdgDeg: 'deg', hdgTrueDeg: 'deg', trackDeg: 'deg', driftDeg: 'deg', aiPitchDeg: 'deg', aiBankDeg: 'deg',
  pitchDeg: 'deg', bankDeg: 'deg', aoaDeg: 'deg', flapsDeg: 'deg', 'step.turnDeg': 'deg', 'step.maxBankAbsDeg': 'deg',
  rwyAlongM: 'm', rwyAcrossM: 'm', rpm: 'rpm', gLoad: 'g', turnRate: 'SR', 'nav.xtkNm': 'NM', 'nav.distNm': 'NM',
  'nav.etaErrMin': 'min', downwindOffsetNm: 'NM',
};

/** Display unit of a signal ('' when it has none worth printing). */
export function sigUnit(sig: SignalId | undefined): SchoolUnit {
  return (sig && SIG_UNITS[sig]) || '';
}

/** Headings print as three digits. */
export function isHeadingSig(sig: SignalId | undefined): boolean {
  return sig === 'hdgDeg' || sig === 'hdgTrueDeg' || sig === 'trackDeg';
}

/** "m:ss" of sim seconds (debrief times). */
export function formatClock(s: number): string {
  const t = Math.max(0, Math.round(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

/** Logbook "h:mm" of seconds. */
export function formatHM(s: number): string {
  const m = Math.max(0, Math.round(s / 60));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

/** "12.4 h" of seconds (hub totals). */
export function formatHours(s: number): string {
  return `${(Math.max(0, s) / 3600).toFixed(1)} h`;
}

/** "3 Oct 2026" from an ISO date (UTC, so screenshots and tests are stable). */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Whole days between two instants (currency nudge). */
export function daysBetween(fromIso: string, to: Date): number {
  const t = new Date(fromIso).getTime();
  return Number.isNaN(t) ? 0 : Math.floor((to.getTime() - t) / 86_400_000);
}

// ---- Deviation bars and chips ------------------------------------------------------------------------------

export type Zone = 'green' | 'amber' | 'red';

/**
 * Where a value sits on a lesson-card deviation bar (section 5.4): the bar spans two tolerances either side
 * of the target, so the green band (n <= 1) fills the middle half, amber runs to 1.5 tol and red beyond.
 * `pos` is 0..1 along the bar (0.5 = on target); a zero-sided tolerance uses a 0.5-unit floor as grading does.
 */
export function barPosition(target: number, value: number, tol: Tol, angle = false): { pos: number; n: number; zone: Zone } {
  let e = value - target;
  if (angle) e = wrap180(e);
  const side = e >= 0 ? Math.max(tol.plus, 0.5) : Math.max(tol.minus, 0.5);
  const signed = e / side;
  const n = Math.abs(signed);
  const pos = 0.5 + 0.25 * Math.max(-2, Math.min(2, signed));
  return { pos, n, zone: zoneFor(n) };
}

/** Same thresholds as the lesson strip chips: green n <= 1, amber <= 1.5, red beyond. */
export function zoneFor(n: number): Zone {
  return n <= 1 ? 'green' : n <= 1.5 ? 'amber' : 'red';
}

export function wrap180(a: number): number {
  return ((((a + 180) % 360) + 360) % 360) - 180;
}

// ---- Trace graph scaling ------------------------------------------------------------------------------------

export interface LinearScale {
  (v: number): number;
  invert(px: number): number;
}

/** Maps [d0, d1] onto [r0, r1]; a degenerate domain maps to the middle of the range. */
export function linearScale(d0: number, d1: number, r0: number, r1: number): LinearScale {
  const span = d1 - d0;
  const f = ((v: number) => (span === 0 ? (r0 + r1) / 2 : r0 + ((v - d0) / span) * (r1 - r0))) as LinearScale;
  f.invert = (px: number) => (r1 === r0 ? d0 : d0 + ((px - r0) / (r1 - r0)) * span);
  return f;
}

/** A "nice" tick step (1, 2, 2.5 or 5 × 10^k) giving at most `maxTicks` intervals over `range`. */
export function niceStep(range: number, maxTicks: number): number {
  if (!(range > 0) || maxTicks < 1) return 1;
  const raw = range / maxTicks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * mag >= raw - 1e-12) return m * mag;
  return 10 * mag;
}

/** Time-axis ticks (s) on whole clock steps (10 s ... 1 h) giving at most `maxTicks` intervals over [0, span]. */
export function timeTicks(span: number, maxTicks: number): number[] {
  const steps = [10, 15, 30, 60, 120, 180, 300, 600, 900, 1200, 1800, 3600];
  const step = steps.find((s) => span / s <= maxTicks) ?? Math.ceil(span / maxTicks / 3600) * 3600;
  const out: number[] = [];
  for (let v = 0; v <= span + 1e-9; v += step) out.push(v);
  return out;
}

/** Ticks at multiples of a nice step inside [min, max]. */
export function niceTicks(min: number, max: number, maxTicks: number): number[] {
  if (!(max > min)) return [min];
  const step = niceStep(max - min, maxTicks);
  const out: number[] = [];
  for (let v = Math.ceil(min / step - 1e-9) * step; v <= max + 1e-9; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

/**
 * Heading-axis ticks: whole compass steps (10, 15, 30, 45, 90 or 180°) giving at most `maxTicks` intervals,
 * so a heading strip reads 090 / 180 / 270 rather than the decimal steps of niceTicks (0 / 200 / 400).
 */
export function angleTicks(min: number, max: number, maxTicks: number): number[] {
  if (!(max > min)) return [min];
  // Never a 360 step: every tick would read the same heading (playtest 3: a taxi that circled drew "000°" twice).
  const step = [5, 10, 15, 30, 45, 90, 180].find((s) => (max - min) / s <= maxTicks) ?? 180;
  const out: number[] = [];
  for (let v = Math.ceil(min / step - 1e-9) * step; v <= max + 1e-9; v += step) out.push(v === 0 ? 0 : v);   // no -0
  return out;
}

/** A heading-axis label for an unwrapped value: three digits, 000-359 ("000°" sits below "090°", never "360°"). */
export function headingTick(v: number): string {
  const h = ((Math.round(v) % 360) + 360) % 360;
  return `${String(h).padStart(3, '0')}°`;
}

/** Altitude and IAS jumps between two 2 Hz samples that no aircraft can make (ft, kt). */
const START_JUMP = { altFt: 300, asiKt: 25 } as const;

/**
 * Index of the first trace sample after the start settled. The recorder can take its first sample before the
 * lesson's reposition lands (the apron or the previous flight's altitude), which drew a vertical spike at 0:00
 * and stretched the altitude scale until the tolerance band was a hairline. Looks at the first few samples
 * only, so a real excursion later in the flight is never hidden.
 */
export function settledStart(channels: Partial<Record<TraceChannel, readonly number[]>>, look = 6): number {
  let first = 0;
  for (const [ch, jump] of Object.entries(START_JUMP) as [keyof typeof START_JUMP, number][]) {
    const v = channels[ch];
    if (!v) continue;
    for (let i = 0; i < Math.min(look, v.length - 1); i++) {
      if (Number.isFinite(v[i]) && Number.isFinite(v[i + 1]) && Math.abs(v[i + 1] - v[i]) > jump) first = Math.max(first, i + 1);
    }
  }
  return first;
}

/**
 * Removes 360° jumps from a heading series so a turn through north draws as one line (each sample is moved
 * by whole turns to within 180° of the previous one). NaN samples pass through and do not anchor.
 */
export function unwrapAngles(values: readonly number[]): number[] {
  const out: number[] = [];
  let prev = NaN;
  for (const v of values) {
    if (!Number.isFinite(v)) {
      out.push(v);
      continue;
    }
    const u = Number.isFinite(prev) ? prev + wrap180(v - prev) : v;
    out.push(u);
    prev = u;
  }
  return out;
}

/**
 * Value range of a strip: the data plus every target ± tolerance drawn on it, padded by 8 % and widened to
 * `minSpan` (so a perfectly held altitude does not magnify noise into a jagged line), then snapped to ticks.
 */
export function stripRange(values: readonly number[], bands: readonly { target: number; minus: number; plus: number }[], minSpan: number): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  for (const b of bands) {
    lo = Math.min(lo, b.target - b.minus);
    hi = Math.max(hi, b.target + b.plus);
  }
  if (!Number.isFinite(lo)) return [0, minSpan];
  const pad = (hi - lo) * 0.08;
  lo -= pad;
  hi += pad;
  if (hi - lo < minSpan) {
    const mid = (hi + lo) / 2;
    lo = mid - minSpan / 2;
    hi = mid + minSpan / 2;
  }
  const step = niceStep(hi - lo, 4);
  return [Math.floor(lo / step) * step, Math.ceil(hi / step) * step];
}

/** Trace channel a band's signal plots on (indicated and truth signals share a channel), or null. */
export function channelForSig(sig: SignalId): TraceChannel | null {
  switch (sig) {
    case 'altFt': case 'altMslFt': return 'altFt';
    case 'asiKt': case 'kias': return 'asiKt';
    case 'hdgDeg': case 'hdgTrueDeg': case 'trackDeg': return 'hdgDeg';
    case 'aiBankDeg': case 'bankDeg': return 'aiBankDeg';
    case 'vsiFpm': case 'vsFpm': return 'vsiFpm';
    case 'pitchDeg': case 'aiPitchDeg': return 'pitchDeg';
    case 'aglFt': case 'hafFt': return 'aglFt';
    case 'gpDevFt': return 'gpDevFt';
    case 'rwyAcrossM': return 'rwyAcrossM';
    default: return null;
  }
}

export interface StripDef { channel: TraceChannel; label: string; unit: SchoolUnit; minSpan: number; angle: boolean }

export const STRIP_DEFS: Partial<Record<TraceChannel, StripDef>> = {
  altFt: { channel: 'altFt', label: 'ALT', unit: 'ft', minSpan: 200, angle: false },
  asiKt: { channel: 'asiKt', label: 'IAS', unit: 'kt', minSpan: 20, angle: false },
  hdgDeg: { channel: 'hdgDeg', label: 'HDG', unit: 'deg', minSpan: 20, angle: true },
  aiBankDeg: { channel: 'aiBankDeg', label: 'BANK', unit: 'deg', minSpan: 20, angle: false },
  vsiFpm: { channel: 'vsiFpm', label: 'VS', unit: 'fpm', minSpan: 400, angle: false },
  gpDevFt: { channel: 'gpDevFt', label: 'GLIDE PATH', unit: 'ft', minSpan: 200, angle: false },
  rwyAcrossM: { channel: 'rwyAcrossM', label: 'CENTRELINE', unit: 'm', minSpan: 10, angle: false },
  pitchDeg: { channel: 'pitchDeg', label: 'PITCH', unit: 'deg', minSpan: 10, angle: false },
  aglFt: { channel: 'aglFt', label: 'AGL', unit: 'ft', minSpan: 200, angle: false },
};

/**
 * The (up to) four strips of the debrief graph (section 5.5): altitude, IAS, heading or bank, VS or
 * glide-path deviation. Within a pair the channel with tolerance bands wins (bank for turn lessons,
 * glide path for approaches); strips with bands come first so the graded quantities are always on top.
 */
export function chooseStrips(trace: Pick<TraceData, 'bands' | 'channels'>, max = 4): TraceChannel[] {
  const banded = new Set<TraceChannel>();
  for (const b of trace.bands) {
    const ch = channelForSig(b.sig);
    if (ch) banded.add(ch);
  }
  const hasData = (ch: TraceChannel): boolean => (trace.channels[ch] ?? []).some((v) => Number.isFinite(v));
  const groups: TraceChannel[][] = [['altFt'], ['asiKt'], ['aiBankDeg', 'hdgDeg'], ['gpDevFt', 'vsiFpm'], ['rwyAcrossM'], ['pitchDeg']];
  const picked: { ch: TraceChannel; banded: boolean; order: number }[] = [];
  groups.forEach((g, order) => {
    const withBand = g.find((ch) => banded.has(ch));
    // The last two groups only appear when graded; the first four always have a fallback, the general
    // member of a pair (heading, VS) before the specialised one (bank, glide path).
    const fallback = order < 4 ? [...g].reverse().find(hasData) : undefined;
    const ch = withBand ?? fallback;
    if (ch && hasData(ch)) picked.push({ ch, banded: !!withBand, order });
  });
  picked.sort((a, b) => Number(b.banded) - Number(a.banded) || a.order - b.order);
  return picked.slice(0, max).map((p) => p.ch);
}

// ---- Logbook ------------------------------------------------------------------------------------------------

export type LogFilter = 'all' | 'lessons' | 'free';

export interface LogbookPage {
  index: number; count: number;
  rows: LogbookEntry[];
  /** Totals of this page's rows, totals brought forward from earlier pages, and totals to date. */
  page: CareerTotals; broughtForward: CareerTotals; toDate: CareerTotals;
}

export function filterLogbook(entries: readonly LogbookEntry[], filter: LogFilter): LogbookEntry[] {
  if (filter === 'lessons') return entries.filter((e) => e.lessonId !== null);
  if (filter === 'free') return entries.filter((e) => e.lessonId === null);
  return [...entries];
}

/**
 * A paper logbook: oldest entry first, `pageSize` lines per page, each page with its own totals, the totals
 * brought forward and the totals to date (computed with the career's `totals`, so the columns can never
 * disagree with the hub). Pages are numbered from 0; an empty logbook has one empty page.
 */
export function logbookPages(
  entries: readonly LogbookEntry[],
  totalsFn: (l: readonly LogbookEntry[]) => CareerTotals,
  pageSize = 10,
): LogbookPage[] {
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  const count = Math.max(1, Math.ceil(sorted.length / pageSize));
  const pages: LogbookPage[] = [];
  for (let i = 0; i < count; i++) {
    const rows = sorted.slice(i * pageSize, (i + 1) * pageSize);
    const before = sorted.slice(0, i * pageSize);
    pages.push({
      index: i, count, rows,
      page: totalsFn(rows),
      broughtForward: totalsFn(before),
      toDate: totalsFn(sorted.slice(0, (i + 1) * pageSize)),
    });
  }
  return pages;
}

/** Logbook columns of one totals block (one row, or a page): Dual, Solo/PIC, Night, Instr, Ldg D/N. */
export function logColumns(t: CareerTotals): { dual: string; solo: string; night: string; instr: string; ldg: string } {
  return {
    dual: formatHM(t.dualS),
    solo: formatHM(t.soloS + t.picS),
    night: formatHM(t.nightS),
    instr: formatHM(t.instrumentS),
    ldg: `${t.landingsDay}/${t.landingsNight}`,
  };
}

const csvCell = (s: string): string => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** "Copy as CSV": one header line and one line per entry, oldest first. */
export function logbookCsv(entries: readonly LogbookEntry[], totalsFn: (l: readonly LogbookEntry[]) => CareerTotals): string {
  const head = ['Date', 'Type', 'Reg', 'From', 'To', 'Dual', 'Solo/PIC', 'Night', 'Instrument', 'Ldg day', 'Ldg night', 'Exercise', 'Outcome', 'Remarks', 'Signature'];
  const lines = [head.join(',')];
  for (const e of [...entries].sort((a, b) => a.date.localeCompare(b.date))) {
    const c = logColumns(totalsFn([e]));
    const t = e.times;
    lines.push(
      [e.date.slice(0, 10), e.aircraftType, e.registration, e.from, e.to, c.dual, c.solo, c.night, c.instr,
        String(t.landingsDay), String(t.landingsNight), e.exercise, outcomeLabel(e.outcome), e.remarks, e.signedBy ?? '']
        .map(csvCell).join(','),
    );
  }
  return lines.join('\n');
}
