// The radio (docs/atc.md, step 2): Space opens the push-to-talk menu of the calls that fit the moment (calls.ts) on
// the station the MIC's COM is tuned to (COM1 unless the audio panel is on COM2); a pick goes out as a captioned transmission on the speech scheduler's radio channel,
// and the home tower or ground answers a moment later. Tuned to the home ATIS, the broadcast repeats while in range.
// Nothing is heard with the avionics off or out of radio range. Runs only where the Flight School does (it owns the
// speech scheduler and the captions). R opens the radio window: the nearby stations to tune with one key (the one a
// controller just handed over to first), the flip-flop, the MIC selector and, in a lesson, the instructor's say again.

import type { SimContext, Subsystem } from '../core/context';
import { Priority, type ActorId } from '../training/types';
import type { TrainingSystem } from '../training/TrainingSystem';
import type { InstrumentReadings } from '../instruments/dynamics/instrumentSet';
import { HOME_GROUND, radioTuning, selectMic, stationOn, stations, swapCom, tuneCom, type ComRadio, type Station } from '../instruments/dynamics/radios';
import { RadioMenu, type RadioMenuItem } from '../ui/radioMenu';
import { atisText, callsFor, replyTo, stationName, vacateInstruction, type Call, type Intent, type RadioSituation } from './calls';
import { callsign } from './phrases';
import type { Transmission } from './TrafficSystem';

/** The answer follows the call after this long, s of sim time. */
const REPLY_DELAY = 1.6;
/** The ATIS repeats after this long once it has finished, s of wall time. */
const ATIS_GAP_MS = 4000;
/** Ground station antenna height, m. */
const ANTENNA = 10;
/** A handover ("contact Ground 121.9") stays first in the radio window for this long, s of sim time. */
const HANDOVER_S = 180;
const NM = 1852;

/** VHF line-of-sight range between an aircraft this high above the ground and a station antenna (or another aircraft this high), m. */
export function radioRange(heightAgl: number, otherAgl = ANTENNA): number {
  return 4120 * (Math.sqrt(Math.max(2, heightAgl)) + Math.sqrt(Math.max(2, otherAgl)));
}

/** The ATIS letter: a new one each hour of the day. */
export function atisLetter(timeOfDay: number): string {
  return String.fromCharCode(65 + (Math.floor(timeOfDay) % 24));
}

export interface RadioDeps {
  training: TrainingSystem;
  readings: () => InstrumentReadings;
  layer: HTMLElement;
  /** The circuit traffic's calls since the last frame (TrafficSystem.drain). */
  traffic?: () => Transmission[];
  /** The COM radios the panel has (InstrumentPanel.comRadios); one: the MIC stays on COM1. */
  comRadios?: () => ComRadio;
  /** A short confirmation over the flight view. */
  toast?: (text: string) => void;
  /** A menu or dialog has the keys: Space and R are left to it. */
  blocked?: () => boolean;
}

interface TuneItem extends RadioMenuItem {
  key: string;
  run: () => void;
}

export class RadioSystem implements Subsystem {
  private ctx!: SimContext;
  private readonly menu: RadioMenu;
  private calls: Call[] = [];
  /** Which window is open: the calls (Space) or the tuning (R). */
  private mode: 'calls' | 'tune' | null = null;
  private tuneItems: TuneItem[] = [];
  /** The frequency a controller last handed this aircraft to, until the sim time given. */
  private handover: { frequency: number; until: number } | null = null;
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
  /** The intention last stated on downwind or final, and the one the latest landing was made with. */
  private intent: Intent | null = null;
  private landingIntent: Intent | null = null;
  /** The tower has told this landing where to turn off. */
  private vacateGiven = true;

  constructor(private readonly deps: RadioDeps) {
    this.menu = new RadioMenu(deps.layer, (i) => (this.mode === 'tune' ? this.tuneItems[i]?.run() : this.transmit(i)));
  }

  private unsubscribe: (() => void) | null = null;

  init(ctx: SimContext): void {
    this.ctx = ctx;
    window.addEventListener('keydown', this.onKey, true);
    // A new flight: the stations have not heard from it yet.
    this.unsubscribe = ctx.events.on('reset', () => {
      this.contacted.clear();
      this.pending = null;
      this.landedAt = null;
      this.airborneFor = 0;
      this.intent = this.landingIntent = null;
      this.vacateGiven = true;
      this.handover = null;
      this.hide();
    });
  }

  dispose(): void {
    this.unsubscribe?.();
    window.removeEventListener('keydown', this.onKey, true);
    this.menu.root.remove();
  }

  private get speech() {
    return this.deps.training.speech;
  }

  /** The COM the MIC is on (COM1 on a panel with one). */
  private mic(): ComRadio {
    return this.deps.comRadios?.() === 2 ? radioTuning().mic : 1;
  }

  /** The active frequency transmitted and listened on, MHz. */
  private frequency(): number {
    return (this.mic() === 1 ? radioTuning().com1 : radioTuning().com2)[0];
  }

  private hide(): void {
    this.mode = null;
    this.menu.hide();
  }

  /** The station COM1 reaches now, or null (no power, nothing on the frequency, out of range). */
  private reachable(): Station | null {
    if (!this.deps.readings().avionicsPowered) return null;
    const st = this.ctx.state;
    const station = stationOn(this.frequency(), st.position.x, st.position.y);
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
    if (this.deps.blocked?.()) {
      if (this.mode) this.hide();
      return;
    }
    if (e.code === 'Space') {
      if (this.mode === 'calls') this.hide();
      else this.openMenu();
    } else if (e.code === 'KeyR' && !e.shiftKey) {
      if (this.mode === 'tune') this.hide();
      else this.openTune();
    } else if (this.mode && e.code === 'Escape') {
      this.hide();
    } else if (this.mode === 'calls' && /^(Digit|Numpad)[1-9]$/.test(e.code)) {
      this.transmit(Number(e.code.slice(-1)) - 1);
    } else if (this.mode === 'tune' && /^(Digit|Numpad)[0-9]$|^Key[SC]$/.test(e.code)) {
      const k = e.code.slice(-1);
      this.tuneItems.find((i) => i.key === k)?.run();
    } else return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };

  private openMenu(): void {
    this.mode = 'calls';
    this.refresh = 0;
    this.updateMenu();
  }

  private openTune(): void {
    this.mode = 'tune';
    this.refresh = 0;
    this.updateTune();
  }

  /** The radio window: the stations nearest first (a handover on top), then the flip-flop, the MIC and say again. */
  private updateTune(): void {
    const t = radioTuning();
    const n = this.mic();
    const two = this.deps.comRadios?.() === 2;
    const com = n === 1 ? t.com1 : t.com2;
    const st = this.ctx.state;
    const items: TuneItem[] = [];
    const tune = (f: number): void => {
      tuneCom(n, f);
      this.deps.toast?.(`COM${n} ${f.toFixed(3)}`);
      this.hide();
    };
    const near = stations()
      .map((s) => ({ s, d: Math.hypot(s.field.north - st.position.x, s.field.east - st.position.y) }))
      .sort((a, b) => a.d - b.d);
    const h = this.handover;
    if (h) {
      const i = near.findIndex((x) => Math.abs(x.s.frequency - h.frequency) < 0.004);
      if (i > 0) near.unshift(...near.splice(i, 1));
    }
    for (const { s, d } of near.slice(0, 9)) {
      const brg = Math.round(((Math.atan2(s.field.east - st.position.y, s.field.north - st.position.x) * 180) / Math.PI + 360) % 360) || 360;
      const where = d < 1500 ? 'here' : `${(d / NM).toFixed(d < 10 * NM ? 1 : 0)} NM ${String(brg).padStart(3, '0')}°`;
      const range = d > radioRange(st.altitudeAGL) ? ' · out of range' : '';
      const handed = h && Math.abs(s.frequency - h.frequency) < 0.004 ? ' · as instructed' : '';
      items.push({ key: String(items.length + 1), label: `${stationLabel(s)} ${s.frequency.toFixed(3)}`, detail: `${where}${range}${handed}`, on: Math.abs(s.frequency - com[0]) < 0.004, run: () => tune(s.frequency) });
    }
    items.push({
      key: 'S', action: true, label: `Flip-flop COM${n}`, detail: `${com[1].toFixed(3)} active`,
      run: () => {
        swapCom(n);
        this.deps.toast?.(`COM${n} ${com[0].toFixed(3)}`);
        this.hide();
      },
    });
    if (two) {
      const other: ComRadio = n === 1 ? 2 : 1;
      const oc = other === 1 ? t.com1 : t.com2;
      items.push({
        key: 'C', action: true, label: `MIC to COM${other}`, detail: `Talk and listen on ${oc[0].toFixed(3)}`,
        run: () => {
          selectMic(other);
          this.updateTune();
        },
      });
    }
    if (this.deps.training.active) {
      items.push({
        key: '0', action: true, label: 'Say again', detail: 'The instructor repeats',
        run: () => {
          this.hide();
          this.deps.training.input('sayAgain');
        },
      });
    }
    this.tuneItems = items;
    const status = (two ? ([1, 2] as const) : ([1] as const)).map((c) => {
      const p = c === 1 ? t.com1 : t.com2;
      return { text: `COM${c} ${p[0].toFixed(3)} / ${p[1].toFixed(3)}${two && c === n ? ' MIC' : ''}`, on: c === n };
    });
    const power = this.deps.readings().avionicsPowered ? '' : 'The avionics are off. ';
    this.menu.show(`Radios · tuning COM${n}`, items, `${power}A number tunes COM${n} (the old frequency goes to standby). R or Esc closes.`, status, true);
  }

  private updateMenu(): void {
    const n = this.mic();
    const f = `COM${n} ${this.frequency().toFixed(3)}`;
    if (!this.deps.readings().avionicsPowered) {
      this.calls = [];
      this.menu.show(f, [], 'The radio is off: switch on the avionics master.');
      return;
    }
    const station = this.reachable();
    if (!station) {
      this.calls = [];
      const anyone = stationOn(this.frequency(), this.ctx.state.position.x, this.ctx.state.position.y);
      this.menu.show(f, [], anyone ? `${stationName(anyone.field)} is out of range.` : 'Nobody on this frequency. R tunes the radios.');
      return;
    }
    const s = (this.situation = this.situationNow(station));
    this.calls = callsFor(s).slice(0, 9);
    const who = stationLabel(station);
    const note = station.kind === 'atis' ? 'An information broadcast: listen, then tune the tower.' : station.kind === 'traffic' ? 'Uncontrolled: announce your position and intentions. Space or Esc closes.' : 'Space or Esc closes.';
    this.menu.show(`${f} · ${who}`, this.calls.map((c) => ({ label: c.label, detail: c.line.text })), note);
  }

  private transmit(i: number): void {
    const call = this.calls[i];
    const s = this.situation;
    if (!call || !s) return;
    this.hide();
    if (call.intent) this.intent = call.intent;
    this.speech.enqueue({ actor: 'student', channel: 'radio', caption: call.line.text, speak: call.line.speak, priority: Priority.Instruction, interrupt: false, resumable: false, ttlMs: 20000 });
    const reply = replyTo(s, call.id, call.intent);
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
      if (this.airborneFor > 10) {
        this.landedAt = this.simClock;
        this.landingIntent = this.intent;
        this.intent = null;
        this.vacateGiven = false;
      }
      this.airborneFor = 0;
    }
    if (this.deps.comRadios?.() === 1 && radioTuning().mic === 2) selectMic(1);
    if (this.handover && (this.simClock > this.handover.until || Math.abs(this.frequency() - this.handover.frequency) < 0.004)) this.handover = null;
    if (this.mode && (this.refresh -= dt) <= 0) {
      this.refresh = 0.5;
      if (this.mode === 'calls') this.updateMenu();
      else this.updateTune();
    }
    const p = this.pending;
    if (p && this.simClock >= p.at && !this.speech.busy('radio')) {
      this.pending = null;
      // Retuned or out of range since the call: the answer is not heard.
      const now = this.reachable();
      if (now && stationKey(now) === p.key) {
        this.contacted.add(p.key);
        this.speech.enqueue({ actor: p.actor, channel: 'radio', caption: p.text, speak: p.speak, priority: Priority.Instruction, interrupt: false, resumable: false, ttlMs: 20000 });
      }
    }
    this.updateVacate();
    this.hearTraffic();
    this.updateAtis();
  }

  /** The circuit traffic heard on COM1: tuned to its frequency, the avionics on, within line of sight. */
  private hearTraffic(): void {
    const calls = this.deps.traffic?.() ?? [];
    if (!calls.length || !this.deps.readings().avionicsPowered) return;
    const st = this.ctx.state;
    const f = this.frequency();
    for (const t of calls) {
      if (Math.abs(t.frequency - f) > 0.004) continue;
      if (Math.hypot(t.north - st.position.x, t.east - st.position.y) > radioRange(st.altitudeAGL, t.heightAgl)) continue;
      this.speech.enqueue({ actor: 'traffic', voice: t.speaker, channel: 'radio', caption: t.line.text, speak: t.line.speak, priority: Priority.Coach, interrupt: false, resumable: false, ttlMs: 8000 });
    }
  }

  /** Slowing on the home runway after a landing that was not a touch and go: the tower says where to turn off. */
  private updateVacate(): void {
    if (this.vacateGiven || this.landingIntent === 'touchAndGo' || this.landedAt === null) return;
    const st = this.ctx.state;
    if (!st.onGround || this.simClock - this.landedAt > 60) {
      this.vacateGiven = true;
      return;
    }
    if (st.groundSpeed / 0.514444 > 35 || this.pending || this.speech.busy('radio')) return;
    this.vacateGiven = true;
    const station = this.reachable();
    if (!station) return;
    const msg = vacateInstruction(this.situationNow(station));
    if (!msg) return;
    this.contacted.add(stationKey(station));
    if (station.kind === 'tower') this.handover = { frequency: HOME_GROUND, until: this.simClock + HANDOVER_S };
    this.speech.enqueue({ actor: 'tower', channel: 'radio', caption: msg.text, speak: msg.speak, priority: Priority.Instruction, interrupt: false, resumable: false, ttlMs: 20000 });
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

/** "Bramcombe Traffic", "Fairbanks Tower". */
function stationLabel(s: Station): string {
  return `${stationName(s.field)} ${s.kind === 'traffic' ? 'Traffic' : s.kind === 'atis' ? 'ATIS' : s.kind[0].toUpperCase() + s.kind.slice(1)}`;
}

function stationKey(s: Station): string {
  return `${s.field.code}:${s.kind}`;
}
