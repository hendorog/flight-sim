// MD 500E 3 deg forward static mast (F / 3V; shaftTilt): the flap coordinates live in the shaft frame, so the blade
// path that the airframe-strike and ground-contact checks read must be rotated back to the body. Untilted, the aft
// blade would sit R sin 3 deg = 0.21 m lower than it really is (a false tailcone strike at a hard aft flap).
import { describe, expect, it } from 'vitest';
import { cloneRotorcraftState, type RotorcraftDefinition } from '../../src/physics/rotorcraft/definition';
import { bladeAirframeStrike, bladePath } from '../../src/physics/rotorcraft/groundRotor';
import { DEG } from '../../src/core/math';
import { d, rig } from './md500Rig';

describe('MD 500E shaft tilt in the contact geometry', () => {
  const r = rig(3000, { height: 1500 });
  const s = cloneRotorcraftState(r.fm.state.rotorcraft!);
  const untilted: RotorcraftDefinition = { ...d, shaftTilt: 0 };
  /** The aft-most sampled point of the path (the blade over the tailcone), body FRD. */
  const aft = (def: RotorcraftDefinition, st: typeof s) =>
    bladePath(def, st, r.c).reduce((a, p) => (p.x < a.x ? p : a));

  it('the shaft is tilted 3 deg forward', () => {
    expect(d.shaftTilt! / DEG).toBeCloseTo(3, 6);
  });

  it('hover state: the aft blade is R sin(tilt) higher in body axes than the shaft-frame numbers read as body', () => {
    const tilted = aft(d, s), flat = aft(untilted, s);
    const rise = flat.z - tilted.z;
    expect(rise).toBeGreaterThan(0.9 * d.main.radius * Math.sin(d.shaftTilt!));
    expect(rise).toBeLessThan(1.1 * d.main.radius * Math.sin(d.shaftTilt!));
    expect(bladeAirframeStrike(d, s, r.c)).toBe('');
  });

  it('a hard aft flap (flapForward -0.23 rad) clears the tailcone with the tilt; the untilted reading would strike', () => {
    const hard = { ...s, flapForward: -0.23 };
    expect(bladeAirframeStrike(untilted, hard, r.c)).toBe('Main rotor / tailcone strike');
    expect(bladeAirframeStrike(d, hard, r.c)).toBe('');
  });
});
