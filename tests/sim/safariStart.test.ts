// Deep Time, increment 2 (WP0a): the safari's boot rules (src/sim/safariStart.ts, wired in Simulator.boot).
//   - a safari boot with no tod= sets SAFARI.tod; tod= in the URL wins; the runway start keeps the weather's own
//     time (10 with ?tod=10, the default otherwise); a resumed flight keeps its snapshot's; never in the present day;
//   - sky.dayFactor (SkySystem: smoothstep(sunDir.y, -0.12, 0.1)) > 0.25 at SAFARI.tod, so the showcase flyers
//     do not roost;
//   - the tower camera is refused in the Cretaceous (setCameraMode and the boot camera), allowed in the present day;
//   - the safari reset engages its hold; the runway's does not.
// A real boot (index.html?era=cretaceous&ui=0 -> summary().timeOfDay 19, autoflight 'hold') is checked by
// scripts/era-shots and era-perf's g1..g7 poses (WP0a result).

import { afterEach, describe, expect, it } from 'vitest';
import type { CameraMode } from '../../src/core/context';
import { defaultWeather } from '../../src/core/types';
import { sunDirectionNED } from '../../src/core/world';
import { bootCameraMode, cameraModeAllowed, safariHeadPitch, startTimeOfDay } from '../../src/sim/safariStart';
import { Simulator } from '../../src/sim/Simulator';
import { SimPhysics } from '../../src/sim/SimPhysics';
import { parseParams } from '../../src/sim/params';
import { SAFARI } from '../../src/world/era/cretaceousAnchors';
import { setEra } from '../../src/world/era/eraState';
import { buildScenario } from '../../src/sim/scenarios';
import { AIRPORT } from '../../src/core/world';
import { DEG, FT, wrapTwoPi } from '../../src/core/math';
import { terrainHeight } from '../../src/world/terrain/heightfield';

afterEach(() => setEra('present'));

/** What Simulator.boot does: the URL's tod (if any) over the defaults, then the start rule. */
function bootTod(search: string, scenario: 'safari' | 'runway', resumedTod: number | null = null): number {
  const p = parseParams(search);
  const w = { ...defaultWeather(), ...p.weather };
  const t = startTimeOfDay({ scenario, urlTod: p.weather.timeOfDay !== undefined, resumed: false });
  if (t !== null) w.timeOfDay = t;
  // A resume then assigns the snapshot's weather over it.
  if (resumedTod !== null) w.timeOfDay = resumedTod;
  return w.timeOfDay;
}

describe('the safari start rules', () => {
  it('a safari boot with no tod= starts at SAFARI.tod; tod= wins; the runway keeps its time; resume keeps its own', () => {
    setEra('cretaceous');
    expect(bootTod('?era=cretaceous', 'safari')).toBe(SAFARI.tod);
    expect(bootTod('?era=cretaceous&tod=10', 'safari')).toBe(10);
    expect(bootTod('?era=cretaceous&scenario=runway&tod=10', 'runway')).toBe(10);
    expect(bootTod('?era=cretaceous&scenario=runway', 'runway')).toBe(defaultWeather().timeOfDay);
    expect(bootTod('?era=cretaceous', 'safari', 14.25)).toBe(14.25);
    expect(startTimeOfDay({ scenario: 'safari', urlTod: false, resumed: true })).toBeNull();
    setEra('present');
    expect(startTimeOfDay({ scenario: 'safari', urlTod: false, resumed: false })).toBeNull();
  });

  it('sky.dayFactor > 0.25 at SAFARI.tod (the showcase flyers do not roost)', () => {
    const y = -sunDirectionNED(SAFARI.tod, defaultWeather().dayOfYear).z;
    const t = Math.min(1, Math.max(0, (y + 0.12) / 0.22));
    expect(t * t * (3 - 2 * t)).toBeGreaterThan(0.25);
  });

  it('the tower camera is refused in the Cretaceous', () => {
    setEra('cretaceous');
    expect(cameraModeAllowed('tower')).toBe(false);
    expect(cameraModeAllowed('chase')).toBe(true);
    expect(bootCameraMode('tower')).toBe('cockpit');
    // Simulator.setCameraMode itself.
    const emitted: CameraMode[] = [];
    const fake = { fixedCamera: null, ctx: { cameraMode: 'cockpit' as CameraMode, events: { emit: (_: string, e: { mode: CameraMode }) => emitted.push(e.mode) } } };
    Simulator.prototype.setCameraMode.call(fake as unknown as Simulator, 'tower');
    expect(fake.ctx.cameraMode).toBe('cockpit');
    Simulator.prototype.setCameraMode.call(fake as unknown as Simulator, 'chase');
    expect(fake.ctx.cameraMode).toBe('chase');
    expect(emitted).toEqual(['chase']);
    setEra('present');
    expect(cameraModeAllowed('tower')).toBe(true);
    expect(bootCameraMode('tower')).toBe('tower');
    Simulator.prototype.setCameraMode.call(fake as unknown as Simulator, 'tower');
    expect(fake.ctx.cameraMode).toBe('tower');
  });

  it('the safari reset engages its hold; the head pitch knob is off', () => {
    setEra('cretaceous');
    const p = new SimPhysics({ weather: defaultWeather() });
    p.reset('safari');
    expect(p.autoflight.engaged).toBe(true);
    expect(p.autoflight.phase).toBe('hold');
    p.reset('runway');
    expect(p.autoflight.engaged).toBe(false);
    expect(safariHeadPitch('safari')).toBe(SAFARI.headPitchDeg);
    expect(SAFARI.headPitchDeg).toBeNull();
    expect(safariHeadPitch('runway')).toBeNull();
  });

  it("in the present, ?scenario=safari stays increment 1's start (600 ft, track 35, the hold not engaged)", () => {
    setEra('present');
    const env = new SimPhysics({ weather: defaultWeather() }).env;
    const sc = buildScenario('safari', env);
    expect(sc.engageAutoflight).toBeUndefined();
    expect(sc.title).toBe('Safari: the river valley, 600 ft');
    const rwy = AIRPORT.runway.heading;
    const n = 4870 * Math.cos(rwy) - 3450 * Math.sin(rwy);
    const e = 4870 * Math.sin(rwy) + 3450 * Math.cos(rwy);
    expect(sc.ic.position.x).toBeCloseTo(n, 6);
    expect(sc.ic.position.y).toBeCloseTo(e, 6);
    expect(-sc.ic.position.z).toBeCloseTo(terrainHeight(n, e) + 600 * FT, 6);
    expect(sc.ic.heading).toBeCloseTo(wrapTwoPi(rwy + Math.PI + 35 * DEG), 9);
    const p = new SimPhysics({ weather: defaultWeather() });
    p.reset('safari');
    expect(p.autoflight.engaged).toBe(false);
    setEra('cretaceous');
    expect(buildScenario('safari', env).engageAutoflight).toBe(true);
  });
});
