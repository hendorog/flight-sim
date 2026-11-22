// Probe: cockpit-like camera parameters (dev/terrain.html cam/look, m) for shots along a seeded world's channels:
// from a point `back` m upstream of a site, `agl` m over the ground, looking along the channel to `ahead` m past it.
//   SHOT_SEED=42 SHOT_SITES=fall:480,line:178@0.5,line:0@0.5 npx vitest run --config scripts/probes/vitest.config.ts shotSites --silent=false --disable-console-intercept
import { it } from 'vitest';
import { hydrology, terrainHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';

it('shot sites', () => {
  setWorldSeed(Number(process.env.SHOT_SEED ?? 42));
  const lines = hydrology.rivers!;
  const back = Number(process.env.SHOT_BACK ?? 500);
  const ahead = Number(process.env.SHOT_AHEAD ?? 200);
  for (const site of (process.env.SHOT_SITES ?? 'fall:480').split(',')) {
    let li = 0;
    let i = 0;
    if (site.startsWith('fall:')) {
      const f = hydrology.falls![Number(site.slice(5))];
      li = f.line;
      i = f.index;
    } else {
      const [l, frac] = site.slice(5).split('@');
      li = Number(l);
      i = Math.floor(Number(frac) * (lines[li].s.length - 1));
    }
    const r = lines[li];
    const at = (sv: number): number => {
      let k = 0;
      while (k < r.s.length - 1 && r.s[k] < sv) k++;
      return k;
    };
    const c = at(r.s[i] - back);
    const l = at(r.s[i] + ahead);
    const regs = [];
    for (let k = c; k <= l; k++) regs.push(r.regime![k]);
    console.log(`${site}: line ${li} kind ${r.kind} hw ${r.halfWidth[i].toFixed(1)} level ${r.level[i].toFixed(0)} steep ${r.steepness![i].toFixed(2)} speed ${r.speed![i].toFixed(1)}`);
    console.log(`  cam=${r.north[c].toFixed(0)},${r.east[c].toFixed(0)},0&camagl=AGL&look=${r.north[l].toFixed(0)},${r.east[l].toFixed(0)},${r.level[l].toFixed(0)}  (site ${r.north[i].toFixed(0)},${r.east[i].toFixed(0)}; ground at cam ${terrainHeight(r.north[c], r.east[c]).toFixed(0)}) regimes ${regs.join('')}`);
  }
});
