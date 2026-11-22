// Round V A3r: floorlift attributed. At each point of FW_PTS (a file of 'north,east,v0,a' lines: V0's valley-floor cells
// that rose > 50 m, tools2/floorwhy.py), the rise (a - v0) split: the model's own ground over V0's floor (model - v0: V0's
// floor was cut under the model's ground - an old axis's carve), and the drawn ground over the model's ground (a - model:
// the slope pass, the carve and the relief over the model); with the slopes' weight m and whether a model floor line holds
// the point (fin). Shares, medians and where it happens. FW_SEED. (Round V A3 fix: FW_LIVE=1 reads the drawn ground of this
// tree, terrainHeight, in place of the file's fourth column, and splits the drawn-over-model term on / off a floor line.)
import { it } from 'vitest';
import { readFileSync } from 'node:fs';
import { debugMacro, terrainHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('floor why', () => {
  setWorldSeed(Number(env.FW_SEED ?? 42));
  terrainHeight(0, 0);
  const rows = readFileSync(env.FW_PTS!, 'utf8').trim().split('\n').map((l) => l.split(',').map(Number));
  const q = (a: number[], p: number): number => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };
  const rise: number[] = [], modelShare: number[] = [], passOver: number[] = [], modelOver: number[] = [];
  let slopes = 0, onFloor = 0, modelMost = 0, passMost = 0;
  const overOn: number[] = [], overOff: number[] = [];
  for (const [n, e, v0, a0] of rows) {
    const m = debugMacro(n, e);
    if (!m) continue;
    const a = env.FW_LIVE ? terrainHeight(n, e) : a0;
    (m.s.fin ? overOn : overOff).push(a - m.model);
    const r = a - v0;
    rise.push(r);
    modelOver.push(m.model - v0);
    passOver.push(a - m.model);
    modelShare.push((m.model - v0) / r);
    if (m.s.m > 0.5) slopes++;
    if (m.s.fin) onFloor++;
    if (m.model - v0 > 0.5 * r) modelMost++;
    if (a - m.model > 0.5 * r) passMost++;
  }
  const N = rise.length;
  console.log(`FW seed ${env.FW_SEED}: ${N} risen floor cells; rise p50 ${q(rise, 0.5).toFixed(0)} m (p10 ${q(rise, 0.1).toFixed(0)}, p90 ${q(rise, 0.9).toFixed(0)})`);
  console.log(`FW   the model's own ground over V0's floor: p50 ${q(modelOver, 0.5).toFixed(0)} m (p10 ${q(modelOver, 0.1).toFixed(0)}, p90 ${q(modelOver, 0.9).toFixed(0)}); over half the rise at ${((100 * modelMost) / N).toFixed(0)} % of the cells`);
  console.log(`FW   the drawn ground over the model's ground: p50 ${q(passOver, 0.5).toFixed(0)} m (p10 ${q(passOver, 0.1).toFixed(0)}, p90 ${q(passOver, 0.9).toFixed(0)}); over half the rise at ${((100 * passMost) / N).toFixed(0)} % of the cells`);
  console.log(`FW   the drawn ground over the model's: on a floor line (${overOn.length}) p50 ${q(overOn, 0.5).toFixed(0)} p90 ${q(overOn, 0.9).toFixed(0)} m; off them (${overOff.length}) p50 ${q(overOff, 0.5).toFixed(0)} p90 ${q(overOff, 0.9).toFixed(0)} m`);
  console.log(`FW   on the slopes (m > 0.5) ${((100 * slopes) / N).toFixed(0)} %; on a model floor line ${((100 * onFloor) / N).toFixed(0)} %`);
  setWorldSeed(0);
});
