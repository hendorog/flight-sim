// Flight School home (section 5.1): a 360 px card on the left over the paused sim (continue card, career
// track, hours, navigation) and a licence preview in the top-right corner. Enter briefs the next lesson,
// Esc returns to free flight.

import type { AuthorityId, Lesson, StartSpec, TrainingSave } from '../../training/types';
import { el } from '../dom';
import { COURSE_MINIMUMS, daysBetween, formatDate, formatHours, formatNumber, initials, starString } from './format';
import { bareKey, button, type ScreenCtx, type ScreenView } from './widgets';

/** Course stages as the hub groups them (navigation and the skill test share the last stage). */
export const STAGES: { id: string; title: string; of: Lesson['stage'][] }[] = [
  { id: 'handling', title: 'Handling', of: ['handling'] },
  { id: 'circuits', title: 'Circuits', of: ['circuits'] },
  { id: 'advanced', title: 'Advanced', of: ['advanced'] },
  { id: 'navigation', title: 'Nav & test', of: ['navigation', 'test'] },
];

const KIND_WORDS: Record<Lesson['kind'], string> = { dual: 'Dual', solo: 'Solo', check: 'Progress check', test: 'Skill test' };

export function kindWord(k: Lesson['kind']): string {
  return KIND_WORDS[k];
}

/** The lesson's syllabus reference under the session's authority ("EASA Ex 7 & 8"). */
export function lessonRef(l: Lesson, a: AuthorityId): string {
  return a === 'easa' ? `EASA ${l.syllabusRef.easa}` : l.syllabusRef.faa;
}

const SPOTS: Record<string, string> = { parking: 'on the apron', holdA1: 'at holding point A1', holdA2: 'at holding point A2', lineup07: 'lined up on runway 07' };
const AREAS: Record<string, string> = { trainingArea: 'over the training area', fieldOverhead: 'overhead the field', pflHighKey: 'at the high key' };

/** Where a lesson starts, in words ("Starts at 2,500 ft over the training area"). */
export function startText(s: StartSpec): string {
  switch (s.kind) {
    case 'scenario':
      return `Starts from the ${s.id} scenario`;
    case 'ground':
      return `Starts ${SPOTS[s.spot] ?? s.spot}${s.engine === 'cold' ? ', cold and dark' : ', engine running'}`;
    case 'air': {
      const where = typeof s.at === 'string' ? AREAS[s.at] ?? s.at : 'in the local area';
      return `Starts at ${formatNumber(s.altFt)} ft${s.altRef === 'field' ? ' above the field' : ''} ${where}`;
    }
    case 'final':
      return `Starts on a ${s.distNm} NM final for runway 07`;
    case 'circuit':
      return `Starts on the ${s.leg} leg for runway 07`;
    case 'attitude':
      return `Starts at ${formatNumber(s.altFt)} ft ${AREAS[s.at] ?? ''}`.trim();
  }
}

function hasEndorsement(save: TrainingSave, id: string): boolean {
  return save.endorsements.some((e) => e.id === id);
}

export function renderHome(parent: HTMLElement, sc: ScreenCtx): ScreenView {
  const wrap = el('div', 'sc-home-wrap', parent);
  const card = el('div', 'card sc-home', wrap);
  const { career, deps } = sc;
  const save = career.save;

  const brand = el('div', 'sc-home-brand', card);
  brand.innerHTML = `<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="15" fill="rgba(82,195,255,.14)" stroke="#52c3ff" stroke-width="1.2"/>
    <path d="M4 17 L14 15 L16 11 L18 15 L28 17 L18 18 L17 23 L20 25 L12 25 L15 23 L14 18 Z" fill="#eef3f8"/></svg>`;
  const bt = el('div', '', brand);
  el('b', '', bt, 'KFBL Flight Training');
  el('span', '', bt, save ? `${save.profile.studentName} · instructor ${save.profile.instructorName}` : 'Private pilot course');

  banners(card, sc);

  let next: Lesson | null = null;
  if (!save) {
    const c = el('div', 'sc-continue', card);
    el('div', 'sc-kicker', c, 'Welcome');
    el('h3', '', c, 'Start your training record');
    el('div', 'sc-ref', c, 'Choose your name, the training standard and the instructor voice.');
    el('div', 'sc-meta', c);
    button(c, 'Begin', () => sc.go('welcome'), { cls: 'primary', key: 'Enter' });
  } else {
    next = deps.nextLesson(save, career.syllabus, career.authority);
    continueCard(card, sc, save, next);
    track(card, sc, save);
  }

  const nav = el('div', 'sc-nav', card);
  button(nav, 'Syllabus', () => sc.go('syllabus'));
  button(nav, 'Challenges', () => sc.go('challenges'));
  button(nav, 'Logbook', () => sc.go('logbook'));
  button(nav, 'Licence', () => sc.go('licence'));
  button(nav, 'Settings', () => sc.go('settings'));
  button(nav, 'Free flight', () => sc.send({ kind: 'closeSchool' }), { key: 'Esc' });

  if (save) licenceMini(wrap, sc, save);

  return {
    root: wrap,
    onKey(e) {
      if (bareKey(e, 'Enter', 'NumpadEnter')) {
        if (!save) sc.go('welcome');
        else if (next) sc.send({ kind: 'openLesson', lessonId: next.id });
        return true;
      }
      if (bareKey(e, 'Escape')) {
        sc.send({ kind: 'closeSchool' });
        return true;
      }
      return false;
    },
  };
}

function banners(card: HTMLElement, sc: ScreenCtx): void {
  const { career } = sc;
  const ac = career.aircraft;
  if (ac && !ac.supported) {
    const b = el('div', 'sc-banner', card);
    el('span', '', b, `You are flying the ${ac.flown.name}. Lessons are flown in the ${ac.school.name}.`);
    button(b, `Fly the ${ac.school.name}`, () => sc.send({ kind: 'switchAircraft', aircraftId: ac.school.id }));
  }
  if (career.storage === 'memoryOnly' || career.storage === 'unavailable') {
    const b = el('div', 'sc-banner', card);
    el('span', '', b, 'Progress can’t be saved in this browser; use Export in Settings to keep it.');
  } else if (career.storage === 'readOnly') {
    const b = el('div', 'sc-banner', card);
    el('span', '', b, 'This training record was written by a newer version: it is read-only here.');
  }
  if (career.resume) {
    const r = career.resume;
    const b = el('div', 'sc-banner info', card);
    el('span', '', b, `Resume ${r.title} from the last checkpoint.`);
    button(b, 'Resume', () => sc.send({ kind: 'openLesson', lessonId: r.lessonId }));
  }
  const save = career.save;
  const last = save?.logbook.reduce<string | null>((m, e) => (!m || e.date > m ? e.date : m), null);
  const now = career.now ?? new Date();
  if (save && last && daysBetween(last, now) > 30) {
    const circuits = career.syllabus.find((l) => l.id === 'L10');
    const b = el('div', 'sc-banner info', card);
    el('span', '', b, `Currency: ${daysBetween(last, now)} days since your last flight. Three circuits would be a good start.`);
    if (circuits) button(b, 'Circuits', () => sc.send({ kind: 'openLesson', lessonId: circuits.id }));
  }
}

function continueCard(card: HTMLElement, sc: ScreenCtx, save: TrainingSave, next: Lesson | null): void {
  const c = el('div', 'sc-continue', card);
  if (!next) {
    el('div', 'sc-kicker', c, 'Course complete');
    el('h3', '', c, 'Every lesson is signed off');
    el('div', 'sc-ref', c, 'Keep current with the challenges, or fly any lesson again from the syllabus.');
    el('div', 'sc-meta', c);
    button(c, 'Syllabus', () => sc.go('syllabus'), { cls: 'primary', key: 'Enter' });
    return;
  }
  const a = sc.career.authority;
  const prog = save.progress[next.id];
  el('div', 'sc-kicker', c, prog?.attempts ? 'Continue' : 'Next lesson');
  el('h3', '', c, `Lesson ${next.number}: ${next.title}`);
  el('div', 'sc-ref', c, `${lessonRef(next, a)} · ${kindWord(next.kind)} · about ${next.estMinutes} min`);
  el('div', 'sc-ref', c, `${startText(next.start)}.`);
  const meta = el('div', 'sc-meta', c);
  el('span', '', meta, prog?.attempts ? `${prog.attempts} attempt${prog.attempts === 1 ? '' : 's'} so far` : 'First attempt');
  el('span', 'sc-stars', meta, starString(prog?.bestStars ?? 0));
  button(c, 'Brief', () => sc.send({ kind: 'openLesson', lessonId: next.id }), { cls: 'primary', key: 'Enter' });
}

function track(card: HTMLElement, sc: ScreenCtx, save: TrainingSave): void {
  const { career, deps } = sc;
  const statuses = deps.lessonStatuses(save, career.syllabus, career.authority);
  const t = el('div', 'sc-track', card);
  for (const s of STAGES) {
    const lessons = career.syllabus.filter((l) => s.of.includes(l.stage));
    if (lessons.length === 0) continue;
    const done = lessons.filter((l) => statuses[l.id] === 'competent').length;
    const row = el('div', 'sc-stage', t);
    el('span', '', row, s.title);
    const bar = el('div', 'bar', row);
    el('i', '', bar).style.width = `${(done / lessons.length) * 100}%`;
    el('b', '', row, `${done}/${lessons.length}`);
  }
  const ms = el('div', 'sc-milestones', t);
  for (const [id, text] of [['firstSolo', 'First solo'], ['ppl', 'Licence'], ['night', 'Night']] as const) {
    const m = el('div', `sc-ms${hasEndorsement(save, id) ? ' done' : ''}`, ms);
    el('i', '', m);
    el('span', '', m, text);
  }
  const rank = el('div', 'sc-rank', t, 'Rank: ');
  el('b', '', rank, deps.rank(save, career.authority));

  const tot = deps.totals(save.logbook);
  const min = COURSE_MINIMUMS[career.authority];
  const h = el('div', 'sc-hours', card);
  h.innerHTML = `Course hours <b>${formatHours(tot.totalS)}</b> (dual ${formatHours(tot.dualS)}, solo ${formatHours(tot.soloS + tot.picS)}).
    Minimum ${min.totalH} h with ${min.dualH} dual and ${min.soloH} solo. Simulation; not creditable.`;
}

function licenceMini(wrap: HTMLElement, sc: ScreenCtx, save: TrainingSave): void {
  const { career, deps } = sc;
  const m = el('div', 'card sc-licence-mini', wrap);
  m.title = 'Open the licence';
  m.style.cursor = 'pointer';
  m.addEventListener('click', () => sc.go('licence'));
  el('div', 'sc-avatar', m, initials(save.profile.studentName));
  el('b', '', m, save.profile.studentName);
  el('span', '', m, deps.rank(save, career.authority));
  const tot = deps.totals(save.logbook);
  const stats = el('div', 'sc-mini-stats', m);
  const stat = (label: string, v: string): void => {
    const d = el('div', '', stats);
    el('b', '', d, v);
    el('span', '', d, label);
  };
  stat('Total time', formatHours(tot.totalS));
  stat('Landings', String(tot.landingsDay + tot.landingsNight));
  const last = save.logbook.reduce<string | null>((x, e) => (!x || e.date > x ? e.date : x), null);
  stat('Last flight', last ? formatDate(last) : '—');
}
