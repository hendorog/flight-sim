// The Career UI (docs/career.md "UI pages"): mounts in UISystem's school layer (as the radio menu does), with its
// own stylesheet (CAREER_CSS, `<style id="fsui-career-style">`; the school's SCHOOL_CSS is injected too when the
// school has not done it, for its tokens and shared classes), and shows one modal page at a time (locked, create,
// seed, hub, reposition, board, dispatch, fleet, pilot, logbook, debrief, stop, bankrupt) plus the in-flight job
// strip. User actions leave through onCommand as CareerCommand.
//
// Wiring (CareerSystem, wave 3):
//   const ui = new CareerUi(shell.ui.schoolLayer);
//   ui.onCommand = (cmd) => system.command(cmd);
//   ui.onScreenChange = (open) => shell.setCareerHold(open);      // every Career page holds the sim
//   ui.setModel(model);            // whenever the save, board, fields or flags change (re-renders the open page)
//   ui.open('hub'); ui.close();    // modalLink: { screenOpen: () => ui.screenOpen() }
//   ui.setStrip(strip, { canAbandon });                             // every frame while a job is active; null hides
//
// Navigation that is the UI's own happens here at once: 'open' opens the page (hub by default), 'close' and
// 'freeFlight' close the pages, 'dispatch' opens the dispatch page for that offer; the command is then passed on
// so the system can act on it too. Every other command waits for the system, which answers with setModel and,
// where the page changes (create -> hub, accept -> close, settle -> debrief), open() or close().
//
// Keyboard: while a page is open, CareerUi captures keys on window so the flight controls never see them (text
// fields keep their characters; Enter commits, Esc leaves the field); Escape goes back, Enter is the page's
// primary action, F1-F6 and Tab are swallowed. Buttons never keep focus.

import { el } from '../../ui/dom';
import { SCHOOL_CSS } from '../../ui/school/schoolStyles';
import { typing } from '../../ui/school/widgets';
import { isBankrupt } from '../progression';
import type { CareerCommand, JobStripModel } from '../types';
import { renderBankrupt } from './bankrupt';
import { renderBoard } from './board';
import { renderCreate } from './create';
import { renderDebrief } from './debrief';
import { renderDispatch } from './dispatch';
import { renderFleet } from './fleet';
import { renderHub } from './hub';
import { renderLocked } from './locked';
import { renderLogbook } from './logbook';
import type { CareerCtx, CareerPageView, CareerUiModel, CareerView } from './models';
import { renderPilot } from './pilot';
import { renderReposition } from './reposition';
import { renderSeed } from './seed';
import { renderStop } from './stop';
import { JobStrip } from './strip';
import { CAREER_CSS } from './styles';

/** The model before the system's first setModel: no career, no fields. */
const EMPTY_MODEL: CareerUiModel = {
  save: null, fields: [], board: [], worldSeed: 0, bootedType: 'c172s', storeKind: 'local', storage: 'ok', authority: 'easa', licence: null,
};

const RENDERERS: Readonly<Record<CareerView, (parent: HTMLElement, ctx: CareerCtx) => CareerPageView>> = {
  locked: renderLocked, create: renderCreate, seed: renderSeed, hub: renderHub, reposition: renderReposition, board: renderBoard,
  dispatch: renderDispatch, fleet: renderFleet, pilot: renderPilot, logbook: renderLogbook, debrief: renderDebrief, stop: renderStop,
  bankrupt: renderBankrupt,
};

/** How long a local toast stays, ms (only without a toastSink). */
const TOAST_MS = 3500;

/**
 * The page a request resolves to with this model: the gates come first (no licence: locked; no career: create;
 * another world: seed; overdrawn past the limit: bankrupt, though the debrief that caused it may still be read), so no page is shown that the save cannot back.
 */
export function resolvePage(page: CareerView, m: CareerUiModel): CareerView {
  if (!m.save) return m.licence ? 'create' : 'locked';
  if (m.save.seed !== m.worldSeed) return 'seed';
  if (isBankrupt(m.save) && page !== 'debrief') return 'bankrupt';
  if (page === 'locked' || page === 'create' || page === 'seed') return 'hub';
  return page;
}

/** The Career's pages and job strip under the shell's school layer (see the header for the wiring). */
export class CareerUi {
  /** Wired by the CareerSystem. */
  onCommand?: (cmd: CareerCommand) => void;
  /** Told when a page opens (true) or the pages close (false): the shell's careerHold. */
  onScreenChange?: (open: boolean) => void;
  /** Where toasts go (the shell's toasts); a small local stack otherwise. */
  toastSink: ((text: string) => void) | null = null;

  readonly root: HTMLElement;
  private readonly flight: HTMLElement;
  private readonly modalHost: HTMLElement;
  private readonly toasts: HTMLElement;
  private readonly strip: JobStrip;
  private model: CareerUiModel = EMPTY_MODEL;
  private current: { page: CareerView; view: CareerPageView } | null = null;
  private dispatchOfferId: string | null = null;
  private readonly memo = new Map<string, unknown>();

  constructor(layer: HTMLElement) {
    if (!document.getElementById('fsui-school-style')) {
      const s = el('style', undefined, document.head, SCHOOL_CSS);
      s.id = 'fsui-school-style';
    }
    if (!document.getElementById('fsui-career-style')) {
      const s = el('style', undefined, document.head, CAREER_CSS);
      s.id = 'fsui-career-style';
    }
    this.root = el('div', 'cr-layer', layer);
    this.flight = el('div', 'cr-layer', this.root);
    this.strip = new JobStrip(this.flight);
    this.strip.onAbandon = () => this.send({ kind: 'abandon' });
    this.modalHost = el('div', 'cr-layer', this.root);
    this.toasts = el('div', 'cr-toasts', this.root);
    window.addEventListener('keydown', this.onKeyCapture, true);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyCapture, true);
    this.current?.view.dispose?.();
    this.current = null;
    this.root.remove();
  }

  /** The model the pages render from; re-renders the open page (keeping its page state). */
  setModel(m: CareerUiModel): void {
    this.model = m;
    if (this.current) this.render(resolvePage(this.current.page, m));
  }

  /** The model last given. */
  getModel(): CareerUiModel {
    return this.model;
  }

  /** Open a page (hub by default). The gates in resolvePage may show another (locked, create, seed). */
  open(page: CareerView = 'hub'): void {
    const was = this.current !== null;
    this.render(resolvePage(page, this.model));
    if (!was) this.onScreenChange?.(true);
  }

  /** Close the pages (the strip stays while a job is active). */
  close(): void {
    if (!this.current) return;
    this.current.view.dispose?.();
    this.current = null;
    this.modalHost.replaceChildren();
    this.memo.clear();
    this.dropFocus();
    this.flight.classList.remove('hidden');
    this.onScreenChange?.(false);
  }

  /** True while a Career page is open (CareerModalLink.screenOpen: the UI is modal). */
  screenOpen(): boolean {
    return this.current !== null;
  }

  /** The page open now, or null. */
  page(): CareerView | null {
    return this.current?.page ?? null;
  }

  /** The offer the dispatch page shows (the board or a 'dispatch' command sets it). */
  setDispatchOffer(offerId: string | null): void {
    this.dispatchOfferId = offerId;
    if (this.current?.page === 'dispatch') this.render('dispatch');
  }

  /** Seed page state before a page opens (the dev page and tests: the fleet's market tab, a fuel choice). */
  presetMemo(entries: Readonly<Record<string, unknown>>): void {
    for (const [k, v] of Object.entries(entries)) this.memo.set(k, v);
  }

  /** The in-flight job strip: shown for a model, hidden for null; `canAbandon` shows its Abandon button. */
  setStrip(m: JobStripModel | null, opts: { canAbandon?: boolean } = {}): void {
    this.strip.update(m, { canAbandon: !!opts.canAbandon });
  }

  /**
   * True while the job strip shows on screen (the HUD's top-centre elements move down by CAREER_STRIP_CLEARANCE,
   * strip.ts): false while a page is open, which hides the strip.
   */
  get stripVisible(): boolean {
    return this.current === null && this.strip.visible;
  }

  /** A short notice: the shell's toasts when attached, else a local one. */
  toast(text: string): void {
    if (this.toastSink) {
      this.toastSink(text);
      return;
    }
    const t = el('div', 'cr-toast', this.toasts, text);
    window.setTimeout(() => t.remove(), TOAST_MS);
  }

  /**
   * One key while a page is open (the window capture listener calls it; tests call it directly). Returns true
   * when the page used the key. Text fields keep their characters.
   */
  handleKey(e: KeyboardEvent): boolean {
    const cur = this.current;
    if (!cur) return false;
    return cur.view.onKey?.(e) ?? false;
  }

  private ctx(): CareerCtx {
    return {
      model: this.model,
      send: (cmd) => this.send(cmd),
      go: (page) => this.open(page),
      toast: (t) => this.toast(t),
      dispatchOfferId: this.dispatchOfferId,
      memo: this.memo,
    };
  }

  private render(page: CareerView): void {
    this.current?.view.dispose?.();
    this.modalHost.replaceChildren();
    this.dropFocus();
    const view = RENDERERS[page](this.modalHost, this.ctx());
    this.current = { page, view };
    // The strip stands down while a page is open (the school hides its flight layer the same way).
    this.flight.classList.add('hidden');
  }

  private send(cmd: CareerCommand): void {
    // The UI's own share first, so a page never waits on a missing handler.
    switch (cmd.kind) {
      case 'open':
        this.open(cmd.page ?? 'hub');
        break;
      case 'close':
      case 'freeFlight':
        this.close();
        break;
      case 'dispatch':
        this.dispatchOfferId = cmd.offerId;
        this.open('dispatch');
        break;
    }
    this.onCommand?.(cmd);
  }

  private dropFocus(): void {
    const a = document.activeElement as HTMLElement | null;
    if (a && this.root.contains?.(a)) a.blur();
  }

  private readonly onKeyCapture = (e: KeyboardEvent): void => {
    if (!this.current) return;
    if (typing(e)) {
      // Text fields keep their characters; Enter commits (blur fires 'change') and Esc leaves the field.
      if (e.code === 'Escape' || e.code === 'Enter' || e.code === 'NumpadEnter') {
        (e.target as HTMLElement).blur();
        if (e.code === 'Escape') {
          e.preventDefault();
          e.stopImmediatePropagation();
          return;
        }
      } else {
        e.stopImmediatePropagation();
        return;
      }
    }
    if (this.handleKey(e)) e.preventDefault();
    if (/^F[1-6]$/.test(e.code) || e.code === 'Tab') e.preventDefault();
    e.stopImmediatePropagation();
  };
}
