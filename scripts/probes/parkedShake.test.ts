// Probe: a parked aircraft, engine off, on the apron and the runway: how much does the body move?
//   npx vitest run --config scripts/probes/vitest.config.ts parkedShake   (SHAKE_TYPES=c172s,c152 SHAKE_WIND=0)
import { it } from 'vitest';
import { defaultWeather } from '../../src/core/types';
import { SimPhysics } from '../../src/sim/SimPhysics';
import { loadAircraft } from '../../src/aircraft/registry';

const TYPES = (process.env.SHAKE_TYPES ?? 'c172s').split(',');

it('parked shake', async () => {
  for (const id of TYPES) {
    for (const scen of ['apron', 'runway'] as const) for (const wd of (process.env.SHAKE_DIRS ?? '-1').split(',').map(Number)) {
      const w = defaultWeather();
      if (wd >= 0) (w as any).windDirectionDeg = wd;
      if (process.env.SHAKE_WIND === '0') { w.windSpeedKt = 0; w.gustKt = 0; w.turbulence = 0; }
      const p = new SimPhysics({ weather: w });
      p.autoflightOnReset = false;
      p.reset(scen);
      if (id !== 'c172s') { p.setAircraft(await loadAircraft(id as any)); p.reset(scen); }
      if (scen === 'runway') { p.controls.magnetos = 'off' as any; p.controls.mixture = 0; p.controls.throttle = 0; }
      const s = p.state;
      let pr = 0, rr = 0, az = 0, azMin = Infinity, azMax = -Infinity, n = 0, maxRate = 0;
      const x0 = { ...s.position };
      for (let f = 0; f < 60 * 20; f++) {
        p.advance(1 / 60);
        if (f < 60 * 5) continue;
        const w2 = s.angularVelocity;
        pr += w2.y * w2.y; rr += w2.x * w2.x; n++;
        maxRate = Math.max(maxRate, Math.abs(w2.x), Math.abs(w2.y), Math.abs(w2.z));
        azMin = Math.min(azMin, s.specificForce.z); azMax = Math.max(azMax, s.specificForce.z); az += s.specificForce.z;
      }
      const moved = Math.hypot(s.position.x - x0.x, s.position.y - x0.y);
      console.log(`${id} ${scen} wind ${wd}: rms p ${Math.sqrt(rr / n).toFixed(4)} q ${Math.sqrt(pr / n).toFixed(4)} rad/s, max ${maxRate.toFixed(3)}, fz ${azMin.toFixed(3)}..${azMax.toFixed(3)} g?, moved ${moved.toFixed(3)} m, stall ${s.stallFraction.toFixed(2)}, alpha ${(s.alpha*57.3).toFixed(0)}, rpm ${s.engine.rpm.toFixed(0)}, ias ${s.ias.toFixed(2)}`);
    }
  }
});
