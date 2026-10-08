// Live demonstration captions and a small rolling trace. Flight School's debrief graph stores fixed
// airplane channels and a fixed time domain; share its scales/ticks, without altering saved school traces.
import { FT, KT } from '../core/math';
import type { AircraftState, ControlInputs } from '../core/types';
import { DEMO_TITLES, type R22Flight, type DemoSample } from '../sim/rotorcraft/flights';
import { observePilot } from '../sim/rotorcraft/scriptedPilot';
import { el, setText } from './dom';
import { linearScale, niceTicks } from './school/format';

export class RotorcraftDemoUi {
  readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly phase: HTMLElement;
  private readonly action: HTMLElement;
  private readonly rpm: HTMLElement;
  private readonly readings: HTMLElement;
  private readonly controls: HTMLElement;
  private readonly note: HTMLElement;
  private readonly graph: HTMLCanvasElement;
  private readonly details: HTMLDetailsElement;
  private lastSample = -1;
  private flight: R22Flight | null = null;
  private handoverAt = Infinity;

  constructor(parent: HTMLElement, takeControl: () => void) {
    this.root = el('section', 'r22-demo hidden', parent);
    this.root.style.cssText = 'position:absolute;top:74px;left:16px;width:min(480px,calc(100vw - 32px));padding:12px 16px;box-sizing:border-box;background:rgba(10,17,24,.91);border:1px solid #435969;border-radius:8px;color:#eef3f8;font:13px/1.4 system-ui;pointer-events:auto';
    this.title = el('div', '', this.root);
    this.title.style.cssText = 'font-size:11px;letter-spacing:.09em;color:#9aa8b6;text-transform:uppercase';
    this.phase = el('strong', '', this.root);
    this.phase.style.cssText = 'display:block;font-size:18px;margin-top:3px';
    this.action = el('div', '', this.root);
    this.action.setAttribute('role', 'status');
    this.action.setAttribute('aria-live', 'polite');
    this.rpm = el('div', '', this.root);
    this.rpm.style.cssText = 'font-size:21px;font-weight:700;margin-top:8px;font-variant-numeric:tabular-nums';
    this.readings = el('div', '', this.root);
    this.readings.style.fontVariantNumeric = 'tabular-nums';
    this.controls = el('div', '', this.root);
    this.controls.style.cssText = 'font:11px/1.6 ui-monospace,monospace;margin:6px 0;color:#b9c9d6';
    this.note = el('div', '', this.root);
    this.note.style.cssText = 'font-size:11px;color:#ffcf85;margin:5px 0';
    const buttons = el('div', '', this.root);
    const take = el('button', '', buttons, 'Take control · Enter');
    take.addEventListener('click', () => { takeControl(); take.blur(); });
    const hints = el('span', '', buttons, '  P pause · Shift+[ / ] rate · C view');
    hints.style.cssText = 'font-size:10px;color:#9aa8b6';
    this.details = el('details', '', this.root);
    el('summary', '', this.details, 'Live trace · last 60 seconds');
    this.details.style.cssText = 'margin-top:7px;font-size:11px';
    this.graph = el('canvas', '', this.details);
    this.graph.style.cssText = 'display:block;width:100%;height:200px';
    this.graph.setAttribute('aria-label', 'Rotor RPM, indicated airspeed, vertical speed and skid height over the last 60 seconds');
    this.details.addEventListener('toggle', () => { this.lastSample = -1; });
  }

  show(flight: R22Flight, trace: boolean): void {
    this.flight = flight;
    this.handoverAt = Infinity;
    this.lastSample = -1;
    this.details.open = trace || flight.id === 'autorotation';
    this.root.classList.remove('hidden');
  }

  hide(): void { this.flight = null; this.root.classList.add('hidden'); }

  update(s: AircraftState, c: ControlInputs, hidden: boolean): void {
    const f = this.flight;
    if (f?.outcome === 'taken-over') {
      if (!Number.isFinite(this.handoverAt)) this.handoverAt = performance.now();
      if (performance.now() - this.handoverAt > 2500) { this.hide(); return; }
    }
    this.root.classList.toggle('hidden', !f || hidden);
    if (!f || hidden) return;
    const p = observePilot(s);
    setText(this.title, `R22 demonstration · ${DEMO_TITLES[f.id]} · ${f.time.toFixed(1)} s`);
    const outcome = f.outcome === 'complete' ? 'Finished · paused' : f.outcome === 'taken-over' ? 'You have control' :
      f.outcome === 'crashed' ? 'Stopped · aircraft damaged' : f.outcome === 'timeout' ? 'Stopped · time limit reached' : '';
    setText(this.phase, outcome || f.phase[0].toUpperCase() + f.phase.slice(1));
    setText(this.action, f.outcome === 'taken-over' ? 'Demo released; controls remain at their current positions.' : f.action);
    setText(this.rpm, `ROTOR ${p.rotorPercent.toFixed(1)}%`);
    this.rpm.style.color = p.rotorPercent < 90 && !s.onGround && s.engine.rpm > 0 || f.id === 'autorotation' && p.rotorPercent < 90 ? '#ff8b79' : '#eef3f8';
    setText(this.readings, `${(s.ias / KT).toFixed(1)} KIAS  ·  ${Math.round(s.verticalSpeed / .00508)} ft/min  ·  ${(p.height / FT).toFixed(1)} ft skids AGL`);
    setText(this.controls, `COL ${((c.collective ?? 0) * 100).toFixed(0)}%  GRIP ${(c.throttle * 100).toFixed(0)}%  CYCLIC aft ${c.elevator.toFixed(2)} right ${c.aileron.toFixed(2)}  PEDAL ${c.rudder.toFixed(2)}`);
    setText(this.note, f.id === 'autorotation' ? '60 ft progressive flare; level at 8 ft; cushion at 2 ft. Known gap: sink and speed remain too high at impact. Entry starts with collective down and mixture cut.' : 'Scripted engineering flight · calm air · maximum gross loading');
    if (this.details.open && this.lastSample !== f.samples.length) {
      this.draw(f.samples); this.lastSample = f.samples.length;
    }
  }

  private draw(samples: readonly DemoSample[]): void {
    const g = this.graph.getContext('2d')!, w = Math.max(300, this.graph.clientWidth), h = 200;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.graph.width = w * dpr; this.graph.height = h * dpr; g.scale(dpr, dpr);
    const end = samples.at(-1)?.time ?? 0, start = Math.max(0, end - 60), x = linearScale(start, Math.max(60, end), 94, w - 5);
    const points = samples.filter(p => p.time >= start);
    const strips: { label: string; read(p: DemoSample): number; range: [number, number] }[] = [
      { label: 'NR %', read: p => p.rpm, range: [90, 110] },
      { label: 'KIAS', read: p => p.kias, range: [0, 90] },
      { label: 'ft/min', read: p => p.vs / .00508, range: [-2000, 600] },
      { label: 'ft AGL', read: p => p.height / FT, range: [0, 30] },
    ];
    strips.forEach((strip, i) => {
      const values = points.map(strip.read), lo = Math.min(strip.range[0], ...values), hi = Math.max(strip.range[1], ...values);
      const y = linearScale(lo, hi, i * 46 + 42, i * 46 + 5);
      g.font = '10px system-ui'; g.fillStyle = '#eef3f8'; g.fillText(strip.label, 0, i * 46 + 13);
      g.fillStyle = '#9aa8b6';
      for (const tick of niceTicks(lo, hi, 2)) {
        g.textAlign = 'right'; g.fillText(String(Math.round(tick)), 84, y(tick) + 4); g.textAlign = 'left';
        g.strokeStyle = '#34424d'; g.beginPath(); g.moveTo(94, y(tick)); g.lineTo(w, y(tick)); g.stroke();
      }
      g.strokeStyle = i === 0 ? '#ffcf85' : '#52c3ff'; g.lineWidth = 1.5; g.beginPath();
      points.forEach((p, n) => { if (n === 0) g.moveTo(x(p.time), y(strip.read(p))); else g.lineTo(x(p.time), y(strip.read(p))); });
      g.stroke();
    });
    g.fillStyle = '#9aa8b6'; g.fillText(`${start.toFixed(0)} s`, 94, h - 2); g.fillText(`${Math.max(60, end).toFixed(0)} s`, w - 37, h - 2);
  }
}
