// Exact whole-flight-model digests of the four helicopters that existed before the hingeless / rigid-rotor programme
// (R22, R44, S269, MD 500E). Captured on unmodified main cd33d6c (Node v22.23.1 / V8) in a commit with no src/ change,
// so the literals are provably pre-programme. Every package of the programme runs this file: a changed digest means an
// existing helicopter changed behaviour, which blocks the merge (plan revision 2, section 2.5).
//
// Each case: reset (airborne at 0, 60 and 90 KIAS, 1500 ft; on the ground with the engine running; the MD 500E also a
// cold ground reset and a 60 s scripted start), then 2 s at 1/240 s of deterministic control sinusoids. Every 60 steps
// the flight-model state, the rotor's angular momentum, power diagnostics, drive power and the trim are hashed into one
// SHA-256 per case.
//
// UPDATE_DIGESTS=1 prints new literals. Set it only in a scratch checkout of cd33d6c (for example after a Node/V8
// upgrade), never to accept a change made by the programme; note any re-capture in the commit message.
import { expect, it } from 'vitest';
import { R22_DEFINITION } from '../../src/aircraft/r22';
import { R44_DEFINITION } from '../../src/aircraft/r44';
import { S269_DEFINITION } from '../../src/aircraft/s269';
import { MD500_DEFINITION } from '../../src/aircraft/md500';
import type { AircraftDefinition } from '../../src/aircraft/types';
import { createFlightModelFor } from '../../src/physics';
import type { BladeElementFlightModel } from '../../src/physics/flightModel';
import { applyControls, cloneControls, type ControlInputs } from '../../src/core/types';
import { KT } from '../../src/core/math';
import { flatEnvironment } from '../fdm/helpers';

const DT = 1 / 240;

const EXPECTED: Record<string, string> = {
  "r22-air-0": "595cef7918198d1b4ba82a1a79c8f48a6172279b84456cccee186d73607a0280",
  "r22-air-60": "de171e3c481e9e1f6d6096bc80c65171f5881a6d7fde00c2ea2dba01a763e0b7",
  "r22-air-90": "9801e9af88bf4117edfdc607dc2a322a18da717b9a285dcbcb122fa26b967bd8",
  "r22-ground": "b4415e19dd7b5008234a38662353423b35a7a989ce9df8c49365754cb8811624",
  "r44-air-0": "2e46bcfaac17d45d3f85490be30c2358a5f74d9a3fefbe13b75cb9ead2b252c9",
  "r44-air-60": "bce0cbbefcf76e338a5adcec7ba4d53a89a119d3111be73205b088cbb48c53d6",
  "r44-air-90": "39141c90c3d82af2419a536964a49f93e92c2ea1dbf27c4af071ad47eed566ea",
  "r44-ground": "7bd9b125f681e04b57a690aa803442db390599414229ef2f66647eb85761d2c7",
  "s269-air-0": "ca031819e40fcf3409f536cc07f574e1b920f4f010d509d58598583fe2542708",
  "s269-air-60": "43460107f68bc48d4e78ee7abb8d70f96a28aa82880920384627a446b59350c0",
  "s269-air-90": "16d31087f1b27c02b89cc3ea3204c031537c801b883075c6b9593924ad7d1cf1",
  "s269-ground": "ae67589bf4ae0b407b30e9d18e728a48fa8b9cbe7954240f02410552417579fa",
  "md500-air-0": "cef82b69980ac2e8f997e71373943a14d3c8c312e2efdf047d4b035f963bbd12",
  "md500-air-60": "195e7e6786d9c1a0c341713f51c870d05ce403657fccab1df8dcc48a42c47a1c",
  "md500-air-90": "9028caf98f5ea483c5107390fda5a8f9ff531bb135295e2a3dca90a6021545b4",
  "md500-ground": "4c78c1242b0f2191a15a5f6245839faed1f417461ec6908d494fcb176a1efd4c",
  "md500-start": "700bb7529b33338d55689cb8493b9693dbe30b5ecbfa0c466762ece3930278db",
};

interface Case { name: string; def: AircraftDefinition; kind: 'air' | 'ground' | 'start'; kt?: number }
const CASES: Case[] = [];
for (const def of [R22_DEFINITION, R44_DEFINITION, S269_DEFINITION, MD500_DEFINITION]) {
  for (const kt of [0, 60, 90]) CASES.push({ name: `${def.id}-air-${kt}`, def, kind: 'air', kt });
  CASES.push({ name: `${def.id}-ground`, def, kind: 'ground' });
}
CASES.push({ name: 'md500-start', def: MD500_DEFINITION, kind: 'start' });

function sinusoids(c: ControlInputs, base: ControlInputs, t: number, md500: boolean): void {
  c.collective = (base.collective ?? 0) + 0.03 * Math.sin(2 * Math.PI * 0.7 * t);
  c.elevator = base.elevator + 0.05 * Math.sin(2 * Math.PI * 1.1 * t);
  c.aileron = base.aileron + 0.05 * Math.sin(2 * Math.PI * 1.7 * t);
  c.rudder = base.rudder + 0.05 * Math.sin(2 * Math.PI * 0.9 * t);
  if (md500) c.n2Beep = Math.sin(2 * Math.PI * 0.3 * t) >= 0 ? 1 : -1;
}

for (const k of CASES) {
  it(`${k.name}: whole flight model unchanged since cd33d6c`, async () => {
    const { createHash } = await import(/* @vite-ignore */ 'node:crypto' as string);
    const hash = createHash('sha256');
    const fm = createFlightModelFor(k.def) as BladeElementFlightModel;
    const env = flatEnvironment(undefined, 0);
    const onGround = k.kind !== 'air';
    fm.reset({ position: { x: 0, y: 0, z: onGround ? 0 : -1500 * 0.3048 }, heading: 0.3, airspeed: (k.kt ?? 0) * KT,
      onGround, engineRunning: k.kind !== 'start' }, env);
    const rc = fm.rotorcraft!;
    const c = cloneControls(fm.trimControls);
    const update = (): void => {
      hash.update(JSON.stringify({ state: fm.state, h: rc.angularMomentum, power: rc.power, art: rc.articulatedPower,
        drive: rc.drivePower, trim: fm.lastTrim }));
    };
    update();
    let step = 0;
    if (k.kind === 'start') {
      // RFM 4-15: battery on, starter, grip to ground idle at 15 % N1, release the starter at 58 % N1.
      applyControls(c, k.def.sim.presets.cold);
      c.masterBattery = true;
      c.starter = true;
      const grip = k.def.rotorcraft!.systems.turboshaft!.grip;
      for (let i = 0; i < 60 * 240; i++, step++) {
        const n1 = fm.state.engine.ng ?? 0;
        if (n1 >= 15 && c.throttle < grip.groundIdle) c.throttle = grip.groundIdle;
        if (n1 >= 58 && c.starter) c.starter = false;
        fm.step(DT, c, env);
        if (step % 60 === 0) update();
      }
      // The case must exercise a real start: the gas producer at ground idle, the starter released.
      expect(fm.state.engine.ng ?? 0).toBeGreaterThan(55);
      expect(c.starter).toBe(false);
    }
    const base = cloneControls(c);
    for (let i = 0; i < 2 * 240; i++, step++) {
      sinusoids(c, base, i * DT, k.def.id === 'md500');
      fm.step(DT, c, env);
      if (step % 60 === 0) update();
    }
    update();
    const digest = hash.digest('hex');
    const env2 = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env;
    if (env2?.UPDATE_DIGESTS === '1') console.log(`  "${k.name}": "${digest}",`);
    else expect(digest).toBe(EXPECTED[k.name]);
  }, 120_000);
}
