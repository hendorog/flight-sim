import { clamp, quat, v3, type Vec3 } from '../../core/math';
import type { ControlInputs } from '../../core/types';
import type { BodyState } from '../interfaces';
import { bladeBendShape, bladeConing } from './coning';
import { cyclicAngles, type RotorcraftDefinition, type RotorcraftState } from './definition';
import { hubPointToBody } from './shaftFrame';

/** Implicit midpoint oscillator with a Coulomb impulse (including exact stiction).
 * Friction opposes midpoint velocity; stops remove outward kinetic energy. No speed floor. */
export function stepTeeter(angle: number, rate: number, inertia: number, stiffness: number,
  damping: number, torque: number, friction: number, limit: number, dt: number) {
  const divisor = inertia + damping * dt / 2 + stiffness * dt * dt / 4;
  const freeMean = (inertia * rate + dt / 2 * (torque - stiffness * angle)) / divisor;
  const mean = Math.sign(freeMean) * Math.max(0, Math.abs(freeMean) - friction * dt / (2 * divisor));
  let nextRate = 2 * mean - rate, nextAngle = angle + dt * mean;
  let frictionWork = friction * Math.abs(mean) * dt;
  // Resolve a stop inside the step. A midpoint-only dry-friction solve can otherwise alternate
  // +v/-v forever at zero displacement, retaining kinetic energy instead of sticking.
  if (rate * nextRate < 0 && friction > 0) {
    const speed = Math.abs(rate), sign = Math.sign(rate);
    const resistance = friction - sign * (torque - stiffness * angle) + damping * speed / 2;
    const denominator = resistance + Math.sqrt(resistance ** 2 + stiffness * inertia * speed ** 2);
    const stoppingTime = denominator > 0 ? 2 * inertia * speed / denominator : Infinity;
    const stoppedAngle = angle + rate * stoppingTime / 2;
    if (stoppingTime <= dt && Math.abs(torque - stiffness * stoppedAngle) <= friction) {
      nextAngle = stoppedAngle; nextRate = 0;
      frictionWork = friction * Math.abs(stoppedAngle - angle);
    }
  }
  let stopWork = 0;
  if (Math.abs(nextAngle) > limit) {
    stopWork = 0.5 * stiffness * (nextAngle ** 2 - limit ** 2);
    nextAngle = clamp(nextAngle, -limit, limit);
    if (nextAngle * nextRate > 0) { stopWork += 0.5 * inertia * nextRate ** 2; nextRate = 0; }
  }
  return { angle: nextAngle, rate: nextRate, frictionWork, stopWork };
}

/** Low-RPM, azimuth-resolved two-blade sailing. Signed section velocities remain finite in reverse
 * flow. Droop-stop reaction supplies friction, releasing as aerodynamic/centrifugal load lifts the
 * blades. This physical pose is separate from the averaged flight-load coordinates (no lag coupling).
 * The ground envelope avoids introducing a new airborne rotor model. */
export function advanceGroundRotor(d: RotorcraftDefinition, s: RotorcraftState, b: BodyState,
  c: ControlInputs, wind: Vec3, density: number, normalAcceleration: number, dt: number): void {
  if (!d.groundRotor || d.hubModel?.kind === 'articulated' || d.hubModel?.kind === 'hingeless' || dt <= 0) return;
  const p = d.groundRotor, blade = p.blade, rotor = d.main;
  const fraction = s.omega / (d.referenceRpm * Math.PI / 30);
  if (fraction >= 0.5) { delete s.contactRotor; return; }
  const a = s.contactRotor ?? { angle: 0, rate: 0, frictionWork: 0, stopWork: 0 };
  const air = v3.add(v3.sub(b.velocityBody, quat.rotateInv(b.orientation, wind)),
    v3.cross(b.angularVelocity, v3.sub(rotor.hub, b.cgOffset)));
  const collective = rotor.minPitch + clamp(c.collective ?? 0, 0, 1) * (rotor.maxPitch - rotor.minPitch);
  const steps = Math.max(1, Math.ceil(dt * 480)), h = dt / steps;
  for (let step = 0; step < steps; step++) {
    let torque = 0, damping = 0, stopReaction = 0;
    for (let i = 0; i < 2; i++) {
      const az = s.azimuth + i * Math.PI + d.rotation * s.omega * (step + 0.5) * h;
      const ex = Math.sin(az), ey = Math.cos(az), sign = i === 0 ? 1 : -1;
      const pitch = collective + (d.cyclicLimits ? d.rotation * (cyclicAngles(d, c).right * ex + cyclicAngles(d, c).aft * ey)
        : d.rotation * d.cyclicLimit * (c.aileron * ex + c.elevator * ey));
      let moment = 0;
      const dr = (rotor.radius - rotor.rootCutout) / 12;
      for (let j = 0; j < 12; j++) {
        const r = rotor.rootCutout + (j + 0.5) * dr;
        const ut = s.omega * r + d.rotation * (air.x * ey - air.y * ex);
        const up = s.inflow - air.z + r * (b.angularVelocity.y * ex - b.angularVelocity.x * ey);
        const u = Math.hypot(ut, up), phi = Math.atan2(up, ut);
        const alpha = pitch + rotor.twist * (r / rotor.radius - 0.75) - phi;
        const cl = clamp(rotor.liftSlope * Math.sin(alpha) * Math.cos(alpha), -rotor.maxCl, rotor.maxCl);
        const force = 0.5 * density * u * rotor.chord * dr * (cl * ut - rotor.profileCd * up);
        moment += force * (r - blade.hingeRadius);
        torque += sign * force * r;
        damping += 0.5 * density * Math.abs(ut) * rotor.liftSlope * rotor.chord * dr * r * r;
      }
      const centrifugal = (blade.inertia - blade.mass * blade.hingeRadius * blade.cgRadius) * s.omega ** 2;
      stopReaction += Math.max(0, blade.mass * normalAcceleration * (blade.cgRadius - blade.hingeRadius) -
        moment + centrifugal * blade.droopStop);
    }
    const result = stepTeeter(a.angle, a.rate, rotor.inertia, rotor.inertia * s.omega ** 2,
      damping, torque, p.stopFriction * stopReaction, d.teeterLimit, h);
    a.angle = result.angle; a.rate = result.rate;
    a.frictionWork += result.frictionWork; a.stopWork += result.stopWork;
  }
  s.contactRotor = a;
}

/** Rigid flap + coning/droop + elastic sag, then actual pitched chord edges. Cyclic is blade pitch,
 * not another disc tilt (adding it to the existing flap would double-count the control response).
 * At running RPM the periodic path is sampled over a revolution; at low speed use actual blades.
 * Coordinates are FRD relative to the airframe datum. */
export function bladePath(d: RotorcraftDefinition, s: RotorcraftState, c: ControlInputs,
  normalAcceleration = 9.80665): Vec3[] {
  const p = d.groundRotor;
  if (!p) return [];
  const r = d.main, blade = p.blade, points: Vec3[] = [], tilt = d.shaftTilt ?? 0;
  const fraction = s.omega / (d.referenceRpm * Math.PI / 30);
  const low = s.contactRotor && fraction < 0.5;
  const poses = low ? r.blades : 64;
  const cone = bladeConing(blade, s.omega, s.thrust / r.blades, normalAcceleration);
  for (let i = 0; i < poses; i++) {
    const az = low ? s.azimuth + i * 2 * Math.PI / r.blades : i * 2 * Math.PI / poses;
    const ex = Math.sin(az), ey = Math.cos(az);
    const harmonic = -s.flapForward * ex - s.flapRight * ey;
    // Continuous low-speed handover to the unchanged harmonic pose over 30–50% NR.
    const blend = low ? clamp((0.5 - fraction) / 0.2, 0, 1) : 0;
    const teeter = harmonic * (1 - blend) + (low ? s.contactRotor!.angle * (i % 2 === 0 ? 1 : -1) : 0) * blend;
    const flap = cone.angle + teeter;
    const pitch = r.minPitch + clamp(c.collective ?? 0, 0, 1) * (r.maxPitch - r.minPitch) +
      (d.cyclicLimits ? d.rotation * (cyclicAngles(d, c).right * ex + cyclicAngles(d, c).aft * ey)
        : d.rotation * d.cyclicLimit * (c.aileron * ex + c.elevator * ey));
    for (let j = 0; j <= 32; j++) {
      const radius = r.rootCutout + (r.radius - r.rootCutout) * j / 32;
      const bend = cone.tipBend * bladeBendShape((radius - r.rootCutout) / (r.radius - r.rootCutout));
      const horizontal = blade.hingeRadius + (radius - blade.hingeRadius) * Math.cos(flap);
      for (const side of [-1, 0, 1]) {
        const chord = side * r.chord / 2, theta = pitch + r.twist * (radius / r.radius - 0.75);
        // The flap coordinates are in the shaft frame: a tilted mast (MD 500E) rotates the path to the body.
        points.push(tilt ? hubPointToBody(r.hub, { x: horizontal * ex + chord * Math.cos(theta) * ey,
          y: horizontal * ey - chord * Math.cos(theta) * ex,
          z: -(radius - blade.hingeRadius) * Math.sin(flap) - bend - chord * Math.sin(theta) }, tilt)
          : { x: r.hub.x + horizontal * ex + chord * Math.cos(theta) * ey,
            y: r.hub.y + horizontal * ey - chord * Math.cos(theta) * ex,
            z: r.hub.z - (radius - blade.hingeRadius) * Math.sin(flap) - bend - chord * Math.sin(theta) });
      }
    }
  }
  return points;
}

export function bladeAirframeStrike(d: RotorcraftDefinition, s: RotorcraftState, c: ControlInputs,
  normalAcceleration = 9.80665): string {
  if (!d.groundRotor) return '';
  const { tailcone: t, cabin } = d.groundRotor, span = v3.sub(t.rear, t.front), length2 = v3.dot(span, span);
  const cone = bladeConing(d.groundRotor.blade, s.omega, s.thrust / d.main.blades, normalAcceleration);
  const maxFlap = Math.max(Math.hypot(s.flapForward, s.flapRight), Math.abs(s.contactRotor?.angle ?? 0));
  // A tilted shaft lowers one side of the disc by up to R sin(tilt) in body axes (conservative early-out).
  const tilt = Math.abs(d.shaftTilt ?? 0);
  const lowest = d.main.hub.z + d.main.radius * Math.sin(Math.min(Math.PI / 2, maxFlap - cone.angle + tilt)) +
    Math.abs(cone.tipBend) + d.main.chord / 2;
  if (lowest < Math.min(t.front.z - t.frontRadius, t.rear.z - t.rearRadius, cabin.centre.z - cabin.radii.z)) return '';
  for (const p of bladePath(d, s, c, normalAcceleration)) {
    const u = clamp(v3.dot(v3.sub(p, t.front), span) / length2, 0, 1);
    const distance = v3.len(v3.sub(p, v3.add(t.front, v3.scale(span, u))));
    if (distance <= t.frontRadius + u * (t.rearRadius - t.frontRadius)) return 'Main rotor / tailcone strike';
    const v = v3.sub(p, cabin.centre);
    if ((v.x / cabin.radii.x) ** 2 + (v.y / cabin.radii.y) ** 2 + (v.z / cabin.radii.z) ** 2 <= 1)
      return 'Main rotor / cabin strike';
  }
  return '';
}
