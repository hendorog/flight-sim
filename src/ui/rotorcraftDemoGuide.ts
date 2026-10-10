// Reference links describe the script, not completion of POH checks. The scripted warm-up and flare
// deliberately differ from the POH; linking their related items must not certify those procedures.
import { PHASE_ACTIONS, type R22DemoId } from '../sim/rotorcraft/flights';

export interface DemoChecklistLink { section: string; item: string; label: string; next: string }
const LINKS: Record<string, Omit<DemoChecklistLink, 'next'> & { next: string }> = {
  start: { section: 'engineStart', item: 'start', label: 'Engine start · ignition', next: 'clutch' },
  clutch: { section: 'afterStart', item: 'clutchReady', label: 'After start · clutch engaged / light out', next: 'governor' },
  governor: { section: 'runup', item: 'flightRpm', label: 'Run-up · governor / flight RPM', next: 'warmup' },
  warmup: { section: 'afterStart', item: 'warmup', label: 'Warm-up · POH 70–75% (script holds flight RPM)', next: 'hover' },
  hover: { section: 'beforeTakeoff', item: 'lift', label: 'Lift-off · balance in hover', next: 'ETL' },
  ETL: { section: 'afterTakeoff', item: 'accelerate', label: 'Climb · departure', next: 'climb' },
  climb: { section: 'afterTakeoff', item: 'climb', label: 'Climb · script 60 KIAS; POH Vy 53 KIAS', next: 'accelerate' },
  accelerate: { section: 'cruise', item: 'power', label: 'Cruise · speed / power', next: 'cruise' },
  cruise: { section: 'cruise', item: 'power', label: 'Cruise · speed / power', next: 'descend' },
  descend: { section: 'descent', item: 'lower', label: 'Descent · reduce collective', next: 'approach' },
  approach: { section: 'final', item: 'slow', label: 'Approach · reduce sink before slowing', next: 'hover' },
  land: { section: 'final', item: 'land', label: 'Landing · lower collective', next: 'park' },
  autorotate: { section: 'engineFailure', item: 'glide', label: 'Power failure · 65 KIAS autorotation', next: 'flare' },
  flare: { section: 'engineFailure', item: 'flare', label: 'Flare · POH about 40 ft; script begins at 60 ft', next: 'level' },
  level: { section: 'engineFailure', item: 'cushion', label: 'Landing · level / cushion', next: 'cushion' },
  cushion: { section: 'engineFailure', item: 'cushion', label: 'Landing · level / cushion', next: 'slide' },
  slide: { section: 'engineFailure', item: 'slide', label: 'Touchdown · level skids / slide', next: 'park' },
  park: { section: 'afterLanding', item: 'collective', label: 'After landing · collective down', next: '' },
};

export function demoChecklistLink(id: R22DemoId, phase: string, time: number): DemoChecklistLink | null {
  const link = LINKS[phase]; if (!link) return null;
  let next = link.next;
  if (phase === 'hover') {
    if (id === 'startup') next = '';
    else if (id === 'approach' || id === 'circuit' && time > 400) next = 'land';
  }
  if (id === 'hover' && phase === 'cruise') next = '';
  return { ...link, next: next ? PHASE_ACTIONS[next] ?? next : 'Finish and pause; take control with Enter' };
}
