// The push-to-talk menu and the radio window (docs/atc.md): Space opens the calls that fit the moment, R the
// tuning (stations to quick-select, flip-flop, MIC selector), each over the flight view with its keys; a key or a
// click picks an item. Built by RadioSystem, mounted on the UI's school layer.

import { el } from './dom';

export interface RadioMenuItem {
  label: string;
  /** The transmission as captioned (or the station's distance), shown under the label. */
  detail: string;
  /** The key cap shown (default: the item's number). */
  key?: string;
  /** Marked as the current choice (the active frequency, the MIC's COM). */
  on?: boolean;
}

export class RadioMenu {
  readonly root: HTMLDivElement;
  private readonly head: HTMLElement;
  private readonly status: HTMLElement;
  private readonly list: HTMLElement;
  private readonly note: HTMLElement;
  private key = '';
  private statusKey = '';

  constructor(parent: HTMLElement, private readonly onPick: (i: number) => void) {
    this.root = el('div', 'radio-menu hidden', parent);
    this.head = el('div', 'radio-menu-head', this.root);
    this.status = el('div', 'radio-menu-status', this.root);
    this.list = el('div', 'radio-menu-list', this.root);
    this.note = el('div', 'radio-menu-note', this.root);
  }

  get open(): boolean {
    return !this.root.classList.contains('hidden');
  }

  /** Show (or refresh) the menu; the DOM is rebuilt only when the items change. */
  show(title: string, items: readonly RadioMenuItem[], note: string, status: readonly { text: string; on: boolean }[] = [], compact = false): void {
    this.root.classList.remove('hidden');
    // The radio window's rows are one line each (label, then the detail), to keep it short.
    this.root.classList.toggle('compact', compact);
    this.head.textContent = title;
    this.note.textContent = note;
    const st = status.map((l) => `${l.on ? '>' : ' '}${l.text}`).join('|');
    if (st !== this.statusKey) {
      this.statusKey = st;
      this.status.replaceChildren();
      for (const l of status) el('div', l.on ? 'on' : '', this.status, l.text);
    }
    const key = items.map((i) => `${i.key ?? ''}${i.on ? '*' : ''}${i.label}${i.detail}`).join('|');
    if (key === this.key) return;
    this.key = key;
    this.list.replaceChildren();
    items.forEach((item, i) => {
      const b = el('button', item.on ? 'radio-call on' : 'radio-call', this.list);
      el('kbd', '', b, item.key ?? String(i + 1));
      const t = el('span', '', b);
      el('b', '', t, item.label);
      el('small', '', t, item.detail);
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onPick(i);
      });
    });
  }

  hide(): void {
    this.root.classList.add('hidden');
  }
}

export const RADIO_MENU_CSS = `
#fsui .radio-menu { position: absolute; left: 50%; bottom: 120px; transform: translateX(-50%); width: min(520px, calc(100vw - 32px));
  padding: 10px 12px 10px; border-radius: 12px; background: rgba(10,14,20,.84); backdrop-filter: blur(10px);
  border: 1px solid var(--line); box-shadow: 0 6px 24px rgba(0,0,0,.35); pointer-events: auto; }
#fsui .radio-menu-head { font-size: 10px; letter-spacing: .14em; color: #ffc34d; font-weight: 700; margin-bottom: 6px; text-transform: uppercase; }
#fsui .radio-menu-list { display: flex; flex-direction: column; gap: 4px; }
#fsui .radio-call { display: flex; align-items: flex-start; gap: 10px; text-align: left; padding: 6px 8px; border-radius: 8px;
  background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.06); color: var(--fg); cursor: pointer; }
#fsui .radio-call:hover { background: rgba(82,195,255,.14); border-color: rgba(82,195,255,.4); }
#fsui .radio-call kbd { flex: none; min-width: 18px; text-align: center; font: 700 12px/18px ui-monospace, Menlo, Consolas, monospace;
  border-radius: 4px; background: rgba(255,255,255,.12); }
#fsui .radio-call b { display: block; font-size: 13px; }
#fsui .radio-call small { display: block; font-size: 11.5px; color: var(--fg-dim); }
#fsui .radio-call.on { border-color: rgba(255,195,77,.55); }
#fsui .radio-menu-status { display: flex; gap: 14px; margin-bottom: 6px; font: 12px/18px ui-monospace, Menlo, Consolas, monospace; color: var(--fg-dim); }
#fsui .radio-menu-status:empty { display: none; }
#fsui .radio-menu-status .on { color: var(--fg); }
#fsui .radio-menu.compact .radio-call { padding: 3px 8px; align-items: center; }
#fsui .radio-menu.compact .radio-call span { display: flex; align-items: baseline; gap: 10px; flex: 1; }
#fsui .radio-menu.compact .radio-call small { margin-left: auto; text-align: right; }
#fsui .radio-menu-note { margin-top: 6px; font-size: 11px; color: var(--fg-dim); }
`;
