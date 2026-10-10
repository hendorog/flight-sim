// Condensed normal / emergency additions to the existing school checklists.
// Physical inspections, sequences and pilot judgements stay manual. Speeds are KIAS unless noted.
import { all, eq, ge, le } from '../../training/engine/dsl';
import { checklist, checkItem as i, type FlightChecklist } from '../../training/checklistData';

export const PA38_CHECKLIST_SOURCE = { source: "PA-38-112 POH", sourceUrl: "https://xplorepilots.com/descargas/aviones/PA38/PA38_POH.pdf" };
export const PA38_EXTRA_CHECKLISTS: Record<string, FlightChecklist> = {
  preflight: checklist('preflight', "Preflight inspection", [
    i("planning", "Flight planning", "Weather, fuel, weight / CG, performance and limitations checked"),
    i("walkaround", "Preflight inspection", "Complete POH walk-around: airframe, flight controls, landing gear, propeller(s), intakes and pitot / static openings"),
    i("fluids", "Fuel and oil", "Check quantities; drain samples and inspect for contamination; caps secure"),
    i("cabin", "Cabin / baggage", "Secure loose articles, seats and restraints; remove control locks, covers and tie-downs"),
  ], { ...PA38_CHECKLIST_SOURCE, source: "PA-38-112 POH 4-5–4-8", category: 'normal' }),
  cruise: checklist('cruise', "Cruise", [
    i("power", "Power", "Set per performance tables; lean only at 75% power or less"),
    i("mixture", "Mixture", "Lean to roughness, then enrich until smooth; enrich before increasing power"),
    i("fuel", "Fuel pump / tank changes", "Normally pump OFF; ON before switching tanks and briefly after; use tanks alternately without running dry"),
  ], { ...PA38_CHECKLIST_SOURCE, source: "PA-38-112 POH 4-20–4-21", category: 'normal' }),
  descent: checklist('descent', "Descent / arrival preparation", [
    i("plan", "Descent", "Plan circuit arrival; enrich before adding power"),
    i("tank", "Fuel selector", "Fullest tank"),
    i("belts", "Seat backs / belts", "Upright and secure"),
    i("pump", "Before landing: fuel pump", "ON", eq('fuelPump', true)),
    i("mixture", "Before landing: mixture", "Rich", ge('mixture', 0.99)),
    i("heat", "Carburettor heat", "Use if icing is suspected"),
  ], { ...PA38_CHECKLIST_SOURCE, source: "PA-38-112 POH 4-21", category: 'normal' }),
  powerFailure: checklist('powerFailure', "Engine failure · fly / land", [
    i("fly", "Airspeed", "Establish 70 KIAS glide"),
    i("site", "Landing site", "Choose reachable field; after takeoff land ahead unless height permits other action"),
    i("restart", "If altitude and time permit", "Use engine-failure touch drill"),
    i("land", "Power-off landing", "Aim for downwind at 1000 ft AGL if practicable; when assured, flaps as needed; 67 KIAS final with flow strips (62 without)"),
    i("secure", "Before touchdown", "Forced landing security; harnesses tight and doors unlatched"),
  ], { ...PA38_CHECKLIST_SOURCE, source: "PA-38-112 POH 3-3–3-4", category: 'emergency' }),
  startFire: checklist('startFire', "Fire during start", [
    i("crank", "Starter", "Continue cranking"),
    i("mixture", "Mixture", "Idle cut-off", le('mixture', 0.01)),
    i("throttle", "Throttle", "Open", ge('throttle', 0.99)),
    i("pump", "Fuel pump", "OFF", eq('fuelPump', false)),
    i("fuel", "Fuel selector", "OFF", eq('fuelSel', 'off')),
    i("exit", "If fire continues", "Abandon aircraft; extinguish"),
  ], { ...PA38_CHECKLIST_SOURCE, source: "PA-38-112 POH 3-4", category: 'emergency' }),
  engineFire: checklist('engineFire', "Engine fire in flight", [
    i("identify", "Fire source", "Identify"),
    i("fuel", "Fuel selector", "OFF", eq('fuelSel', 'off')),
    i("throttle", "Throttle", "Closed", le('throttle', 0.01)),
    i("mixture", "Mixture", "Idle cut-off", le('mixture', 0.01)),
    i("pump", "Fuel pump", "OFF", eq('fuelPump', false)),
    i("heat", "Cabin heat / defroster", "OFF"),
    i("land", "Landing", "Power-off landing"),
  ], { ...PA38_CHECKLIST_SOURCE, source: "PA-38-112 POH 3-4", category: 'emergency' }),
  electricalFire: checklist('electricalFire', "Electrical fire in flight", [
    i("master", "Master", "OFF", all(eq('master', false), eq('alternator', false))),
    i("heat", "Cabin heat / defroster", "OFF"),
    i("vents", "Vents", "Open"),
    i("land", "Landing", "As soon as practical"),
  ], { ...PA38_CHECKLIST_SOURCE, source: "PA-38-112 POH 3-5", category: 'emergency' }),
  electrical: checklist('electrical', "Alternator failure", [
    i("verify", "Ammeter", "Verify loss of output; reduce electrical load"),
    i("reset", "Alternator", "Check breaker; ALT OFF for 1 second then ON"),
    i("fails", "If no output", "ALT OFF; reduce load; land as soon as practical"),
  ], { ...PA38_CHECKLIST_SOURCE, source: "PA-38-112 POH 3-5", category: 'emergency' }),
};
