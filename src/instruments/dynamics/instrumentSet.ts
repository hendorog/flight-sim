// All instrument dynamics of a panel behind one step() call, fed from the type's instrument systems definition
// (engines, vacuum pumps or electric gyros, fuel gauging, bus and lamp thresholds; the C172S's by default). Pure
// (no DOM, no three.js) so it runs in unit tests. The panel renderer and the 2D overlays only read `readings`.

import { C172S_INSTRUMENT_SYSTEMS } from '../../aircraft/c172s/panel';
import { RAD } from '../../core/math';
import { engineControl, type AircraftState, type ControlInputs, type EngineState, type WeatherSettings } from '../../core/types';
import type { InstrumentSystemsDef, LampInputs } from '../panelDef';
import { batteryCurrentAmps, ElectricNeedle, Tachometer, type Annunciators } from './engineSystems';
import { lagStep } from './filters';
import { SUCTION_RATED_INHG } from './gyro';
import { AttitudeIndicator, HeadingIndicator, TurnCoordinator } from './gyroInstruments';
import { gpsToAirport, ils07, type GpsData, type IlsSignal } from './navigation';
import { Altimeter, AirspeedIndicator, pressureAltitudeFt, VerticalSpeedIndicator } from './pitotStatic';

/** What the gauges of one engine show, in display units. */
export interface EngineReadings {
  /** The tachometer's shaft: propeller rpm on a geared engine whose systems definition says so. */
  rpm: number;
  tachHours: number;
  manifoldInHg: number;
  fuelFlowGph: number;
  egtF: number;
  chtF: number;
  oilTempF: number;
  oilPressurePsi: number;
  fuelPressurePsi: number;
  /** Shaft power, per cent of rated (the FADEC LOAD figure). */
  loadPct: number;
  /** Liquid-cooled engines; 0 elsewhere. */
  coolantF: number;
  gearboxF: number;
}

/** The landing gear position lights. */
export interface GearReadings {
  /** The three greens: leg down and locked. */
  nose: boolean;
  left: boolean;
  right: boolean;
  /** The red light: a leg neither up nor down and locked. */
  inTransit: boolean;
}

/** Everything the panel shows, in display units. Updated in place by InstrumentSet.step(). */
export interface InstrumentReadings {
  // Flight instruments
  airspeedKt: number;
  altitudeFt: number;
  kollsmanInHg: number;
  verticalSpeedFpm: number;
  /** Attitude indicator display, rad. */
  attitudeRoll: number;
  attitudePitch: number;
  /** Heading indicator card and bug, degrees [0, 360). */
  headingDeg: number;
  headingBugDeg: number;
  /** Turn coordinator in standard-rate units (+ = right). */
  turnRate: number;
  ball: number;
  turnFlag: boolean;
  // Engine and systems
  rpm: number;
  tachHours: number;
  fuelLeftGal: number;
  fuelRightGal: number;
  oilTempF: number;
  oilPressurePsi: number;
  /** Exhaust gas temperature, deg F (the gauge has an unnumbered scale). */
  egtF: number;
  fuelFlowGph: number;
  suctionInHg: number;
  ammeterAmps: number;
  busPowered: boolean;
  avionicsPowered: boolean;
  annunciators: Annunciators;
  // Misc
  oatC: number;
  /** Clock, seconds since local midnight. */
  clockSeconds: number;
  /** Actual flap deflection, degrees. */
  flapsDeg: number;
  // Avionics
  ils: IlsSignal;
  /** ILS course selected on the NAV1 OBS, degrees. */
  obsDeg: number;
  gps: GpsData;
  /** Transponder pressure altitude (Mode C), ft. */
  pressureAltitudeFt: number;
  // Per engine and per tank. The scalars above are engine 0 (the left one on a twin) and the first two tanks.
  /** One entry per engine of the systems definition, left to right. */
  engines: EngineReadings[];
  /** One entry per gauged tank, in the order of the systems definition, US gal. */
  fuelGal: number[];
  /** The gear lights, or null on fixed gear. */
  gear: GearReadings | null;
  /** Every lamp of the systems definition by its id (`annunciators` is the same record under its C172S type). */
  lamps: Record<string, boolean>;
  /** Carburettor heat as the knob of engine 0 shows it, 0 cold .. 1 full hot. */
  carbHeat: number;
  /** DC bus voltage, V. */
  busVolts: number;
  /** Output of each alternator, A (the load meters). */
  alternatorAmps: number[];
}

export interface InstrumentSetOptions {
  /** Start with the gyros at speed (engine running). Default true. */
  gyrosSpunUp?: boolean;
  /** Tach hour meter reading at start. */
  tachHours?: number;
  /** What feeds the instruments: vacuum pumps, fuel gauging, bus and lamp thresholds. Default: the C172S's. */
  systems?: InstrumentSystemsDef;
}

const DEG_TO_RAD = Math.PI / 180;
const fahrenheit = (celsius: number): number => (celsius * 9) / 5 + 32;

/** The indicators of one engine: a mechanical tachometer and manifold pressure gauge, the rest electric. */
class EngineIndicators {
  readonly tach: Tachometer;
  readonly oilT = new ElectricNeedle(3, 60);
  readonly oilP = new ElectricNeedle(0.6, 0);
  readonly egt = new ElectricNeedle(4, 0);
  readonly ff = new ElectricNeedle(0.8, 0);
  readonly cht = new ElectricNeedle(4, 0);
  readonly fuelP = new ElectricNeedle(0.6, 0);
  readonly load = new ElectricNeedle(0.3, 0);
  readonly coolant = new ElectricNeedle(3, 0);
  readonly gearbox = new ElectricNeedle(3, 0);
  /** Direct-reading pressure gauge: it shows the pressure in the manifold whether or not the bus is alive. */
  manifold = 29.92;

  constructor(tachHours: number | undefined, hourRpm: number) {
    this.tach = new Tachometer(tachHours, hourRpm);
  }

  step(dt: number, e: EngineState, shaftRpm: number, kgPerGal: number, powered: boolean, out: EngineReadings): void {
    this.tach.step(dt, shaftRpm);
    this.oilT.step(dt, (e.oilTemp * 9) / 5 + 32, powered);
    this.oilP.step(dt, e.oilPressure, powered);
    this.egt.step(dt, (e.egt * 9) / 5 + 32, powered);
    this.ff.step(dt, (e.fuelFlow * 3600) / kgPerGal, powered);
    this.cht.step(dt, fahrenheit(e.cht), powered);
    this.fuelP.step(dt, e.fuelPressure, powered);
    this.load.step(dt, e.loadPercent, powered);
    this.coolant.step(dt, e.coolantTemp !== undefined ? fahrenheit(e.coolantTemp) : 0, powered);
    this.gearbox.step(dt, e.gearboxTemp !== undefined ? fahrenheit(e.gearboxTemp) : 0, powered);
    this.manifold = lagStep(this.manifold, e.manifoldPressure, dt, 0.2);
    out.rpm = this.tach.rpm;
    out.tachHours = this.tach.hours;
    out.manifoldInHg = this.manifold;
    out.fuelFlowGph = this.ff.value;
    out.egtF = this.egt.value;
    out.chtF = this.cht.value;
    out.oilTempF = this.oilT.value;
    out.oilPressurePsi = this.oilP.value;
    out.fuelPressurePsi = this.fuelP.value;
    out.loadPct = this.load.value;
    out.coolantF = this.coolant.value;
    out.gearboxF = this.gearbox.value;
  }
}

export class InstrumentSet {
  readonly airspeed = new AirspeedIndicator();
  readonly altimeter = new Altimeter();
  readonly vsi = new VerticalSpeedIndicator();
  attitude: AttitudeIndicator;
  heading: HeadingIndicator;
  turn: TurnCoordinator;
  /** The tachometer of engine 0. */
  readonly tach: Tachometer;
  /**
   * Slave the Kollsman window to the weather QNH instead of the pilot's knob (ControlInputs.kollsmanHpa).
   * Default false: the knob is the source; the shell sets it to the QNH on a reset and on weatherChanged
   * (the pilot "setting the altimeter from the ATIS"), and the pilot can turn it in the cockpit.
   */
  followQnh = false;

  private readonly systems: InstrumentSystemsDef;
  private suction = 0;
  /** One quantity needle per gauged tank, in the order of the systems definition. */
  private readonly fuel: ElectricNeedle[];
  /** Fuel in each gauged tank, US gal (what the lamp rules read: the senders, not the damped needles). */
  private readonly fuelGal: number[];
  /** One set of indicators per engine of the systems definition. */
  private readonly engines: EngineIndicators[];
  private readonly gear: GearReadings = { nose: false, left: false, right: false, inTransit: false };
  private amps = 0;
  private lampInputs: LampInputs | null = null;
  /** `readings.annunciators` by lamp id (the C172S lamp ids are its members). */
  private readonly lamps: Record<string, boolean>;

  readonly readings: InstrumentReadings;

  constructor(opts: InstrumentSetOptions = {}) {
    const spun = opts.gyrosSpunUp ?? true;
    const sys = opts.systems ?? C172S_INSTRUMENT_SYSTEMS;
    this.systems = sys;
    this.attitude = new AttitudeIndicator(spun, sys.vacuum?.ratedInHg);
    this.heading = new HeadingIndicator(spun, sys.vacuum?.ratedInHg);
    this.turn = new TurnCoordinator(spun);
    this.engines = Array.from({ length: sys.engines }, () => new EngineIndicators(opts.tachHours, sys.tachHourRpm));
    this.tach = this.engines[0].tach;
    this.fuel = sys.fuel.tanks.map(() => new ElectricNeedle(2.5, 0));
    this.fuelGal = sys.fuel.tanks.map(() => 0);
    // Spun-up gyros start with the suction of a cruise rpm.
    this.suction = spun && sys.vacuum ? sys.vacuum.suction(2300) : 0;
    const annunciators: Annunciators & Record<string, boolean> = { lowFuelLeft: false, lowFuelRight: false, oilPress: false, lowVolts: false, vacuum: false };
    this.lamps = annunciators;
    this.readings = {
      airspeedKt: 0,
      altitudeFt: 0,
      kollsmanInHg: 29.92,
      verticalSpeedFpm: 0,
      attitudeRoll: 0,
      attitudePitch: 0,
      headingDeg: 0,
      headingBugDeg: 70,
      turnRate: 0,
      ball: 0,
      turnFlag: !spun,
      rpm: 0,
      tachHours: this.tach.hours,
      fuelLeftGal: 0,
      fuelRightGal: 0,
      oilTempF: 60,
      oilPressurePsi: 0,
      egtF: 0,
      fuelFlowGph: 0,
      suctionInHg: this.suction,
      ammeterAmps: 0,
      busPowered: false,
      avionicsPowered: false,
      annunciators,
      oatC: 15,
      clockSeconds: 0,
      flapsDeg: 0,
      ils: { locValid: false, gsValid: false, loc: 0, gs: 0 },
      obsDeg: 70,
      gps: { distanceNm: 0, bearingDeg: 0, trackDeg: 0, groundSpeedKt: 0 },
      pressureAltitudeFt: 0,
      engines: this.engines.map((e) => ({
        rpm: 0,
        tachHours: e.tach.hours,
        manifoldInHg: e.manifold,
        fuelFlowGph: 0,
        egtF: 0,
        chtF: 0,
        oilTempF: 60,
        oilPressurePsi: 0,
        fuelPressurePsi: 0,
        loadPct: 0,
        coolantF: 0,
        gearboxF: 0,
      })),
      fuelGal: sys.fuel.tanks.map(() => 0),
      gear: null,
      lamps: annunciators,
      carbHeat: 0,
      busVolts: 0,
      alternatorAmps: [],
    };
    this.heading.bug = (70 * Math.PI) / 180;
  }

  /**
   * not show a transient. Air-driven gyros are spun up if an engine is running, electric ones if the bus is alive.
   */
  reset(state: AircraftState): void {
    let spun = false;
    for (let i = 0; i < state.engines.length; i++) spun ||= state.engines[i].running;
    const powered = state.electrical.busVoltage > this.systems.busDeadVolts;
    const drive = this.systems.gyroDrive;
    const rated = this.systems.vacuum?.ratedInHg;
    this.attitude = new AttitudeIndicator(drive.attitude === 'electric' ? powered : spun, rated);
    this.heading = new HeadingIndicator(drive.heading === 'electric' ? powered : spun, rated);
    this.turn = new TurnCoordinator(spun);
    this.vsi.reset();
    this.heading.align(state.heading);
    this.heading.bug = state.heading;
    this.suction = this.pumpSuction(state, true);
  }

  /**
   * Suction the engine-driven vacuum pumps give, inHg: any one of them sustains the system. `runningOnly`
   * counts a pump only while its engine runs (a windmilling propeller after a reset does not spin the gyros up).
   */
  private pumpSuction(s: AircraftState, runningOnly: boolean): number {
    const vacuum = this.systems.vacuum;
    if (!vacuum) return 0;
    let best = 0;
    for (let i = 0; i < vacuum.engines.length; i++) {
      const e = s.engines[vacuum.engines[i]];
      best = Math.max(best, vacuum.suction(runningOnly && !e.running ? 0 : e.rpm));
    }
    return best;
  }

  step(dt: number, s: AircraftState, c: ControlInputs, w: WeatherSettings): InstrumentReadings {
    const r = this.readings;
    const sys = this.systems;
    const volts = s.electrical.busVoltage;
    const powered = volts > sys.busDeadVolts;
    const avionics = powered && c.avionics;

    // Pitot-static
    this.altimeter.settingHpa = this.followQnh || !Number.isFinite(c.kollsmanHpa) ? w.qnhHpa : c.kollsmanHpa;
    this.airspeed.step(dt, s.ias);
    this.altimeter.step(dt, s.staticPressure);
    this.vsi.step(dt, s.staticPressure);

    // Vacuum system and gyros. The suction gauge line has a little volume, hence the short lag.
    this.suction = lagStep(this.suction, this.pumpSuction(s, false), dt, 0.4);
    // An electric gyro has its rated drive while the bus is alive, whatever the pumps do.
    const electricDrive = powered ? (sys.vacuum?.ratedInHg ?? SUCTION_RATED_INHG) : 0;
    this.attitude.step(dt, s.roll, s.pitch, s.specificForce, sys.gyroDrive.attitude === 'electric' ? electricDrive : this.suction);
    // Pilot knobs (ControlInputs): heading bug, and the DG align knob while it is pushed in.
    this.heading.bug = c.headingBugDeg * DEG_TO_RAD;
    if (c.dgAlign) this.heading.align(s.heading);
    this.heading.step(dt, s.heading, sys.gyroDrive.heading === 'electric' ? electricDrive : this.suction);
    this.turn.step(dt, s.angularVelocity.x, s.angularVelocity.z, s.slipBall, powered);

    // Engines and systems. A state with fewer engines than the panel has gauges for repeats its last one.
    const propShaft = sys.tachShaft === 'propeller';
    for (let i = 0; i < this.engines.length; i++) {
      const e = s.engines[i < s.engines.length ? i : s.engines.length - 1];
      this.engines[i].step(dt, e, propShaft ? e.propRpm : e.rpm, sys.fuel.kgPerGal, powered, r.engines[i]);
    }
    for (let i = 0; i < this.fuel.length; i++) {
      const gal = sys.fuel.tanks[i](s) / sys.fuel.kgPerGal;
      this.fuelGal[i] = gal;
      r.fuelGal[i] = this.fuel[i].step(dt, gal, powered);
    }
    // The ammeter shows the battery current (+ = charging). Older state producers without batteryAmps
    // fall back to an estimate from the alternator output and the switched loads.
    const batteryAmps = Number.isFinite(s.electrical.batteryAmps)
      ? s.electrical.batteryAmps
      : batteryCurrentAmps(c, s.electrical.alternatorAmps, avionics);
    this.amps = lagStep(this.amps, batteryAmps, dt, 0.3);
    // Load meters: one per alternator (grown on the first step: the systems definition does not count them).
    const alternators = s.electrical.alternators;
    if (alternators !== undefined) {
      while (r.alternatorAmps.length < alternators.length) r.alternatorAmps.push(0);
      for (let i = 0; i < alternators.length; i++) r.alternatorAmps[i] = lagStep(r.alternatorAmps[i], alternators[i], dt, 0.3);
    }

    r.airspeedKt = this.airspeed.knots;
    r.altitudeFt = this.altimeter.feet;
    r.kollsmanInHg = this.altimeter.settingInHg;
    r.verticalSpeedFpm = this.vsi.fpm;
    r.attitudeRoll = this.attitude.roll;
    r.attitudePitch = this.attitude.pitch;
    r.headingDeg = this.heading.heading * RAD;
    r.headingBugDeg = this.heading.bug * RAD;
    r.turnRate = this.turn.rate;
    r.ball = this.turn.ball;
    r.turnFlag = this.turn.flag;
    // Engine 0 (the left one on a twin) is every single-engine reading.
    const e0 = r.engines[0];
    r.rpm = e0.rpm;
    r.tachHours = e0.tachHours;
    // The legacy pair: the first two gauged tanks, or half of the one tank each (as AircraftState.fuel does).
    if (this.fuel.length > 1) {
      r.fuelLeftGal = this.fuel[0].value;
      r.fuelRightGal = this.fuel[1].value;
    } else {
      r.fuelLeftGal = r.fuelRightGal = this.fuel[0].value / 2;
    }
    r.oilTempF = e0.oilTempF;
    r.oilPressurePsi = e0.oilPressurePsi;
    r.egtF = e0.egtF;
    r.fuelFlowGph = e0.fuelFlowGph;
    r.suctionInHg = this.suction;
    r.ammeterAmps = this.amps;
    r.busPowered = powered;
    r.avionicsPowered = avionics;
    r.busVolts = volts;
    r.carbHeat = engineControl(c, 0, 'carbHeat');
    // The gear lights are lamps on the bus.
    const gear = s.gear;
    if (gear !== undefined && gear.retractable) {
      const g = this.gear;
      g.nose = powered && gear.locked[0];
      g.left = powered && gear.locked[1];
      g.right = powered && gear.locked[2];
      g.inTransit = powered && gear.inTransit;
      r.gear = g;
    } else {
      r.gear = null;
    }
    const li = (this.lampInputs ??= { state: s, controls: c, fuelGal: this.fuelGal, suctionInHg: 0 });
    li.state = s;
    li.controls = c;
    li.suctionInHg = this.suction;
    for (let i = 0; i < sys.lamps.length; i++) this.lamps[sys.lamps[i].id] = sys.lamps[i].lit(li);
    r.oatC = s.oat - 273.15;
    r.clockSeconds = w.timeOfDay * 3600;
    r.flapsDeg = s.surfaces.flaps * RAD;
    r.obsDeg = c.obsDeg;
    ils07(s.position, r.ils);
    gpsToAirport(s.position, s.track, s.groundSpeed, r.gps);
    r.pressureAltitudeFt = pressureAltitudeFt(s.staticPressure);
    return r;
  }
}
