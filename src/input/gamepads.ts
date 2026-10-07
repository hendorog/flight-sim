// Gamepad API polling with hot-plug, per-device profiles and calibration persisted in localStorage.
//
// Every connected device gets a DeviceProfile (from storage, or a default for its detected kind). Each
// poll converts raw axes to control values through the profile's calibration and reports button edges as
// InputActions, so flight hardware and the keyboard share one action vocabulary.

import type { InputAction } from './bindings';
import { MotionDetector, normalizeBipolar, normalizeUnipolar, TakeoverDetector, widenRange, type AxisCalibration } from './axisFilter';
import { classifyDevice, defaultProfile, isBipolar, type AxisControl, type DeviceKind, type DeviceProfile } from './devices';

const STORAGE_KEY = 'fs.input.devices.v1';

/** One conditioned axis sample from a device. */
export interface AxisReading {
  control: AxisControl;
  value: number;
  /** True when the axis moved noticeably this poll (it is being handled). */
  moved: boolean;
  /**
   * True when a centring axis is being deliberately worked (moved well away from where it has been resting,
   * see TakeoverDetector): the pilot taking over from the autopilot. Never true for a steady deflection.
   */
  takeover: boolean;
}

export interface DeviceInfo {
  index: number;
  id: string;
  kind: DeviceKind;
  axes: { control: AxisControl; raw: number; value: number; cal: AxisCalibration }[];
  buttons: { pressed: boolean; action: InputAction | null }[];
  calibrating: boolean;
}

interface Device {
  index: number;
  id: string;
  mapping: string;
  profile: DeviceProfile;
  detectors: MotionDetector[];
  takeovers: TakeoverDetector[];
  buttonsDown: boolean[];
  /** Raw axis values from the latest poll. */
  raw: number[];
  values: number[];
}

function loadStore(): Record<string, DeviceProfile> {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    return s ? (JSON.parse(s) as Record<string, DeviceProfile>) : {};
  } catch {
    return {};
  }
}

export class GamepadManager {
  /** Conditioned axis readings from every device, refreshed by poll(). */
  readonly readings: AxisReading[] = [];
  /** Actions whose button went down during the last poll. */
  readonly pressed: InputAction[] = [];
  /** Actions whose button is currently held. */
  readonly held = new Set<InputAction>();

  private readonly pool: AxisReading[] = [];
  private readonly devices = new Map<number, Device>();
  private readonly store = loadStore();
  private calibrating: { index: number; centres: number[] } | null = null;
  private dirtySince = -1;
  private lastPoll = -1;
  private pollDt = 0;

  /** Poll navigator.getGamepads(); handles connect/disconnect by diffing the list (hot-plug). */
  poll(now: number): void {
    this.readings.length = 0;
    this.pressed.length = 0;
    this.held.clear();
    this.pollDt = this.lastPoll < 0 ? 0 : Math.min(0.25, Math.max(0, (now - this.lastPoll) / 1000));
    this.lastPoll = now;
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    const seen = new Set<number>();
    for (const pad of pads) {
      if (!pad || !pad.connected) continue;
      seen.add(pad.index);
      let dev = this.devices.get(pad.index);
      if (!dev || dev.id !== pad.id) dev = this.attach(pad);
      this.read(dev, pad);
    }
    for (const index of this.devices.keys()) if (!seen.has(index)) this.devices.delete(index);
    // Auto-calibration widens ranges continuously; persist at most every two seconds.
    if (this.dirtySince >= 0 && now - this.dirtySince > 2000) this.save();
  }

  private attach(pad: Gamepad): Device {
    const stored = this.store[pad.id];
    const profile =
      stored && stored.axes.length === pad.axes.length ? stored : defaultProfile(classifyDevice(pad.id, pad.mapping), pad.axes.length);
    const dev: Device = {
      index: pad.index,
      id: pad.id,
      mapping: pad.mapping,
      profile,
      detectors: pad.axes.map(() => new MotionDetector()),
      takeovers: pad.axes.map(() => new TakeoverDetector()),
      buttonsDown: pad.buttons.map((b) => b.pressed),
      raw: pad.axes.map(() => 0),
      values: pad.axes.map(() => 0),
    };
    this.devices.set(pad.index, dev);
    return dev;
  }

  private read(dev: Device, pad: Gamepad): void {
    const { profile } = dev;
    const cal = this.calibrating?.index === dev.index;
    for (let i = 0; i < pad.axes.length && i < profile.axes.length; i++) {
      const raw = pad.axes[i];
      const b = profile.axes[i];
      dev.raw[i] = raw;
      if (widenRange(b.cal, raw) && !cal) this.markDirty();
      if (b.control === 'none') continue;
      const value = isBipolar(b.control) ? normalizeBipolar(raw, b.cal) : normalizeUnipolar(raw, b.cal);
      dev.values[i] = value;
      const takeover = isBipolar(b.control) && dev.takeovers[i].update(value, this.pollDt);
      this.emit(b.control, value, dev.detectors[i].moved(value), takeover);
    }
    for (const ab of profile.analogButtons) {
      const btn = pad.buttons[ab.button];
      if (btn) this.emit(ab.control, btn.value, false, false);
    }
    for (let i = 0; i < pad.buttons.length; i++) {
      const down = pad.buttons[i].pressed;
      const action = profile.buttons[i];
      if (action) {
        if (down) this.held.add(action);
        if (down && !dev.buttonsDown[i]) this.pressed.push(action);
      }
      dev.buttonsDown[i] = down;
    }
  }

  /** Append a reading, reusing pooled objects so polling does not allocate. */
  private emit(control: AxisControl, value: number, moved: boolean, takeover: boolean): void {
    const n = this.readings.length;
    const r = this.pool[n] ?? (this.pool[n] = { control, value, moved, takeover });
    r.control = control;
    r.value = value;
    r.moved = moved;
    r.takeover = takeover;
    this.readings.push(r);
  }

  private markDirty(): void {
    if (this.dirtySince < 0) this.dirtySince = performance.now();
  }

  private save(): void {
    this.dirtySince = -1;
    for (const dev of this.devices.values()) this.store[dev.id] = dev.profile;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.store));
    } catch {
      // Storage unavailable (private mode): calibration simply lasts for this session.
    }
  }

  /** Snapshot of connected devices for a settings / calibration screen. */
  list(): DeviceInfo[] {
    return [...this.devices.values()].map((d) => ({
      index: d.index,
      id: d.id,
      kind: d.profile.kind,
      axes: d.profile.axes.map((a, i) => ({ control: a.control, raw: d.raw[i] ?? 0, value: d.values[i] ?? 0, cal: a.cal })),
      buttons: d.buttonsDown.map((pressed, i) => ({ pressed, action: d.profile.buttons[i] ?? null })),
      calibrating: this.calibrating?.index === d.index,
    }));
  }

  get connectedCount(): number {
    return this.devices.size;
  }

  /** Assign an axis to a control (or 'none'). */
  setAxisControl(index: number, axis: number, control: AxisControl): void {
    const b = this.devices.get(index)?.profile.axes[axis];
    if (!b) return;
    b.control = control;
    this.save();
  }

  setAxisOptions(index: number, axis: number, opts: Partial<Pick<AxisCalibration, 'invert' | 'deadzone' | 'curve'>>): void {
    const b = this.devices.get(index)?.profile.axes[axis];
    if (!b) return;
    Object.assign(b.cal, opts);
    this.save();
  }

  setButtonAction(index: number, button: number, action: InputAction | null): void {
    const p = this.devices.get(index)?.profile;
    if (!p) return;
    if (action) p.buttons[button] = action;
    else delete p.buttons[button];
    this.save();
  }

  /**
   * Start calibrating a device: centre every control first, then call this, sweep every axis through its
   * full travel, and call endCalibration(). The rest position becomes each axis's centre.
   */
  beginCalibration(index: number): void {
    const dev = this.devices.get(index);
    if (!dev) return;
    this.calibrating = { index, centres: [...dev.raw] };
    dev.profile.axes.forEach((a, i) => {
      a.cal.min = a.cal.max = a.cal.center = dev.raw[i];
    });
  }

  endCalibration(): void {
    const c = this.calibrating;
    this.calibrating = null;
    const dev = c && this.devices.get(c.index);
    if (!dev) return;
    dev.profile.axes.forEach((a, i) => {
      // An axis that was never moved keeps the nominal range rather than a zero-width one.
      if (a.cal.max - a.cal.min < 0.2) Object.assign(a.cal, { min: -1, max: 1, center: c.centres[i] });
    });
    this.save();
  }

  /** Forget a device's stored profile and return to the default layout for its kind. */
  resetProfile(index: number): void {
    const dev = this.devices.get(index);
    if (!dev) return;
    delete this.store[dev.id];
    dev.profile = defaultProfile(classifyDevice(dev.id, dev.mapping), dev.raw.length);
    this.save();
  }
}
