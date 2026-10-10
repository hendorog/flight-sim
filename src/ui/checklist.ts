// Compact reference panel in every view. Separate progress from the instructor's graded checklist:
// checking a reference item never acknowledges a lesson or operates an aircraft control.
import type { SimContext } from '../core/context';
import { ChecklistSession, type ChecklistTab } from './checklistModel';
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
    close.addEventListener('click', () => { this.opened = false; this.renderVisibility(false); close.blur(); });
    const tabs = el('div', 'checklist-tabs', this.root);
    for (const tab of ['normal', 'emergency'] as const) {
      const button = el('button', '', tabs, tab === 'normal' ? 'Normal' : 'Emergency');
      this.tabs.set(tab, button);
      button.addEventListener('click', () => { this.model?.changeTab(tab); this.render(); button.blur(); });
    }
    this.selector = el('select', '', this.root);
    this.selector.setAttribute('aria-label', 'Checklist section');
    this.selector.addEventListener('change', () => { this.model?.select(this.selector.value); this.render(); this.selector.blur(); });
    this.note = el('div', 'checklist-note', this.root);
    this.items = el('div', 'checklist-items', this.root);
    const nav = el('div', 'checklist-nav', this.root);
    this.previous = el('button', '', nav, '← Previous');
    this.progress = el('span', '', nav);
    this.next = el('button', '', nav, 'Next →');
    for (const [button, delta] of [[this.previous, -1], [this.next, 1]] as const) button.addEventListener('click', () => {
      this.model?.move(delta); this.render(); button.blur();
    });
    const foot = el('div', 'checklist-foot', this.root);
    el('span', '', foot, 'AUTO = live state · HAND = your check');
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
  toggle(): void { this.opened = !this.opened; this.renderVisibility(false); }
  open(section?: string, item?: string): void {
    if (section) this.model?.select(section, item ?? null);
    this.opened = true; this.render(); this.renderVisibility(false);
    const row = this.rows.find(r => r.id === item);
    row?.row.scrollIntoView?.({ block: 'nearest' });
  }
  reset(): void { this.model?.reset(); this.renderMarks(); }
  update(ctx: SimContext, hidden: boolean): void {
    this.renderVisibility(hidden);
    if (!this.opened || hidden || performance.now() - this.lastUpdate < 100) return;
    this.lastUpdate = performance.now();
    this.model?.update(ctx); this.renderMarks();
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
