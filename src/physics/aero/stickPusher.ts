// Stick shaker and stick pusher (PC-12 stall-warning and identification system, 47E-PROXY sect. 7-21). An AOA-vane
// trip schedule against flap deflection: the shaker runs above shakerAlphaDeg, the pusher drives the elevator
// nose-down by pushElevator above pusherAlphaDeg, with the inhibits a real system has (just after lift-off, at low
// load factor, with a dead bus, while the pilot holds the interrupt).
//
// The model (P1):
//  - Trip angles: linear in the flap deflection between the schedule's points (held beyond its ends), each raised by
//    torqueBias x the torque gauge's psi (47E: torque is an input of the computers; ESTIMATE).
//  - Shaker: on above its angle, off 0.5 deg below it; never with weight on the wheels or a dead bus.
//  - Pusher: armed only in the air, LIFTOFF inhibit seconds after the wheels leave, above minLoadFactor (the g-switch)
//    and with the bus alive; while armed and above its angle it pushes, until the angle falls 1.5 deg below the trip
//    (the computers' reset). The push ramps in and out over rampSeconds; the elevator the control system gets is the
//    pilot's yoke less pushElevator x the ramp (the pilot cannot hold the column against it: the slip clutch is at
//    85-90 lbf, 47E 7-21), never further aft than the yoke. The interrupt (ControlInputs.pusherInterrupt, held) stops
//    the push at once; the shaker runs on.
// The flight model constructs one only for a type whose ControlSystemDef has `stickPusher`, so no other type runs
// this code.

/** Shaker reset below its trip angle, deg. */
const SHAKER_HYSTERESIS = 0.5;
/** Pusher reset below its trip angle, deg. */
const PUSHER_HYSTERESIS = 1.5;

export interface StickPusherDef {
  /** Trip schedule against flap deflection, deg (ascending): shaker and pusher BODY angle of attack, deg. */
  flapDeg: readonly number[];
  shakerAlphaDeg: readonly number[];
  pusherAlphaDeg: readonly number[];
  /** Trip AOA shift per psi of torque, deg/psi (47E sect. 7-21: torque is an input; ESTIMATE). Absent: 0. */
  torqueBias?: number;
  /** psi per POWER-TURBINE N m (PC-12: PC12_GEAR_RATIO x PC12_PSI_PER_NM), to read the torque input. Needed with torqueBias. */
  psiPerPtNm?: number;
  /** Nose-down elevator command the pusher adds, as a fraction of full down travel, and its ramp time, s. */
  pushElevator: number;
  rampSeconds: number;
  /** Inhibits: seconds after lift-off; below this load factor, g; below this bus voltage, V. */
  liftoffInhibitSeconds: number;
  minLoadFactor: number;
  minBusVolts: number;
}

/** What one step of the system reads; all from the previous step's state (the vane lags by one step). */
export interface StickPusherInput {
  /** Body angle of attack, deg (AircraftState.alpha). */
  alphaDeg: number;
  /** Flap deflection, deg (SurfaceState.flaps). */
  flapDeg: number;
  /** Normal load factor, g (AircraftState.gLoad). */
  loadFactor: number;
  /** Bus voltage, V. */
  busVolts: number;
  /** Any wheel on the ground. */
  weightOnWheels: boolean;
  /** Power-turbine torque of engine 0, N m (EngineState.torque); x psiPerPtNm = the torque gauge psi. */
  ptTorqueNm: number;
  /** ControlInputs.pusherInterrupt. */
  interrupt: boolean;
  dt: number;
}

export class StickPusher {
  private shakerOn = false;
  private pusherOn = false;
  /** Push ramp, 0..1. */
  private ramp = 0;
  /** Seconds since the wheels left the ground (counted up to the inhibit). */
  private airborneTime = 0;

  constructor(readonly def: StickPusherDef) {
    const n = def.flapDeg.length;
    if (n < 1 || def.shakerAlphaDeg.length !== n || def.pusherAlphaDeg.length !== n) throw new Error('StickPusher: one shaker and one pusher angle per flap point');
    for (let i = 1; i < n; i++) if (!(def.flapDeg[i] > def.flapDeg[i - 1])) throw new Error('StickPusher: flap points ascending');
    if (def.torqueBias !== undefined && def.psiPerPtNm === undefined) throw new Error('StickPusher: torqueBias needs psiPerPtNm');
    this.airborneTime = def.liftoffInhibitSeconds;
  }

  reset(): void {
    this.shakerOn = false;
    this.pusherOn = false;
    this.ramp = 0;
    // A reset in the air is long past its lift-off; one on the ground counts again from the next lift-off.
    this.airborneTime = this.def.liftoffInhibitSeconds;
  }

  /** Trip angles (shaker, pusher), deg, at a flap deflection (deg) and torque-gauge psi. */
  tripAngles(flapDeg: number, psi: number): { shaker: number; pusher: number } {
    const d = this.def;
    const bias = (d.torqueBias ?? 0) * Math.max(0, psi);
    return { shaker: schedule(d.flapDeg, d.shakerAlphaDeg, flapDeg) + bias, pusher: schedule(d.flapDeg, d.pusherAlphaDeg, flapDeg) + bias };
  }

  /**
   * One step: returns the elevator command ([-1, 1], + = yoke back) the control system receives in place of
   * the pilot's `yoke`.
   */
  step(i: StickPusherInput, yoke: number): number {
    const d = this.def;
    const powered = i.busVolts >= d.minBusVolts;
    if (i.weightOnWheels) this.airborneTime = 0;
    else this.airborneTime = Math.min(d.liftoffInhibitSeconds, this.airborneTime + i.dt);
    const psi = i.ptTorqueNm * (d.psiPerPtNm ?? 0);
    const trip = this.tripAngles(i.flapDeg, psi);
    const alpha = Number.isFinite(i.alphaDeg) ? i.alphaDeg : 0;
    // Shaker: either computer (one vane) is enough.
    const air = powered && !i.weightOnWheels;
    this.shakerOn = air && (this.shakerOn ? alpha > trip.shaker - SHAKER_HYSTERESIS : alpha >= trip.shaker);
    // Pusher: both computers agree (the model has one vane signal), armed in the air after the lift-off inhibit.
    const armed = air && this.airborneTime >= d.liftoffInhibitSeconds && i.loadFactor >= d.minLoadFactor && !i.interrupt;
    this.pusherOn = armed && (this.pusherOn ? alpha > trip.pusher - PUSHER_HYSTERESIS : alpha >= trip.pusher);
    const rate = d.rampSeconds > 0 ? i.dt / d.rampSeconds : 1;
    if (i.interrupt || !powered) this.ramp = 0;
    else this.ramp = Math.max(0, Math.min(1, this.ramp + (this.pusherOn ? rate : -rate)));
    if (this.ramp <= 0) return yoke;
    return Math.max(-1, Math.min(yoke, yoke - d.pushElevator * this.ramp));
  }

  /** Shaker running. */
  get shaker(): boolean {
    return this.shakerOn;
  }

  /** Pusher pushing (the trip is made; the push itself ramps). */
  get pusher(): boolean {
    return this.pusherOn;
  }
}

/** Piecewise-linear schedule, held beyond its ends. */
function schedule(x: readonly number[], y: readonly number[], at: number): number {
  const n = x.length;
  if (at <= x[0]) return y[0];
  if (at >= x[n - 1]) return y[n - 1];
  let k = 1;
  while (x[k] < at) k++;
  const f = (at - x[k - 1]) / (x[k] - x[k - 1]);
  return y[k - 1] + f * (y[k] - y[k - 1]);
}
