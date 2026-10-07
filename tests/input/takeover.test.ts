// Pilot take-over detection (autopilot disconnect), mouse-yoke pick-up and the controller pause button.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { TakeoverDetector } from '../../src/input/axisFilter';
import { InputSystem } from '../../src/input/InputSystem';
import { mouseYokeNearCentre } from '../../src/input/mixer';
import { RotationGuard } from '../../src/input/virtualYoke';
import { FRAME, makeRig } from './keyboardPilot';

describe('TakeoverDetector', () => {
  it('a yoke resting off centre, even well off, never counts as the pilot taking over', () => {
    for (const rest of [0, 0.035, 0.1, -0.25]) {
      const d = new TakeoverDetector();
      let any = false;
      for (let i = 0; i < 600; i++) any = d.update(rest + 0.004 * Math.sin(i), FRAME) || any; // sensor noise
      expect(any).toBe(false);
    }
  });

  it('slow drift does not count; a deliberate movement does, then stops counting once held', () => {
    const d = new TakeoverDetector();
    let any = false;
    for (let i = 0; i <= 600; i++) any = d.update((0.1 * i) / 600, FRAME) || any; // 0 -> 0.1 in 10 s
    expect(any).toBe(false);
    let hits = 0;
    for (let i = 0; i <= 18; i++) if (d.update(0.1 + (0.3 * i) / 18, FRAME)) hits++; // +0.3 in 0.3 s
    expect(hits).toBeGreaterThan(0);
    hits = 0;
    for (let i = 0; i < 600; i++) if (d.update(0.4, FRAME)) hits++;
    expect(hits).toBe(0);
  });
});

/** A fake hardware yoke through navigator.getGamepads (as a Logitech yoke with the default profile). */
function fakeYoke(): { axes: number[]; buttons: { pressed: boolean; value: number }[] } {
  const pad = {
    id: 'Logitech G Pro Flight Yoke System (Vendor: 06a3 Product: 0bac)',
    index: 0,
    connected: true,
    mapping: '',
    timestamp: 0,
    axes: [0, 0, -1, 0, -1],
    buttons: Array.from({ length: 12 }, () => ({ pressed: false, touched: false, value: 0 })),
  };
  Object.defineProperty(globalThis.navigator, 'getGamepads', { value: () => [pad, null, null, null], configurable: true });
  return pad;
}

function fakeXbox(): { buttons: { pressed: boolean; value: number }[] } {
  const pad = {
    id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)',
    index: 0,
    connected: true,
    mapping: 'standard',
    timestamp: 0,
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
  };
  Object.defineProperty(globalThis.navigator, 'getGamepads', { value: () => [pad, null, null, null], configurable: true });
  return pad;
}

describe('InputSystem: pilot take-over from the autopilot', () => {
  afterEach(() => {
    Object.defineProperty(globalThis.navigator, 'getGamepads', { value: undefined, configurable: true });
  });

  it('a hardware yoke resting a few percent off centre does not count as flying; pulling it does', async () => {
    const pad = fakeYoke();
    const r = makeRig();
    const tick = async (n: number): Promise<boolean> => {
      let flying = false;
      for (let i = 0; i < n; i++) {
        r.input.update(FRAME, r.ctx);
        flying = r.input.pilotFlying(1) || flying;
        await new Promise((res) => setTimeout(res, 2));
      }
      return flying;
    };
    await tick(3);
    for (const rest of [0.035, 0.1]) {
      pad.axes[1] = rest;
      await tick(80); // settle
      expect(await tick(60)).toBe(false);
      // The hardware still owns the elevator (the yoke's own position is flown).
      expect(r.input.getYokeIndicator().source).toBe('hardware');
    }
    // A deliberate pull.
    let flying = false;
    for (let i = 1; i <= 10; i++) {
      pad.axes[1] = 0.1 + 0.03 * i;
      flying = (await tick(1)) || flying;
    }
    expect(flying).toBe(true);
  });
});

describe('InputSystem: mouse yoke pick-up', () => {
  it('switching the mouse yoke on with the pointer off centre leaves the controls alone until it passes the centre', () => {
    const r = makeRig();
    const input = r.input as unknown as { mouseNx: number; mouseNy: number; mouseMoves: number };
    const toasts: string[] = [];
    r.input.setShell({ toast: (t) => toasts.push(t) });
    // The pointer was last used near the top-left corner.
    input.mouseNx = -0.75;
    input.mouseNy = -0.66;
    input.mouseMoves++;
    const ail0 = r.ctx.controls.aileron;
    const ele0 = r.ctx.controls.elevator;
    r.input.keyDown('KeyY');
    for (let i = 0; i < 30; i++) r.input.update(FRAME, r.ctx);
    r.input.keyUp('KeyY');
    expect(r.input.isMouseYoke()).toBe(true);
    expect(r.input.getYokeIndicator().mouseArmed).toBe(true);
    expect(r.input.getYokeIndicator().source).toBe('keyboard');
    expect(Math.abs(r.ctx.controls.aileron - ail0)).toBeLessThan(0.05);
    expect(Math.abs(r.ctx.controls.elevator - ele0)).toBeLessThan(0.05);
    expect(toasts[0]).toMatch(/Mouse yoke on/);
    // Moving through the centre picks it up without a bump.
    input.mouseNx = 0.03;
    input.mouseNy = -0.02;
    input.mouseMoves++;
    r.input.update(FRAME, r.ctx);
    expect(r.input.getYokeIndicator().mouseArmed).toBe(false);
    expect(r.input.getYokeIndicator().source).toBe('mouse');
    expect(Math.abs(r.ctx.controls.aileron)).toBeLessThan(0.05);
    // Then it flies: pointer to the right = right aileron.
    input.mouseNx = 0.4;
    input.mouseMoves++;
    r.input.update(FRAME, r.ctx);
    expect(r.ctx.controls.aileron).toBeGreaterThan(0.3);
    expect(r.input.pilotFlying(50)).toBe(true);
    r.input.setMouseYoke(false);
    expect(toasts[1]).toBe('Mouse yoke off');
  });

  it('pick-up zone', () => {
    expect(mouseYokeNearCentre(0, 0)).toBe(true);
    expect(mouseYokeNearCentre(0.09, -0.09)).toBe(true);
    expect(mouseYokeNearCentre(0.2, 0)).toBe(false);
  });
});

describe('InputSystem: controller Start button', () => {
  afterEach(() => {
    Object.defineProperty(globalThis.navigator, 'getGamepads', { value: undefined, configurable: true });
  });

  it('goes through the shell (modal-aware menu toggle), never straight to setPaused', () => {
    const pad = fakeXbox();
    const r = makeRig();
    const setPaused = vi.fn();
    r.ctx.commands.setPaused = setPaused;
    const menuButton = vi.fn();
    r.input.setShell({ menuButton });
    r.input.update(FRAME, r.ctx);
    pad.buttons[9] = { pressed: true, value: 1 };
    r.input.update(FRAME, r.ctx);
    pad.buttons[9] = { pressed: false, value: 0 };
    r.input.update(FRAME, r.ctx);
    expect(menuButton).toHaveBeenCalledTimes(1);
    expect(setPaused).not.toHaveBeenCalled();
    // The keyboard Pause key still toggles the pause directly (the UI captures keys while a menu is open).
    r.input.keyDown('Pause');
    r.input.update(FRAME, r.ctx);
    expect(setPaused).toHaveBeenCalledTimes(1);
  });
});

describe('RotationGuard (acts only while the nose-up key is held)', () => {
  const deg = Math.PI / 180;
  it('passes the keyboard deflection through in flight, with the nose down, for slow rotation, and with no key held', () => {
    const g = new RotationGuard();
    expect(g.step(0.6, 0.5, 0.5, 0.2, false, FRAME, true)).toBe(0.6); // a fresh pull in the air
    expect(g.step(-0.3, -0.2, 0.5, 0.05, true, FRAME, false)).toBe(-0.3);
    const g2 = new RotationGuard();
    expect(g2.step(0.2, 0.18, 0.02, 0.02, true, FRAME, true)).toBe(0.2);
    // Released on the ground with the nose coming up fast: the held yoke is left alone.
    const g3 = new RotationGuard();
    g3.step(0.3, 0.3, 0.1, 0.05, true, FRAME, false);
    expect(g3.step(0.3, 0.3, 0.3, 12 * deg, true, FRAME, false)).toBe(0.3);
  });

  it('holds and bleeds the deflection while the key is held and the nose comes up fast or nears the tail-strike attitude', () => {
    const g = new RotationGuard();
    g.step(0.2, 0.2, 0.1, 0.05, true, FRAME, true);
    const v = g.step(0.25, 0.2, 0.3, 0.06, true, FRAME, true); // 17 deg/s
    expect(v).toBeLessThan(0.2);
    const g2 = new RotationGuard();
    g2.step(0.3, 0.3, 0, 0.2, true, FRAME, true);
    expect(g2.step(0.3, 0.3, 0, 12 * deg, true, FRAME, true)).toBeLessThan(0.3);
  });

  it('stays latched through lift-off while the key held on the ground is still held, and lets go with it', () => {
    const g = new RotationGuard();
    g.step(0.2, 0.2, 0, 8 * deg, true, FRAME, true);
    for (let t = 0; t < 5; t += FRAME) g.step(0.3, 0.3, 0, 9 * deg, false, FRAME, true);
    expect(g.active).toBe(true);
    expect(g.step(0.3, 0.3, 0, 13 * deg, false, FRAME, true)).toBeLessThan(0.3);
    // Released: no longer acting, even at 13 deg.
    expect(g.step(0.3, 0.3, 0, 13 * deg, false, FRAME, false)).toBe(0.3);
    expect(g.active).toBe(false);
    // A new pull in flight does not latch.
    g.step(0.3, 0.3, 0, 13 * deg, false, FRAME, true);
    expect(g.step(0.3, 0.3, 0, 13 * deg, false, FRAME, true)).toBe(0.3);
  });
});
