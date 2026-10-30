// The radio (docs/atc.md, step 2): Space opens the push-to-talk menu of the calls that fit the moment (calls.ts) on
// the station the MIC's COM is tuned to (COM1 unless the audio panel is on COM2); a pick goes out as a captioned transmission on the speech scheduler's radio channel,
// and the home tower or ground answers a moment later. Tuned to the home ATIS, the broadcast repeats while in range.
// Nothing is heard with the avionics off or out of radio range. Runs only where the Flight School does (it owns the
// speech scheduler and the captions). R opens the radio window: the nearby stations to tune with one key (the one a
// controller just handed over to first), the flip-flop, the MIC selector and, in a lesson, the instructor's say again;
// Tab turns it to the NAV page: the nearby ILSs and VORs, the NAV flip-flop and which NAV receiver is tuned.
// Readbacks (step 4): a clearance from the tower or ground puts its readback first in the Space menu; one that
// must be read back and is not, within READBACK_S, brings a prompt. "Say again" has the last message repeated.

import type { SimContext, Subsystem } from '../core/context';
import { Priority, type ActorId } from '../training/types';
import type { TrainingSystem } from '../training/TrainingSystem';
import type { InstrumentReadings } from '../instruments/dynamics/instrumentSet';
import { HOME_GROUND, radioTuning, selectCdi, selectMic, setTransmitting, stationOn, stations, swapCom, swapNav, tuneCom, tuneNav, type ComRadio, type Station } from '../instruments/dynamics/radios';
import { emptyNavSignal, navaids, receiveNav } from '../instruments/dynamics/navigation';
import { RadioMenu, type RadioMenuItem } from '../ui/radioMenu';
import { HOME_AIRFIELD } from '../world/airfields';
import { atisText, callsFor, mustReadBack, readbackFor, replyTo, stationName, vacateInstruction, vacateReadback, type Call, type CallId, type Intent, type RadioSituation } from './calls';
import { both, callsign, join, type Phrase } from './phrases';
import type { Transmission } from './TrafficSystem';
import type { TowerReply } from './tower';

/** The answer follows the call after this long, s of sim time. */
const REPLY_DELAY = 1.6;
/** The ATIS repeats after this long once it has finished, s of wall time. */
const ATIS_GAP_MS = 4000;
/** Ground station antenna height, m. */
const ANTENNA = 10;
/** A handover ("contact Ground 121.9") stays first in the radio window for this long, s of sim time. */
const HANDOVER_S = 180;
/** A clearance not read back after this long brings the controller's prompt, s of sim time; the readback is offered for READBACK_KEEP_S. */
const READBACK_S = 15;
const READBACK_KEEP_S = 60;
/** "Say again" is offered for this long after a message to this aircraft, s. */
const SAY_AGAIN_S = 60;
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
  /** One course indicator and two NAVs (InstrumentPanel.cdiSelect): the NAV page's C switches its source. */
  cdiSelect?: () => boolean;
  /** A short confirmation over the flight view. */
  toast?: (text: string) => void;
  /** A menu or dialog has the keys: Space and R are left to it. */
  blocked?: () => boolean;
  /** The home tower's sequencing answer to a call (TrafficSystem.towerReply); null: calls.ts replyTo answers. */
  towerReply?: (call: CallId, intent?: Intent) => TowerReply | null;
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
  /** The radio window's page, and the NAV receiver its NAV page tunes. */
  private page: 'com' | 'nav' = 'com';
  private navSel: ComRadio = 1;
  private readonly navProbe = emptyNavSignal();
  /** The frequency a controller last handed this aircraft to, until the sim time given. */
  private handover: { frequency: number; until: number } | null = null;
  private situation: RadioSituation | null = null;
  /** Stations that have answered this aircraft (by frequency and field): the abbreviated callsign from then on. */
  private readonly contacted = new Set<string>();
  private pending: { at: number; actor: ActorId; text: string; speak: string; key: string; readback?: Phrase } | null = null;
  /** What the pilot should read back of the last clearance, to whom, and whether it has been asked for. */
  private readback: { line: Phrase; key: string; at: number; prompted: boolean } | null = null;
  /** The last message to this aircraft, for say again. */
  private lastToMe: { actor: ActorId; line: Phrase; key: string; at: number; readback?: Phrase } | null = null;
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
      this.readback = this.lastToMe = null;
      this.hide();
    });
  }

  dispose(): void {
    setTransmitting(false);
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
    } else if (this.mode === 'tune' && e.code === 'Tab') {
      this.turnPage();
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
    if (this.page === 'nav') return this.updateNav();
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
    items.push({ key: 'Tab', action: true, label: 'NAV page', detail: 'ILS and VOR', run: () => this.turnPage() });
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
    this.menu.show(`Radios · tuning COM${n}`, items, `${power}A number tunes COM${n} (the old frequency goes to standby). Tab: NAV. R or Esc closes.`, status, true);
  }

  private turnPage(): void {
    this.page = this.page === 'com' ? 'nav' : 'com';
    this.updateTune();
  }

  /** The radio window's NAV page: the ILSs and VORs nearest first, the flip-flop, NAV1 or NAV2. */
  private updateNav(): void {
    const t = radioTuning();
    const two = this.deps.comRadios?.() === 2;
    const select = two && (this.deps.cdiSelect?.() ?? false);
    // One indicator: the NAV tuned is the one it shows.
    if (!two) this.navSel = 1;
    else if (select) this.navSel = t.cdi;
    const n = this.navSel;
    const nav = n === 1 ? t.nav1 : t.nav2;
    const st = this.ctx.state;
    const items: TuneItem[] = [];
    const near = navaids()
      .map((a) => ({ a, d: Math.hypot(a.north - st.position.x, a.east - st.position.y) }))
      .sort((x, y) => x.d - y.d);
    for (const { a, d } of near.slice(0, 9)) {
      const brg = Math.round(((Math.atan2(a.east - st.position.y, a.north - st.position.x) * 180) / Math.PI + 360) % 360) || 360;
      const where = d < 1500 ? 'here' : `${(d / NM).toFixed(d < 10 * NM ? 1 : 0)} NM ${String(brg).padStart(3, '0')}°`;
      const heard = receiveNav(a.frequency, st.position, this.navProbe).locValid ? '' : ' · no signal here';
      items.push({
        key: String(items.length + 1), label: `${a.name} ${a.frequency.toFixed(2)}`, detail: `${a.ident} · ${where}${heard}`,
        on: Math.abs(a.frequency - nav[0]) < 0.004,
        run: () => {
          tuneNav(n, a.frequency);
          this.deps.toast?.(`NAV${n} ${a.frequency.toFixed(2)} ${a.ident}`);
          this.hide();
        },
      });
    }
    items.push({
      key: 'S', action: true, label: `Flip-flop NAV${n}`, detail: `${nav[1].toFixed(2)} active`,
      run: () => {
        swapNav(n);
        this.deps.toast?.(`NAV${n} ${nav[1].toFixed(2)}`);
        this.hide();
      },
    });
    if (two) {
      const other: ComRadio = n === 1 ? 2 : 1;
      const on = other === 1 ? t.nav1 : t.nav2;
      items.push({
        key: 'C', action: true, label: select ? `CDI to NAV${other}` : `Tune NAV${other}`, detail: `${on[0].toFixed(2)} active`,
        run: () => {
          this.navSel = other;
          if (select) {
            selectCdi(other);
            this.deps.toast?.(`CDI on NAV${other}`);
          }
          this.updateTune();
        },
      });
    }
    items.push({ key: 'Tab', action: true, label: 'COM page', detail: 'Stations to talk to', run: () => this.turnPage() });
    this.tuneItems = items;
    const status = (two ? ([1, 2] as const) : ([1] as const)).map((c) => {
      const p = c === 1 ? t.nav1 : t.nav2;
      const cdi = select && t.cdi === c ? ' CDI' : '';
      return { text: `NAV${c} ${p[0].toFixed(2)} / ${p[1].toFixed(2)}${cdi}`, on: c === n };
    });
    const power = this.deps.readings().avionicsPowered ? '' : 'The avionics are off. ';
    this.menu.show(`Radios · tuning NAV${n}`, items, `${power}A number tunes NAV${n} (the old frequency goes to standby). Tab: COM. R or Esc closes.`, status, true);
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
    const key = stationKey(station);
    const extra: Call[] = [];
    // The readback first, then say again, while they are for this station.
    if (this.readback?.key === key) extra.push({ id: 'readback', label: 'Read back', line: this.readback.line });
    if (this.lastToMe?.key === key && this.simClock - this.lastToMe.at < SAY_AGAIN_S) {
      extra.push({ id: 'sayAgain', label: 'Say again', line: join([both(stationLabel(station)), s.callsign.short, both('say again')]) });
    }
    this.calls = [...extra, ...callsFor(s)].slice(0, 9);
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
    const key = stationKey(s.station);
    if (call.id === 'readback') {
      this.readback = null;
      return;
    }
    if (call.id === 'sayAgain') {
      const last = this.lastToMe;
      if (last) this.pending = { at: this.simClock + REPLY_DELAY, actor: last.actor, text: last.line.text, speak: last.line.speak, key, readback: last.readback };
      return;
    }
    const tower = s.station.kind === 'tower' && s.station.field.kind === 'home' ? this.deps.towerReply?.(call.id, call.intent) : null;
    const reply = tower?.line ?? replyTo(s, call.id, call.intent);
    if (reply) {
      const actor: ActorId = s.station.kind === 'ground' ? 'ground' : 'tower';
      const readback = (tower ? tower.readback : readbackFor(s, call.id, call.intent)) ?? undefined;
      this.pending = { at: this.simClock + REPLY_DELAY, actor, text: reply.text, speak: reply.speak, key, readback };
    }
  }

  /** A message to this aircraft has gone out: say again repeats it; a clearance waits for its readback. */
  private toMe(actor: ActorId, line: Phrase, key: string, readback?: Phrase): void {
    this.contacted.add(key);
    this.lastToMe = { actor, line, key, at: this.simClock, readback };
    this.readback = readback ? { line: readback, key, at: this.simClock, prompted: false } : null;
    this.speech.enqueue({ actor, channel: 'radio', caption: line.text, speak: line.speak, priority: Priority.Instruction, interrupt: false, resumable: false, ttlMs: 20000 });
  }

  /** The controller asks once for a clearance that has not been read back; the readback is dropped after a while. */
  private updateReadback(): void {
    const r = this.readback;
    if (!r) return;
    if (this.simClock - r.at > READBACK_KEEP_S) {
      this.readback = null;
      return;
    }
    if (r.prompted || this.simClock - r.at < READBACK_S || !mustReadBack(r.line) || this.pending || this.speech.busy('radio')) return;
    r.prompted = true;
    const station = this.reachable();
    if (!station || stationKey(station) !== r.key) return;
    const s = this.situationNow(station);
    const actor: ActorId = station.kind === 'ground' ? 'ground' : 'tower';
    const line = join([s.callsign.short, both('read back')]);
    this.speech.enqueue({ actor, channel: 'radio', caption: line.text, speak: line.speak, priority: Priority.Instruction, interrupt: false, resumable: false, ttlMs: 20000 });
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
    // The radios' TX annunciator while the pilot's call is going out.
    setTransmitting(this.speech.speaking('student', 'radio'));
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
      if (now && stationKey(now) === p.key) this.toMe(p.actor, { text: p.text, speak: p.speak }, p.key, p.readback);
    }
    this.updateVacate();
    this.updateReadback();
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
      if (t.actor === 'tower') {
        // The home tower, to the circuit traffic or to the player (who is then in contact).
        if (t.toPlayer) this.toMe('tower', t.line, `${HOME_AIRFIELD.code}:tower`, t.readback);
        else this.speech.enqueue({ actor: 'tower', channel: 'radio', caption: t.line.text, speak: t.line.speak, priority: Priority.Coach, interrupt: false, resumable: false, ttlMs: 8000 });
      } else this.speech.enqueue({ actor: 'traffic', voice: t.speaker, channel: 'radio', caption: t.line.text, speak: t.line.speak, priority: Priority.Coach, interrupt: false, resumable: false, ttlMs: 8000 });
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
    const s = this.situationNow(station);
    const msg = vacateInstruction(s);
    if (!msg) return;
    if (station.kind === 'tower') this.handover = { frequency: HOME_GROUND, until: this.simClock + HANDOVER_S };
    this.toMe('tower', msg, stationKey(station), vacateReadback(s) ?? undefined);
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
