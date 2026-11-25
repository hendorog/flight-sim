// Richard Pearse 1903 Monoplane: supplementary pioneer checklists.

import { all, eq, ge, le } from '../../training/engine/dsl';
import { checklist, checkItem as i, type FlightChecklist } from '../../training/checklistData';

export const PEARSE_CHECKLIST_SOURCE = {
  source: 'Waitohi Pioneer Field Notes (NZ Patent 21476 reconstruction)',
  sourceUrl: 'https://nzhistory.govt.nz/culture/richard-pearse',
};

export const PEARSE_EXTRA_CHECKLISTS: Record<string, FlightChecklist> = {
  preflight: checklist('preflight', 'Walk-around & rigging inspection', [
    i('bamboo', 'Bamboo longerons & lashed joints', 'Check sound, bindings tight, no split internodes'),
    i('wires', 'Flying & landing wires', 'Check taut and symmetrical; kingposts plumb'),
    i('canvas', 'Wing, elevator & rudder linen', 'Lacing secure, rear-spar flap & aileron hinges free'),
    i('undercarriage', 'Tubular steel tricycle gear', 'Spokes tensioned, pneumatic tyres firm, nose fork steering free'),
    i('engine', 'Double-acting twin & brass tank', 'Check 3.2 US gal petrol, drip-feed oilers full, airscrew collar tight'),
  ], { ...PEARSE_CHECKLIST_SOURCE, category: 'normal' }),
  climb: checklist('climb', 'Climb', [
    i('speed', 'Airspeed', '38–40 KIAS', all(ge('kias', 36), le('kias', 43))),
    i('power', 'Throttle', 'Full open (~1100 RPM)', ge('throttle', 0.98)),
    i('camber', 'Wing camber lever', '0° (clean)', le('flapsDeg', 1)),
  ], { ...PEARSE_CHECKLIST_SOURCE, category: 'normal' }),
  cruise: checklist('cruise', 'Cruise', [
    i('power', 'Engine speed', '900–1050 RPM (~46 KIAS)'),
    i('trim', 'Elevator spring trim', 'Set hands-off'),
    i('mixture', 'Mixture', 'Adjust for smooth firing'),
  ], { ...PEARSE_CHECKLIST_SOURCE, category: 'normal' }),
  powerFailure: checklist('powerFailure', 'Engine stoppage · paddock landing', [
    i('glide', 'Airspeed', 'Lower nose immediately to 38 KIAS (high wire drag!)'),
    i('field', 'Paddock / road ahead', 'Pick a clear grass strip into wind — avoid gorse hedges'),
    i('fuel', 'Overhead petrol tap', 'Check ON', eq('fuelSel', 'on')),
    i('coils', 'Spark coils', 'Check BOTH', eq('mags', 3)),
    i('secure', 'Before touchdown', 'Petrol OFF, spark coils OFF, accumulator OFF', all(eq('fuelSel', 'off'), eq('mags', 0))),
  ], { ...PEARSE_CHECKLIST_SOURCE, category: 'emergency' }),
};
