// Condensed normal / emergency additions to the existing school checklists.
// Physical inspections, sequences and pilot judgements stay manual. Speeds are KIAS unless noted.
import { all, eq, ge, le } from '../../training/engine/dsl';
import { checklist, checkItem as i, type FlightChecklist } from '../../training/checklistData';

export const DA20_CHECKLIST_SOURCE = { source: "DA20-C1 AFM Rev 29", sourceUrl: "https://salt.aero/wp-content/uploads/2021/11/DA202-C1-AFM-Rev-29.pdf" };
export const DA20_EXTRA_CHECKLISTS: Record<string, FlightChecklist> = {
  preflight: checklist('preflight', "Preflight inspection", [
    i("planning", "Flight planning", "Weather, fuel, weight / CG, performance and limitations checked"),
    i("walkaround", "Preflight inspection", "Complete POH walk-around: airframe, flight controls, landing gear, propeller(s), intakes and pitot / static openings"),
    i("fluids", "Fuel and oil", "Check quantities; drain samples and inspect for contamination; caps secure"),
    i("cabin", "Cabin / baggage", "Secure loose articles, seats and restraints; remove control locks, covers and tie-downs"),
  ], { ...DA20_CHECKLIST_SOURCE, source: "DA20-C1 AFM Rev 29 4-5–4-12", category: 'normal' }),
  cruise: checklist('cruise', "Cruise", [
    i("pump", "Fuel pump", "OFF", eq('fuelPump', false)),
    i("power", "Throttle", "As required; observe engine limits"),
    i("mixture", "Mixture", "At 75% power or less: lean to 25°F rich of peak EGT"),
    i("flaps", "Flaps", "CRUISE", le('flapsDeg', 1)),
    i("trim", "Trim / gauges", "Adjust trim; check gauges"),
  ], { ...DA20_CHECKLIST_SOURCE, source: "DA20-C1 AFM Rev 29 4-23", category: 'normal' }),
  descent: checklist('descent', "Descent", [
    i("instruments", "Flight instruments / avionics", "Set as required"),
    i("pump", "Fuel pump", "ON", eq('fuelPump', true)),
    i("mixture", "Mixture", "Full rich", ge('mixture', 0.99)),
    i("power", "Throttle", "As required; avoid excessive engine cooling"),
  ], { ...DA20_CHECKLIST_SOURCE, source: "DA20-C1 AFM Rev 29 4-23", category: 'normal' }),
  powerFailure: checklist('powerFailure', "Engine failure · fly / land", [
    i("fly", "Control / airspeed", "Establish 73 KIAS with flaps CRUISE; immediately after takeoff lower nose and land ahead"),
    i("site", "Landing site", "Select within reach"),
    i("restart", "If altitude and time permit", "Use engine-failure touch drill / restart procedure"),
    i("land", "If restart fails", "Emergency landing with engine off; forced landing security; LDG flaps when landing assured"),
  ], { ...DA20_CHECKLIST_SOURCE, source: "DA20-C1 AFM Rev 29 3-8–3-11", category: 'emergency' }),
  startFire: checklist('startFire', "Fire during start", [
    i("runs", "If engine starts", "1800 RPM for a few minutes; shut down and inspect"),
    i("fails", "If engine does not start", "Continue cranking; throttle MAX; mixture idle cut-off"),
    i("secure", "Secure", "Fuel valve CLOSED; cabin heat OFF; fuel pump OFF; GEN/BAT OFF; ignition OFF"),
    i("exit", "Evacuate", "Extinguish fire"),
  ], { ...DA20_CHECKLIST_SOURCE, source: "DA20-C1 AFM Rev 29 3-12", category: 'emergency' }),
  engineFire: checklist('engineFire', "Engine fire in flight", [
    i("fuel", "Fuel valve", "CLOSED", eq('fuelSel', 'off')),
    i("heat", "Cabin heat", "Closed"),
    i("speed", "Airspeed / flaps", "73 KIAS; CRUISE flaps; increase within limits if needed to extinguish and landing site remains reachable"),
    i("pump", "Fuel pump", "OFF", eq('fuelPump', false)),
    i("land", "Landing", "Emergency landing with engine off"),
  ], { ...DA20_CHECKLIST_SOURCE, source: "DA20-C1 AFM Rev 29 3-13", category: 'emergency' }),
  electricalFire: checklist('electricalFire', "Electrical fire in flight", [
    i("master", "GEN / BAT", "OFF", all(eq('master', false), eq('alternator', false))),
    i("air", "Cabin air", "Open"),
    i("extinguish", "Extinguisher", "Use if smoke continues"),
    i("land", "Landing", "Prepare without delay; land immediately if fire cannot be visually confirmed extinguished"),
    i("restore", "Power restoration if needed", "Follow AFM circuit-isolation procedure only after assessing fire status"),
  ], { ...DA20_CHECKLIST_SOURCE, source: "DA20-C1 AFM Rev 29 3-14", category: 'emergency' }),
  electrical: checklist('electrical', "Generator failure", [
    i("cycle", "GEN switch", "Cycle OFF then ON"),
    i("breakers", "GEN / GEN CONTROL breakers", "Check; reset if tripped per AFM"),
    i("fails", "If output not restored", "Nonessential loads OFF; monitor ammeter / voltage; land at nearest suitable airfield"),
  ], { ...DA20_CHECKLIST_SOURCE, source: "DA20-C1 AFM Rev 29 3-19", category: 'emergency' }),
};
