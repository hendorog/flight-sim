// Round T repairs: every pond outlet's inflow (streams.ts report.pondInflowDetail) and the area its outlet and its
// receiver carry, per seed (PI_SEEDS).
import { it } from 'vitest';
import { hydrology, terrainHeight } from '../../../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('pond inflow', () => {
  for (const seed of (env.PI_SEEDS ?? '1,42,777777,7').split(',').map(Number)) {
    setWorldSeed(seed);
    terrainHeight(0, 0);
    const rep = hydrology.streamReport as unknown as { pondInflowDetail?: string[] };
    const L = hydrology.rivers!;
    for (const d of rep.pondInflowDetail ?? []) {
      const m = /outlet (\d+):/.exec(d);
      const o = m ? Number(m[1]) : -1;
      const r = o >= 0 ? L[o] : null;
      let tail = '';
      if (r && r.area) {
        const n = r.area.length;
        tail = `; outlet ${o} A ${r.area[0].toFixed(1)}..${r.area[n - 1].toFixed(1)} hw ${r.halfWidth[n - 1].toFixed(1)}`;
        const j = r.joins;
        if (j >= 0 && L[j].area) {
          const P = L[j];
          const sj = (() => { let bi = 0, bd = Infinity; for (let i = 0; i < P.north.length; i++) { const dd = Math.hypot(P.north[i] - r.north[n - 1], P.east[i] - r.east[n - 1]); if (dd < bd) { bd = dd; bi = i; } } return bi; })();
          tail += `; into ${j} ${j < L.length && L[j].kind === 0 ? 'river' : 'stream'} A ${P.area![Math.min(P.area!.length - 1, sj + 1)].toFixed(1)} hw ${P.halfWidth[Math.min(P.halfWidth.length - 1, sj + 1)].toFixed(1)} below the junction`;
        }
      }
      console.log(`seed ${seed} ${d}${tail}`);
    }
  }
  setWorldSeed(0);
});
