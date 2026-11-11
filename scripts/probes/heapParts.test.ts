// Probe (Round V A4'+B join): the typed arrays a seeded world's hydrology holds, by line field and by kind (HP_SEED).
import { it } from 'vitest';
import { hydrology, terrainHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('heap parts', () => {
  setWorldSeed(Number(env.HP_SEED ?? 42));
  terrainHeight(0, 0);
  const L = hydrology.rivers as unknown as Array<Record<string, unknown>>;
  const by = new Map<string, number>();
  let total = 0;
  for (const r of L) for (const [k, v] of Object.entries(r)) if (ArrayBuffer.isView(v)) { by.set(k, (by.get(k) ?? 0) + v.byteLength); total += v.byteLength; }
  console.log(`HP lines total ${(total / 1e6).toFixed(0)} MB: ${[...by.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(v / 1e6).toFixed(0)}`).join(', ')}`);
  const seen = new Set<ArrayBuffer>();
  const walk = (o: unknown, path: string, depth: number, acc: Map<string, number>): void => {
    if (!o || typeof o !== 'object' || depth > 4) return;
    if (ArrayBuffer.isView(o)) { const b = (o as ArrayBufferView).buffer as ArrayBuffer; if (!seen.has(b)) { seen.add(b); acc.set(path, (acc.get(path) ?? 0) + b.byteLength); } return; }
    if (Array.isArray(o)) { for (const x of o.slice(0, 100000)) walk(x, path + '[]', depth + 1, acc); return; }
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) walk(v, path + '.' + k, depth + 1, acc);
  };
  const acc = new Map<string, number>();
  walk(hydrology, 'hydrology', 0, acc);
  console.log(`HP hydrology reachable ${(([...acc.values()].reduce((a, b) => a + b, 0)) / 1e6).toFixed(0)} MB; top: ${[...acc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => `${k} ${(v / 1e6).toFixed(0)}`).join(', ')}`);
});
