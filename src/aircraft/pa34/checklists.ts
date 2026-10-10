// Condensed normal / emergency additions to the existing school checklists.
// Physical inspections, sequences and pilot judgements stay manual. Speeds are KIAS unless noted.
import { checklist, checkItem as i, type FlightChecklist } from '../../training/checklistData';

export const PA34_CHECKLIST_SOURCE = { source: "PA-34-200 Seneca POH (VB-563)", sourceUrl: "https://www.aeroelectric.com/Reference_Docs/Piper/Seneca_POH.pdf" };
export const PA34_EXTRA_CHECKLISTS: Record<string, FlightChecklist> = {
  preflight: checklist('preflight', "Preflight inspection", [
    i("planning", "Flight planning", "Weather, fuel, weight / CG, performance and limitations checked"),
    i("walkaround", "Preflight inspection", "Complete POH walk-around: airframe, flight controls, landing gear, propeller(s), intakes and pitot / static openings"),
    i("fluids", "Fuel and oil", "Check quantities; drain samples and inspect for contamination; caps secure"),
    i("cabin", "Cabin / baggage", "Secure loose articles, seats and restraints; remove control locks, covers and tie-downs"),
  ], { ...PA34_CHECKLIST_SOURCE, source: "PA-34-200 Seneca POH (VB-563) 7-1–7-4", category: 'normal' }),
  climb: checklist('climb', "Climb", [
    i("power", "Initial climb", "Maximum power for first 500 ft AGL; reduce throttle before propeller RPM"),
    i("speed", "Airspeed", "Best rate 105 MPH (91 KIAS); en-route climb 120 MPH (104 KIAS)"),
    i("cooling", "Cylinder temperatures / cowl flaps", "Keep CHT below 475°F; adjust cowl flaps"),
    i("pumps", "Fuel pumps above 500 ft AGL", "OFF one at a time; verify fuel pressure after each"),
  ], { ...PA34_CHECKLIST_SOURCE, source: "PA-34-200 Seneca POH (VB-563) 7-8", category: 'normal' }),
  cruise: checklist('cruise', "Cruise", [
    i("power", "Power / propellers", "Set from POH performance tables"),
    i("mixture", "Mixtures", "Lean per Lycoming IO-360 recommendations / POH power setting"),
    i("cooling", "Cylinder temperatures", "Maximum recommended 435°F high-performance / 400°F economy; adjust cowl flaps"),
  ], { ...PA34_CHECKLIST_SOURCE, source: "PA-34-200 Seneca POH (VB-563) 7-8", category: 'normal' }),
  descent: checklist('descent', "Descent / arrival preparation", [
    i("power", "Power / mixtures", "Reduce gradually; enrich as required for landing"),
    i("fuel", "Fuel selectors / pumps", "Both ON; pumps ON for landing"),
    i("landing", "Landing preparation", "Review before-landing checklist; gear limits and positive three-green indication"),
    i("limits", "Airspeed", "Plan deceleration within gear / flap limits"),
  ], { ...PA34_CHECKLIST_SOURCE, source: "PA-34-200 Seneca POH (VB-563) 7-9–7-10", category: 'normal' }),
  startFire: checklist('startFire', "Fire during start", [
    i("notStarted", "If engine has not started", "Mixture idle cut-off; throttle full open; continue cranking"),
    i("runs", "If engine runs", "Continue briefly to draw fire into engine"),
    i("persists", "If fire persists a few seconds", "Extinguish externally; BEFORE extinguishing, fuel valves OFF and mixtures idle cut-off"),
  ], { ...PA34_CHECKLIST_SOURCE, source: "PA-34-200 Seneca POH (VB-563) 3-18", category: 'emergency' }),
  engineFire: checklist('engineFire', "Engine fire in flight", [
    i("identify", "Affected engine", "Identify and verify; maintain aircraft control"),
    i("fuel", "Affected engine ONLY: fuel", "OFF"),
    i("throttle", "Affected engine ONLY: throttle", "Closed"),
    i("prop", "Affected engine ONLY: propeller", "Feather"),
    i("mixture", "Affected engine ONLY: mixture", "Idle cut-off"),
    i("heat", "Cabin heater / defroster", "OFF"),
    i("land", "Landing", "Immediately, terrain permitting"),
  ], { ...PA34_CHECKLIST_SOURCE, source: "PA-34-200 Seneca POH (VB-563) 3-18", category: 'emergency' }),
  electrical: checklist('electrical', "Alternator failure", [
    i("load", "Electrical load", "Reduce to no more than 50 A on remaining alternator"),
    i("reset", "Affected alternator", "Check / reset breakers; cycle OFF then ON"),
    i("fails", "If output not restored", "Maintain load at or below 50 A; repair before further flight"),
    i("both", "If both alternators inoperative", "Compass errors may exceed 10°; minimize load and land"),
  ], { ...PA34_CHECKLIST_SOURCE, source: "PA-34-200 Seneca POH (VB-563) 3-17", category: 'emergency' }),
};
