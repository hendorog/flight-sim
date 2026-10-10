import { clamp, v3, type Vec3 } from '../../core/math';
import type { BodyState, ForceMoment } from '../interfaces';
import type { RotorcraftDefinition } from './definition';

/** Local flow at each fixed surface includes body rotation and a bounded main-rotor wake estimate.
 * Lift is normal to the local flow, including in a descent; no attitude/rate servo is hidden here.
 */
export function airframeLoads(d: RotorcraftDefinition, b: BodyState, air: Vec3, rho: number, inflow: number): ForceMoment & {
  power: { fuselage: number; stabilizer: number; fins: number; moments: number };
} {
  const force = v3.zero(), moment = v3.zero();
  const power = { fuselage: 0, stabilizer: 0, fins: 0, moments: 0 };
  // The BEM inflow includes a power-loss correction for nonuniformity/tip loss. It is not the
  // area-mean velocity washing the fuselage; recover the momentum velocity for those loads.
  const meanInflow = inflow / (d.main.inducedFactor ?? 1);
  const add = (point: Vec3, f: Vec3): number => {
    Object.assign(force, v3.add(force, f));
    Object.assign(moment, v3.add(moment, v3.cross(v3.sub(point, b.cgOffset), f)));
    return v3.dot(f, v3.add(air, v3.cross(b.angularVelocity, v3.sub(point, b.cgOffset))));
  };
  const local = (point: Vec3): Vec3 => v3.add(air, v3.cross(b.angularVelocity, v3.sub(point, b.cgOffset)));
  const dragAir = local(d.dragCentre);
  // The cabin/engine lie below the disc. Hover downwash creates a download that the rotor must
  // also support; freestream-only drag omitted it completely. Attenuate as the wake skews aft.
  dragAir.z -= (d.fuselageWash ?? 0) * meanInflow / (1 + (Math.hypot(air.x, air.y) / 16) ** 2);
  power.fuselage = add(d.dragCentre, { x: -0.5 * rho * d.dragArea.x * dragAir.x * Math.abs(dragAir.x),
    y: -0.5 * rho * d.dragArea.y * dragAir.y * Math.abs(dragAir.y),
    z: -0.5 * rho * d.dragArea.z * dragAir.z * Math.abs(dragAir.z) });
  const h = d.stabilizer, flow = local(h.centre);
  // Wake at the aft stabilizer decreases continuously as the skewed wake passes below it.
  flow.z -= h.wash * 2 * meanInflow / (1 + (air.x / 16) ** 2);
  const polar = (angle: number, slope: number, maxCl: number): { cl: number; cd: number } => {
    const blend = clamp((Math.abs(angle) - 0.3) / 0.4, 0, 1);
    const cl = (1 - blend) * clamp(slope * angle, -maxCl, maxCl) + blend * Math.sin(2 * angle);
    return { cl, cd: 0.015 + 0.1 * cl * cl + 1.8 * blend * Math.sin(angle) ** 2 };
  };
  if (h.dihedral !== undefined) {
    // Resolve the local flow/force in the canted surface's chord-normal plane.
    // Spanwise flow makes no 2D section lift; the resulting side force acts at its true arm.
    const sn = Math.sin(h.dihedral), cs = Math.cos(h.dihedral);
    const normal = flow.y * sn + flow.z * cs, speed = Math.max(Math.hypot(flow.x, normal), 1e-6);
    const hp = polar(Math.atan2(normal, Math.abs(flow.x)) + h.incidence, h.liftSlope, h.maxCl);
    const q = 0.5 * rho * speed * speed * h.area;
    const fn = q * (-hp.cl * Math.abs(flow.x) - hp.cd * normal) / speed;
    power.stabilizer = add(h.centre, { x: q * (hp.cl * Math.sign(flow.x) * normal - hp.cd * flow.x) / speed,
      y: fn * sn, z: fn * cs });
  } else {
    const speed = Math.max(Math.hypot(flow.x, flow.z), 1e-6);
    const alpha = Math.atan2(flow.z, Math.abs(flow.x)) + h.incidence;
    const hp = polar(alpha, h.liftSlope, h.maxCl), qh = 0.5 * rho * speed * speed * h.area;
    power.stabilizer = add(h.centre, { x: qh * (hp.cl * Math.sign(flow.x) * flow.z - hp.cd * flow.x) / speed, y: 0,
      z: qh * (-hp.cl * Math.abs(flow.x) - hp.cd * flow.z) / speed });
  }
  for (const fin of d.fins) {
    const f = local(fin.centre), v = Math.max(Math.hypot(f.x, f.y), 1e-6);
    const fp = polar(Math.atan2(f.y, Math.abs(f.x)) + fin.incidence, fin.liftSlope, fin.maxCl);
    const q = 0.5 * rho * v * v * fin.area;
    power.fins += add(fin.centre, { x: q * (fp.cl * Math.sign(f.x) * f.y - fp.cd * f.x) / v,
      y: q * (-fp.cl * Math.abs(f.x) - fp.cd * f.y) / v, z: 0 });
  }
  const q = 0.5 * rho * v3.dot(air, air);
  const pitchMoment = q * d.fuselageMoment.pitch * Math.atan2(air.z, Math.max(Math.abs(air.x), 1));
  const yawMoment = -q * d.fuselageMoment.yaw * Math.atan2(air.y, Math.max(Math.abs(air.x), 1));
  moment.y += pitchMoment; moment.z += yawMoment;
  power.moments = pitchMoment * b.angularVelocity.y + yawMoment * b.angularVelocity.z;
  return { force, moment, power };
}
