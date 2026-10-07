// Licence card (section 5.7): a CSS card with the name, licence number, "Student Pilot" or the licence title
// by authority, endorsements and ratings with dates, total hours and an initials avatar. Fictional school
// document: no authority's emblem or wording is imitated.

import { el } from '../dom';
import { endorsementTitle, formatDate, formatHours, initials, licenceTitle } from './format';
import { bareKey, button, header, type ScreenCtx, type ScreenView } from './widgets';

export function renderLicence(parent: HTMLElement, sc: ScreenCtx): ScreenView {
  const scrim = el('div', 'scrim', parent);
  const card = el('div', 'card sc-card', scrim);
  card.style.width = 'min(660px, calc(100vw - 32px))';
  card.style.maxHeight = 'calc(100vh - 32px)';
  const h = header(card, 'Licence', 'Your record at KFBL Flight Training.', 'KFBL Flight Training');
  button(h.root, '×', () => sc.go('home'), { cls: 'sc-x', title: 'Back (Esc)' });
  const body = el('div', 'sc-body', card);
  const save = sc.career.save;
  if (!save) {
    el('div', 'sc-empty', body, 'Start your training record to receive a student licence.');
  } else {
    const a = sc.career.authority;
    const ppl = save.endorsements.some((e) => e.id === 'ppl');
    const tot = sc.deps.totals(save.logbook);
    const lic = el('div', `sc-licence${ppl ? ' anim' : ''}`, body);
    const head = el('div', 'sc-lic-head', lic);
    el('span', '', head, 'KFBL Flight Training · simulation');
    el('span', '', head, a === 'easa' ? 'Part-FCL syllabus' : 'ACS syllabus');
    el('div', 'sc-lic-title', lic, licenceTitle(a, ppl));
    const main = el('div', 'sc-lic-main', lic);
    el('div', 'sc-avatar', main, initials(save.profile.studentName));
    const g = el('div', 'sc-lic-grid', main);
    const row = (k: string, v: string): void => {
      el('span', '', g, k);
      el('b', '', g, v);
    };
    row('Holder', save.profile.studentName);
    row('Licence no.', save.profile.licenceNo);
    row('Status', sc.deps.rank(save, a));
    row('Class', 'Single-engine piston (land) · C172');
    row('Total time', `${formatHours(tot.totalS)} (${tot.flights} flight${tot.flights === 1 ? '' : 's'}, ${tot.landingsDay + tot.landingsNight} landings)`);
    row('Instructor', save.profile.instructorName);
    const end = el('div', 'sc-lic-end', lic);
    if (save.endorsements.length === 0) el('div', '', end, 'No endorsements yet: the first comes with your pre-solo check.');
    for (const e of [...save.endorsements].sort((x, y) => x.at.localeCompare(y.at))) {
      const d = el('div', '', end);
      el('b', '', d, endorsementTitle(e.id));
      el('span', '', d, formatDate(e.at));
    }
    el('div', 'sc-lic-foot', lic, `Issued ${formatDate(save.createdAt)} · simulation record; not a pilot licence and not creditable.`);
  }
  const foot = el('div', 'sc-foot', card);
  button(foot, 'Back', () => sc.go('home'), { key: 'Esc' });
  return {
    root: scrim,
    onKey(e) {
      if (bareKey(e, 'Escape')) {
        sc.go('home');
        return true;
      }
      return false;
    },
  };
}
