// Navigation signals the panel displays: what the NAV receivers are tuned to (the home field's ILS 07 on 110.30 and
// VOR on 113.90, an ILS at each sealed generated field, a second VOR on 116.80; navaids()) and GPS quantities relative
// to the destination airfield (the home field unless the pilot chose another). Pure geometry on the flat-earth NED
// frame; courses and radials are true (the world has no magnetic variation).

import { DEG, KT, NM, RAD, clamp, wrapTwoPi, type Vec3 } from '../../core/math';
import { airfields, HOME_AIRFIELD, type Airfield } from '../../world/airfields';

/** ICAO Annex 10 ILS geometry. */
const LOC_ANTENNA_BEYOND_END = 300; // m past the far (stop) end
const LOC_HALF_WIDTH = 2.5 * DEG; // full-scale deflection
const LOC_RANGE = 18 * NM;
const LOC_COVERAGE = 35 * DEG;
const GS_ANGLE = 3 * DEG;
const GS_HALF_WIDTH = 0.7 * DEG; // full-scale deflection
const GS_ORIGIN_FROM_THRESHOLD = 300; // m, glide path intercept point past the threshold
const GS_RANGE = 10 * NM;
const GS_COVERAGE = 8 * DEG;

export interface IlsSignal {
  locValid: boolean;
  gsValid: boolean;
  /** Needle deflection as a fraction of full scale, -1..1 (+ = needle right = runway centreline is right). */
  loc: number;
  /** + = needle up = glide path above the aircraft. */
  gs: number;
}

/** What a NAV receiver gets: an ILS (loc and gs as IlsSignal), a VOR (locValid and the radial), or nothing. */
export interface NavSignal extends IlsSignal {
  kind: NavaidKind | null;
  /** The VOR radial the aircraft is on (from the station), degrees true; NaN off a VOR. */
  radialDeg: number;
}

export function emptyNavSignal(): NavSignal {
  return { kind: null, locValid: false, gsValid: false, loc: 0, gs: 0, radialDeg: NaN };
}

export type NavaidKind = 'ils' | 'vor';

export interface Navaid {
  kind: NavaidKind;
  /** 'I-FBL', 'FBL'. */
  ident: string;
  /** 'Fable Regional ILS 07', 'Elmley VOR'. */
  name: string;
  frequency: number;
  field: Airfield;
  /** The ILS's runway end (the landing direction it serves). */
  end: 0 | 1;
  north: number;
  east: number;
  elevation: number;
}

/** ILS channels: odd tenths from 108.10 to 111.95, on the 50 kHz raster. */
const ILS_CHANNELS: number[] = [];
for (let t = 1081; t <= 1119; t += 2) ILS_CHANNELS.push(t / 10, t / 10 + 0.05);
const HOME_ILS = 110.3;
const HOME_VOR = 113.9;
const FAR_VOR = 116.8;
/** VOR coverage: line of sight, at most this far. */
const VOR_RANGE = 60 * NM;
/** VOR deviation at full scale (five dots), rad. */
export const VOR_HALF_WIDTH = 10 * DEG;

let cache: { fields: readonly Airfield[]; list: Navaid[] } | null = null;

/** Every navaid in the world (rebuilt when the airfields change: a new world seed). */
export function navaids(): readonly Navaid[] {
  const fields = airfields();
  if (cache?.fields === fields) return cache.list;
  const list: Navaid[] = [];
  const at = (f: Airfield) => ({ north: f.north, east: f.east, elevation: f.elevation });
  const short = (f: Airfield) => f.code.slice(-3);
  const ils = (f: Airfield, frequency: number): void => {
    list.push({ kind: 'ils', ident: `I-${short(f)}`, name: `${f.name} ILS ${f.ids[0]}`, frequency, field: f, end: 0, ...at(f) });
  };
  const vor = (f: Airfield, frequency: number): void => {
    list.push({ kind: 'vor', ident: short(f), name: `${f.name} VOR`, frequency, field: f, end: 0, ...at(f) });
  };
  ils(HOME_AIRFIELD, HOME_ILS);
  vor(HOME_AIRFIELD, HOME_VOR);
  const free = ILS_CHANNELS.filter((c) => Math.abs(c - HOME_ILS) > 0.01);
  const sealed = fields.filter((f) => f.kind === 'sealed');
  sealed.forEach((f, i) => ils(f, free[(i * 7) % free.length]));
  // The second VOR at the sealed field farthest from home: a cross-country fix.
  const far = [...sealed].sort((a, b) => Math.hypot(b.north, b.east) - Math.hypot(a.north, a.east))[0];
  if (far) vor(far, FAR_VOR);
  cache = { fields, list };
  return list;
}

/** The navaid a NAV frequency reaches from a position: the nearest one on it. */
export function navaidOn(mhz: number, north: number, east: number): Navaid | null {
  let best: Navaid | null = null;
  let bestD = Infinity;
  for (const n of navaids()) {
    if (Math.abs(n.frequency - mhz) > 0.004) continue;
    const d = Math.hypot(n.north - north, n.east - east);
    if (d < bestD) {
      bestD = d;
      best = n;
    }
  }
  return best;
}

/** A NAV receiver tuned to `mhz` at a NED position. */
export function receiveNav(mhz: number, position: Vec3, out: NavSignal): NavSignal {
  const n = navaidOn(mhz, position.x, position.y);
  out.kind = null;
  out.locValid = out.gsValid = false;
  out.loc = out.gs = 0;
  out.radialDeg = NaN;
  if (!n) return out;
  if (n.kind === 'ils') {
    ilsSignal(n.field, n.end, position, out);
    if (out.locValid) out.kind = 'ils';
    return out;
  }
  const dn = position.x - n.north;
  const de = position.y - n.east;
  const d = Math.hypot(dn, de);
  const hFt = Math.max(0, -position.z - n.elevation) / 0.3048;
  const range = Math.min(VOR_RANGE, 1.23 * (Math.sqrt(hFt) + Math.sqrt(30)) * NM);
  if (d > range || d < 150) return out;
  out.kind = 'vor';
  out.locValid = true;
  out.radialDeg = wrapTwoPi(Math.atan2(de, dn)) * RAD;
  return out;
}

/**
 * A VOR's needle for the course set on the OBS: deflection as a fraction of full scale (+ = needle right, the
 * course is to the right) and TO (+1) or FROM (-1).
 */
export function vorDeviation(radialDeg: number, courseDeg: number): { loc: number; toFrom: number } {
  const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
  const off = wrap((radialDeg - courseDeg) * DEG);
  if (Math.abs(off) > Math.PI / 2) {
    // TO: the course leads to the station, the aircraft on the reciprocal radial's side.
    return { loc: clamp(wrap(off - Math.PI) / VOR_HALF_WIDTH, -1, 1), toFrom: 1 };
  }
  return { loc: clamp(-off / VOR_HALF_WIDTH, -1, 1), toFrom: -1 };
}

/** The deviation needle of a NAV indicator: the ILS's localizer, or a VOR's from the course set on its OBS. */
export function navNeedle(sig: NavSignal, courseDeg: number): { loc: number; toFrom: number } {
  if (sig.kind === 'vor') return vorDeviation(sig.radialDeg, courseDeg);
  return { loc: sig.locValid ? sig.loc : 0, toFrom: 0 };
}

/** ILS runway 07 as received at a NED position. */
export function ils07(position: Vec3, out: IlsSignal): IlsSignal {
  return ilsSignal(HOME_AIRFIELD, 0, position, out);
}

/** A field's ILS for the runway end given, as received at a NED position. */
function ilsSignal(field: Airfield, end: 0 | 1, position: Vec3, out: IlsSignal): IlsSignal {
  // The runway frame in the landing direction (runwayCoords for any field and end).
  const hdg = field.heading + (end === 1 ? Math.PI : 0);
  const dn = position.x - field.north;
  const de = position.y - field.east;
  const along = dn * Math.cos(hdg) + de * Math.sin(hdg);
  const across = -dn * Math.sin(hdg) + de * Math.cos(hdg);
  // Localizer antenna beyond the far end; the aircraft approaches from the threshold side (along < 0).
  const toAntenna = field.length / 2 + LOC_ANTENNA_BEYOND_END - along;
  const locAngle = Math.atan2(across, toAntenna);
  const dist = Math.hypot(toAntenna, across);
  out.locValid = toAntenna > 0 && Math.abs(locAngle) < LOC_COVERAGE && dist < LOC_RANGE;
  // Aircraft right of the centreline -> fly left -> needle left.
  out.loc = out.locValid ? clamp(-locAngle / LOC_HALF_WIDTH, -1, 1) : 0;

  const gsAlong = -field.length / 2 + GS_ORIGIN_FROM_THRESHOLD - along;
  const height = -position.z - field.elevation;
  const gsDist = Math.hypot(gsAlong, across);
  const elevation = Math.atan2(height, gsDist);
  out.gsValid = out.locValid && gsAlong > 0 && gsDist < GS_RANGE && Math.abs(elevation - GS_ANGLE) < GS_COVERAGE;
  // Aircraft below the path -> fly up -> needle up.
  out.gs = out.gsValid ? clamp((GS_ANGLE - elevation) / GS_HALF_WIDTH, -1, 1) : 0;
  return out;
}

// The GPS destination (Direct-to): the home field unless the pilot chose another airfield (menu: Airfields).
let target: Airfield = HOME_AIRFIELD;

/** Fly the GPS direct to this airfield (by code); null or an unknown code: the home field. */
export function setGpsTarget(code: string | null): void {
  target = airfields().find((f) => f.code === code) ?? HOME_AIRFIELD;
}

/** The GPS destination. */
export function gpsTarget(): Airfield {
  return target;
}

export interface GpsData {
  /** Distance to the destination's reference point (its runway centre), NM. */
  distanceNm: number;
  /** Bearing to the airport, degrees true [0, 360). */
  bearingDeg: number;
  /** Degrees true. */
  trackDeg: number;
  groundSpeedKt: number;
}

export function gpsToAirport(position: Vec3, track: number, groundSpeedMs: number, out: GpsData): GpsData {
  const dn = target.north - position.x;
  const de = target.east - position.y;
  out.distanceNm = Math.hypot(dn, de) / NM;
  out.bearingDeg = wrapTwoPi(Math.atan2(de, dn)) * RAD;
  out.trackDeg = wrapTwoPi(track) * RAD;
  out.groundSpeedKt = groundSpeedMs / KT;
  return out;
}
