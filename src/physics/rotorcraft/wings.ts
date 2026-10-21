// Fixed wing of a compound rotorcraft (AH-56A stage 3). Owner: AC. Plan revision 2, section 7.3; docs/ah56-compound.md.
//
// Seam (S0, airframe.ts, RC keeps it): airframeLoads calls wingLoads after the fins when `d.wings` exists, with the same
// `add(point, force)` accumulator (force and moment about the CG; it returns the force's power on the local flow), and
// returns the wing power in a separate `wings` field (never in the legacy power object); Rotorcraft publishes it in
// `compoundPower.wings`. Nothing here runs on a type without `wings`.
//
// Each panel is one lifting element at its quarter-chord MAC point with its own local flow: the body's air velocity, the
// body rotation at the panel's arm (roll damping, and the yaw-rate lift difference), and the main rotor's wash. The
// dihedral tilts each panel's normal inboard, so sideslip changes the two panels' angles of attack in opposite senses
// (the dihedral effect). The section works from attached flow (the AR-corrected lift slope) through a gentle stall to a
// finite flat plate at large incidence, which is what the panel meets in the hover wake (the hover download).
import { clamp, v3, type Vec3 } from '../../core/math';
import type { BodyState } from '../interfaces';
import { lookup, type Table1D } from './controlGyro';

export interface WingPanelDef {
  /** 1 right panel, -1 left: each panel has its own local flow (roll damping and dihedral effect emerge). */
  side: 1 | -1;
  /** Panel quarter-chord MAC point, body FRD m. */
  centre: Vec3;
  /** m^2, m, 1/rad, -, -, - (195 ft^2 total, span 4.069 m per panel, AR 3.66; P / D). `liftSlope` is the finite-wing
   *  (3-D) slope; `inducedK` the induced-drag factor 1 / (pi AR e); `maxCl` the attached-flow maximum. */
  area: number; span: number; liftSlope: number; maxCl: number; cd0: number; inducedK: number;
  /** Setting of the panel's mean chord to the body x axis, rad: the root incidence (L 11 deg 52 min, R 12 deg 58 min, P)
   *  plus the area-mean of the washout (D; docs/ah56-compound.md). */
  incidence: number;
  /** Zero-lift angle of the section to its chord, rad (negative: cambered; the AH-56's trailing-edge extension). */
  zeroLiftAlpha: number;
  /** Dihedral, rad (+ raises the tip; 5 deg P). */
  dihedral: number;
  /**
   * Rotor-wake factor on the panel as a function of wake skew chi = atan(mu / lambda), rad: the panel's downwash is
   * washBySkew(chi) x the rotor's mean (momentum) induced velocity. The hover value sets the download; the high-speed
   * value the downwash angle the rotor's lift puts on the wing. Plain table.
   */
  washBySkew: Table1D;
  /** Normal-force coefficient of the panel broadside to the flow (finite flat plate). Absent: 1.2 (AR about 4). */
  flatPlate?: number;
  /**
   * External stores on the panel (pylons and pods): an equivalent flat-plate drag area against the panel's forward
   * airspeed, m^2 against m/s, acting on the forward flow at `centre` (body FRD m). Absent: a clean panel.
   */
  stores?: { centre: Vec3; dragAreaBySpeed: Table1D };
  /**
   * The panel's downwash at the horizontal stabiliser (whose own load airframe.ts computes without it): the stabiliser lift
   * this panel's trailing vortices take away, -q S_t a_t eps with eps = gradient x the panel's lift coefficient / 2 (the
   * two panels make the wing's downwash), applied at the stabiliser `centre` normal to the flow, faded in with forward
   * speed (`fadeSpeed`, m/s, the speed at which half of it acts: a hover wake falls clear of the tail). Absent: none.
   */
  tail?: { centre: Vec3; area: number; liftSlope: number; gradient: number; fadeSpeed: number };
}

/** Normal-force coefficient of a finite flat plate broadside to the flow (Hoerner, AR about 4). */
const FLAT_PLATE = 1.2;
/** Incidence beyond the attached-flow maximum over which the section fades into the flat plate, rad. */
const STALL_FADE = 0.35;

/** One panel's section: lift and drag coefficients at `alpha` (rad, chord to the local flow in the panel's plane). */
export function panelCoefficients(w: WingPanelDef, alpha: number): { cl: number; cd: number } {
  const linear = w.liftSlope * (alpha - w.zeroLiftAlpha);
  const attachedLimit = w.maxCl / w.liftSlope;
  const blend = clamp((Math.abs(alpha - w.zeroLiftAlpha) - attachedLimit) / STALL_FADE, 0, 1);
  const attached = clamp(linear, -w.maxCl, w.maxCl);
  const cn = w.flatPlate ?? FLAT_PLATE;
  const cl = (1 - blend) * attached + blend * cn * Math.sin(alpha) * Math.cos(alpha);
  const cd = (1 - blend) * (w.cd0 + w.inducedK * attached * attached) + blend * Math.max(w.cd0, cn * Math.sin(alpha) ** 2);
  return { cl, cd };
}

/**
 * The wing panels' loads through the airframe accumulator. `air` is the body's velocity relative to the air (body axes),
 * `meanInflow` the rotor's mean (momentum) induced velocity, m/s (down through the disc +), `skew` the wake skew angle,
 * rad. Returns the wing power, W (the sum of add()'s returns: negative is drag work).
 */
export function wingLoads(wings: readonly WingPanelDef[], b: BodyState, air: Vec3, density: number, meanInflow: number,
  skew: number, add: (point: Vec3, force: Vec3) => number): number {
  let power = 0;
  for (const w of wings) {
    const flow = v3.add(air, v3.cross(b.angularVelocity, v3.sub(w.centre, b.cgOffset)));
    // The rotor's downwash moves the air down through the panel: the panel moves up through it.
    flow.z -= lookup(w.washBySkew, skew) * meanInflow;
    // The panel's downward normal tilts inboard with dihedral: (0, side sin G, cos G).
    const sn = w.side * Math.sin(w.dihedral), cs = Math.cos(w.dihedral);
    const normal = flow.y * sn + flow.z * cs, speed = Math.max(Math.hypot(flow.x, normal), 1e-6);
    // The full-range geometric angle: in the hover wake (flow.x about 0) and in rearward flight the panel meets the flow at
    // -78 .. -110 deg and lands on the flat plate (the attached branch is blended out), whose cn sin(alpha) cos(alpha) is
    // periodic in 180 deg, so a reversed flow sees the incidence with its own sign. No |flow.x| or sign(flow.x): the
    // download's chordwise part (+x for this leading-edge-up panel) must not follow the sign of a small airspeed.
    const p = panelCoefficients(w, Math.atan2(normal, flow.x) + w.incidence);
    const q = 0.5 * density * speed * speed * w.area;
    // Lift normal to the flow in the chord-normal plane, (normal, -flow.x) / speed, drag along -flow.
    const fn = q * (-p.cl * flow.x - p.cd * normal) / speed;
    power += add(w.centre, { x: q * (p.cl * normal - p.cd * flow.x) / speed, y: fn * sn, z: fn * cs });
    if (w.tail && flow.x > 0) {
      const t = w.tail, u = flow.x, fade = u * u / (u * u + t.fadeSpeed * t.fadeSpeed);
      const lost = 0.5 * density * u * u * t.area * t.liftSlope * t.gradient * p.cl / 2 * fade;
      power += add(t.centre, { x: 0, y: 0, z: lost });
    }
    if (w.stores) {
      const s = w.stores;
      const u = air.x + b.angularVelocity.y * (s.centre.z - b.cgOffset.z) - b.angularVelocity.z * (s.centre.y - b.cgOffset.y);
      power += add(s.centre, { x: -0.5 * density * lookup(s.dragAreaBySpeed, Math.abs(u)) * u * Math.abs(u), y: 0, z: 0 });
    }
  }
  return power;
}
