// Mass, centre of gravity and inertia of an aircraft as fuel burns and payload changes, built from its MassDef
// and its fuel tanks (by default the Cessna 172S's).
//
// The definition gives the moments of inertia at a stated loading (MassDef.inertiaLoading), either about the
// reference point, that loading then being taken to balance there (the C172S: empty aircraft + default crew +
// full usable fuel, with its CG at the quarter-chord of the MAC), or about the CG of that loading, with the empty
// CG stated. The empty airframe's inertia and CG follow by removing those items, and the current values are
// rebuilt from the empty airframe plus the current payload and fuel as point masses (the fuel in the wing tanks
// is what dominates the change in roll and yaw inertia). Only Ixz is carried; the inertia does not change with
// the gear position.

import { C172S_MASS } from '../aircraft/c172s/systems';
import type { MassDef, PayloadDef } from '../aircraft/types';
import type { Vec3 } from '../core/math';
import { C172_POWERPLANT } from './propulsion/c172Powerplant';
import type { TankDef } from './propulsion/defs';
import { inertiaAboutCG, type Inertia } from './rigidBody';

/** Front-seat occupants sit this far either side of the centreline (pilot eye point, core/c172.ts). */
export const SEAT_Y = C172S_MASS.seatY;

/** The Cessna 172S's loading: payload and the fuel in its two tanks. */
export interface Loading {
  /** Occupants and baggage, kg. */
  payload: number;
  /** Payload centroid (reference-point body axes); the mass is split between two seats either side. */
  payloadPosition: Vec3;
  /** Usable fuel in each tank, kg. */
  fuelLeft: number;
  fuelRight: number;
}

/** A loading of any type: payload, and the usable fuel in each tank in the definition's order, kg. */
export interface MassLoading {
  payload: number;
  payloadPosition: Vec3;
  tanks: ArrayLike<number>;
}

export interface MassProperties {
  mass: number;
  /** CG relative to the reference point, body axes, m. */
  cgOffset: Vec3;
  /** Inertia about the CG, body axes. */
  inertia: Inertia;
}

export interface MassModel {
  /** Payload that brings a full-fuel aircraft to maximum take-off weight, kg. */
  readonly maxGrossPayload: number;
  /** Mass properties for a loading. */
  properties(l: MassLoading): MassProperties;
  /** One of the definition's named loadings, with its fuel (fuelFraction of every tank's capacity). */
  loadingFor(kind: keyof MassDef['loadings']): MassLoading;
}

type PointMass = { m: number; x: number; y: number; z: number };

/** Inertia contribution of point masses about the reference point. */
function pointInertia(points: readonly PointMass[]): Inertia {
  const I = { Ixx: 0, Iyy: 0, Izz: 0, Ixz: 0 };
  for (const p of points) {
    I.Ixx += p.m * (p.y * p.y + p.z * p.z);
    I.Iyy += p.m * (p.x * p.x + p.z * p.z);
    I.Izz += p.m * (p.x * p.x + p.y * p.y);
    I.Ixz += p.m * p.x * p.z;
  }
  return I;
}

/** The mass model of a type: `mass` and its fuel tanks (whose positions place the fuel). */
export function createMassModel(mass: MassDef = C172S_MASS, tanks: readonly TankDef[] = C172_POWERPLANT.fuel.tanks): MassModel {
  const seatY = mass.seatY;

  /** Two seat masses either side of the payload centroid, then one point per tank. */
  const loadPoints = (l: MassLoading): PointMass[] => {
    const p = l.payloadPosition;
    const points: PointMass[] = [
      { m: l.payload / 2, x: p.x, y: p.y - seatY, z: p.z },
      { m: l.payload / 2, x: p.x, y: p.y + seatY, z: p.z },
    ];
    for (let k = 0; k < tanks.length; k++) {
      const t = tanks[k].position;
      points.push({ m: l.tanks[k], x: t.x, y: t.y, z: t.z });
    }
    return points;
  };

  const loadingOf = (d: PayloadDef): MassLoading => ({
    payload: d.payload,
    payloadPosition: d.payloadPosition,
    tanks: tanks.map((t) => (d.fuelFraction === undefined ? t.capacity : d.fuelFraction * t.capacity)),
  });

  // Empty airframe: mass, CG and inertia about the reference point.
  const m = mass.empty;
  const items = loadPoints(loadingOf(mass.inertiaLoading));
  const cg = { x: 0, y: 0, z: 0 };
  let given = mass.inertia as Inertia;
  if (mass.inertia.about === 'referencePoint' && !mass.emptyCg) {
    // The inertia loading balances at the reference point, which places the empty CG.
    for (const p of items) {
      cg.x -= (p.m * p.x) / m;
      cg.y -= (p.m * p.y) / m;
      cg.z -= (p.m * p.z) / m;
    }
  } else {
    if (!mass.emptyCg) throw new Error('createMassModel: an inertia about the CG needs the empty CG');
    Object.assign(cg, mass.emptyCg);
    if (mass.inertia.about === 'cg') {
      // Moved from the CG of the inertia loading to the reference point (parallel axes).
      let total = m, mx = m * cg.x, my = m * cg.y, mz = m * cg.z;
      for (const p of items) {
        total += p.m;
        mx += p.m * p.x;
        my += p.m * p.y;
        mz += p.m * p.z;
      }
      const x = mx / total, y = my / total, z = mz / total;
      const I = mass.inertia;
      given = {
        Ixx: I.Ixx + total * (y * y + z * z),
        Iyy: I.Iyy + total * (x * x + z * z),
        Izz: I.Izz + total * (x * x + y * y),
        Ixz: I.Ixz + total * x * z,
      };
    }
  }
  const Iitems = pointInertia(items);
  const empty: Inertia = {
    Ixx: given.Ixx - Iitems.Ixx,
    Iyy: given.Iyy - Iitems.Iyy,
    Izz: given.Izz - Iitems.Izz,
    Ixz: given.Ixz - Iitems.Ixz,
  };

  let fuel = 0;
  for (const t of tanks) fuel += t.capacity;

  return {
    maxGrossPayload: mass.maxTakeoff - mass.empty - fuel,
    properties(l: MassLoading): MassProperties {
      const items = loadPoints(l);
      let total = m;
      let mx = m * cg.x;
      let my = m * cg.y;
      let mz = m * cg.z;
      for (const p of items) {
        total += p.m;
        mx += p.m * p.x;
        my += p.m * p.y;
        mz += p.m * p.z;
      }
      const cgOffset = { x: mx / total, y: my / total, z: mz / total };
      const Ii = pointInertia(items);
      const aboutRef: Inertia = {
        Ixx: empty.Ixx + Ii.Ixx,
        Iyy: empty.Iyy + Ii.Iyy,
        Izz: empty.Izz + Ii.Izz,
        Ixz: empty.Ixz + Ii.Ixz,
      };
      return { mass: total, cgOffset, inertia: inertiaAboutCG(aboutRef, total, cgOffset) };
    },
    loadingFor: (kind) => loadingOf(mass.loadings[kind]),
  };
}

// The Cessna 172S under the names this module has always exported.
const C172S_MASS_MODEL = createMassModel();

/** Payload that makes a full-fuel C172S exactly maximum take-off weight, kg. */
export const MAX_GROSS_PAYLOAD = C172S_MASS_MODEL.maxGrossPayload;

/** Mass properties of the C172S for a loading. */
export function massProperties(l: Loading): MassProperties {
  return C172S_MASS_MODEL.properties({ payload: l.payload, payloadPosition: l.payloadPosition, tanks: [l.fuelLeft, l.fuelRight] });
}
