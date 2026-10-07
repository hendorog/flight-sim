// Content: how much the instructor says while an ab-initio student flies (owner playtest: "There is no feedback
// from the instructor while the lesson is in progress"). Flies stage-1 lessons headless with the AutoStudent and
// counts the instructor's captions that start while the student has control in an active task: the brief, the
// running instruction (start, milestones, success, nudges) and the coach. Target for a normal student, ab initio:
// 1.5-3 remarks per minute of student flying (it was about 0.16 with the coach alone).
// Opt-in (it flies whole lessons): FS_CONFORMANCE=1 or FS_REMARKS=1; FS_REMARKS=L03 measures one lesson.

import { describe, expect, it } from 'vitest';
import { LINES } from '../../src/training/content/lines';
import { lessonById } from '../../src/training/content/syllabus/index';
import { flyLesson, LESSON_TIMEOUT_MS } from './conformanceRun';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const pick = env.FS_REMARKS && env.FS_REMARKS !== '1' ? env.FS_REMARKS.split(',') : null;
const ON = env.FS_CONFORMANCE === '1' || env.FS_REMARKS !== undefined;
const IDS = pick ?? ['L01', 'L03', 'L04', 'L05', 'L06', 'L07', 'L08'];

describe('ab-initio talk: instructor remarks per minute of student flying', () => {
  for (const id of IDS) {
    const run = ON ? it : it.skip;
    run(`${id}`, async () => {
      const l = lessonById(id)!;
      const flying: [number, boolean][] = [];
      const r = await flyLesson(l, {
        onFrame: (h) => {
          const st = h.runner.currentStep;
          flying.push([h.runner.evalContext.simT, st?.def.kind === 'task' && st.status === 'active' && h.runner.authority.who === 'student']);
        },
      });
      const at = (t: number): boolean => {
        let lo = 0;
        let hi = flying.length - 1;
        while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (flying[mid][0] <= t) lo = mid; else hi = mid - 1; }
        return flying[lo]?.[1] ?? false;
      };
      const said = r.h.speech.transcript.filter((c) => c.actor === 'instructor' && at(c.atSim));
      // Remarks: everything she says while the student flies except the task brief and the handover calls
      // (the instruction the student is given, not commentary on how it is going).
      const briefs = new Set(l.flow.flatMap((p) => p.steps).flatMap((st) => (st.kind === 'task' ? [st.brief] : []))
        .flatMap((b) => { const x = typeof b === 'string' ? LINES[b] : 'id' in b ? LINES[b.id] : b; return x ? [x.text].flat() : []; })
        .map((t) => t.split('{')[0].slice(0, 18)));
      const isBrief = (t: string): boolean => /^(You have control|I have control)/.test(t) || [...briefs].some((b) => b.length > 3 && t.startsWith(b));
      const remarks = said.filter((c) => !isBrief(c.text));
      const perMin = r.studentTaskS > 0 ? remarks.length / (r.studentTaskS / 60) : 0;
      const lines = said.map((c) => `  ${c.atSim.toFixed(0).padStart(5)}s ${isBrief(c.text) ? '  (brief)' : ''} ${c.text}`).join('\n');
      // eslint-disable-next-line no-console
      const starts = remarks.filter((c) => /^(Go ahead|Eyes on|Your aircraft)/.test(c.text)).length;
      console.log(`${id}: ${remarks.length} remarks (${starts} of them start lines; ${said.length} lines in all) in ${(r.studentTaskS / 60).toFixed(1)} min of student flying = ${perMin.toFixed(2)}/min, ${((remarks.length - starts) / (r.studentTaskS / 60)).toFixed(2)}/min without the start lines `
        + `(coach hints ${r.hints.length}, limit interventions ${r.interventions.filter((x) => (x as { kind?: string }).kind === 'limit').length}, outcome ${r.result?.outcome})\n${lines}`);
      expect(perMin).toBeGreaterThanOrEqual(1);
    }, LESSON_TIMEOUT_MS);
  }
});
