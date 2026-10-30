// Circuit traffic (src/atc/TrafficSystem.ts): an aircraft at each generated field, flying its circuit and calling
// downwind, base and final on the field's frequency in the shared phrasebook's words.

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { TrafficSystem, trafficRegistration, type Transmission } from '../../src/atc/TrafficSystem';
import { fieldPoint, generatedAirfields, HOME_AIRFIELD } from '../../src/world/airfields';
import { circuitPath, pathPoint } from '../../src/atc/circuit';
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

describe('the home circuit', () => {
  const home = (state: unknown, seconds: number, authority: 'easa' | 'faa' = 'easa') => {
    const traffic = new TrafficSystem({ authority: () => authority, homeTraffic: () => true, player: () => ({ registration: 'G-ABFS', icaoType: 'C152' }) });
    const ctx = { state, scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), weather: { windDirectionDeg: 250, windSpeedKt: 10, qnhHpa: 1015 } };
    traffic.init(ctx as never);
    const heard: Transmission[] = [];
    let extended = 0;
    for (let t = 0; t < seconds; t += 0.1) {
      traffic.update(0.1);
      heard.push(...traffic.drain());
      const a = traffic.states.find((x) => x.home)!;
      extended = Math.max(extended, a.path.extension);
    }
    return { traffic, heard, extended };
  };
  const parked = { position: { x: HOME_AIRFIELD.north + 3000, y: HOME_AIRFIELD.east }, altitudeMSL: HOME_AIRFIELD.elevation, onGround: true, groundSpeed: 0, heading: 0, track: 0 };

  it('flies an aircraft in the home circuit that calls the tower, is answered and reads its clearance back', () => {
    const { traffic, heard } = home(parked, 600);
    const a = traffic.states.find((x) => x.home)!;
    expect(a.field.kind).toBe('home');
    const texts = heard.filter((h) => h.frequency === HOME_AIRFIELD.frequency).map((h) => `${h.actor ?? 'aircraft'}: ${h.line.text}`);
    expect(texts.some((t) => /^aircraft: Fable Regional Tower, G-[A-Z]{2,4}, left hand downwind runway 25, touch and go$/.test(t))).toBe(true);
    expect(texts.some((t) => /^tower: G-[A-Z]{2}, number one, report final$/.test(t))).toBe(true);
    expect(texts.some((t) => /^tower: G-[A-Z]{2}, runway 25, cleared touch and go, wind/.test(t))).toBe(true);
    expect(texts.some((t) => /^aircraft: Runway 25, cleared touch and go, G-[A-Z]{2}$/.test(t))).toBe(true);
  });

  it('extends its downwind to follow the player on final', () => {
    const p = pathPoint(circuitPath(HOME_AIRFIELD, 1), -HOME_AIRFIELD.length / 2 - 2200, 0);
    const final = { position: { x: p.north, y: p.east }, altitudeMSL: HOME_AIRFIELD.elevation + 120, onGround: false, groundSpeed: 33, heading: HOME_AIRFIELD.heading + Math.PI, track: HOME_AIRFIELD.heading + Math.PI };
    const { heard, extended } = home(final, 600);
    expect(extended).toBeGreaterThan(0);
    expect(heard.some((h) => h.actor === 'tower' && / number two, follow the Cessna on final/.test(h.line.text))).toBe(true);
    // Never told to the player, who has not called.
    expect(heard.some((h) => h.toPlayer)).toBe(false);
  });

  it('takes the home aircraft away during a lesson', () => {
    let lesson = false;
    const traffic = new TrafficSystem({ authority: () => 'easa', homeTraffic: () => !lesson });
    traffic.init({ state: parked, scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), weather: { windDirectionDeg: 250, windSpeedKt: 10, qnhHpa: 1015 } } as never);
    expect(traffic.states.some((x) => x.home)).toBe(true);
    lesson = true;
    traffic.update(0.1);
    expect(traffic.states.some((x) => x.home)).toBe(false);
    expect(traffic.states).toHaveLength(generatedAirfields().length);
  });
});
