// The S0 seams the rotor core must keep (plan revision 2, sections 2.4 and 4, R22): the pusher's loads and shaft torque,
// the half-P forcing, and extra angular momentum before w x H. Test-local stand-ins replace the AC/AH/AG objects (null on
// every type until those packages land), on the hingeless fixture and on the MD 500E's articulated hub.
import { describe, expect, it } from 'vitest';
import { quat, v3, type Vec3 } from '../../src/core/math';
import { defaultControls } from '../../src/core/types';
import { Rotorcraft } from '../../src/physics/rotorcraft/rotorcraft';
import type { BodyState } from '../../src/physics/interfaces';
import type { RotorcraftDefinition } from '../../src/physics/rotorcraft/definition';
import { MD500_DEFINITION } from '../../src/aircraft/md500';
import { fixtureDefinition, fixtureRotorcraft } from './hingelessFixture';

const body = (): BodyState => ({ time: 0, position: { x: 0, y: 0, z: -1500 }, orientation: quat.fromEuler(0.02, -0.03, 0.4),
  velocityBody: { x: 30, y: -2, z: 1.5 }, angularVelocity: { x: 0.1, y: -0.05, z: 0.08 }, cgOffset: { x: 0.02, y: 0, z: 0.05 }, mass: 2200 });

interface Seams { pusher?: unknown; halfP?: unknown; gyro?: unknown }
/** Two identical rotors stepped together; `install` puts stand-ins on the second after reset. */
function pair(def: RotorcraftDefinition, install: (r: Seams) => void) {
  const a = new Rotorcraft(def), b = new Rotorcraft(def);
  a.reset(true); b.reset(true);
  install(b as unknown as Seams);
  const c = { ...defaultControls(fixtureDefinition()), collective: 0.4, aileron: 0.05, elevator: -0.1 };
  const one = body();
  for (let i = 0; i < 24; i++) { a.compute(one, v3.zero(), 1.2, 1500, c, 1 / 240); b.compute(one, v3.zero(), 1.2, 1500, c, 1 / 240); }
  const la = a.compute(one, v3.zero(), 1.2, 1500, c, 0), lb = b.compute(one, v3.zero(), 1.2, 1500, c, 0);
  return { a, b, la: { force: { ...la.force }, moment: { ...la.moment } }, lb: { force: { ...lb.force }, moment: { ...lb.moment } }, w: one.angularVelocity };
}
const zero = (): Vec3 => v3.zero();
const close = (x: Vec3, y: Vec3) => { for (const k of ['x', 'y', 'z'] as const) expect(Math.abs(x[k] - y[k])).toBeLessThan(1e-9 * Math.max(1, Math.abs(y[k]))); };

for (const [name, def] of [['hingeless fixture', fixtureRotorcraft()], ['MD 500E (articulated)', MD500_DEFINITION.rotorcraft!]] as const) {
  describe(`R22 seams kept: ${name}`, () => {
    it('a stand-in pusher returning shaftTorque = 1 changes s.torque by 1; its force and moment join the loads', () => {
      const extra = { force: { x: 10, y: -20, z: 30 }, moment: { x: -40, y: 50, z: -60 }, shaftTorque: 1, power: 0 };
      const { a, b, la, lb } = pair(def, (r) => { r.pusher = { h: zero(), reset() {}, compute: () => extra }; });
      expect(Math.abs(b.state.torque - a.state.torque - 1)).toBeLessThan(1e-9);
      close(lb.force, v3.add(la.force, extra.force)); close(lb.moment, v3.add(la.moment, extra.moment));
    });
    it('a stand-in half-P forcing appears in the loads', () => {
      const e = { force: { x: 0, y: 0, z: 1234 }, moment: { x: 5678, y: 0, z: 0 } };
      const { la, lb } = pair(def, (r) => { r.halfP = { reset() {}, forcing: () => e }; });
      close(lb.force, v3.add(la.force, e.force)); close(lb.moment, v3.add(la.moment, e.moment));
    });
    it('the pusher\'s angular momentum joins angularMomentum AFTER the free rotor\'s w x H compensation (its reaction acts)', () => {
      // A rigidly mounted prop: the rigid-body equation subtracts w x H with H including h_prop, and the rotor's loads add back only
      // the free rotor's (and the gimballed gyro's) w x H, so the airframe feels -w x h_prop. The S0 seam added it before the
      // compensation, which cancelled the prop's gyroscopic reaction (final review finding; this row asserted that form).
      const hp = { x: 0, y: 0, z: 300 };
      const { a, b, la, lb } = pair(def, (r) => {
        r.pusher = { h: hp, reset() {}, compute: () => ({ force: zero(), moment: zero(), shaftTorque: 0, power: 0 }) };
      });
      close(b.angularMomentum, v3.add(a.angularMomentum, hp));
      close(lb.moment, la.moment);
    });
  });
}
