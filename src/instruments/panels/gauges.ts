// Gauge, switch and display-row factories shared by the panel data of the types (aircraft/<id>/panel.ts).
// Pure: types, core/types and nothing else, so a definition file may import it. Positions, markings and limits
// are always the caller's: nothing here knows a type.

import { engineControl, setEngineControl, type ControlInputs } from '../../core/types';
import type { EngineReadings, InstrumentReadings } from '../dynamics/instrumentSet';
import type { AsiMarkings, GaugeDef, PanelEngineDisplayRow, ScaleDef, SwitchDef } from '../panelDef';

type At = readonly [number, number];

/**
 * The six flight instruments in the standard arrangement (airspeed, attitude, altimeter over turn coordinator,
 * heading indicator, vertical speed) at three column and two row centres, with the ids the C172S panel uses.
 */
export function sixPackGauges(cols: readonly [number, number, number], rows: readonly [number, number], asi: AsiMarkings): GaugeDef[] {
  return [
    { kind: 'asi', id: 'asi', at: [cols[0], rows[0]], marks: asi },
    { kind: 'attitude', id: 'attitude', at: [cols[1], rows[0]] },
    { kind: 'altimeter', id: 'altimeter', at: [cols[2], rows[0]] },
    { kind: 'turn', id: 'turn', at: [cols[0], rows[1]] },
    { kind: 'heading', id: 'heading', at: [cols[1], rows[1]] },
    { kind: 'vsi', id: 'vsi', at: [cols[2], rows[1]] },
  ];
}

/** The dial of a round engine gauge: case size, sweep (degrees clockwise from 12 o'clock), lettering and scale. */
export interface EngineDial {
  size: 'large' | 'small';
  seed: number;
  /** Needle angle at the scale's minimum and maximum, degrees. */
  fromDeg: number;
  toDeg: number;
  title: string;
  units: string;
  /** The scale values that are numbered. */
  labels: readonly number[];
  scale: Omit<ScaleDef, 'read'>;
}

const RAD_PER_DEG = Math.PI / 180;

/** One dial with an L and an R needle, each reading the same member of its engine's readings (engines 0 and 1). */
export function twinEngineGauge(id: string, at: At, dial: EngineDial, read: (e: EngineReadings) => number): GaugeDef {
  return {
    kind: 'twinNeedle',
    id,
    at,
    seed: dial.seed,
    size: dial.size,
    a0: dial.fromDeg * RAD_PER_DEG,
    a1: dial.toDeg * RAD_PER_DEG,
    title: dial.title,
    units: dial.units,
    labels: dial.labels,
    scale: dial.scale,
    left: (r) => read(r.engines[0]),
    right: (r) => read(r.engines[1]),
  };
}

/** A single-pointer dial reading one member of one engine's readings. */
export function engineGauge(id: string, at: At, engine: number, dial: EngineDial, read: (e: EngineReadings) => number): GaugeDef {
  return singleGauge(id, at, dial, (r) => read(r.engines[engine]));
}

/** A single-pointer dial reading anything of the readings (a load meter, a voltmeter). */
export function singleGauge(id: string, at: At, dial: EngineDial, read: (r: InstrumentReadings) => number): GaugeDef {
  return {
    kind: 'single',
    id,
    at,
    seed: dial.seed,
    size: dial.size,
    a0: dial.fromDeg * RAD_PER_DEG,
    a1: dial.toDeg * RAD_PER_DEG,
    title: dial.title,
    units: dial.units,
    labels: dial.labels,
    scale: { ...dial.scale, read },
  };
}

/** The switches that exist once per engine and are plain on / off. */
export type EngineSwitchKey = 'fuelPump' | 'alternator' | 'alternateAir' | 'engineMaster';

/**
 * A rocker of the switch row that belongs to ONE engine of a twin (L FUEL PUMP, R ALT): it shows and switches that
 * engine's control and leaves the other engine's alone.
 */
export function engineSwitch(id: string, label: string, name: string, x: number, key: EngineSwitchKey, engine: number, more: Pick<SwitchDef, 'red' | 'group'> = {}): SwitchDef {
  return {
    id,
    label,
    name,
    x,
    ...more,
    on: (c: ControlInputs) => engineControl(c, engine, key),
    toggle: (c: ControlInputs) => setEngineControl(c, engine, key, !engineControl(c, engine, key)),
  };
}

/** A row of the boxed engine display that shows one member of each engine's readings (through `convert`, if the display's unit differs). */
export function engineDisplayRow(
  label: string,
  unit: string,
  min: number,
  max: number,
  read: (e: EngineReadings) => number,
  more: Pick<PanelEngineDisplayRow, 'decimals' | 'arcs' | 'redLines'> = {},
): PanelEngineDisplayRow {
  return { label, unit, min, max, ...more, read: (r, engine) => read(r.engines[engine]) };
}

/** Degrees Fahrenheit (the unit of the temperature readings) as degrees Celsius. */
export const celsius = (fahrenheit: number): number => ((fahrenheit - 32) * 5) / 9;
/** psi (the unit of the pressure readings) as bar. */
export const bar = (psi: number): number => psi * 0.0689476;
