// Flat views are arrangements of crops from the ONE live panel canvas. All positions stay in native
// panel pixels until the final uniform fit to the window; this same transform routes mouse operations.
import { gaugeParts, panelParts } from './panelParts';
import type { PanelDef, Rect } from './panelDef';

export type PanelView = '3d' | 'upper' | 'lower' | 'hidden';
export type PanelSection = 'upper' | 'lower';
export interface PanelPane { source: Rect; target: Rect }
export interface FixedSection { size: { w: number; h: number }; panes: PanelPane[] }
export type FixedSections = Record<PanelSection, FixedSection>;
export interface PanelFit { left: number; top: number; scale: number; width: number; height: number }
const GAP = 8;

export function nextPanelSection(view: PanelView): PanelView {
  return view === 'upper' ? 'lower' : view === 'lower' ? 'hidden' : 'upper';
}
export function isFixedPanel(ctx: { cameraMode: string; panelView?: PanelView }): boolean {
  return ctx.cameraMode === 'cockpit' && !!ctx.panelView && ctx.panelView !== '3d';
}

/** No type-id switches. A future type can supply its rows and control crops in its PanelDef. */
export function fixedSections(def: PanelDef): FixedSections {
  const upper: FixedSection = { size: { w: 0, h: 0 }, panes: [] };
  const lower: FixedSection = { size: { w: 0, h: 0 }, panes: [] };
  const parts = new Map(def.gauges.flatMap(g => gaugeParts(g, def.apertures, def.instrumentScale)).map(p => [p.id, p.rect]));
  const rows = def.fixed?.flightRows ?? [
    def.gauges.filter(g => ['asi', 'attitude', 'altimeter', 'rotorTach'].includes(g.kind)).map(g => g.id),
    def.gauges.filter(g => ['turn', 'heading', 'vsi', 'cdi'].includes(g.kind)).map(g => g.id),
  ];
  const flight = new Set(rows.flat());
  const add = (section: FixedSection, source: Rect, x: number, y: number): void => {
    section.panes.push({ source, target: { x, y, w: source.w, h: source.h } });
    section.size.w = Math.max(section.size.w, x + source.w + GAP);
    section.size.h = Math.max(section.size.h, y + source.h + GAP);
  };
  const cell = Math.max(184, ...rows.flat().map(id => parts.get(id)?.w ?? 0)) + GAP;
  rows.forEach((row, y) => row.forEach((id, x) => {
    const p = parts.get(id);
    if (p) add(upper, p, GAP + x * cell, GAP + y * cell);
  }));
  // Engine/auxiliary instruments in short columns beside the flight instruments. Never shrink an
  // individual gauge: the whole section has one scale, including its hotspot boxes.
  const engineKinds = ['tach', 'single', 'dual', 'twinNeedle', 'dualSector', 'suction', 'ammeter', 'clock', 'digitalTemperature', 'engineDisplay'];
  const engine = def.gauges.filter(g => !flight.has(g.id) && engineKinds.includes(g.kind));
  const columns = (section: FixedSection, rects: readonly Rect[], startX: number, height: number): void => {
    let x = startX, y = GAP, width = 0;
    for (const p of rects) {
      if (y > GAP && y + p.h > height) { x += width + GAP; y = GAP; width = 0; }
      add(section, p, x, y);
      y += p.h + GAP;
      width = Math.max(width, p.w);
    }
  };
  columns(upper, engine.flatMap(g => gaugeParts(g, def.apertures, def.instrumentScale).map(p => p.rect)), upper.size.w, Math.max(400, upper.size.h));
  // Lamps may be scattered around a helicopter pod. Their explicit cells keep unrelated blank canvas
  // out of the fixed view, while retaining every warning, in the original order.
  const lamps = def.annunciator ? def.annunciator.cells ?? [def.annunciator.bounds] : [];
  let lampX = GAP;
  const lampY = upper.size.h;
  for (const p of lamps) { add(upper, p, lampX, lampY); lampX += p.w + GAP; }
  const engineIds = new Set(engine.map(g => g.id));
  const controls = def.fixed?.controls ?? panelParts(def).filter(p => p.id === 'switches' || p.id === 'ignition').map(p => p.rect);
  const radios = def.gauges.filter(g => g.kind === 'gps' || g.kind === 'navcom' || g.kind === 'xpdr');
  const radioIds = new Set(radios.map(g => g.id));
  const radioRects = radios.flatMap(g => gaugeParts(g, def.apertures, def.instrumentScale).map(p => p.rect));
  // Keep NAV1/NAV2 and the transponder together in their original order. Shelf-packing individual
  // units could put NAV1 under a flap lever and NAV2 at the top of the next column.
  const stack: Rect[] = [];
  if (radioRects.length) {
    const x = Math.min(...radioRects.map(r => r.x)), y = Math.min(...radioRects.map(r => r.y));
    stack.push({ x, y, w: Math.max(...radioRects.map(r => r.x + r.w)) - x, h: Math.max(...radioRects.map(r => r.y + r.h)) - y });
  }
  columns(lower, [...controls, ...def.gauges.filter(g => !flight.has(g.id) && !engineIds.has(g.id) && !radioIds.has(g.id))
    .flatMap(g => gaugeParts(g, def.apertures, def.instrumentScale).map(p => p.rect)), ...stack], GAP, 420);
  return { upper, lower };
}

/** CSS pixels. Keep at least half the screen for the outside view in Upper; Lower may use 55%. */
export function fitPanel(section: FixedSection, width: number, height: number, lower = false): PanelFit {
  const scale = Math.max(0, Math.min(width / section.size.w, (height * (lower ? 0.55 : 0.48) - 32) / section.size.h, 1.5));
  const w = section.size.w * scale, h = section.size.h * scale;
  return { left: (width - w) / 2, top: height - h, scale, width: w, height: h };
}
const contains = (r: Rect, x: number, y: number): boolean => x >= r.x && y >= r.y && x <= r.x + r.w && y <= r.y + r.h;

export function fixedPanelPoint(section: FixedSection, fit: PanelFit, clientX: number, clientY: number): [number, number] | null {
  if (!fit.scale) return null;
  const x = (clientX - fit.left) / fit.scale, y = (clientY - fit.top) / fit.scale;
  const p = section.panes.find(p => contains(p.target, x, y));
  return p ? [p.source.x + x - p.target.x, p.source.y + y - p.target.y] : null;
}
export function fixedPanelClient(section: FixedSection, fit: PanelFit, x: number, y: number): [number, number] | null {
  const p = section.panes.find(p => contains(p.source, x, y));
  return p ? [fit.left + (p.target.x + x - p.source.x) * fit.scale, fit.top + (p.target.y + y - p.source.y) * fit.scale] : null;
}
