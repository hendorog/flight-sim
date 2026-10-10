// Robinson R44 Raven II POH, Sections 3 and 4 (printed pages), current mixed revisions retrieved 11 Oct 2026.
// https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r44ii_poh_full_book_0586eefd22.pdf
// Condensed simulator reference. Inspection, timed sequences and pilot judgements are deliberately manual.
import { all, eq, ge, le } from '../../training/engine/dsl';
import { checklist, checkItem as i, type FlightChecklist } from '../../training/checklistData';

const url = 'https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r44ii_poh_full_book_0586eefd22.pdf';
const normal = (id: string, title: string, page: string, items: FlightChecklist['items'], note?: string) =>
  checklist(id, title, items, { category: 'normal', source: `R44 POH ${page}`, sourceUrl: url, note });
const emergency = (id: string, title: string, page: string, items: FlightChecklist['items']) =>
  checklist(id, title, items, { category: 'emergency', source: `R44 POH ${page}`, sourceUrl: url });
const down = i('collective', 'Collective', 'Fully down', le('checklist.collective', 0.01));
const governor = i('governor', 'Governor switch', 'ON', eq('checklist.governor', true));
const rich = i('mixture', 'Mixture', 'Full rich', ge('mixture', 0.99));
const rpm = i('flightRpm', 'Engine and rotor', '101–102%', all(ge('checklist.enginePercent', 101), le('checklist.enginePercent', 102), ge('checklist.rotorPercent', 101), le('checklist.rotorPercent', 102)));
const gauges = i('gauges', 'Gauges / caution lights', 'Normal indications; check each gauge and light');
const hyd = i('hydraulics', 'Hydraulics switch', 'ON (switch / failures not simulated)');
const clutch = i('clutchReady', 'Clutch', 'Engaged; actuator light out', all(eq('checklist.clutch', true), ge('checklist.clutchEngagement', 0.999), eq('checklist.clutchLight', false)));
const neutral = i('neutral', 'Cyclic and pedals', 'Neutral', all(ge('elevator', -0.02), le('elevator', 0.02), ge('aileron', -0.02), le('aileron', 0.02), ge('rudder', -0.02), le('rudder', 0.02)));
const fuelOff = i('fuelOff', 'Fuel valve', 'OFF', eq('fuelSel', 'off'));
const cutoff = i('cutoff', 'Mixture', 'OFF', le('mixture', 0.01));
const batteryOff = i('batteryOff', 'Battery', 'OFF', eq('master', false));
const exit = i('exit', 'After landing', 'If time permits stop rotors with brake; evacuate');

export const R44_CHECKLISTS = {
  preflight: normal('preflight', 'Preflight inspection', '4-1–4-6', [
    i('planning', 'Flight planning', 'Weather, fuel, weight / CG and height–velocity diagram checked'),
    i('inspection', 'Daily / preflight walk-around', 'Complete POH inspection: rotors, hubs, pitch links, drive belts, gearboxes, tail, skids and airframe'),
    i('fluids', 'Fuel and oil', 'Quantities checked; fuel sampled, caps secure; no leaks'),
    i('covers', 'Covers and tie-downs', 'Removed; intakes / pitot clear'),
    i('cabin', 'Cabin', 'Loose articles stowed; belts, doors and controls checked; left controls removed for non-pilot passenger'),
  ]),
  beforeStart: normal('beforeStart', 'Before starting', '4-6', [
    i('belts', 'Seat belts', 'Fastened'), i('fuel', 'Fuel valve', 'ON', eq('fuelSel', 'on')),
    i('free', 'Controls / throttle', 'Friction OFF; full travel free and correct'), down, neutral,
    i('friction', 'Cyclic / collective friction', 'ON after positioning controls'),
    i('rotorBrake', 'Rotor brake', 'Released (not simulated)'), i('breakers', 'Circuit breakers', 'In'),
    i('lights', 'Landing lights', 'OFF', eq('lightLanding', false)),
    i('avionics', 'Avionics', 'OFF', eq('avionics', false)),
    i('clutchOff', 'Clutch switch / actuator', 'Disengaged', all(eq('checklist.clutch', false), le('checklist.clutchEngagement', 0.001))),
    i('altimeter', 'Altimeter', 'Set to local QNH', all(ge('qnhErrHpa', -0.5), le('qnhErrHpa', 0.5))), governor, hyd,
  ]),
  engineStart: normal('engineStart', 'Engine start', '4-7–4-8', [
    i('throttle', 'Throttle', 'Closed', le('throttle', 0.01)),
    i('battery', 'Battery', 'ON', eq('master', true)), i('strobe', 'Strobe', 'ON', eq('lightStrobe', true)),
    i('clear', 'Rotor / engine area', 'Clear'), rich,
    i('prime', 'Ignition prime', 'PRIME until 3–5 seconds after fuel-pump light goes out; then BOTH'),
    i('cutoffPrime', 'Mixture before cranking', 'OFF', le('mixture', 0.01)),
    i('start', 'Starter / mixture', 'Crank until engine fires; move mixture full rich; release starter'),
    i('running', 'Engine running', 'Starter released, mixture rich', all(eq('engineRunning', true), eq('starter', false), ge('mixture', 0.99))),
    i('guard', 'Mixture guard', 'Installed'),
    i('starterLight', 'Starter-On light', 'Out; inspect indication'),
    i('idleRpm', 'Engine RPM', '50–60%', all(ge('checklist.enginePercent', 50), le('checklist.enginePercent', 60))),
    i('engage', 'Clutch switch', 'ENGAGE', eq('checklist.clutch', true)),
    i('blades', 'Blades', 'Turning within 5 seconds of engaging clutch; otherwise shut down'),
    i('alternator', 'Alternator switch', 'ON', eq('alternator', true)),
    i('oilTime', 'Oil pressure', 'At least 25 psi within 30 seconds; otherwise shut down'),
    i('oil', 'Oil pressure now', 'At least 25 psi', ge('oilPsi', 25)),
  ], 'POH starts with throttle closed. The current simulator needs a cracked grip (about 10%) and simplified priming; those workarounds do not satisfy the POH sequence.'),
  afterStart: normal('afterStart', 'After start / warm-up', '4-7–4-8', [
    i('avionics', 'Avionics switch', 'ON', eq('avionics', true)),
    i('headsets', 'Headsets / alerts', 'Check headsets and audio alert if fitted; visual warnings remain visible'), clutch,
    i('breakers', 'Circuit breakers', 'In'),
    i('warmup', 'Warm-up RPM', '60–70%', all(ge('checklist.enginePercent', 60), le('checklist.enginePercent', 70))), gauges,
  ], 'Check annunciator panel lights with the test switch if fitted.'),
  runup: normal('runup', 'Run-up', '4-7–4-8', [
    i('runupRpm', 'Engine RPM', '75% for checks', all(ge('checklist.enginePercent', 74.5), le('checklist.enginePercent', 75.5))),
    i('magCheck', 'Magnetos', 'Check each: no more than 7% drop in 2 seconds; return BOTH'),
    i('sprag', 'Sprag clutch', 'Reduce grip; verify tach needles split'),
    i('doors', 'Doors', 'Closed and latched'), i('map', 'Manifold pressure limits', 'Check placard for pressure altitude / temperature'),
    i('friction', 'Cyclic / collective friction', 'OFF'),
    i('hydCheck', 'Hydraulic check', 'Small cyclic inputs: OFF gives stiffness / feedback; ON gives free controls (not simulated)'),
    governor, rpm, gauges,
    i('hornCheck', 'Low RPM warning', 'Lift collective slightly, reduce RPM; verify light / horn at 97%; restore flight RPM'),
  ], 'The ±0.5% run-up indication allowance is a simulator reading tolerance, not a POH operating range.'),
  beforeTakeoff: normal('beforeTakeoff', 'Before lift-off / hover', '4-9', [
    i('doors', 'Doors / area', 'Doors latched; area clear'), clutch, governor, hyd, rpm,
    i('lift', 'Lift to hover', 'Raise collective slowly; balance cyclic and pedals as weight leaves skids'), gauges, i('hoverMap', 'Hover MAP', 'Note manifold pressure in the hover'),
  ]),
  afterTakeoff: normal('afterTakeoff', 'Climb', '4-9', [
    i('accelerate', 'Departure', 'Accelerate following height–velocity profile'),
    i('climb', 'Climb power', 'Avoid exceeding IGE hover MAP by more than 2 inHg; follow height–velocity profile'),
    rpm, i('rpmGuard', 'If RPM falls below 101%', 'Lower collective'), gauges,
  ]),
  cruise: normal('cruise', 'Cruise', '4-10', [rpm, rich,
    i('power', 'Collective / airspeed', 'Set MAP within limits; recommended maximum cruise 110 KIAS'), gauges,
    i('turbulence', 'Turbulence', 'Reduce speed; significant turbulence: 60–70 KIAS'),
  ], 'In-flight leaning is prohibited.'),
  descent: normal('descent', 'Descent', '4-13', [
    i('lower', 'Initiate descent', 'Reduce collective; avoid forward-cyclic low-G pushover'),
    i('limits', 'Speed / MAP', 'Observe airspeed and power limits'), rpm,
  ]),
  final: normal('final', 'Approach / landing', '4-13', [
    i('approach', 'Initial approach', 'Into wind at about 60 KIAS; lowest practical descent rate'),
    i('slow', 'Before slowing below 30 KIAS', 'Reduce descent rate to less than 300 ft/min'),
    i('hover', 'Approach to hover', 'Reduce speed and height smoothly'),
    i('land', 'Landing', 'From hover lower collective gently until contact'),
    i('landed', 'After contact', 'Collective fully down', all(eq('onGround', true), le('checklist.collective', 0.01))),
  ]),
  afterLanding: normal('afterLanding', 'After landing', '4-13–4-14', [down,
    i('slope', 'If on a slope', 'Centre cyclic before reducing RPM'),
    i('attend', 'Flight controls', 'Remain attended while engine runs'),
  ]),
  shutdown: normal('shutdown', 'Shutdown', '4-14', [down,
    i('cool', 'Cool engine', '60–70% until CHT drops; at least 1 minute if OAT above 38°C'), neutral,
    i('friction', 'Cyclic / collective friction', 'ON'),
    i('throttle', 'Throttle', 'Closed', le('throttle', 0.01)),
    i('disengage', 'Clutch switch', 'Disengage', eq('checklist.clutch', false)),
    i('waitMixture', 'Wait 30 seconds', 'Then mixture OFF'), cutoff,
    i('brake', 'Wait another 30 seconds', 'Then apply rotor brake (not simulated); never raise collective to slow rotors'),
    i('clutchOut', 'Clutch light', 'Out', eq('checklist.clutchLight', false)),
    i('switches', 'Avionics / alternator / battery / ignition', 'OFF', all(eq('avionics', false), eq('alternator', false), eq('master', false), eq('mags', 0))),
  ]),
  engineFailure: emergency('engineFailure', 'Power failure · above 500 ft', '3-1–3-3', [
    i('lower', 'Collective', 'Lower immediately to preserve rotor RPM'),
    i('glide', 'Establish autorotation', 'Approximately 70 KIAS; observe power-off Vne'),
    i('rotor', 'Collective / rotor RPM', '97–108%; full down if light weight prevents 97%'),
    i('site', 'Landing site', 'Select; land into wind if height permits'),
    i('restart', 'Restart', 'Only if safe autorotation established, above 2000 ft AGL, time permits and no engine malfunction suspected'),
    i('secure', 'If restart unsuccessful', 'Unnecessary switches and fuel valve OFF'),
    i('flare', 'About 40 ft AGL', 'Cyclic flare to reduce forward speed and descent'),
    i('cushion', 'About 8 ft AGL', 'Level with forward cyclic; collective just before contact to cushion'),
    i('slide', 'Touchdown / slide', 'Level skids, nose straight; no aft cyclic during contact or slide'),
  ]),
  lowHeightFailure: emergency('lowHeightFailure', 'Power failure · below 500 ft', '3-2–3-3', [
    i('height', '8–500 ft AGL', 'Lower collective immediately; maintain RPM 97–108% or full down if light'),
    i('speed', '8–500 ft AGL', 'Maintain airspeed until ground approaches; flare, level around 8 ft and cushion'),
    i('hoverFailure', 'Below 8 ft AGL', 'Right pedal as needed; allow settling; raise collective just before touchdown'),
  ]),
  lowRpm: emergency('lowRpm', 'Low rotor RPM', '3-11', [
    i('recover', 'Recover RPM immediately', 'Lower collective, roll throttle on; in forward flight apply aft cyclic'),
    i('rpm', 'Rotor RPM', 'Restore flight range', all(ge('checklist.rotorPercent', 101), le('checklist.rotorPercent', 102))),
  ]),
  startFire: emergency('startFire', 'Fire during start', '3-6', [
    i('crank', 'Cranking', 'Continue to draw flames / fuel into engine'),
    i('fires', 'If engine starts', 'Run briefly at 60–70% RPM'), cutoff, fuelOff, batteryOff, exit,
  ]),
  engineFire: emergency('engineFire', 'Engine fire in flight', '3-6', [
    i('autorotate', 'Enter autorotation', 'Lower collective immediately'),
    i('vent', 'If time permits', 'Cabin heat OFF; vent ON'),
    i('running', 'If engine still runs', 'Normal landing; then mixture OFF and fuel valve OFF'),
    i('stopped', 'If engine stops', 'Fuel valve OFF; complete autorotation landing'), batteryOff, exit,
  ]),
  electricalFire: emergency('electricalFire', 'Electrical fire in flight', '3-6', [
    i('powerOff', 'Battery / alternator', 'OFF', all(eq('master', false), eq('alternator', false))),
    i('vents', 'Cabin vents', 'Open'), i('land', 'Land immediately', 'Governor and low RPM warning unavailable with electrical power off'),
    i('fuel', 'After landing', 'Mixture OFF; fuel valve OFF'), exit,
  ]),
  electrical: emergency('electrical', 'Alternator / low voltage', '3-10', [
    i('loads', 'Electrical load', 'Switch off nonessential equipment'),
    i('reset', 'Alternator', 'OFF, wait one second, ON to reset'),
    i('land', 'If ALT light remains on', 'Land as soon as practical; tachometer power may be lost'),
  ]),
} satisfies Record<string, FlightChecklist>;
