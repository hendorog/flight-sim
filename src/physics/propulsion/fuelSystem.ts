// Fuel system of an aircraft: its tanks, and for each engine a FEED from them (by default the C172S: two
// gravity-feed wing tanks and one feed behind a four-position selector LEFT / RIGHT / BOTH / OFF): the fuel
// reservoir, strainer and lines, the engine-driven pump, the electric auxiliary pump, and what delivers the fuel
// to the engine: the RSA servo and injector lines, a carburettor's float bowl, or a diesel's common rail.
//
// Which tanks a feed draws in a selector position is the definition's (FuelFeedDef.positions): a twin's
// CROSSFEED is simply the position that names the tank of the other side. A feed takes equal shares from the
// tanks of its position that still hold fuel.
//
// The lines, reservoir and servo hold a small volume downstream of the selector, so an engine keeps running for
// several seconds after the selector is turned off or a tank runs dry, then starves. Quantities are usable fuel.
//
// Restarting after starvation or idle cut-off is not instantaneous, for three physical reasons:
//  - Prime. Once the lines run dry the engine-driven vane pump sucks air and delivers no pressure. With fuel back
//    at its inlet (gravity head from the high wing) it re-primes over a few seconds of turning; the electric
//    auxiliary pump, which sits upstream and is fed by gravity, restores pressure at once (hence the aux-pump
//    item on the restart checklist).
//  - Injector lines. The metered fuel reaches the four nozzles through the flow divider and ~1/8 in stainless
//    lines. After starvation they are full of air, which the fuel must purge before the nozzles spray: the engine
//    catches only once they are mostly refilled, at the metered flow of a windmilling engine that takes a few
//    seconds. At idle cut-off the flow divider closes and holds them, but they drain slowly through the nozzles'
//    air-bleed vents into the induction vacuum.
//  - Port wall film. The continuous-flow nozzles spray onto the intake valve and port; part of the fuel wets the
//    walls and reaches the cylinder only as the film evaporates (the x-tau model of Aquino, SAE 810494), so the
//    mixture that burns lags the metered one for a fraction of a second.
//
// A feed whose film has a cold table (FuelFeedDef.film.cold) also needs priming: on cold cylinder heads most of
// the spray wets the ports and evaporates slowly, so a cold engine cranked with the mixture rich and no prime
// gets too little vapour to fire until the film has built up. The prime is fuel sprayed onto the port walls with
// the engine at rest (the servo's priming flow, PistonEngine), which the cranking airflow then evaporates;
// too much of it floods the engine until the film has been drawn down.

import type { FuelSelector } from '../../core/types';
import { interp1, smoothstep } from '../../core/math';
import { C172_POWERPLANT } from './c172Powerplant';
import type { ColdFilmDef, FuelFeedDef, FuelSystemDef } from './defs';

/** The servo and injector lines of a feed's definition. */
function injectorDelivery(feed: FuelFeedDef): Extract<FuelFeedDef['delivery'], { kind: 'injector' }> {
  if (feed.delivery.kind !== 'injector') throw new Error(`FuelSystem: delivery '${feed.delivery.kind}' has no injector lines`);
  return feed.delivery;
}

const C172_FEED = C172_POWERPLANT.fuel.feeds[0];
const C172_DELIVERY = injectorDelivery(C172_FEED);

// The Cessna 172S (C172_POWERPLANT.fuel, where each number is explained) under the names this module has always
// exported.
export const TANK_CAPACITY = C172_POWERPLANT.fuel.tanks[0].capacity;
export const LINE_CAPACITY = C172_FEED.lineCapacity;
export const LINE_UNUSABLE = C172_FEED.lineUnusable;
export const FEED_CAPACITY = C172_FEED.feedCapacity;
export const ENGINE_PUMP_PSI = C172_FEED.enginePump!.psi;
export const AUX_PUMP_PSI = C172_FEED.auxPump!.psi;
export const AUX_PUMP_MIN_VOLTS = C172_FEED.auxPump!.minVolts;
export const INJECTION_OPEN_PSI = C172_DELIVERY.openPsi;
export const INJECTION_FULL_PSI = C172_DELIVERY.fullPsi;
export const INJECTOR_CAPACITY = C172_DELIVERY.capacity;
export const FILM_FRACTION = C172_FEED.film.fraction;
export const FILM_TIME = C172_FEED.film.time;

/** Shaft speed at which the engine-driven vane pump has reached 63 % of its regulated pressure, rpm. */
const ENGINE_PUMP_RPM_SCALE = 600;
/** Fill fraction of the injector lines at which the nozzles begin to spray, and are fully primed. */
const INJECTOR_SPRAY_START = 0.55;
const INJECTOR_SPRAY_FULL = 0.95;
/** Drain time constant of the injector lines through the nozzle air bleeds while the flow divider is closed, s. */
const INJECTOR_DRAIN_TIME = 30;
/** Shaft speed over which the induction vacuum that drains the lines builds up, rpm (none at rest). */
const DRAIN_RPM_START = 50;
const DRAIN_RPM_FULL = 400;
/**
 * Engine-driven pump re-prime: time constant at REPRIME_RPM, s (scales inversely with shaft speed). `prime` is the
 * fraction of the air purged from the pump; an air-bound vane pump develops pressure only once most of it is
 * gone (PRIME_PRESSURE_START..1).
 */
const REPRIME_TIME = 2;
const PRIME_PRESSURE_START = 0.7;
const REPRIME_RPM = 1500;
/** Time for a dry pump to lose prime, s. */
const LOSE_PRIME_TIME = 0.3;
/** Cold film: shaft speed its evaporation times are quoted at, rpm; and the speed by which air carries spray past the walls. */
const FILM_CRANK_RPM = 200;
const FILM_STILL_RPM = 60;
/** Selector position that draws nothing. */
const NO_TANKS: readonly number[] = [];

export interface FuelStepResult {
  /** Fuel reaching the cylinders (after the injector lines and the port wall film), kg/s. */
  delivered: number;
  /** Fuel metered into the injector lines by the servo (the fuel-flow gauge's reading), kg/s. */
  metered: number;
  /** Fuel pressure at the servo, psi. */
  pressurePsi: number;
  /** Fuel drawn from the left-side and right-side tanks during this step, kg (a centre tank counts half to each). */
  usedLeft: number;
  usedRight: number;
}

/** One engine's feed: everything between the tanks and the cylinders. */
class FuelFeed {
  /** Fuel in the lines downstream of the selector, kg. */
  line: number;
  /** Fuel in the flow divider and injector lines, or in the carburettor's float bowl, kg (0 with a common rail). */
  injector: number;
  /** Engine-driven pump prime, 0 (pumping air) .. 1. */
  prime = 1;
  /** Fuel film on the intake port walls, kg; NaN until the first step (then set to its equilibrium). */
  film = NaN;
  readonly result: FuelStepResult = { delivered: 0, metered: 0, pressurePsi: 0, usedLeft: 0, usedRight: 0 };

  private readonly positions: FuelFeedDef['positions'];
  private readonly gravityHeadPsi: number;
  private readonly lineCapacity: number;
  private readonly lineUnusable: number;
  private readonly feedCapacity: number;
  /** Regulated pressure of each pump, psi (0 = the feed has no such pump). */
  private readonly enginePumpPsi: number;
  private readonly auxPumpPsi: number;
  private readonly auxPumpMinVolts: number;
  private readonly delivery: FuelFeedDef['delivery']['kind'];
  private readonly injectionOpenPsi: number;
  private readonly injectionFullPsi: number;
  /** Capacity of the injector lines or of the float bowl, kg. */
  private readonly injectorCapacity: number;
  /** Pressure the float valve or the rail needs, psi. */
  private readonly minPsi: number;
  private readonly filmFraction: number;
  private readonly filmTime: number;
  private readonly coldFilm: ColdFilmDef | undefined;
  /** The selector position the list below belongs to. */
  private selector: FuelSelector | null = null;
  private drawn: readonly number[] = NO_TANKS;
  /** A quasi-steady step found the feed shut off: its steady state is dry (see settled()). */
  private dry = false;

  constructor(feed: FuelFeedDef, tankCount: number) {
    for (const tanks of Object.values(feed.positions)) {
      for (const k of tanks) if (!(k >= 0 && k < tankCount)) throw new Error(`FuelSystem: a selector position names tank ${k} of ${tankCount}`);
    }
    const delivery = feed.delivery;
    this.positions = feed.positions;
    this.gravityHeadPsi = feed.gravityHeadPsi;
    this.lineCapacity = feed.lineCapacity;
    this.lineUnusable = feed.lineUnusable;
    this.feedCapacity = feed.feedCapacity;
    this.enginePumpPsi = feed.enginePump?.psi ?? 0;
    this.auxPumpPsi = feed.auxPump?.psi ?? 0;
    this.auxPumpMinVolts = feed.auxPump?.minVolts ?? 0;
    this.delivery = delivery.kind;
    this.injectionOpenPsi = delivery.kind === 'injector' ? delivery.openPsi : 0;
    this.injectionFullPsi = delivery.kind === 'injector' ? delivery.fullPsi : 0;
    this.injectorCapacity = delivery.kind === 'commonRail' ? 0 : delivery.capacity;
    this.minPsi = delivery.kind === 'carburettorBowl' ? delivery.minHeadPsi : delivery.kind === 'commonRail' ? delivery.minPsi : 0;
    this.filmFraction = feed.film.fraction;
    this.filmTime = feed.film.time;
    this.coldFilm = feed.film.cold;
    this.line = this.lineCapacity;
    this.injector = this.injectorCapacity;
  }

  /**
   * Advance one step: refill the lines from the selected tank(s) (`quantities`, kg, drawn down; what is taken
   * from each is ADDED to `used`), pressurise, and deliver up to `demand` kg/s to the engine. `steady`: see
   * FuelSystem.steady. `headC`: cylinder-head temperature, C (read by a cold film only). The returned object is
   * reused.
   */
  step(
    dt: number, demand: number, selector: FuelSelector, rpm: number, auxPump: boolean, busVoltage: number,
    quantities: Float64Array, used: Float64Array, steady: boolean, headC = Infinity,
  ): FuelStepResult {
    const r = this.result;

    // Refill the lines by gravity from whichever selected tanks still hold fuel.
    if (selector !== this.selector) {
      // The tanks this position draws from (a position the definition does not list shuts the feed).
      this.selector = selector;
      this.drawn = this.positions[selector] ?? NO_TANKS;
    }
    const drawn = this.drawn;
    const room = this.lineCapacity - this.line;
    let available = 0;
    let holding = 0;
    for (let n = 0; n < drawn.length; n++) {
      const quantity = quantities[drawn[n]];
      if (quantity > 0) {
        available += quantity;
        holding++;
      }
    }
    const feed = Math.min(room, this.feedCapacity * dt, available);
    if (feed > 0) {
      // Equal shares while several tanks have fuel; the last one makes up what an almost empty one could not give.
      const share = 1 / holding;
      let taken = 0;
      let seen = 0;
      for (let n = 0; n < drawn.length; n++) {
        const k = drawn[n];
        const quantity = quantities[k];
        if (!(quantity > 0)) continue;
        const draw = ++seen < holding ? Math.min(feed * share, quantity) : Math.min(feed - taken, quantity);
        quantities[k] = quantity - draw;
        used[k] += draw;
        taken += draw;
      }
      this.line += taken;
    }

    // Pumps only develop pressure while they have fuel to pump; they lose prime (suck air) once the lines are
    // down to the fuel that cannot reach the pump inlet.
    const wet = smoothstep(this.lineUnusable, 2 * this.lineUnusable, this.line);
    if (steady) this.prime = wet;
    else if (dt > 0) {
      // A dry pump loses prime within a fraction of a second; a wetted one re-primes as it turns.
      const rate = wet < 0.5 ? -1 / LOSE_PRIME_TIME : Math.max(rpm, 0) / (REPRIME_RPM * REPRIME_TIME);
      this.prime = rate < 0 ? this.prime * Math.exp(rate * dt) : this.prime + (1 - this.prime) * (1 - Math.exp(-rate * dt));
    }
    const enginePump = this.enginePumpPsi * (1 - Math.exp(-rpm / ENGINE_PUMP_RPM_SCALE)) * smoothstep(PRIME_PRESSURE_START, 1, this.prime);
    const aux = auxPump && busVoltage > this.auxPumpMinVolts ? this.auxPumpPsi : 0;
    const pumpPsi = Math.max(enginePump, aux);
    r.pressurePsi = pumpPsi * wet;
    // The head of fuel standing above the engine adds to whatever the pumps make.
    if (this.gravityHeadPsi !== 0) r.pressurePsi = (this.gravityHeadPsi + pumpPsi) * wet;

    if (this.delivery !== 'injector') {
      // The steady state of a feed that is shut off is a dry line and an engine that gets nothing. (An injected
      // feed keeps its lines through a quasi-steady evaluation, as it always has.)
      this.dry = steady && drawn.length === 0;
      if (this.dry) this.line = this.injector = 0;
      return this.deliver(dt, demand, steady, rpm, headC);
    }

    // Servo: meters the demanded flow into the injector lines once the pressure opens the flow divider.
    const meterable = demand * smoothstep(this.injectionOpenPsi, this.injectionFullPsi, r.pressurePsi);
    const metered = Math.min(meterable * dt, Math.max(0, this.line - this.lineUnusable));
    this.line -= metered;
    r.metered = dt > 0 ? metered / dt : 0;

    // Injector lines: the nozzles spray the demanded flow once the lines are primed; air is purged first.
    let sprayed: number;
    if (steady || dt <= 0) {
      this.injector = this.injectorCapacity;
      sprayed = r.metered;
    } else {
      this.injector += metered;
      const spray = smoothstep(INJECTOR_SPRAY_START, INJECTOR_SPRAY_FULL, this.injector / this.injectorCapacity);
      // Once primed the nozzles pass the demanded flow (running on what the lines hold while starving); with the
      // flow divider shut at idle cut-off the lines drain slowly through the nozzle air bleeds instead.
      // The bleed needs the induction vacuum of a turning engine: a stopped engine keeps its lines full
      // (without this a cold engine left parked for a minute would need half a minute of cranking).
      const drain = smoothstep(DRAIN_RPM_START, DRAIN_RPM_FULL, rpm) / INJECTOR_DRAIN_TIME;
      const out = demand > 0 ? Math.min(demand * spray * dt, this.injector) : this.injector * dt * drain;
      this.injector = Math.min(Math.max(this.injector - out, 0), this.injectorCapacity);
      sprayed = demand > 0 ? out / dt : 0;
    }
    return this.throughFilm(dt, sprayed, steady, rpm, headC);
  }

  /**
   * Delivery without injector lines, at the pressure step() has just found.
   *  - Float carburettor: the float valve refills the bowl whenever there is head enough to lift fuel past its
   *    needle (gravity alone on a high wing), and the engine draws what it asks for from the bowl, so it runs on
   *    for as long as the bowl lasts after the supply stops.
   *  - Common rail: the high-pressure pump needs its supply pressure; what it takes goes straight to the
   *    injectors (no port film on a direct-injection engine).
   */
  private deliver(dt: number, demand: number, steady: boolean, rpm: number, headC: number): FuelStepResult {
    const r = this.result;
    const supply = smoothstep(0.5 * this.minPsi, this.minPsi, r.pressurePsi);
    const usable = Math.max(0, this.line - this.lineUnusable);
    if (this.delivery === 'commonRail') {
      const metered = Math.min(demand * supply * dt, usable);
      this.line -= metered;
      r.metered = r.delivered = dt > 0 ? metered / dt : 0;
      return r;
    }
    let sprayed: number;
    if (steady || dt <= 0) {
      const flow = Math.min(demand * dt, this.feedCapacity * supply * dt, usable);
      this.line -= flow;
      this.injector = this.injectorCapacity;
      sprayed = dt > 0 ? flow / dt : 0;
    } else {
      const inflow = Math.min(this.injectorCapacity - this.injector, this.feedCapacity * supply * dt, usable);
      this.line -= inflow;
      this.injector += inflow;
      const out = Math.min(demand * dt, this.injector);
      this.injector -= out;
      sprayed = out / dt;
    }
    r.metered = sprayed;
    return this.throughFilm(dt, sprayed, steady, rpm, headC);
  }

  /** Port wall film (x-tau): the cylinders get the undeposited spray plus the film's evaporation. */
  private throughFilm(dt: number, sprayed: number, steady: boolean, rpm: number, headC: number): FuelStepResult {
    const r = this.result;
    if (!Number.isFinite(this.film) || steady || dt <= 0) this.film = this.filmFraction * sprayed * this.filmTime;
    else if (this.coldFilm) {
      // Cold heads: more of the spray wets the walls, and it evaporates in proportion to the air drawn past it
      // (none at rest, where the spray all stays on the walls), never faster than off a warm wall.
      const cold = this.coldFilm;
      const turning = smoothstep(0, FILM_STILL_RPM, rpm);
      const fraction = 1 - (1 - interp1(cold.temperatureC, cold.fraction, headC)) * turning;
      const rate = Math.min(1 / this.filmTime, Math.max(rpm, 0) / (FILM_CRANK_RPM * interp1(cold.temperatureC, cold.time, headC)));
      const evaporated = this.film * (1 - Math.exp(-rate * dt));
      this.film = Math.min(this.film + fraction * sprayed * dt - evaporated, cold.capacity);
      r.delivered = (1 - fraction) * sprayed + evaporated / dt;
      return r;
    } else {
      const k = 1 - Math.exp(-dt / this.filmTime);
      const evaporated = this.film * k;
      this.film += this.filmFraction * sprayed * dt - evaporated;
      r.delivered = (1 - this.filmFraction) * sprayed + evaporated / dt;
      return r;
    }
    r.delivered = sprayed;
    return r;
  }

  reset(): void {
    this.line = this.lineCapacity;
    this.injector = this.injectorCapacity;
    this.prime = 1;
    this.film = NaN;
    this.dry = false;
  }

  /** After a quasi-steady evaluation: lines full and primed, as reset() leaves them, unless it found the feed shut off. */
  settled(): void {
    const dry = this.dry;
    this.reset();
    if (dry) this.line = this.injector = 0;
  }
}

export class FuelSystem {
  /** Usable fuel in each tank, kg, in the definition's order. */
  readonly quantities: Float64Array;
  /** Fuel drawn from each tank since beginStep(), kg. */
  readonly used: Float64Array;
  /**
   * Quasi-steady operation (trim and settle): the injector lines stay primed and the wall film sits at its
   * equilibrium for the current flow, so a steady operating point does not depend on the settle time step.
   */
  steady = false;

  readonly tankCount: number;
  readonly feedCount: number;
  private readonly capacities: readonly number[];
  private readonly feeds: readonly FuelFeed[];
  /** Share of each tank in the legacy left / right view: 1 on its side, a half each for a centre tank. */
  private readonly leftShare: readonly number[];
  private readonly rightShare: readonly number[];

  constructor(def: FuelSystemDef = C172_POWERPLANT.fuel) {
    if (def.tanks.length < 1 || def.feeds.length < 1) throw new Error('FuelSystem: at least one tank and one feed');
    this.tankCount = def.tanks.length;
    this.feedCount = def.feeds.length;
    this.capacities = def.tanks.map((tank) => tank.capacity);
    this.leftShare = def.tanks.map((tank) => (tank.side === 'left' ? 1 : tank.side === 'right' ? 0 : 0.5));
    this.rightShare = def.tanks.map((tank) => (tank.side === 'right' ? 1 : tank.side === 'left' ? 0 : 0.5));
    this.quantities = Float64Array.from(this.capacities);
    this.used = new Float64Array(this.tankCount);
    this.feeds = def.feeds.map((feed) => new FuelFeed(feed, this.tankCount));
  }

  /** Usable fuel in the left-side tanks, kg (the left tank of a two-tank aircraft). Writing sets the first of them. */
  get left(): number {
    return this.sideSum(this.quantities, this.leftShare);
  }

  set left(quantity: number) {
    this.quantities[Math.max(0, this.leftShare.indexOf(1))] = quantity;
  }

  get right(): number {
    return this.sideSum(this.quantities, this.rightShare);
  }

  set right(quantity: number) {
    this.quantities[Math.max(0, this.rightShare.indexOf(1))] = quantity;
  }

  /** Fuel drawn from the left-side / right-side tanks since beginStep(), kg. */
  get usedLeft(): number {
    return this.sideSum(this.used, this.leftShare);
  }

  get usedRight(): number {
    return this.sideSum(this.used, this.rightShare);
  }

  private sideSum(values: Float64Array, share: readonly number[]): number {
    let sum = 0;
    for (let k = 0; k < values.length; k++) if (share[k] !== 0) sum += share[k] * values[k];
    return sum;
  }

  // The lines, injector lines, pump prime and wall film of the first engine's feed (the only one of a single).
  get line(): number {
    return this.feeds[0].line;
  }

  set line(kg: number) {
    this.feeds[0].line = kg;
  }

  get injector(): number {
    return this.feeds[0].injector;
  }

  set injector(kg: number) {
    this.feeds[0].injector = kg;
  }

  get prime(): number {
    return this.feeds[0].prime;
  }

  set prime(fraction: number) {
    this.feeds[0].prime = fraction;
  }

  get film(): number {
    return this.feeds[0].film;
  }

  set film(kg: number) {
    this.feeds[0].film = kg;
  }

  /** Start a step of several feeds: nothing drawn from any tank yet. */
  beginStep(): void {
    this.used.fill(0);
  }

  /**
   * Advance the feed of engine `i` by one step (after beginStep(); the feeds draw on the tanks one after the
   * other): `demand` kg/s, that engine's selector position, crank rpm and electric pump switch, and its
   * cylinder-head temperature, C (a cold port film reads it; absent: warm).
   */
  stepFeed(i: number, dt: number, demand: number, selector: FuelSelector, rpm: number, auxPump: boolean, busVoltage: number, headC = Infinity): FuelStepResult {
    return this.feeds[i].step(dt, demand, selector, rpm, auxPump, busVoltage, this.quantities, this.used, this.steady, headC);
  }

  /**
   * Advance the one feed of a single-engine aircraft: refill the lines from the selected tank(s), pressurise,
   * and deliver up to `demand` kg/s to the engine. The returned object is reused.
   */
  step(dt: number, demand: number, selector: FuelSelector, rpm: number, auxPump: boolean, busVoltage: number): FuelStepResult {
    this.used.fill(0);
    const r = this.feeds[0].step(dt, demand, selector, rpm, auxPump, busVoltage, this.quantities, this.used, this.steady);
    r.usedLeft = this.usedLeft;
    r.usedRight = this.usedRight;
    return r;
  }

  /** Tank contents (kg, clamped to the capacities), lines full and primed: two tanks by name, or all in the definition's order. */
  reset(fuelLeft: number | readonly number[], fuelRight = 0): void {
    this.fill(fuelLeft, fuelRight);
    for (const feed of this.feeds) feed.reset();
  }

  /**
   * End of a quasi-steady evaluation (settle): the tanks back to `quantities` and the lines as reset() leaves
   * them, except that a carburettor or common-rail feed the evaluation found shut off stays dry.
   */
  restore(quantities: readonly number[]): void {
    this.fill(quantities, 0);
    for (const feed of this.feeds) feed.settled();
  }

  private fill(fuelLeft: number | readonly number[], fuelRight: number): void {
    const q = this.quantities;
    if (typeof fuelLeft === 'number') {
      q[0] = Math.min(Math.max(fuelLeft, 0), this.capacities[0]);
      if (q.length > 1) q[1] = Math.min(Math.max(fuelRight, 0), this.capacities[1]);
    } else {
      for (let k = 0; k < q.length; k++) q[k] = Math.min(Math.max(fuelLeft[k] ?? 0, 0), this.capacities[k]);
    }
  }
}
