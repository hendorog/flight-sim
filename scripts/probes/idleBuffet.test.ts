// Probe: buffet felt idling on the runway (engine running, throttle closed). IDLE_SEED=42
import { it } from 'vitest';
import { defaultWeather } from '../../src/core/types';
import { stallBuffet } from '../../src/core/buffet';
import { SimPhysics } from '../../src/sim/SimPhysics';
import { setWorldSeed } from '../../src/world/worldSeed';
it('idle buffet', () => {
  setWorldSeed(Number(process.env.IDLE_SEED ?? 42));
  for (const wd of [100, 280, 190]) {
    const w = defaultWeather(); w.windDirectionDeg = wd; w.windSpeedKt = 8;
    const p = new SimPhysics({ weather: w });
    p.autoflightOnReset = false;
    p.reset('runway');
    p.controls.throttle = 0;
    p.controls.parkingBrake = true;
    const s = p.state;
    let sfMax = 0, bMax = 0;
    for (let f = 0; f < 60 * 20; f++) { p.advance(1 / 60); if (f > 300) { sfMax = Math.max(sfMax, s.stallFraction); bMax = Math.max(bMax, stallBuffet(s.stallFraction, s.ias)); } }
    console.log(`wind ${wd}/8 kt: rpm ${s.engine.rpm.toFixed(0)} ias ${s.ias.toFixed(1)} m/s, stall fraction up to ${sfMax.toFixed(2)}, felt buffet up to ${bMax.toFixed(3)}`);
  }
  setWorldSeed(0);
});
