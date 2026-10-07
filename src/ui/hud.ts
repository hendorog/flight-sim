// Minimal flight HUD for external views: speed and altitude tapes, heading tape, vertical speed, engine and
// control positions, load factor, wind, and brake / stall / gear / overspeed annunciations. Drawn with three
// small 2D canvases (tapes) plus a handful of DOM text nodes that are only touched when their text changes.
//
// What depends on the type comes from HudAircraft (setAircraft; default the Cessna 172S): the lever bars and
// engine read-outs of its UiProfile, the speed-tape bands of its reference speeds, the AGL read-out above its
// resting height, and the gear, carburettor-heat and flap / gear overspeed chips.

import { C172S_GEOMETRY } from '../aircraft/c172s/geometry';
import { C172S_REFERENCE } from '../aircraft/c172s/reference';
import { C172S_CONTROLS, C172S_LIMITS } from '../aircraft/c172s/systems';
import { C172S_UI } from '../aircraft/c172s/ui';
import type { LimitsDef, ReferenceSpeeds, UiProfile } from '../aircraft/types';
import type { SimContext } from '../core/context';
import { FT, FPM, KT, RAD, wrapTwoPi } from '../core/math';
import { lagStep } from '../instruments/dynamics/filters';
import { el, hiDpiCanvas, setText } from './dom';
import { carbHeatOn, flapLimitCas, gearCue, gearLimitCas, OverspeedTimer, speedBands, speedLines, type SpeedBand, type SpeedLine } from './hudCues';
import { applyParkingCue, CRASHED_CUE, parkingBrakeCue } from './status';

/** What the HUD needs to know about the type flown. */
export interface HudAircraft {
  ui: UiProfile;
  reference: ReferenceSpeeds;
  /** Height of the reference point above the ground at rest, m (the AGL read-out is above the wheels). */
  restHeight: number;
  limits: LimitsDef;
  /** Flap detent deflections, rad (ControlSystemDef.flaps.detents). */
  flapDetents: readonly number[];
  engines: number;
  /** The type has carburettor heat (the CARB HEAT chip). */
  carbHeat: boolean;
}

export const C172S_HUD: HudAircraft = {
  ui: C172S_UI,
  reference: C172S_REFERENCE,
  restHeight: C172S_GEOMETRY.restHeight,
  limits: C172S_LIMITS,
  flapDetents: C172S_CONTROLS.flaps.detents,
  engines: 1,
  carbHeat: false,
};

type HudLever = UiProfile['hud']['levers'][number];
type HudReadout = UiProfile['hud']['readouts'][number];
/** More rows than this in the lever / read-out block: the compact layout. */
const COMPACT_ROWS = 6;
const LEVER_CLASS: Record<NonNullable<HudLever['style']>, string> = { fill: '', mixture: 'mix', marker: 'trim' };

const SPD_W = 88;
const ALT_W = 104;
const TAPE_H = 320;
const HDG_W = 420;
const HDG_H = 46;
const WHITE = '#f2f6fa';
/** Half height of the value box plus half a label: scale labels closer than this to the centre are hidden. */
const BOX_CLEAR = 15 + 8;

export class Hud {
  readonly root: HTMLDivElement;
  private readonly spd: CanvasRenderingContext2D;
  private readonly alt: CanvasRenderingContext2D;
  private readonly hdg: CanvasRenderingContext2D;
  private readonly gs: HTMLElement;
  private readonly agl: HTMLElement;
  private readonly vs: HTMLElement;
  private readonly g: HTMLElement;
  private readonly annunc: HTMLElement;
  private readonly chips: Record<'stall' | 'park' | 'brake' | 'crash' | 'gear' | 'carb' | 'flapSpeed' | 'gearSpeed', HTMLElement>;
  private readonly controls: HTMLElement;
  private levers: { def: HudLever; fill: HTMLElement; value: HTMLElement }[] = [];
  private readouts: { def: HudReadout; value: HTMLElement }[] = [];
  private aircraft: HudAircraft;
  private bands: SpeedBand[] = [];
  private lines: SpeedLine[] = [];
  private flapOverspeed!: OverspeedTimer;
  private gearOverspeed!: OverspeedTimer;
  private readonly windArrow: SVGGElement;
  private readonly windText: HTMLElement;
  /** Last drawn tape values (quantised to a fraction of a pixel): skip redraws when nothing moved. */
  private drawn = { spd: NaN, alt: NaN, hdg: NaN, trk: NaN, moving: false };
  private windN = 0;
  private windE = 0;
  /** False until the first update: the smoothed wind then starts at the actual wind, not at calm. */
  private windPrimed = false;

  constructor(parent: HTMLElement, aircraft: HudAircraft = C172S_HUD) {
    this.aircraft = aircraft;
    const root = (this.root = el('div', 'hud', parent));
    this.spd = hiDpiCanvas(root, SPD_W, TAPE_H, 'spd');
    this.alt = hiDpiCanvas(root, ALT_W, TAPE_H, 'alt');
    this.hdg = hiDpiCanvas(root, HDG_W, HDG_H, 'hdg');
    const readout = (cls: string, label: string): HTMLElement => {
      const r = el('div', `readout ${cls}`, root, label);
      return el('b', 'num', r);
    };
    this.gs = readout('gs', 'GS');
    this.agl = readout('agl', 'AGL');
    this.vs = readout('vs', 'VS');
    this.g = readout('g', 'LOAD');
    this.annunc = el('div', 'annunc', root);
    this.chips = {
      stall: el('div', 'chip alert hidden', this.annunc, 'STALL'),
      park: el('div', 'chip warn hidden', this.annunc, 'PARKING BRAKE'),
      brake: el('div', 'chip warn hidden', this.annunc, 'BRAKES'),
      crash: el('div', 'chip alert hidden', this.annunc, CRASHED_CUE),
      gear: el('div', 'chip hidden', this.annunc),
      carb: el('div', 'chip info hidden', this.annunc, 'CARB HEAT'),
      flapSpeed: el('div', 'chip warn hidden', this.annunc, 'FLAP SPEED'),
      gearSpeed: el('div', 'chip warn hidden', this.annunc, 'GEAR SPEED'),
    };

    this.controls = el('div', 'controls', root);
    this.buildControls(aircraft.ui);
    this.configure(aircraft);

    const wind = el('div', 'wind', root);
    wind.innerHTML = `<svg viewBox="-22 -22 44 44"><circle r="20" fill="none" stroke="rgba(255,255,255,.25)"/>
      <path d="M0 -20 L0 -16" stroke="#fff" stroke-width="1.5"/>
      <g><path d="M0 -13 L0 11 M-5 5 L0 12 L5 5" stroke="#52c3ff" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g></svg>`;
    this.windArrow = wind.querySelector('g')!;
    this.windText = el('div', 't', wind);
  }

  set visible(v: boolean) {
    this.root.classList.toggle('hidden', !v);
  }

  /** The type flown: rebuilds the lever bars when its UiProfile differs, and redraws the speed tape. */
  setAircraft(aircraft: HudAircraft): void {
    if (aircraft.ui !== this.aircraft.ui) this.buildControls(aircraft.ui);
    this.aircraft = aircraft;
    this.configure(aircraft);
    this.drawn.spd = NaN;
  }

  private configure(a: HudAircraft): void {
    this.bands = speedBands(a.reference);
    this.lines = speedLines(a.reference);
    this.flapOverspeed = new OverspeedTimer(a.limits.flapOverspeed);
    this.gearOverspeed = new OverspeedTimer(a.limits.gearOverspeed);
  }

  /** One bar per lever (label, bar, value) and one row per read-out (label, -, value) in the controls grid. */
  private buildControls(ui: UiProfile): void {
    const controls = this.controls;
    controls.replaceChildren();
    controls.classList.toggle('compact', ui.hud.levers.length + ui.hud.readouts.length > COMPACT_ROWS);
    this.levers = ui.hud.levers.map((def) => {
      el('span', '', controls, def.label);
      const b = el('div', `bar ${LEVER_CLASS[def.style ?? 'fill']}`, controls);
      const fill = el('i', '', b);
      const value = el('span', 'v num', controls);
      return { def, fill, value };
    });
    this.readouts = ui.hud.readouts.map((def) => {
      el('span', '', controls, def.label);
      el('span', '', controls);
      return { def, value: el('span', 'v num', controls) };
    });
  }

  private offset = 0;

  /**
   * Pushes the top-centre elements (heading tape, annunciator row) down by `px`, clear of the Flight School
   * lesson strip; 0 restores them. Only touches the DOM when the value changes.
   */
  set topOffset(px: number) {
    if (px === this.offset) return;
    this.offset = px;
    const hdg = this.hdg.canvas;
    hdg.style.transform = px ? `translateY(${px}px)` : '';
    this.annunc.style.transform = px ? `translate(-50%, ${px}px)` : '';
  }

  update(dt: number, ctx: SimContext): void {
    const s = ctx.state;
    const c = ctx.controls;
    const iasKt = s.ias / KT;
    const d = this.drawn;
    const spd = Math.round(iasKt * 20) / 20;
    if (spd !== d.spd) this.drawSpeedTape((d.spd = spd));
    const alt = Math.round((s.altitudeMSL / FT) * 2) / 2;
    if (alt !== d.alt) this.drawAltTape((d.alt = alt));
    const hdg = Math.round(s.heading * RAD * 20) / 20;
    const trk = Math.round(s.track * RAD * 4) / 4;
    const moving = s.groundSpeed > 2;
    if (hdg !== d.hdg || (moving && trk !== d.trk) || moving !== d.moving) {
      d.hdg = hdg;
      d.trk = trk;
      d.moving = moving;
      this.drawHeadingTape(hdg, trk, moving);
    }

    setText(this.gs, `${Math.round(s.groundSpeed / KT)} kt`);
    const a = this.aircraft;
    setText(this.agl, `${Math.round(Math.max(0, s.altitudeAGL - a.restHeight) / FT)} ft`);
    const vs = Math.round(s.verticalSpeed / FPM / 10) * 10;
    setText(this.vs, `${vs > 0 ? '▲' : vs < 0 ? '▼' : ''} ${Math.abs(vs)}`);
    setText(this.g, `${s.gLoad.toFixed(1)} g`);

    this.chips.stall.classList.toggle('hidden', !s.stallWarning);
    applyParkingCue(this.chips.park, parkingBrakeCue(c, s));
    this.chips.brake.classList.toggle('hidden', c.parkingBrake || Math.max(c.brakeLeft, c.brakeRight) < 0.05);
    this.chips.crash.classList.toggle('hidden', !s.crashed);
    const gear = gearCue(s.gear);
    this.chips.gear.classList.toggle('hidden', !gear);
    if (gear) {
      setText(this.chips.gear, gear.text);
      for (const level of ['ok', 'warn', 'alert'] as const) this.chips.gear.classList.toggle(level, gear.level === level);
    }
    this.chips.carb.classList.toggle('hidden', !(a.carbHeat && carbHeatOn(c, a.engines)));
    const flapSpeed = this.flapOverspeed.step(dt, s.ias, flapLimitCas(a.limits, a.flapDetents, s.surfaces.flaps));
    this.chips.flapSpeed.classList.toggle('hidden', !flapSpeed);
    const gearSpeed = this.gearOverspeed.step(dt, s.ias, gearLimitCas(a.limits, s.gear));
    this.chips.gearSpeed.classList.toggle('hidden', !gearSpeed);

    for (const l of this.levers) {
      const v = l.def.read(c, s);
      const text = l.def.text ? l.def.text(c, s) : `${Math.round(v * 100)}%`;
      if (l.def.style === 'marker') {
        l.fill.style.left = `${v * 100}%`;
        setText(l.value, text);
      } else setBar(l, v, text);
    }
    for (const r of this.readouts) setText(r.value, r.def.text(s));

    // Wind at the aircraft (includes gusts), smoothed over ~1 s so the arrow does not jitter.
    const w = ctx.env.wind(s.position, ctx.simTime);
    if (!this.windPrimed) {
      // Start from the actual wind (otherwise a paused start, freeze=1 or a resume reads CALM until it lags in).
      this.windN = w.x;
      this.windE = w.y;
      this.windPrimed = true;
    }
    this.windN = lagStep(this.windN, w.x, dt, 1);
    this.windE = lagStep(this.windE, w.y, dt, 1);
    const speed = Math.hypot(this.windN, this.windE) / KT;
    const from = wrapTwoPi(Math.atan2(-this.windE, -this.windN));
    // Arrow shows where the wind blows to, relative to the nose: a headwind points down, toward the tail.
    const rel = (from - s.heading) * RAD;
    this.windArrow.setAttribute('transform', `rotate(${rel.toFixed(1)})`);
    const gust = ctx.weather.gustKt > 0.5 ? ` G${Math.round(ctx.weather.windSpeedKt + ctx.weather.gustKt)}` : '';
    const text = speed < 0.5 ? 'CALM' : `${String(Math.round(from * RAD) % 360 || 360).padStart(3, '0')}° / ${Math.round(speed)} kt${gust}`;
    if (this.windText.dataset.v !== text) {
      this.windText.dataset.v = text;
      this.windText.innerHTML = `WIND<br><b class="num">${text}</b>`;
    }
  }

  private drawSpeedTape(kt: number): void {
    const g = this.spd;
    const pxPerKt = 4;
    const cy = TAPE_H / 2;
    g.clearRect(0, 0, SPD_W, TAPE_H);
    tapeBackground(g, SPD_W, TAPE_H);
    // Operating-speed bands along the right edge (the airspeed indicator's arcs of the type's reference speeds).
    const band = (from: number, to: number, color: string, x: number, w: number): void => {
      const y0 = cy - (to - kt) * pxPerKt;
      const y1 = cy - (from - kt) * pxPerKt;
      g.fillStyle = color;
      g.fillRect(x, Math.max(0, y0), w, Math.min(TAPE_H, y1) - Math.max(0, y0));
    };
    for (const b of this.bands) {
      if (b.inner) band(b.from, b.to, b.color, SPD_W - 11, 3);
      else band(b.from, b.to, b.color, SPD_W - 6, 4);
    }
    // A twin's blue line (Vyse) and red radial (Vmca): a mark across both band columns.
    for (const l of this.lines) {
      g.fillStyle = l.color;
      g.fillRect(SPD_W - 12, cy - (l.kias - kt) * pxPerKt - 1, 10, 2);
    }
    g.fillStyle = WHITE;
    g.strokeStyle = WHITE;
    g.font = '600 13px Inter, system-ui, sans-serif';
    g.textAlign = 'right';
    g.textBaseline = 'middle';
    const lo = Math.floor((kt - 45) / 5) * 5;
    for (let v = Math.max(0, lo); v <= kt + 45; v += 5) {
      const y = cy - (v - kt) * pxPerKt;
      const major = v % 10 === 0;
      g.fillRect(SPD_W - (major ? 22 : 16), y - 0.75, major ? 10 : 5, 1.5);
      // Labels that would sit under or at the edge of the value box are skipped, not overdrawn.
      if (major && Math.abs(y - cy) > BOX_CLEAR) g.fillText(String(v), SPD_W - 28, y);
    }
    valueBox(g, 4, cy, SPD_W - 18, String(Math.max(0, Math.round(kt))), 'right');
  }

  private drawAltTape(ft: number): void {
    const g = this.alt;
    const pxPerFt = 0.36;
    const cy = TAPE_H / 2;
    g.clearRect(0, 0, ALT_W, TAPE_H);
    tapeBackground(g, ALT_W, TAPE_H);
    g.fillStyle = WHITE;
    g.font = '600 13px Inter, system-ui, sans-serif';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    const lo = Math.floor((ft - 460) / 20) * 20;
    for (let v = lo; v <= ft + 460; v += 20) {
      const y = cy - (v - ft) * pxPerFt;
      const major = v % 100 === 0;
      g.fillRect(6, y - 0.75, major ? 10 : 5, 1.5);
      if (major && Math.abs(y - cy) > BOX_CLEAR) g.fillText(String(v), 22, y);
    }
    valueBox(g, 14, cy, ALT_W - 18, String(Math.round(ft / 10) * 10), 'left');
  }

  private drawHeadingTape(hdg: number, trk: number, moving: boolean): void {
    const g = this.hdg;
    const pxPerDeg = 4;
    const cx = HDG_W / 2;
    g.clearRect(0, 0, HDG_W, HDG_H);
    const bg = g.createLinearGradient(0, 0, HDG_W, 0);
    bg.addColorStop(0, 'rgba(8,12,18,0)');
    bg.addColorStop(0.15, 'rgba(8,12,18,.34)');
    bg.addColorStop(0.85, 'rgba(8,12,18,.34)');
    bg.addColorStop(1, 'rgba(8,12,18,0)');
    g.fillStyle = bg;
    g.fillRect(0, 12, HDG_W, HDG_H - 12);
    g.fillStyle = WHITE;
    g.font = '600 12px Inter, system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const cardinal: Record<number, string> = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
    const lo = Math.floor((hdg - 55) / 5) * 5;
    for (let d = lo; d <= hdg + 55; d += 5) {
      const x = cx + (d - hdg) * pxPerDeg;
      const n = ((d % 360) + 360) % 360;
      const major = n % 10 === 0;
      const alpha = 1 - Math.min(1, Math.abs(x - cx) / (HDG_W / 2));
      g.globalAlpha = Math.min(1, alpha * 2.5);
      g.fillRect(x - 0.75, HDG_H - (major ? 12 : 7), 1.5, major ? 12 : 7);
      if (major && n % 30 === 0) g.fillText(cardinal[n] ?? String(n / 10).padStart(2, '0'), x, HDG_H - 22);
    }
    g.globalAlpha = 1;
    if (moving) {
      // Ground-track diamond
      const dx = ((((trk - hdg + 540) % 360) + 360) % 360) - 180;
      const x = cx + dx * pxPerDeg;
      g.fillStyle = '#e46bff';
      g.beginPath();
      g.moveTo(x, HDG_H - 12);
      g.lineTo(x - 4, HDG_H - 7);
      g.lineTo(x, HDG_H - 2);
      g.lineTo(x + 4, HDG_H - 7);
      g.closePath();
      g.fill();
    }
    // Heading box
    const txt = String(Math.round(hdg) % 360 || 360).padStart(3, '0');
    g.fillStyle = 'rgba(6,10,16,.85)';
    g.strokeStyle = WHITE;
    g.lineWidth = 1.2;
    g.beginPath();
    g.roundRect(cx - 24, 0.5, 48, 22, 4);
    g.fill();
    g.stroke();
    g.fillStyle = WHITE;
    g.font = '700 15px Inter, system-ui, sans-serif';
    g.fillText(txt, cx, 12);
  }
}

function setBar(b: { fill: HTMLElement; value: HTMLElement }, v: number, text: string): void {
  b.fill.style.width = `${Math.max(0, Math.min(1, v)) * 100}%`;
  setText(b.value, text);
}

function tapeBackground(g: CanvasRenderingContext2D, w: number, h: number): void {
  const bg = g.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, 'rgba(8,12,18,0)');
  bg.addColorStop(0.18, 'rgba(8,12,18,.34)');
  bg.addColorStop(0.82, 'rgba(8,12,18,.34)');
  bg.addColorStop(1, 'rgba(8,12,18,0)');
  g.fillStyle = bg;
  g.beginPath();
  g.roundRect(0, 0, w, h, 8);
  g.fill();
}

/** The boxed current value in the middle of a tape, with a pointer toward the scale. */
function valueBox(g: CanvasRenderingContext2D, x: number, cy: number, w: number, text: string, pointer: 'left' | 'right'): void {
  const h = 30;
  g.fillStyle = '#060a10';
  g.strokeStyle = WHITE;
  g.lineWidth = 1.4;
  g.beginPath();
  if (pointer === 'right') {
    g.moveTo(x, cy - h / 2);
    g.lineTo(x + w, cy - h / 2);
    g.lineTo(x + w, cy - 6);
    g.lineTo(x + w + 7, cy);
    g.lineTo(x + w, cy + 6);
    g.lineTo(x + w, cy + h / 2);
    g.lineTo(x, cy + h / 2);
  } else {
    g.moveTo(x, cy - h / 2);
    g.lineTo(x + w, cy - h / 2);
    g.lineTo(x + w, cy + h / 2);
    g.lineTo(x, cy + h / 2);
    g.lineTo(x, cy + 6);
    g.lineTo(x - 7, cy);
    g.lineTo(x, cy - 6);
  }
  g.closePath();
  g.fill();
  g.stroke();
  g.fillStyle = WHITE;
  g.font = '700 18px Inter, system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, x + w / 2, cy + 1);
}
