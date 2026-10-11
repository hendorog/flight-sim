import { afterEach, describe, expect, it, vi } from 'vitest';
import { MouseFlightGesture } from '../../src/input/mouseFlightGesture';
import { mouseYokeDeflection } from '../../src/input/mixer';
import { CameraSystem } from '../../src/render/cameras/CameraSystem';
import { C172S_INPUT } from '../../src/aircraft/c172s/input';
import { C152_INPUT } from '../../src/aircraft/c152/input';
import { PA38_INPUT } from '../../src/aircraft/pa38/input';
import { DA20_INPUT } from '../../src/aircraft/da20/input';
import { PA34_INPUT } from '../../src/aircraft/pa34/input';
import DA42 from '../../src/aircraft/da42';
import { R22_INPUT } from '../../src/aircraft/r22/input';
import { R44_INPUT } from '../../src/aircraft/r44/input';
import { S269_INPUT } from '../../src/aircraft/s269/input';
import { FRAME, makeInputRig } from './testbed';

const profiles = { C172S: C172S_INPUT, C152: C152_INPUT, PA38: PA38_INPUT, DA20: DA20_INPUT,
  PA34: PA34_INPUT, DA42: DA42.input, R22: R22_INPUT, R44: R44_INPUT, S269: S269_INPUT };

// No DOM shim: exercise the registered listeners through EventTarget with browser event fields.
function gestureRig() {
  const window = new EventTarget();
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', { pointerLockElement: null });
  const canvas = new EventTarget() as HTMLElement;
  const blocked = vi.fn(() => false), toggle = vi.fn();
  const gesture = new MouseFlightGesture(canvas, blocked, toggle);
  gesture.attach();
  const send = (type: string, fields: Record<string, unknown> = {}) => {
    const e = new Event(type, { cancelable: true });
    for (const [key, value] of Object.entries({ target: canvas, clientX: 300, clientY: 200,
      button: 0, pointerType: 'mouse', ...fields })) Object.defineProperty(e, key, { value });
    window.dispatchEvent(e);
    return e;
  };
  const click = (detail: number, fields: Record<string, unknown> = {}) => {
    send('pointerdown', { detail, ...fields });
    send('pointerup', { detail, ...fields });
    return send('click', { detail, ...fields });
  };
  return { window, canvas, blocked, toggle, gesture, send, click };
}

afterEach(() => vi.unstubAllGlobals());

describe('double-click flight gesture', () => {
  it('toggles once per native double-click and removes listeners on dispose', () => {
    const r = gestureRig();
    for (let i = 0; i < 2; i++) {
      expect(r.click(1).defaultPrevented).toBe(false);
      expect(r.toggle).toHaveBeenCalledTimes(i);
      r.click(2);
      expect(r.send('dblclick').defaultPrevented).toBe(true);
      expect(r.toggle).toHaveBeenCalledTimes(i + 1);
    }
    r.gesture.dispose();
    r.click(1); r.click(2); r.send('dblclick');
    expect(r.toggle).toHaveBeenCalledTimes(2);
  });

  it.each(['menu', 'checklist', 'school', 'demo', 'dialog', 'input', 'textarea', 'select', 'contenteditable', 'SVG child', 'other canvas'])(
    'leaves %s targets and their normal actions alone', () => {
      const r = gestureRig(), ui = new EventTarget();
      r.click(1, { target: ui }); r.click(2, { target: ui });
      expect(r.send('dblclick', { target: ui }).defaultPrevented).toBe(false);
      expect(r.toggle).not.toHaveBeenCalled();
      expect(r.blocked).not.toHaveBeenCalled();
    });

  it.each(['knob', 'switch', 'lever', 'button', 'instructor', 'demo', 'modal'])(
    'does not steal clicks blocked by the live %s hit-test/ownership hook', () => {
      const r = gestureRig();
      r.blocked.mockReturnValue(true);
      expect(r.click(1).defaultPrevented).toBe(false);
      expect(r.click(2).defaultPrevented).toBe(false);
      expect(r.send('dblclick').defaultPrevented).toBe(false);
      expect(r.toggle).not.toHaveBeenCalled();
      expect(r.blocked).toHaveBeenCalledWith(300, 200);
    });

  it('checks both clicks even when the second has moved off a panel control', () => {
    const r = gestureRig();
    r.blocked.mockReturnValue(true); r.click(1);
    r.blocked.mockReturnValue(false); r.click(2); r.send('dblclick');
    expect(r.toggle).not.toHaveBeenCalled();
  });

  it('rejects drag, cancelled gesture, non-left click and captured mouse look', () => {
    const r = gestureRig();
    r.send('pointerdown'); r.send('pointermove', { clientX: 310 }); r.send('pointermove');
    r.send('click', { detail: 1 }); r.click(2); r.send('dblclick');
    r.click(1); r.send('pointercancel'); r.click(2); r.send('dblclick');
    r.click(1, { button: 2 }); r.click(2, { button: 2 }); r.send('dblclick', { button: 2 });
    Object.defineProperty(document, 'pointerLockElement', { value: r.canvas });
    r.click(1); r.click(2); r.send('dblclick');
    expect(r.toggle).not.toHaveBeenCalled();
  });

  it('click jitter and the second press never rotate the camera; a deliberate drag still does', async () => {
    const r = gestureRig();
    const camera = new CameraSystem({ domElement: r.canvas });
    const internals = camera as unknown as {
      onPointerDown(e: object): void; onPointerUp(): void; onMouseMove(e: object): void;
      rigs: { cockpit: { look: (x: number, y: number) => void } };
    };
    const look = vi.spyOn(internals.rigs.cockpit, 'look');
    vi.spyOn(camera, 'getMode').mockReturnValue('cockpit');
    for (const detail of [1, 2]) {
      internals.onPointerDown({ button: 0, detail, clientX: 300, clientY: 200 });
      await Promise.resolve();
      for (let i = 0; i < 10; i++) internals.onMouseMove({ clientX: 300 + i % 3, clientY: 200, movementX: 1, movementY: 0 });
      internals.onPointerUp();
    }
    expect(look).not.toHaveBeenCalled();
    internals.onPointerDown({ button: 0, detail: 1, clientX: 300, clientY: 200 });
    await Promise.resolve();
    internals.onMouseMove({ clientX: 320, clientY: 200, movementX: 20, movementY: 0 });
    expect(look).toHaveBeenCalledOnce();
  });
});

describe('absolute mouse yoke/cyclic handover', () => {
  for (const [name, profile] of Object.entries(profiles)) it(`${name}: pickup is exact, signs and stops agree, release holds for keys in every view`, () => {
    const r = makeInputRig(profile, { aileron: -0.16, elevator: 0.23 });
    const pointer = r.input as unknown as { mouseNx: number; mouseNy: number; mouseMoves: number };
    const move = (x: number, y: number) => {
      pointer.mouseNx = x; pointer.mouseNy = y; pointer.mouseMoves++;
      r.input.update(FRAME, r.ctx);
    };
    for (const view of ['cockpit', 'chase', 'orbit', 'flyby', 'tower'] as const) {
      r.ctx.cameraMode = view;
      const initial = [r.c.aileron, r.c.elevator];
      r.tap('KeyY'); move(0.7, -0.6);
      expect(r.input.getYokeIndicator().mouseArmed).toBe(true);
      expect(r.c.aileron).toBeCloseTo(initial[0], 14);
      expect(r.c.elevator).toBeCloseTo(initial[1], 14);
      move(0.08, -0.09); // outer edge of pickup: no approximation of 'bumpless'.
      expect(r.input.getYokeIndicator().mouseArmed).toBe(false);
      expect(r.c.aileron).toBeCloseTo(initial[0], 14);
      expect(r.c.elevator).toBeCloseTo(initial[1], 14);
      move(0.3, -0.3);
      expect(r.c.aileron).toBeGreaterThan(initial[0]);
      expect(r.c.elevator).toBeLessThan(initial[1]);
      move(0.8, -0.8);
      expect(r.c.aileron).toBeCloseTo(1, 12);
      expect(r.c.elevator).toBeCloseTo(-1, 12);
      move(-0.8, 0.8);
      expect(r.c.aileron).toBeCloseTo(-1, 12);
      expect(r.c.elevator).toBeCloseTo(1, 12);
      move(0.12, -0.12);
      const held = [r.c.aileron, r.c.elevator];
      r.tap('KeyY'); r.run(0.5);
      expect(r.c.aileron).toBeCloseTo(held[0], 14);
      expect(r.c.elevator).toBeCloseTo(held[1], 14);
      r.tap('ArrowRight');
      expect(r.c.aileron).toBeGreaterThan(held[0]);
    }
  });

  it.each([R22_INPUT, R44_INPUT, S269_INPUT])('helicopter curve gives continuous fine hover corrections alongside pedals, collective and throttle', profile => {
    const r = makeInputRig(profile, { collective: 0.5, throttle: 0.7 });
    const pointer = r.input as unknown as { mouseNx: number; mouseNy: number; mouseMoves: number };
    r.input.setMouseYoke(true); pointer.mouseMoves++; r.run(FRAME);
    pointer.mouseNx = 0.05; pointer.mouseNy = -0.05; pointer.mouseMoves++; r.run(FRAME);
    const expected = mouseYokeDeflection(0.05, -0.05, profile.mouseYoke);
    expect(r.c.aileron).toBeCloseTo(expected.aileron);
    expect(r.c.elevator).toBeCloseTo(expected.elevator);
    expect(expected.aileron).toBeLessThan(mouseYokeDeflection(0.05, 0).aileron / 3);
    // One pixel at a 1600x900 view: less than 0.1% travel, with no dead band.
    const pixel = mouseYokeDeflection(2 / 1600, 2 / 900, profile.mouseYoke);
    expect(pixel.aileron).toBeGreaterThan(0); expect(pixel.elevator).toBeLessThan(0.001);
    r.tap('KeyX'); r.tap('F6'); r.tap('F3');
    expect(r.c.rudder).toBeGreaterThan(0);
    expect(r.c.collective).toBeGreaterThan(0.5);
    expect(r.c.throttle).toBeGreaterThan(0.7);
    expect(r.c.aileron).toBeCloseTo(expected.aileron);
    expect(r.c.elevator).toBeCloseTo(expected.elevator);
    r.ctx.events.emit('reset', { scenario: 'runway' }); r.run(FRAME);
    expect(r.input.getYokeIndicator().mouseArmed).toBe(true);
  });
});
