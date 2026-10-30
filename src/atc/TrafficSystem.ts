// Circuit traffic (docs/atc.md, step 3): one AI light aircraft flying touch-and-go circuits at each generated
// airfield, on the runway the wind favours, announcing itself on the field's common frequency as the player would
// (downwind, base, final; the wording from calls.ts callsFor, so the phrasebook is shared). This subsystem only
// flies and draws them and queues their transmissions; RadioSystem decides what the player hears (COM1 tuned to the
// frequency, the avionics on, within line of sight). Kinematics only (circuit.ts): no collision or separation with
// the player yet. Present day only (built where the Flight School is); the home field's circuit waits for its tower.

import * as THREE from 'three';
import type { SimContext, Subsystem } from '../core/context';
import { quat } from '../core/math';
import { applyPose } from '../core/frames';
import { generatedAirfields, type Airfield } from '../world/airfields';
import { activeFrame, callsFor, runwayInUse, type CallId, type RadioSituation, type RunwayEnd } from './calls';
import { circuitPath, placeOnLeg, stepTraffic, type CircuitPath, type TrafficState } from './circuit';
import { callsign, type Authority, type Callsign, type Phrase } from './phrases';
import { buildTrafficMesh, type TrafficMesh, type TrafficType } from './trafficMesh';

/** A circuit aircraft's call, for the radio to hear or not. */
export interface Transmission {
  frequency: number;
  north: number;
  east: number;
  /** Height above the ground, m (its line of sight). */
  heightAgl: number;
  line: Phrase;
  /** Which aircraft (a voice per aircraft). */
  speaker: number;
}

/** On final below this height above the field with the runway occupied, the aircraft goes around, m. */
const GO_AROUND_HEIGHT = 400 * 0.3048;
/** Drawn within this distance of the camera, m. */
const DRAW_RANGE = 20000;
const TYPES: readonly TrafficType[] = ['C172', 'C152', 'PA28'];
const TRIMS = [0x1d4f9c, 0xb3261e, 0x1f7a3a, 0x2b2b2b, 0xd08a12, 0x6a2c91, 0x0f7c86, 0x8a1c3c];

interface Aircraft {
  field: Airfield;
  type: TrafficType;
  registration: string;
  path: CircuitPath;
  state: TrafficState;
  mesh: TrafficMesh;
  /** Calls made on this lap, so each is made once. */
  said: Set<CallId>;
  /** The wind now favours the other end: the aircraft changes over after its next take-off. */
  nextEnd: RunwayEnd | null;
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

export interface TrafficDeps {
  /** The lessons' authority now (the calls' wording and the registrations). */
  authority: () => Authority;
}

export class TrafficSystem implements Subsystem {
  private ctx!: SimContext;
  private readonly group = new THREE.Group();
  private aircraft: Aircraft[] = [];
  private fields: readonly Airfield[] | null = null;
  private authority: Authority = 'easa';
  private clock = 0;
  private outbox: Transmission[] = [];
  private readonly camPos = new THREE.Vector3();

  constructor(private readonly deps: TrafficDeps) {
    this.group.name = 'circuit-traffic';
  }

  init(ctx: SimContext): void {
    this.ctx = ctx;
    ctx.scene.add(this.group);
    this.sync();
  }

  dispose(): void {
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
  get states(): readonly { field: Airfield; registration: string; state: TrafficState; path: CircuitPath }[] {
    return this.aircraft;
  }

  private clear(): void {
    for (const a of this.aircraft) {
      a.mesh.root.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.Points) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
      a.mesh.root.removeFromParent();
    }
    this.aircraft = [];
  }

  /** One aircraft per generated field, rebuilt when the seed (the field list) or the authority changes. */
  private sync(): void {
    const fields = generatedAirfields();
    const authority = this.deps.authority();
    if (fields === this.fields && authority === this.authority) return;
    const sameFields = fields === this.fields;
    this.fields = fields;
    this.authority = authority;
    if (sameFields) {
      // Only the registrations change; the aircraft fly on.
      for (const a of this.aircraft) a.registration = trafficRegistration(a.field.code, authority);
      return;
    }
    this.clear();
    const w = this.ctx.weather;
    fields.forEach((field, i) => {
      const h = hash(field.code);
      const type = TYPES[h % TYPES.length];
      const path = circuitPath(field, runwayInUse(field, w.windDirectionDeg, w.windSpeedKt));
      // Somewhere round the circuit, different at each field.
      const leg = 1 + (h >>> 4) % 4;
      const state = placeOnLeg(path, leg, ((h >>> 8) % 100) / 100 * 0.8 + 0.1);
      const mesh = buildTrafficMesh(type, TRIMS[i % TRIMS.length]);
      this.group.add(mesh.root);
      this.aircraft.push({ field, type, registration: trafficRegistration(field.code, authority), path, state, mesh, said: new Set(), nextEnd: null });
    });
  }

  update(dt: number): void {
    this.sync();
    this.clock += dt;
    const w = this.ctx.weather;
    const cam = this.ctx.camera.getWorldPosition(this.camPos);
    for (const [i, a] of this.aircraft.entries()) {
      const changed = stepTraffic(a.path, a.state, dt);
      if (changed === 0 && a.state.onGround) {
        // A touchdown: a new lap; if the wind now favours the other end, change over once airborne again.
        a.said.clear();
        const end: RunwayEnd = runwayInUse(a.field, w.windDirectionDeg, w.windSpeedKt);
        a.nextEnd = end !== a.path.end ? end : null;
      }
      if (a.nextEnd !== null && a.state.leg === 0 && a.state.height > 300 * 0.3048) this.changeEnds(a, a.nextEnd);
      if (!a.state.onGround && a.state.leg === 4 && a.state.height < GO_AROUND_HEIGHT && this.runwayBlocked(a.field)) this.goAround(a, i);
      this.announce(a, i);
      this.pose(a, cam, i);
    }
  }

  /** The player is on this field's runway (lined up, landing or taxiing across it). */
  private runwayBlocked(f: Airfield): boolean {
    const st = this.ctx.state;
    if (!st.onGround) return false;
    const { along, across } = activeFrame(f, 0, st.position.x, st.position.y);
    return Math.abs(across) < f.width / 2 + 10 && Math.abs(along) < f.length / 2 + 30;
  }

  /** Something on the runway: go around, climbing away on the upwind leg, and say so. */
  private goAround(a: Aircraft, speaker: number): void {
    const line = this.callFor(a, 'goAround');
    a.state.leg = 0;
    a.said.clear();
    const s = a.state;
    if (line) this.outbox.push({ frequency: a.field.frequency, north: s.north, east: s.east, heightAgl: s.height, line, speaker });
  }

  /**
   * The wind has swung round: climbing out past the far end of the runway, the aircraft is already on the line of
   * the other end's downwind (flown the same way), so it joins that circuit's downwind from there.
   */
  private changeEnds(a: Aircraft, end: RunwayEnd): void {
    a.path = circuitPath(a.field, end);
    a.state.leg = 2;
    a.nextEnd = null;
    a.said.clear();
  }

  /** The circuit calls: downwind abeam the runway, base once turned onto it, final once lined up. */
  private announce(a: Aircraft, speaker: number): void {
    const s = a.state;
    if (s.onGround) return;
    const leg = a.path.legs[s.leg].id;
    if (a.said.has(leg)) return;
    const { along, across } = activeFrame(a.field, a.path.end, s.north, s.east);
    const due =
      leg === 'downwind' ? along < 0 :
      leg === 'base' ? Math.abs(across) < Math.abs(a.path.legs[3].from.across) * 0.8 :
      leg === 'final' ? Math.abs(across) < 60 :
      false;
    if (!due) return;
    a.said.add(leg);
    const line = this.callFor(a, leg);
    if (line) this.outbox.push({ frequency: a.field.frequency, north: s.north, east: s.east, heightAgl: s.height, line, speaker });
  }

  private callFor(a: Aircraft, leg: CallId): Phrase | null {
    const s = a.state;
    const w = this.ctx.weather;
    const cs: Callsign = callsign(a.registration, a.type, this.authority);
    const situation: RadioSituation = {
      authority: this.authority, callsign: cs, station: { field: a.field, kind: 'traffic', frequency: a.field.frequency }, contacted: false,
      north: s.north, east: s.east, altitude: a.field.elevation + s.height, onGround: false, groundSpeedKt: s.speed / 0.514444, heading: s.heading,
      windFromDeg: w.windDirectionDeg, windKt: w.windSpeedKt, qnhHpa: w.qnhHpa, landedAgoS: Infinity, atisLetter: '',
    };
    const call = callsFor(situation).find((c) => c.id === leg && (c.intent === undefined || c.intent === 'touchAndGo'));
    return call?.line ?? null;
  }

  private pose(a: Aircraft, cam: THREE.Vector3, i: number): void {
    const s = a.state;
    const root = a.mesh.root;
    const pos = { x: s.north, y: s.east, z: -(a.field.elevation + s.height) };
    applyPose(root, pos, quat.fromEuler(s.bank, s.pitch, s.heading));
    root.visible = root.position.distanceTo(cam) < DRAW_RANGE;
    a.mesh.flash(this.clock + i * 0.37);
  }
}
