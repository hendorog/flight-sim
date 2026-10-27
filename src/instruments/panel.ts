// The analogue instrument panel of a type, built from its panel definition (the Cessna 172S's by default) and
// drawn to a 2080 x 800 canvas (the 1.04 m x 0.40 m panel face at 2000 px/m), exposed as a THREE.CanvasTexture
// for the 3D cockpit.
//
// Drawing strategy: the static panel (paint, seams, placards, switch legends) is painted once to a
// background canvas. Each instrument caches its dial face and its bezel/glass to offscreen canvases and
// latches its display values quantised to what is visible; per frame only instruments whose latched values
// changed are redrawn (background restore + face + needles + bezel) and the texture is re-uploaded only
// if something changed.
//
// Each instrument is redrawn in its own small layer canvas, which is then copied onto the panel canvas
// (drawLayered). Drawing all the instruments straight into the one large panel canvas let Chrome's GPU canvas
// (ANGLE on OpenGL, the Linux default, Mesa radeonsi) place whole instruments at the wrong x: a gauge slid
// tens of pixels sideways inside its own box, or painted over its neighbour, frame after frame (the PC-12
// and C208 right halves, fixed 2D panel and 3D cockpit alike). With a layer per instrument the panel canvas
// only receives plain image copies, and the fault does not occur (scripts/fixed-panel-stability.mjs).

import { DualSectorGauge, SectorGauge } from './render/dualSector';
import * as THREE from 'three';
import { C172S_PANEL } from '../aircraft/c172s/panel';
import type { SimContext } from '../core/context';
import type { AircraftState } from '../core/types';
import { InstrumentSet, type InstrumentSetOptions } from './dynamics/instrumentSet';
import { gaugeRecess, gaugeScale, type GaugeDef, type PanelDef } from './panelDef';
import { panelLayoutProblems } from './panelLayout';
import { gaugeParts, ignitionLayout, isLargeGauge, leverId } from './panelParts';
import { ScaledGauge } from './render/scaledGauge';
import { RoundGauge } from './render/roundGauge';
import { BlankGauge, RotorTachGauge } from './render/rotorTach';
import { ConsoleControl, DigitalTemperature, Hourmeter } from './render/panelControls';
import { screw } from './render/art';
import { DirtyRectUploader } from './render/dirtyUpload';
import { PanelLightComposer } from './render/emissiveCompose';
import { DEFAULT_TUNING, GpsUnit, NavComRadio, Transponder, type RadioTuning } from './render/avionics';
import { context2d, LABEL_FONT, makeCanvas, noiseCanvas, rng, type Ctx2D } from './render/canvas';
import { LIGHT_DIAL_LINEAR, type PanelComponent, type Rect } from './render/component';
import { AnnunciatorPanel, FlapIndicator, paintBlankPlate, paintEngineControls, paintPlacard, SwitchPanel } from './render/controls';
import { EngineDisplay } from './render/engineDisplay';
import { EisWindow } from './render/eisWindow';
import { ammeterGauge, ClockOatGauge, DualGauge, SingleGauge, suctionGauge, TachometerGauge, TwinNeedleGauge } from './render/engineGauges';
import { AttitudeGauge, HeadingGauge, TurnCoordinatorGauge } from './render/gyroGauges';
import { FlapLights, FlapSwitch, GearLights, GearSelector, GuardedKnob, IgnitionSwitches, TrimBar } from './render/lights';
import { HsiGauge, RmiGauge } from './render/hsiGauges';
import { CdiGauge } from './render/navGauges';
import { AirspeedGauge, AltimeterGauge, VerticalSpeedGauge } from './render/pitotStaticGauges';

export { PANEL_HEIGHT, PANEL_LAYOUT, PANEL_WIDTH } from './layout';
import { PANEL_HEIGHT, PANEL_WIDTH } from './layout';

/**
 * InstrumentPanel.emissiveTexture: displays and annunciator lamps are at full value, backlit dial
 * markings at this linear fraction of it. Faceplate, bezels and placards are black (not self-lit).
 */
export const PANEL_DIAL_LIGHT = LIGHT_DIAL_LINEAR;

/** Named source rectangles for drawTo(). */
export type PanelRegion = 'full' | 'sixpack' | 'engine' | 'stack' | string;

/** The instrument groups of drawTo() on the C172S panel, panel px. */
export const PANEL_REGIONS = C172S_PANEL.regions as Record<'sixpack' | 'engine' | 'stack', Rect>;

export interface InstrumentPanelOptions extends InstrumentSetOptions {
  /** The panel to build: gauges, switch row, artwork. Default: the C172S's. */
  def?: PanelDef;
  /**
   * The part of the canvas on the cockpit's panel face (the cockpit definition's `panel.pxRect`), for the layout
   * check. Default: the whole canvas.
   */
  pxRect?: Rect;
  tuning?: RadioTuning;
  /**
   * Paint the flap lever handle on the panel (for a flat 2D view such as the dev page). Default false:
   * the 3D cockpit has a real lever in front of the texture.
   */
  paintLevers?: boolean;
  /**
   * Anisotropic filtering of the panel texture and its self-illumination map: the renderer's maximum
   * (renderer.capabilities.getMaxAnisotropy()); the 3D panel is seen at an angle. Default 8 (dev pages).
   */
  anisotropy?: number;
}

export class InstrumentPanel {
  static readonly WIDTH = PANEL_WIDTH;
  static readonly HEIGHT = PANEL_HEIGHT;

  readonly canvas: HTMLCanvasElement;
  readonly texture: THREE.CanvasTexture;
  /** Instrument dynamics; readings are in `instruments.readings`. */
  readonly instruments: InstrumentSet;
  /** Wall time of the last update() in ms (dynamics + drawing), for profiling. */
  lastUpdateMs = 0;
  /** Changes when the native canvas changes; fixed views need no copy on unchanged frames. */
  version = 0;
  /**
   * Only redraw the canvas (and re-upload the texture) while ctx.cameraMode is 'cockpit', where the panel
   * can be seen; the instrument dynamics always run. Set false for 2D uses of the canvas (drawTo, dev page).
   */
  drawOnlyInCockpit = true;
  /**
   * What is wrong with the layout of the definition (panelLayoutProblems): components that overlap, lie outside
   * the panel face or under a yoke boot. Empty for a sound panel; each finding is also warned on the console.
   */
  readonly layoutWarnings: readonly string[];

  private readonly def: PanelDef;
  private readonly paintLevers: boolean;
  private readonly g: Ctx2D;
  private readonly background: HTMLCanvasElement;
  private readonly components: PanelComponent[];
  private readonly regions = new Map<string, Rect>();
  private dialLevel = 1;
  private displayLevel = 1;
  private light: {
    mask: HTMLCanvasElement;
    dimmer: HTMLCanvasElement | null;
    composer: PanelLightComposer;
  } | null = null;
  /** Re-uploads only the redrawn instrument rectangles of `texture` (see render/dirtyUpload.ts). */
  readonly upload: DirtyRectUploader;
  /** Per-instrument layer canvases (see drawLayered). */
  private readonly layers = new Map<PanelComponent, { canvas: HTMLCanvasElement; g: Ctx2D; x: number; y: number }>();
  private lastStateTime = -Infinity;
  private readonly lastPos = { x: NaN, y: NaN, z: NaN };

  constructor(opts: InstrumentPanelOptions = {}) {
    const def = opts.def ?? C172S_PANEL;
    const { w, h } = def.size;
    this.def = def;
    this.paintLevers = opts.paintLevers ?? false;
    this.layoutWarnings = panelLayoutProblems(def, opts.pxRect);
    for (const w of this.layoutWarnings) console.warn(`[panel ${def.id}] ${w}`);
    this.instruments = new InstrumentSet(opts);
    this.canvas = makeCanvas(w, h);
    this.g = context2d(this.canvas);
    this.components = buildComponents(def, opts.tuning ?? DEFAULT_TUNING, opts.paintLevers ?? false);
    this.background = makeCanvas(w, h);
    paintBackground(context2d(this.background), def, this.components);
    this.g.drawImage(this.background, 0, 0);

    for (const c of this.components) this.regions.set(c.id, c.bounds);
    this.regions.set('full', { x: 0, y: 0, w, h });
    for (const [name, rect] of Object.entries(def.regions)) this.regions.set(name, rect);

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = opts.anisotropy ?? 8;
    this.texture.name = 'instrumentPanel';
    this.upload = new DirtyRectUploader(this.texture);
  }

  /**
   * Self-illumination map for night lighting (use as the panel material's emissiveMap, with the same UVs
   * as `texture`): the panel image multiplied by a light mask, so only what really glows does: dial
   * markings and needles behind the glass at PANEL_DIAL_LIGHT, and the radio / GPS displays and the
   * annunciator lamps at full value. For a dimmer profile, alpha distinguishes dimmed circuits (0.5)
   * from independent warning lamps (1); the material dims after RGB filtering. Created on first
   * access; from then on it is kept up to date with `texture` (one GPU pass on the frames where a lit
   * instrument was redrawn).
   */
  get emissiveTexture(): THREE.Texture {
    if (!this.light) {
      const { w, h } = this.def.size;
      const mask = makeCanvas(w, h);
      const mg = context2d(mask);
      mg.fillStyle = '#000';
      mg.fillRect(0, 0, w, h);
      this.paintLightMask(mg);
      const dimmer = this.def.lightingRequiresNav || this.def.lightingDimmerExponent !== undefined ? makeCanvas(w, h) : null;
      if (dimmer) this.paintDimmerMask(context2d(dimmer));
      // Composed on the GPU (render/emissiveCompose.ts): reading the panel canvas back into a CPU canvas
      // stalled the pipeline once per redrawn instrument.
      this.light = { mask, dimmer, composer: new PanelLightComposer(this.texture, mask, dimmer, this.texture.anisotropy) };
    }
    return this.light.composer.texture;
  }

  /**
   * Paint the self-illumination map (as emissiveTexture holds it) into a 2D context of the panel's size, on
   * the CPU: for inspecting it on the dev page.
   */
  drawEmissiveTo(g: Ctx2D): void {
    void this.emissiveTexture;
    const L = this.light!;
    const { w, h } = this.def.size;
    g.save();
    g.globalCompositeOperation = 'copy';
    g.drawImage(this.canvas, 0, 0);
    g.globalCompositeOperation = 'multiply';
    g.drawImage(L.mask, 0, 0);
    if (L.dimmer) {
      g.globalCompositeOperation = 'destination-in';
      g.drawImage(L.dimmer, 0, 0, w, h);
    }
    g.restore();
  }

  private paintLightMask(g: Ctx2D): void {
    g.fillStyle = '#000'; g.fillRect(0, 0, this.def.size.w, this.def.size.h);
    for (const c of this.components) c.paintLightMask?.(g);
  }

  private paintDimmerMask(g: Ctx2D): void {
    g.clearRect(0, 0, this.def.size.w, this.def.size.h);
    const selfLit = new Set(this.def.gauges.filter(d => ['clock', 'gps', 'navcom', 'xpdr', 'digitalTemperature'].includes(d.kind)).map(d => d.id));
    for (const c of this.components) {
      // Alpha tags the circuit; it does not carry the dimmer's small linear value. Canvas storage is
      // premultiplied 8-bit, so low alpha would destroy the colour precision of the dial artwork.
      g.globalAlpha = c.id === 'annunciator' ? 1 : selfLit.has(c.id) ? this.displayLevel : this.dialLevel;
      c.paintLightMask?.(g);
    }
    g.globalAlpha = 1;
  }

  /** Re-initialise instrument dynamics after a scenario reset or teleport. */
  reset(state: AircraftState): void {
    this.instruments.reset(state);
  }

  update(dt: number, ctx: SimContext): void {
    for (const c of this.components) if (c instanceof FlapIndicator) c.paintLever = this.paintLevers || (ctx.cameraMode === 'cockpit' && !!ctx.panelView && ctx.panelView !== '3d');
    const t0 = performance.now();
    const s = ctx.state;
    if (this.teleported(s)) this.reset(s);
    const r = this.instruments.step(dt, s, ctx.controls, ctx.weather);
    // A caution or warning legend that has just lit strikes the master chime (PC-12 CAWS; audio listens).
    const chime = this.instruments.takeChime();
    if (chime) ctx.events.emit('caws', { level: chime });
    if (this.drawOnlyInCockpit && ctx.cameraMode !== 'cockpit') {
      // Latches keep their last drawn values, so the first cockpit frame redraws whatever changed.
      this.upload.flush(ctx.renderer); // completes a pending mip rebuild
      this.light?.composer.render(ctx.renderer);
      this.lastUpdateMs = performance.now() - t0;
      return;
    }
    const light = this.light;
    const display = this.def.lightingDimmerExponent === undefined ? 1 : 0.5;
    const dial = !this.def.lightingRequiresNav || ctx.controls.lights.nav ? display : 0;
    if (this.dialLevel !== dial || this.displayLevel !== display) {
      this.dialLevel = dial; this.displayLevel = display;
      if (light?.dimmer) {
        this.paintDimmerMask(context2d(light.dimmer));
        light.composer.dimmerChanged();
      }
    }
    for (const c of this.components) {
      if (!c.sample(r, ctx.controls, ctx.simTime)) continue;
      const rects = c.paintRects ?? [c.bounds];
      this.drawLayered(c, rects);
      this.version++;
      for (const b of rects) {
        this.upload.add(b);
        if (light && c.paintLightMask) light.composer.markDirty();
      }
    }
    // Only the redrawn rectangles go to the GPU (a full upload until three.js has created the textures).
    this.upload.flush(ctx.renderer);
    light?.composer.render(ctx.renderer);
    this.lastUpdateMs = performance.now() - t0;
  }

  /**
   * Redraw one instrument: background restore + draw in its own layer canvas (whole-pixel box around `rects`),
   * then copy the layer's `rects` onto the panel canvas. The result equals restoring the background in `rects`
   * and drawing the instrument straight onto the panel, except that paint falling outside `rects` (a shadow edge)
   * is dropped instead of being left behind on the panel until the next full repaint.
   */
  private drawLayered(c: PanelComponent, rects: readonly Rect[]): void {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const b of rects) {
      x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
    }
    x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0));
    const w = Math.min(this.canvas.width, Math.ceil(x1)) - x0, h = Math.min(this.canvas.height, Math.ceil(y1)) - y0;
    if (w <= 0 || h <= 0) return;
    let layer = this.layers.get(c);
    if (!layer || layer.x !== x0 || layer.y !== y0 || layer.canvas.width !== w || layer.canvas.height !== h) {
      const canvas = makeCanvas(w, h);
      layer = { canvas, g: context2d(canvas), x: x0, y: y0 };
      this.layers.set(c, layer);
    }
    const lg = layer.g;
    lg.setTransform(1, 0, 0, 1, 0, 0);
    lg.globalCompositeOperation = 'copy';
    lg.drawImage(this.background, x0, y0, w, h, 0, 0, w, h);
    lg.globalCompositeOperation = 'source-over';
    lg.setTransform(1, 0, 0, 1, -x0, -y0);
    lg.save();
    c.draw(lg);
    lg.restore();
    for (const b of rects) this.g.drawImage(layer.canvas, b.x - x0, b.y - y0, b.w, b.h, b.x, b.y, b.w, b.h);
  }

  /**
   * Copy part of the panel into another 2D canvas (e.g. a 2D instrument overlay for external views).
   * `region` is 'full', a region of the panel definition or a component id. On the C172S: 'sixpack',
   * 'engine', 'stack', and asi, attitude, altimeter, turn, heading, vsi, tach, cdi1, cdi2, fuel, oil, egtff,
   * suction, ammeter, clock, annunciator, switches, flaps, gps, navcom2, xpdr.
   */
  drawTo(target: CanvasRenderingContext2D, rect: Rect, region: PanelRegion = 'full'): void {
    const src = this.regions.get(region);
    if (!src) throw new Error(`Unknown panel region '${region}'`);
    target.drawImage(this.canvas, src.x, src.y, src.w, src.h, rect.x, rect.y, rect.w, rect.h);
  }

  /** Source rectangle of a region in panel pixels. */
  regionRect(region: PanelRegion): Rect | undefined {
    return this.regions.get(region);
  }

  dispose(): void {
    this.texture.dispose();
    this.light?.composer.dispose();
  }

  /** A scenario reset shows up as simulation time going backwards or a jump in position. */
  private teleported(s: AircraftState): boolean {
    const p = this.lastPos;
    const jump = Math.hypot(s.position.x - p.x, s.position.y - p.y, s.position.z - p.z);
    const back = s.time < this.lastStateTime - 1e-6;
    const first = Number.isNaN(p.x);
    this.lastStateTime = s.time;
    p.x = s.position.x;
    p.y = s.position.y;
    p.z = s.position.z;
    return !first && (back || jump > 500);
  }
}

/** Course on the card of each CDI of the C172S panel while its receiver has no OBS input, degrees (NAV 1, NAV 2). */
export const CDI_FIXED_COURSES = C172S_PANEL.gauges.flatMap((g) => (g.kind === 'cdi' ? [g.fixedCourseDeg] : []));

/**
 * The components of the definition's gauges, in its order (panelParts lists the same rectangles), with the
 * annunciator strip, the switch row and the ignition switches after the dials.
 */
function buildComponents(def: PanelDef, tuning: RadioTuning, paintLevers: boolean): PanelComponent[] {
  const dials: PanelComponent[] = [];
  const rest: PanelComponent[] = [];
  for (const g of def.gauges) {
    const into = 'at' in g ? dials : rest;
    const k = (def.instrumentScale?.[isLargeGauge(g) ? 'large' : 'small'] ?? 1) * gaugeScale(g);
    if (k !== 1 && gaugeRecess(g, def.apertures) && 'at' in g) {
      const apertures = { large: def.apertures.large / k, small: def.apertures.small / k };
      const component = buildGauge(g, apertures, tuning, paintLevers);
      if (def.instrumentBezel && component instanceof RoundGauge) component.setBezelShape(def.instrumentBezel);
      into.push(new ScaledGauge(component, gaugeParts(g, def.apertures, def.instrumentScale)[0].rect, g.at[0], g.at[1], k));
    } else {
      const component = buildGauge(g, def.apertures, tuning, paintLevers);
      if (def.instrumentBezel && component instanceof RoundGauge) component.setBezelShape(def.instrumentBezel);
      into.push(component);
    }
    // The selector of a light cluster is a component of its own beside it.
    if (g.kind === 'gearLights' && g.lever) into.push(new GearSelector(leverId(g.id), g.lever));
    if (g.kind === 'flapLights' && g.lever) into.push(new FlapSwitch(leverId(g.id), g.lever, g));
  }
  if (def.annunciator) dials.push(new AnnunciatorPanel(def.annunciator.bounds, def.annunciator.lamps, def.annunciator.columns, def.annunciator.cells, def.annunciator.lensLegend, def.annunciator.clipGlow));
  dials.push(new SwitchPanel(def.switchRow, def.ignition));
  const ignition = ignitionLayout(def.ignition);
  if (ignition && def.ignition.kind !== 'key') dials.push(new IgnitionSwitches(def.ignition.kind, ignition, def.ignition.kind === 'toggles' ? def.ignition.sides : undefined));
  return [...dials, ...rest];
}

function buildGauge(g: GaugeDef, apertures: PanelDef['apertures'], tuning: RadioTuning, paintLevers: boolean): PanelComponent {
  // The glass aperture is the 3D recess's (gaugeRecess), so the artwork and the cockpit cannot disagree.
  const r = gaugeRecess(g, apertures)?.r ?? 0;
  switch (g.kind) {
    case 'customRound':
      return g.create(g.id, g.at[0], g.at[1], r);
    case 'customRect':
      return g.create(g.id, g.bounds);
    case 'blank':
      return new BlankGauge(g.id, g.at[0], g.at[1], r);
    case 'rotorTach':
      return new RotorTachGauge(g.id, g.at[0], g.at[1], r, g.marks);
    case 'pullKnob': case 'pushButton': case 'positionSwitch':
      return new ConsoleControl(g);
    case 'hourmeter':
      return new Hourmeter(g.id, g.bounds);
    case 'digitalTemperature':
      return new DigitalTemperature(g);
    case 'asi':
      return new AirspeedGauge(g.id, g.at[0], g.at[1], r, g.marks);
    case 'attitude':
      return new AttitudeGauge(g.id, g.at[0], g.at[1], r, g.inclinometer ?? false);
    case 'altimeter':
      return new AltimeterGauge(g.id, g.at[0], g.at[1], r);
    case 'turn':
      return new TurnCoordinatorGauge(g.id, g.at[0], g.at[1], r);
    case 'heading':
      return new HeadingGauge(g.id, g.at[0], g.at[1], r);
    case 'vsi':
      return new VerticalSpeedGauge(g.id, g.at[0], g.at[1], r);
    case 'cdi':
      return new CdiGauge(g.id, g.at[0], g.at[1], r, g.receiver, g.fixedCourseDeg);
    case 'hsi':
      return new HsiGauge(g.id, g.at[0], g.at[1], r, g.receiver, g.fixedCourseDeg);
    case 'rmi':
      return new RmiGauge(g.id, g.at[0], g.at[1], r);
    case 'clock':
      return new ClockOatGauge(g.id, g.at[0], g.at[1], r);
    case 'suction':
      return suctionGauge(g.id, g.at[0], g.at[1], r, g.scale);
    case 'ammeter':
      return ammeterGauge(g.id, g.at[0], g.at[1], r, g.scale);
    case 'tach':
      return new TachometerGauge(g.id, g.at[0], g.at[1], r, g.marks, g.size, g.engine);
    case 'dualSector':
      return new DualSectorGauge(g.id, g.bounds, g.left, g.right);
    case 'sector':
      return new SectorGauge(g.id, g.bounds, g.title, g.scale);
    case 'dual':
      return new DualGauge(g.id, g.at[0], g.at[1], r, g.seed, g.title, g.left, g.right);
    case 'single':
      return new SingleGauge(g.id, g.at[0], g.at[1], r, g.seed, g, g.scale, g.size);
    case 'twinNeedle':
      return new TwinNeedleGauge(g.id, g.at[0], g.at[1], r, g.seed, g, g.scale, g.left, g.right, g.size, g.letters);
    case 'flapLever':
      return new FlapIndicator(g.id, g.bounds, g.maxDeg, g.legends, paintLevers);
    case 'gearLights':
      return new GearLights(g.id, g.bounds, g.noseLegend);
    case 'flapLights':
      return new FlapLights(g);
    case 'trimBar':
      return new TrimBar(g.id, g.bounds, g.axis);
    case 'guardedKnob':
      // The emergency gear extension knob latches: it is drawn pulled while ControlInputs says so.
      return new GuardedKnob(g.id, g.at, g.label, (g.action as string) === 'gearEmergency' ? (c) => c.gearEmergency : undefined);
    case 'engineDisplay':
      return new EngineDisplay(g.id, g.bounds, g.engines, g.rows);
    case 'eisWindow':
      return new EisWindow(g);
    case 'gps':
      return new GpsUnit(g.id, g.bounds.x, g.bounds.y, tuning);
    case 'navcom':
      return new NavComRadio(g.id, g.bounds.x, g.bounds.y, tuning);
    case 'xpdr':
      return new Transponder(g.id, g.bounds.x, g.bounds.y, tuning);
  }
}

// ---------------------------------------------------------------------------------------------------
// Static background

const PANEL_GREY = '#44474b';

/** Sub-panel seams of the C172S panel, panel px x: pilot panel | centre stack | right panel. */
export const PANEL_SEAMS_X = C172S_PANEL.background.seamsX;

function paintBackground(g: Ctx2D, def: PanelDef, components: PanelComponent[]): void {
  const W = def.size.w;
  const H = def.size.h;
  const bg = def.background;
  const rand = rng(4242);
  g.save();
  if (bg.outline) {
    g.beginPath();
    bg.outline.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y));
    g.closePath(); g.clip();
  }
  g.fillStyle = bg.color ?? PANEL_GREY;
  g.fillRect(0, 0, W, H);
  for (const plate of bg.plates ?? []) {
    const b = plate.bounds;
    g.fillStyle = plate.color;
    g.beginPath(); g.roundRect(b.x, b.y, b.w, b.h, plate.radius ?? 6); g.fill();
    g.strokeStyle = '#111'; g.lineWidth = 2; g.stroke();
    for (const x of [b.x + 9, b.x + b.w - 9]) for (const y of [b.y + 9, b.y + b.h - 9]) screw(g, x, y, 3, rand);
  }
  // Crinkle-finish paint: tiled grain in overlay mode.
  const grain = g.createPattern(noiseCanvas(256, 256, 17, 0.6), 'repeat');
  if (grain) {
    g.save();
    g.globalCompositeOperation = 'overlay';
    g.globalAlpha = 0.22;
    g.fillStyle = grain;
    g.fillRect(0, 0, W, H);
    g.restore();
  }
  // Large-scale variation: sun-faded and handled areas.
  for (let i = 0; i < 14; i++) {
    const x = rand() * W;
    const y = rand() * H;
    const r = 120 + rand() * 260;
    const blot = g.createRadialGradient(x, y, 0, x, y, r);
    const light = rand() < 0.5;
    blot.addColorStop(0, light ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.04)');
    blot.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = blot;
    g.fillRect(x - r, y - r, 2 * r, 2 * r);
  }

  // Sub-panel seams.
  for (const x of bg.seamsX) {
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.fillRect(x, 30, 2, H - 30);
    g.fillStyle = 'rgba(255,255,255,0.07)';
    g.fillRect(x + 2, 30, 1, H - 30);
    for (let y = 70; y < H - 20; y += 180) {
      screw(g, x - 8, y, 3.2, rand);
      screw(g, x + 11, y, 3.2, rand);
    }
  }
  // Lower edge lip
  const lip = g.createLinearGradient(0, H - 10, 0, H);
  lip.addColorStop(0, 'rgba(255,255,255,0.06)');
  lip.addColorStop(0.3, 'rgba(0,0,0,0.2)');
  lip.addColorStop(1, 'rgba(0,0,0,0.6)');
  g.fillStyle = lip;
  g.fillRect(0, H - 10, W, 10);

  // Avionics rack rails and the blanking plates.
  if (bg.rack) {
    const rails = bg.rack.rails;
    g.fillStyle = '#18191a';
    g.fillRect(rails.x, rails.y, rails.w, rails.h);
    for (const blank of bg.rack.blanks) paintBlankPlate(g, blank);
  }
  paintEngineControls(g, bg.bushings);

  paintRightPanel(g, bg, rand);

  // Instrument cut-out shadows and each component's static artwork.
  for (const c of components) c.drawStatic?.(g);

  // Glareshield overhang: black padded edge and the shade it casts on the upper panel.
  const shade = g.createLinearGradient(0, 24, 0, 190);
  shade.addColorStop(0, 'rgba(0,0,0,0.45)');
  shade.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = shade;
  g.fillRect(0, 24, W, 166);
  const pad = g.createLinearGradient(0, 0, 0, 28);
  pad.addColorStop(0, '#0c0c0d');
  pad.addColorStop(0.75, '#1b1b1c');
  pad.addColorStop(1, '#070707');
  g.fillStyle = pad;
  g.fillRect(0, 0, W, 28);
  g.save();
  g.globalCompositeOperation = 'overlay';
  g.globalAlpha = 0.3;
  if (grain) {
    g.fillStyle = grain;
    g.fillRect(0, 0, W, 28);
  }
  g.restore();
  g.restore();
}

/** The artwork of the C172S right sub-panel under the names it had here: members of its panel definition. */
export const PANEL_PLACARDS = C172S_PANEL.background.placards;
/** Glovebox door, panel px. */
export const PANEL_GLOVEBOX = C172S_PANEL.background.glovebox!;
/** Circuit breakers, row by row: legend and rating, A. */
export const BREAKER_NAMES = C172S_PANEL.background.breakers!.names;
export const BREAKER_AMPS = C172S_PANEL.background.breakers!.amps;
export const BREAKERS_PER_ROW = C172S_PANEL.background.breakers!.perRow;

/** Placards, the glovebox door and the circuit breaker panel. */
function paintRightPanel(g: Ctx2D, bg: PanelDef['background'], rand: () => number): void {
  for (const p of bg.placards) paintPlacard(g, p.x, p.y, p.lines, p.size);

  if (bg.glovebox) paintGlovebox(g, bg.glovebox);
  if (bg.breakers) paintBreakers(g, bg.breakers, rand);
}

/** Glovebox door with latch and lock. */
function paintGlovebox(g: Ctx2D, door: Rect): void {
  const gx = door.x;
  const gy = door.y;
  const gw = door.w;
  const gh = door.h;
  g.fillStyle = 'rgba(0,0,0,0.5)';
  g.beginPath();
  g.roundRect(gx - 3, gy - 3, gw + 6, gh + 6, 10);
  g.fill();
  const face = g.createLinearGradient(0, gy, 0, gy + gh);
  face.addColorStop(0, '#3e4043');
  face.addColorStop(1, '#303235');
  g.fillStyle = face;
  g.beginPath();
  g.roundRect(gx, gy, gw, gh, 9);
  g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.08)';
  g.lineWidth = 1;
  g.stroke();
  g.fillStyle = '#141415';
  g.beginPath();
  g.roundRect(gx + gw / 2 - 40, gy + 14, 80, 18, 8);
  g.fill();
  const latch = g.createLinearGradient(0, gy + 16, 0, gy + 30);
  latch.addColorStop(0, '#8b8d90');
  latch.addColorStop(1, '#3d3e40');
  g.fillStyle = latch;
  g.beginPath();
  g.roundRect(gx + gw / 2 - 34, gy + 17, 68, 11, 5);
  g.fill();
  g.fillStyle = '#b6b8bb';
  g.beginPath();
  g.arc(gx + gw / 2 + 58, gy + 23, 6, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#222';
  g.fillRect(gx + gw / 2 + 57, gy + 19, 2, 8);
}

/**
 * Circuit breaker panel, in rows of `perRow` (on the C172S: lower right corner, clear of the flap slot and the right
 * yoke). A breaker named '' is an empty slot. With `split`, each row continues on a second plate across the gap.
 */
function paintBreakers(g: Ctx2D, breakers: NonNullable<PanelDef['background']['breakers']>, rand: () => number): void {
  const cb = breakers.bounds;
  const perRow = breakers.perRow;
  const split = breakers.split;
  if (!split) {
    paintBreakerPlate(g, cb, breakers, 0, perRow, rand);
    return;
  }
  // Plate widths in proportion to their breakers.
  const left = Math.round(((cb.w - split.gap) * split.after) / perRow);
  paintBreakerPlate(g, { ...cb, w: left }, breakers, 0, split.after, rand);
  paintBreakerPlate(g, { ...cb, x: cb.x + left + split.gap, w: cb.w - left - split.gap }, breakers, split.after, perRow - split.after, rand);
}

/** One plate of breakers: columns `from` .. `from + count - 1` of every row. */
function paintBreakerPlate(g: Ctx2D, cb: Rect, breakers: NonNullable<PanelDef['background']['breakers']>, from: number, count: number, rand: () => number): void {
  const amps = breakers.amps;
  g.fillStyle = 'rgba(0,0,0,0.45)';
  g.beginPath();
  g.roundRect(cb.x - 1, cb.y + 1, cb.w + 2, cb.h + 2, 5);
  g.fill();
  g.fillStyle = '#1b1c1d';
  g.beginPath();
  g.roundRect(cb.x, cb.y, cb.w, cb.h, 4);
  g.fill();
  const perRow = breakers.perRow;
  const dx = (cb.w - 44) / Math.max(1, count - 1);
  breakers.names.forEach((n, i) => {
    const col = (i % perRow) - from;
    // An empty legend is an empty slot: the grid keeps its place, nothing is painted.
    if (!n || col < 0 || col >= count) return;
    const x = cb.x + 22 + col * dx;
    const y = cb.y + 22 + Math.floor(i / perRow) * 54;
    g.font = `600 7.5px ${LABEL_FONT}`;
    g.fillStyle = '#e4e2da';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(n, x, y - 12);
    g.fillStyle = 'rgba(0,0,0,0.6)';
    g.beginPath();
    g.arc(x + 1, y + 10, 10, 0, Math.PI * 2);
    g.fill();
    const collar = g.createRadialGradient(x - 3, y + 5, 1, x, y + 8, 10);
    collar.addColorStop(0, '#f4f3ee');
    collar.addColorStop(1, '#8c8b86');
    g.fillStyle = collar;
    g.beginPath();
    g.arc(x, y + 8, 9, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#121212';
    g.beginPath();
    g.arc(x, y + 8, 5, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#e4e2da';
    g.font = `600 7px ${LABEL_FONT}`;
    g.fillText(String(amps[i]), x + 16, y + 16);
  });
  screw(g, cb.x + 7, cb.y + cb.h / 2, 3, rand);
  screw(g, cb.x + cb.w - 7, cb.y + cb.h / 2, 3, rand);
}
