// Autopilot yaw-channel probe: rudder and slip-ball statistics with the autopilot flying (research probe).
// env: TYPES=c172s,..., WX=default|calm, SCEN=cruise|...
import { it } from 'vitest';
import { loadAircraft } from '../../src/aircraft/registry';
import { defaultWeather } from '../../src/core/types';
import { SimPhysics } from '../../src/sim/SimPhysics';

const TYPES = (process.env.TYPES ?? 'c172s,c152,pa38,da20,pa34,da42,c208').split(',');
const WX = process.env.WX ?? 'default';
const SCEN = (process.env.SCEN ?? 'cruise') as never;

function stats(xs: number[], dt: number) {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
  let zc = 0;
  for (let i = 1; i < xs.length; i++) if ((xs[i - 1] - m) * (xs[i] - m) < 0) zc++;
  const T = xs.length * dt;
  return { mean: +m.toFixed(3), sd: +sd.toFixed(4), freqHz: +(zc / 2 / T).toFixed(2), pp: +(Math.max(...xs) - Math.min(...xs)).toFixed(3) };
}

it('rudder hunting probe', async () => {
  for (const id of TYPES) {
    const def = id === 'c172s' ? undefined : await loadAircraft(id as never);
    const wx = defaultWeather();
    if (WX === 'calm') { wx.windSpeedKt = 0; wx.turbulence = 0; }
    const sim = new SimPhysics({ weather: wx, aircraft: def });
    sim.reset(SCEN, wx);
    sim.step(3);
    sim.setAutoflight(true);
    if (process.env.YD === '0') sim.autoflight.autopilot.settings.yawDamper = false;
    if (process.env.KP) Object.assign(sim.autoflight.autopilot.gains as object, { ballKp: +process.env.KP! * (sim.autoflight.autopilot.gains.ballKp) });
    if (process.env.KR) Object.assign(sim.autoflight.autopilot.gains as object, { yawKr: +process.env.KR! * (sim.autoflight.autopilot.gains.yawKr) });
    sim.step(15);
    if (process.env.TURN) { const ap = sim.autoflight.autopilot.settings; ap.heading = sim.state.heading + Number(process.env.TURN) * Math.PI / 180; (sim.controls as { headingBugDeg?: number }).headingBugDeg = ((sim.controls as { headingBugDeg?: number }).headingBugDeg ?? 0) + Number(process.env.TURN); }
    const rud: number[] = [], r: number[] = [], ball: number[] = [], beta: number[] = [];
    const dt = sim.stepSize;
    const n = Math.round(40 / dt);
    for (let i = 0; i < n; i++) {
      sim.step(dt);
      rud.push(sim.controls.rudder);
      r.push(sim.state.angularVelocity.z);
      ball.push(sim.state.slipBall);
    }
    const s = sim.state;
    console.log(id.padEnd(6), WX, 'ballMax', Math.max(...ball.map(Math.abs)).toFixed(3), 'hdg', (sim.state.heading*57.3).toFixed(0), 'rudder', JSON.stringify(stats(rud, dt)), 'r', JSON.stringify(stats(r, dt)), 'ball', JSON.stringify(stats(ball, dt)), `ias ${(s.ias * 1.944).toFixed(0)}kt alt ${s.altitudeMSL.toFixed(0)}`);
  }
}, 600000);
