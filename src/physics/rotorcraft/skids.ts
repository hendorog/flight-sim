import { quat, v3 } from '../../core/math';
import type { GearInput, GearOutput } from '../interfaces';
import type { RotorcraftDefinition, RotorcraftState } from './definition';

/** Four compliant skid contacts, terrain-normal support and isotropic sliding friction. No wheel/brake fiction. */
export class SkidGear {
  private grounded = false;
  private readonly d: RotorcraftDefinition['skids'];
  constructor(private readonly definition: RotorcraftDefinition) { this.d = definition.skids; }
  reset(): void { this.grounded = false; }
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
    let crash = '', maxSink = 0;
    for (const x of [d.front, d.rear]) for (const side of [-1, 1]) {
      const point = { x, y: side * d.halfTrack, z: d.z };
      const arm = v3.sub(point, b.cgOffset);
      const world = v3.add(b.position, quat.rotate(b.orientation, point));
      const penetration = world.z + env.groundElevation(world.x, world.y);
      if (penetration <= 0) continue;
      const normal = env.groundNormal?.(world.x, world.y) ?? { x: 0, y: 0, z: -1 };
      const velocity = quat.rotate(b.orientation, v3.add(b.velocityBody, v3.cross(b.angularVelocity, arm)));
      const vn = v3.dot(velocity, normal);
      const depth = penetration * -normal.z;
      const load = Math.max(0, d.stiffness * depth - d.damping * vn);
      const slip = v3.sub(velocity, v3.scale(normal, vn));
      const friction = v3.scale(slip, -d.friction * load / Math.max(0.15, v3.len(slip)));
      const f = quat.rotateInv(b.orientation, v3.add(v3.scale(normal, load), friction));
      Object.assign(force, v3.add(force, f));
      Object.assign(moment, v3.add(moment, v3.cross(arm, f)));
      const idx = side < 0 ? 1 : 2;
      loads[idx] += load; compress[idx] = Math.max(compress[idx], depth);
      maxSink = Math.max(maxSink, -vn);
      if (-vn > d.maxSink || depth > 0.25) crash = 'Hard skid impact';
    }
    const contacts = [
      { point: { x: 0, y: 0, z: 0.5 }, name: 'Cabin impact' },
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
      if (world.z + env.groundElevation(world.x, world.y) >= 0) crash = name;
    }
    const onGround = loads.some(x => x > 0);
    const touchdowns: GearOutput['touchdowns'] = onGround && !this.grounded && dt > 0 ? [{ wheel: 'left', sinkRate: maxSink }] : [];
    if (dt > 0) this.grounded = onGround;
    return { force, moment, onGround, crash, touchdowns,
      wheels: (['nose', 'left', 'right'] as const).map((name, i) => ({ name, compression: compress[i], onGround: loads[i] > 0,
        load: loads[i], spinRate: 0, rotation: 0, steerAngle: 0, skid: 0 })) as GearOutput['wheels'] };
  }
}
