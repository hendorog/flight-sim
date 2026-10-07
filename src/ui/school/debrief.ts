// Debrief (section 5.5), modal with the sim paused: outcome, stars and flags; the instructor's points; the
// exercise accordion with criterion rows (a click highlights the band and worst point in the graph); the
// trace graph; the ground track for circuit, forced-landing and navigation lessons; the logbook line.
// A milestone (first solo, licence, night) shows a ceremony card first.

import type { Criterion, CriterionResult, DebriefModel, ExerciseResult, Lesson, LogbookEntry, SignalId } from '../../training/types';
import { el } from '../dom';
import {
  authorityName, endorsementTitle, formatClock, formatDate, formatHM, formatSigned, formatTol, formatValue, gradeName,
  isHeadingSig, outcomeLabel, outcomeTone, patternNote, sigUnit, starString,
} from './format';
import { TraceGraph } from './traceGraph';
import { TrackMap } from './trackMap';
import { badge, bareKey, button, gradePip, section, type ScreenCtx, type ScreenView } from './widgets';

const MILESTONE_TEXT: Record<string, { seal: string; title: string; text: string }> = {
  firstSolo: { seal: 'SOLO', title: 'First solo', text: 'One circuit, alone. Every pilot remembers this one. Your logbook carries the stamp.' },
  ppl: { seal: 'PPL', title: 'Skill test passed', text: 'Congratulations: the examiner has signed you off. Your licence card is updated.' },
  night: { seal: 'NIGHT', title: 'Night qualification', text: 'Ten night landings logged with a competent night lesson.' },
};

/** Every criterion definition of a lesson by id (to find the signal a result was measured on). */
export function criterionDefs(lesson: Lesson): Map<string, Criterion> {
  const out = new Map<string, Criterion>();
  for (const p of lesson.flow) for (const s of p.steps) if (s.kind === 'task') for (const c of s.criteria) out.set(c.id, c);
  return out;
}

/** Lessons whose debrief shows the ground track. */
export function showsTrack(l: Lesson): boolean {
  return !!l.route || l.stage === 'circuits' || l.stage === 'test' || l.id === 'N1' || ['circuit', 'pfl', 'landingZone'].includes(l.briefing.diagram?.kind ?? '');
}

/** Weighted mean of the graded exercises (weights from the lesson), as a grade word; null if none graded. */
/**
 * Weighted mean of the graded exercises. `passed` false (not yet competent, a fail...): the word is capped at
 * grade 2, since "Good" beside "Not yet competent" contradicts the outcome (release playtest); the number stays.
 */
export function impression(lesson: Lesson, exercises: readonly ExerciseResult[], passed = true): string | null {
  let sw = 0;
  let s = 0;
  for (const r of exercises) {
    const w = lesson.exercises.find((e) => e.id === r.exerciseId)?.weight ?? 0;
    if (r.grade === null || w <= 0) continue;
    sw += w;
    s += w * r.grade;
  }
  if (sw === 0) return null;
  const mean = s / sw;
  const g = Math.max(1, Math.min(passed ? 4 : 2, Math.round(mean))) as 1 | 2 | 3 | 4;
  return `${gradeName(g)} (${mean.toFixed(1)} of 4)`;
}

export interface DebriefOptions {
  /** Opened from the logbook: no lesson buttons; Esc / Back returns there. */
  readOnly?: { back(): void };
}

export function renderDebrief(parent: HTMLElement, sc: ScreenCtx, m: DebriefModel, opts: DebriefOptions = {}): ScreenView {
  const scrim = el('div', 'scrim', parent);
  let graph: TraceGraph | null = null;
  let ceremony = !!m.milestone && !opts.readOnly;
  let retryOpen = false;
  // Enter takes the obvious next step: the next lesson after a pass, the same lesson again otherwise (a
  // crash or "not yet" never offers moving on as the default).
  const passed = m.result.outcome === 'competent' || m.result.outcome === 'testPass';

  const view: ScreenView = {
    root: scrim,
    onKey(e) {
      if (ceremony) {
        if (bareKey(e, 'Enter', 'NumpadEnter', 'Escape')) {
          ceremony = false;
          render();
          return true;
        }
        return false;
      }
      if (opts.readOnly) {
        if (bareKey(e, 'Escape')) {
          opts.readOnly.back();
          return true;
        }
        return false;
      }
      if (bareKey(e, 'Enter', 'NumpadEnter')) {
        if (passed && m.nextLessonId) sc.send({ kind: 'nextLesson' });
        else if (!passed) sc.send({ kind: 'flyAgain' });
        else return false;
        return true;
      }
      if (bareKey(e, 'KeyR')) {
        sc.send({ kind: 'flyAgain' });
        return true;
      }
      if (bareKey(e, 'Escape')) {
        sc.send({ kind: 'home' });
        return true;
      }
      return false;
    },
    dispose() {
      graph?.dispose();
    },
  };

  const render = (): void => {
    graph?.dispose();
    graph = null;
    scrim.replaceChildren();
    if (ceremony && m.milestone) {
      const t = MILESTONE_TEXT[m.milestone] ?? { seal: '★', title: endorsementTitle(m.milestone), text: 'A new endorsement in your logbook.' };
      const card = el('div', 'card sc-ceremony', scrim);
      el('div', 'sc-seal', card, t.seal);
      el('h2', '', card, t.title);
      el('p', '', card, t.text);
      button(card, 'Continue to the debrief', () => {
        ceremony = false;
        render();
      }, { cls: 'primary', key: 'Enter' });
      return;
    }
    const card = el('div', 'card sc-card sc-wide', scrim);
    buildHead(card);
    const body = el('div', 'sc-body', card);
    const grid = el('div', 'sc-debrief', body);
    const left = el('div', '', grid);
    const right = el('div', '', grid);
    buildPoints(left);
    buildExercises(left, right);
    buildFoot(card);
    // Canvas layouts need the card in the document (its width).
    requestAnimationFrame(() => {
      graph?.render();
      graph?.onCursor?.(null);
    });
  };

  const buildHead = (card: HTMLElement): void => {
    const r = m.result;
    const head = el('div', 'sc-head', card);
    const t = el('div', 'sc-titles', head);
    el('div', 'sc-kicker', t, `Debrief · Lesson ${m.lesson.number}: ${m.lesson.title}`);
    const top = el('div', 'sc-deb-top', t);
    el('div', `sc-outcome ${outcomeTone(r.outcome)}`, top, outcomeLabel(r.outcome));
    if (r.stars > 0) el('div', 'sc-stars big', top, starString(r.stars));
    const imp = impression(m.lesson, r.exercises, r.outcome === 'competent' || r.outcome === 'testPass');
    el('p', 'sc-sub', t, `${formatDate(r.endedAt)} · ${r.weatherLine}${imp ? ` · Overall impression: ${imp}` : ''}`);
    const right = el('div', 'sc-badges', head);
    badge(right, authorityName(r.authority));
    if (r.flags.calmAir) badge(right, 'Calm air', 'warn');
    if (r.phaseRetries > 0) badge(right, `${r.phaseRetries} ${r.phaseRetries === 1 ? 'retry' : 'retries'}`, 'warn');
    if (r.interventions > 0) badge(right, `${r.interventions} intervention${r.interventions === 1 ? '' : 's'}`, 'bad');
    const lim = r.limitInterventions ?? 0;
    if (lim > 0) badge(right, `Instructor took control ${lim === 1 ? 'once' : `${lim} times`} (lesson limits)`, 'warn');
    if (r.flags.kbdAssists) badge(right, 'Kbd assists', 'dim');
    if (!r.flags.instructorSaves && m.lesson.kind === 'dual') badge(right, 'Saves off', 'dim');
    if (sc.deps.playDebrief && r.debrief.spoken.length) {
      const p = button(right, '▶ Play', () => sc.deps.playDebrief?.(r.debrief.spoken), { title: 'Hear the debrief again' });
      p.style.padding = '4px 10px';
      p.style.fontSize = '12px';
    }
  };

  const buildPoints = (left: HTMLElement): void => {
    const d = m.result.debrief;
    section(left, 'Instructor');
    const pts = el('div', 'sc-points', left);
    for (const [cls, label, text] of [['strength', 'Strength', d.strength], ['main', 'Main point', d.main], ['next', 'Next time', d.next]] as const) {
      if (!text) continue;
      const row = el('div', `sc-point ${cls}`, pts);
      el('span', '', row, label);
      el('div', '', row, text);
    }
  };

  const buildExercises = (left: HTMLElement, right: HTMLElement): void => {
    const defs = criterionDefs(m.lesson);
    section(left, 'Exercises');
    const graded = m.result.exercises.filter((x) => x.mode !== 'demo' || x.criteria.length > 0);
    let selectedRow: HTMLElement | null = null;
    graded.forEach((x, i) => {
      const box = el('div', `sc-ex${i === firstToOpen(graded) ? ' open' : ''}`, left);
      const hb = el('button', '', box);
      hb.tabIndex = -1;
      const tt = el('div', '', hb);
      el('b', '', tt, x.title);
      const bits = [x.mode === 'assessed' ? 'Assessed' : x.mode === 'practice' ? 'Practice' : 'Demonstration', `${x.standard} standard`];
      if (x.attempts > 1) bits.push(`${x.attempts} attempts`);
      if (x.interventions > 0) bits.push(`${x.interventions} intervention${x.interventions === 1 ? '' : 's'}`);
      const xl = x.limitInterventions ?? 0;
      if (xl > 0) bits.push(`instructor took control ${xl === 1 ? 'once' : `${xl} times`} (limits)`);
      if (x.faults.length) bits.push(`${x.faults.length} fault${x.faults.length === 1 ? '' : 's'}`);
      el('small', '', tt, bits.join(' · '));
      gradePip(hb, x.grade);
      gradePip(hb, x.testGrade, true);
      hb.addEventListener('click', () => box.classList.toggle('open'));
      const crit = el('div', 'sc-crit', box);
      // Faults with a description (the global rules: flap above the white arc), with the value reached.
      for (const f of x.faults) {
        if (!f.detail) continue;
        const kind = f.failsItem ? 'Fault, item failed' : f.severity === 'minor' ? 'Minor fault' : f.severity === 'major' ? 'Major fault' : 'Critical fault';
        const row = el('div', `sc-fault${f.failsItem || f.severity !== 'minor' ? ' bad' : ''}`, crit);
        el('b', '', row, `${kind}: `);
        el('span', '', row, f.detail);
      }
      if (x.criteria.length === 0) {
        el('div', 'sc-foot-note', crit, 'Nothing graded in this exercise.');
        return;
      }
      const t = el('table', 'sc-table', crit);
      const hr = el('tr', '', el('thead', '', t));
      for (const [s, r] of [['Item', false], ['Target', true], ['Worst', true], ['Within', true], ['', true]] as const) el('th', r ? 'r' : '', hr, s);
      const tb = el('tbody', '', t);
      for (const c of orderCriteria(x.criteria)) {
        const def = defs.get(c.id);
        const tr = el('tr', '', tb);
        criterionRow(tr, c, def?.sig);
        tr.addEventListener('click', () => {
          selectedRow?.classList.remove('sel');
          const same = selectedRow === tr;
          selectedRow = same ? null : tr;
          if (!same) tr.classList.add('sel');
          graph?.select(!same && def?.sig ? { sig: def.sig, target: c.target, worst: c.worst } : null);
        });
      }
    });
    if (graded.length === 0) el('div', 'sc-empty', left, 'No exercises were graded in this flight.');

    section(right, 'Flight trace');
    if (m.trace) {
      graph = new TraceGraph(right, m.trace, m.bestTrace);
      if (showsTrack(m.lesson)) {
        // Under the exercises, so the graph and the track are both in view on a laptop screen.
        section(left, 'Ground track');
        const map = new TrackMap(left, m.trace, m.lesson.route ?? null);
        graph.onCursor = (t) => map.setCursor(t);
      }
    } else el('div', 'sc-empty', right, 'No trace was recorded for this flight.');

    if (m.logbookPreview) {
      section(right, 'Logbook');
      logLine(right, m.logbookPreview);
    }
  };

  const buildFoot = (card: HTMLElement): void => {
    const foot = el('div', 'sc-foot', card);
    if (opts.readOnly) {
      button(foot, 'Back to the logbook', () => opts.readOnly!.back(), { key: 'Esc' });
      return;
    }
    button(foot, 'Home', () => sc.send({ kind: 'home' }), { key: 'Esc' });
    if (m.retryPhases.length) {
      const wrap = el('div', '', foot);
      wrap.style.position = 'relative';
      button(wrap, 'Try one exercise again…', () => {
        retryOpen = !retryOpen;
        list.classList.toggle('hidden', !retryOpen);
      });
      const list = el('div', `card sc-retry-list${retryOpen ? '' : ' hidden'}`, wrap);
      list.style.cssText += 'position:absolute;bottom:calc(100% + 8px);left:0;min-width:260px;padding:8px;';
      for (const p of m.retryPhases) button(list, p.title, () => sc.send({ kind: 'retryPhase', phaseId: p.phaseId }));
    }
    el('div', 'sc-spacer', foot);
    if (passed) {
      button(foot, 'Fly it again', () => sc.send({ kind: 'flyAgain' }), { key: 'R' });
      if (m.nextLessonId) button(foot, 'Next lesson', () => sc.send({ kind: 'nextLesson' }), { cls: 'primary', key: 'Enter' });
    } else {
      if (m.nextLessonId) button(foot, 'Next lesson', () => sc.send({ kind: 'nextLesson' }));
      button(foot, 'Fly it again', () => sc.send({ kind: 'flyAgain' }), { cls: 'primary', key: 'Enter' });
    }
  };

  render();
  return view;
}

/** Safety items first (section 3.4), then required, then the rest, keeping the lesson's order. */
function orderCriteria(cs: readonly CriterionResult[]): CriterionResult[] {
  const rank = (c: CriterionResult): number => (c.safety ? 0 : c.required ? 1 : 2);
  return [...cs].map((c, i) => ({ c, i })).sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i).map((x) => x.c);
}

/** Open the first exercise that needs attention (lowest grade), else the first one. */
function firstToOpen(xs: readonly ExerciseResult[]): number {
  let best = 0;
  xs.forEach((x, i) => {
    if ((x.grade ?? 5) < (xs[best].grade ?? 5)) best = i;
  });
  return best;
}

function criterionRow(tr: HTMLElement, c: CriterionResult, sig: SignalId | undefined): void {
  const unit = sigUnit(sig);
  const name = el('td', '', tr);
  name.appendChild(document.createTextNode(c.label));
  if (c.safety) el('span', 'safety', name, '  SAFETY');
  // A one-sided peak (the taxi speed's maximum) that went beyond is an overshoot, not a slow settle.
  const note = c.kind === 'peak' && c.pattern === 'late' ? 'Went beyond the limit' : patternNote(c.pattern);
  el('small', '', name, note || (c.required ? '' : 'Not required'));
  name.title = c.detail;

  const tgt = el('td', 'r', tr, c.target !== undefined ? formatValue(c.target, unit, isHeadingSig(sig)) : '—');
  if (c.tol) el('small', '', tgt, formatTol(c.tol, unit));

  const worst = el('td', 'r', tr, c.worst ? formatSigned(c.worst.dev, unit) : '—');
  if (c.worst) el('small', '', worst, `at ${formatClock(c.worst.atS)}`);

  el('td', 'r', tr, c.kind === 'hold' ? `${Math.round(c.within * 100)} %` : '');
  const g = el('td', 'r', tr);
  g.style.whiteSpace = 'nowrap';
  gradePip(g, c.grade);
  g.appendChild(document.createTextNode(' '));
  gradePip(g, c.testGrade, true);
}

/** One logbook line in the paper style (the debrief's preview). */
export function logLine(parent: HTMLElement, e: LogbookEntry): HTMLElement {
  const paper = el('div', 'sc-paper sc-logline', parent);
  const t = el('table', '', paper);
  const hr = el('tr', '', el('thead', '', t));
  for (const [h, r] of [['Date', false], ['Aircraft', false], ['Role', false], ['Time', true], ['Ldg', true], ['Exercise', false], ['Signature', false]] as const) el('th', r ? 'r' : '', hr, h);
  const tr = el('tr', '', el('tbody', '', t));
  el('td', '', tr, formatDate(e.date));
  el('td', '', tr, `${e.aircraftType} ${e.registration}`);
  el('td', '', tr, e.role.toUpperCase());
  el('td', 'r', tr, formatHM(e.times.blockS));
  el('td', 'r', tr, `${e.times.landingsDay + e.times.landingsNight}`);
  const ex = el('td', 'sc-ex-cell', tr, e.exercise);
  ex.title = e.exercise;
  const sig = el('td', '', tr);
  if (e.signedBy) el('span', 'sc-sign', sig, e.signedBy);
  if (e.stamp) el('span', 'sc-stamp', sig, e.stamp);
  return paper;
}
