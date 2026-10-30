// Circuit traffic (src/atc/TrafficSystem.ts): an aircraft at each generated field, flying its circuit and calling
// downwind, base and final on the field's frequency in the shared phrasebook's words.

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { TrafficSystem, trafficRegistration, type Transmission } from '../../src/atc/TrafficSystem';
import { fieldPoint, generatedAirfields } from '../../src/world/airfields';
import { setWorldSeed } from '../../src/world/worldSeed';
import { setEra } from '../../src/world/era/eraState';
import '../../src/world/terrain/heightfield';

setEra('present');
setWorldSeed(0);

function fly(authority: 'easa' | 'faa', seconds: number, state: unknown = { position: { x: 0, y: 0 }, onGround: true }) {
  const traffic = new TrafficSystem({ authority: () => authority });
  const scene = new THREE.Scene();
  const ctx = { state, scene, camera: new THREE.PerspectiveCamera(), weather: { windDirectionDeg: 250, windSpeedKt: 10, qnhHpa: 1015 } };
  traffic.init(ctx as never);
  const heard: Transmission[] = [];
  for (let t = 0; t < seconds; t += 0.1) {
    traffic.update(0.1);
    heard.push(...traffic.drain());
  }
  return { traffic, heard, scene };
}

describe('circuit traffic', () => {
  it('puts one aircraft in the circuit at each generated field, in the scene', () => {
    const { traffic, scene } = fly('easa', 1);
    expect(traffic.states).toHaveLength(generatedAirfields().length);
    expect(scene.getObjectByName('circuit-traffic')!.children).toHaveLength(generatedAirfields().length);
  });

  it('calls downwind, base and final in turn at each field, in its own words', () => {
    const { traffic, heard } = fly('easa', 600);
    for (const [i, a] of traffic.states.entries()) {
      const mine = heard.filter((h) => h.speaker === i);
      expect(mine.length).toBeGreaterThanOrEqual(4);
      const name = a.field.name.replace(/ (Aerodrome|Airstrip)$/, '');
      const legs = mine.map((h) => {
        expect(h.frequency).toBe(a.field.frequency);
        expect(h.line.text.startsWith(`${name} Traffic, ${a.registration}, `)).toBe(true);
        return / downwind /.test(h.line.text) ? 'downwind' : / base /.test(h.line.text) ? 'base' : / final /.test(h.line.text) ? 'final' : h.line.text;
      });
      // Cyclic order downwind -> base -> final.
      const next: Record<string, string> = { downwind: 'base', base: 'final', final: 'downwind' };
      for (let k = 1; k < legs.length; k++) expect(legs[k]).toBe(next[legs[k - 1]]);
      expect(mine.find((h) => / downwind /.test(h.line.text))!.line.text).toMatch(/downwind runway \d\d, touch and go$/);
    }
  });

  it('uses N-numbers and ends FAA calls with the field name', () => {
    expect(trafficRegistration('KBRM', 'faa')).toMatch(/^N\d{3}[A-Z]{2}$/);
    expect(trafficRegistration('KBRM', 'easa')).toMatch(/^G-[A-Z]{4}$/);
    const { traffic, heard } = fly('faa', 300);
    const a = traffic.states[0];
    const name = a.field.name.replace(/ (Aerodrome|Airstrip)$/, '');
    const mine = heard.filter((h) => h.speaker === 0);
    expect(mine.length).toBeGreaterThan(0);
    for (const h of mine) expect(h.line.text.endsWith(`, ${name}`)).toBe(true);
  });

  it('goes around, and says so, when the player is on its runway', () => {
    const f = generatedAirfields()[0];
    const p = fieldPoint(f, 0, 0);
    const { traffic, heard } = fly('easa', 600, { position: { x: p.north, y: p.east }, onGround: true });
    const mine = heard.filter((h) => h.speaker === 0).map((h) => h.line.text);
    expect(mine.filter((t) => t.endsWith('going around')).length).toBeGreaterThanOrEqual(1);
    expect(traffic.states[0].state.onGround).toBe(false);
  });
});
