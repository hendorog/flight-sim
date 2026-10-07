// The per-type conformance suite: describeAircraft(targets) registers the blocks of plan.ts as tests, one test per
// item, each printing "[conformance] <id> <item>: measured <value> | <band> (<source>)".
//
// Tiers. Quick blocks run in every `vitest run` (trims and short flights). Flown blocks (stalls, ground rolls,
// cruise and the climb table, systems, the flown engine cut) run when FS_AIRCRAFT names the type or is 'all'
// (FS_AIRCRAFT=c172s, FS_AIRCRAFT=pa34,da42). Each block measures once, in its first item; every item has the
// block's time limit (the gate runs on every core).
//
// describeBlocks(id, blocks) registers any list of blocks: testbed.test.ts runs the twin, systems and castering
// blocks on the synthetic test-beds of tests/fixtures with it.

import { beforeAll, describe, expect, it, type TestContext } from 'vitest';
import type { AircraftDefinition } from '../../src/aircraft/types';
import { loadAircraft } from '../../src/aircraft/registry';
import { OPEN_REQUESTS } from './requests';
import { conformancePlan, describeLimit, judge, num, within, type CheckResult, type PlanBlock } from './plan';
import type { ConformanceTargets, Limit } from './targets';

export { describeLimit, judge, within } from './plan';

/** Time limit of the items of a quick block, ms. */
const QUICK_MS = 120_000;
/** Time limit of the items of a flown block, ms. */
const FLOWN_MS = 300_000;

/** True when FS_AIRCRAFT selects the flown tier of `id`. */
export function flownTier(id: string): boolean {
  const v = ((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {}).FS_AIRCRAFT;
  if (!v) return false;
  const ids = v.split(',').map((s) => s.trim());
  return ids.includes('all') || ids.includes(id);
}

/** One measured item as a test. `open`: the open request ids (tests of the suite pass their own). */
export function item(id: string, label: string, value: () => number, limitOf: Limit | (() => Limit), unit: string, timeout: number, open: readonly string[] = OPEN_REQUESTS): void {
  it(label, (ctx: TestContext) => {
    // A limit that depends on the definition is given as a function (the test names are made before it loads).
    const limit = typeof limitOf === 'function' ? limitOf() : limitOf;
    const m = value();
    const line = `[conformance] ${id} ${label}: measured ${num(m)} ${unit} | ${describeLimit(limit, unit)}`;
    console.log(line);
    const verdict = judge(m, limit, open);
    if (verdict === 'skip') ctx.skip(`blocked by ${limit.blockedBy}: measured ${num(m)} ${unit} (${within(m, limit) ? 'met' : 'not met'})`);
    expect(verdict, line).toBe('pass');
  }, timeout);
}

/** One yes / no item as a test. */
function flag(id: string, label: string, value: () => boolean, timeout: number): void {
  it(label, () => {
    const ok = value();
    console.log(`[conformance] ${id} ${label}: ${ok ? 'yes' : 'NO'}`);
    expect(ok, label).toBe(true);
  }, timeout);
}

/** One item that judges itself (Vmca, left against right). */
function check(label: string, run: () => CheckResult, timeout: number): void {
  it(label, (ctx: TestContext) => {
    const r = run();
    console.log(r.line);
    if (r.verdict === 'skip') ctx.skip(r.note);
    expect(r.verdict, r.line).toBe('pass');
  }, timeout);
}

/**
 * Register blocks as describe blocks of tests: a quick block always, a flown block when FS_AIRCRAFT selects
 * `tierId` (default `id`). `id` names the type in the printed lines.
 */
export function describeBlocks(id: string, blocks: readonly PlanBlock[], tierId = id): void {
  for (const b of blocks) {
    const flown = b.tier === 'flown';
    const ms = flown ? FLOWN_MS : QUICK_MS;
    const body = () => {
      for (const i of b.items) {
        if (i.kind === 'value') item(id, i.label, i.value, i.limit, i.unit, ms);
        else if (i.kind === 'flag') flag(id, i.label, i.value, ms);
        else check(i.label, i.run, ms);
      }
    };
    if (flown) describe.runIf(flownTier(tierId))(`${b.name} (flown tier)`, body);
    else describe(b.name, body);
  }
}

/** The conformance tests of one type (call at the top level of tests/conformance/<id>.test.ts). */
export function describeAircraft(t: ConformanceTargets): void {
  const id = t.aircraft;
  let def!: AircraftDefinition;

  describe(`conformance ${id}`, () => {
    beforeAll(async () => {
      def = await loadAircraft(id);
    });

    flag(id, 'definition: loaded, the type itself (not a placeholder)', () => def.id === id && !def.placeholder, QUICK_MS);
    describeBlocks(id, conformancePlan(t, () => def));
  });
}
