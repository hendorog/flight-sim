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
  ], { ...PA38_CHECKLIST_SOURCE, source: "PA-38-112 POH 4-3–4-5", category: 'normal' }),
  takeoff: checklist('takeoff', "Short / soft field take-off", [
    i("flaps", "Flaps", "21° (first notch)", all(ge('flapsDeg', 20), le('flapsDeg', 22))),
    i("short", "Short field", "Rotate at 53 KIAS; 61 KIAS until the obstacle is cleared (no obstacle: 70 KIAS); then 70 KIAS; flaps up slowly"),
    i("soft", "Soft field", "Nosewheel off as soon as possible; lift off at the lowest possible speed; accelerate just above the ground to 61 KIAS past an obstacle, or 70 KIAS; flaps up slowly"),
  ], { ...PA38_CHECKLIST_SOURCE, source: "PA-38-112 POH 4-8, 4-19–4-20", category: 'normal' }),
  climb: checklist('climb', "Climb", [
    i("speed", "Airspeed", "70 KIAS best rate; 61 KIAS best angle (flaps up)"),
    i("pump", "Electric fuel pump", "OFF at desired altitude; check fuel pressure", eq('fuelPump', false)),
  ], { ...PA38_CHECKLIST_SOURCE, source: "PA-38-112 POH 4-9, 4-20", category: 'normal' }),
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
    i("land", "Power-off landing", "Aim for downwind at 1000 ft AGL if practicable; when assured, flaps as needed; 67 KIAS (both strip pairs; 62 outboard only)"),
    i("secure", "When committed to landing", "Ignition, master and fuel selector OFF; mixture idle cut-off; seat belts and harness tight"),
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
    i("master", "Master", "OFF if radio not required (the stall warning goes with it)"),
    i("land", "Landing", "Power-off landing"),
  ], { ...PA38_CHECKLIST_SOURCE, source: "PA-38-112 POH 3-4, 3-10", category: 'emergency' }),
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
  takeoffAbort: checklist('takeoffAbort', "Power loss on the take-off roll", [
    i("throttle", "Throttle", "Close immediately", le('throttle', 0.01)),
    i("brakes", "Brakes", "Apply as required; stop straight ahead"),
    i("short", "If runway insufficient", "Mixture idle cut-off; fuel selector, master and magnetos OFF; keep directional control, avoid obstacles"),
  ], { ...PA38_CHECKLIST_SOURCE, source: "PA-38-112 POH 3-2, 3-7", category: 'emergency' }),
  takeoffPowerLoss: checklist('takeoffPowerLoss', "Power loss after lift-off", [
    i("speed", "Airspeed", "Maintain above stall"),
    i("ahead", "Runway sufficient", "Keep directional control; land straight ahead"),
    i("short", "Runway insufficient", "Throttle closed; mixture idle cut-off; fuel selector, master and magnetos OFF; flaps as required; only shallow turns to avoid obstacles"),
    i("restart", "If height for a restart", "Other tank with fuel; electric fuel pump ON; mixture RICH; carburettor heat ON; no power: power-off landing"),
  ], { ...PA38_CHECKLIST_SOURCE, source: "PA-38-112 POH 3-2–3-3, 3-7–3-8", category: 'emergency' }),
  oilPressure: checklist('oilPressure', "Loss of oil pressure", [
    i("land", "Landing", "As soon as possible; investigate the cause; do not change power unnecessarily"),
    i("prepare", "Power-off landing", "Prepare for it"),
  ], { ...PA38_CHECKLIST_SOURCE, source: "PA-38-112 POH 3-5, 3-11", category: 'emergency' }),
  fuelPressure: checklist('fuelPressure', "Loss of fuel pressure", [
    i("pump", "Electric fuel pump", "ON", eq('fuelPump', true)),
    i("tank", "Fuel selector", "Check on a full tank"),
    i("land", "If not an empty tank", "Land as soon as practical; have the engine-driven pump checked"),
  ], { ...PA38_CHECKLIST_SOURCE, source: "PA-38-112 POH 3-5, 3-11", category: 'emergency' }),
  oilTemp: checklist('oilTemp', "High oil temperature", [
    i("land", "Landing", "At the nearest airport; investigate; watch for a loss of oil pressure"),
    i("prepare", "Power-off landing", "Prepare for it"),
  ], { ...PA38_CHECKLIST_SOURCE, source: "PA-38-112 POH 3-5, 3-11", category: 'emergency' }),
  spin: checklist('spin', "Spin recovery", [
    i("ailerons", "Ailerons", "Neutral"),
    i("rudder", "Rudder", "Full opposite to the direction of rotation"),
    i("wheel", "Control wheel", "Full forward as the rudder hits the stop; relax it as the stall breaks"),
    i("throttle", "Throttle", "Close", le('throttle', 0.01)),
    i("neutral", "Rudder", "Neutral when rotation stops"),
    i("recover", "Control wheel", "As required to smoothly regain level flight"),
    i("flaps", "Flaps", "Retract", le('flapsDeg', 1)),
  ], { ...PA38_CHECKLIST_SOURCE, source: "PA-38-112 POH 3-5–3-6, 3-12", category: 'emergency' }),
  openDoor: checklist('openDoor', "Open door", [
    i("speed", "Airspeed", "Slow to 90 KIAS"),
    i("vents", "Cabin vents", "Close"),
    i("window", "Storm window", "Open"),
    i("latch", "Latches", "Upper open: latch it. Side open: pull on the arm rest while moving the handle to latched. Both: side, then top"),
  ], { ...PA38_CHECKLIST_SOURCE, source: "PA-38-112 POH 3-6, 3-13", category: 'emergency' }),
  roughness: checklist('roughness', "Engine roughness", [
    i("carbHeat", "Carburettor heat", "ON", ge('checklist.carbHeat', 0.99)),
    i("after", "Still rough after one minute", "Carburettor heat OFF; mixture for maximum smoothness; electric fuel pump ON; switch tanks; check gauges"),
    i("mags", "Magneto switch", "L, then R, then BOTH; if smooth on one, continue on it at reduced power, mixture RICH, to the first airport"),
    i("land", "If roughness persists", "Prepare for a power-off (precautionary) landing"),
  ], { ...PA38_CHECKLIST_SOURCE, source: "PA-38-112 POH 3-6, 3-13–3-14", category: 'emergency' }),
  pitotStatic: checklist('pitotStatic', "Loss of pitot-static pressure", [
    i("altStatic", "Alternate static source", "Open: the lever under the left side of the quadrant, pushed forward (not simulated)"),
    i("errors", "Altimeter, VSI and ASI", "Expect errors; see the correction card on the quadrant's left cover"),
    i("pitotHeat", "Pitot heat (if installed)", "ON if the pitot is iced or blocked by heavy rain"),
  ], { ...PA38_CHECKLIST_SOURCE, source: "PA-38-112 POH 3-14", category: 'emergency' }),
};
