// Condensed normal / emergency additions to the existing school checklists.
// Physical inspections, sequences and pilot judgements stay manual. Speeds are KIAS unless noted.
import { all, eq, ge, le } from '../../training/engine/dsl';
import { checklist, checkItem as i, type FlightChecklist } from '../../training/checklistData';

export const C152_CHECKLIST_SOURCE = { source: "C152 POH (1978)", sourceUrl: "https://www.aeroelectric.com/Reference_Docs/Cessna/cessna-poh/C152-1978-POH-scanned.pdf" };
export const C152_EXTRA_CHECKLISTS: Record<string, FlightChecklist> = {
  preflight: checklist('preflight', "Preflight inspection", [
    i("planning", "Flight planning", "Weather, fuel, weight / CG, performance and limitations checked"),
    i("walkaround", "Preflight inspection", "Complete POH walk-around: airframe, flight controls, landing gear, propeller(s), intakes and pitot / static openings"),
    i("fluids", "Fuel and oil", "Check quantities; drain samples and inspect for contamination; caps secure"),
    i("cabin", "Cabin / baggage", "Secure loose articles, seats and restraints; remove control locks, covers and tie-downs"),
  ], { ...C152_CHECKLIST_SOURCE, source: "C152 POH (1978) 4-3–4-5", category: 'normal' }),
  climb: checklist('climb', "Climb", [
    i("speed", "Airspeed", "70–80 KIAS", all(ge('kias', 70), le('kias', 80))),
    i("power", "Throttle", "Full", ge('throttle', 0.99)),
    i("mixture", "Mixture", "Rich below 3000 ft; above 3000 ft lean for maximum RPM"),
  ], { ...C152_CHECKLIST_SOURCE, source: "C152 POH (1978) 4-7", category: 'normal' }),
  cruise: checklist('cruise', "Cruise", [
    i("power", "Power", "1900–2550 RPM; no more than 75% power"),
    i("trim", "Elevator trim", "Adjust"),
    i("mixture", "Mixture", "Lean for cruise"),
  ], { ...C152_CHECKLIST_SOURCE, source: "C152 POH (1978) 4-7", category: 'normal' }),
  descent: checklist('descent', "Descent / arrival preparation", [
    i("plan", "Descent", "Plan to arrive within circuit and flap speed limits"),
    i("belts", "Seats / belts", "Secure and locked"),
    i("mixture", "Before landing: mixture", "Rich", ge('mixture', 0.99)),
    i("heat", "Before closing throttle", "Carburettor heat full ON", ge('checklist.carbHeat', 0.99)),
  ], { ...C152_CHECKLIST_SOURCE, source: "C152 POH (1978) 4-8", category: 'normal' }),
  powerFailure: checklist('powerFailure', "Engine failure · fly / land", [
    i("fly", "Control / airspeed", "After takeoff: 60 KIAS flaps up, 55 KIAS flaps down; in flight 60 KIAS best glide"),
    i("site", "Landing site", "Select within reach; after takeoff lower nose and land ahead"),
    i("restart", "If altitude and time permit", "Use engine-failure touch drill; starter if propeller stopped"),
    i("land", "If restart fails", "Forced landing security; unlatch doors before touchdown; brake heavily"),
  ], { ...C152_CHECKLIST_SOURCE, source: "C152 POH (1978) 3-3–3-4", category: 'emergency' }),
  startFire: checklist('startFire', "Fire during start", [
    i("crank", "Starter", "Continue cranking"),
    i("runs", "If engine starts", "1700 RPM for a few minutes; shut down and inspect"),
    i("fails", "If engine does not start", "Continue cranking; obtain extinguisher"),
    i("secure", "Secure / extinguish", "Master OFF, ignition OFF, fuel valve OFF; extinguish and inspect"),
  ], { ...C152_CHECKLIST_SOURCE, source: "C152 POH (1978) 3-5", category: 'emergency' }),
  engineFire: checklist('engineFire', "Engine fire in flight", [
    i("mixture", "Mixture", "Idle cut-off", le('mixture', 0.01)),
    i("fuel", "Fuel valve", "OFF", eq('fuelSel', 'off')),
    i("master", "Master", "OFF", all(eq('master', false), eq('alternator', false))),
    i("heat", "Cabin heat / air", "OFF except wing-root vents"),
    i("speed", "Airspeed", "85 KIAS; increase within limitations if fire persists"),
    i("land", "Landing", "Forced landing; do not attempt restart"),
  ], { ...C152_CHECKLIST_SOURCE, source: "C152 POH (1978) 3-6", category: 'emergency' }),
  electricalFire: checklist('electricalFire', "Electrical fire in flight", [
    i("master", "Master", "OFF", all(eq('master', false), eq('alternator', false))),
    i("loads", "Other switches", "OFF except ignition"),
    i("vents", "Vents / heat / air", "CLOSED"),
    i("extinguish", "Extinguisher", "Activate if available; ventilate after discharge"),
    i("restore", "Only if fire out and power essential", "Check breakers; do not reset. Restore necessary loads one at a time with delay to locate fault"),
  ], { ...C152_CHECKLIST_SOURCE, source: "C152 POH (1978) 3-6", category: 'emergency' }),
  electrical: checklist('electrical', "Electrical failure", [
    i("overvoltage", "Overvoltage light", "Master OFF then ON; verify light out"),
    i("recurs", "If light illuminates again", "Terminate flight as soon as practical"),
    i("discharge", "Ammeter discharge", "Alternator OFF; nonessential electrical equipment OFF; terminate as soon as practical"),
  ], { ...C152_CHECKLIST_SOURCE, source: "C152 POH (1978) 3-7–3-8", category: 'emergency' }),
};
