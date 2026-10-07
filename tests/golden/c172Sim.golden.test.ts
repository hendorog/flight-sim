// Golden master of the simulation core (src/sim/SimPhysics.ts) in the real world environment (terrain
// heightfield, airport pavement, the seeded wind field in the default weather: 6 kt of wind, light turbulence):
// every free-flight scenario reset and stepped for 10 s with the controls the reset leaves, the runway scenario
// flown by the autoflight for 40 s, the interpolated render state of advance(), a flight saved as a resume
// snapshot and continued in a new SimPhysics, and a Flight School start with its forward payload. Pinned in
// tests/golden/data/c172Sim.json to a relative 1e-9 (tests/golden/golden.ts).
//
// 'restore.cruise' and 'start.forward' pin the two places where SimPhysics reaches a PRIVATE field of the
// flight model through a cast that does nothing, silently, when the field is missing: the model clock `time`
// (restore(): the wind field is a function of it, so a restored flight meets the same air) and `loading`
// (applyLoading(): the payload of the next reset). A flight model that renames either keeps every other test
// green and fails these two.
//
// The wind field is seeded (physics/weather/random.ts), so these runs repeat exactly; they are the only golden
// records that fly in moving air. Every record builds its own SimPhysics: a second reset of a used instance is
// NOT guaranteed to repeat the first (the aerodynamic model carries some state across its reset(): 'downwind'
// flown for 5 s and reset again starts with its lift changed in the fifth digit).
//
// REGENERATE ONLY DELIBERATELY, after a change that is meant to alter the aircraft, the scenarios, the
// autoflight, the terrain or the weather model, and review the diff of the JSON:
//   FS_GOLDEN_UPDATE=1 npx vitest run tests/golden/c172Sim.golden.test.ts

import { describe, it } from 'vitest';
import type { ScenarioId } from '../../src/core/context';
import { defaultWeather } from '../../src/core/types';
import { parseSnapshot } from '../../src/sim/resume';
import { SimPhysics } from '../../src/sim/SimPhysics';
import { buildStart, type StartSpec } from '../../src/sim/starts';
import { golden, type Recorder } from './golden';

const FILE = 'c172Sim';
const LONG = 60_000;

/**
 * The five free-flight scenarios as of 2026-10-05, written out: the records must not follow the live table
 * (src/sim/scenarios.ts SCENARIO_IDS), or a scenario added later would ask for a record that does not exist.
 */
const SCENARIOS_RECORDED = ['runway', 'apron', 'final', 'cruise', 'downwind'] as const satisfies readonly ScenarioId[];

function sim(id: ScenarioId, autoflight: boolean): SimPhysics {
  const p = new SimPhysics({ weather: defaultWeather() });
  p.autoflightOnReset = autoflight;
  p.reset(id);
  return p;
}

/** What the rest of the application sees of the simulation: the state, the live controls and the autoflight. */
function record(r: Recorder, key: string, p: SimPhysics): void {
  r.state(`${key}/state`, p.state);
  r.controls(`${key}/controls`, p.controls);
  r.put(`${key}/controls/avionics`, p.controls.avionics);
  r.put(`${key}/controls/lights.landing`, p.controls.lights.landing);
  r.put(`${key}/controls/kollsmanHpa`, p.controls.kollsmanHpa);
  r.put(`${key}/controls/headingBugDeg`, p.controls.headingBugDeg);
  r.put(`${key}/autoflight.phase`, p.autoflight.phase);
  r.put(`${key}/steps`, p.steps);
  r.put(`${key}/time`, p.time);
}

describe('SimPhysics golden master', () => {
  it.each(SCENARIOS_RECORDED)('%s: reset, then 10 s with the controls the scenario leaves', (id) => {
    golden(FILE, `scenario.${id}`, (r) => {
      const p = sim(id, false);
      r.put('title', p.scenario.title);
      record(r, 't00', p);
      p.step(2);
      record(r, 't02', p);
      p.step(8);
      record(r, 't10', p);
    });
  }, LONG);

  it('runway: 40 s flown by the autoflight (take-off roll, rotation, climb)', () => {
    golden(FILE, 'autoflight.runway', (r) => {
      const p = sim('runway', true);
      record(r, 't00', p);
      for (const t of [5, 10, 15, 20, 25, 30, 35, 40]) {
        p.step(5);
        record(r, `t${String(t).padStart(2, '0')}`, p);
      }
    });
  }, LONG);

  it('final: 20 s of the autoflight approach, advanced in 50 Hz frames (interpolated render state)', () => {
    golden(FILE, 'autoflight.final', (r) => {
      const p = sim('final', true);
      // 1/50 s frames against the 240 Hz step: every frame ends between two steps, so renderState is
      // interpolated; no CPU budget, so no step is ever dropped.
      for (let frame = 1; frame <= 1000; frame++) {
        p.advance(1 / 50);
        if (frame % 250 === 0) {
          const key = `t${String(frame / 50).padStart(2, '0')}`;
          record(r, key, p);
          r.state(`${key}/renderState`, p.renderState);
          r.put(`${key}/lastAdvance`, p.lastAdvance);
        }
      }
    });
  }, LONG);

  it('cruise: 20 s in the default weather (turbulence), saved, restored through JSON into a new SimPhysics, 5 s more', () => {
    golden(FILE, 'restore.cruise', (r) => {
      const weather = defaultWeather();
      r.put('weather.turbulence', weather.turbulence);
      const p = new SimPhysics({ weather });
      p.autoflightOnReset = true;
      p.reset('cruise');
      p.step(20);
      record(r, 'saved', p);
      const snap = p.captureSnapshot({ weather, cameraMode: 'chase', quality: 'high', renderScale: null, resume: true, now: 1_800_000_000_000 });
      // As after a page reload: the snapshot as the JSON text localStorage holds, the weather restored first,
      // a new SimPhysics.
      const back = parseSnapshot(JSON.stringify(snap));
      if (!back) throw new Error('the snapshot did not parse');
      r.put('snapshot.simTime', back.simTime);
      const q = new SimPhysics({ weather: { ...back.weather } });
      q.restore(back);
      record(r, 'restored', q);
      // The air the restored flight meets (the wind field at the restored model clock), then 5 s in it.
      r.vec('restored/wind', q.env.wind(q.state.position, q.state.time));
      for (const t of [1, 2, 3, 4, 5]) {
        q.step(1);
        record(r, `t${String(t).padStart(2, '0')}`, q);
      }
    });
  }, LONG);

  it('a Flight School start in the air with the forward payload: mass, CG, state, 5 s', () => {
    golden(FILE, 'start.forward', (r) => {
      const p = new SimPhysics({ weather: defaultWeather() });
      // No options: 'forward' is the default payload of every lesson start (starts.ts buildStart).
      const spec: StartSpec = { kind: 'air', at: 'trainingArea', altFt: 3500, altRef: 'msl', hdgDeg: 100, kias: 90 };
      p.resetTo(buildStart(spec, p.env, {}));
      r.put('scenario.payload', p.scenario.payload ?? 'none');
      const mp = p.fm.massProperties;
      r.put('mass', mp.mass);
      r.vec('cgOffset', mp.cgOffset);
      r.put('inertia.Ixx', mp.inertia.Ixx);
      r.put('inertia.Iyy', mp.inertia.Iyy);
      r.put('inertia.Izz', mp.inertia.Izz);
      r.put('inertia.Ixz', mp.inertia.Ixz);
      record(r, 't00', p);
      p.step(5);
      record(r, 't05', p);
    });
  }, LONG);
});
