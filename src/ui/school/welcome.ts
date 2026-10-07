// Welcome card (section 1.1 step 4): Start flight training (name, authority, instructor voice), Free flight,
// or I'm already a pilot. Nothing is created until the player confirms; Esc is "Free flight".

import type { AuthorityId } from '../../training/types';
import { el } from '../dom';
import { bareKey, button, type ScreenCtx, type ScreenView } from './widgets';

export function renderWelcome(parent: HTMLElement, sc: ScreenCtx): ScreenView {
  const scrim = el('div', 'scrim', parent);
  const card = el('div', 'card sc-welcome', scrim);
  let step: 'choose' | 'form' = 'choose';
  let experienced = false;
  const form = {
    name: 'Student pilot',
    authority: sc.career.authority as AuthorityId,
    voice: null as string | null,
    captionsOnly: sc.career.voices.length === 0,
  };

  const submit = (): void => {
    sc.send({
      kind: 'createProfile',
      studentName: form.name.trim() || 'Student pilot',
      authority: form.authority,
      experienced,
      voice: form.captionsOnly ? null : form.voice,
      captionsOnly: form.captionsOnly,
    });
  };

  const render = (): void => {
    card.replaceChildren();
    if (step === 'choose') {
      el('div', 'sc-kicker', card, 'KFBL Flight Training');
      el('h2', '', card, 'Learn to fly the 172');
      el('p', '', card,
        'A private pilot course with an instructor in the right seat: twenty lessons from the effects of controls to ' +
        'navigation, then the skill test. Each lesson is ten to fifteen minutes and starts where the exercise happens.');
      const choices = el('div', 'sc-choices', card);
      const choice = (title: string, text: string, key: string, cls: string, run: () => void): void => {
        const b = button(choices, '', run, { cls: `sc-choice ${cls}` });
        b.replaceChildren();
        el('b', '', b, title);
        if (key) el('span', 'sc-kbd', b, key);
        el('span', '', b, text);
      };
      choice('Start flight training', 'Choose your name, the rules you train to and the instructor\'s voice.', 'Enter', 'primary', () => {
        experienced = false;
        step = 'form';
        render();
      });
      choice('Free flight', 'Fly on your own. The Flight School is always one click away in the menu (Esc).', 'Esc', '', () =>
        sc.send({ kind: 'dismissWelcome' }));
      choice('I\'m already a pilot', 'Every lesson is open from the start. Competency still has to be shown by flying.', '', '', () => {
        experienced = true;
        step = 'form';
        render();
      });
      return;
    }

    el('div', 'sc-kicker', card, experienced ? 'Experienced pilot' : 'Your training record');
    el('h2', '', card, 'Before we fly');
    el('p', '', card, 'You can change all of this later in the Flight School settings.');

    const nameRow = el('div', 'sc-field', card);
    el('label', '', nameRow, 'Your name');
    const name = el('input', '', nameRow);
    name.type = 'text';
    name.value = form.name;
    name.maxLength = 40;
    name.addEventListener('input', () => (form.name = name.value));

    const authRow = el('div', 'sc-field', card);
    el('span', '', authRow, 'Training standard');
    const seg = el('div', 'sc-seg', authRow);
    const auth = (id: AuthorityId, text: string): void => {
      const b = button(seg, text, () => {
        form.authority = id;
        render();
      }, { cls: form.authority === id ? 'sel' : '' });
      b.title = id === 'easa' ? 'UK/EASA private pilot licence: tolerances of AMC1 FCL.235' : 'US private pilot certificate: Airman Certification Standards';
    };
    auth('easa', 'EASA Part-FCL');
    auth('faa', 'FAA ACS');

    const voiceRow = el('div', 'sc-field', card);
    el('span', '', voiceRow, 'Instructor voice');
    const vbox = el('div', 'sc-inline', voiceRow);
    const select = el('select', '', vbox);
    const auto = el('option', '', select, sc.career.voices.length ? 'Automatic (British English preferred)' : 'No voices installed');
    auto.value = '';
    for (const v of sc.career.voices) {
      const o = el('option', '', select, `${v.name} (${v.lang})`);
      o.value = v.voiceURI;
    }
    select.value = form.voice ?? '';
    select.disabled = form.captionsOnly || sc.career.voices.length === 0;
    select.addEventListener('change', () => (form.voice = select.value || null));
    if (sc.deps.testVoice) {
      const t = button(vbox, 'Test voice', () => sc.deps.testVoice?.('instructor', form.voice));
      t.disabled = form.captionsOnly || sc.career.voices.length === 0;
    }
    const capRow = el('div', 'sc-field', card);
    el('span', '', capRow, '');
    const l = el('label', 'toggle', capRow);
    const cb = el('input', '', l);
    cb.type = 'checkbox';
    cb.checked = form.captionsOnly;
    cb.disabled = sc.career.voices.length === 0;
    el('span', '', l, sc.career.voices.length ? 'Captions only (no speech)' : 'Captions only: this browser has no speech voices');
    cb.addEventListener('change', () => {
      form.captionsOnly = cb.checked;
      render();
    });

    const actions = el('div', 'sc-actions', card);
    button(actions, 'Back', () => {
      step = 'choose';
      render();
    }, { key: 'Esc' });
    button(actions, experienced ? 'Open the Flight School' : 'Start training', submit, { cls: 'primary', key: 'Enter' });
  };
  render();

  return {
    root: scrim,
    onKey(e) {
      if (bareKey(e, 'Enter', 'NumpadEnter')) {
        if (step === 'choose') {
          step = 'form';
          render();
        } else submit();
        return true;
      }
      if (bareKey(e, 'Escape')) {
        if (step === 'form') {
          step = 'choose';
          render();
        } else sc.send({ kind: 'dismissWelcome' });
        return true;
      }
      return false;
    },
  };
}
