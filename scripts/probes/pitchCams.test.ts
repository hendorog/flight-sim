// Probe (stage S): close-up camera views of a stream's pitches and pools: for the stream nearest each point (PC_PTS
// "name@seed@north,east;..."), its biggest pitch (lip to foot drop) within PC_HALF m, seen from 35 m downstream of its foot
// 12 m up, and from the side (45 m off, 20 m up) over the pool below it.
import { it } from 'vitest';
import { hydrology, terrainHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('pitch cams', () => {
  for (const spec of (env.PC_PTS ?? '').split(';').filter(Boolean)) {
    const [name, sd, xy] = spec.split('@');
    const [pn, pe] = xy.split(',').map(Number);
    setWorldSeed(Number(sd));
    let bd = Infinity, bl = -1, bk = -1;
    (hydrology.rivers ?? []).forEach((r: any, li) => {
      if (r.kind !== 1) return;
      for (let i = 0; i < r.s.length; i++) { const d = Math.hypot(r.north[i] - pn, r.east[i] - pe); if (d < bd) { bd = d; bl = li; bk = i; } }
    });
    const r: any = hydrology.rivers![bl];
    let best = -1, drop = 0;
    for (let i = 0; i + 1 < r.s.length; i++) {
      if (Math.abs(r.s[i] - r.s[bk]) > Number(env.PC_HALF ?? 300) || !r.pitchOn || r.pitchOn[i] < 1) continue;
      const d = r.level[i] - r.level[i + 1];
      const run = r.s[i + 1] - r.s[i];
      if (d > drop && d > 0.15 * run) { drop = d; best = i; }
    }
    if (best < 0) { console.log(`PCAM ${name}: none`); continue; }
    const i = best, j = best + 1;
    const dn = r.north[j] - r.north[i], de = r.east[j] - r.east[i], dl = Math.hypot(dn, de) || 1;
    const un = dn / dl, ue = de / dl;
    const cam = (n: number, e: number, up: number) => `${n.toFixed(0)},${e.toFixed(0)},${(Math.max(terrainHeight(n, e), r.level[j]) + up).toFixed(0)}`;
    const fn = r.north[j] + un * 35, fe = r.east[j] + ue * 35;
    console.log(`PCAM ${name}-close seed=${sd}&camPos=${cam(fn, fe, 12)}&camLook=${r.north[i].toFixed(0)},${r.east[i].toFixed(0)},${r.level[j].toFixed(0)}   # drop ${drop.toFixed(1)} m hw ${r.halfWidth[i].toFixed(1)}`);
    const mn = r.north[j] + un * 15, me = r.east[j] + ue * 15;
    const sn = mn - ue * 45, se = me + un * 45;
    console.log(`PCAM ${name}-side seed=${sd}&camPos=${cam(sn, se, 20)}&camLook=${mn.toFixed(0)},${me.toFixed(0)},${r.level[j].toFixed(0)}`);
  }
  setWorldSeed(0);
});
