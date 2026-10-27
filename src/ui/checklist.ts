// Compact reference panel in every view. Separate progress from the instructor's graded checklist:
// checking a reference item never acknowledges a lesson or operates an aircraft control. The panel follows the
// flight: it shows the list for the current phase (phaseSection), F opens it there and Shift+F steps on; a list
// picked by hand stays until the phase changes.
import type { SimContext } from '../core/context';
import { ChecklistSession, newPhaseMemory, phaseSection, resolvePhase, type ChecklistTab } from './checklistModel';
import { el, setText } from './dom';

export class ChecklistPanel {
  readonly root: HTMLElement;
  readonly launcher: HTMLButtonElement;
  private readonly name: HTMLElement;
  private readonly selector: HTMLSelectElement;
  private readonly items: HTMLElement;
  private readonly source: HTMLElement;
  private readonly note: HTMLElement;
  private readonly progress: HTMLElement;
  private readonly previous: HTMLButtonElement;
  private readonly next: HTMLButtonElement;
  private readonly tabs = new Map<ChecklistTab, HTMLButtonElement>();
  private rows: { id: string; row: HTMLElement; box: HTMLInputElement; mode: HTMLElement }[] = [];
  private model: ChecklistSession | null = null;
  private opened = false;
  private rendered = '';
  private lastUpdate = -Infinity;
  private readonly phaseMemory = newPhaseMemory();
  /** The phase list in force (shown unless the pilot picked another since it came in), and a candidate with its first sight. */
  private phase: string | null = null;
  private candidate: { id: string | null; since: number } = { id: null, since: 0 };
  private followed = true;
  /** Opened on a list a lesson or a demonstration asked for: it stays until F, Shift+F or the close button. */
  private linked = false;

  constructor(parent: HTMLElement) {
    this.launcher = el('button', 'checklist-launch', parent, 'Checklist · F');
    this.launcher.setAttribute('aria-controls', 'flight-checklist');
    this.launcher.addEventListener('click', () => { this.toggle(); this.launcher.blur(); });
    this.root = el('section', 'flight-checklist hidden', parent);
    this.root.id = 'flight-checklist';
    this.root.setAttribute('aria-label', 'Aircraft checklist');
    const head = el('div', 'checklist-head', this.root);
    this.name = el('strong', '', head, 'Checklist');
    const close = el('button', '', head, '×');
    close.setAttribute('aria-label', 'Close checklist');
    close.addEventListener('click', () => { this.opened = false; this.linked = false; this.renderVisibility(false); close.blur(); });
    const tabs = el('div', 'checklist-tabs', this.root);
    for (const tab of ['normal', 'emergency'] as const) {
      const button = el('button', '', tabs, tab === 'normal' ? 'Normal' : 'Emergency');
      this.tabs.set(tab, button);
      button.addEventListener('click', () => { this.model?.changeTab(tab); this.followed = false; this.render(); button.blur(); });
    }
    this.selector = el('select', '', this.root);
    this.selector.setAttribute('aria-label', 'Checklist section');
    this.selector.addEventListener('change', () => { this.model?.select(this.selector.value); this.followed = false; this.render(); this.selector.blur(); });
    this.note = el('div', 'checklist-note', this.root);
    this.items = el('div', 'checklist-items', this.root);
    const nav = el('div', 'checklist-nav', this.root);
    this.previous = el('button', '', nav, '← Previous');
    this.progress = el('span', '', nav);
    this.next = el('button', '', nav, 'Next →');
    for (const [button, delta] of [[this.previous, -1], [this.next, 1]] as const) button.addEventListener('click', () => {
      this.model?.move(delta); this.followed = false; this.render(); button.blur();
    });
    const foot = el('div', 'checklist-foot', this.root);
    el('span', '', foot, 'Follows the flight · Shift+F next list · AUTO = live state · HAND = your check');
    const reset = el('button', '', foot, 'Reset all');
    reset.title = 'Clear all manual marks; automatic marks follow current state';
    reset.addEventListener('click', () => { this.model?.reset(); this.renderMarks(); reset.blur(); });
    this.source = el('div', 'checklist-source', this.root);
    // The panel takes its own pointer events, including the wheel. Flight keys work again after clicking.
    this.root.addEventListener('pointerdown', e => e.stopPropagation());
    this.root.addEventListener('wheel', e => e.stopPropagation());
    this.root.addEventListener('keydown', e => {
      if (e.code !== 'KeyF' && e.code !== 'Escape') e.stopPropagation();
    });
  }

  init(ctx: SimContext): void {
    this.model = new ChecklistSession(ctx.presentation?.training, ctx.aircraft.id, ctx.aircraft.engineCount, ctx.aircraft.placeholder);
    setText(this.name, `${ctx.aircraft.shortName} checklist`);
    this.render();
  }
  get isOpen(): boolean { return this.opened; }
  /** F: opens on the list for the current phase, or closes. */
  toggle(): void {
    if (this.opened) { this.opened = false; this.linked = false; this.renderVisibility(false); } else this.open();
  }
  /** Shift+F while open: the next list (the emergency lists after the normal ones); it stays until the phase changes. */
  step(): void { this.model?.step(); this.followed = false; this.linked = false; this.render(); this.scrollToCurrent(); }
  open(section?: string, item?: string): void {
    if (section) { this.model?.select(section, item ?? null); this.followed = false; this.linked = true; } else { this.linked = false; this.follow(true); }
    this.opened = true; this.render(); this.renderVisibility(false);
    const row = this.rows.find(r => r.id === item);
    row?.row.scrollIntoView?.({ block: 'nearest' });
  }
  reset(): void {
    this.model?.reset(); Object.assign(this.phaseMemory, newPhaseMemory());
    this.phase = null; this.candidate = { id: null, since: 0 }; this.followed = !this.linked;
    this.renderMarks();
  }
  update(ctx: SimContext, hidden: boolean): void {
    this.renderVisibility(hidden);
    const now = performance.now();
    if (now - this.lastUpdate < 100) return;
    this.lastUpdate = now;
    this.trackPhase(ctx, now);
    if (!this.opened || hidden) return;
    if (this.follow(false)) { this.render(); this.scrollToCurrent(); }
    this.model?.update(ctx); this.renderMarks();
  }
  /** A new phase takes over once it has held for 2 s (a bounce or a gust does not flip the list); an engine failure at once. */
  private trackPhase(ctx: SimContext, now: number): void {
    const m = this.model; if (!m) return;
    const id = resolvePhase(phaseSection(ctx, this.phaseMemory), m.sections.map(s => s.id));
    if (id !== this.candidate.id) this.candidate = { id, since: now };
    const urgent = m.sections.find(s => s.id === id)?.category === 'emergency';
    if (id !== this.phase && (urgent || now - this.candidate.since >= 2000)) { this.phase = id; this.followed = !this.linked; }
  }
  /** Shows the phase list if the panel is following (or `force`); true if the section changed. */
  private follow(force: boolean): boolean {
    const m = this.model;
    if (force) this.followed = true;
    if (!m || !this.followed || !this.phase || m.sectionId === this.phase) return false;
    m.select(this.phase); return true;
  }
  private scrollToCurrent(): void {
    const current = this.model?.currentItem;
    this.rows.find(r => r.id === current)?.row.scrollIntoView?.({ block: 'nearest' });
  }
  private renderVisibility(hidden: boolean): void {
    this.root.classList.toggle('hidden', hidden || !this.opened);
    this.launcher.classList.toggle('hidden', hidden || this.opened);
    this.launcher.setAttribute('aria-expanded', String(this.opened));
  }
  private render(): void {
    const m = this.model, section = m?.section;
    const key = `${m?.tab}/${m?.sectionId}`;
    if (key !== this.rendered) {
      this.rendered = key; this.items.replaceChildren(); this.selector.replaceChildren(); this.rows = [];
      for (const s of m?.available ?? []) el('option', '', this.selector, s.title).value = s.id;
      this.selector.value = section?.id ?? '';
      this.selector.disabled = !section;
      setText(this.note, section?.note ?? 'Condensed simulator reference · manual checks need your judgement.');
      if (!section) el('p', '', this.items, 'No aircraft-specific checklist is available for this type.');
      for (const item of section?.items ?? []) {
        const row = el('label', 'checklist-item', this.items);
        row.dataset.item = item.id;
        const box = el('input', '', row); box.type = 'checkbox';
        const text = el('span', '', row);
        el('b', '', text, item.challenge); el('span', '', text, item.response);
        const mode = el('small', '', row);
        box.addEventListener('change', () => { m!.toggle(item.id); this.renderMarks(); box.blur(); });
        this.rows.push({ id: item.id, row, box, mode });
      }
      this.items.scrollTop = 0;
      this.source.replaceChildren();
      if (section?.sourceUrl) {
        const link = el('a', '', this.source, section.source ?? 'POH source');
        link.href = section.sourceUrl; link.target = '_blank'; link.rel = 'noopener noreferrer';
      } else setText(this.source, section ? 'Aircraft training checklist · POH / school procedures' : 'Checklist data unavailable; no substitute aircraft procedures shown.');
    }
    for (const [tab, button] of this.tabs) button.setAttribute('aria-pressed', String(m?.tab === tab));
    const index = m?.available.findIndex(s => s.id === m.sectionId) ?? -1;
    this.previous.disabled = index <= 0;
    this.next.disabled = index < 0 || index >= (m?.available.length ?? 0) - 1;
    this.renderMarks();
  }
  private renderMarks(): void {
    const m = this.model; if (!m) return;
    let count = 0;
    for (const r of this.rows) {
      const mark = m.mark(r.id); if (mark.done) count++;
      r.box.checked = mark.done;
      r.row.classList.toggle('done', mark.done);
      r.row.classList.toggle('current', m.currentItem === r.id);
      r.row.classList.toggle('automatic', mark.mode === 'auto');
      r.row.setAttribute('aria-current', String(m.currentItem === r.id));
      setText(r.mode, mark.mode === 'auto' ? 'AUTO' : 'HAND');
      r.mode.title = mark.overridden ? 'Manual override; Reset all restores live checks' : mark.mode === 'auto' ? 'Checked against current simulator state' : 'Confirm manually';
    }
    setText(this.progress, `${count} / ${this.rows.length}`);
  }
}
