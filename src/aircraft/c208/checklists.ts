// Condensed normal / emergency additions to the existing school checklists (Cessna 208 Caravan 675, PT6A-114A).
// Physical inspections, sequences and pilot judgements stay manual. Speeds are KIAS unless noted; torque is
// propeller-shaft ft-lb. Procedures follow the 208 (675 shp) POH sections 3 and 4, condensed; no public copy of the
// POH was found, so the link is the EASA type certificate data sheet, which carries the engine limits quoted here
// (torque 1865 ft-lb, ITT 805 C, Ng 101.6 %, Np 1900). SCHOOL marks common operating practice that is not POH.
// Live checks read the checklist frame (ui/checklistModel.ts): turbine.ng / turbine.itt / turbine.torqueFtLb,
// prop.lever, and the condition lever on `mixture` (below 0.1 CUT-OFF).
import { all, eq, ge, le, lt } from '../../training/engine/dsl';
import { checklist, checkItem as i, type FlightChecklist } from '../../training/checklistData';

export const C208_CHECKLIST_SOURCE = {
  source: 'Cessna 208 Caravan 675 POH (condensed); limits EASA TCDS IM.A.226',
  sourceUrl: 'https://www.easa.europa.eu/en/downloads/7230/en',
};
const POH = (where: string) => ({ ...C208_CHECKLIST_SOURCE, source: `Cessna 208 Caravan 675 POH ${where}` });

export const C208_EXTRA_CHECKLISTS: Record<string, FlightChecklist> = {
  preflight: checklist('preflight', 'Preflight inspection', [
    i('planning', 'Flight planning', 'Weather, fuel, weight / CG, performance and limitations checked'),
    i('walkaround', 'Preflight inspection', 'Complete POH walk-around: airframe, flight controls, gear, propeller, engine inlet and exhausts, pitot / static openings'),
    i('fluids', 'Fuel and oil', 'Check quantities; drain the tank, reservoir and filter sumps; oil within 1.5 quarts of MAX HOT; caps secure'),
    i('cabin', 'Cabin / cargo', 'Cargo secured; seats and restraints; control lock, covers, inlet plugs and tie-downs removed'),
  ], { ...POH('sect. 4, preflight inspection'), category: 'normal' }),
  takeoff: checklist('takeoff', 'Normal take-off', [
    i('flaps', 'Flaps', '20', all(ge('flapsDeg', 19), le('flapsDeg', 21))),
    i('condition', 'Condition lever', 'HIGH IDLE', ge('mixture', 0.95)),
    i('prop', 'Propeller lever', 'MAX (1900 RPM)', ge('prop.lever', 0.95)),
    // At sea level ISA the torque limit comes first, at about 0.885 of the power lever's travel (C208_SIM autoflight).
    i('power', 'Power lever', 'Set: 1865 ft-lb torque or 805 °C ITT, whichever comes first; Ng 101.6 % max'),
    i('np', 'Np', '1900 RPM'),
    i('rotate', 'Rotate', '70 KIAS (short field 65); climb at 85–95 KIAS flaps 20 (SCHOOL)'),
    i('flapsUp', 'Flaps', 'UP above 90 KIAS (10 at 85 KIAS first if obstacles)'),
  ], { ...POH('sect. 4, take-off'), category: 'normal' }),
  climb: checklist('climb', 'Climb', [
    i('speed', 'Airspeed', '104 KIAS best rate at sea level (about 95 at 20 000 ft); cruise climb 110–120', all(ge('kias', 100), le('kias', 125))),
    i('power', 'Power lever', 'Climb: 1865 ft-lb max; ITT 765 °C max (maximum climb power)'),
    i('prop', 'Propeller lever', '1600–1900 RPM'),
    i('boost', 'Fuel boost', 'NORM; check the fuel quantity balance'),
  ], { ...POH('sect. 4, climb'), category: 'normal' }),
  cruise: checklist('cruise', 'Cruise', [
    i('power', 'Power lever', 'Set from the cruise torque table: 1865 ft-lb max; ITT 740 °C max (maximum cruise)'),
    i('prop', 'Propeller lever', '1600–1900 RPM'),
    i('trim', 'Trim', 'Adjust'),
    i('fuel', 'Fuel tank selectors', 'Both ON; monitor balance and quantity', eq('fuelSel', 'on')),
  ], { ...POH('sect. 4, cruise'), category: 'normal' }),
  descent: checklist('descent', 'Descent / arrival preparation', [
    i('plan', 'Descent', 'Plan to arrive below 175 KIAS (Vmo) and the flap speeds: 150 for flaps 20, 125 for FULL'),
    i('power', 'Power lever', 'As required; no negative torque'),
    i('belts', 'Seats / belts', 'Secure and locked'),
    i('condition', 'Before landing: condition lever', 'HIGH IDLE', ge('mixture', 0.95)),
    i('prop', 'Before landing: propeller lever', 'MAX (1900 RPM)', ge('prop.lever', 0.95)),
  ], { ...POH('sect. 4, descent and before landing'), category: 'normal' }),
  landing: checklist('landing', 'Normal landing', [
    i('flaps', 'Flaps', 'FULL below 125 KIAS'),
    i('speed', 'Approach', '78 KIAS short field, 80–85 normal (flaps FULL)'),
    i('touchdown', 'Touchdown', 'Main wheels first, power lever IDLE'),
    i('beta', 'After touchdown: power lever', 'BETA (lift over the idle gate: Shift+F2, let go, Shift+F2 again)'),
    i('reverse', 'Reverse', 'As required: further aft (hold Shift+F2); back to BETA by about 40 KIAS'),
    i('brakes', 'Brakes', 'As required'),
  ], { ...POH('sect. 4, landing'), category: 'normal', note: 'SCHOOL: the POH short-field ground roll (715 ft) is with beta and no reverse.' }),
  taxi: checklist('taxi', 'Taxi', [
    i('condition', 'Condition lever', 'LOW IDLE', le('mixture', 0.2)),
    i('beta', 'Taxi speed', 'Power lever in BETA as required (Shift+F2 over the gate; F3 back toward it); brakes as little as possible'),
    i('reverse', 'Reverse on the ground', 'Avoid at low speed over loose ground: the propeller picks up stones'),
  ], { ...POH('sect. 4, taxiing'), category: 'normal' }),
  powerFailure: checklist('powerFailure', 'Engine failure after take-off', [
    i('fly', 'Airspeed', 'Lower the nose at once: 95 KIAS flaps UP best glide; slower with flaps down'),
    i('site', 'Landing site', 'Land ahead; only small heading changes'),
    i('prop', 'Propeller lever', 'FEATHER', lt('prop.lever', 0.08)),
    i('condition', 'Condition lever', 'CUT-OFF', lt('mixture', 0.05)),
    i('fuel', 'Fuel tank selectors', 'OFF', eq('fuelSel', 'off')),
    i('flaps', 'Flaps', 'As required (FULL recommended)'),
    i('electrics', 'Battery and generator', 'OFF once the flaps are set', all(eq('master', false), eq('alternator', false))),
  ], { ...POH('sect. 3, engine failure immediately after take-off'), category: 'emergency' }),
  startFire: checklist('startFire', 'Engine fire during start', [
    i('condition', 'Condition lever', 'CUT-OFF', lt('mixture', 0.05)),
    i('motor', 'Starter', 'Keep MOTORING (ignition OFF) to blow the fire out of the exhaust'),
    i('fuel', 'Fuel tank selectors / boost', 'OFF', all(eq('fuelSel', 'off'), eq('fuelPump', false))),
    i('secure', 'If the fire persists', 'Starter OFF, battery OFF; evacuate and extinguish; inspect before the next start'),
  ], { ...POH('sect. 3, engine fire during start on ground'), category: 'emergency' }),
  hotStart: checklist('hotStart', 'Hot or hung start', [
    i('recognise', 'Recognise', 'ITT racing toward 1090 °C, or Ng stuck below 52 % with ITT rising'),
    i('condition', 'Condition lever', 'CUT-OFF at once', lt('mixture', 0.05)),
    i('motor', 'Starter', 'MOTOR (ignition OFF) about 15 s to clear fuel and cool the ITT'),
    i('starterOff', 'Starter', 'OFF; let the starter cool before another attempt'),
    i('log', 'Exceedance', 'Record peak ITT and its duration; above the limit, maintenance before flight'),
  ], { ...POH('sect. 3, abnormal starts'), category: 'emergency', note: 'SCHOOL: the simulator has no MOTOR position; ignition OFF (key 1) with the starter gives a dry motoring run.' }),
  engineFire: checklist('engineFire', 'Engine fire in flight', [
    i('power', 'Power lever', 'IDLE', lt('throttle', 0.02)),
    i('prop', 'Propeller lever', 'FEATHER', lt('prop.lever', 0.08)),
    i('condition', 'Condition lever', 'CUT-OFF', lt('mixture', 0.05)),
    i('fuel', 'Fuel tank selectors', 'OFF', eq('fuelSel', 'off')),
    i('heat', 'Cabin heat / vents', 'Heat OFF; forward vents closed, overhead vents open'),
    i('flaps', 'Flaps', '20–FULL as required'),
    i('land', 'Landing', 'Forced landing; do not attempt an air start'),
  ], { ...POH('sect. 3, engine fire in flight'), category: 'emergency' }),
  chipLight: checklist('chipLight', 'Chip light / low oil pressure', [
    i('gauges', 'Oil pressure and temperature', 'Check: 85–105 psi normal, 40 psi minimum at idle; 10–99 °C'),
    i('chip', 'CHIP light alone, gauges normal', 'Reduce power; land as soon as practical; expect engine failure'),
    i('low', 'Oil pressure 40–85 psi', 'Reduce power; land as soon as practical'),
    i('below', 'Oil pressure below 40 psi', 'Land as soon as possible; prepare for a forced landing; shut down if the engine runs rough or overheats'),
  ], { ...POH('sect. 3, chip detector and oil pressure'), category: 'emergency' }),
  electricalFire: checklist('electricalFire', 'Electrical fire in flight', [
    i('electrics', 'Battery and generator', 'OFF', all(eq('master', false), eq('alternator', false))),
    i('avionics', 'Avionics and other switches', 'OFF'),
    i('vents', 'Vents / heat', 'CLOSED'),
    i('extinguish', 'Extinguisher', 'Activate if available; ventilate after discharge'),
    i('restore', 'Only if fire out and power essential', 'Restore necessary loads one at a time with delay to locate the fault'),
  ], { ...POH('sect. 3, electrical fire in flight'), category: 'emergency' }),
  electrical: checklist('electrical', 'Generator failure', [
    i('reset', 'Generator', 'RESET, then ON; check the ammeter', eq('alternator', true)),
    i('fails', 'If it will not reset', 'Generator OFF; shed all loads not needed; land as soon as practical'),
    i('volts', 'Bus voltage', 'Monitor: the battery alone lasts about 30 min with loads shed'),
  ], { ...POH('sect. 3, generator failure'), category: 'emergency' }),
};
