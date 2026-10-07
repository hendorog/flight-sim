// Scripted mock flight for the instrument and UI dev pages: cold start, run-up, take-off, climb, climbing
// turn, cruise, power-off stall and recovery, then an engine failure and glide. It writes a kinematically
// consistent AircraftState (attitude, body rates, specific force, air data) and the matching controls.

import { DEG, FPM, G0, KT, clamp, lerp, quat, smoothstep, wrapTwoPi } from '../core/math';
import { CG_HEIGHT_ON_GROUND } from '../core/mockState';
import type { AircraftState, ControlInputs } from '../core/types';
import { AIRPORT, runwayThreshold } from '../core/world';

interface Phase {
  until: number;
  name: string;
}

const PHASES: Phase[] = [
  { until: 8, name: 'cold start' },
  { until: 25, name: 'run-up' },
  { until: 45, name: 'take-off roll' },
  { until: 90, name: 'climb' },
  { until: 125, name: 'climbing turn' },
  { until: 150, name: 'cruise' },
  { until: 180, name: 'power-off stall' },
  { until: 200, name: 'recovery' },
  { until: 1e9, name: 'engine failure glide' },
];

export class MockFlight {
  t = 0;
  private heading = AIRPORT.runway.heading;
  private roll = 0;
  private pitch = 0;
  private ias = 0;
  private vs = 0;
  private height = 0;
  private rpm = 0;
  private north: number;
  private east: number;

  constructor() {
    const thr = runwayThreshold(0);
    this.north = thr.x + Math.cos(this.heading) * 60;
    this.east = thr.y + Math.sin(this.heading) * 60;
  }

  get phase(): string {
    return PHASES.find((p) => this.t < p.until)!.name;
  }

  step(dt: number, s: AircraftState, c: ControlInputs): void {
    if (dt <= 0) return;
    this.t += dt;
    const t = this.t;
    const prevRoll = this.roll;
    const prevPitch = this.pitch;
    const prevIas = this.ias;

    // Targets per phase: [ias kt, vs fpm, roll deg, pitch deg, rpm, throttle]
    let ias = 0;
    let vs = 0;
    let roll = 0;
    let pitch = 0;
    let rpm = 0;
    let throttle = 0;
    let flaps = 0;
    c.masterBattery = t > 2;
    c.alternator = t > 2;
    c.avionics = t > 10;
    c.starter = t > 4 && t < 6;
    c.lights.beacon = t > 3;
    c.lights.strobe = t > 25;
    c.lights.landing = t > 25 && t < 100;
    c.fuelPump = t > 3 && t < 7;
    c.parkingBrake = t < 24;
    if (t < 8) {
      rpm = t < 4.5 ? 0 : t < 6 ? 350 : 1000;
      throttle = 0.1;
    } else if (t < 25) {
      rpm = t > 15 && t < 21 ? 1800 : 1000;
      throttle = rpm > 1500 ? 0.55 : 0.15;
    } else if (t < 45) {
      rpm = 2350;
      throttle = 1;
      flaps = 1 / 3;
      ias = clamp((t - 25) * 3.2, 0, 62);
      pitch = t > 42 ? 8 : 0;
      vs = t > 43 ? 400 : 0;
    } else if (t < 90) {
      rpm = 2450;
      throttle = 1;
      flaps = t < 55 ? 1 / 3 : 0;
      ias = 74;
      vs = 720;
      pitch = 9;
    } else if (t < 125) {
      rpm = 2450;
      throttle = 1;
      ias = 76;
      vs = 600;
      pitch = 8;
      roll = -20 * smoothstep(90, 93, t) * (1 - smoothstep(121, 124, t));
    } else if (t < 150) {
      rpm = 2400;
      throttle = 0.72;
      ias = 105;
      pitch = 1.5;
    } else if (t < 180) {
      rpm = 1000;
      throttle = 0.05;
      ias = t < 173 ? lerp(105, 44, smoothstep(150, 172, t)) : 48;
      pitch = t < 173 ? lerp(1.5, 15, smoothstep(150, 170, t)) : -12;
      vs = t < 170 ? -150 : -1200;
      roll = t > 172 ? 12 * Math.sin((t - 172) * 2) : 0;
    } else if (t < 200) {
      rpm = 2400;
      throttle = 1;
      ias = lerp(55, 85, smoothstep(180, 188, t));
      pitch = lerp(-10, 4, smoothstep(180, 190, t));
      vs = lerp(-1000, 300, smoothstep(180, 192, t));
    } else {
      rpm = Math.max(0, 2300 - (t - 200) * 700);
      throttle = 0.7;
      c.alternator = true;
      ias = lerp(85, 68, smoothstep(200, 210, t));
      pitch = -2;
      vs = -700;
      roll = 10 * smoothstep(215, 220, t);
    }
    c.throttle = throttle;
    c.flaps = flaps;
    c.magnetos = t > 3 ? 3 : 0;

    const k = 1 - Math.exp(-dt / 1.2);
    this.ias += (ias - this.ias) * k;
    this.vs += (vs - this.vs) * k;
    this.roll += (roll * DEG - this.roll) * (1 - Math.exp(-dt / 0.8));
    this.pitch += (pitch * DEG - this.pitch) * (1 - Math.exp(-dt / 0.8));
    this.rpm += (rpm - this.rpm) * (1 - Math.exp(-dt / 0.6));
    if (this.height <= 0 && this.vs < 0) this.vs = 0;

    const tas = this.ias * KT * (1 + this.height / 50000);
    const turnRate = this.ias > 30 ? (G0 * Math.tan(this.roll)) / Math.max(tas, 1) : 0;
    this.heading = wrapTwoPi(this.heading + turnRate * dt);
    const gsp = tas * Math.cos(this.pitch * 0.2);
    this.north += Math.cos(this.heading) * gsp * dt;
    this.east += Math.sin(this.heading) * gsp * dt;
    this.height = Math.max(0, this.height + this.vs * FPM * dt);

    const onGround = this.height <= 0;
    const altitudeMSL = AIRPORT.elevation + CG_HEIGHT_ON_GROUND + this.height;
    const rollRate = (this.roll - prevRoll) / dt;
    const pitchRate = (this.pitch - prevPitch) / dt;
    const accel = ((this.ias - prevIas) * KT) / dt;

    s.time = t;
    s.roll = this.roll;
    s.pitch = this.pitch;
    s.heading = this.heading;
    s.track = this.heading;
    s.orientation = quat.fromEuler(this.roll, this.pitch, this.heading);
    s.angularVelocity = {
      x: rollRate,
      y: pitchRate + turnRate * Math.sin(this.roll),
      z: turnRate * Math.cos(this.roll) * Math.cos(this.pitch),
    };
    s.position = { x: this.north, y: this.east, z: -altitudeMSL };
    s.velocity = { x: Math.cos(this.heading) * gsp, y: Math.sin(this.heading) * gsp, z: -this.vs * FPM };
    s.altitudeMSL = altitudeMSL;
    s.altitudeAGL = CG_HEIGHT_ON_GROUND + this.height;
    s.verticalSpeed = this.vs * FPM;
    s.groundSpeed = gsp;
    s.tas = tas;
    s.ias = this.ias * KT;
    s.onGround = onGround;
    // Coordinated flight: the specific force lies in the plane of symmetry; the load factor in a level
    // turn is 1/cos(bank).
    const n = Math.cos(this.pitch) / Math.max(Math.cos(this.roll), 0.3);
    s.specificForce = { x: Math.sin(this.pitch) + accel / G0, y: 0, z: -n };
    s.gLoad = n;
    const stalling = t > 150 && t < 180 && this.ias < 58;
    s.stallWarning = stalling;
    s.stallFraction = t > 171 && t < 176 ? 0.6 : 0;
    s.slipBall = t > 172 && t < 178 ? 0.35 * Math.sin((t - 172) * 3) : t > 200 ? 0.15 : 0;
    s.staticPressure = 101325 * Math.pow(1 - 2.25577e-5 * altitudeMSL, 5.25588);
    s.oat = 288.15 - 0.0065 * altitudeMSL;
    s.surfaces.flaps = lerp(s.surfaces.flaps, flaps * 30 * DEG, 1 - Math.exp(-dt / 2));

    const running = this.rpm > 300 && (t < 200 || this.rpm > 500);
    const e = s.engine;
    e.running = running;
    e.rpm = this.rpm;
    e.oilPressure = running ? clamp(25 + this.rpm / 40, 0, 80) : Math.max(0, e.oilPressure - dt * 15);
    if (t <= dt) e.oilTemp = 18;
    // Oil warms toward ~85 C with a time constant of a couple of minutes (accelerated for the demo).
    if (running) e.oilTemp += (85 - e.oilTemp) * (1 - Math.exp(-dt / 40));
    e.egt = running ? 450 + this.rpm * 0.12 + throttle * 250 : Math.max(20, e.egt - dt * 10);
    e.fuelFlow = running ? (1.2 + 9 * throttle) * 2.7216 / 3600 : 0;
    e.manifoldPressure = running ? 12 + throttle * 13 : 29.5;
    s.propeller.rpm = this.rpm;
    s.fuel.left = t > 200 ? 12 : 60;
    s.fuel.right = 58;
    const alt = running && this.rpm > 900 && c.alternator;
    s.electrical.busVoltage = c.masterBattery ? (alt ? 28.2 : 24.1) : 0;
    s.electrical.alternatorAmps = alt ? 22 : 0;
    s.electrical.batteryAmps = c.masterBattery ? (alt ? 3 : -12) - (c.starter ? 80 : 0) : 0;
  }
}
