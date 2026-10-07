// The Cessna 172S panel, instrument systems and input profile (src/aircraft/c172s/panel.ts, input.ts) against
// the code they describe: every member IS the constant of the instruments or input module it stands for, the
// switch closures do what the panel's own switch functions do, the lamp closures light when the annunciator
// logic does, and the gauge list is the list of components the panel builds.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { C172S_INPUT } from '../../src/aircraft/c172s/input';
import {
  C172S_AMMETER_SCALE,
  C172S_ANNUNCIATOR_LAMPS,
  C172S_ASI_MARKS,
  C172S_INSTRUMENT_SYSTEMS,
  C172S_PANEL,
  C172S_SUCTION_SCALE,
  C172S_TACH_MARKS,
} from '../../src/aircraft/c172s/panel';
import { makeMockState } from '../../src/core/mockState';
import { defaultControls, type ControlInputs } from '../../src/core/types';
import { FUEL_SELECTOR_CYCLE, HANDOVER_SPEED, KEY_G_PULL, KEY_G_PUSH } from '../../src/input/InputSystem';
import {
  FLAP_DETENTS,
  GROUND_ELEVATOR_RATE,
  GroundSteeringAssist,
  KEY_AXIS_TUNING,
  RollTrimAssist,
  RotationGuard,
  nextFlapDetent,
} from '../../src/input/virtualYoke';
import {
  BUS_DEAD_VOLTS,
  KG_PER_GAL,
  LOW_FUEL_GAL,
  LOW_OIL_PRESSURE_PSI,
  LOW_VACUUM_INHG,
  LOW_VOLTS,
  Tachometer,
  evaluateAnnunciators,
  type Annunciators,
} from '../../src/instruments/dynamics/engineSystems';
import { SUCTION_RATED_INHG, SUCTION_REGULATED_INHG, vacuumSuction } from '../../src/instruments/dynamics/gyro';
import { PANEL_HOTSPOTS, toggleHotspot, type HotspotId } from '../../src/instruments/hotspots';
import { PANEL_HEIGHT, PANEL_LAYOUT, PANEL_WIDTH, type RockerKey } from '../../src/instruments/layout';
import {
  BREAKER_AMPS,
  BREAKER_NAMES,
  BREAKERS_PER_ROW,
  CDI_FIXED_COURSES,
  InstrumentPanel,
  PANEL_GLOVEBOX,
  PANEL_PLACARDS,
  PANEL_REGIONS,
  PANEL_SEAMS_X,
} from '../../src/instruments/panel';
import { gaugeRecess, type GaugeDef, type LampInputs, type Rect, type ScaleDef } from '../../src/instruments/panelDef';
import { ARC_GREEN, ARC_RED, ARC_YELLOW } from '../../src/instruments/render/art';
import type { PanelComponent } from '../../src/instruments/render/component';
import { FLAP_LEGENDS, FLAP_SCALE_DEG, MIXTURE_LEGEND, ROCKER_LABELS, SwitchPanel, THROTTLE_LEGEND } from '../../src/instruments/render/controls';
import { ENGINE_CLUSTER, type HalfScale } from '../../src/instruments/render/engineGauges';
import { INSTRUMENT_SPOTS } from '../../src/ui/school/highlight';

const L = PANEL_LAYOUT;
const ROW = C172S_PANEL.switchRow;

/** SwitchPanel's own reading of a rocker (a private method that uses no instance state). */
const isOn = (key: RockerKey, c: ControlInputs): boolean =>
  (SwitchPanel.prototype as unknown as { isOn(k: RockerKey, c: ControlInputs): boolean }).isOn(key, c);

/** A canvas that accepts every drawing call and draws nothing, so the panel's components can be built without a DOM. */
function stubCanvas(): void {
  const sink: unknown = new Proxy(function () {}, {
    get: (_t, key) => (key === Symbol.toPrimitive ? () => 0 : sink),
    set: () => true,
    apply: () => sink,
  });
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => sink }) });
}

afterEach(() => vi.unstubAllGlobals());

describe('C172S_PANEL', () => {
  it('is the 2080 x 800 canvas, placed from PANEL_LAYOUT', () => {
    expect(C172S_PANEL.id).toBe('c172s');
    expect(C172S_PANEL.size).toEqual({ w: PANEL_WIDTH, h: PANEL_HEIGHT });
    expect(C172S_PANEL.apertures).toEqual({ large: L.apertures.sixPack, small: L.apertures.small });
    expect(C172S_PANEL.annunciator?.bounds).toBe(L.annunciator);
    expect(C172S_PANEL.annunciator?.lamps).toBe(C172S_ANNUNCIATOR_LAMPS);
    // The yoke boots.
    expect(C172S_PANEL.keepOut).toEqual([
      { x: L.yokes.xs[0], y: L.yokes.y, r: L.yokes.r },
      { x: L.yokes.xs[1], y: L.yokes.y, r: L.yokes.r },
    ]);
  });

  it('lists the components the panel builds today: id, order and place', () => {
    stubCanvas();
    const panel = new InstrumentPanel() as unknown as { components: PanelComponent[]; regions: Map<string, Rect> };
    const built = panel.components;
    // The annunciator strip and the switch row are members of their own; everything else is a gauge, in order.
    const own = new Map<string, Rect>([
      ['annunciator', C172S_PANEL.annunciator!.bounds],
      ['switches', ROW.bounds],
    ]);
    const gauges = built.filter((c) => !own.has(c.id));
    expect(built).toHaveLength(21);
    expect(gauges).toHaveLength(19);
    expect(C172S_PANEL.gauges.map((g) => g.id)).toEqual(gauges.map((c) => c.id));
    for (const [id, bounds] of own) expect(built.find((c) => c.id === id)?.bounds, id).toEqual(bounds);
    C172S_PANEL.gauges.forEach((g, i) => {
      const b = gauges[i].bounds;
      if ('at' in g) expect([b.x + b.w / 2, b.y + b.h / 2], g.id).toEqual(g.at);
      else expect(b, g.id).toEqual(g.bounds);
    });
    // The markings are the panel's data (decision B-B5a-01).
    const marks: Record<string, unknown> = { asi: C172S_ASI_MARKS, tach: C172S_TACH_MARKS, suction: C172S_SUCTION_SCALE, ammeter: C172S_AMMETER_SCALE };
    for (const g of C172S_PANEL.gauges) {
      if (g.kind === 'asi' || g.kind === 'tach') expect(g.marks, g.id).toBe(marks[g.kind]);
      if (g.kind === 'suction' || g.kind === 'ammeter') expect(g.scale, g.id).toBe(marks[g.kind]);
    }
    // The named regions are the ones the panel offers to drawTo().
    for (const [name, rect] of Object.entries(C172S_PANEL.regions)) expect(panel.regions.get(name), name).toBe(rect);
    expect([...panel.regions.keys()].filter((k) => !built.some((c) => c.id === k)).sort()).toEqual(['engine', 'full', 'sixpack', 'stack']);
    expect(panel.regions.get('full')).toEqual({ x: 0, y: 0, ...C172S_PANEL.size });
  });

  it('gives the round gauges the recesses the 3D cockpit cuts today', () => {
    // The rule of render/aircraft/cockpit.ts (GAUGE_PX), written out from the layout.
    const large = [...[...L.sixPack.cols, L.cdi.x].flatMap((x) => L.sixPack.rows.map((y) => [x, y])), [L.engineRow.tach, L.engineRow.y]];
    const small = [
      ...[L.leftColumn.clock, L.leftColumn.suction, L.leftColumn.ammeter].map((y) => [L.leftColumn.x, y]),
      ...[L.engineRow.fuel, L.engineRow.oil, L.engineRow.egt].map((x) => [x, L.engineRow.y]),
    ];
    const today = [
      ...large.map(([x, y]) => ({ x, y, r: L.apertures.sixPack, depth: 0.014 })),
      ...small.map(([x, y]) => ({ x, y, r: L.apertures.small, depth: 0.01 })),
    ];
    const key = (r: { x: number; y: number }): number => r.x * 10000 + r.y;
    const recesses = C172S_PANEL.gauges.map((g) => gaugeRecess(g, C172S_PANEL.apertures)).filter((r) => r !== null);
    expect(recesses.sort((a, b) => key(a) - key(b))).toEqual(today.sort((a, b) => key(a) - key(b)));
  });

  it('takes the CDI courses, the engine cluster and the flap scale by reference', () => {
    const byId = (id: string): GaugeDef => C172S_PANEL.gauges.find((g) => g.id === id)!;
    expect(byId('cdi1')).toMatchObject({ kind: 'cdi', receiver: 'nav1', fixedCourseDeg: CDI_FIXED_COURSES[0] });
    expect(byId('cdi2')).toMatchObject({ kind: 'cdi', receiver: 'nav2', fixedCourseDeg: CDI_FIXED_COURSES[1] });
    expect(byId('tach')).toMatchObject({ kind: 'tach', size: 'large' });

    const hex = { green: ARC_GREEN, yellow: ARC_YELLOW, red: ARC_RED } as Record<string, string>;
    const same = (def: ScaleDef, s: HalfScale, what: string): void => {
      expect(def.label, what).toBe(s.label);
      expect(def.min, what).toBe(s.min);
      expect(def.max, what).toBe(s.max);
      expect(def.majors, what).toBe(s.majors);
      expect(def.minorStep, what).toBe(s.minorStep);
      expect(def.numbers, what).toBe(s.numbers);
      expect(def.redLines, what).toBe(s.redLines);
      expect(def.read, what).toBe(s.read);
      expect(def.arcs?.map((a) => ({ from: a.from, to: a.to, color: hex[a.color] })), what).toEqual(s.bands);
    };
    for (const id of ['fuel', 'oil', 'egtff'] as const) {
      const g = byId(id);
      const c = ENGINE_CLUSTER[id];
      if (g.kind !== 'dual') throw new Error(`${id} is not a dual gauge`);
      expect(g.seed, id).toBe(c.seed);
      expect(g.title, id).toBe(c.title);
      same(g.left, c.left, `${id} left`);
      same(g.right, c.right, `${id} right`);
    }

    const flaps = byId('flaps');
    if (flaps.kind !== 'flapLever') throw new Error('flaps is not a flap lever');
    expect(flaps.bounds).toBe(L.flaps);
    expect(flaps.maxDeg).toBe(FLAP_SCALE_DEG);
    expect(flaps.legends).toBe(FLAP_LEGENDS);
  });

  it('has the rocker row of PANEL_LAYOUT with the labels of the artwork and the names of the hotspots', () => {
    expect(ROW.bounds).toBe(L.switches);
    expect(ROW.rockerTop).toBe(L.switchRow.rockerTop);
    expect(ROW.rockerW).toBe(L.switchRow.rockerW);
    expect(ROW.rockerH).toBe(L.switchRow.rockerH);
    expect(ROW.dimmers).toBe(L.switchRow.dimmers);
    expect(ROW.switches).toHaveLength(L.switchRow.rockers.length);
    ROW.switches.forEach((s, i) => {
      const r = L.switchRow.rockers[i];
      const spot = PANEL_HOTSPOTS.find((h) => h.id === s.id);
      expect(spot?.kind, s.id).toBe('toggle');
      expect(s.name, s.id).toBe(spot!.name);
      expect(s.x, s.id).toBe(r.x);
      expect(L.switches.x + s.x, s.id).toBe(spot!.x);
      expect(s.red ?? false, s.id).toBe('red' in r ? r.red : false);
      // The MASTER pair is lettered by the row's legends, every other rocker by its own label.
      const master = r.key === 'alt' || r.key === 'bat';
      expect(s.group === 'master', s.id).toBe(master);
      expect(s.label, s.id).toBe(master ? '' : ROCKER_LABELS[r.key]);
      if (master) expect(ROW.legends, s.id).toContainEqual({ text: ROCKER_LABELS[r.key], x: r.x, y: ROW.rockerTop - 12, size: 8 });
    });
    // Every toggle hotspot of the panel is a switch of the row.
    expect(ROW.switches.map((s) => s.id).sort()).toEqual(PANEL_HOTSPOTS.filter((h) => h.kind === 'toggle').map((h) => h.id).sort());
    // The bracketed group is the five light switches.
    expect(ROW.switches.filter((s) => s.group === 'lights').map((s) => s.id)).toEqual(['beacon', 'landing', 'taxi', 'nav', 'strobe']);
    expect(ROW.legends.map((l) => l.text)).toEqual(['MASTER', 'ALT', 'BAT', 'LIGHTS', 'PANEL', 'RADIO', 'BRT']);
  });

  it('switch closures agree with SwitchPanel.isOn and toggleHotspot for every switch and both states', () => {
    ROW.switches.forEach((s, i) => {
      const key = L.switchRow.rockers[i].key;
      const id = s.id as HotspotId;
      for (const start of [false, true]) {
        const a = defaultControls();
        const b = defaultControls();
        if (isOn(key, a) !== start) {
          toggleHotspot(id, a);
          toggleHotspot(id, b);
        }
        expect(isOn(key, a), `${s.id} ${start}`).toBe(start);
        expect(s.on(a), `${s.id} ${start}`).toBe(start);
        s.toggle(a);
        toggleHotspot(id, b);
        expect(a, `${s.id} ${start}`).toEqual(b);
        expect(s.on(a), `${s.id} ${start}`).toBe(!start);
        expect(isOn(key, a), `${s.id} ${start}`).toBe(!start);
        // And back.
        s.toggle(a);
        expect(s.on(a), `${s.id} ${start}`).toBe(start);
        expect(isOn(key, a), `${s.id} ${start}`).toBe(start);
      }
    });
  });

  it('has the magneto key where its hotspot is', () => {
    const key = PANEL_HOTSPOTS.find((h) => h.id === 'magnetos')!;
    expect(C172S_PANEL.ignition).toEqual({ kind: 'key', at: [key.x, key.y] });
  });

  it('takes the background artwork by reference', () => {
    const bg = C172S_PANEL.background;
    expect(bg.seamsX).toBe(PANEL_SEAMS_X);
    expect(bg.placards).toBe(PANEL_PLACARDS);
    expect(bg.glovebox).toBe(PANEL_GLOVEBOX);
    expect(bg.breakers?.bounds).toBe(L.circuitBreakers);
    expect(bg.breakers?.names).toBe(BREAKER_NAMES);
    expect(bg.breakers?.amps).toBe(BREAKER_AMPS);
    expect(bg.breakers?.perRow).toBe(BREAKERS_PER_ROW);
    expect(BREAKER_AMPS).toHaveLength(BREAKER_NAMES.length);
    expect(bg.bushings).toEqual([
      { at: L.throttle, text: THROTTLE_LEGEND[0], sub: THROTTLE_LEGEND[1] },
      { at: L.mixture, text: MIXTURE_LEGEND[0], sub: MIXTURE_LEGEND[1] },
    ]);
    expect(bg.bushings[0].at).toBe(L.throttle);
    expect(bg.bushings[1].at).toBe(L.mixture);
  });

  it('has the regions of the panel and the highlight spots of the Flight School', () => {
    expect(C172S_PANEL.regions).toBe(PANEL_REGIONS);
    expect(C172S_PANEL.spots).toEqual(INSTRUMENT_SPOTS);
  });
});

describe('C172S_INSTRUMENT_SYSTEMS', () => {
  const S = C172S_INSTRUMENT_SYSTEMS;

  it('takes the vacuum system, the fuel density, the dead-bus voltage and the tach hour rate by reference', () => {
    expect(S.engines).toBe(1);
    expect(S.vacuum?.engines).toEqual([0]);
    expect(S.vacuum?.regulatedInHg).toBe(SUCTION_REGULATED_INHG);
    expect(S.vacuum?.ratedInHg).toBe(SUCTION_RATED_INHG);
    expect(S.vacuum?.suction).toBe(vacuumSuction);
    expect(S.gyroDrive).toEqual({ attitude: 'vacuum', heading: 'vacuum' });
    expect(S.fuel.kgPerGal).toBe(KG_PER_GAL);
    expect(S.busDeadVolts).toBe(BUS_DEAD_VOLTS);
    expect(S.tachHourRpm).toBe(Tachometer.HOUR_RPM);
  });

  it('gauges the two wing tanks through the legacy pair of the state', () => {
    const s = makeMockState();
    expect(S.fuel.tanks).toHaveLength(2);
    s.fuel.left = 41.5;
    s.fuel.right = 17.25;
    expect(S.fuel.tanks[0](s)).toBe(41.5);
    expect(S.fuel.tanks[1](s)).toBe(17.25);
    // The authoritative tank list of a state factory shows the same fuel.
    expect(S.fuel.tanks.map((read) => read(s))).toEqual(s.fuel.tanks.map((t) => t.quantity));
  });

  it('lights each lamp exactly when evaluateAnnunciators does', () => {
    expect([LOW_FUEL_GAL, LOW_OIL_PRESSURE_PSI, LOW_VOLTS, LOW_VACUUM_INHG]).toEqual([5, 20, 24.5, 3]);
    const out: Annunciators = { lowFuelLeft: false, lowFuelRight: false, oilPress: false, lowVolts: false, vacuum: false };
    expect(S.lamps.map((l) => l.id).sort()).toEqual(Object.keys(out).sort());
    const state = makeMockState();
    const fuelGal = [0, 0];
    const inputs: LampInputs = { state, controls: defaultControls(), fuelGal, suctionInHg: 0 };
    const around = (v: number): number[] => [0, v - 0.01, v, v + 0.01, 3 * v];
    let lit = 0;
    for (const volts of [0, BUS_DEAD_VOLTS - 0.1, BUS_DEAD_VOLTS, BUS_DEAD_VOLTS + 0.1, ...around(LOW_VOLTS), 28]) {
      for (const left of around(LOW_FUEL_GAL)) {
        for (const right of around(LOW_FUEL_GAL)) {
          for (const oil of around(LOW_OIL_PRESSURE_PSI)) {
            for (const suction of around(LOW_VACUUM_INHG)) {
              state.electrical.busVoltage = volts;
              state.engine.oilPressure = oil;
              fuelGal[0] = left;
              fuelGal[1] = right;
              inputs.suctionInHg = suction;
              evaluateAnnunciators({ busVolts: volts, fuelLeftGal: left, fuelRightGal: right, oilPressurePsi: oil, suctionInHg: suction }, out);
              for (const lamp of S.lamps) {
                const expected = out[lamp.id as keyof Annunciators];
                if (lamp.lit(inputs) !== expected) {
                  throw new Error(`${lamp.id} at ${volts} V, ${left} / ${right} gal, ${oil} psi, ${suction} inHg: expected ${expected}`);
                }
                if (expected) lit++;
              }
            }
          }
        }
      }
    }
    expect(lit).toBeGreaterThan(1000);
  });
});

describe('C172S_INPUT', () => {
  const A = C172S_INPUT.assists;

  it('describes a single with a key-type ignition switch, mixture and a fuel pump', () => {
    expect(C172S_INPUT.engines).toBe(1);
    expect(C172S_INPUT.ignition).toBe('key');
    expect(C172S_INPUT.has).toEqual({
      mixture: true,
      propeller: false,
      feather: false,
      carbHeat: false,
      alternateAir: false,
      cowlFlaps: false,
      gear: false,
      rudderTrim: false,
      fuelPump: true,
    });
    expect(C172S_INPUT.labels).toBeUndefined();
  });

  it('takes the flap detents and the fuel selector cycle by reference', () => {
    expect(C172S_INPUT.flapDetents).toBe(FLAP_DETENTS);
    expect(C172S_INPUT.flapDetents).toEqual([0, 1 / 3, 2 / 3, 1]);
    expect(C172S_INPUT.fuelSelectorCycle).toBe(FUEL_SELECTOR_CYCLE);
    expect(C172S_INPUT.fuelSelectorCycle).toEqual(['both', 'left', 'right', 'off']);
    // The detents the flap keys step through.
    const steps: number[] = [];
    for (let lever = 0; steps.length < 3; lever = steps[steps.length - 1]) steps.push(nextFlapDetent(lever, 1));
    expect([0, ...steps]).toEqual([...C172S_INPUT.flapDetents]);
  });

  it('takes every keyboard assist constant by reference', () => {
    expect(A.axes).toBe(KEY_AXIS_TUNING);
    expect(A.groundElevatorRate).toBe(GROUND_ELEVATOR_RATE);
    expect(A.rotation).toEqual({
      rate: RotationGuard.RATE,
      rateLead: RotationGuard.RATE_LEAD,
      pitchLimitGround: RotationGuard.PITCH_LIMIT,
      pitchLimitAir: RotationGuard.AIR_PITCH_LIMIT,
      pitchLead: RotationGuard.PITCH_LEAD,
      bleed: RotationGuard.BLEED,
    });
    expect(A.steering).toEqual({
      kind: 'rudder',
      kp: GroundSteeringAssist.KP,
      ki: GroundSteeringAssist.KI,
      kd: GroundSteeringAssist.KD,
      limit: GroundSteeringAssist.LIMIT,
      fadeInSpeed: [1, 4],
    });
    expect(A.steering.fadeInSpeed[0]).toBe(GroundSteeringAssist.FADE_IN_START);
    expect(A.steering.fadeInSpeed[1] - A.steering.fadeInSpeed[0]).toBe(GroundSteeringAssist.FADE_IN_SPAN);
    expect(A.rollTrim).toEqual({ ki: RollTrimAssist.KI, kb: RollTrimAssist.KB, limit: RollTrimAssist.LIMIT });
    expect(A.gStops).toEqual({ pull: KEY_G_PULL, push: KEY_G_PUSH });
    expect(A.handoverSpeed).toBe(HANDOVER_SPEED);
  });

  it('fades the ground steering in over the speeds the profile names', () => {
    // A heading error held on the ground: no output at the lower speed, the full proportional term at the upper.
    const output = (groundSpeed: number): number => {
      const assist = new GroundSteeringAssist();
      assist.step(0, 0, true, groundSpeed, false, 0.01);
      return assist.step(-0.05, 0, true, groundSpeed, false, 1e-9);
    };
    const [from, to] = A.steering.fadeInSpeed;
    expect(output(from)).toBe(0);
    expect(output(to)).toBeCloseTo(A.steering.kp * 0.05, 6);
    expect(output(to + 10)).toBeCloseTo(A.steering.kp * 0.05, 6);
    expect(output((from + to) / 2)).toBeCloseTo(A.steering.kp * 0.05 * 0.5, 6);
  });

  it('is plain data', () => {
    expect(structuredClone(C172S_INPUT)).toEqual(C172S_INPUT);
  });
});
