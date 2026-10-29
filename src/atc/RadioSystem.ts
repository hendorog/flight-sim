// The radio (docs/atc.md, step 2): Space opens the push-to-talk menu of the calls that fit the moment (calls.ts) on
// the station COM1 is tuned to; a pick goes out as a captioned transmission on the speech scheduler's radio channel,
// and the home tower or ground answers a moment later. Tuned to the home ATIS, the broadcast repeats while in range.
// Nothing is heard with the avionics off or out of radio range. Runs only where the Flight School does (it owns the
// speech scheduler and the captions).

import type { SimContext, Subsystem } from '../core/context';
import { Priority, type ActorId } from '../training/types';
import type { TrainingSystem } from '../training/TrainingSystem';
import type { InstrumentReadings } from '../instruments/dynamics/instrumentSet';
import { radioTuning, stationOn, type Station } from '../instruments/dynamics/radios';
import { RadioMenu } from '../ui/radioMenu';
import { atisText, callsFor, replyTo, stationName, type Call, type RadioSituation } from './calls';
import { callsign } from './phrases';

/** The answer follows the call after this long, s of sim time. */
const REPLY_DELAY = 1.6;
/** The ATIS repeats after this long once it has finished, s of wall time. */
const ATIS_GAP_MS = 4000;
/** Ground station antenna height, m. */
const ANTENNA = 10;

/** VHF line-of-sight range between an aircraft this high above the ground and a station antenna, m. */
export function radioRange(heightAgl: number): number {
  return 4120 * (Math.sqrt(Math.max(2, heightAgl)) + Math.sqrt(ANTENNA));
}

/** The ATIS letter: a new one each hour of the day. */
export function atisLetter(timeOfDay: number): string {
  return String.fromCharCode(65 + (Math.floor(timeOfDay) % 24));
}

export interface RadioDeps {
  training: TrainingSystem;
  readings: () => InstrumentReadings;
  layer: HTMLElement;
}

export class RadioSystem implements Subsystem {
  private ctx!: SimContext;
  private readonly menu: RadioMenu;
  private calls: Call[] = [];
  private situation: RadioSituation | null = null;
  /** Stations that have answered this aircraft (by frequency and field): the abbreviated callsign from then on. */
  private readonly contacted = new Set<string>();
  private pending: { at: number; actor: ActorId; text: string; speak: string; key: string } | null = null;
  private simClock = 0;
  private refresh = 0;
  private atisKey = '';
  private atisIdleSince = -Infinity;
  /** Sim time of the last touchdown after flight, and how long it has been airborne. */
  private landedAt: number | null = null;
  private airborneFor = 0;

  constructor(private readonly deps: RadioDeps) {
    this.menu = new RadioMenu(deps.layer, (i) => this.transmit(i));
  }

  init(ctx: SimContext): void {
    this.ctx = ctx;
    window.addEventListener('keydown', this.onKey, true);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKey, true);
    this.menu.root.remove();
  }

  private get speech() {
    return this.deps.training.speech;
  }

  /** The station COM1 reaches now, or null (no power, nothing on the frequency, out of range). */
  private reachable(): Station | null {
    if (!this.deps.readings().avionicsPowered) return null;
    const st = this.ctx.state;
    const station = stationOn(radioTuning().com1[0], st.position.x, st.position.y);
    if (!station) return null;
    const d = Math.hypot(station.field.north - st.position.x, station.field.east - st.position.y);
    return d <= radioRange(st.altitudeAGL) ? station : null;
  }

  private situationNow(station: Station): RadioSituation {
    const id = this.deps.training.radioIdentity();
    const st = this.ctx.state;
    const w = this.ctx.weather;
    return {
      authority: id.authority,
      callsign: callsign(id.registration, id.icaoType, id.authority),
      station,
      contacted: this.contacted.has(stationKey(station)),
      north: st.position.x,
      east: st.position.y,
      altitude: st.altitudeMSL,
      onGround: st.onGround,
      groundSpeedKt: st.groundSpeed / 0.514444,
      heading: st.groundSpeed > 2 ? st.track : st.heading,
      windFromDeg: w.windDirectionDeg,
      windKt: w.windSpeedKt,
      qnhHpa: w.qnhHpa,
      landedAgoS: this.landedAt === null ? Infinity : this.simClock - this.landedAt,
      atisLetter: atisLetter(w.timeOfDay),
    };
  }

  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
    const t = e.target;
    if (t instanceof HTMLElement && (t.isContentEditable || t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement)) return;
    if (e.code === 'Space') {
      if (this.menu.open) this.menu.hide();
      else this.openMenu();
    } else if (this.menu.open && /^(Digit|Numpad)[1-9]$/.test(e.code)) {
      this.transmit(Number(e.code.slice(-1)) - 1);
    } else if (this.menu.open && e.code === 'Escape') {
      this.menu.hide();
    } else return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };

  private openMenu(): void {
    this.refresh = 0;
    this.updateMenu();
  }

  private updateMenu(): void {
    const f = radioTuning().com1[0].toFixed(3);
    if (!this.deps.readings().avionicsPowered) {
      this.calls = [];
      this.menu.show(`COM1 ${f}`, [], 'The radio is off: switch on the avionics master.');
      return;
    }
    const station = this.reachable();
    if (!station) {
      this.calls = [];
      const anyone = stationOn(radioTuning().com1[0], this.ctx.state.position.x, this.ctx.state.position.y);
      this.menu.show(`COM1 ${f}`, [], anyone ? `${stationName(anyone.field)} is out of range.` : 'Nobody on this frequency. Tune a field from the menu (Esc, Airfields).');
      return;
    }
    const s = (this.situation = this.situationNow(station));
    this.calls = callsFor(s).slice(0, 9);
    const who = `${stationName(station.field)} ${station.kind === 'traffic' ? 'Traffic' : station.kind[0].toUpperCase() + station.kind.slice(1)}`;
    const note = station.kind === 'atis' ? 'An information broadcast: listen, then tune the tower.' : station.kind === 'traffic' ? 'Uncontrolled: announce your position and intentions. Space or Esc closes.' : 'Space or Esc closes.';
    this.menu.show(`COM1 ${f} · ${who}`, this.calls.map((c) => ({ label: c.label, detail: c.line.text })), note);
  }

  private transmit(i: number): void {
    const call = this.calls[i];
    const s = this.situation;
    if (!call || !s) return;
    this.menu.hide();
    this.speech.enqueue({ actor: 'student', channel: 'radio', caption: call.line.text, speak: call.line.speak, priority: Priority.Instruction, interrupt: false, resumable: false, ttlMs: 20000 });
    const reply = replyTo(s, call.id);
    if (reply) {
      const actor: ActorId = s.station.kind === 'ground' ? 'ground' : 'tower';
      this.pending = { at: this.simClock + REPLY_DELAY, actor, text: reply.text, speak: reply.speak, key: stationKey(s.station) };
    }
  }

  update(dt: number): void {
    this.simClock += dt;
    const st = this.ctx.state;
    if (!st.onGround) this.airborneFor += dt;
    else {
      if (this.airborneFor > 10) this.landedAt = this.simClock;
      this.airborneFor = 0;
    }
    if (this.menu.open && (this.refresh -= dt) <= 0) {
      this.refresh = 0.5;
      this.updateMenu();
    }
    const p = this.pending;
    if (p && this.simClock >= p.at && !this.speech.busy('radio')) {
      this.pending = null;
      this.contacted.add(p.key);
      this.speech.enqueue({ actor: p.actor, channel: 'radio', caption: p.text, speak: p.speak, priority: Priority.Instruction, interrupt: false, resumable: false, ttlMs: 20000 });
    }
    this.updateAtis();
  }

  /** The ATIS repeats while COM1 is on it and in range; retuning cuts it off. */
  private updateAtis(): void {
    const station = this.ctx.paused ? null : this.reachable();
    const on = station?.kind === 'atis';
    if (!on) {
      if (this.atisKey) this.speech.cancel({ actor: 'atis' });
      this.atisKey = '';
      return;
    }
    const w = this.ctx.weather;
    const letter = atisLetter(w.timeOfDay);
    if (!this.speech.idle('atis')) {
      this.atisIdleSince = -Infinity;
      return;
    }
    const now = performance.now();
    if (this.atisIdleSince === -Infinity) this.atisIdleSince = this.atisKey ? now : now - ATIS_GAP_MS;
    if (now - this.atisIdleSince < ATIS_GAP_MS) return;
    const id = this.deps.training.radioIdentity();
    const msg = atisText(station.field, letter, { windFromDeg: w.windDirectionDeg, windKt: w.windSpeedKt, qnhHpa: w.qnhHpa, visibilityM: w.visibilityM, authority: id.authority });
    this.atisKey = letter;
    this.atisIdleSince = -Infinity;
    this.speech.enqueue({ actor: 'atis', channel: 'radio', caption: msg.text, speak: msg.speak, priority: Priority.Coach, interrupt: false, resumable: false, ttlMs: 10000 });
  }
}

function stationKey(s: Station): string {
  return `${s.field.code}:${s.kind}`;
}
