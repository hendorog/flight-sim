import { quat, v3, type Vec3 } from '../../core/math';
import type { GearInput, GearOutput } from '../interfaces';
import type { RotorcraftDefinition, RotorcraftState } from './definition';

/** Lowest stinger tube clearance to local terrain, metres; diagnostic geometry, not a pilot sensor. */
export function stingerClearance(d: RotorcraftDefinition, b: Pick<GearInput['body'], 'position' | 'orientation'>,
  env: Pick<GearInput['env'], 'groundElevation'>): number {
  return Math.min(...(d.tailProtection?.stinger ?? []).map(point => {
    const world = v3.add(b.position, quat.rotate(b.orientation, point));
    return -world.z - env.groundElevation(world.x, world.y) - d.tailProtection!.radius;
  }));
}

/** Four compliant skid contacts with elastic static grip and surface-dependent sliding. */
export class SkidGear {
  private grounded = false;
  private anchors: (Vec3 | undefined)[] = [];
  private readonly d: RotorcraftDefinition['skids'];
  constructor(private readonly definition: RotorcraftDefinition) { this.d = definition.skids; }
  reset(): void { this.grounded = false; this.anchors = []; }
  restingPose(mass: number, cg = v3.zero()): { height: number; pitch: number; roll: number } {
    const d = this.d, weight = mass * 9.80665, span = d.front - d.rear;
    const front = weight * (cg.x - d.rear) / span / (2 * d.stiffness);
    const rear = weight * (d.front - cg.x) / span / (2 * d.stiffness);
    const pitch = (rear - front) / span;
    return { height: d.z - (front + rear) / 2 - pitch * (d.front + d.rear) / 2, pitch,
      roll: weight * cg.y / (4 * d.stiffness * d.halfTrack ** 2) };
  }
  compute({ body: b, env, dt }: GearInput, rotor?: RotorcraftState): GearOutput {
    const d = this.d, force = v3.zero(), moment = v3.zero();
    const loads = [0, 0, 0], compress = [0, 0, 0];
    const reportTail = (kind: RotorcraftState['tailContact']): void => {
      const severity = ['none', 'stinger-touch', 'stinger-impact', 'fin-strike', 'rotor-strike'];
      if (rotor && dt > 0 && severity.indexOf(kind) > severity.indexOf(rotor.tailContact)) rotor.tailContact = kind;
    };
    let crash = '', maxSink = 0;
    let contact = 0;
    for (const x of [d.front, d.rear]) for (const side of [-1, 1]) {
      const index = contact++;
      const point = { x, y: side * d.halfTrack, z: d.z };
      const arm = v3.sub(point, b.cgOffset);
      const world = v3.add(b.position, quat.rotate(b.orientation, point));
      const penetration = world.z + env.groundElevation(world.x, world.y);
      if (penetration <= 0) { if (dt > 0) this.anchors[index] = undefined; continue; }
      const normal = env.groundNormal?.(world.x, world.y) ?? { x: 0, y: 0, z: -1 };
      const velocity = quat.rotate(b.orientation, v3.add(b.velocityBody, v3.cross(b.angularVelocity, arm)));
      const vn = v3.dot(velocity, normal);
      const depth = penetration * -normal.z;
      const load = Math.max(0, d.stiffness * depth - d.damping * vn);
      const slip = v3.sub(velocity, v3.scale(normal, vn));
      const surface = d.surfaces?.[env.surface(world.x, world.y)] ??
        { static: d.friction, sliding: d.friction, lateral: d.friction };
      const alongBody = quat.rotate(b.orientation, { x: 1, y: 0, z: 0 });
      const along = v3.normalize(v3.sub(alongBody, v3.scale(normal, v3.dot(alongBody, normal))));
      const across = v3.cross(along, normal);
      // Tangential compliance stores static displacement, unlike velocity-only friction which creeps
      // forever on a slope. Return-map the contact anchor when the friction ellipse is exceeded.
      // History changes once per physics step; intermediate RK evaluations only read it.
      const anchor = this.anchors[index] ?? world;
      const adhesion = Math.exp(-((v3.len(slip) / 0.25) ** 2));
      const displacement = v3.sub(world, anchor), stiffness = d.stiffness * 0.5, damping = d.damping * 0.3 * adhesion;
      const trial = v3.add(v3.scale(displacement, -stiffness), v3.scale(slip, -damping));
      let fx = v3.dot(trial, along), fy = v3.dot(trial, across);
      const limitX = load * (surface.sliding + (surface.static - surface.sliding) * adhesion);
      const limitY = load * (surface.lateral + (surface.static - surface.lateral) * adhesion);
      const ratio = Math.hypot(fx / Math.max(1e-9, limitX), fy / Math.max(1e-9, limitY));
      const sliding = v3.len(slip) > 0.25;
      if (sliding) {
        const vx = v3.dot(slip, along), vy = v3.dot(slip, across);
        const scale = Math.max(1e-9, Math.hypot(limitX * vx, limitY * vy));
        fx = -(limitX ** 2) * vx / scale; fy = -(limitY ** 2) * vy / scale;
      } else if (ratio > 1) { fx /= ratio; fy /= ratio; }
      const friction = v3.add(v3.scale(along, fx), v3.scale(across, fy));
      if (dt > 0) this.anchors[index] = sliding || ratio > 1 ? v3.add(world,
        v3.scale(v3.add(friction, v3.scale(slip, damping)), 1 / stiffness)) : anchor;
      const f = quat.rotateInv(b.orientation, v3.add(v3.scale(normal, load), friction));
      Object.assign(force, v3.add(force, f));
      Object.assign(moment, v3.add(moment, v3.cross(arm, f)));
      const idx = side < 0 ? 1 : 2;
      loads[idx] += load; compress[idx] = Math.max(compress[idx], depth);
      maxSink = Math.max(maxSink, -vn);
      if (-vn > d.maxSink || depth > 0.25) crash = 'Hard skid impact';
    }
    const protection = this.definition.tailProtection;
    if (protection) {
      let deepest = 0, hit: { point: Vec3; world: Vec3 } | undefined;
      for (const point of protection.stinger) {
        const world = v3.add(b.position, quat.rotate(b.orientation, point));
        const depth = world.z + env.groundElevation(world.x, world.y) + protection.radius;
        if (depth > deepest) { deepest = depth; hit = { point, world }; }
      }
      if (hit) {
        const normal = env.groundNormal?.(hit.world.x, hit.world.y) ?? { x: 0, y: 0, z: -1 };
        const arm = v3.sub(hit.point, b.cgOffset);
        const velocity = quat.rotate(b.orientation, v3.add(b.velocityBody, v3.cross(b.angularVelocity, arm)));
        const vn = v3.dot(velocity, normal), slip = v3.sub(velocity, v3.scale(normal, vn));
        const load = Math.max(0, protection.stiffness * deepest * -normal.z - protection.damping * vn);
        const worldForce = v3.sub(v3.scale(normal, load), v3.scale(slip, 0.3 * load / Math.max(v3.len(slip), 0.1)));
        const f = quat.rotateInv(b.orientation, worldForce);
        Object.assign(force, v3.add(force, f)); Object.assign(moment, v3.add(moment, v3.cross(arm, f)));
        const hard = -vn > protection.maxSink || deepest > protection.maxCompression;
        if (hard) crash = 'Tail stinger impact';
        reportTail(hard ? 'stinger-impact' : 'stinger-touch');
      }
    }
    const contacts = [
      { point: { x: 0, y: 0, z: 0.5 }, name: 'Cabin impact' },
      ...(protection?.fin.map(point => ({ point, name: 'Lower tail fin strike' })) ?? []),
      { point: this.definition.tail.hub, name: 'Tail rotor strike' },
    ];
    const tail = this.definition.tail;
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      contacts.push({ point: { x: tail.hub.x + tail.radius * Math.cos(a), y: tail.hub.y,
        z: tail.hub.z + tail.radius * Math.sin(a) }, name: 'Tail rotor strike' });
    }
    const main = this.definition.main;
    for (let i = 0; i < 8; i++) {
      const angle = i * Math.PI / 4;
      contacts.push({ point: { x: main.hub.x + main.radius * Math.cos(angle),
        y: main.hub.y + main.radius * Math.sin(angle), z: main.hub.z + main.radius * ((rotor?.flapForward ?? 0) * Math.cos(angle) +
          (rotor?.flapRight ?? 0) * Math.sin(angle) - (rotor?.coning ?? 0)) }, name: 'Main rotor strike' });
    }
    for (const { point, name } of contacts) {
      const world = v3.add(b.position, quat.rotate(b.orientation, point));
      if (world.z + env.groundElevation(world.x, world.y) >= 0) {
        crash = name;
        if (name === 'Lower tail fin strike') reportTail('fin-strike');
        if (name === 'Tail rotor strike') reportTail('rotor-strike');
      }
    }
    const onGround = loads.some(x => x > 0);
    const touchdowns: GearOutput['touchdowns'] = onGround && !this.grounded && dt > 0 ? [{ wheel: 'left', sinkRate: maxSink }] : [];
    if (dt > 0) this.grounded = onGround;
    return { force, moment, onGround, crash, touchdowns,
      wheels: (['nose', 'left', 'right'] as const).map((name, i) => ({ name, compression: compress[i], onGround: loads[i] > 0,
        load: loads[i], spinRate: 0, rotation: 0, steerAngle: 0, skid: 0 })) as GearOutput['wheels'] };
  }
}
