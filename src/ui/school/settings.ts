// Flight School settings (section 5.8): authority, names, voices per persona with Test buttons, rate, volume,
// captions, talkativeness, instructor saves, live bars, auto-acknowledge, free-flight logging, experienced
// pilot, export, import (preview, then Replace or Merge) and reset progress (typed "RESET").
// The form is also embedded in the menu's School tab outside a lesson.

import type { Lesson, TrainingSave, TrainingSettings } from '../../training/types';
import { el } from '../dom';
import { formatNumber } from './format';
import type { SchoolImportPreview } from './models';
import { bareKey, button, header, section, typing, type ScreenCtx, type ScreenView } from './widgets';

type Patch = Partial<TrainingSettings>;

/** Build the settings form into `parent`. Each change is sent at once as an updateSettings command. */
export function buildSettingsForm(parent: HTMLElement, sc: ScreenCtx, compact = false): void {
  const save = sc.career.save;
  if (!save) {
    el('div', 'sc-empty', parent, 'Create your training record first: open the Flight School.');
    return;
  }
  // A local copy: the form reflects edits at once; TrainingSystem persists them (debounced) and republishes.
  const s: TrainingSettings = structuredClone(save.settings);
  const profile = { ...save.profile };
  const send = (p: Patch): void => {
    Object.assign(s, p);
    sc.send({ kind: 'updateSettings', settings: p });
  };
  const field = (label: string): HTMLElement => {
    const r = el('div', 'sc-field', parent);
    el('span', '', r, label);
    return el('div', 'sc-inline', r);
  };
  const seg = <T extends string>(box: HTMLElement, options: [T, string][], get: () => T, set: (v: T) => void): void => {
    const g = el('div', 'sc-seg', box);
    const buttons = options.map(([v, text]) => {
      const b = button(g, text, () => {
        set(v);
        buttons.forEach((x, i) => x.classList.toggle('sel', options[i][0] === get()));
      }, { cls: get() === v ? 'sel' : '' });
      return b;
    });
  };
  const toggle = (text: string, get: () => boolean, set: (v: boolean) => void, enabled = true): HTMLInputElement => {
    const l = el('label', 'toggle', parent);
    const i = el('input', '', l);
    i.type = 'checkbox';
    i.checked = get();
    i.disabled = !enabled;
    i.tabIndex = -1;
    el('span', '', l, text);
    i.addEventListener('change', () => set(i.checked));
    return i;
  };
  const range = (box: HTMLElement, min: number, max: number, step: number, get: () => number, set: (v: number) => void, fmt: (v: number) => string): void => {
    const i = el('input', '', box);
    i.type = 'range';
    i.min = String(min);
    i.max = String(max);
    i.step = String(step);
    i.value = String(get());
    i.tabIndex = -1;
    i.style.flex = '1';
    const out = el('output', 'num', box, fmt(get()));
    out.style.minWidth = '46px';
    out.style.textAlign = 'right';
    const paint = (): void => i.style.setProperty('--p', `${((Number(i.value) - min) / (max - min)) * 100}%`);
    paint();
    i.addEventListener('input', () => {
      out.textContent = fmt(Number(i.value));
      paint();
    });
    i.addEventListener('change', () => set(Number(i.value)));
  };
  const text = (box: HTMLElement, value: string, onCommit: ((v: string) => void) | null): void => {
    const i = el('input', '', box);
    i.type = 'text';
    i.value = value;
    i.maxLength = 40;
    i.disabled = !onCommit;
    if (onCommit) i.addEventListener('change', () => onCommit(i.value.trim() || value));
  };

  section(parent, 'Training');
  seg(field('Training standard'), [['easa', 'EASA Part-FCL'], ['faa', 'FAA ACS']], () => s.authority, (v) => send({ authority: v }));
  const up = sc.deps.updateProfile;
  text(field('Your name'), profile.studentName, up ? (v) => up({ studentName: v }) : null);
  text(field('Instructor name'), profile.instructorName, up ? (v) => up({ instructorName: v }) : null);
  seg(field('Talkativeness'), [['quiet', 'Quiet'], ['normal', 'Normal'], ['chatty', 'Chatty']], () => s.talkativeness, (v) => send({ talkativeness: v }));
  toggle('Instructor saves: the instructor takes control before a crash in dual lessons', () => s.instructorSaves, (v) => send({ instructorSaves: v }));
  toggle('Live tolerance bars on the lesson card (always hidden when assessed)', () => s.liveBars, (v) => send({ liveBars: v }));
  toggle('Auto-acknowledge handovers: the first deliberate control input counts as Enter', () => s.autoAck, (v) => send({ autoAck: v }));
  toggle('Glance: the cockpit view turns briefly toward a control the instructor names when it is off screen', () => s.glance !== false, (v) => send({ glance: v }));
  toggle('Log free flights in the logbook', () => s.logFreeFlights, (v) => send({ logFreeFlights: v }));
  toggle('I’m already a pilot: every lesson is open (competency still has to be flown)', () => profile.experienced,
    (v) => up?.({ experienced: v }), !!up);

  section(parent, 'Voice and captions');
  const voices = sc.career.voices;
  const voiceRow = (label: string, persona: Lesson['persona'], key: 'instructor' | 'examiner'): void => {
    const box = field(label);
    const sel = el('select', '', box);
    sel.tabIndex = -1;
    el('option', '', sel, voices.length ? 'Automatic' : 'No voices installed').value = '';
    for (const v of voices) el('option', '', sel, `${v.name} (${v.lang})`).value = v.voiceURI;
    sel.value = s.voice[key] ?? '';
    sel.disabled = voices.length === 0 || s.voice.captionsOnly;
    sel.addEventListener('change', () => send({ voice: { ...s.voice, [key]: sel.value || null } }));
    if (sc.deps.testVoice) {
      const t = button(box, 'Test', () => sc.deps.testVoice?.(persona, s.voice[key]));
      t.disabled = voices.length === 0 || s.voice.captionsOnly;
    }
  };
  voiceRow('Instructor voice', 'instructor', 'instructor');
  voiceRow('Examiner voice', 'examiner', 'examiner');
  range(field('Speech rate'), 0.8, 1.3, 0.05, () => s.voice.rate, (v) => send({ voice: { ...s.voice, rate: v } }), (v) => `${v.toFixed(2)}×`);
  range(field('Volume'), 0, 1, 0.05, () => s.voice.volume, (v) => send({ voice: { ...s.voice, volume: v } }), (v) => `${Math.round(v * 100)} %`);
  toggle('Captions', () => s.voice.captions || s.voice.captionsOnly, (v) => send({ voice: { ...s.voice, captions: v } }), !s.voice.captionsOnly);
  toggle('Captions only (no speech)', () => s.voice.captionsOnly, (v) => send({ voice: { ...s.voice, captionsOnly: v, captions: v || s.voice.captions } }));
  if (voices.length === 0) {
    el('div', 'sc-foot-note', parent, 'This browser offers no speech voices, so the instructor speaks in captions. On Linux, installing speech-dispatcher with a voice adds them.');
  }

  if (compact) return;
  dataSection(parent, sc, save);
}

function dataSection(parent: HTMLElement, sc: ScreenCtx, save: TrainingSave): void {
  section(parent, 'Your data');
  const exp = el('div', 'sc-field', parent);
  el('span', '', exp, 'Export');
  const ebox = el('div', 'sc-inline', exp);
  let traces = true;
  button(ebox, 'Download a copy', () => sc.send({ kind: 'export', includeTraces: traces }));
  const l = el('label', 'toggle', ebox);
  const cb = el('input', '', l);
  cb.type = 'checkbox';
  cb.checked = true;
  cb.tabIndex = -1;
  el('span', '', l, 'Include traces');
  cb.addEventListener('change', () => (traces = cb.checked));

  const imp = el('div', 'sc-field', parent);
  el('span', '', imp, 'Import');
  const ibox = el('div', 'sc-inline', imp);
  const file = el('input', '', ibox);
  file.type = 'file';
  file.accept = '.json,application/json';
  file.style.display = 'none';
  const pick = button(ibox, 'Choose a file…', () => file.click());
  pick.disabled = !sc.deps.previewImport;
  const result = el('div', '', parent);
  file.addEventListener('change', () => {
    const f = file.files?.[0];
    file.value = '';
    if (!f) return;
    void f.text().then((json) => showPreview(result, sc, json));
  });

  const rst = el('div', 'sc-field', parent);
  el('span', '', rst, 'Reset progress');
  const rbox = el('div', 'sc-inline', rst);
  const confirm = el('input', '', rbox);
  confirm.type = 'text';
  confirm.placeholder = 'Type RESET';
  confirm.style.width = '130px';
  const go = button(rbox, 'Delete my training record', () => {
    if (confirm.value.trim() === 'RESET') sc.send({ kind: 'resetProgress' });
  }, { cls: 'danger' });
  go.disabled = true;
  confirm.addEventListener('input', () => (go.disabled = confirm.value.trim() !== 'RESET'));
  el('div', 'sc-foot-note', parent, `Saved in this browser as ${save.profile.studentName}'s record (${formatNumber(save.logbook.length)} logbook lines). Export after milestones to keep a copy.`);
}

function showPreview(box: HTMLElement, sc: ScreenCtx, json: string): void {
  box.replaceChildren();
  let p: SchoolImportPreview;
  try {
    p = sc.deps.previewImport!(json);
  } catch (e) {
    const b = el('div', 'sc-banner', box);
    el('span', '', b, `This file can’t be imported: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  const b = el('div', 'sc-banner info', box);
  el('span', '', b, `${p.studentName}: ${p.lessonsCompetent} lessons competent, ${p.hours.toFixed(1)} h, ${p.landings} landings.`);
  button(b, 'Merge', () => {
    sc.send({ kind: 'import', json, mode: 'merge' });
    box.replaceChildren();
  });
  button(b, 'Replace mine', () => {
    sc.send({ kind: 'import', json, mode: 'replace' });
    box.replaceChildren();
  });
  button(b, 'Cancel', () => box.replaceChildren());
}

export function renderSettings(parent: HTMLElement, sc: ScreenCtx): ScreenView {
  const scrim = el('div', 'scrim', parent);
  const card = el('div', 'card sc-card', scrim);
  card.style.width = 'min(760px, calc(100vw - 32px))';
  card.style.height = 'min(760px, calc(100vh - 32px))';
  const h = header(card, 'Settings', 'Changes apply at once and are saved with your training record.', 'Flight School');
  button(h.root, '×', () => sc.go('home'), { cls: 'sc-x', title: 'Back (Esc)' });
  const body = el('div', 'sc-body', card);
  buildSettingsForm(body, sc);
  const foot = el('div', 'sc-foot', card);
  button(foot, 'Done', () => sc.go('home'), { cls: 'primary', key: 'Esc' });
  return {
    root: scrim,
    onKey(e) {
      if (bareKey(e, 'Escape')) {
        if (typing(e)) (e.target as HTMLElement).blur();
        else sc.go('home');
        return true;
      }
      return false;
    },
  };
}
