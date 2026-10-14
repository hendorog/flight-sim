// Deep Time, increment 2: the safari's first minute (WP0a contract, FROZEN for WP1-WP7; WP8 may retune the numbers
// within the sweep table below). Pure and three.js-free: no terrain, fauna or DOM reads, at load or call time
// (every number that depends on the terrain or the fauna was computed by scripts/safari-geometry.mjs and is pinned
// by tests/era/safariGeometry.test.ts, which re-derives it).
//
// FRAMES AND SIGNS
//   NED metres relative to the runway centre (core/world.ts AIRPORT): north, east, and heights MSL (up +).
//   The safari TRACK frame: s metres along the start track (forward +), c metres right of it (+ right).
//   Bearings are degrees off the nose, + right. Depression is degrees below the horizontal, + down.
//   The BODY frame is the aircraft's (nose up by its pitch); the SILL profile is measured in it.
//
// THE SAFARI START (computed, not chosen; see the tables below)
//   SAFARI: along 4870 m, across solved, track 20 deg right of the 25 direction (heading 270, due west, down the
//   valley toward the volcano), 450 ft above the ground at the start, 110 KIAS on the autoflight's heading and
//   altitude hold (the type's cruise; 110 KIAS for the C172), tod 20.0 (local solar time; the sun just set, 1.6 deg
//   below the horizon ~37 deg right of the nose; 19.0 until WP8's look gate round 2, see the sweep table).
//
// WHAT THE MEASUREMENTS CHANGED (versus the plan's draft numbers; the owner and WP8 should read this)
//   1. The cockpit SILL (scripts/safari-geometry.mjs sill, a magenta-background cockpit mask at the default head
//      pose: C172, vertical fov 60, head pitch -7, 1600 x 900, f = 779.4 px). In the body frame:
//        - windscreen (bearing -13..+43): glareshield / cowl 5.2-8.5 deg below the body horizontal (5.8 dead
//          ahead), header 15-16 deg up; the compass and its card hide +22..+30 above 5 deg;
//        - A-pillar: -14..-18 blocked at every elevation;
//        - LEFT DOOR WINDOW (-21..-45, the frame's edge): open down to 24-32 deg below the horizontal;
//        - right of the panel there is no window below 6.5 deg inside the 60 x 92 deg frame.
//      The plan assumed a 15 deg forward sill (nearest visible ground ~470 m slant at 400 ft). It is ~6 deg: at
//      450 ft the forward windscreen shows ground only beyond ~1.3 km. Near ground content can only be shown in
//      the LEFT DOOR WINDOW, at bearings 21-45 left and 8-30 deg down (slant ~300-1000 m at 450 ft).
//   2. So the river herd does NOT pass 100-150 m left of the track (the plan's lever, derived from the 15 deg
//      sill): at that offset it is under the glareshield from ~1.1 km to ~300 m ahead and crosses the door window
//      in ~3 s. It passes HERD_LATERAL_M (250 m since the WP8 look gate; 300 m before) left, where it is in the
//      door window for ~5-6 s (bodies 13-25 px),
//      and in the lower-left windscreen at the start (5-6 px). See the lateral table below.
//   3. Ahead-RIGHT ground content (the plan's Alamosaurus stand) can never be closer than ~1.3 km in the frame
//      (sill 6.5 deg). ALAMOSAURUS_STAND is therefore LEFT of the track beyond the herd, in the door window at
//      ~35-45 s. There is no araucaria within 1.5 km of the path (araucaria needs uplands; the floodplain is at
//      ~160 m): the stand is the nearest group of tall trees (see ALAMOSAURUS_STAND).
//   4. AGL: the clearance rule (>= 250 ft over the highest ground or tree top within 500 m of the first 6 km; the
//      critical trees are on the valley wall 500 m left of the start) leaves 254 ft at 400 ft and 304 ft at 450 ft
//      (track 20; tracks 27 and 35 fail at 450). 450 ft is chosen: the door-window pass does not change with AGL.
//   5. headPitchDeg cannot lower the windscreen sill (the glareshield is fixed to the eye point; head pitch only
//      moves the 60 deg frame, whose bottom is already 37 deg down). It stays null.
//   6. The default boot engages the safari's autoflight HOLD (heading 270, start altitude, 110 KIAS), as the plan's
//      firstMinute describes; without it the trimmed aircraft wanders +-15 deg of heading and ~300 m off track in a
//      minute (turbulence), which no anchor can follow. Any pilot input disconnects it (Simulator's overpower rule).
//   7. The Triceratops group is NOT the plan's herd + 100 m along + 120 m toward the track (under the glareshield at
//      G3, so it could never share the G3 frame with the stampede), nor "in the windscreen between the stampede and
//      the track" (no windscreen ground nearer than ~1.3 km). It stands beyond the herd on the far side from the
//      track, in the door window at G3 and G4 and clear of the T. rex's charge: see TRICERATOPS_ALONG_M.
//
// SWEEP TABLE (tod x track; sun relative bearing / elevation, dayFactor; volcano bearing; clearance at 450 ft)
//   At f = 779.4 px the frame's central 60 % of width is +-31.6 deg off the nose, the central 40 % +-22.3 deg.
//   track 20 (hdg 270.0): volcano +8.2 deg, 23.4 km;  clearance 450 ft: 304 ft (across 3220)
//     17.8: sun +14.6 / 18.8 day 1.00 | 18.3: +19.6 / 13.8 1.00 | 18.6: +22.6 / 10.9 1.00 | 19.0: +26.7 / 7.2 1.00 | 19.4: +30.9 / 3.6 0.92
//     (WP8 round 2, outside the plan's table) 19.6: sun x 1295-1327 px / 1.8 day 0.77 | 19.8: x 1336-1370 / 0.1 0.58 |
//     20.0: x 1379-1416 / -1.6 0.38 (night ramp 0.31 at 19.0, 0.80 at 19.8, 0.88 at 20.0)
//   track 27 (hdg 277.0): volcano +2.0 deg, 23.6 km;  clearance 450 ft: 216 ft (fails)
//     17.8: +7.6 / 18.8 | 18.3: +12.6 / 13.8 | 18.6: +15.6 / 10.9 | 19.0: +19.7 / 7.2 | 19.4: +23.9 / 3.6
//   track 35 (hdg 285.0): volcano -5.5 deg, 23.7 km;  clearance 450 ft: 183 ft (fails)
//     17.8: -0.4 / 18.8 | 18.3: +4.6 / 13.8 | 18.6: +7.6 / 10.9 | 19.0: +11.7 / 7.2 | 19.4: +15.9 / 3.6
//   Rule (plan firstMinute): sun outside the central 60 %, cone within 15 deg of the nose, dayFactor > 0.25, herd /
//   ground contrast >= 1.3. NO grid point puts the sun outside the central 60 % (flying west at dusk it is 0-31 deg
//   right of the nose everywhere; the best, track 20 at 19.4, is 466 of 480 px), so the plan's pre-authorised
//   fallback applies: outside the central 40 %. That leaves track 20 at 18.6 (barely: 324 px) to 19.4; only track 20
//   passes the clearance at 450 ft. 19.0 is chosen: the sun 392 px right of centre and 7 deg up, just above the
//   compass's deviation card (rendered at x 1206, y 266 px: glare beside the compass in the shots), and the crater glow ramp (eraLight.ts) at 0.31
//   at the start (WP5's > 0.15 gate; 18.6 gives 0.14). Rendered (W/shots/sweep, scripts/safari-geometry.mjs sweep:
//   the herd members' pixels vs a 10-16 px ring around them): the inc-1 Edmontosaurus reach a herd / ground contrast
//   of only 1.0-1.2 at every tod (best: 19.4 at G1, 1.2); none meets 1.3. That is the bodies' palette against the
//   olive marsh, not the light: WP7 / WP1-WP2 colours (and WP8's palette tuning) must carry it.
//
// WP8 LOOK GATE ROUND 2 (OWNER DECISION: outside the plan's 17.8-19.4 sweep): tod 19.0 -> 20.0. Round 1 found the
//   landmark absent at G1: with the sun 7 deg up and 26 deg right of the nose the cone (238/255) sat in the sun's
//   veil (5 % contrast) and the forward-scattered plume read brighter than the sky; at tod 10 the same cone read
//   well, so the limiter was the sun's geometry, not the haze. Extended sweep (W/shots/gate-2/sweep-tod, `sweep
//   --tods 19.6,19.8,20.0 --times 2,16,18,110`; herd / ground | cone / sky luminance contrast, the cone measured
//   below vs above its summit):
//     19.6:  t 2: 1.10 | 1.04   t 16: 1.00 | 1.01   t 18: 1.03 | 1.00   t 110: 1.01 | 1.20   (exposure log2 3.7)
//     19.8:  t 2: 1.06 | 1.20   t 16: 1.00 | 1.26   t 18: 1.03 | 1.28   t 110: 1.06 | 1.82   (2.5)
//     20.0:  t 2: 1.07 | 1.38   t 16: 1.01 | 1.41   t 18: 1.01 | 1.40   t 110: 1.06 | 2.10   (0.18)
//   (19.8 and 20.0 frames include the round-2 plume edits.) All three put the disc outside the central 60 % (480 px);
//   at 19.6 / 19.8 the low sun still reflects as a full disc in the left door glazing (x ~250). 20.0: the cone a
//   dark silhouette under a sunlit plume top, no veil, dayFactor 0.38 (> 0.25: the showcase flyers fly; ~0.35 at
//   G7), the crater ramp 0.88 (volcano.ts LAVA_DUSK_W re-pinned there). The herd / ground contrast is ~1.0 at
//   every tod (the bodies' colour carries the read, as before).//
// LATERAL TABLE (river herd centre left of the track at closest approach; 450 ft, the HOLD trajectory): seconds
// the herd centre is visible in the door window (bearing 21-45 left, above the sill) and its Edmontosaurus
// (9 m) size there; plus the windscreen at the start.
//   (`node scripts/safari-geometry.mjs solve --timeline 1`, track 20; identical at 400 ft)
//     L 125 m: door window 0.5 s, windscreen 4.5 s (5-6 px)   | L 300 m: door 7.5 s (9-22 px), windscreen 4 s
//     L 200 m: door 5 s,   windscreen 5.5 s                  | L 350 m: door 8.5 s (9-19 px), windscreen 2.5 s
//     L 250 m: door 6 s (13-25 px), windscreen 5.5 s         | L 400 m: door 10 s (7-17 px), windscreen 1.5 s
//   L = 300 m (across 3220) was WP0a's pick: the longest door-window pass that keeps bodies near 20 px. WP8's look
//   gate (round 0: the herd read as 4-8 px specks at the A-pillar) moved to L = 250 m (across 3277, solved with
//   `solve --timeline 1 --laterals 250`): fewer seconds, bigger bodies. Clearance at 450 ft there: 284 ft.
//
// AGL TABLE (track 20, across 3220; ft above the highest ground or tree top within 500 m of the first 6 km):
//   400 ft: 254 | 450 ft: 304 | 500 ft: 354 | 550 ft: 404. 450 ft chosen: the margin, and the door-window pass is
//   the same at 400 (the windscreen only gains a second of herd at 5 px).

import { DEG } from '../../core/math';
import { AIRPORT } from '../../core/world';

// ------------------------------------------------------------------------------------------------ the start

export interface SafariStart {
  /** Start position in the runway frame: m along the 07 direction, m to its right. */
  readonly along: number;
  readonly across: number;
  /** Track, deg right of the 25 direction (heading = 250 + trackDeg). */
  readonly trackDeg: number;
  /** Height above the ground at the start, ft. */
  readonly aglFt: number;
  /** Local solar time the safari boots at when the URL has no tod= (and the boot is not a resume), h. */
  readonly tod: number;
  /** Safari-only initial cockpit head pitch, deg (null: the aircraft's default view). A fallback knob, unused. */
  readonly headPitchDeg: number | null;
  /** Indicated airspeed held, kt. */
  readonly kias: number;
}

export const SAFARI: SafariStart = Object.freeze({
  along: 4870,
  across: 3277,
  trackDeg: 20,
  aglFt: 450,
  tod: 20.0,
  headPitchDeg: null,
  kias: 110,
});

/**
 * The start trajectory under the autoflight hold, measured by flying it in node (scripts/safari-geometry.mjs fly
 * --ap; SimPhysics, the Cretaceous weather: wind 100/6 kt, a 3 m/s tailwind): ground speed, the drift to the
 * right of the track (the light crosswind), the pitch attitude, and the altitude held (MSL). Over the first
 * 60 s the straight-line model below stays within SAFARI_MODEL_TOLERANCE_M of the flown path (pinned by the test).
 */
export const SAFARI_FLIGHT: { readonly groundSpeed: number; readonly driftRight: number; readonly pitchDeg: number; readonly startGround: number; readonly altitudeMSL: number } = Object.freeze({
  groundSpeed: 60.5,
  driftRight: 1.82,
  pitchDeg: 1.3,
  startGround: 164.5,
  altitudeMSL: 164.5 + 450 * 0.3048,
});
export const SAFARI_MODEL_TOLERANCE_M = 30;

/** Heading of the start track, rad (true). */
export function safariHeading(start: SafariStart = SAFARI): number {
  const h = AIRPORT.runway.heading + Math.PI + start.trackDeg * DEG;
  return ((h % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
}

export interface NedPoint {
  north: number;
  east: number;
}

/** The start position, NED (runway frame: along the 07 direction, across to its right). */
export function safariStartNed(start: SafariStart = SAFARI, out: NedPoint = { north: 0, east: 0 }): NedPoint {
  const h = AIRPORT.runway.heading;
  out.north = AIRPORT.runway.center.north + start.along * Math.cos(h) - start.across * Math.sin(h);
  out.east = AIRPORT.runway.center.east + start.along * Math.sin(h) + start.across * Math.cos(h);
  return out;
}

/** The point `s` m along the safari's start track and `c` m to its right, NED. */
export function pathToNed(s: number, c: number, out: NedPoint = { north: 0, east: 0 }, start: SafariStart = SAFARI): NedPoint {
  safariStartNed(start, out);
  const h = safariHeading(start);
  const fn = Math.cos(h);
  const fe = Math.sin(h);
  out.north += s * fn - c * fe;
  out.east += s * fe + c * fn;
  return out;
}

/** The inverse of pathToNed: a NED point in the track frame (s along, c right). */
export function nedToPath(north: number, east: number, out: { s: number; c: number } = { s: 0, c: 0 }, start: SafariStart = SAFARI): { s: number; c: number } {
  const p = safariStartNed(start);
  const h = safariHeading(start);
  const fn = Math.cos(h);
  const fe = Math.sin(h);
  const dn = north - p.north;
  const de = east - p.east;
  out.s = dn * fn + de * fe;
  out.c = -dn * fe + de * fn;
  return out;
}

export type SafariFlight = typeof SAFARI_FLIGHT;

/** Where the aircraft is `t` s after the start (the hold's straight-line model, SAFARI_FLIGHT), NED and MSL. */
export function safariAt(
  t: number,
  out: { north: number; east: number; alt: number } = { north: 0, east: 0, alt: 0 },
  start: SafariStart = SAFARI,
  flight: SafariFlight = SAFARI_FLIGHT,
): { north: number; east: number; alt: number } {
  pathToNed(flight.groundSpeed * t, flight.driftRight * t, out, start);
  out.alt = flight.altitudeMSL;
  return out;
}

// ------------------------------------------------------------------------------------------------ the cockpit

/** The cockpit camera of the shots and the look gate: C172 default head pose at 1600 x 900. */
export const COCKPIT_VIEW = Object.freeze({ width: 1600, height: 900, fovDeg: 60, headPitchDeg: -7, focalPx: 779.4 });

/**
 * The measured view limits (body frame, deg), per 1-deg bin of bearing off the nose (-45..+45, + right):
 * [bearing, sill, header]. sill = depression below the body horizontal of the first cockpit surface below it (or
 * the frame's bottom edge), header = elevation of the first one above it; null = the body horizontal itself is
 * behind cockpit structure (A-pillars). A target is visible when -sill < elevation < header in its bin.
 * Measured by `node scripts/safari-geometry.mjs sill` (work/inc2/sill.png, sill.json).
 */
export const SILL_PROFILE: readonly (readonly [number, number | null, number | null])[] = Object.freeze([
  [-45, 27.7, null], [-44, 28.1, 13.2], [-43, 28.5, 13.3], [-42, 28.9, 13.5], [-41, 29.3, 13.7], [-40, 29.7, 13.8], [-39, 30.1, 14.0],
  [-38, 30.4, 14.1], [-37, 30.8, 14.3], [-36, 31.1, 14.5], [-35, 31.4, 14.6], [-34, 31.8, 14.8], [-33, 32.1, 14.9], [-32, 32.3, 15.0],
  [-31, 32.6, 15.1], [-30, 32.0, 15.2], [-29, 31.3, 15.1], [-28, 30.5, 14.7], [-27, 29.6, 14.2], [-26, 28.7, 13.7], [-25, 27.9, 13.2],
  [-24, 27.2, 12.8], [-23, 25.9, 12.1], [-22, 25.0, 11.2], [-21, 24.4, 11.2], [-20, 9.3, 4.3], [-19, 8.9, 0.1], [-18, null, null],
  [-17, null, null], [-16, null, null], [-15, null, null], [-14, null, null], [-13, 8.3, 14.5], [-12, 8.4, 14.8], [-11, 8.4, 15.1],
  [-10, 8.4, 15.2], [-9, 8.4, 15.3], [-8, 8.5, 15.4], [-7, 8.5, 15.6], [-6, 8.5, 15.7], [-5, 8.5, 15.7], [-4, 7.9, 15.8], [-3, 7.2, 15.8],
  [-2, 6.5, 15.9], [-1, 6.1, 15.9], [0, 5.8, 15.9], [1, 5.6, 15.9], [2, 5.5, 15.9], [3, 5.4, 15.9], [4, 5.3, 15.9], [5, 5.3, 15.9],
  [6, 5.3, 15.8], [7, 5.2, 15.8], [8, 5.2, 15.8], [9, 5.3, 15.7], [10, 5.2, 15.7], [11, 5.2, 15.6], [12, 5.3, 15.6], [13, 5.3, 15.5],
  [14, 5.5, 15.5], [15, 5.7, 15.4], [16, 5.9, 15.3], [17, 6.2, 15.3], [18, 6.5, 15.2], [19, 6.7, 15.1], [20, 7.0, 15.0], [21, 7.3, 14.9],
  [22, 7.6, 5.2], [23, 7.9, 5.1], [24, 7.8, 5.1], [25, 7.8, 5.0], [26, 7.7, 5.0], [27, 7.6, 5.0], [28, 7.5, 4.9], [29, 7.5, 4.9],
  [30, 7.4, 4.8], [31, 7.3, 11.4], [32, 7.3, 13.5], [33, 7.2, 13.4], [34, 7.1, 13.2], [35, 7.0, 13.1], [36, 6.9, 12.9], [37, 6.8, 12.8],
  [38, 6.7, 12.6], [39, 6.6, 12.4], [40, 6.5, 12.3], [41, 6.5, 12.1], [42, 6.5, 11.9], [43, 6.4, 11.7], [44, 0.5, 11.7], [45, null, null],
]);

/**
 * The two summary scalars of the profile (body frame, deg below the horizontal): fwdDeg, the windscreen's sill
 * dead ahead (bearing 0); leftFwdDeg, the left door window's sill at its forward edge (bearing -24, where WP1/WP2
 * stage the stampede: the window spans bearing -21..-45 and is open to 24-32 deg down). A target deeper than these
 * is hidden there.
 */
export const SILL = Object.freeze({ fwdDeg: 5.8, leftFwdDeg: 27.2, leftFwdBearingDeg: -24, leftWindow: Object.freeze({ fromDeg: -45, toDeg: -21 }) });

/** The sill / header of the bin at a body bearing, deg; null when that bearing is behind structure or out of frame. */
export function sillAt(bearingDeg: number): { sill: number; header: number } | null {
  const b = Math.round(bearingDeg);
  if (b < -45 || b > 45) return null;
  const row = SILL_PROFILE[b + 45];
  if (row[1] === null) return null;
  return { sill: row[1], header: row[2] ?? COCKPIT_VIEW.fovDeg };
}

/** True when a body bearing (deg, + right) lies in the left door window (SILL.leftWindow; else the windscreen). */
export function inDoorWindow(bodyBearingDeg: number): boolean {
  return bodyBearingDeg <= SILL.leftWindow.toDeg + 0.5;
}

/** True when a direction (body frame: bearing + right, elevation + up, deg) is seen through the glazing. */
export function visibleFromCockpit(bearingDeg: number, elevationDeg: number): boolean {
  const s = sillAt(bearingDeg);
  return s !== null && elevationDeg > -s.sill && elevationDeg < s.header;
}

/** Where a world point appears from the cockpit: see projectFromCockpit. */
export interface CockpitProjection {
  /** World-frame bearing off the track heading (+ right) and depression below the horizontal (+ down), deg. */
  bearingDeg: number;
  depressionDeg: number;
  /** Body-frame bearing and elevation (the SILL_PROFILE's frame), deg. */
  bodyBearingDeg: number;
  bodyElevationDeg: number;
  /** Straight-line distance, m. */
  slant: number;
  /** Screen position at 1600 x 900 (may lie outside the frame), px; NaN behind the eye. */
  x: number;
  y: number;
  /** Pixels per metre of a target's size across the line of sight there. */
  pxPerM: number;
  /** In the frame and not behind cockpit structure. */
  visible: boolean;
}

export function makeProjection(): CockpitProjection {
  return { bearingDeg: 0, depressionDeg: 0, bodyBearingDeg: 0, bodyElevationDeg: 0, slant: 0, x: 0, y: 0, pxPerM: 0, visible: false };
}

const AT = { north: 0, east: 0, alt: 0 };

/**
 * Project the world point (north, east, h MSL) from the cockpit `t` s into the safari (the hold model: heading
 * fixed, wings level, pitch SAFARI_FLIGHT.pitchDeg), at COCKPIT_VIEW. Writes into `out` and returns it.
 */
export function projectFromCockpit(
  t: number,
  north: number,
  east: number,
  h: number,
  out: CockpitProjection = makeProjection(),
  start: SafariStart = SAFARI,
  flight: SafariFlight = SAFARI_FLIGHT,
): CockpitProjection {
  safariAt(t, AT, start, flight);
  const hd = safariHeading(start);
  const dn = north - AT.north;
  const de = east - AT.east;
  const dd = AT.alt - h; // down
  const fwd = dn * Math.cos(hd) + de * Math.sin(hd);
  const right = -dn * Math.sin(hd) + de * Math.cos(hd);
  const horiz = Math.hypot(fwd, right);
  out.slant = Math.hypot(horiz, dd);
  out.bearingDeg = Math.atan2(right, fwd) / DEG;
  out.depressionDeg = Math.atan2(dd, horiz) / DEG;
  // Body frame: nose up by the pitch (rotation about the right axis).
  const th = flight.pitchDeg * DEG;
  const bx = fwd * Math.cos(th) - dd * Math.sin(th);
  const bz = fwd * Math.sin(th) + dd * Math.cos(th);
  out.bodyBearingDeg = Math.atan2(right, bx) / DEG;
  out.bodyElevationDeg = -Math.atan2(bz, Math.hypot(bx, right)) / DEG;
  // Camera: the body pitched down by the head pitch.
  const hp = -COCKPIT_VIEW.headPitchDeg * DEG;
  const cf = bx * Math.cos(hp) + bz * Math.sin(hp);
  const cd = bz * Math.cos(hp) - bx * Math.sin(hp);
  const f = COCKPIT_VIEW.focalPx;
  if (cf > 1e-6) {
    out.x = COCKPIT_VIEW.width / 2 + (f * right) / cf;
    out.y = COCKPIT_VIEW.height / 2 + (f * cd) / cf;
    out.pxPerM = f / cf;
  } else {
    out.x = out.y = Number.NaN;
    out.pxPerM = 0;
  }
  out.visible = cf > 0 && out.x >= 0 && out.x < COCKPIT_VIEW.width && out.y >= 0 && out.y < COCKPIT_VIEW.height && visibleFromCockpit(out.bodyBearingDeg, out.bodyElevationDeg);
  return out;
}

// ------------------------------------------------------------------------------------------------ the anchors
//
// Computed by `node scripts/safari-geometry.mjs solve --place 1` for the SAFARI above (and re-derived by the test).
// Visibility over the first minute, centre points, the hold model (D = left door window, W = windscreen):
//   (WP8, L = 250 m; the centre of a herd that is not running)
//   river herd            W 0-5 s (5-6 px per 9 m body); behind the A-pillar / under the glareshield 6-13 s;
//                         D 14-18 s (13-23 px); ends of the formation (+-90 m) D 14-19 s.
//   T. rex lair           W 2 s at the windscreen's lower-left edge, D 4-12 s (10-20 px per 12.3 m), through the charge.
//   Triceratops group     W 0-3 s and 10 s (4-7 px per 8.5 m); D 12-20 s (8-18 px), beside the stampede (G3, G4).
//   kettle 0 (evening)    W 0-31 s just above eye level, ~0 -> 2 deg left of the nose (round 2: core 35 m right,
//                         lifted 20 m; ~22 px per 10 m span at 27 s); the aircraft passes under it at ~33 s.
//   Alamosaurus trio      W 0-19 s (8-13 px per 26 m, a teaser left of the nose); D 28-37 s (21-41 px).
//   volcano               W throughout, 8-9 deg right of the nose, its summit 4-5 deg above the body horizontal.

/** Runway-frame seed of the river herd (along, across), m (re-exported by world/fauna/showcase.ts). */
export const RIVER_HERD_SEED = Object.freeze({ u: 3500, v: 3000 } as const);

/** A ground anchor: NED position, ground height MSL (m, the terrain there when computed), facing (rad, true). */
export interface GroundAnchor {
  readonly north: number;
  readonly east: number;
  readonly ground: number;
  readonly heading: number;
}

/**
 * The river herd's actual site: riverHerdSite() (the nearest valid herd ground to RIVER_HERD_SEED), pinned. It
 * passes HERD_LATERAL_M left of the flown path at closest approach (~22 s).
 */
export const RIVER_HERD_SITE: GroundAnchor = Object.freeze({ north: -1622.0, east: 4315.0, ground: 164.2, heading: 250 * DEG });
export const HERD_LATERAL_M = 250;

/**
 * The T. rex's lair: 260 m from the herd centre, placed so that a charge from it drives the herd along
 * TREX_FLEE_HEADING (45 deg right of the track direction, toward the track: ahead and inward). Facing the herd.
 */
export const TREX_FLEE_HEADING = 315 * DEG;
export const TREX_LAIR: GroundAnchor = Object.freeze({ north: -1805.9, east: 4498.8, ground: 162.8, heading: TREX_FLEE_HEADING });

/**
 * Where the Triceratops group stands relative to the river herd site, in the track frame: TRICERATOPS_ALONG_M along
 * the track and TRICERATOPS_AWAY_M AWAY from it (left, the side away from the track). The plan's draft (+100 along,
 * 120 m toward the track) is under the glareshield / A-pillar at G3 (bearing -12.6, 10.9 deg down: hidden), so the
 * stampede and the facing line could never share the G3 frame. This spot is the nearest herd ground that:
 *   - is in the door window at G3 (14 s since WP8: bearing -26, 11 deg down, ~9 px per 8.5 m body) and at G4 (17 s:
 *     bearing -34, ~12 px), and in the windscreen at G1 (2 s: 13 deg left, ~4.5 px);
 *   - is >= 200 m from the T. rex's charge line (lair -> herd site, extended) and from the herd site, so a charge
 *     that reaches the herd stays outside the Triceratops' predatorFleeRange (200 m): they face, they do not run;
 *   - lies on the far side of the herd from the track, so the stampede (ahead and inward, toward the track) pulls
 *     away from the facing line to the right in the door window: two distinct masses.
 * Found by `node scripts/safari-geometry.mjs solve --place 1` (its Triceratops search); re-derived by the test.
 */
export const TRICERATOPS_ALONG_M = 180;
export const TRICERATOPS_AWAY_M = 110;
/** The Triceratops group (herd ground; see TRICERATOPS_ALONG_M). Facing the lair. */
export const TRICERATOPS_GROUP: GroundAnchor = Object.freeze({ north: -1732.0, east: 4135.0, ground: 162.6, heading: 101 * DEG });

/**
 * The Alamosaurus trio: open herd ground 330 m left of the track, 2660 m along, 87 m from the nearest tall trees
 * (platanoids, 15-16 m; stands of 15-21 such trees ~140 m away). FLAG for WP8: there is no araucaria within 1.5 km
 * of the path (the era places araucaria on uplands and slopes; the floodplain is ~150 m MSL), so the scale cue is
 * these broadleaf crowns, not the plan's araucaria stand; and it stands LEFT of the track, not ahead right (the
 * right side has no window below 6.5 deg). Heading north: across the track, toward it.
 */
export const ALAMOSAURUS_STAND: GroundAnchor = Object.freeze({ north: -1743.7, east: 3037.1, ground: 155.1, heading: 0 });

/**
 * Showcase kettle 0's evening core: a virtual thermal core (used only when the real one has wStar < 0.05, i.e. at
 * the dusk start; WP0b flight.ts), 1993 m along the track and KETTLE0_ACROSS_M right of it, so the kettle circles
 * just above eye level AHEAD 20-30 s in. History: WP0a put it 200 m right; look gate round 0 moved it to 150 m (one
 * speck at 500 m); round 1 found it behind the compass and the sun's veil at 27 s (bearing +14..+32: the compass
 * hides +22..+30 above 5 deg), so round 2 moves it to 35 m right: at G5 (27 s) the core is 2 deg left of the nose
 * at 360 m and its ~63 m orbit spans about -12..+8 deg, on the afterglow sky left of the cone's summit. The
 * aircraft passes under it at ~33 s (the birds' evade breaks the kettle up: a wing-over moment, after G5).
 * `ground` is the terrain under it.
 */
export const KETTLE0_ACROSS_M = 35;
export const KETTLE0_EVENING: GroundAnchor = Object.freeze({ north: -1378.7, east: 3704.1, ground: 155.7, heading: 0 });
/** The showcase kettle's height band about the safari start's height above the ground, m (+-). 60 before round 2
 *  (the band then spread kettle 0 over +-9 deg at 370 m); 35 keeps it within ~+-5 deg. */
export const KETTLE_BAND_M = 35;
/** Kettle 0's evening band centre above the safari's altitude, m (round 2: ~3 deg up at G5, on the sky rather than
 *  the far ground or the cone). */
export const KETTLE0_LIFT_M = 20;

// ------------------------------------------------------------------------------------------------ the look gate

/** A showcase group the G frames name. */
export type ShowcaseGroupId = 'volcano' | 'riverHerd' | 'tyrannosaurus' | 'triceratops' | 'kettle0' | 'alamosaurus';

export interface FrameExpectation {
  readonly group: ShowcaseGroupId;
  /** Where in the frame: the windscreen, or the left door window. */
  readonly where: 'windscreen' | 'door';
  /** Smallest size of one body (its length; a flyer's span) the geometry gives at this time, px, at the anchor. */
  readonly minPx: number;
  readonly note: string;
}

export interface FirstMinuteFrame {
  /** 'G1'..'G7'. */
  readonly id: string;
  /** Seconds after the default boot is ready (sim time; the clock runs). */
  readonly t: number;
  readonly label: string;
  readonly expect: readonly FrameExpectation[];
}

/**
 * The look gate's frames (scripts/era-shots/first-minute.mjs imports this in the page; era-perf's g1..g7 poses
 * too), computed from projectFromCockpit at the anchors. minPx are the anchor-centre sizes at t (the stub bodies of
 * the plan's lengths); members spread +-90 m around the centre. Where the plan's pixel gate cannot be met at any
 * time (G1's >= 6 px herd bodies: the windscreen shows the herd at 1.3 km, 5-6 px), the expectation says so.
 */
export const FIRST_MINUTE_FRAMES: readonly FirstMinuteFrame[] = Object.freeze([
  {
    id: 'G1',
    t: 2,
    label: 'cone and plume near the nose; herd and Triceratops tiny in the lower-left windscreen; T. rex in the door window',
    expect: [
      { group: 'volcano', where: 'windscreen', minPx: 300, note: 'cone 8 deg right of the nose, summit 4 deg above the body horizontal' },
      { group: 'riverHerd', where: 'windscreen', minPx: 4, note: '1.3 km: ~5 px bodies (the plan asked >= 6 px: not reachable through the windscreen)' },
      { group: 'triceratops', where: 'windscreen', minPx: 4, note: '1.6 km, 13 deg left (just right of the A-pillar), ~4.5 px' },
      { group: 'tyrannosaurus', where: 'windscreen', minPx: 8, note: 'lurking/stalking at the lair, 20 deg left at the windscreen\'s lower-left edge (the door window from ~4 s)' },
      { group: 'alamosaurus', where: 'windscreen', minPx: 7, note: 'teaser silhouette 8 deg left, 2.7 km' },
    ],
  },
  {
    id: 'G2',
    t: 7,
    label: 'the T. rex charges (door window); the herd behind the A-pillar',
    expect: [
      { group: 'tyrannosaurus', where: 'door', minPx: 12, note: '30-34 deg left; the herd is behind the pillar 4-9 s' },
      { group: 'kettle0', where: 'windscreen', minPx: 4, note: 'far, at eye level, 7 deg right, ~5 px' },
    ],
  },
  {
    id: 'G3',
    t: 16,
    label: 'the stampede in the door window, the Triceratops facing line beyond it',
    expect: [
      { group: 'riverHerd', where: 'door', minPx: 12, note: 'the site in the door window (WP8 round 2: 16 s, L 250 m; 14 s gave 3-5 px specks); running ahead and inward, strung out into lanes (profiles.ts stampede). The T. rex is wherever its charge took it (its lair leaves the frame at ~12 s)' },
      { group: 'triceratops', where: 'door', minPx: 7, note: '26 deg left, 11 deg down, ~210 m beyond the herd site: ~9 px bodies; the colour mass (WP2 frill palette, lifted by WP8) carries the read' },
    ],
  },
  {
    id: 'G4',
    t: 18,
    label: 'the stampede near the door sill; the Triceratops line still standing in the door window',
    expect: [
      { group: 'riverHerd', where: 'door', minPx: 15, note: 'the formation end nearest the track; the centre leaves at ~17 s' },
      { group: 'triceratops', where: 'door', minPx: 11, note: '35 deg left, 12.7 deg down (~12 px); leaves the door window at ~19 s' },
    ],
  },
  {
    id: 'G5',
    t: 27,
    label: 'kettle 0 at eye level ahead right',
    expect: [{ group: 'kettle0', where: 'windscreen', minPx: 15, note: '~2 deg left at ~360 m, ~3 deg up (WP8 round 2: core 35 m right, lifted 20 m, band +-35 m: clear of the compass, on the afterglow), 10 m spans ~22 px (Pteranodon 6.5 m: ~14 px)' }],
  },
  {
    id: 'G6',
    t: 35,
    label: 'the Alamosaurus trio in the door window beside the trees',
    expect: [{ group: 'alamosaurus', where: 'door', minPx: 35, note: '35-38 deg left, 13-14 deg down; tall broadleaf crowns 87+ m beyond' }],
  },
  {
    id: 'G7',
    t: 110,
    label: 'the cone and plume filling the forward view',
    expect: [{ group: 'volcano', where: 'windscreen', minPx: 500, note: 'the plume and the crater glow (WP5); the speckled marsh below (WP6)' }],
  },
] as const);

/** The anchor of a group (the volcano: its summit). */
export function groupAnchor(g: ShowcaseGroupId, volcano: { north: number; east: number; summit: number } = { north: 2000, east: -17500, summit: 2600 }): { north: number; east: number; h: number; size: number } {
  switch (g) {
    case 'volcano':
      return { north: volcano.north, east: volcano.east, h: volcano.summit, size: 11000 };
    case 'riverHerd':
      return { north: RIVER_HERD_SITE.north, east: RIVER_HERD_SITE.east, h: RIVER_HERD_SITE.ground + 1.5, size: 9 };
    case 'tyrannosaurus':
      return { north: TREX_LAIR.north, east: TREX_LAIR.east, h: TREX_LAIR.ground + 1.5, size: 12.3 };
    case 'triceratops':
      return { north: TRICERATOPS_GROUP.north, east: TRICERATOPS_GROUP.east, h: TRICERATOPS_GROUP.ground + 1.5, size: 8.5 };
    case 'kettle0':
      return { north: KETTLE0_EVENING.north, east: KETTLE0_EVENING.east, h: SAFARI_FLIGHT.altitudeMSL + KETTLE0_LIFT_M, size: 10 };
    case 'alamosaurus':
      return { north: ALAMOSAURUS_STAND.north, east: ALAMOSAURUS_STAND.east, h: ALAMOSAURUS_STAND.ground + 4, size: 26 };
  }
}
