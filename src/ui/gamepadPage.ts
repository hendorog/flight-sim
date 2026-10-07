// Controllers page of the pause menu: every connected game controller / yoke / pedals / quadrant with live
// axis and button read-outs, axis assignment, invert, dead zone and response curve, button assignment,
// the calibration flow and profile reset. Built on the input module's GamepadManager (profiles persist
// per device id in localStorage, which the manager handles).

import type { AxisControl, DeviceInfo, InputAction } from '../input';
import { el, setText } from './dom';

/** The part of the input module's GamepadManager this page uses. */
export interface GamepadSettings {
  list(): DeviceInfo[];
  setAxisControl(index: number, axis: number, control: AxisControl): void;
  setAxisOptions(index: number, axis: number, opts: { invert?: boolean; deadzone?: number; curve?: number }): void;
  setButtonAction(index: number, button: number, action: InputAction | null): void;
  beginCalibration(index: number): void;
  endCalibration(): void;
  resetProfile(index: number): void;
}

const AXIS_CHOICES: [AxisControl, string][] = [
  ['none', '—'],
  ['aileron', 'Aileron (roll)'],
  ['elevator', 'Elevator (pitch)'],
  ['rudder', 'Rudder'],
  ['throttle', 'Throttle lever'],
  ['throttleRate', 'Throttle (rate, centring stick)'],
  ['mixture', 'Mixture'],
  ['brakeLeft', 'Left toe brake'],
  ['brakeRight', 'Right toe brake'],
  ['brakes', 'Both brakes'],
];

const BUTTON_CHOICES: [InputAction | '', string][] = [
  ['', '—'],
  ['brakes', 'Brakes (hold)'],
  ['parkingBrake', 'Parking brake'],
  ['flapsUp', 'Flaps up'],
  ['flapsDown', 'Flaps down'],
  ['trimNoseUp', 'Trim nose up'],
  ['trimNoseDown', 'Trim nose down'],
  ['throttleUp', 'Throttle forward'],
  ['throttleDown', 'Throttle back'],
  ['mixtureRich', 'Mixture rich'],
  ['mixtureLean', 'Mixture lean'],
  ['starter', 'Starter (hold)'],
  ['magnetoBoth', 'Magnetos BOTH'],
  ['magnetoOff', 'Magnetos OFF'],
  ['landingLight', 'Landing light'],
  ['taxiLight', 'Taxi light'],
  ['navLights', 'Nav lights'],
  ['strobes', 'Strobes'],
  ['beacon', 'Beacon'],
  ['cameraNext', 'Next camera'],
  ['cameraPrev', 'Previous camera'],
  ['viewRecentre', 'Recentre view'],
  ['zoomIn', 'Zoom in'],
  ['zoomOut', 'Zoom out'],
  ['pause', 'Pause'],
];

const KIND_NAMES: Record<DeviceInfo['kind'], string> = {
  gamepad: 'Gamepad',
  joystick: 'Joystick',
  yoke: 'Yoke',
  pedals: 'Rudder pedals',
  throttle: 'Throttle quadrant',
};

interface AxisRow {
  fill: HTMLElement;
  raw: HTMLElement;
}

export class GamepadPage {
  private manager: GamepadSettings | null = null;
  private readonly body: HTMLElement;
  private signature = '?';
  private axisRows: AxisRow[][] = [];
  private buttonDots: HTMLElement[][] = [];

  constructor(page: HTMLElement) {
    this.body = el('div', 'pads', page);
  }

  setManager(m: GamepadSettings | null): void {
    this.manager = m;
    this.signature = '?';
  }

  /** Called every frame while the page is visible: rebuild on hot-plug, otherwise refresh live values. */
  update(): void {
    const list = this.manager?.list() ?? [];
    const sig = this.manager ? 'pads:' + list.map((d) => `${d.index}:${d.id}:${d.axes.length}:${d.buttons.length}:${d.calibrating}`).join('|') : 'none';
    if (sig !== this.signature) {
      this.signature = sig;
      this.build(list);
      return;
    }
    list.forEach((d, i) => {
      d.axes.forEach((a, k) => {
        const row = this.axisRows[i]?.[k];
        if (!row) return;
        // Value is -1..1 for bipolar controls and 0..1 for levers: draw both on one centred bar.
        const v = Math.max(-1, Math.min(1, a.value));
        const bipolar = a.control === 'aileron' || a.control === 'elevator' || a.control === 'rudder' || a.control === 'throttleRate';
        row.fill.style.left = bipolar ? `${50 + Math.min(0, v) * 50}%` : '0%';
        row.fill.style.width = bipolar ? `${Math.abs(v) * 50}%` : `${Math.max(0, v) * 100}%`;
        setText(row.raw, a.raw.toFixed(2));
      });
      d.buttons.forEach((b, k) => this.buttonDots[i]?.[k]?.classList.toggle('on', b.pressed));
    });
  }

  private build(list: DeviceInfo[]): void {
    const m = this.manager;
    this.body.replaceChildren();
    this.axisRows = [];
    this.buttonDots = [];
    if (!m) {
      el('p', 'sub', this.body, 'Controller settings are not available in this build.');
      return;
    }
    if (list.length === 0) {
      const empty = el('div', 'pad-empty', this.body);
      el('b', '', empty, 'No controllers connected');
      el('span', '', empty, 'Connect a yoke, joystick, pedals, throttle quadrant or gamepad and press any of its buttons: browsers only report a controller after it has been used.');
      return;
    }
    const calibrating = list.some((d) => d.calibrating);
    for (const d of list) {
      const card = el('div', 'pad', this.body);
      const head = el('div', 'pad-head', card);
      const title = el('div', 'pad-title', head);
      el('b', '', title, KIND_NAMES[d.kind] ?? d.kind);
      el('span', '', title, d.id);
      const cal = el('button', d.calibrating ? 'primary' : '', head, d.calibrating ? 'Finish calibration' : 'Calibrate…');
      cal.disabled = calibrating && !d.calibrating;
      cal.addEventListener('click', () => {
        if (d.calibrating) m.endCalibration();
        else m.beginCalibration(d.index);
        this.signature = '?';
      });
      const reset = el('button', '', head, 'Reset');
      reset.title = 'Forget this device’s settings and return to the default layout';
      reset.addEventListener('click', () => {
        m.resetProfile(d.index);
        this.signature = '?';
      });
      if (d.calibrating) {
        el('p', 'pad-note', card, 'Move every axis slowly through its full travel (stick and yoke to all corners, pedals and levers end to end), then let the self-centring controls return to the middle and press Finish calibration.');
      }

      const axes = el('div', 'pad-axes', card);
      for (const h of ['Axis', 'Live', 'Controls', 'Invert', 'Dead zone', 'Curve']) el('span', 'pad-th', axes, h);
      const rows: AxisRow[] = [];
      d.axes.forEach((a, k) => {
        el('span', 'num pad-axis', axes, `${k}`);
        const live = el('div', 'pad-live', axes);
        const bar = el('div', 'bar pad-bar', live);
        const fill = el('i', '', bar);
        const raw = el('span', 'num', live, a.raw.toFixed(2));
        const sel = el('select', '', axes);
        for (const [v, name] of AXIS_CHOICES) {
          const o = el('option', '', sel, name);
          o.value = v;
        }
        sel.value = a.control;
        sel.addEventListener('change', () => {
          m.setAxisControl(d.index, k, sel.value as AxisControl);
          sel.blur();
        });
        const inv = el('input', '', axes);
        inv.type = 'checkbox';
        inv.checked = a.cal.invert;
        inv.addEventListener('change', () => m.setAxisOptions(d.index, k, { invert: inv.checked }));
        rangeInput(axes, 0, 0.3, 0.01, a.cal.deadzone, (v) => m.setAxisOptions(d.index, k, { deadzone: v }), (v) => `${Math.round(v * 100)}%`);
        rangeInput(axes, 0, 1, 0.05, a.cal.curve, (v) => m.setAxisOptions(d.index, k, { curve: v }), (v) => (v < 0.03 ? 'linear' : `${Math.round(v * 100)}%`));
        rows.push({ fill, raw });
      });
      this.axisRows.push(rows);

      if (d.buttons.length) {
        el('h3', '', card, 'Buttons');
        const grid = el('div', 'pad-buttons', card);
        const dots: HTMLElement[] = [];
        d.buttons.forEach((b, k) => {
          const cell = el('label', 'pad-btn', grid);
          const dot = el('i', b.pressed ? 'on' : '', cell);
          el('span', 'num', cell, `${k + 1}`);
          const sel = el('select', '', cell);
          for (const [v, name] of BUTTON_CHOICES) {
            const o = el('option', '', sel, name);
            o.value = v;
          }
          if (b.action && !BUTTON_CHOICES.some(([v]) => v === b.action)) {
            const o = el('option', '', sel, b.action);
            o.value = b.action;
          }
          sel.value = b.action ?? '';
          sel.addEventListener('change', () => {
            m.setButtonAction(d.index, k, (sel.value || null) as InputAction | null);
            sel.blur();
          });
          dots.push(dot);
        });
        this.buttonDots.push(dots);
      } else this.buttonDots.push([]);
    }
  }
}

function rangeInput(parent: HTMLElement, min: number, max: number, step: number, value: number, set: (v: number) => void, fmt: (v: number) => string): void {
  const wrap = el('div', 'pad-range', parent);
  const i = el('input', '', wrap);
  i.type = 'range';
  i.min = String(min);
  i.max = String(max);
  i.step = String(step);
  i.value = String(value);
  const out = el('output', 'num', wrap, fmt(value));
  const paint = (): void => {
    const v = Number(i.value);
    i.style.setProperty('--p', `${((v - min) / (max - min)) * 100}%`);
    out.textContent = fmt(v);
  };
  paint();
  i.addEventListener('input', () => {
    paint();
    set(Number(i.value));
  });
}
