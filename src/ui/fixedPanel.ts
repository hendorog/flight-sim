import { drawMagneticCompass } from '../instruments/render/magneticCompass';
import type { SimContext } from '../core/context';
import type { InstrumentPanel } from '../instruments/panel';
import type { PanelDef } from '../instruments/panelDef';
import { fixedSections, fitPanel, fixedPanelPoint, fixedPanelClient, isFixedPanel, type FixedSection, type PanelFit, type PanelView } from '../instruments/fixedPanel';
import { el } from './dom';

/** A native-resolution canvas copy, outside the WebGL render scale, tone mapping and temporal AA. */
export class FixedPanel {
  readonly root: HTMLDivElement;
  readonly canvas: HTMLCanvasElement;
  private readonly bar: HTMLDivElement;
  private readonly g: CanvasRenderingContext2D;
  private readonly sections;
  private readonly buttons = new Map<PanelView, HTMLButtonElement>();
  private source: InstrumentPanel | null = null;
  private section: FixedSection | null = null;
  private fit: PanelFit | null = null;
  private lastLayout = '';
  private lastVersion = -1;
  private lastCompass = '';

  constructor(private readonly parent: HTMLElement, def: PanelDef, private readonly ctx: SimContext) {
    this.sections = fixedSections(def);
    this.root = el('div', 'fixed-panel hidden', parent);
    this.root.addEventListener('contextmenu', e => e.preventDefault());
    this.bar = el('div', 'fixed-panel-bar', this.root);
    for (const [view, label] of [['upper', 'Upper'], ['lower', 'Lower'], ['hidden', 'Panel hidden'], ['3d', '3D cockpit']] as const) {
      const b = el('button', '', this.bar, label);
      b.type = 'button';
      b.addEventListener('click', () => { ctx.commands.setPanelView?.(view); b.blur(); });
      this.buttons.set(view, b);
    }
    el('span', '', this.bar, 'Shift+V: 3D / fixed · ]: section · Forward view (look / zoom in 3D)');
    this.canvas = el('canvas', '', this.root);
    this.canvas.setAttribute('aria-label', 'Fixed instrument panel');
    this.g = this.canvas.getContext('2d')!;
    window.addEventListener('resize', this.layout);
    this.layout();
  }

  setSource(panel: InstrumentPanel): void { this.source = panel; }
  get active(): boolean { return isFixedPanel(this.ctx); }
  get top(): number | null { return this.active ? this.fit ? this.fit.top - 32 : window.innerHeight - 32 : null; }
  contains(_x: number, y: number): boolean { return this.top !== null && y >= this.top; }
  point(x: number, y: number): [number, number] | null {
    return this.active && this.section && this.fit ? fixedPanelPoint(this.section, this.fit, x, y) : null;
  }
  client(x: number, y: number): [number, number] | null {
    return this.active && this.section && this.fit ? fixedPanelClient(this.section, this.fit, x, y) : null;
  }

  readonly layout = (): void => {
    const active = this.active;
    const view = this.ctx.panelView ?? '3d';
    const w = window.innerWidth, h = window.innerHeight, dpr = window.devicePixelRatio || 1;
    const key = `${active}/${view}/${w}/${h}/${dpr}`;
    if (key === this.lastLayout) return;
    this.lastLayout = key;
    this.lastVersion = -1;
    this.root.classList.toggle('hidden', !active);
    this.parent.classList.toggle('has-fixed-panel', active);
    this.section = active && (view === 'upper' || view === 'lower') ? this.sections[view] : null;
    this.fit = this.section ? fitPanel(this.section, w, h, view === 'lower', dpr) : null;
    const panelHeight = active ? (this.fit?.height ?? 0) + 32 : 0;
    this.ctx.fixedPanelHeight = panelHeight;
    this.parent.style.setProperty('--fixed-panel-height', `${panelHeight}px`);
    this.root.style.height = `${panelHeight}px`;
    this.canvas.style.display = this.fit ? 'block' : 'none';
    if (this.fit) {
      this.canvas.width = Math.max(1, Math.round(this.fit.width * dpr));
      this.canvas.height = Math.max(1, Math.round(this.fit.height * dpr));
      this.canvas.style.width = `${this.fit.width}px`;
      this.canvas.style.height = `${this.fit.height}px`;
      this.canvas.style.marginLeft = `${this.fit.left}px`;
      // The panel hangs from the bottom of the window, whose height in CSS px can be fractional (innerHeight is
      // rounded): take the canvas's real top so the mouse mapping matches the pixels.
      const box = active ? this.canvas.getBoundingClientRect() : null;
      if (box && box.height > 0) this.fit.top = box.top;
    }
    for (const [v, b] of this.buttons) b.setAttribute('aria-pressed', String(v === view));
  };

  update(): void {
    this.layout();
    if (!this.section || !this.fit || !this.source) return;
    const compass = this.source.instruments.readings.compass;
    const compassKey = `${compass.heading.toFixed(4)}/${compass.roll.toFixed(4)}/${compass.pitch.toFixed(4)}`;
    if (this.lastVersion === this.source.version && this.lastCompass === compassKey) return;
    this.lastCompass = compassKey;
    this.lastVersion = this.source.version;
    const g = this.g;
    g.setTransform(this.canvas.width / this.section.size.w, 0, 0, this.canvas.height / this.section.size.h, 0, 0);
    g.fillStyle = '#252b2b';
    g.fillRect(0, 0, this.section.size.w, this.section.size.h);
    for (const { source: s, target: t } of this.section.panes) {
      g.drawImage(this.source.canvas, s.x, s.y, s.w, s.h, t.x, t.y, t.w, t.h);
    }
    if (this.section.compass) drawMagneticCompass(g, compass, this.section.compass, this.ctx.state.aircraft);
  }

  dispose(): void { window.removeEventListener('resize', this.layout); this.root.remove(); }
}

export const FIXED_PANEL_CSS = /* css */ `
#fsui .fixed-panel { position:absolute; bottom:0; left:0; right:0; background:#252b2b; pointer-events:auto; }
#fsui .fixed-panel-bar { height:32px; display:flex; align-items:center; gap:6px; padding:0 10px; background:#111c23; border-top:1px solid #75919f; box-sizing:border-box; }
#fsui .fixed-panel-bar button { padding:3px 9px; border:1px solid #69818b; border-radius:4px; background:#24353e; color:#e5f0f5; font:12px system-ui; cursor:pointer; white-space:nowrap; }
#fsui .fixed-panel-bar button[aria-pressed=true] { background:#c4e7f3; color:#132934; }
#fsui .fixed-panel-bar span { color:#c2d0d8; font:11px system-ui; margin-left:auto; }
#fsui.has-fixed-panel .flight-cues, #fsui.has-fixed-panel .hints { bottom:calc(var(--fixed-panel-height) + 10px); }
#fsui.has-fixed-panel .flight-cues { max-height:110px; overflow:auto; }
#fsui.has-fixed-panel .toasts { bottom:calc(var(--fixed-panel-height) + 16px); }
#fsui.has-fixed-panel .sc-captions { bottom:calc(var(--fixed-panel-height) + 60px); }
#fsui.has-fixed-panel .flight-checklist { max-height:calc(100vh - var(--fixed-panel-height) - 70px); overflow:auto; gap:4px; }
#fsui.has-fixed-panel .flight-checklist > * { flex-shrink:0; }
#fsui.has-fixed-panel .checklist-note { max-height:32px; }
#fsui.has-fixed-panel .checklist-items { flex:0 1 auto; min-height:70px; }
#fsui.has-fixed-panel .sc-lcard { max-height:calc(100vh - var(--fixed-panel-height) - 150px); overflow:auto; }
#fsui.has-fixed-panel .hints { max-height:calc(100vh - var(--fixed-panel-height) - 32px); }
@media (max-width:1000px) { #fsui .fixed-panel-bar span { display:none; } }
`;
