// Circuit traffic (docs/atc.md, step 3): one AI light aircraft (a C172, C152, PA-38 or DA20) flying touch-and-go
// circuits at each generated airfield, on the runway the wind favours, announcing itself on the field's common
// frequency as the player would (downwind, base, final; the wording from calls.ts callsFor, so the phrasebook is
// shared). This subsystem flies and draws them and queues their transmissions; RadioSystem decides what the player
// hears (COM1 tuned to the frequency, the avionics on, within line of sight). No collision or separation with the
// player yet. Present day only (built where the Flight School is).
//
// THE HOME FIELD (step 4). Up to MAX_HOME aircraft use the home field (not during a lesson), each working Ground and
// the tower (tower.ts HomeTower) as the player does: departures start parked, ask Ground for taxi, taxi to the
// holding point (taxi.ts routes), call ready and wait for their clearance (or line up and wait), take off and either
// stay in the circuit for a few touch and goes and a full stop, or leave it; arrivals call inbound from 11 km, join
// downwind, land full stop, are told where to vacate, call Ground clear of the runway and taxi to a spot, where they
// stay a while and then depart. The tower numbers the arrivals, answers with the traffic to follow, holds departures
// for close-in arrivals and sends an arrival round if the runway is still occupied at 400 ft; following traffic an
// aircraft extends its downwind. Every clearance is read back. The tower sequences the player with them, answering
// the player's calls (towerReply) and calling the player when a held landing or departure is cleared or an approach
// must go round (Transmission.toPlayer).
//
// PHYSICS LOD. The nearest MAX_FLOWN airborne aircraft within FLOWN_RANGE of the player fly on their type's own
// flight model (trafficPilot.ts: the player's physics and scripted pilot), the rest follow the kinematic circuit
// (circuit.ts), changing over in place. Aircraft on the ground move kinematically; the nearest MAX_POSED of them
// within EXTERIOR_RANGE of the camera are posed on a flight model's state (no physics) for their exterior. Exteriors
// (render/aircraft/trafficExterior.ts) within EXTERIOR_RANGE, a box stand-in beyond. Under time acceleration beyond
// the player's own coarse threshold every aircraft is kinematic.

import * as THREE from 'three';
import type { AircraftDefinition } from '../aircraft/types';
import { loadAircraft } from '../aircraft/registry';
import { loadAirframeVisual } from '../aircraft/visualLoader';
import type { AircraftId, Environment } from '../core/types';
import type { SimContext, Subsystem } from '../core/context';
import type { AirframeVisualDef } from '../render/aircraft/airframe/types';
import { TrafficExterior } from '../render/aircraft/trafficExterior';
import { TrafficPilot } from './trafficPilot';
import { quat } from '../core/math';
import { applyPose, nedToThree } from '../core/frames';
import type { TowerTarget } from '../render/cameras/towerRig';
import { HOME_GROUND } from '../instruments/dynamics/radios';
import { generatedAirfields, HOME_AIRFIELD, type Airfield } from '../world/airfields';
import { localHeading, localToNed, type NedXY, type ParkingSpot } from '../world/airport/layout';
import {
  activeFrame, CIRCUIT_RADIUS, callsFor, circuitLeg, readbackFor, replyTo, runwayInUse, vacateInstruction, vacateReadback,
  type CallId, type Intent, type RadioSituation, type RunwayEnd,
} from './calls';
import {
  CIRCUIT_HEIGHT, circuitPath, circuitRemaining, pathPoint, placeOnLeg, ROLL_HOLD, stepDirect, stepTaxi, stepTraffic, TAXI_SPEED, turnLead,
  type CircuitPath, type TrafficState,
} from './circuit';
import { callsign, maker, type Authority, type Callsign, type Phrase } from './phrases';
import {
  arrivalExit, freeSpots, lineUpRoute, onRunway, runwayHeading, seededRandom, TAXI_IN_ON_APRON, TAXI_OUT_OFF_APRON, taxiInRoute,
  taxiOutRoute, vacateRoute,
} from './taxi';
import { GO_AROUND_HEIGHT, HomeTower, type TowerAircraft, type TowerKind, type TowerReply, type TowerView } from './tower';
import { buildTrafficMesh, type TrafficMesh, type TrafficType } from './trafficMesh';

/** A circuit aircraft's call, for the radio to hear or not. */
export interface Transmission {
  frequency: number;
  north: number;
  east: number;
  /** Height above the ground, m (its line of sight). */
  heightAgl: number;
  line: Phrase;
  /** Which aircraft (a voice per aircraft); the controller's own voice when actor is set. */
  speaker: number;
  /** The home tower or ground speaking (from the field's antenna); absent: the aircraft. */
  actor?: 'tower' | 'ground';
  /** The controller speaking to the player, and what the player should read back. */
  toPlayer?: boolean;
  readback?: Phrase;
}

const FT = 0.3048;
const KT = 0.514444;
/** Ground station antenna height, m (RadioSystem's). */
const ANTENNA = 10;
/** The controller answers an aircraft's call after this long, and the aircraft reads back after the same again, s. */
const ANSWER_DELAY = 2;
/** An aircraft following traffic keeps base at least this far ahead of it on downwind beyond its turn, m; and extends at most this far. */
const FOLLOW_LEAD = 600;
const MAX_EXTENSION = 6000;
/** Below this height above the home field (and within CIRCUIT_RADIUS) the player is in the circuit, m. */
const CIRCUIT_CEILING = 2500 * FT;
/** A straight-in final is sequenced from this far out, m. */
const LONG_FINAL = 10000;
/** The tower looks round this often, s. */
const TOWER_PERIOD = 0.5;
/** Drawn within this distance of the camera, m. */
const DRAW_RANGE = 20000;
/** A flown or posed aircraft is drawn with its own exterior (~110k triangles) within this distance of the camera, the stand-in beyond, m. */
const EXTERIOR_RANGE = 3000;
/** At most this many aircraft on the flight model at once, those within FLOWN_RANGE of the player (m; they leave it beyond FLOWN_EXIT). */
export const MAX_FLOWN = 3;
const FLOWN_RANGE = 15000;
const FLOWN_EXIT = 17000;
/** At most this many aircraft on the ground posed for their exteriors. */
const MAX_POSED = 4;
/** Above this time acceleration every aircraft is kinematic (the player's own coarse-physics threshold). */
const FLOWN_MAX_TIME_SCALE = 4;

/** The home field's traffic: at most this many aircraft (parked ones included). */
export const MAX_HOME = 5;
/** A new arrival every ARRIVAL_EVERY to twice that, s; a parked aircraft departs after PARK_FOR to twice that, s. */
const ARRIVAL_EVERY = 240;
const PARK_FOR = 180;
/** Arrivals call inbound from this far out at this height above the field, m. */
const INBOUND_DISTANCE = 11000;
const INBOUND_HEIGHT = 2000 * FT;
/** Off the runway briskly after a full stop: the roll is handed to the vacate below VACATE_SPEED and keeps it to the exit's turn, m/s. */
const VACATE_SPEED = 13;
/** Departures leaving the circuit turn out above this height (or at the crosswind turn), call leaving beyond LEAVING_CALL and are gone beyond GONE, m. */
const TURN_OUT_HEIGHT = 500 * FT;
const LEAVING_CALL = 3000;
const GONE = 12000;
const OUTBOUND_HEIGHT = 2500 * FT;
/** A taxiing aircraft stops for anything on the ground this close ahead of it, m, within this angle of its nose. */
const GAP_AHEAD = 40;
const GAP_CONE = 50 * Math.PI / 180;

/** The types, with the ICAO designator they are called by. */
const TYPES: readonly { id: AircraftId; icao: TrafficType }[] = [
  { id: 'c172s', icao: 'C172' },
  { id: 'c152', icao: 'C152' },
  { id: 'pa38', icao: 'PA38' },
  { id: 'da20', icao: 'DA20' },
];
const TYPE_NAMES: Record<TrafficType, string> = { C172: 'Cessna 172', C152: 'Cessna 152', PA38: 'Piper Tomahawk', DA20: 'Diamond DA20' };
const TRIMS = [0x1d4f9c, 0xb3261e, 0x1f7a3a, 0x2b2b2b, 0xd08a12, 0x6a2c91, 0x0f7c86, 0x8a1c3c];

/** What a home-field aircraft is doing. */
export type HomePhase = 'parked' | 'taxiOut' | 'holding' | 'lineUp' | 'lined' | 'air' | 'outbound' | 'inbound' | 'vacate' | 'clear' | 'taxiIn';
const AIRBORNE: ReadonlySet<HomePhase> = new Set(['air', 'outbound', 'inbound']);

interface HomeOps {
  phase: HomePhase;
  /** After take-off: circuits (touch and goes, then a full stop) or away (leaving the circuit). */
  plan: 'circuits' | 'away';
  /** Touch and goes still to fly before the full stop. */
  laps: number;
  /** When the phase moves on (the taxi call, moving off after a readback, the ready call), s of the traffic clock. */
  at: number;
  route: NedXY[];
  wp: number;
  spot: ParkingSpot | null;
  exit: string | null;
  /** The runway end its ground route serves. */
  end: RunwayEnd;
  /** Where it is flying straight to, and the height above the field. */
  target: { north: number; east: number; height: number } | null;
  /** Cleared for take-off. */
  cleared: boolean;
  /** Moving on the apron (the other AI aircraft wait for it). */
  apron: boolean;
  /** The calls made in this phase. */
  calls: Set<CallId>;
}

interface Aircraft {
  field: Airfield;
  typeId: AircraftId;
  type: TrafficType;
  registration: string;
  /** The voice it speaks in. */
  voice: number;
  path: CircuitPath;
  state: TrafficState;
  mesh: TrafficMesh;
  /** A flight model: flown (physics) near the player, or posed on the ground for its exterior; else null (kinematic). */
  pilot: TrafficPilot | null;
  physics: boolean;
  exterior: TrafficExterior | null;
  /** Calls made on this lap, so each is made once. */
  said: Set<CallId>;
  /** The wind now favours the other end: the aircraft changes over after its next take-off. */
  nextEnd: RunwayEnd | null;
  /** The home field's aircraft, working Ground and the tower (null at the generated fields). */
  ops: HomeOps | null;
  /** The home stations that have answered it (the abbreviated callsign from then on). */
  contacted: Set<'tower' | 'ground'>;
}

/** A small deterministic hash of a string (FNV-1a). */
function hash(s: string): number {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

/** A registration for the aircraft at a field, by the lessons' authority: N-number under the FAA, G- under EASA. */
export function trafficRegistration(code: string, a: Authority): string {
  const h = hash(code);
  const L = (n: number) => String.fromCharCode(65 + (n % 26));
  return a === 'faa' ? `N${100 + (h % 900)}${L(h >>> 10)}${L(h >>> 15)}` : `G-${L(h >>> 3)}${L(h >>> 8)}${L(h >>> 13)}${L(h >>> 18)}`;
}

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

export interface TrafficDeps {
  /** The lessons' authority now (the calls' wording and the registrations). */
  authority: () => Authority;
  /** The world the flight models fly in (the player's: terrain, wind, atmosphere). Absent: every aircraft kinematic. */
  env?: () => Environment;
  /** Draw the near aircraft with their own exteriors (default true; tests in node leave it off). */
  exteriors?: boolean;
  /** Definition and visual loaders (default the aircraft registry's). */
  loadDefinition?: (id: AircraftId) => Promise<AircraftDefinition>;
  loadVisual?: (id: AircraftId) => Promise<AirframeVisualDef>;
  /** Traffic at the home field too (default none; the Simulator's: not during a lesson). */
  homeTraffic?: () => boolean;
  /** The player's registration and type, for the tower's sequencing (absent: the tower sees only the traffic). */
  player?: () => { registration: string; icaoType: string };
}

export class TrafficSystem implements Subsystem {
  private ctx!: SimContext;
  private readonly group = new THREE.Group();
  private aircraft: Aircraft[] = [];
  private fields: readonly Airfield[] | null = null;
  private authority: Authority = 'easa';
  private clock = 0;
  private outbox: Transmission[] = [];
  /** Transmissions waiting their turn (the controllers' answers, the readbacks), by the traffic clock. */
  private later: { at: number; tx: Transmission }[] = [];
  private home = false;
  private towerClock = 0;
  /** The home traffic's choices (types, spots, plans, timings), and the next arrival's time. */
  private random = seededRandom(1);
  private nextArrival = Infinity;
  private homeCount = 0;
  /** The home field's controller: the landing sequence and the runway. */
  readonly tower = new HomeTower();
  private unsubscribe: (() => void) | null = null;
  private readonly camPos = new THREE.Vector3();
  private readonly definitions = new Map<AircraftId, AircraftDefinition | 'loading'>();
  private readonly visuals = new Map<AircraftId, AirframeVisualDef | 'loading'>();

  constructor(private readonly deps: TrafficDeps) {
    this.group.name = 'circuit-traffic';
  }

  init(ctx: SimContext): void {
    this.ctx = ctx;
    ctx.scene.add(this.group);
    this.sync();
    this.unsubscribe = ctx.events?.on('reset', () => {
      this.tower.reset();
      this.later = [];
      for (const a of this.aircraft) a.contacted.clear();
    }) ?? null;
  }

  dispose(): void {
    this.unsubscribe?.();
    this.clear();
    this.group.removeFromParent();
  }

  /** The calls made since the last drain. */
  drain(): Transmission[] {
    const out = this.outbox;
    this.outbox = [];
    return out;
  }

  /** The aircraft now, for tests and the dev tools. */
  get states(): readonly { field: Airfield; registration: string; type: TrafficType; state: TrafficState; path: CircuitPath; pilot: TrafficPilot | null; ops: Readonly<HomeOps> | null }[] {
    return this.aircraft;
  }

  private readonly targetCache = new Map<string, TowerTarget>();

  /** The aircraft drawn now, for the tower view's binoculars to follow (three.js world frame). */
  viewTargets(): readonly TowerTarget[] {
    const out: TowerTarget[] = [];
    for (const a of this.aircraft) {
      const root = a.exterior?.root.visible ? a.exterior.root : a.mesh.root;
      if (!root.visible) continue;
      let t = this.targetCache.get(a.registration);
      if (!t) this.targetCache.set(a.registration, (t = { id: a.registration, label: '', position: new THREE.Vector3(), fitSize: 13 }));
      t.label = `${a.registration}, ${TYPE_NAMES[a.type]}`;
      if (a.pilot) nedToThree(a.pilot.state.position, t.position);
      else nedToThree({ x: a.state.north, y: a.state.east, z: -(a.field.elevation + a.state.height) }, t.position);
      out.push(t);
    }
    return out;
  }

  private clear(): void {
    for (const a of [...this.aircraft]) this.remove(a);
  }

  /**
   * One aircraft per generated field, rebuilt when the seed (the field list) or the authority changes; the home
   * field's traffic started or taken away as homeTraffic() says.
   */
  private sync(): void {
    const fields = generatedAirfields();
    const authority = this.deps.authority();
    const home = this.deps.homeTraffic?.() ?? false;
    if (fields === this.fields && authority === this.authority && home === this.home) return;
    const sameFields = fields === this.fields;
    this.fields = fields;
    this.authority = authority;
    if (sameFields) {
      // Only the registrations change; the aircraft fly on.
      for (const a of this.aircraft) if (!a.ops) a.registration = trafficRegistration(a.field.code, authority);
    } else {
      this.clear();
      this.home = false;
      fields.forEach((field, i) => this.addField(field, i));
    }
    if (home !== this.home) {
      this.home = home;
      if (home) this.startHome();
      else {
        for (const a of this.aircraft.filter((x) => x.ops)) this.remove(a);
        this.nextArrival = Infinity;
      }
    }
  }

  /** A generated field's circuit aircraft, somewhere round its circuit. */
  private addField(field: Airfield, i: number): void {
    const w = this.ctx.weather;
    const h = hash(field.code);
    const type = TYPES[h % TYPES.length];
    const path = circuitPath(field, runwayInUse(field, w.windDirectionDeg, w.windSpeedKt));
    const leg = 1 + (h >>> 4) % 4;
    const state = placeOnLeg(path, leg, ((h >>> 8) % 100) / 100 * 0.8 + 0.1);
    this.push(field, type, trafficRegistration(field.code, this.authority), path, state, i, null);
  }

  private push(field: Airfield, type: (typeof TYPES)[number], registration: string, path: CircuitPath, state: TrafficState, trim: number, ops: HomeOps | null): Aircraft {
    const mesh = buildTrafficMesh(type.icao, TRIMS[trim % TRIMS.length]);
    this.group.add(mesh.root);
    const a: Aircraft = {
      field, typeId: type.id, type: type.icao, registration, voice: (hash(registration) >>> 11) % 16, path, state, mesh, pilot: null, physics: false, exterior: null,
      said: new Set(), nextEnd: null, ops, contacted: new Set(),
    };
    this.aircraft.push(a);
    return a;
  }

  private remove(a: Aircraft): void {
    this.ground(a);
    a.mesh.root.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Points) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
    a.mesh.root.removeFromParent();
    this.aircraft = this.aircraft.filter((x) => x !== a);
    this.targetCache.delete(a.registration);
    if (a.ops) this.tower.forget(a.registration);
  }

  // -- The home field's traffic ----------------------------------------------------------------------------------

  private homeEnd(): RunwayEnd {
    const w = this.ctx.weather;
    return runwayInUse(HOME_AIRFIELD, w.windDirectionDeg, w.windSpeedKt);
  }

  /** A new home aircraft (not yet placed). */
  private addHome(plan: HomeOps['plan']): Aircraft {
    const n = this.homeCount++;
    const type = TYPES[Math.floor(this.random() * TYPES.length)];
    const end = this.homeEnd();
    const ops: HomeOps = {
      phase: 'parked', plan, laps: plan === 'circuits' ? 2 + Math.floor(this.random() * 3) : 0, at: Infinity, route: [], wp: 0, spot: null, exit: null, end,
      target: null, cleared: false, apron: false, calls: new Set(),
    };
    const path = circuitPath(HOME_AIRFIELD, end);
    return this.push(HOME_AIRFIELD, type, trafficRegistration(`${HOME_AIRFIELD.code}${n}`, this.authority), path, placeOnLeg(path, 2, 0), n + 3, ops);
  }

  /** The home traffic to begin with: one in the circuit, one about to depart, one inbound; then arrivals now and then. */
  private startHome(): void {
    this.random = seededRandom(20261031);
    const c = this.addHome('circuits');
    Object.assign(c.state, placeOnLeg(c.path, 2, 0.2));
    c.ops!.phase = 'air';
    const d = this.addHome(this.random() < 0.7 ? 'away' : 'circuits');
    this.park(d, this.freeSpot(), 40);
    this.spawnArrival();
    this.nextArrival = this.clock + ARRIVAL_EVERY * (1 + this.random());
  }

  private homeAircraft(): Aircraft[] {
    return this.aircraft.filter((a) => a.ops);
  }

  /** An arrival 11 km out on a random bearing, heading for the field. */
  private spawnArrival(): void {
    if (this.homeAircraft().length >= MAX_HOME) return;
    const a = this.addHome('circuits');
    const o = a.ops!;
    o.laps = 0;
    const f = HOME_AIRFIELD;
    const brg = this.random() * 2 * Math.PI;
    const north = f.north + Math.cos(brg) * INBOUND_DISTANCE;
    const east = f.east + Math.sin(brg) * INBOUND_DISTANCE;
    Object.assign(a.state, { north, east, height: INBOUND_HEIGHT, heading: wrap(brg + Math.PI), bank: 0, pitch: 0, speed: 100 * KT, verticalSpeed: 0, onGround: false, rollTime: 0, fullStop: true });
    o.phase = 'inbound';
    o.at = this.clock + 3;
    // The start of downwind, at circuit height.
    const dw = a.path.legs[2].from;
    const p = pathPoint(a.path, dw.along + 400, dw.across);
    o.target = { ...p, height: CIRCUIT_HEIGHT };
  }

  /** A spot to park on: free of the other aircraft and the player. */
  private freeSpot(): ParkingSpot {
    const st = this.ctx.state;
    const taken = new Set(this.homeAircraft().map((a) => a.ops!.spot?.name));
    const spots = freeSpots();
    const free = spots.filter((s) => {
      if (taken.has(s.name)) return false;
      const p = localPoint(s);
      if (Math.hypot(p.north - st.position.x, p.east - st.position.y) < 25) return false;
      return !this.homeAircraft().some((a) => a.state.onGround && Math.hypot(p.north - a.state.north, p.east - a.state.east) < 20);
    });
    const pool = free.length ? free : spots;
    return pool[Math.floor(this.random() * pool.length)];
  }

  /** Parked on a spot (engine off), departing after `wait` seconds. */
  private park(a: Aircraft, spot: ParkingSpot, wait: number): void {
    const o = a.ops!;
    const p = localPoint(spot);
    Object.assign(a.state, { north: p.north, east: p.east, height: 0, heading: localHeading(0, spot.facing), bank: 0, pitch: 0, speed: 0, verticalSpeed: 0, onGround: true, fullStop: false });
    a.state.heading = wrap(a.state.heading);
    Object.assign(o, { phase: 'parked', spot, at: this.clock + wait, route: [], wp: 0, apron: false, cleared: false, exit: null, target: null });
    o.calls.clear();
    o.plan = this.random() < 0.7 ? 'away' : 'circuits';
    o.laps = o.plan === 'circuits' ? 2 + Math.floor(this.random() * 3) : 0;
    a.said.clear();
  }

  /** Another AI aircraft is moving on the apron. */
  private apronBusy(a: Aircraft): boolean {
    return this.aircraft.some((x) => x !== a && x.ops?.apron);
  }

  /** Something on the ground just ahead of this taxiing aircraft: the player or another aircraft. */
  private blocked(a: Aircraft): boolean {
    const s = a.state;
    const ahead = (n: number, e: number): boolean => {
      const d = Math.hypot(n - s.north, e - s.east);
      return d > 0.5 && d < GAP_AHEAD && Math.abs(wrap(Math.atan2(e - s.east, n - s.north) - s.heading)) < GAP_CONE;
    };
    const st = this.ctx.state;
    if (st.onGround && ahead(st.position.x, st.position.y)) return true;
    return this.aircraft.some((x) => x !== a && x.ops && x.state.onGround && ahead(x.state.north, x.state.east));
  }

  /** The home field's lights for what it is doing. */
  private homeLights(a: Aircraft): void {
    const ph = a.ops!.phase;
    const L = a.pilot!.controls.lights;
    const on = ph !== 'parked';
    const rolling = ph === 'lined' || ph === 'lineUp' || AIRBORNE.has(ph);
    Object.assign(L, { nav: on, beacon: on, strobe: rolling, landing: rolling, taxi: on && !rolling });
  }

  /** Full stop on this landing, or a touch and go. */
  private setFullStop(a: Aircraft, full: boolean): void {
    a.state.fullStop = full;
    if (a.pilot) a.pilot.fullStop = full;
  }

  private spawnTick(): void {
    if (!this.home || this.clock < this.nextArrival) return;
    this.nextArrival = this.clock + ARRIVAL_EVERY * (1 + this.random());
    this.spawnArrival();
  }

  /** One home aircraft's step: its phase's movement, calls and changes. */
  private stepHome(a: Aircraft, dt: number, env: Environment | undefined): void {
    const o = a.ops!;
    const s = a.state;
    const flown = a.pilot && a.physics && env;
    switch (o.phase) {
      case 'parked':
        if (this.clock >= o.at && !this.apronBusy(a)) this.requestTaxi(a);
        return;
      case 'taxiOut':
        o.wp = stepTaxi(s, o.route, o.wp, dt, this.clock >= o.at && !this.blocked(a) ? TAXI_SPEED : 0);
        if (o.wp >= TAXI_OUT_OFF_APRON) o.apron = false;
        if (o.wp >= o.route.length) {
          o.phase = 'holding';
          o.at = this.clock + 4;
        }
        return;
      case 'holding':
        if (!o.calls.has('ready') && this.clock >= o.at) this.callReady(a);
        return;
      case 'lineUp':
        o.wp = stepTaxi(s, o.route, o.wp, dt, this.clock >= o.at ? 5 : 0);
        if (o.wp >= o.route.length) {
          o.phase = 'lined';
          o.at = Math.max(o.at, this.clock + 2);
        }
        return;
      case 'lined':
        if (o.cleared && this.clock >= o.at) this.takeOff(a);
        return;
      case 'vacate':
        o.wp = stepTaxi(s, o.route, o.wp, dt, this.blocked(a) ? 0 : o.wp === 0 ? VACATE_SPEED : TAXI_SPEED);
        if (o.wp >= o.route.length) {
          o.phase = 'clear';
          o.at = this.clock + 3;
        }
        return;
      case 'clear':
        if (!o.calls.has('clear') && this.clock >= o.at) this.callClear(a);
        return;
      case 'taxiIn': {
        let go = this.clock >= o.at && !this.blocked(a);
        if (go && o.wp >= TAXI_IN_ON_APRON && !o.apron) {
          if (this.apronBusy(a)) go = false;
          else o.apron = true;
        }
        o.wp = stepTaxi(s, o.route, o.wp, dt, go ? TAXI_SPEED : 0);
        if (o.wp >= o.route.length) this.park(a, o.spot!, PARK_FOR * (1 + this.random()));
        return;
      }
      case 'inbound':
      case 'outbound': {
        const t = o.target!;
        if (flown) {
          a.pilot!.step(dt, env);
          a.pilot!.handBack(s);
        } else stepDirect(s, t.north, t.east, t.height, (o.phase === 'inbound' ? 100 : 95) * KT, dt);
        const f = HOME_AIRFIELD;
        const fromField = Math.hypot(s.north - f.north, s.east - f.east);
        if (o.phase === 'inbound') {
          if (!o.calls.has('inbound') && this.clock >= o.at) this.callInbound(a);
          if (Math.hypot(t.north - s.north, t.east - s.east) < 700) this.joinCircuit(a);
        } else {
          if (!o.calls.has('leaving') && fromField > LEAVING_CALL) this.callLeaving(a);
          if (fromField > GONE) this.remove(a);
        }
        return;
      }
      case 'air': {
        let changed: number | null;
        if (flown) {
          changed = a.pilot!.step(dt, env);
          a.pilot!.handBack(s);
        } else changed = stepTraffic(a.path, s, dt);
        this.afterCircuitStep(a, changed);
        if (o.plan === 'away' && !s.onGround && (s.leg === 1 || s.height > TURN_OUT_HEIGHT)) this.turnOut(a);
        else if (s.onGround && s.fullStop && (a.physics && a.pilot ? a.pilot.state.groundSpeed : s.speed) < VACATE_SPEED) this.vacate(a);
        else this.announce(a);
        return;
      }
    }
  }

  /** A touchdown or a lap's legs: a new lap's calls, the usual circuit again, the full stop on the last lap. */
  private afterCircuitStep(a: Aircraft, changed: number | null): void {
    const w = this.ctx.weather;
    if (changed === 0 && a.state.onGround) {
      // A touchdown: a new lap, the usual circuit again; if the wind now favours the other end, change over once airborne again.
      a.said.clear();
      if (a.path.extension > 0) {
        a.path = circuitPath(a.field, a.path.end);
        a.pilot?.extend(a.path);
      }
      if (a.ops && !a.state.fullStop) a.ops.laps = Math.max(0, a.ops.laps - 1);
      const end: RunwayEnd = runwayInUse(a.field, w.windDirectionDeg, w.windSpeedKt);
      a.nextEnd = end !== a.path.end ? end : null;
    }
    if (a.nextEnd !== null && a.state.leg === 0 && a.state.height > 300 * FT) this.changeEnds(a, a.nextEnd);
  }

  /** Ground: taxi to the holding point of the runway in use (moving off once it has read the clearance back). */
  private requestTaxi(a: Aircraft): void {
    const o = a.ops!;
    o.apron = true;
    o.end = this.homeEnd();
    o.route = taxiOutRoute(o.spot!, o.end);
    o.wp = 0;
    o.spot = null;
    o.phase = 'taxiOut';
    o.at = this.clock + ANSWER_DELAY * 2 + 3;
    this.converse(a, 'ground', 'taxi');
  }

  /** Tower: ready at the holding point; the answer is acted on (cleared, line up and wait, hold). */
  private callReady(a: Aircraft): void {
    const o = a.ops!;
    o.calls.add('ready');
    const kind = this.converse(a, 'tower', 'ready');
    this.instructed(a, kind, ANSWER_DELAY * 2 + 1);
  }

  /** A clearance for a departure: line up (and go, if cleared for take-off). */
  private instructed(a: Aircraft, kind: TowerKind | null, delay: number): void {
    const o = a.ops!;
    if (kind !== 'takeoff' && kind !== 'lineUp') return;
    if (kind === 'takeoff') o.cleared = true;
    if (o.phase === 'holding') {
      o.phase = 'lineUp';
      o.route = lineUpRoute(o.end);
      o.wp = 0;
    }
    o.at = this.clock + delay;
  }

  /** Rolling: the circuit from a standing start on the runway. */
  private takeOff(a: Aircraft): void {
    const o = a.ops!;
    a.path = circuitPath(HOME_AIRFIELD, o.end);
    Object.assign(a.state, { heading: runwayHeading(o.end), speed: 0, leg: 0, onGround: true, rollTime: ROLL_HOLD, height: 0, bank: 0, pitch: 0, verticalSpeed: 0 });
    this.setFullStop(a, false);
    o.phase = 'air';
    o.cleared = false;
    o.calls.clear();
    a.said.clear();
    // Posed for its exterior: onto the flight model from here (chooseFlown makes it physics).
    if (a.pilot && !a.physics) this.ground(a);
  }

  /** Leaving the circuit: a turn out toward a point 16 km away on a random bearing, climbing. */
  private turnOut(a: Aircraft): void {
    const o = a.ops!;
    const f = HOME_AIRFIELD;
    const brg = this.random() * 2 * Math.PI;
    o.target = { north: f.north + Math.cos(brg) * 16000, east: f.east + Math.sin(brg) * 16000, height: OUTBOUND_HEIGHT };
    o.phase = 'outbound';
    if (a.pilot && a.physics) a.pilot.flyDirect(o.target.north, o.target.east, f.elevation + o.target.height, 95);
  }

  /** At the start of downwind: the circuit from there, a full stop at the end of it. */
  private joinCircuit(a: Aircraft): void {
    const o = a.ops!;
    o.phase = 'air';
    a.path = circuitPath(HOME_AIRFIELD, this.homeEnd());
    const s = a.state;
    s.leg = 2;
    this.setFullStop(a, o.laps === 0);
    a.said.clear();
    if (a.pilot && a.physics) a.pilot.setPath(a.path, 2);
  }

  /** Slow on the runway after a full stop: the tower says where to vacate; it rolls off to just past the hold line. */
  private vacate(a: Aircraft): void {
    const o = a.ops!;
    const s = a.state;
    if (a.pilot && a.physics) {
      a.pilot.handBack(s);
      s.speed = Math.min(s.speed, a.pilot.state.groundSpeed);
      a.physics = false;
    }
    s.onGround = true;
    s.height = 0;
    o.end = a.path.end;
    o.exit = arrivalExit(o.end, s.north, s.east);
    o.route = vacateRoute(o.exit);
    o.wp = 0;
    o.phase = 'vacate';
    o.calls.clear();
    const sit = this.situation(a, 'tower');
    const msg = vacateInstruction(sit, o.exit);
    const rb = vacateReadback(sit, o.exit);
    if (msg) {
      a.contacted.add('tower');
      this.controllerSays('tower', msg, 0.5);
      if (rb) this.aircraftSays(a, rb, 0.5 + ANSWER_DELAY, HOME_AIRFIELD.frequency);
    }
  }

  /** Ground: clear of the runway, taxi to the apron; it moves off to a free spot once it has read that back. */
  private callClear(a: Aircraft): void {
    const o = a.ops!;
    o.calls.add('clear');
    this.converse(a, 'ground', 'clear');
    o.spot = this.freeSpot();
    o.route = taxiInRoute(o.exit!, o.end, o.spot);
    o.wp = 0;
    o.phase = 'taxiIn';
    o.at = this.clock + ANSWER_DELAY * 2 + 2;
  }

  private callInbound(a: Aircraft): void {
    a.ops!.calls.add('inbound');
    this.converse(a, 'tower', 'inbound');
  }

  private callLeaving(a: Aircraft): void {
    a.ops!.calls.add('leaving');
    this.converse(a, 'tower', 'leaving');
  }

  /**
   * A call to the home tower or ground and its answer: the aircraft's call now, the controller's answer (the
   * tower's sequencing, else calls.ts replyTo) and the aircraft's readback after it. Returns what the answer said to do.
   */
  private converse(a: Aircraft, kind: 'tower' | 'ground', call: CallId, intent?: Intent): TowerKind | null {
    const sit = this.situation(a, kind);
    const c = callsFor(sit).find((x) => x.id === call && (x.intent === undefined || x.intent === intent));
    const freq = kind === 'tower' ? HOME_AIRFIELD.frequency : HOME_GROUND;
    if (c) this.aircraftSays(a, c.line, 0, freq);
    const tower: TowerReply | null = kind === 'tower' ? this.tower.call(this.towerView(), a.registration, call, intent) : null;
    const line = tower?.line ?? replyTo(sit, call, intent);
    if (!line) return null;
    a.contacted.add(kind);
    this.controllerSays(kind, line, ANSWER_DELAY);
    const rb = tower ? tower.readback : readbackFor(sit, call, intent);
    if (rb) this.aircraftSays(a, rb, ANSWER_DELAY * 2, freq);
    return tower?.kind ?? null;
  }

  // -- Every frame ------------------------------------------------------------------------------------------------

  update(dt: number): void {
    this.sync();
    this.clock += dt;
    const cam = this.ctx.camera.getWorldPosition(this.camPos);
    this.spawnTick();
    this.chooseFlown(cam);
    const env = this.deps.env?.();
    for (const a of [...this.aircraft]) {
      if (a.ops) {
        this.stepHome(a, dt, env);
        if (!this.aircraft.includes(a)) continue;
        if (a.pilot && !a.physics) {
          a.pilot.pose(a.state, a.field.elevation, dt, a.ops.phase !== 'parked');
          this.homeLights(a);
        }
      } else {
        let changed: number | null;
        if (a.pilot && a.physics && env) {
          changed = a.pilot.step(dt, env);
          a.pilot.handBack(a.state);
        } else changed = stepTraffic(a.path, a.state, dt);
        this.afterCircuitStep(a, changed);
        if (!a.state.onGround && a.state.leg === 4 && a.state.height < GO_AROUND_HEIGHT && this.runwayBlocked(a.field)) this.goAround(a);
        this.announce(a);
      }
      if (a.pilot?.state.crashed) {
        // Should not happen; if it does, the stand-in takes over on downwind rather than leave a wreck.
        console.warn(`[traffic] ${a.registration} crashed at ${a.field.code}: back to the kinematic circuit`);
        this.ground(a);
        Object.assign(a.state, placeOnLeg(a.path, 2, 0.1));
        if (a.ops) a.ops.phase = 'air';
      }
      this.pose(a, cam);
    }
    if ((this.towerClock -= dt) <= 0) {
      this.towerClock = TOWER_PERIOD;
      this.control();
    }
    this.later = this.later.filter((l) => {
      if (l.at > this.clock) return true;
      this.outbox.push(l.tx);
      return false;
    });
  }

  /** The home field's aircraft as the tower sees them, the player first. */
  private towerView(): TowerView {
    const f = HOME_AIRFIELD;
    const w = this.ctx.weather;
    const end = this.homeEnd();
    const list: TowerAircraft[] = [];
    const me = this.deps.player?.();
    if (me) {
      const st = this.ctx.state;
      const n = st.position.x, e = st.position.y;
      const { along } = activeFrame(f, end, n, e);
      const height = st.altitudeMSL - f.elevation;
      const dist = Math.hypot(n - f.north, e - f.east);
      const heading = st.groundSpeed > 2 ? st.track : st.heading;
      const leg = st.onGround || height > CIRCUIT_CEILING ? null : circuitLeg(f, end, n, e, heading);
      const inCircuit = leg !== null && (dist < CIRCUIT_RADIUS || (leg === 'final' && dist < LONG_FINAL));
      const path = circuitPath(f, end);
      const index = path.legs.findIndex((l) => l.id === leg);
      list.push({
        id: 'player', callsign: callsign(me.registration, me.icaoType, this.authority), type: maker(me.icaoType),
        height, onGround: st.onGround, onRunway: st.onGround && onRunway(n, e),
        leg: inCircuit ? leg : null, remaining: inCircuit ? circuitRemaining(path, index, n, e) : Infinity, along,
      });
    }
    for (const a of this.aircraft) {
      const o = a.ops;
      if (!o) continue;
      const s = a.state;
      // In the landing sequence: in the circuit, not a departure on its way out.
      const leg = o.phase === 'air' && !s.onGround && !(o.plan === 'away' && s.leg === 0) ? a.path.legs[s.leg].id : null;
      list.push({
        id: a.registration, callsign: callsign(a.registration, a.type, this.authority), type: maker(a.type), height: s.height, onGround: s.onGround,
        onRunway: s.onGround && onRunway(s.north, s.east), leg, remaining: leg ? circuitRemaining(a.path, s.leg, s.north, s.east) : Infinity,
        along: activeFrame(a.field, a.path.end, s.north, s.east).along,
      });
    }
    return { authority: this.authority, windFromDeg: w.windDirectionDeg, windKt: w.windSpeedKt, aircraft: list };
  }

  /** The tower's answer to the player's call (RadioSystem), or null where calls.ts replyTo answers. */
  towerReply(call: CallId, intent?: Intent): TowerReply | null {
    if (!this.deps.player) return null;
    return this.tower.call(this.towerView(), 'player', call, intent);
  }

  /** A controller's transmission from the home field's antenna, now or after a delay. */
  private controllerSays(kind: 'tower' | 'ground', line: Phrase, delay: number, toPlayer?: { readback?: Phrase }): void {
    const f = HOME_AIRFIELD;
    const tx: Transmission = {
      frequency: kind === 'tower' ? f.frequency : HOME_GROUND, north: f.north, east: f.east, heightAgl: ANTENNA, line, speaker: 0, actor: kind,
      ...(toPlayer ? { toPlayer: true, readback: toPlayer.readback } : {}),
    };
    if (delay > 0) this.later.push({ at: this.clock + delay, tx });
    else this.outbox.push(tx);
  }

  /** An aircraft's transmission, now or after a delay (its readback), on a frequency (its field's by default). */
  private aircraftSays(a: Aircraft, line: Phrase, delay: number, frequency = a.field.frequency): void {
    const s = a.state;
    const tx: Transmission = { frequency, north: s.north, east: s.east, heightAgl: Math.max(2, s.height), line, speaker: a.voice };
    if (delay > 0) this.later.push({ at: this.clock + delay, tx });
    else this.outbox.push(tx);
  }

  /** The home tower's own instructions: clearances that were waiting, go-arounds, following traffic on downwind. */
  private control(): void {
    if (!this.home && !this.deps.player) return;
    const v = this.towerView();
    const out = this.tower.update(v);
    for (const m of out.messages) {
      if (m.to === 'player') {
        this.controllerSays('tower', m.line, 0, { readback: m.readback });
        continue;
      }
      const a = this.aircraft.find((x) => x.ops && x.registration === m.to);
      if (!a) continue;
      this.controllerSays('tower', m.line, 0);
      if (m.readback) this.aircraftSays(a, m.readback, ANSWER_DELAY);
      this.instructed(a, m.kind, ANSWER_DELAY + 1);
    }
    for (const id of out.goAround) {
      const a = this.aircraft.find((x) => x.ops && x.registration === id);
      if (a) this.goAround(a, ANSWER_DELAY);
    }
    for (const id of out.follow) {
      const a = this.aircraft.find((x) => x.ops && x.registration === id);
      if (a) this.follow(a);
    }
  }

  /** Following traffic: base moved out so it stays ahead of the aircraft on downwind. */
  private follow(a: Aircraft): void {
    const s = a.state;
    const { along } = activeFrame(a.field, a.path.end, s.north, s.east);
    const want = along - turnLead(s.speed) - FOLLOW_LEAD;
    const baseAt = a.path.legs[3].from.along;
    if (baseAt < want + 50) return;
    const extension = Math.min(MAX_EXTENSION, a.path.extension + (baseAt - want));
    if (extension <= a.path.extension) return;
    a.path = circuitPath(a.field, a.path.end, extension);
    a.pilot?.extend(a.path);
  }

  /**
   * Which aircraft have a flight model: the nearest MAX_FLOWN airborne within range of the player fly on it
   * (physics), while the time acceleration allows; the nearest MAX_POSED on the ground within exterior range of the
   * camera stand on one (posed). The others are kinematic, handed back where they are.
   */
  private chooseFlown(cam: THREE.Vector3): void {
    const env = this.deps.env;
    const st = this.ctx.state;
    const allowed = env !== undefined && (this.ctx.timeScale ?? 1) <= FLOWN_MAX_TIME_SCALE;
    const airborne = (a: Aircraft) => !a.ops || AIRBORNE.has(a.ops.phase);
    const dist = (a: Aircraft) => Math.hypot(a.state.north - st.position.x, a.state.east - st.position.y);
    const flown = this.aircraft
      .filter((a) => allowed && airborne(a))
      .map((a) => ({ a, d: dist(a) }))
      .filter(({ a, d }) => d < (a.physics ? FLOWN_EXIT : FLOWN_RANGE))
      .sort((x, y) => x.d - y.d);
    const physics = new Set(flown.slice(0, MAX_FLOWN).map((r) => r.a));
    const posed = this.aircraft
      .filter((a) => env !== undefined && this.deps.exteriors !== false && !airborne(a))
      .map((a) => ({ a, d: this.cameraDistance(a, cam) }))
      .filter(({ a, d }) => d < EXTERIOR_RANGE + (a.pilot ? 300 : 0))
      .sort((x, y) => x.d - y.d);
    const pose = new Set(posed.slice(0, MAX_POSED).map((r) => r.a));
    for (const a of this.aircraft) {
      if (physics.has(a)) {
        if (!a.pilot) this.fly(a);
        else if (!a.physics) this.resume(a);
      } else if (pose.has(a)) {
        if (a.pilot && a.physics) this.ground(a);
        if (!a.pilot) this.fly(a, true);
      } else if (a.pilot) this.ground(a);
    }
  }

  /** Distance from the camera to where it is drawn, m. */
  private cameraDistance(a: Aircraft, cam: THREE.Vector3): number {
    const root = a.exterior?.root.visible ? a.exterior.root : a.mesh.root;
    return root.position.distanceTo(cam);
  }

  /** A posed aircraft onto the flight model where it stands (taking off). */
  private resume(a: Aircraft): void {
    const env = this.deps.env?.();
    if (!env || !a.pilot) return;
    a.pilot.start(env, a.path, a.state);
    a.physics = true;
    this.directed(a);
  }

  /** On the flight model, a direct leg is flown as one. */
  private directed(a: Aircraft): void {
    const o = a.ops;
    if (!o?.target || !a.pilot || (o.phase !== 'inbound' && o.phase !== 'outbound')) return;
    a.pilot.flyDirect(o.target.north, o.target.east, HOME_AIRFIELD.elevation + o.target.height, o.phase === 'inbound' ? 100 : 95);
  }

  /** Onto a flight model (once its definition has loaded): flown, or posed on the ground; its exterior loaded. */
  private fly(a: Aircraft, posed = false): void {
    const def = this.definitions.get(a.typeId);
    if (def === undefined) {
      this.definitions.set(a.typeId, 'loading');
      (this.deps.loadDefinition ?? loadAircraft)(a.typeId).then(
        (d) => this.definitions.set(a.typeId, d),
        (e: unknown) => console.warn(`[traffic] no ${a.typeId} definition:`, e),
      );
      return;
    }
    if (def === 'loading') return;
    const env = this.deps.env?.();
    if (!env) return;
    a.pilot = new TrafficPilot(def, a.path);
    a.pilot.start(env, a.path, a.state);
    a.physics = !posed;
    if (!posed) this.directed(a);
    if (this.deps.exteriors === false) return;
    const visual = this.visuals.get(a.typeId);
    if (visual === undefined) {
      this.visuals.set(a.typeId, 'loading');
      (this.deps.loadVisual ?? ((id: AircraftId) => loadAirframeVisual(id)))(a.typeId).then(
        (v) => this.visuals.set(a.typeId, v),
        (e: unknown) => console.warn(`[traffic] no ${a.typeId} exterior:`, e),
      );
    }
  }

  /** Back to the kinematic aircraft where it is; the exterior goes. */
  private ground(a: Aircraft): void {
    if (a.pilot && a.physics) a.pilot.handBack(a.state);
    a.pilot = null;
    a.physics = false;
    a.exterior?.dispose();
    a.exterior = null;
  }

  /** The player is on this field's runway (lined up, landing or taxiing across it). */
  private runwayBlocked(f: Airfield): boolean {
    const st = this.ctx.state;
    if (!st.onGround) return false;
    const { along, across } = activeFrame(f, 0, st.position.x, st.position.y);
    return Math.abs(across) < f.width / 2 + 10 && Math.abs(along) < f.length / 2 + 30;
  }

  /** Something on the runway: go around, climbing away on the upwind leg, and say so (after the tower's instruction). */
  private goAround(a: Aircraft, delay = 0): void {
    const line = this.callFor(a, 'goAround');
    if (a.physics) a.pilot?.goAround();
    a.state.leg = 0;
    a.said.clear();
    if (line) this.aircraftSays(a, line, delay);
  }

  /**
   * The wind has swung round: climbing out past the far end of the runway, the aircraft is already on the line of
   * the other end's downwind (flown the same way), so it joins that circuit's downwind from there.
   */
  private changeEnds(a: Aircraft, end: RunwayEnd): void {
    a.path = circuitPath(a.field, end);
    a.state.leg = 2;
    if (a.physics) a.pilot?.setPath(a.path, 2);
    a.nextEnd = null;
    a.said.clear();
  }

  /** The circuit calls: downwind abeam the runway, base once turned onto it (not to a tower), final once lined up. */
  private announce(a: Aircraft): void {
    const s = a.state;
    if (s.onGround) return;
    const leg = a.path.legs[s.leg].id;
    if (a.said.has(leg)) return;
    if (a.ops?.plan === 'away') return;
    const { along, across } = activeFrame(a.field, a.path.end, s.north, s.east);
    const due =
      leg === 'downwind' ? along < 0 :
      leg === 'base' ? !a.ops && Math.abs(across) < Math.abs(a.path.legs[3].from.across) * 0.8 :
      leg === 'final' ? Math.abs(across) < 60 :
      false;
    if (!due) return;
    a.said.add(leg);
    if (!a.ops) {
      const line = this.callFor(a, leg);
      if (line) this.aircraftSays(a, line, 0);
      return;
    }
    // The last lap is the full stop.
    if (leg === 'downwind') this.setFullStop(a, a.ops.laps === 0);
    // Already cleared (an FAA tower clears on downwind): no final call.
    if (leg === 'final' && this.tower.cleared(a.registration)) return;
    this.converse(a, 'tower', leg, s.fullStop ? 'fullStop' : 'touchAndGo');
  }

  /** What an aircraft would say on its field's frequency (a generated field's common frequency, the home tower). */
  private callFor(a: Aircraft, call: CallId): Phrase | null {
    const sit = this.situation(a, a.ops ? 'tower' : 'traffic');
    const intent: Intent = a.state.fullStop ? 'fullStop' : 'touchAndGo';
    return callsFor(sit).find((c) => c.id === call && (c.intent === undefined || c.intent === intent))?.line ?? null;
  }

  /** An aircraft's radio situation toward one of its field's stations. */
  private situation(a: Aircraft, kind: 'tower' | 'ground' | 'traffic'): RadioSituation {
    const s = a.state;
    const w = this.ctx.weather;
    const cs: Callsign = callsign(a.registration, a.type, this.authority);
    const frequency = kind === 'ground' ? HOME_GROUND : a.field.frequency;
    return {
      authority: this.authority, callsign: cs, station: { field: a.field, kind, frequency }, contacted: kind !== 'traffic' && a.contacted.has(kind),
      north: s.north, east: s.east, altitude: a.field.elevation + s.height, onGround: s.onGround, groundSpeedKt: s.speed / KT, heading: s.heading,
      windFromDeg: w.windDirectionDeg, windKt: w.windSpeedKt, qnhHpa: w.qnhHpa, landedAgoS: a.ops?.phase === 'clear' ? 10 : Infinity,
      atisLetter: kind === 'traffic' || w.timeOfDay === undefined ? '' : String.fromCharCode(65 + (Math.floor(w.timeOfDay) % 24)),
    };
  }

  private pose(a: Aircraft, cam: THREE.Vector3): void {
    const s = a.state;
    const root = a.mesh.root;
    if (a.pilot && this.deps.exteriors !== false) {
      const visual = this.visuals.get(a.typeId);
      if (!a.exterior && visual && visual !== 'loading') {
        a.exterior = new TrafficExterior(visual, a.registration);
        this.group.add(a.exterior.root);
      }
      if (a.exterior) {
        const st = a.pilot.state;
        applyPose(a.exterior.root, st.position, st.orientation);
        a.exterior.root.visible = a.exterior.root.position.distanceTo(cam) < EXTERIOR_RANGE;
        if (a.exterior.root.visible) {
          a.exterior.update(this.clock, st, a.pilot.controls, this.ctx.camera, this.ctx.renderer, this.ctx.sky, this.ctx.weather);
          root.visible = false;
          return;
        }
      }
    }
    const pos = { x: s.north, y: s.east, z: -(a.field.elevation + s.height) };
    applyPose(root, pos, quat.fromEuler(s.bank, s.pitch, s.heading));
    root.visible = root.position.distanceTo(cam) < DRAW_RANGE;
    a.mesh.flash(this.clock + a.voice * 0.37);
  }
}

/** A parking spot in NED. */
function localPoint(spot: ParkingSpot): NedXY {
  return localToNed(spot.u, spot.v);
}
