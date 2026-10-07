// Centre avionics stack: GPS/NAV/COM with a moving map, NAV/COM 2 with LED displays and the transponder.

import { DEG, NM, clamp } from '../../core/math';
import type { ControlInputs } from '../../core/types';
import { AIRPORT, runwayThreshold } from '../../core/world';
import type { InstrumentReadings } from '../dynamics/instrumentSet';
import { centredText, font, screw } from './art';
import { context2d, LABEL_FONT, makeCanvas, rng, type Ctx2D } from './canvas';
import { Latch, LIGHT_DISPLAY, type PanelComponent, type Rect } from './component';
import { drawSegments } from './sevenSegment';

/** Radio frequencies shown on the displays (MHz). NAV1 is the runway 07 ILS. */
export interface RadioTuning {
  com1: [number, number];
  nav1: [number, number];
  com2: [number, number];
  nav2: [number, number];
  squawk: string;
}

export const DEFAULT_TUNING: RadioTuning = {
  com1: [120.3, 121.9],
  nav1: [110.3, 113.9],
  com2: [124.85, 118.0],
  nav2: [113.9, 116.8],
  squawk: '1200',
};

/** A boxed unit whose chassis is painted once and whose display is drawn on change. */
export abstract class RackUnit implements PanelComponent {
  private chassis: HTMLCanvasElement | null = null;

  constructor(
    readonly id: string,
    readonly bounds: Rect,
  ) {}

  abstract sample(r: InstrumentReadings, c: ControlInputs, time: number): boolean;
  /** Chassis art in local coordinates (0,0 = top-left of bounds). */
  protected abstract paintChassis(g: Ctx2D): void;
  /** Display contents in local coordinates. */
  protected abstract drawDisplay(g: Ctx2D): void;
  /** Display windows in local coordinates (self-lit). */
  protected abstract readonly screens: readonly Rect[];

  paintLightMask(g: Ctx2D): void {
    g.fillStyle = LIGHT_DISPLAY;
    for (const s of this.screens) g.fillRect(this.bounds.x + s.x, this.bounds.y + s.y, s.w, s.h);
  }

  draw(g: Ctx2D): void {
    const b = this.bounds;
    if (!this.chassis) {
      this.chassis = makeCanvas(b.w, b.h);
      this.paintChassis(context2d(this.chassis));
    }
    g.drawImage(this.chassis, b.x, b.y);
    g.save();
    g.translate(b.x, b.y);
    this.drawDisplay(g);
    g.restore();
  }
}

/** Satin black radio faceplate with rack screws. */
export function faceplate(g: Ctx2D, w: number, h: number, seed: number): void {
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.6)';
  g.shadowBlur = 5;
  g.shadowOffsetY = 2;
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#303133');
  grad.addColorStop(0.08, '#232426');
  grad.addColorStop(1, '#18191a');
  g.fillStyle = grad;
  g.beginPath();
  g.roundRect(2, 1, w - 4, h - 5, 4);
  g.fill();
  g.restore();
  g.strokeStyle = 'rgba(255,255,255,0.08)';
  g.lineWidth = 1;
  g.beginPath();
  g.roundRect(2.5, 1.5, w - 5, h - 6, 4);
  g.stroke();
  const rand = rng(seed);
  screw(g, 9, h / 2 - 2, 3.2, rand);
  screw(g, w - 9, h / 2 - 2, 3.2, rand);
}

/** Rubber push button with a white legend. */
function button(g: Ctx2D, x: number, y: number, w: number, h: number, label: string): void {
  g.fillStyle = 'rgba(0,0,0,0.6)';
  g.beginPath();
  g.roundRect(x + 0.5, y + 1.5, w, h, 3);
  g.fill();
  const grad = g.createLinearGradient(0, y, 0, y + h);
  grad.addColorStop(0, '#4a4b4e');
  grad.addColorStop(1, '#2a2b2d');
  g.fillStyle = grad;
  g.beginPath();
  g.roundRect(x, y, w, h, 3);
  g.fill();
  g.fillStyle = '#e9e7df';
  g.font = `600 ${Math.min(8, h * 0.6)}px ${LABEL_FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(label, x + w / 2, y + h / 2 + 0.5);
}

/** Concentric frequency knob. */
function dualKnob(g: Ctx2D, x: number, y: number, r: number): void {
  g.fillStyle = 'rgba(0,0,0,0.6)';
  g.beginPath();
  g.arc(x + 1, y + 2.5, r + 1, 0, Math.PI * 2);
  g.fill();
  for (const [rr, c0, c1] of [
    [r, '#3b3c3f', '#141415'],
    [r * 0.6, '#505155', '#1b1b1c'],
  ] as const) {
    const grad = g.createRadialGradient(x - rr * 0.3, y - rr * 0.4, 0, x, y, rr);
    grad.addColorStop(0, c0);
    grad.addColorStop(1, c1);
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, rr, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.1)';
    g.lineWidth = 0.7;
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      g.beginPath();
      g.moveTo(x + Math.cos(a) * rr * 0.86, y + Math.sin(a) * rr * 0.86);
      g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      g.stroke();
    }
  }
}

/** Soft reflection over a display glass. */
export function screenGlass(g: Ctx2D, x: number, y: number, w: number, h: number): void {
  const grad = g.createLinearGradient(x, y, x + w * 0.6, y + h);
  grad.addColorStop(0, 'rgba(255,255,255,0.09)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.02)');
  grad.addColorStop(0.46, 'rgba(255,255,255,0)');
  grad.addColorStop(1, 'rgba(255,255,255,0.015)');
  g.fillStyle = grad;
  g.fillRect(x, y, w, h);
}

const fmtFreq = (f: number, decimals: number): string => f.toFixed(decimals);

// ---------------------------------------------------------------------------------------------------
const MAP_RANGES_NM = [0.5, 1, 2, 5, 10, 20, 50];
const RUNWAY_ENDS = [runwayThreshold(0), runwayThreshold(1)];

/**
 * GPS / NAV / COM unit (in the style of a panel-mount GPS navigator): frequency column on the left of the
 * screen and a track-up moving map with the airport, own-ship symbol, track vector, ground speed, track
 * and distance. The map is redrawn at most 5 times per second, like the real unit's display refresh.
 */
export class GpsUnit extends RackUnit {
  private static readonly SCREEN = { x: 48, y: 16, w: 224, h: 168 };
  protected readonly screens = [GpsUnit.SCREEN];
  private static readonly FREQ_W = 68;
  private static readonly REFRESH = 0.2;
  private readonly latch = new Latch(7);
  private lastRefresh = -Infinity;

  constructor(
    id: string,
    x: number,
    y: number,
    private readonly tuning: RadioTuning,
  ) {
    super(id, { x, y, w: 320, h: 236 });
  }

  sample(r: InstrumentReadings, _c: ControlInputs, time: number): boolean {
    this.latch.set(0, r.avionicsPowered ? 1 : 0, 1);
    if (Math.abs(time - this.lastRefresh) >= GpsUnit.REFRESH) {
      this.lastRefresh = time;
      this.latch.set(1, r.gps.groundSpeedKt, 1);
      this.latch.set(2, r.gps.trackDeg, 1);
      this.latch.set(3, r.gps.distanceNm, 0.1);
      this.latch.set(4, r.gps.bearingDeg, 1);
      this.latch.set(5, r.gps.distanceNm, 0.002);
      this.latch.set(6, r.gps.trackDeg, 0.25);
    }
    return this.latch.take();
  }

  protected paintChassis(g: Ctx2D): void {
    const { w, h } = this.bounds;
    faceplate(g, w, h, 301);
    const s = GpsUnit.SCREEN;
    // Screen recess
    g.fillStyle = '#050505';
    g.fillRect(s.x - 3, s.y - 3, s.w + 6, s.h + 6);
    dualKnob(g, 24, 30, 11);
    centredText(g, 'C', 24, 50, 7);
    button(g, 10, 64, 28, 16, 'COM');
    button(g, 10, 88, 28, 16, 'VLOC');
    dualKnob(g, 24, 132, 11);
    centredText(g, 'V', 24, 152, 7);
    button(g, 284, 22, 28, 16, 'RNG');
    button(g, 284, 48, 28, 16, 'D→');
    button(g, 284, 72, 28, 16, 'MENU');
    button(g, 284, 96, 28, 16, 'CLR');
    button(g, 284, 120, 28, 16, 'ENT');
    dualKnob(g, 296, 172, 16);
    const bw = 34;
    ['CDI', 'OBS', 'MSG', 'FPL', 'PROC'].forEach((t, i) => button(g, 52 + i * (bw + 10), 200, bw, 14, t));
    g.fillStyle = 'rgba(233,231,223,0.6)';
    g.font = `600 7px ${LABEL_FONT}`;
    g.textAlign = 'left';
    g.fillText('GPS·NAV·COM', 50, 226);
  }

  protected drawDisplay(g: Ctx2D): void {
    const s = GpsUnit.SCREEN;
    g.fillStyle = '#020303';
    g.fillRect(s.x, s.y, s.w, s.h);
    if (this.latch.get(0)) {
      this.drawFrequencies(g);
      this.drawMap(g);
    }
    screenGlass(g, s.x, s.y, s.w, s.h);
  }

  private drawFrequencies(g: Ctx2D): void {
    const s = GpsUnit.SCREEN;
    const x = s.x + 4;
    const fw = GpsUnit.FREQ_W;
    g.fillStyle = '#06101a';
    g.fillRect(s.x, s.y, fw, s.h);
    g.strokeStyle = '#3c6d8f';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(s.x + fw + 0.5, s.y);
    g.lineTo(s.x + fw + 0.5, s.y + s.h);
    g.stroke();
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    const rows: [string, number, number, number][] = [
      ['COM', this.tuning.com1[0], this.tuning.com1[1], 3],
      ['VLOC', this.tuning.nav1[0], this.tuning.nav1[1], 2],
    ];
    rows.forEach(([label, active, stby, dec], i) => {
      const y = s.y + 16 + i * 62;
      g.font = `600 9px ${LABEL_FONT}`;
      g.fillStyle = '#7fc4ea';
      g.fillText(label, x, y);
      g.font = font(15, 600);
      g.fillStyle = '#5dffa0';
      g.fillText(fmtFreq(active, dec), x, y + 19);
      g.fillStyle = '#e8f3ff';
      g.fillText(fmtFreq(stby, dec), x, y + 38);
    });
    g.font = `600 9px ${LABEL_FONT}`;
    g.fillStyle = '#7fc4ea';
    g.fillText('ILS 07', x, s.y + s.h - 10);
  }

  private drawMap(g: Ctx2D): void {
    const s = GpsUnit.SCREEN;
    const mx = s.x + GpsUnit.FREQ_W + 1;
    const mw = s.w - GpsUnit.FREQ_W - 1;
    const dataH = 34;
    const mh = s.h - dataH;
    g.save();
    g.beginPath();
    g.rect(mx, s.y, mw, mh);
    g.clip();
    g.fillStyle = '#0a1320';
    g.fillRect(mx, s.y, mw, mh);
    const gs = this.latch.get(1);
    const dist = this.latch.get(5);
    const trk = this.latch.get(6) * DEG;
    const range = MAP_RANGES_NM.find((r) => r >= dist * 1.25) ?? MAP_RANGES_NM[MAP_RANGES_NM.length - 1];
    const ox = mx + mw / 2;
    const oy = s.y + mh * 0.74;
    const k = (mh * 0.7) / (range * NM); // px per metre: `range` NM from own ship to near the top edge
    // Airport position relative to own ship, from the distance and bearing latched with the track.
    const brg = this.latch.get(4) * DEG;
    const apN = Math.cos(brg) * dist * NM;
    const apE = Math.sin(brg) * dist * NM;
    const ct = Math.cos(trk);
    const st = Math.sin(trk);
    const toScreenX = (n: number, e: number): number => ox + (-n * st + e * ct) * k;
    const toScreenY = (n: number, e: number): number => oy - (n * ct + e * st) * k;
    // Range ring at half range.
    g.strokeStyle = 'rgba(200,220,240,0.35)';
    g.setLineDash([3, 3]);
    g.beginPath();
    g.arc(ox, oy, (range / 2) * NM * k, Math.PI, 2 * Math.PI);
    g.stroke();
    // Extended runway centreline, 3 NM each way.
    const rw = AIRPORT.runway;
    const dn = Math.cos(rw.heading);
    const de = Math.sin(rw.heading);
    const c = rw.center;
    const ext = rw.length / 2 + 3 * NM;
    g.strokeStyle = 'rgba(230,230,230,0.5)';
    g.beginPath();
    g.moveTo(toScreenX(apN - dn * ext, apE - de * ext), toScreenY(apN - dn * ext, apE - de * ext));
    g.lineTo(toScreenX(apN + dn * ext, apE + de * ext), toScreenY(apN + dn * ext, apE + de * ext));
    g.stroke();
    g.setLineDash([]);
    // Runway
    const e0 = RUNWAY_ENDS[0];
    const e1 = RUNWAY_ENDS[1];
    g.strokeStyle = '#f0f0f0';
    g.lineCap = 'butt';
    g.lineWidth = Math.max(3, rw.width * k);
    g.beginPath();
    g.moveTo(toScreenX(apN + e0.x - c.north, apE + e0.y - c.east), toScreenY(apN + e0.x - c.north, apE + e0.y - c.east));
    g.lineTo(toScreenX(apN + e1.x - c.north, apE + e1.y - c.east), toScreenY(apN + e1.x - c.north, apE + e1.y - c.east));
    g.stroke();
    g.font = `700 9px ${LABEL_FONT}`;
    g.fillStyle = '#6fd3ff';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillText(AIRPORT.icao, toScreenX(apN, apE) + 8, toScreenY(apN, apE) - 8);
    // Track vector (1 minute ahead) and own ship.
    const ahead = clamp(gs * (NM / 60) * k, 0, mh);
    g.strokeStyle = '#e8e8e8';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(ox, oy);
    g.lineTo(ox, oy - ahead);
    g.stroke();
    g.fillStyle = '#ffffff';
    g.strokeStyle = '#000';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(ox, oy - 8);
    g.lineTo(ox - 5.5, oy + 6);
    g.lineTo(ox, oy + 3);
    g.lineTo(ox + 5.5, oy + 6);
    g.closePath();
    g.fill();
    g.stroke();
    // Range legend and track-up label
    g.font = `600 8px ${LABEL_FONT}`;
    g.fillStyle = '#d8e6f0';
    g.textAlign = 'left';
    g.fillText(`${range}NM`, mx + 4, s.y + mh - 8);
    g.textAlign = 'right';
    g.fillText('TRK UP', mx + mw - 4, s.y + 8);
    g.restore();

    // Data fields
    const y = s.y + mh;
    g.fillStyle = '#06101a';
    g.fillRect(mx, y, mw, dataH);
    const fields: [string, string][] = [
      ['GS', `${Math.round(gs)}kt`],
      ['TRK', `${String(Math.round(this.latch.get(2)) % 360).padStart(3, '0')}°`],
      ['DIS', `${this.latch.get(3).toFixed(1)}nm`],
    ];
    const cw = mw / fields.length;
    fields.forEach(([label, value], i) => {
      const x = mx + cw * i + cw / 2;
      g.textAlign = 'center';
      g.font = `600 8px ${LABEL_FONT}`;
      g.fillStyle = '#7fc4ea';
      g.fillText(label, x, y + 10);
      g.font = font(12, 600);
      g.fillStyle = '#f3f3f3';
      g.fillText(value, x, y + 25);
    });
  }
}

// ---------------------------------------------------------------------------------------------------
const LED = '#ff8f2a';
const LED_OFF = 'rgba(255,143,42,0.07)';

/** NAV/COM 2 with gas-discharge style segment displays. */
export class NavComRadio extends RackUnit {
  protected readonly screens = [
    { x: 22, y: 10, w: 128, h: 32 },
    { x: 170, y: 10, w: 128, h: 32 },
  ];
  private readonly latch = new Latch(1);

  constructor(
    id: string,
    x: number,
    y: number,
    private readonly tuning: RadioTuning,
  ) {
    super(id, { x, y, w: 320, h: 76 });
  }

  sample(r: InstrumentReadings): boolean {
    this.latch.set(0, r.avionicsPowered ? 1 : 0, 1);
    return this.latch.take();
  }

  protected paintChassis(g: Ctx2D): void {
    const { w, h } = this.bounds;
    faceplate(g, w, h, 302);
    for (const x of [22, 170]) {
      g.fillStyle = '#060404';
      g.fillRect(x, 10, 128, 32);
    }
    centredText(g, 'COM', 40, 52, 7);
    centredText(g, 'NAV', 188, 52, 7);
    button(g, 66, 48, 36, 12, '⇄');
    button(g, 214, 48, 36, 12, '⇄');
    dualKnob(g, 138, 57, 11);
    dualKnob(g, 290, 57, 11);
    dualKnob(g, 22, 60, 7);
  }

  protected drawDisplay(g: Ctx2D): void {
    if (this.latch.get(0)) {
      const style = { height: 16, on: LED, off: LED_OFF, glow: 5 };
      const small = { ...style, height: 12 };
      drawSegments(g, fmtFreq(this.tuning.com2[0], 2), 90, 18, style);
      drawSegments(g, fmtFreq(this.tuning.com2[1], 2), 146, 21, small);
      drawSegments(g, fmtFreq(this.tuning.nav2[0], 2), 238, 18, style);
      drawSegments(g, fmtFreq(this.tuning.nav2[1], 2), 294, 21, small);
    }
    screenGlass(g, 22, 10, 128, 32);
    screenGlass(g, 170, 10, 128, 32);
  }
}

/** Mode C transponder: squawk code, ALT mode, pressure altitude and the reply lamp. */
export class Transponder extends RackUnit {
  protected readonly screens = [{ x: 70, y: 10, w: 150, h: 30 }];
  private readonly latch = new Latch(3);

  constructor(
    id: string,
    x: number,
    y: number,
    private readonly tuning: RadioTuning,
  ) {
    super(id, { x, y, w: 320, h: 60 });
  }

  sample(r: InstrumentReadings, _c: ControlInputs, time: number): boolean {
    this.latch.set(0, r.avionicsPowered ? 1 : 0, 1);
    this.latch.set(1, r.pressureAltitudeFt, 100);
    // Replies to interrogations: several radar sweeps a few seconds apart, a flash each.
    this.latch.set(2, (time % 4.6) < 0.15 || (time % 2.9) < 0.12 ? 1 : 0, 1);
    return this.latch.take();
  }

  protected paintChassis(g: Ctx2D): void {
    const { w, h } = this.bounds;
    faceplate(g, w, h, 303);
    g.fillStyle = '#060404';
    g.fillRect(70, 10, 150, 30);
    ['IDT', 'VFR', 'OFF', 'SBY', 'ON', 'ALT'].forEach((t, i) => button(g, 24 + i * 44, 44, 34, 11, t));
    dualKnob(g, 290, 26, 12);
    centredText(g, 'XPDR', 40, 20, 7);
  }

  protected drawDisplay(g: Ctx2D): void {
    if (this.latch.get(0)) {
      const style = { height: 18, on: LED, off: LED_OFF, glow: 5 };
      drawSegments(g, this.tuning.squawk, 150, 16, style);
      const fl = Math.max(0, Math.round(this.latch.get(1) / 100));
      g.save();
      g.shadowColor = LED;
      g.shadowBlur = 4;
      g.fillStyle = LED;
      g.font = `700 8px ${LABEL_FONT}`;
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      g.fillText('ALT', 76, 18);
      g.fillText(`FL${String(fl).padStart(3, '0')}`, 170, 31);
      if (this.latch.get(2)) g.fillText('R', 76, 31);
      g.restore();
    }
    screenGlass(g, 70, 10, 150, 30);
  }
}
