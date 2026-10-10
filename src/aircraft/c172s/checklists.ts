// Condensed normal / emergency additions to the existing school checklists.
// Physical inspections, sequences and pilot judgements stay manual. Speeds are KIAS unless noted.
import { all, eq, ge, le } from '../../training/engine/dsl';
import { checklist, checkItem as i, type FlightChecklist } from '../../training/checklistData';

export const C172S_CHECKLIST_SOURCE = { source: "C172S POH", sourceUrl: "https://befa.org/wp-content/uploads/2019/12/POH-Cessna-172S.pdf" };
export const C172S_EXTRA_CHECKLISTS: Record<string, FlightChecklist> = {
  preflight: checklist('preflight', "Preflight inspection", [
    i("planning", "Flight planning", "Weather, fuel, weight / CG, performance and limitations checked"),
    i("walkaround", "Preflight inspection", "Complete POH walk-around: airframe, flight controls, landing gear, propeller(s), intakes and pitot / static openings"),
    i("fluids", "Fuel and oil", "Check quantities; drain samples and inspect for contamination; caps secure"),
    i("cabin", "Cabin / baggage", "Secure loose articles, seats and restraints; remove control locks, covers and tie-downs"),
  ], { ...C172S_CHECKLIST_SOURCE, source: "C172S POH 4-5–4-8", category: 'normal' }),
  climb: checklist('climb', "Climb", [
    i("speed", "Airspeed", "70–85 KIAS", all(ge('kias', 70), le('kias', 85))),
    i("power", "Throttle", "Full", ge('throttle', 0.99)),
    i("mixture", "Mixture", "Rich below 3000 ft; above 3000 ft lean for maximum RPM"),
  ], { ...C172S_CHECKLIST_SOURCE, source: "C172S POH 4-20", category: 'normal' }),
  cruise: checklist('cruise', "Cruise", [
    i("power", "Power", "2100–2700 RPM; no more than 75% power"),
    i("trim", "Elevator trim", "Adjust"),
    i("mixture", "Mixture", "Lean per POH performance / engine procedures"),
  ], { ...C172S_CHECKLIST_SOURCE, source: "C172S POH 4-20", category: 'normal' }),
  descent: checklist('descent', "Descent", [
    i("power", "Power", "As desired"),
    i("mixture", "Mixture", "Adjust for smooth operation; full rich at idle"),
    i("qnh", "Altimeter", "Set local QNH"),
    i("fuel", "Fuel selector", "BOTH", eq('fuelSel', 'both')),
    i("flaps", "Flaps", "Within placarded speed limits"),
  ], { ...C172S_CHECKLIST_SOURCE, source: "C172S POH 4-20", category: 'normal' }),
  powerFailure: checklist('powerFailure', "Engine failure · fly / land", [
    i("fly", "Control / airspeed", "After takeoff: 70 KIAS flaps up, 65 KIAS flaps down; in flight establish 68 KIAS best glide"),
    i("site", "Landing site", "Select within reach; after takeoff lower nose and land ahead"),
    i("restart", "If altitude and time permit", "Use engine-failure touch drill; starter if propeller stopped"),
    i("land", "If restart fails", "Forced landing security; secure harnesses, unlatch doors before touchdown; brake heavily"),
  ], { ...C172S_CHECKLIST_SOURCE, source: "C172S POH 3-5–3-6", category: 'emergency' }),
  startFire: checklist('startFire', "Fire during start", [
    i("crank", "Starter", "Continue cranking"),
    i("runs", "If engine starts", "1700 RPM for a few minutes, then shut down and inspect"),
    i("fails", "If engine does not start", "Throttle full open, mixture cut-off; continue cranking"),
    i("secure", "Secure / extinguish", "Master OFF, ignition OFF, fuel shutoff CLOSED; extinguish and inspect"),
  ], { ...C172S_CHECKLIST_SOURCE, source: "C172S POH 3-8", category: 'emergency' }),
  engineFire: checklist('engineFire', "Engine fire in flight", [
    i("mixture", "Mixture", "Idle cut-off", le('mixture', 0.01)),
    i("fuel", "Fuel shutoff", "CLOSED", eq('fuelSel', 'off')),
    i("pump", "Auxiliary fuel pump", "OFF", eq('fuelPump', false)),
    i("master", "Master", "OFF", all(eq('master', false), eq('alternator', false))),
    i("heat", "Cabin heat / air", "OFF except overhead vents"),
    i("speed", "Airspeed", "100 KIAS; increase within limitations if fire persists"),
    i("land", "Landing", "Forced landing; do not attempt restart"),
  ], { ...C172S_CHECKLIST_SOURCE, source: "C172S POH 3-8", category: 'emergency' }),
  electricalFire: checklist('electricalFire', "Electrical fire in flight", [
    i("master", "Master", "OFF", all(eq('master', false), eq('alternator', false))),
    i("vents", "Vents / heat / air", "CLOSED"),
    i("extinguish", "Fire extinguisher", "Activate if available; ventilate after discharge"),
    i("loads", "Avionics / other switches", "OFF except ignition"),
    i("restore", "Only if fire out and power essential", "Do not reset faulted breakers; use POH isolation sequence, one load at a time"),
    i("land", "Landing", "Land as soon as practical"),
  ], { ...C172S_CHECKLIST_SOURCE, source: "C172S POH 3-9", category: 'emergency' }),
  electrical: checklist('electrical', "Low voltage / discharge", [
    i("reset", "Below 1000 RPM", "Low-voltage indication may be normal; check at higher RPM"),
    i("flight", "In flight", "Avionics OFF; check ALT FLD breaker; master OFF then ON"),
    i("normal", "If light goes out", "Avionics ON"),
    i("recurs", "If low voltage recurs", "Alternator OFF; nonessential loads OFF; terminate flight as soon as practical"),
  ], { ...C172S_CHECKLIST_SOURCE, source: "C172S POH 3-13", category: 'emergency' }),
};
