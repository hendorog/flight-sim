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
  ], { ...C152_CHECKLIST_SOURCE, source: "C152 POH (1978) 4-5–4-6", category: 'normal' }),
  floodedStart: checklist('floodedStart', "Flooded engine (over-primed)", [
    i("signs", "Signs", "Weak intermittent firing, puffs of black smoke; no more priming"),
    i("mixture", "Mixture", "Idle cut-off", le('mixture', 0.02)),
    i("throttle", "Throttle", "Full open", ge('throttle', 0.99)),
    i("crank", "Starter", "Crank through several revolutions"),
    i("restart", "Then", "Repeat the starting procedure without any additional priming"),
  ], { ...C152_CHECKLIST_SOURCE, source: "C152 POH (1978) 4-11", category: 'normal' }),
  climb: checklist('climb', "Climb", [
    i("speed", "Airspeed", "70–80 KIAS", all(ge('kias', 70), le('kias', 80))),
    i("power", "Throttle", "Full", ge('throttle', 0.99)),
    i("mixture", "Mixture", "Rich below 3000 ft; above 3000 ft lean for maximum RPM"),
  ], { ...C152_CHECKLIST_SOURCE, source: "C152 POH (1978) 4-8", category: 'normal' }),
  cruise: checklist('cruise', "Cruise", [
    i("power", "Power", "1900–2550 RPM; no more than 75% power"),
    i("trim", "Elevator trim", "Adjust"),
    i("mixture", "Mixture", "Lean for cruise"),
  ], { ...C152_CHECKLIST_SOURCE, source: "C152 POH (1978) 4-8", category: 'normal' }),
  descent: checklist('descent', "Descent / arrival preparation", [
    i("plan", "Descent", "Plan to arrive within circuit and flap speed limits"),
    i("belts", "Seats / belts", "Secure and locked"),
    i("mixture", "Before landing: mixture", "Rich", ge('mixture', 0.99)),
    i("heat", "Before closing throttle", "Carburettor heat full ON", ge('checklist.carbHeat', 0.99)),
  ], { ...C152_CHECKLIST_SOURCE, source: "C152 POH (1978) 4-8", category: 'normal' }),
  powerFailure: checklist('powerFailure', "Engine failure · fly / land", [
    i("fly", "Control / airspeed", "60 KIAS, after takeoff and in flight (best glide)"),
    i("site", "Landing site", "Select within reach; after takeoff lower nose and land ahead"),
    i("restart", "If altitude and time permit", "Use engine-failure touch drill; ignition START if propeller stopped"),
    i("approach", "Forced-landing approach", "65 KIAS flaps up, 60 KIAS flaps down; flaps 30° recommended"),
    i("land", "If restart fails", "Forced landing security; unlatch doors before touchdown; touchdown slightly tail low; brake heavily"),
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
    i("overvoltage", "HIGH VOLTAGE light", "Master OFF (both halves), then ON; verify light out"),
    i("recurs", "If light illuminates again", "Terminate flight as soon as practical; minimise electrical load"),
    i("discharge", "Ammeter discharge", "Alternator OFF; nonessential electrical equipment OFF; terminate as soon as practical"),
  ], { ...C152_CHECKLIST_SOURCE, source: "C152 POH (1978) 3-8, 3-13–3-14", category: 'emergency' }),
  // POH 4-9: the balked landing (go-around) of the normal procedures.
  goAround: checklist('goAround', "Balked landing", [
    i("throttle", "Throttle", "Full open", ge('throttle', 0.99)),
    i("heat", "Carburettor heat", "Cold", le('checklist.carbHeat', 0.01)),
    i("flaps20", "Wing flaps", "Retract to 20°"),
    i("speed", "Airspeed", "55 KIAS"),
    i("flapsUp", "Wing flaps", "Retract slowly once at a safe airspeed"),
  ], { ...C152_CHECKLIST_SOURCE, source: "C152 POH (1978) 4-9–4-10", category: 'normal' }),
  takeoffRunFailure: checklist('takeoffRunFailure', "Engine failure during take-off run", [
    i("throttle", "Throttle", "Idle", le('throttle', 0.01)),
    i("brakes", "Brakes", "Apply"),
    i("flaps", "Wing flaps", "Retract", le('flapsDeg', 1)),
    i("mixture", "Mixture", "Idle cut-off", le('mixture', 0.01)),
    i("ignition", "Ignition switch", "OFF", eq('mags', 0)),
    i("master", "Master", "OFF", all(eq('master', false), eq('alternator', false))),
  ], { ...C152_CHECKLIST_SOURCE, source: "C152 POH (1978) 3-3", category: 'emergency' }),
  precautionaryLanding: checklist('precautionaryLanding', "Precautionary landing with engine power", [
    i("inspect", "Airspeed / flaps", "60 KIAS, flaps 20°"),
    i("field", "Selected field", "Fly over, noting terrain and obstructions; flaps up at a safe altitude and airspeed"),
    i("switches", "Radio and electrical switches", "OFF"),
    i("final", "On final approach", "Flaps 30°, 55 KIAS"),
    i("master", "Master", "OFF"),
    i("doors", "Doors", "Unlatch prior to touchdown"),
    i("ignition", "Ignition switch", "OFF"),
    i("brakes", "Brakes", "Apply heavily"),
  ], { ...C152_CHECKLIST_SOURCE, source: "C152 POH (1978) 3-4", category: 'emergency' }),
  spinRecovery: checklist('spinRecovery', "Spin recovery", [
    i("ailerons", "Ailerons", "Neutral"),
    i("throttle", "Throttle", "Idle", le('throttle', 0.01)),
    i("rudder", "Rudder", "Full opposite to the rotation and hold (turn coordinator shows the direction)"),
    i("wheel", "Control wheel", "Just after the rudder reaches the stop, briskly forward to break the stall; full down at aft CG"),
    i("hold", "Hold inputs", "Until rotation stops"),
    i("recover", "As rotation stops", "Neutralise rudder; smooth recovery from the dive"),
  ], { ...C152_CHECKLIST_SOURCE, source: "C152 POH (1978) 3-12", category: 'emergency',
    note: "Spins with flaps extended are prohibited. Developed spins are not modelled (KNOWN_ISSUES)." }),
  icing: checklist('icing', "Inadvertent icing encounter", [
    i("pitot", "Pitot heat", "ON (if installed)", eq('pitotHeat', true)),
    i("escape", "Course / altitude", "Turn back or change altitude to a temperature less conducive to icing"),
    i("defrost", "Cabin heat", "Full out for defrost; cabin air as required"),
    i("throttle", "Throttle", "Open to raise RPM and shed propeller ice"),
    i("carbHeat", "Carburettor heat", "As required; if used continuously, lean for maximum RPM"),
    i("land", "Landing", "Nearest airport, or off-airport if ice builds rapidly; expect a higher stall speed with 1/4 in or more"),
    i("flaps", "Wing flaps", "Leave retracted (tail ice: loss of elevator effectiveness)"),
    i("approach", "Approach", "65-75 KIAS; forward slip for visibility if needed; land in a level attitude"),
  ], { ...C152_CHECKLIST_SOURCE, source: "C152 POH (1978) 3-7", category: 'emergency' }),
  noElevator: checklist('noElevator', "Landing without elevator control", [
    i("trim", "Set-up", "Flaps 20°, about 55 KIAS; trim for level flight with throttle and trim"),
    i("glide", "Glide angle", "Leave the trim; control the descent with power only"),
    i("flare", "At flare-out", "Trim full nose-up; adjust power to rotate to a level attitude"),
    i("touchdown", "At touchdown", "Close the throttle"),
  ], { ...C152_CHECKLIST_SOURCE, source: "C152 POH (1978) 3-10", category: 'emergency' }),
  vacuumFailure: checklist('vacuumFailure', "Vacuum failure in cloud", [
    i("turn", "180° turn", "Standard-rate left turn on the turn coordinator for 60 s by the clock; check the compass reciprocal; rudder corrections"),
    i("descent", "Emergency descent", "Mixture rich, full carburettor heat, power for 500-800 ft/min, trim 70 KIAS"),
    i("hands", "Control", "Hands off the wheel; correct with rudder only by the turn coordinator and the compass trend"),
    i("spiral", "If in a spiral dive", "Close throttle; level the wings on the turn coordinator; ease back to 70 KIAS and trim; carburettor heat"),
  ], { ...C152_CHECKLIST_SOURCE, source: "C152 POH (1978) 3-10–3-12", category: 'emergency' }),
  cabinFire: checklist('cabinFire', "Cabin fire", [
    i("master", "Master", "OFF", all(eq('master', false), eq('alternator', false))),
    i("vents", "Vents / cabin air / heat", "CLOSED"),
    i("extinguisher", "Extinguisher", "Activate if available; ventilate after discharge"),
    i("land", "Landing", "As soon as possible; inspect for damage"),
  ], { ...C152_CHECKLIST_SOURCE, source: "C152 POH (1978) 3-6", category: 'emergency' }),
  wingFire: checklist('wingFire', "Wing fire", [
    i("nav", "Navigation lights", "OFF", eq('lightNav', false)),
    i("strobe", "Strobes", "OFF", eq('lightStrobe', false)),
    i("pitot", "Pitot heat", "OFF", eq('pitotHeat', false)),
    i("slip", "Side slip", "Keep the flames away from the fuel tank and cabin"),
    i("land", "Landing", "As soon as possible, flaps retracted"),
  ], { ...C152_CHECKLIST_SOURCE, source: "C152 POH (1978) 3-7", category: 'emergency' }),
  flatTyre: checklist('flatTyre', "Landing with a flat main tyre", [
    i("flaps", "Wing flaps", "As desired"),
    i("approach", "Approach", "Normal"),
    i("touchdown", "Touchdown", "Good tyre first; hold the flat tyre off with aileron as long as possible"),
  ], { ...C152_CHECKLIST_SOURCE, source: "C152 POH (1978) 3-7–3-8", category: 'emergency' }),
  roughRunning: checklist('roughRunning', "Rough running / low oil pressure", [
    i("carbIce", "Gradual RPM loss, roughness", "Full throttle and full carburettor heat until smooth; then heat off and reset throttle"),
    i("plugs", "Slight roughness", "Check L / R briefly; lean to cruise setting, then try richer; continue on BOTH to nearest airport"),
    i("magneto", "Sudden roughness / misfiring", "Identify on L / R; vary power and enrich; if needed run on the good magneto; land at nearest airport"),
    i("oilLow", "Low oil pressure, normal temperature", "Possible gauge or relief valve fault; land at nearest airport to inspect"),
    i("oilLost", "Oil pressure lost, temperature rising", "Reduce power at once; select a forced-landing field; minimum power to reach it"),
  ], { ...C152_CHECKLIST_SOURCE, source: "C152 POH (1978) 3-12–3-13", category: 'emergency' }),
};
