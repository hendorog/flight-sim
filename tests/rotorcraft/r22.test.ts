import { describe, it, expect } from 'vitest';
import { R22_DEFINITION } from '../../src/aircraft/r22';
import { R22_ROTORCRAFT } from '../../src/aircraft/r22/rotorcraft';
import { createFlightModelFor } from '../../src/physics';
import { cloneControls } from '../../src/core/types';
import { flatEnvironment } from '../fdm/helpers';
import { bladeElements } from '../../src/physics/rotorcraft/rotor';

const env = flatEnvironment(undefined, 0);
function model(ground = false) {
  const fm = createFlightModelFor(R22_DEFINITION, { structuralFailure: false });
  fm.reset({ position: { x: 0, y: 0, z: -100 }, heading: 0, airspeed: 0, onGround: ground, engineRunning: true }, env);
  return fm;
}
describe('R22 rotorcraft', () => {
  it('trims a hover and runs with bounded RPM', () => {
    const fm = model(), c = cloneControls(fm.trimControls);
    expect(fm.lastTrim?.converged).toBe(true);
    for (let i = 0; i < 240; i++) fm.step(1/240, c, env);
    expect(fm.state.rotorcraft!.rotorRpm).toBeGreaterThan(480);
    expect(fm.state.rotorcraft!.rotorRpm).toBeLessThan(560);
    expect(Math.abs(fm.state.verticalSpeed)).toBeLessThan(1);
  });
  it('stays on its skids at low collective', () => {
    const fm = model(true), c = cloneControls(fm.trimControls);
    for (let i = 0; i < 480; i++) fm.step(1/240, c, env);
    expect(fm.state.onGround).toBe(true);
    expect(fm.state.crashed).toBe(false);
  });
  it('signed torque permits autorotation and stopped rotors cannot hover', () => {
    const d = R22_ROTORCRAFT.main;
    const stopped = bladeElements(d, 0, 0.15, 0, 0, 0, 1.225);
    expect(stopped.thrust).toBe(0);
    const autorotation = bladeElements(d, 530*Math.PI/30, 0.015, -12, 25, 3, 1.225);
    expect(autorotation.torque).toBeLessThan(0);
  });
});
