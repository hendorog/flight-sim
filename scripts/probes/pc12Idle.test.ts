// PC-12 at FLIGHT IDLE (research probe): steady idle descents with the autopilot holding the speed, a level
// deceleration with the PCL closed, the feathered glide for comparison, and both idles on the ground (static on the
// brakes, then unbraked). Prints; asserts nothing.
//   npx vitest run --config scripts/probes/vitest.config.ts pc12Idle      LOG=<file> appends the output there too
//   RUNAWAY='{"ng":[0.55,0.645,0.75,0.85],"speed":[0.9,0.95,1.5,2]}' tries a power-turbine runaway table, POWER='{"0.55":55}'
//   map rows (shp); ONLY=ground|air; AC=c208 flies the Caravan instead (HIGH IDLE in the air, both idles on the ground)
import { it } from 'vitest';
import { appendFileSync } from 'node:fs';
import { DEG, FT, KT } from '../../src/core/math';
import { PC12_DEFINITION } from '../../src/aircraft/pc12';
import { C208_DEFINITION } from '../../src/aircraft/c208';
import { pc12TorquePsi } from '../../src/aircraft/pc12/facts';
import { PC12_GROUND_IDLE } from '../../src/aircraft/pc12/sim';
import { ELEVATION, FRAME, at, makeRig } from '../../tests/fdm/helpers';
import { Autopilot } from '../../src/physics/autopilot';
import { flapLever, runwayRig, tasForKias, idleTaxi } from '../../tests/fdm/measure';

const log = (s: string) => { if (process.env.LOG) appendFileSync(process.env.LOG, s + '\n'); process.stderr.write(s + '\n'); };
const f1 = (x: number) => x.toFixed(1), f0 = (x: number) => x.toFixed(0);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const C208 = process.env.AC === 'c208';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const def: any = C208 ? C208_DEFINITION : PC12_DEFINITION;
const pc = def.powerplant.engines[0].propeller.pitchControl;
const pt = def.powerplant.engines[0].engine.turbine.powerTurbine;
if (process.env.RUNAWAY) pt.runaway = JSON.parse(process.env.RUNAWAY);
// POWER='{"0.55":55}' replaces map rows (shp at that corrected Ng).
const gmap = def.powerplant.engines[0].engine.turbine.gasGenerator.map;
for (const [ng, shp] of Object.entries(JSON.parse(process.env.POWER ?? '{}'))) gmap.power[gmap.ng.findIndex((x: number) => Math.abs(x - Number(ng)) < 1e-9)] = (shp as number) * 745.7;
const ONLY = process.env.ONLY;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const G = (s: any) => `kias=${f1(s.ias / KT)} vs=${f0(s.verticalSpeed / FT * 60)} pitch=${f1(s.pitch / DEG)} ${C208 ? `ftlbf=${f0(s.engines[0].torque / 1.3558)}` : `psi=${f1(pc12TorquePsi(s.engines[0].torque))}`} ng=${f1(s.engines[0].ng ?? 0)} np=${f0(s.engines[0].propRpm)} blade=${f1(s.propellers[0].bladePitch / DEG)} thr=${f0(s.propellers[0].thrust)}N`;

it('pc12 idle', () => {
  log(`# runaway ${JSON.stringify(pt.runaway ?? null)} power ${JSON.stringify(gmap.power.map((w: number) => Math.round(w / 745.7)))}`);
  const rig = makeRig({ def, loading: 'maxGross' });
  const alt = ELEVATION + 3300;
  const start = (kias: number, flapsDeg: number, gear: boolean, mixture: number) => {
    rig.fm.reset({ position: at(alt), heading: 0, airspeed: tasForKias(def, kias, alt, 20, 150), onGround: false, engineRunning: true, flaps: flapLever(def, flapsDeg), gearDown: gear }, rig.env);
    Object.assign(rig.controls, rig.fm.trimControls);
    rig.controls.throttle = 0;
    rig.controls.mixture = mixture;
  };
  const cases: readonly (readonly [number, number, boolean, number])[] = C208
    ? [[95, 0, true, 1], [120, 0, true, 1], [150, 0, true, 1], [78, 30, true, 1], [95, 0, true, 0], [120, 0, true, 0]]
    : [[100, 0, false, 1], [120, 0, false, 1], [150, 0, false, 1], [180, 0, false, 1], [85, 40, true, 1], [100, 15, true, 1], [120, 0, false, 0]];
  const V0 = C208 ? 160 : 180, MARKS = C208 ? [150, 130, 110, 90] : [170, 150, 130, 110];
  for (const [kias, flapsDeg, gear, cond] of ONLY === 'ground' ? [] : cases) {
    start(kias, flapsDeg, gear, cond);
    const s = rig.fm.state, ap = new Autopilot(def.autopilot);
    ap.settings = { ...ap.settings, lateral: 'wingLeveler', vertical: 'airspeed', airspeed: kias * KT, autoTrim: true };
    let n = 0, vs = 0, t = 0, e0 = NaN;
    rig.run(70, () => {
      ap.update(FRAME, s, rig.controls); rig.controls.throttle = 0; rig.controls.mixture = cond; t += FRAME;
      if (t > 50) { n++; vs += s.verticalSpeed; if (Number.isNaN(e0)) e0 = s.tas; }
      return false;
    });
    // Energy-corrected sink over the last 20 s: the height rate plus the speed change's share (V dV/dt / g).
    const corr = (s.tas * (s.tas - e0)) / 20 / 9.80665;
    const sink = (vs / n - corr);
    log(`descent ${cond ? 'FLIGHT IDLE' : 'CUT-OFF/FEATHER'} ${kias} KIAS flaps ${flapsDeg} gear ${gear ? 'dn' : 'up'}: ${f0(sink / FT * 60)} fpm (energy-corrected), glide ${f1(s.tas / -sink)}:1 | ${G(s)}`);
  }
  // Level deceleration: trimmed level at 180 KIAS with power, then the PCL closed, the autopilot holding the height.
  if (ONLY !== 'ground') {
    start(V0, 0, !C208 ? false : true, 1);
    const s = rig.fm.state, ap = new Autopilot(def.autopilot);
    ap.settings = { ...ap.settings, lateral: 'wingLeveler', vertical: 'altitude', altitude: s.altitudeMSL, autoTrim: true };
    let t = 0;
    const marks: Record<number, number> = {};
    let peak = 0;
    rig.run(120, () => {
      ap.update(FRAME, s, rig.controls); rig.controls.throttle = 0; t += FRAME;
      const k = s.ias / KT;
      // The indicated airspeed starts from zero at a reset and lags up: count a mark once the speed has been above it.
      peak = Math.max(peak, k);
      for (const m of MARKS) if (marks[m] === undefined && peak > m + 2 && k <= m) marks[m] = t;
      return peak > V0 - 5 && k < MARKS[3] - 5;
    });
    log(`level decel at idle from ${V0} KIAS: ${MARKS.map((m) => `${m} at ${f1(marks[m] ?? NaN)} s`).join(', ')}; ${MARKS[1]}->${MARKS[3]} KIAS ${f1((MARKS[1] - MARKS[3]) / ((marks[MARKS[3]] ?? NaN) - (marks[MARKS[1]] ?? NaN)))} kt/s | ${G(s)}`);
  }
  for (const [cond, label] of ONLY === 'air' ? [] : ([[C208 ? 0.1 : PC12_GROUND_IDLE, 'LOW/GROUND IDLE'], [1, 'HIGH/FLIGHT IDLE']] as const)) {
    const rr = runwayRig(def, 'maxGross');
    for (const rev of [0, pc.beta.pitchOnlyTravel / 2, pc.beta.pitchOnlyTravel]) {
      const r = idleTaxi(rr, { reverse: rev, condition: cond, seconds: Number(process.env.TAXI_S ?? 60) });
      log(`ground ${label} reverse ${rev.toFixed(3)}: static ${f0(r.staticThrustN)} N, Np ${f0(r.staticNp)}, Ng ${f1(r.staticNg)} %; unbraked ${f1(r.speedKt)} kt (steady ${r.steady}) Np ${f0(r.np)}`);
    }
  }
});
