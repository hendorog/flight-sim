// Organic channels: the law along the river axes nearest the given points (FA_PTS "n,e;n,e", FA_SEED), every
// FA_EVERY axis samples: catchment, gradient, the room each side (floor, and the thread's), widths, swings, wavelengths.
import { it } from 'vitest';
import { terrainHeight } from '../../src/world/terrain/heightfield';
import { formProbe } from '../../src/world/terrain/riverNetwork';
import { formOf } from '../../src/world/terrain/channelForm';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('form along axes', () => {
  const pts = (env.FA_PTS ?? '-6805,-93214').split(';').map((p) => p.split(',').map(Number));
  const every = Number(env.FA_EVERY ?? 8);
  const R = Number(env.FA_R ?? 3000);
  formProbe.on = (li, a) => {
    for (const [pn, pe] of pts) {
      let best = -1;
      let bd = Infinity;
      for (let i = 0; i < a.north.length; i++) {
        const d = Math.hypot(a.north[i] - pn, a.east[i] - pe);
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
      if (bd > R) continue;
      console.log(`line ${li} near (${pn},${pe}) at ${bd.toFixed(0)} m, axis i ${best}/${a.north.length}`);
      for (let i = Math.max(0, best - 6 * every); i <= Math.min(a.north.length - 1, best + 6 * every); i += every) {
        const f = formOf(a.area[i], a.S[i], a.roomL[i] + a.roomR[i]);
        console.log(`  i ${i} s ${a.s[i].toFixed(0)} n ${a.north[i].toFixed(0)} e ${a.east[i].toFixed(0)} A ${a.area[i].toFixed(0)} lv ${a.level[i].toFixed(1)} S ${a.S[i].toFixed(4)} pi ${f.pi.toFixed(2)} room L/R ${a.roomL[i].toFixed(0)}/${a.roomR[i].toFixed(0)} thread ${a.rL[i].toFixed(0)}/${a.rR[i].toFixed(0)} Wa ${a.Wa[i].toFixed(1)} phi ${f.phi.toFixed(2)} lam2 ${a.lam2[i].toFixed(0)} om2 ${f.om2.toFixed(2)}->${a.om2[i].toFixed(2)} lam1 ${a.lam1[i].toFixed(0)} om1 ${a.om1[i].toFixed(2)}`);
      }
    }
  };
  setWorldSeed(Number(env.FA_SEED ?? 777777));
  terrainHeight(0, 0);
  formProbe.on = undefined;
  setWorldSeed(0);
});
