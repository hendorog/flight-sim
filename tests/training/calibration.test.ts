// Calibration probe (spec section 6.3, wave 3): fly lessons headless with the AutoStudent and the
// NegligentStudent and write, per run, everything a calibration pass reads: the outcome and each exercise's
// grades and failing criteria, the sim time, and the instructor's full transcript with sim times, with the
// coach's remarks tagged by topic and rung and the step they were made in. It also prints a one-line summary
// per run, including the coach's unprompted remarks per minute of student flying (time in task steps with the
// student in control): the measure of "neither nags nor stays silent". Each remark carries a snapshot of the
// signals it was about. Demonstrations get smoothness figures (load factor, roll and pitch rates, stall warning,
// the longest silence of the instructor). The section 3.4 aggregation of the grades (conformanceRun.ts
// specGrades) is reported next to the engine's outcome, with every attempt.
//
// Opt-in, not part of the suite:
//   FS_CALIBRATE=L03,L04 [FS_CALIBRATE_MODES=auto,bias,osc] [FS_CALIBRATE_OUT=dir] npx vitest run tests/training/calibration
// FS_CALIBRATE=all flies every lesson and challenge. Run several processes with disjoint id lists to use the
// cores (each vitest file flies its lessons one after another).

import { describe, it } from 'vitest';
import { CHALLENGES, SYLLABUS } from '../../src/training/content/syllabus/index';
import type { Caption } from '../../src/training/types';
import { flyLesson, lesson, type FlyOptions } from './conformanceRun';
import { describeResult } from './headlessHost';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const ALL = [...SYLLABUS.map((l) => l.id), ...CHALLENGES.map((c) => c.lesson.id)];
const IDS = env.FS_CALIBRATE === 'all' ? ALL : (env.FS_CALIBRATE ?? '').split(',').filter(Boolean);
const MODES = (env.FS_CALIBRATE_MODES ?? 'auto').split(',').filter(Boolean);
const OUT = env.FS_CALIBRATE_OUT ?? 'shots/school/calibration';

/** node:fs, loaded at run time (the project builds without node's types). */
interface Fs { mkdirSync(path: string, o: { recursive: boolean }): void; writeFileSync(path: string, data: string): void }
const loadFs = async (): Promise<Fs> => (await import(/* @vite-ignore */ 'node:fs' as string)) as Fs;

const STUDENTS: Record<string, FlyOptions['student']> = {
  auto: 'auto',
  bias: { kind: 'bias', scale: 1.3 },
  osc: { kind: 'oscillate', scale: 2, periodS: 40 },
};

interface Line { t: number; actor: string; text: string; step: string; topic?: string; rung?: number; at?: Record<string, number | string | boolean> }

/** Signals worth seeing next to a remark. */
const SNAP = ['asiKt', 'altFt', 'hafFt', 'aglFt', 'vsiFpm', 'hdgDeg', 'trackDeg', 'aiBankDeg', 'ball', 'rwyAlongM', 'rwyAcrossM', 'gpDevFt', 'circuitLeg', 'flapsDeg', 'step.turnDeg'];

interface DemoStats { step: string; t0: number; durS: number; maxG: number; maxGAt?: number; minG: number; maxRollDps: number; maxRollAt?: number; maxPitchDps: number; maxPitchAt?: number; maxBank: number; stallWarnS: number; captions: number; longestSilenceS: number; lastCaptionT: number }

describe.skipIf(IDS.length === 0)('calibration probe', () => {
  for (const id of IDS) {
    for (const mode of MODES) {
      it(`${id} ${mode}`, async () => {
        const l = lesson(id);
        const captions: Caption[] = [];
        const stepAt: { t: number; step: string }[] = [];
        let lastStep = '';
        const snaps = new Map<number, Record<string, number | string | boolean>>();
        const demos: DemoStats[] = [];
        let demo: DemoStats | null = null;
        const run = await flyLesson(l, {
          student: STUDENTS[mode],
          onFrame: (h) => {
            if (!h.speech.onCaption) {
              h.speech.onCaption = (c) => {
                captions.push(c);
                if (demo) {
                  demo.captions++;
                  demo.longestSilenceS = Math.max(demo.longestSilenceS, c.atSim - demo.lastCaptionT);
                  demo.lastCaptionT = c.atSim;
                }
              };
              h.bus.on('hint', (r) => snaps.set(r.seq, Object.fromEntries(SNAP.map((k) => [k, round(h.runner.evalContext.frame[k])]))));
            }
            const ctx = h.runner.evalContext;
            const st = h.runner.currentStep;
            const pos = h.runner.position;
            const key = st ? `${pos.phaseId}/${st.def.id}` : '';
            if (key !== lastStep) {
              lastStep = key;
              stepAt.push({ t: ctx.simT, step: key });
              if (demo) {
                demo.durS = ctx.simT - demo.t0;
                demo.longestSilenceS = Math.max(demo.longestSilenceS, ctx.simT - demo.lastCaptionT);
                demos.push(demo);
                demo = null;
              }
              if (st?.def.kind === 'demo') {
                demo = { step: key, t0: ctx.simT, durS: 0, maxG: 1, minG: 1, maxRollDps: 0, maxPitchDps: 0, maxBank: 0, stallWarnS: 0, captions: 0, longestSilenceS: 0, lastCaptionT: ctx.simT };
              }
            }
            // Airborne and clear of the flare only: touchdowns and the nose coming down on the roll are not
            // the instructor's handling.
            if (demo && h.copilot.flying && ctx.frame.onGround !== true && Number(ctx.frame.aglFt) > 25) {
              const f = ctx.frame;
              const at = Math.round(ctx.simT - demo.t0);
              const g = Number(f.gLoad);
              if (g > demo.maxG) [demo.maxG, demo.maxGAt] = [g, at];
              demo.minG = Math.min(demo.minG, g);
              const roll = Math.abs(Number(f.rollRateDps));
              if (roll > demo.maxRollDps) [demo.maxRollDps, demo.maxRollAt] = [roll, at];
              const pitch = Math.abs(Number(f.pitchRateDps));
              if (pitch > demo.maxPitchDps) [demo.maxPitchDps, demo.maxPitchAt] = [pitch, at];
              demo.maxBank = Math.max(demo.maxBank, Math.abs(Number(f.bankDeg)));
              if (f.stallWarn === true) demo.stallWarnS += 1 / 30;
            }
          },
        });
        const hints = run.h.log.filter((r) => r.type === 'hint') as { seq: number; simT: number; data: { topic: string; rung: number } }[];
        const stepOf = (t: number): string => [...stepAt].reverse().find((s) => s.t <= t + 1e-6)?.step ?? '';
        // Match each remark to its caption: the first instructor caption not yet matched that starts within 5 s
        // of the remark (speech may wait for the line in progress). The caption carries the words.
        const tagged = new Map<Caption, (typeof hints)[number]>();
        for (const r of hints) {
          const c = captions.find((x) => !tagged.has(x) && x.actor !== 'student' && x.atSim >= r.simT - 0.05 && x.atSim <= r.simT + 5);
          if (c) tagged.set(c, r);
        }
        const lines: Line[] = captions.map((c) => {
          const hint = tagged.get(c);
          return { t: +c.atSim.toFixed(1), actor: c.actor, text: c.text, step: stepOf(c.atSim), ...(hint ? { topic: hint.data.topic, rung: hint.data.rung, at: snaps.get(hint.seq) } : {}) };
        });

        const studentTaskS = run.studentTaskS;
        const spec = run.spec;
        const perMin = studentTaskS > 0 ? hints.length / (studentTaskS / 60) : 0;
        const topics: Record<string, number> = {};
        for (const r of hints) topics[r.data.topic] = (topics[r.data.topic] ?? 0) + 1;
        const report = {
          lesson: id, mode, outcome: run.result?.outcome ?? null, specOutcome: spec.outcome, specGrades: spec.grades,
          attempts: run.attempts.map((a) => `${a.ex}#${a.run} grade=${a.r.grade} ${a.r.criteria.filter((c) => c.required && (c.grade === null || c.grade < 2)).map((c) => `${c.id}=${c.grade} (${c.detail})`).join('; ')}`),
          stars: run.result?.stars ?? null, simS: Math.round(run.simS),
          studentTaskMin: +(studentTaskS / 60).toFixed(1), remarks: hints.length, remarksPerMin: +perMin.toFixed(2), topics,
          interventions: run.interventions, crashes: run.crashes, demos: run.demos,
          result: describeResult(run.result),
          exercises: run.result?.exercises.map((e) => ({ id: e.exerciseId, grade: e.grade, test: e.testGrade, attempts: e.attempts,
            criteria: e.criteria.map((c) => `${c.required ? '' : '(opt) '}${c.id}=${c.grade} ${c.detail ?? ''}`) })),
          demoStats: demos.map((d) => ({ ...d, durS: Math.round(d.durS), maxG: round(d.maxG), minG: round(d.minG), maxRollDps: round(d.maxRollDps), maxPitchDps: round(d.maxPitchDps), maxBank: round(d.maxBank), stallWarnS: round(d.stallWarnS), longestSilenceS: round(d.longestSilenceS), t0: round(d.t0), lastCaptionT: undefined })),
          transcript: lines,
        };
        const fs = await loadFs();
        fs.mkdirSync(OUT, { recursive: true });
        fs.writeFileSync(`${OUT}/${id}-${mode}.json`, JSON.stringify(report, null, 1));
        console.log(`CAL ${id} ${mode} ${report.outcome} spec=${spec.outcome} stars=${report.stars} sim=${report.simS}s studentTask=${report.studentTaskMin}min remarks=${hints.length} (${report.remarksPerMin}/min) ${JSON.stringify(topics)} interventions=${run.interventions.length} crashes=${run.crashes.length} demos=${run.demos.join('/')}`);
      }, 900_000);
    }
  }
});

function round(x: unknown): number | string | boolean {
  return typeof x === 'number' ? Math.round(x * 10) / 10 : (x as string | boolean);
}
