// Probe: the drainage-tree measures (treeMetrics.ts) on NZ DEM boxes at the seeded lattice's spacing, for comparison
// only (learning; nothing NZ goes into the sim). The boxes come from scripts/probes/nzTreeFetch.py (LINZ 8 m DEM,
// CC BY 4.0, "Sourced from LINZ"), NaN over the sea. Relief classes only (NZ has no generator fields).
//   TREE_NZ=canterbury_1000,manawatu_1000 npx vitest run --config scripts/probes/vitest.config.ts scripts/probes/treeNz.test.ts --silent=false
import { it } from 'vitest';
import { CLASS_SEA, measureTree, reliefClasses, renderTree, Router } from './treeMetrics';
import { png } from './png';

const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as { readFileSync(p: string, e?: string): Uint8Array & string; writeFileSync(p: string, d: Uint8Array | string): void };
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;

it('tree nz', () => {
  const dir = 'out/tree/nz';
  const out: string[] = [];
  for (const name of (env.TREE_NZ ?? 'canterbury_1000,manawatu_1000').split(',')) {
    const hdr = JSON.parse(fs.readFileSync(`${dir}/${name}.json`, 'utf8')) as { rows: number; cols: number; res: number };
    const raw = fs.readFileSync(`${dir}/${name}.f32`) as Uint8Array;
    const z = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
    // Square lattice, north row last (treeMetrics: row i north of row i - 1); padding beyond the box is "outside":
    // fixed like the sea but not counted as sea (outlets there are the box's edge).
    const n = Math.max(hdr.rows, hdr.cols);
    const h = new Float32Array(n * n);
    const outside = new Uint8Array(n * n).fill(1);
    for (let r = 0; r < hdr.rows; r++) {
      for (let c = 0; c < hdr.cols; c++) {
        const v = z[r * hdr.cols + c];
        const i = hdr.rows - 1 - r;
        if (Number.isFinite(v)) {
          h[i * n + c] = Math.max(0.5, v);
          outside[i * n + c] = 0;
        } else {
          h[i * n + c] = 0;
          outside[i * n + c] = 2; // the sea
        }
      }
    }
    const fixed = new Uint8Array(n * n);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const c = i * n + j;
        if (outside[c]) fixed[c] = 1;
        else if (i === 0 || j === 0 || i === hdr.rows - 1 || j === hdr.cols - 1) fixed[c] = 1;
      }
    }
    const R = new Router(n, hdr.res);
    R.route(h, fixed);
    const cls = reliefClasses(n, h, hdr.res);
    for (let c = 0; c < n * n; c++) if (outside[c]) cls[c] = CLASS_SEA;
    const tree = { n, cell: hdr.res, receiver: R.receiver, area: R.area };
    const s = measureTree(`NZ ${name} [relief classes]`, tree, cls, (c) => outside[c] === 2);
    out.push(s.text);
    console.log(s.text);
    const pic = renderTree(n, h, tree, cls, s, 4);
    fs.writeFileSync(`${dir}/${name}.png`, png(pic.w, pic.w, pic.rgb));
  }
  fs.writeFileSync(`${dir}/measure.txt`, out.join('\n') + '\n');
});
