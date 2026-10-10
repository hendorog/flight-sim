// Visual equivalents of the warning sounds. Read physics flags, never AudioContext or mute state.
import type { AircraftState } from '../core/types';
import { el, setText } from './dom';

export function audibleWarnings(s: AircraftState): string[] {
  const out: string[] = [];
  if (s.rotorcraft) {
    if (s.rotorcraft.lowRpmHorn) out.push('LOW ROTOR RPM · Lower collective; restore RPM');
    else if (s.rotorcraft.lowRpmLight) out.push('LOW ROTOR RPM · warning light');
  } else if (s.stallWarning) out.push('STALL WARNING · Reduce angle of attack');
  if (s.gear?.warning) out.push('GEAR WARNING · Check gear down and locked');
  return out;
}

export class FlightCues {
  readonly root: HTMLElement;
  private readonly warnings: HTMLElement;
  private readonly latest: HTMLElement;
  private readonly history: HTMLElement;
  private active: string[] = [];
  private log: string[] = [];
  private last = '';

  constructor(parent: HTMLElement) {
    this.root = el('section', 'flight-cues', parent);
    this.root.setAttribute('aria-label', 'Flight captions');
    this.warnings = el('div', 'flight-warnings', this.root, 'No active warnings');
    this.warnings.setAttribute('role', 'alert');
    this.latest = el('div', 'flight-cue-latest', this.root);
    this.latest.setAttribute('role', 'status');
    const details = el('details', '', this.root);
    el('summary', '', details, 'Flight cue history');
    this.history = el('div', 'flight-cue-log', details);
    el('div', '', this.history, 'Switch changes and warnings will appear here.');
    this.root.addEventListener('pointerdown', e => e.stopPropagation());
    this.root.addEventListener('keydown', e => { if (e.code === 'Enter' || e.code === 'Space') e.stopPropagation(); });
  }
  say(text: string): void {
    setText(this.latest, text);
    if (this.last === text) return;
    this.last = text; this.record(text);
  }
  update(s: AircraftState, hidden: boolean): void {
    this.root.classList.toggle('hidden', hidden);
    const active = audibleWarnings(s);
    for (const line of active) if (!this.active.includes(line)) this.record(line);
    for (const line of this.active) if (!active.includes(line)) this.record(`Cleared: ${line.split(' · ')[0]}`);
    this.active = active;
    setText(this.warnings, active.join('\n') || 'No active warnings');
    this.warnings.classList.toggle('warning', active.length > 0);
  }
  reset(): void { this.active = []; this.log = []; this.last = ''; this.latest.textContent = ''; this.history.replaceChildren(); }
  private record(text: string): void {
    this.log.push(text); if (this.log.length > 20) this.log.shift();
    this.history.replaceChildren();
    for (const line of this.log.slice().reverse()) el('div', '', this.history, line);
  }
}

export const FLIGHT_CUES_CSS = /* css */ `
#fsui .flight-cues { position:absolute;left:14px;bottom:14px;width:min(350px,calc(100vw - 28px));background:rgba(10,17,24,.92);border:1px solid #435969;border-radius:7px;padding:7px 10px;font:12px/1.4 system-ui;color:#c7d4de;pointer-events:auto; }
#fsui .flight-warnings { white-space:pre-line;font-weight:650; }
#fsui .flight-warnings.warning { color:#ffd1a3; }
#fsui .flight-cue-latest { color:#eef3f8; }
#fsui .flight-cues summary { cursor:pointer;font-size:11px;color:#9edcff;margin-top:3px; }
#fsui .flight-cue-log { max-height:160px;overflow:auto;overscroll-behavior:contain; }
#fsui .flight-cue-log div { padding:5px 0;border-top:1px solid #ffffff1a; }
`;
