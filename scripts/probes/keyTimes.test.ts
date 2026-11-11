// Keyboard pitch keys (research probe): seconds of holding a key to reach a yoke position, against airspeed. Prints.
import { it } from 'vitest';
import { PC12_DEFINITION } from '../../src/aircraft/pc12';
import { C172S_DEFINITION } from '../../src/aircraft/c172s';
import { stepKeyAxis } from '../../src/input/virtualYoke';
import { KT } from '../../src/core/math';

it('key times', () => {
  for (const [name, def, speeds] of [['pc12', PC12_DEFINITION, [100, 150, 200, 236]], ['c172s', C172S_DEFINITION, [60, 100, 140]]] as const) {
    const e = def.input.assists.axes.elevator;
    for (const kias of speeds) {
      const time = (dir: number, to: number, tun = e): number => { let v = 0, n = 0; while (Math.abs(v) < to && n < 6000) { n++; v = stepKeyAxis(v, dir, kias * KT, 1 / 60, tun, n / 60); } return n / 60; };
      const old = { ...e, fullTravel: false };
      let v = 0; for (let n = 1; n <= 60000; n++) { const w = stepKeyAxis(v, -1, kias * KT, 1 / 60, old, n / 60); if (w === v) break; v = w; }
      process.stderr.write(`${name} ${kias} KIAS: forward 30 % ${time(-1, 0.3).toFixed(1)} s, 60 % ${time(-1, 0.6).toFixed(1)} s, 100 % ${time(-1, 1).toFixed(1)} s; back 50 % ${time(1, 0.5).toFixed(1)} s, 100 % ${time(1, 1).toFixed(1)} s (old cap forward ${(-v * 100).toFixed(0)} %)\n`);
    }
  }
});
