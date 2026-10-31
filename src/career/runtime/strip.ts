// The in-flight job strip's model (docs/career.md "In flight", JobStripModel): what the strip at the top centre
// shows, worked out from the job and one moment of the flight. The DOM strip (src/career/ui/strip.ts) only
// formats it; the monitor (monitor.ts) assembles the input each frame.
//
// - target: the next scenic turning point while any remain ("Point B, 7 NM north-east"), else the destination
//   ("KELM Elmley Aerodrome", or a site's name), with distance (NM) and true bearing from the aircraft.
// - etaMin to the end of the job (through any remaining turning points to the destination, so the strip's "early"
//   or "late" against the time left is the whole job's) at the present ground speed, or the type's planning cruise
//   TAS when slower than half of it (on the ground, in the climb-out); remainingMin = deadline less job time
//   (negative: late).
// - waypointIndex: the next turning point's index, null once every point is behind (the target is then the
//   destination); waypointsTotal stays the route's count on a scenic job.
// - enduranceMin: the fuel aboard at the planning cruise flow (as the load sheet); projectedReserveMin: what is
//   left on arrival at the destination (through the remaining turning points) at the present burn (the planning
//   flow when the engines are not yet burning in flight), in minutes of planning cruise flow.
// - spotDistM for helicopters within SPOT_LINE_M of the landing spot (the destination's stand, or the site),
//   since the stands have no painted H yet.
// - comfort: the running score on jobs where comfort is paid (PAY_RULES comfortWeight > 0), else null.
// - hint: one line of what to do next (jobHint).
//
// Pure.

import { NM } from '../../core/math';
import type { Airfield } from '../../world/airfields';
import { enduranceMin as enduranceAtCruise } from '../costs';
import { bearingDeg, fieldByCode, fieldStand } from '../geo';
import { PAY_RULES, type CareerPerf, type JobOffer, type JobPhase, type JobStripModel } from '../types';

/** Helicopters within this distance of the landing spot see the distance to it, m. */
export const SPOT_LINE_M = 1000;
/** Below this fraction of the planning cruise TAS the ETA uses the cruise TAS. */
export const ETA_MIN_GS_FRACTION = 0.5;

/** A point with a label: the next turning point or the destination. */
export interface StripTarget {
  label: string;
  north: number;
  east: number;
}

/** Where the job ends: the destination field's runway centre, or the site; null for an unknown field code. */
export function destinationPoint(offer: JobOffer, fields: readonly Airfield[]): StripTarget | null {
  const d = offer.destination;
  if (d.kind === 'site') return { label: d.name, north: d.north, east: d.east };
  const f = fieldByCode(d.code, fields);
  return f ? { label: `${f.code} ${f.name}`, north: f.north, east: f.east } : null;
}

/** The helicopter landing spot at the destination: its stand (src/career/geo.ts fieldStand), or the site. */
export function landingSpot(offer: JobOffer, fields: readonly Airfield[]): { north: number; east: number } | null {
  const d = offer.destination;
  if (d.kind === 'site') return { north: d.north, east: d.east };
  const f = fieldByCode(d.code, fields);
  return f ? fieldStand(f) : null;
}

/** What jobHint needs. */
export interface HintInput {
  phase: JobPhase;
  everAirborne: boolean;
  helicopter: boolean;
  /** The destination's label ("KELM Elmley Aerodrome"). */
  destination: string;
  /** Scenic: the next turning point's name, index (0-based) and the total; null when none remain or on other kinds. */
  waypoint: { name: string; index: number; total: number } | null;
  /** On the ground inside the destination (or at its site). */
  atDestination: boolean;
  /** Shut down without the brake long enough for the brake hint (CompletionTracker.brakeHint). */
  brakeHint: boolean;
  /** Phase 'stopped': the field code held at. */
  stoppedAt?: string;
}

/** One line of what to do next. */
export function jobHint(h: HintInput): string {
  switch (h.phase) {
    case 'dispatched':
      return h.helicopter ? `Start up, then depart for ${h.destination}` : `Start the engine and taxi out for ${h.destination}`;
    case 'ground':
      if (h.waypoint) return `Take off for ${h.waypoint.name}`;
      return `Take off for ${h.destination}`;
    case 'airborne':
      if (h.waypoint) return `Fly over ${h.waypoint.name} (${h.waypoint.index + 1} of ${h.waypoint.total})`;
      return `Fly to ${h.destination}`;
    case 'landed':
      if (h.brakeHint) return 'Set the parking brake (or wait) to finish';
      if (h.atDestination) return h.helicopter ? 'Shut down to finish' : 'Taxi clear of the runway, stop and shut down to finish';
      if (h.waypoint) return `Take off again for ${h.waypoint.name}`;
      return `Shut down here to stop, or take off again for ${h.destination}`;
    case 'stopped':
      return `Stopped at ${h.stoppedAt ?? 'this field'}: refuel, continue or give up`;
    case 'done':
      return 'Job finished';
  }
}

/** One moment of the flight, for jobStrip. */
export interface StripInput {
  offer: JobOffer;
  fields: readonly Airfield[];
  perf: CareerPerf;
  helicopter: boolean;
  /** Position, NED m. */
  north: number;
  east: number;
  gsKt: number;
  /** Fuel aboard, kg. */
  fuelKg: number;
  /** Present burn of all engines, kg/h. */
  fuelFlowKgH: number;
  airborne: boolean;
  /** Job sim seconds. */
  elapsedS: number;
  phase: JobPhase;
  /** Scenic: index of the next turning point (waypoints.length when all are done); 0 on other kinds. */
  nextWaypoint: number;
  comfort: number;
  hint: string;
}

/** Ground speed for an ETA, kt: the present one, or the planning cruise TAS when slower than half of it. */
export function etaSpeedKt(gsKt: number, perf: CareerPerf): number {
  return gsKt >= ETA_MIN_GS_FRACTION * perf.cruiseTasKt ? gsKt : perf.cruiseTasKt;
}

/** The strip model for one moment of the job. */
export function jobStrip(x: StripInput): JobStripModel {
  const { offer, perf } = x;
  const wps = offer.waypoints ?? [];
  const dest = destinationPoint(offer, x.fields) ?? { label: '', north: x.north, east: x.east };
  const next = x.nextWaypoint < wps.length ? wps[x.nextWaypoint] : null;
  const target: StripTarget = next ? { label: next.name, north: next.north, east: next.east } : dest;
  const here = { north: x.north, east: x.east };
  const distanceNm = Math.hypot(target.north - x.north, target.east - x.east) / NM;
  const speed = etaSpeedKt(x.gsKt, perf);
  // The route still to fly: to the target, through the remaining turning points, to the destination.
  let routeNm = distanceNm;
  let p: { north: number; east: number } = target;
  for (let i = x.nextWaypoint + 1; next && i < wps.length; i++) {
    routeNm += Math.hypot(wps[i].north - p.north, wps[i].east - p.east) / NM;
    p = wps[i];
  }
  if (next) routeNm += Math.hypot(dest.north - p.north, dest.east - p.east) / NM;
  const routeMin = (routeNm / speed) * 60;
  const flow = x.airborne && x.fuelFlowKgH > 0 ? x.fuelFlowKgH : perf.fuelFlowKgH;
  const spot = x.helicopter ? landingSpot(offer, x.fields) : null;
  const spotDist = spot ? Math.hypot(spot.north - x.north, spot.east - x.east) : Infinity;
  return {
    title: offer.title,
    target: target.label,
    distanceNm,
    bearingDeg: distanceNm > 0 ? bearingDeg(here, target) : 0,
    etaMin: routeMin,
    remainingMin: offer.deadlineMin - x.elapsedS / 60,
    enduranceMin: enduranceAtCruise(perf, x.fuelKg),
    projectedReserveMin: ((x.fuelKg - (flow * routeMin) / 60) / perf.fuelFlowKgH) * 60,
    waypointIndex: next ? x.nextWaypoint : null,
    waypointsTotal: wps.length > 0 ? wps.length : null,
    windDirDeg: offer.windDirDeg,
    windKt: offer.windKt,
    spotDistM: spotDist <= SPOT_LINE_M ? spotDist : null,
    comfort: PAY_RULES[offer.kind].comfortWeight > 0 ? x.comfort : null,
    phase: x.phase,
    hint: x.hint,
  };
}
