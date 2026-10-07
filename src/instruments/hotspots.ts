// Clickable parts of the panel texture: knobs, switches, the magneto key or the ignition switches, the gear
// selector, the flap switch and guarded knobs, in panel pixels, and what operating them does to ControlInputs. Built from a panel definition (buildHotspots); PANEL_HOTSPOTS and the
// functions that name a hotspot by id are the Cessna 172S panel's. Pure (no DOM, no three.js): the UI raycasts
// the 3D panel face, converts the hit uv to panel pixels (x = u * width, y = (1 - v) * height) and operates the
// hotspot it finds there.

import { C172S_PANEL } from '../aircraft/c172s/panel';
import { engineControl, setEngineControl, type ControlInputs, type MagnetoPosition } from '../core/types';
import type { InputAction } from '../input/bindings';
import type { PanelDef } from './panelDef';
import { FLAP_SWITCH, flapLeverValues, flapPositionOf, GEAR_LEVER, GUARDED_KNOB, ignitionLayout, leverId } from './panelParts';

/** The hotspots of the C172S panel. */
export type HotspotId =
  | 'kollsman'
  | 'headingBug'
  | 'dgAlign'
  | 'obs'
  | 'panelDimmer'
  | 'radioDimmer'
  | 'magnetos'
  | 'alternator'
  | 'battery'
  | 'fuelPump'
  | 'beacon'
  | 'landing'
  | 'taxi'
  | 'nav'
  | 'strobe'
  | 'avionics'
  | 'pitotHeat';

/**
 * knob: turned with the wheel, or by clicking its left (decrease) / right (increase) half, repeating while
 * held. toggle: flips on each click. push: true while held (momentary). select: a lever or switch with several
 * positions in a vertical slot, moved one position up by a click on its upper half and down by one on its lower
 * half. The magneto key is a knob whose last clockwise step is the spring-loaded START (held).
 */
export type HotspotKind = 'knob' | 'toggle' | 'push' | 'select';

export interface PanelHotspot {
  /** A switch of the row has its SwitchDef's id. */
  id: string;
  kind: HotspotKind;
  /** Centre, panel px. */
  x: number;
  y: number;
  /** Half extents of the clickable box, panel px. */
  hw: number;
  hh: number;
  /** Short name for the tooltip. */
  name: string;
  /** How to operate it, for the tooltip. */
  hint: string;
  /** knob: turn it one detent. dir = +1 clockwise (increase) / -1; `coarse` multiplies the step (fast spin). */
  turn?(dir: 1 | -1, c: ControlInputs, coarse: number): void;
  /** toggle: flip the switch. */
  toggle?(c: ControlInputs): void;
  /** push: a momentary control written directly, true while held. */
  press?(down: boolean, c: ControlInputs): void;
  /**
   * push: the action held through the input module while the button is down (InputSystem.hold), which is what
   * keeps a momentary control the input module rewrites every frame. `engine` given: that engine's control,
   * whatever engine the keyboard has selected.
   */
  hold?: { action: InputAction; engine?: number };
  /** select: move one position. dir = +1 toward the lower end of the slot / -1 toward the upper end. */
  step?(dir: 1 | -1, c: ControlInputs): void;
  /**
   * knob whose last clockwise step is spring-loaded: while `when` holds, a clockwise click does not turn it but
   * holds `action` through the input module until the button is released (the magneto key's START).
   */
  springHold?: { when(c: ControlInputs): boolean; action: InputAction };
  /** knob that moves one position per click and does not repeat while held (a key switch). */
  noRepeat?: boolean;
  /** Current setting as tooltip text. */
  value(c: ControlInputs): string;
}

const HPA_PER_INHG = 33.8639;
const wrap360 = (d: number): number => ((Math.round(d) % 360) + 360) % 360;
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const onOff = (v: boolean): string => (v ? 'ON' : 'OFF');
const degrees = (d: number): string => `${String(wrap360(d)).padStart(3, '0')}°`;

type Knob = Required<Pick<PanelHotspot, 'turn' | 'value'>>;
const knob = (id: string, x: number, y: number, name: string, does: Knob, r = 15): PanelHotspot => ({
  id,
  kind: 'knob',
  x,
  y,
  hw: r,
  hh: r,
  name,
  hint: 'scroll, or click left / right half',
  ...does,
});

const KOLLSMAN: Knob = {
  turn(dir, c, coarse) {
    // Detents of 0.01 inHg, kept inside the 28.10 - 31.00 inHg window of the instrument.
    const inHg = Math.round((c.kollsmanHpa / HPA_PER_INHG) * 100) / 100 + dir * 0.01 * coarse;
    c.kollsmanHpa = Math.min(31, Math.max(28.1, inHg)) * HPA_PER_INHG;
  },
  value: (c) => `${(c.kollsmanHpa / HPA_PER_INHG).toFixed(2)} inHg (${Math.round(c.kollsmanHpa)} hPa)`,
};
const HEADING_BUG: Knob = {
  turn(dir, c, coarse) {
    c.headingBugDeg = wrap360(c.headingBugDeg + dir * coarse);
  },
  value: (c) => degrees(c.headingBugDeg),
};
const OBS: Knob = {
  turn(dir, c, coarse) {
    c.obsDeg = wrap360(c.obsDeg + dir * coarse);
  },
  value: (c) => degrees(c.obsDeg),
};
/** Both dimmers set the one panel-light level. */
const DIMMER: Knob = {
  turn(dir, c) {
    c.lights.panel = clamp01(Math.round((c.lights.panel + dir * 0.05) * 20) / 20);
  },
  value: (c) => `${Math.round(c.lights.panel * 100)} %`,
};

/** Offsets of the bezel knobs from the dial centres (see paintOverBezel in the gauge classes). */
const BEZEL_KNOB = 86 - 15;

const ENGINE_NAMES = ['Left engine', 'Right engine'];
/** How a control of one engine is named: by side on a twin. */
const engineName = (engines: number, engine: number, what: string): string =>
  engines > 1 ? `${ENGINE_NAMES[engine] ?? `Engine ${engine + 1}`} ${what}` : what.charAt(0).toUpperCase() + what.slice(1);

/**
 * The hotspots of a toggle / engine-master ignition group: one toggle per magneto or ENGINE MASTER and one
 * starter push per engine. On a twin each writes its own engine's control (setEngineControl); with one engine
 * the switch IS the control.
 */
function ignitionHotspots(def: PanelDef): PanelHotspot[] {
  const layout = ignitionLayout(def.ignition);
  if (!layout) return [];
  const n = layout.starters.length;
  const spots: PanelHotspot[] = [];
  for (const t of layout.toggles) {
    const e = t.engine;
    const base = { kind: 'toggle' as const, x: t.x, y: t.y, hw: t.kind === 'engineMaster' ? 15 : 12, hh: 25, hint: 'click to switch' };
    if (t.kind === 'engineMaster') {
      spots.push({
        ...base,
        id: `engine${e + 1}Master`,
        name: engineName(n, e, 'ENGINE MASTER'),
        toggle(c) {
          if (n > 1) setEngineControl(c, e, 'engineMaster', !engineControl(c, e, 'engineMaster'));
          else c.engineMaster = !c.engineMaster;
        },
        value: (c) => onOff(engineControl(c, e, 'engineMaster')),
      });
    } else {
      // The bit of the magneto in MagnetoPosition: OFF 0, R 1, L 2, BOTH 3.
      const bit = t.kind === 'magnetoLeft' ? 2 : 1;
      spots.push({
        ...base,
        id: `engine${e + 1}${t.kind === 'magnetoLeft' ? 'MagnetoLeft' : 'MagnetoRight'}`,
        name: engineName(n, e, t.kind === 'magnetoLeft' ? 'left magneto' : 'right magneto'),
        toggle(c) {
          const next = (engineControl(c, e, 'magnetos') ^ bit) as MagnetoPosition;
          if (n > 1) setEngineControl(c, e, 'magnetos', next);
          else c.magnetos = next;
        },
        value: (c) => onOff((engineControl(c, e, 'magnetos') & bit) !== 0),
      });
    }
  }
  for (const s of layout.starters) {
    spots.push({
      id: `engine${s.engine + 1}Starter`,
      kind: 'push',
      x: s.x,
      y: s.y,
      hw: s.hw,
      hh: s.hh,
      name: engineName(n, s.engine, 'starter'),
      hint: 'hold to crank',
      hold: { action: 'starter', engine: s.engine },
      value: (c) => (engineControl(c, s.engine, 'starter') ? 'START' : ''),
    });
  }
  return spots;
}

/** The hotspots a gauge brings besides the bezel knobs: the gear selector, the flap switch, a guarded knob. */
function gaugeHotspots(g: PanelDef['gauges'][number]): PanelHotspot[] {
  if (g.kind === 'gearLights' && g.lever) {
    return [
      {
        id: leverId(g.id),
        kind: 'select',
        x: g.lever[0],
        y: g.lever[1],
        hw: 22,
        hh: GEAR_LEVER.travel / 2 + 14,
        name: 'Landing gear',
        hint: 'click the upper half for UP, the lower half for DOWN',
        step(dir, c) {
          c.gearLever = dir > 0 ? 'down' : 'up';
        },
        value: (c) => (c.gearLever === 'up' ? 'UP' : 'DOWN'),
      },
    ];
  }
  if (g.kind === 'flapLights' && g.lever) {
    const levers = flapLeverValues(g);
    return [
      {
        id: leverId(g.id),
        kind: 'select',
        x: g.lever[0],
        y: g.lever[1],
        hw: 22,
        hh: ((g.positions.length - 1) * FLAP_SWITCH.pitch) / 2 + 14,
        name: 'Flaps',
        hint: 'click the upper half to retract one position, the lower half to extend one',
        step(dir, c) {
          c.flaps = levers[Math.min(levers.length - 1, Math.max(0, flapPositionOf(levers, c.flaps) + dir))];
        },
        value: (c) => g.positions[flapPositionOf(levers, c.flaps)],
      },
    ];
  }
  if (g.kind === 'guardedKnob') {
    // The one action this panel knows the latched state of: the emergency gear extension knob stays pulled.
    const emergency = (g.action as string) === 'gearEmergency';
    return [
      {
        id: g.id,
        kind: 'push',
        x: g.at[0],
        y: g.at[1],
        hw: GUARDED_KNOB.r + 6,
        hh: GUARDED_KNOB.r + 6,
        name: g.label,
        hint: 'click to operate',
        hold: g.engine === undefined ? { action: g.action } : { action: g.action, engine: g.engine },
        value: (c) => (emergency && c.gearEmergency ? 'PULLED' : ''),
      },
    ];
  }
  return [];
}

/**
 * The hotspots of a panel: the bezel knobs of its altimeter, heading indicator and NAV 1 CDI, the gear selector,
 * the flap switch and guarded knobs of its gauges, the dimmers, the magneto key (or the ignition switches and
 * starter of each engine) and one toggle per switch of the row (with the switch's id, name and closures).
 */
export function buildHotspots(def: PanelDef): PanelHotspot[] {
  const spots: PanelHotspot[] = [];
  for (const g of def.gauges) {
    if (g.kind === 'altimeter') {
      spots.push(knob('kollsman', g.at[0] - 70, g.at[1] + 72, 'Altimeter setting', KOLLSMAN));
    } else if (g.kind === 'heading') {
      spots.push(knob('headingBug', g.at[0] + BEZEL_KNOB, g.at[1] + BEZEL_KNOB, 'Heading bug', HEADING_BUG));
      spots.push({
        id: 'dgAlign',
        kind: 'push',
        x: g.at[0] - BEZEL_KNOB,
        y: g.at[1] + BEZEL_KNOB,
        hw: 15,
        hh: 15,
        name: 'Heading indicator',
        hint: 'hold to align with the compass',
        press(down, c) {
          c.dgAlign = down;
        },
        hold: { action: 'dgAlign' },
        value: (c) => (c.dgAlign ? 'aligning' : ''),
      });
    } else if (g.kind === 'cdi' && g.receiver === 'nav1') {
      spots.push(knob('obs', g.at[0] - 70, g.at[1] + 72, 'NAV 1 course (OBS)', OBS));
    } else {
      spots.push(...gaugeHotspots(g));
    }
  }
  const row = def.switchRow;
  const { x, y } = row.bounds;
  if (row.dimmers) {
    spots.push(knob('panelDimmer', x + row.dimmers.panel, y + row.dimmers.y, 'Panel lights', DIMMER));
    spots.push(knob('radioDimmer', x + row.dimmers.radio, y + row.dimmers.y, 'Radio lights', DIMMER));
  }
  if (def.ignition.kind === 'key') {
    spots.push({
      id: 'magnetos',
      kind: 'knob',
      x: def.ignition.at[0],
      y: def.ignition.at[1],
      hw: 30,
      hh: 30,
      name: 'Magnetos',
      hint: 'click right to turn (hold at START), left to turn back',
      // The key stops at BOTH: START is only reached by holding it there.
      turn(dir, c) {
        c.magnetos = Math.min(3, Math.max(0, c.magnetos + dir)) as MagnetoPosition;
      },
      springHold: { when: (c) => c.magnetos === 3, action: 'starter' },
      noRepeat: true,
      value: (c) => (c.starter ? 'START' : ['OFF', 'R', 'L', 'BOTH'][c.magnetos]),
    });
  } else {
    spots.push(...ignitionHotspots(def));
  }
  // Rocker centres.
  const rockerY = y + row.rockerTop + row.rockerH / 2;
  for (const s of row.switches) {
    spots.push({
      id: s.id,
      kind: 'toggle',
      x: x + s.x,
      y: rockerY,
      hw: 15,
      hh: 25,
      name: s.name,
      hint: 'click to switch',
      toggle: s.toggle,
      value: (c) => onOff(s.on(c)),
    });
  }
  return spots;
}

/** The hotspots of the C172S panel. */
export const PANEL_HOTSPOTS: readonly PanelHotspot[] = buildHotspots(C172S_PANEL);
const C172S_HOTSPOT = new Map(PANEL_HOTSPOTS.map((h) => [h.id, h]));

/** The hotspot under a panel pixel, or null. */
export function hotspotAt(x: number, y: number, spots: readonly PanelHotspot[] = PANEL_HOTSPOTS): PanelHotspot | null {
  for (const h of spots) if (Math.abs(x - h.x) <= h.hw && Math.abs(y - h.y) <= h.hh) return h;
  return null;
}

// The C172S hotspots by id.

/**
 * Turn a knob one detent. dir = +1 clockwise (increase) / -1; `coarse` multiplies the step (fast spin).
 * The magneto key stops at BOTH: START is only reached by holding it (the hotspot's springHold).
 */
export function turnHotspot(id: HotspotId, dir: 1 | -1, c: ControlInputs, coarse = 1): void {
  C172S_HOTSPOT.get(id)?.turn?.(dir, c, coarse);
}

/** Flip a switch. */
export function toggleHotspot(id: HotspotId, c: ControlInputs): void {
  C172S_HOTSPOT.get(id)?.toggle?.(c);
}

/** Momentary controls: DG align while held. (The starter is held through the input module, see the UI.) */
export function pressHotspot(id: HotspotId, down: boolean, c: ControlInputs): void {
  C172S_HOTSPOT.get(id)?.press?.(down, c);
}

/** Current setting of a hotspot as tooltip text. */
export function hotspotValue(id: HotspotId, c: ControlInputs): string {
  return C172S_HOTSPOT.get(id)?.value(c) ?? '';
}
