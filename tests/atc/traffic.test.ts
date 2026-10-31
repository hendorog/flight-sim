// Circuit traffic (src/atc/TrafficSystem.ts): an aircraft at each generated field, flying its circuit and calling
// downwind, base and final on the field's frequency in the shared phrasebook's words.

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { TrafficSystem, trafficRegistration, type Transmission } from '../../src/atc/TrafficSystem';
import { callsign } from '../../src/atc/phrases';
import { fieldPoint, generatedAirfields, HOME_AIRFIELD } from '../../src/world/airfields';
import { circuitPath, pathPoint } from '../../src/atc/circuit';
import { ARRIVAL_ROUTE, DEPARTURE_ROUTE, freeSpots, taxiOutRoute } from '../../src/atc/taxi';
import { stepTaxi } from '../../src/atc/circuit';
import { APRON_TAXILANE_V, HOLD_LINE_V, localToNed, PARALLEL_TAXIWAY_V, type NedXY, type ParkingSpot } from '../../src/world/airport/layout';

/** The straights of a departure's taxi route before its corners are rounded (25: via B2 to A4). */
function taxiLines(spot: ParkingSpot, _end: 1): [NedXY, NedXY][] {
  const u = (n: string) => TAXIWAYS.find((t) => t.name === n)!.a.u;
  const pts = [[spot.u, spot.v], [spot.u, APRON_TAXILANE_V], [u('B2'), APRON_TAXILANE_V], [u('B2'), PARALLEL_TAXIWAY_V], [u('A4'), PARALLEL_TAXIWAY_V], [u('A4'), HOLD_LINE_V - 4]].map(([a, b]) => localToNed(a, b));
  return pts.slice(1).map((p, i) => [pts[i], p]);
}

function segmentDistance(p: { north: number; east: number }, a: NedXY, b: NedXY): number {
  const dx = b.north - a.north, dy = b.east - a.east;
  const t = Math.max(0, Math.min(1, ((p.north - a.north) * dx + (p.east - a.east) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p.north - a.north - t * dx, p.east - a.east - t * dy);
}
import { staticParkedSpots } from '../../src/world/airport/props';
import { TAXIWAYS } from '../../src/world/airport/layout';
import { HOME_GROUND } from '../../src/instruments/dynamics/radios';
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
    for (const a of traffic.states) {
      const mine = heard.filter((h) => h.line.text.includes(`, ${a.registration}, `));
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
    const cs = callsign(a.registration, a.type, 'faa').full.text;
    const mine = heard.filter((h) => h.frequency === a.field.frequency && h.line.text.includes(cs));
    expect(mine.length).toBeGreaterThan(0);
    for (const h of mine) expect(h.line.text.endsWith(`, ${name}`)).toBe(true);
  });

  it('goes around, and says so, when the player is on its runway', () => {
    const f = generatedAirfields()[0];
    const p = fieldPoint(f, 0, 0);
    const { traffic, heard } = fly('easa', 600, { position: { x: p.north, y: p.east }, onGround: true });
    const mine = heard.filter((h) => h.line.text.includes(traffic.states[0].registration)).map((h) => h.line.text);
    expect(mine.filter((t) => t.endsWith('going around')).length).toBeGreaterThanOrEqual(1);
    expect(traffic.states[0].state.onGround).toBe(false);
  });
});

describe('the home field', () => {
  const home = (state: unknown, seconds: number, authority: 'easa' | 'faa' = 'easa', each?: (t: TrafficSystem) => void) => {
    const traffic = new TrafficSystem({ authority: () => authority, homeTraffic: () => true, player: () => ({ registration: 'G-ABFS', icaoType: 'C152' }) });
    const ctx = { state, scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), weather: { windDirectionDeg: 250, windSpeedKt: 10, qnhHpa: 1015, timeOfDay: 10 } };
    traffic.init(ctx as never);
    const heard: Transmission[] = [];
    let extended = 0;
    for (let t = 0; t < seconds; t += 0.1) {
      traffic.update(0.1);
      heard.push(...traffic.drain());
      for (const a of traffic.states) if (a.ops) extended = Math.max(extended, a.path.extension);
      each?.(traffic);
    }
    return { traffic, heard, extended };
  };
  const parked = { position: { x: HOME_AIRFIELD.north + 3000, y: HOME_AIRFIELD.east }, altitudeMSL: HOME_AIRFIELD.elevation, onGround: true, groundSpeed: 0, heading: 0, track: 0 };

  it('departs, arrives, lands, taxis in and parks, working Ground and the tower and reading back', () => {
    const phases = new Set<string>();
    let closest = Infinity;
    const { heard } = home(parked, 1500, 'easa', (t) => {
      const ground = t.states.filter((a) => a.ops && a.state.onGround);
      for (const a of ground) phases.add(a.ops!.phase);
      for (let i = 0; i < ground.length; i++) for (let j = i + 1; j < ground.length; j++) {
        closest = Math.min(closest, Math.hypot(ground[i].state.north - ground[j].state.north, ground[i].state.east - ground[j].state.east));
      }
    });
    const said = heard.filter((h) => h.frequency === HOME_AIRFIELD.frequency || h.frequency === HOME_GROUND).map((h) => `${h.actor ?? 'aircraft'}: ${h.line.text}`);
    const has = (re: RegExp) => expect(said.some((x) => re.test(x)), String(re)).toBe(true);
    // A departure.
    has(/^aircraft: Fable Regional Ground, G-[A-Z]{4}, at the apron, request taxi for VFR flight, information K$/);
    has(/^ground: G-[A-Z]{2}, taxi to holding point A4, runway 25, QNH 1015$/);
    has(/^aircraft: Taxi to holding point A4, runway 25, QNH 1015, G-[A-Z]{2}$/);
    has(/^aircraft: Fable Regional Tower, G-[A-Z]{2,4}, at holding point, runway 25, ready for departure$/);
    has(/^tower: G-[A-Z]{2}, runway 25, cleared for take-off, wind 250 degrees 10 knots$/);
    has(/^tower: G-[A-Z]{2}, frequency change approved$/);
    // An arrival.
    has(/^aircraft: Fable Regional Tower, G-[A-Z]{4}, \d miles [a-z-]+, 2,400 feet, request joining instructions, information K$/);
    has(/^tower: G-[A-Z]{2}, join left hand downwind runway 25, QNH 1015, report downwind$/);
    has(/^aircraft: Fable Regional Tower, G-[A-Z]{2}, left hand downwind runway 25, full stop$/);
    has(/^tower: G-[A-Z]{2}, runway 25, cleared to land, wind/);
    has(/^tower: G-[A-Z]{2}, vacate right at A2, when vacated contact Ground 121.9$/);
    has(/^aircraft: Fable Regional Ground, G-[A-Z]{2,4}, vacated runway 25 at A2, request taxi to the apron$/);
    has(/^ground: G-[A-Z]{2}, taxi to the apron via Alpha and B1$/);
    // The circuit aircraft, numbered behind the others.
    has(/^tower: G-[A-Z]{2}, number two, follow the [A-Z][a-z]+ on (downwind|base|final), report final$/);
    for (const p of ['parked', 'taxiOut', 'holding', 'lined', 'vacate', 'clear', 'taxiIn']) expect(phases.has(p), p).toBe(true);
    // Never on top of one another on the ground.
    expect(closest).toBeGreaterThan(15);
  });

  it('taxis round the corners in curves, central in the taxiway, slowing for them', () => {
    const spot = freeSpots()[0];
    const route = taxiOutRoute(spot, 1);
    // No sharp corner left: every turn at a waypoint is a fraction of one.
    for (let i = 1; i < route.length - 1; i++) {
      const a = Math.atan2(route[i].east - route[i - 1].east, route[i].north - route[i - 1].north);
      const b = Math.atan2(route[i + 1].east - route[i].east, route[i + 1].north - route[i].north);
      expect(Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a)))).toBeLessThan(0.3);
    }
    // Taxied: within 6 m of the centreline (the straights between the original corners) throughout, slower in the turns.
    const lines = taxiLines(spot, 1);
    const s = { north: route[0].north, east: route[0].east, height: 0, heading: Math.atan2(route[1].east - route[0].east, route[1].north - route[0].north), bank: 0, pitch: 0, speed: 0, verticalSpeed: 0, leg: 0, onGround: true, rollTime: 0 };
    let wp = 0, worst = 0, minTurnSpeed = Infinity, maxSpeed = 0;
    for (let k = 0; k < 6000 && wp < route.length; k++) {
      const h0 = s.heading;
      wp = stepTaxi(s, route, wp, 0.1);
      worst = Math.max(worst, Math.min(...lines.map((l) => segmentDistance(s, l[0], l[1]))));
      const rate = Math.abs(Math.atan2(Math.sin(s.heading - h0), Math.cos(s.heading - h0))) / 0.1;
      if (rate > 0.15) minTurnSpeed = Math.min(minTurnSpeed, s.speed);
      maxSpeed = Math.max(maxSpeed, s.speed);
    }
    expect(wp).toBe(route.length);
    expect(worst).toBeLessThan(6);
    expect(maxSpeed).toBeGreaterThan(7);
    expect(minTurnSpeed).toBeLessThan(5);
  });

  it('keeps departures and arrivals apart on Alpha (no nose to nose)', () => {
    for (const end of [0, 1] as const) {
      const d = DEPARTURE_ROUTE[end], ar = ARRIVAL_ROUTE[end];
      const u = (n: string) => TAXIWAYS.find((t) => t.name === n)!.a.u;
      const dep = [u(d.link), u(d.hold)].sort((x, y) => x - y);
      for (const exit of ar.exits) {
        const arr = [u(exit), u(ar.link)].sort((x, y) => x - y);
        expect(arr[1] <= dep[0] || arr[0] >= dep[1], `end ${end} via ${exit}`).toBe(true);
      }
    }
  });

  it("parks only where the scenery's parked aircraft are not", () => {
    const taken = staticParkedSpots();
    expect(taken.size).toBeGreaterThan(5);
    expect(freeSpots().length).toBeGreaterThan(5);
    for (const s of freeSpots()) expect(taken.has(s.name)).toBe(false);
  });

  it('extends its downwind to follow the player on final', () => {
    const p = pathPoint(circuitPath(HOME_AIRFIELD, 1), -HOME_AIRFIELD.length / 2 - 2200, 0);
    const final = { position: { x: p.north, y: p.east }, altitudeMSL: HOME_AIRFIELD.elevation + 120, onGround: false, groundSpeed: 33, heading: HOME_AIRFIELD.heading + Math.PI, track: HOME_AIRFIELD.heading + Math.PI };
    const { heard, extended } = home(final, 300);
    expect(extended).toBeGreaterThan(0);
    expect(heard.some((h) => h.actor === 'tower' && / number two, follow the Cessna on final/.test(h.line.text))).toBe(true);
    // Never told to the player, who has not called.
    expect(heard.some((h) => h.toPlayer)).toBe(false);
  });

  it('takes the home traffic away during a lesson', () => {
    let lesson = false;
    const traffic = new TrafficSystem({ authority: () => 'easa', homeTraffic: () => !lesson });
    traffic.init({ state: parked, scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), weather: { windDirectionDeg: 250, windSpeedKt: 10, qnhHpa: 1015 } } as never);
    expect(traffic.states.filter((x) => x.ops)).toHaveLength(3);
    lesson = true;
    traffic.update(0.1);
    expect(traffic.states.some((x) => x.ops)).toBe(false);
    expect(traffic.states).toHaveLength(generatedAirfields().length);
  });
});
