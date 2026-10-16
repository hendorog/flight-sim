// Condensed normal / emergency additions to the school checklists (Pilatus PC-12/47, PT6A-67B). PARAPHRASED from the
// PC-12/47E POH Report 02277 Rev 20 sections 3, 4 and 7 (47E-PROXY: another engine, the same airframe family; wording is
// ours, nothing is copied) and cross-read against the /47 limits of EASA TCDS A.089. Physical inspections, sequences and
// pilot judgements stay manual. SCHOOL marks common practice that is not POH. Speeds are KIAS; torque is read in psi.
// Live checks read the checklist frame (ui/checklistModel.ts): turbine.ng / turbine.itt / turbine.torqueFtLb (3708 ft lbf =
// 44.34 psi), the condition lever on `mixture` (below 0.1 CUT-OFF / FEATHER). The PC-12 has no propeller lever and no fuel
// selector: no item below refers to either.
import { checklist, checkItem as i, type FlightChecklist } from '../../training/checklistData';
import { all, eq, ge, le, lt } from '../../training/engine/dsl';

export const PC12_CHECKLIST_SOURCE = {
  source: 'Pilatus PC-12/47E POH 02277 sect. 3, 4, 7 (paraphrased; 47E used as the /47 proxy); limits EASA TCDS A.089',
  sourceUrl: 'https://www.easa.europa.eu/en/downloads/7348/en',
};
const POH = (where: string) => ({ ...PC12_CHECKLIST_SOURCE, source: `Pilatus PC-12/47E POH 02277 ${where} (paraphrased)` });

/** ft lbf at the 44.34 psi take-off torque, per psi (3708 / 44.34). */
export const PC12_FTLB_PER_PSI = 3708 / 44.34;
export const psiToFtLb = (psi: number): number => psi * PC12_FTLB_PER_PSI;

export const PC12_EXTRA_CHECKLISTS: Record<string, FlightChecklist> = {
  preflight: checklist('preflight', 'Preflight inspection', [
    i('planning', 'Flight planning', 'Weather, fuel, weight and balance, performance and limitations checked'),
    i('walkaround', 'Walk-around', 'Airframe, control surfaces and trim tabs, gear and brakes, propeller and spinner, engine inlet and exhaust, pitot / static, pusher and stall-warning probes'),
    i('fluids', 'Fuel and oil', 'Quantities checked; sumps drained; oil level in range; caps secure'),
    i('cabin', 'Cabin and doors', 'Cargo secured; doors closed and the handle locked; seats and restraints'),
  ], { ...POH('sect. 4, preflight inspection'), category: 'normal' }),
  taxi: checklist('taxi', 'Taxi', [
    i('brakes', 'Parking brake and brakes', 'Released; brake test at the start of the roll', eq('parkingBrake', false)),
    i('beta', 'Taxi speed', 'Control it with the power lever in the beta range (aft of the idle gate) before the brakes'),
    i('np', 'Propeller', 'No stabilised ground running between 350 and 950 rpm unfeathered'),
    i('instruments', 'Flight instruments', 'Attitude and heading checked in turns; EIS and CAWS clear'),
  ], { ...POH('sect. 4, taxi'), category: 'normal' }),
  takeoff: checklist('takeoff', 'Normal take-off', [
    i('flaps', 'Flaps', '15', all(ge('flapsDeg', 14), le('flapsDeg', 16))),
    i('trim', 'Trim', 'Elevator trim and RUDDER TRIM to the take-off marks (the rudder trim cancels the torque yaw)'),
    i('condition', 'Condition lever', 'FLIGHT IDLE', ge('mixture', 0.95)),
    i('power', 'Power lever', 'Smoothly forward to the take-off torque 44 psi; the torque limiter and ITT 800 °C come first at height'),
    i('instruments', 'Engine instruments', 'Torque, ITT, Ng and Np in limits; CAWS clear'),
    i('rotate', 'Rotate', '82 KIAS flaps 15; climb at 130 KIAS (flaps up above 100 KIAS)'),
  ], { ...POH('sect. 4, take-off'), category: 'normal' }),
  climb: checklist('climb', 'Climb', [
    i('flaps', 'Flaps', 'UP above 100 KIAS', lt('flapsDeg', 1)),
    i('speed', 'Airspeed', '130 KIAS best rate at sea level; cruise climb as the POH table gives', all(ge('kias', 115), le('kias', 145))),
    i('power', 'Power lever', 'Climb: torque to 36.95 psi maximum climb, ITT 760 °C max'),
    i('pressurisation', 'Cabin', 'Pressurisation and cabin altitude / differential checked (5.75 psid max)'),
  ], { ...POH('sect. 4, climb'), category: 'normal' }),
  cruise: checklist('cruise', 'Cruise', [
    i('power', 'Power lever', 'Set from the cruise power table: torque 36.95 psi max, ITT 760 °C max'),
    i('trim', 'Trim', 'Adjust (rudder trim for yaw)'),
    i('fuel', 'Fuel', 'Quantity and balance monitored; fuel pumps as the POH requires'),
  ], { ...POH('sect. 4, cruise'), category: 'normal' }),
  descent: checklist('descent', 'Descent / arrival preparation', [
    i('plan', 'Descent', 'Stay below 236 KIAS (Vmo) and the flap speeds: 163 flaps 15, 130 flaps 30 / 40'),
    i('power', 'Power lever', 'As required; no negative torque'),
    i('pressurisation', 'Cabin', 'Landing field elevation set; cabin differential at zero (0.7 psid max) before touchdown'),
    i('condition', 'Condition lever', 'FLIGHT IDLE', ge('mixture', 0.95)),
  ], { ...POH('sect. 4, descent and before landing'), category: 'normal' }),
  landing: checklist('landing', 'Landing and reverse', [
    i('gear', 'Landing gear', 'Down: three greens, UNSAFE out (below 177 KIAS)'),
    i('flaps', 'Flaps', '40 for the normal landing, Vref 85 KIAS', ge('flapsDeg', 39)),
    i('touch', 'After touchdown', 'Power lever IDLE, then beta / reverse as required; brakes as needed'),
    i('reverse', 'Reverse', 'Aft of the beta range only at the speed and with the rudder control the POH allows; back to the gate before the taxi speed'),
  ], { ...POH('sect. 4, landing and use of reverse'), category: 'normal' }),
  powerFailure: checklist('powerFailure', 'Engine failure after take-off', [
    i('fly', 'Airspeed', 'Lower the nose at once: 119 KIAS best glide feathered; slower with flaps down'),
    i('site', 'Landing site', 'Land ahead; only small heading changes'),
    i('power', 'Power lever', 'IDLE', lt('throttle', 0.02)),
    i('condition', 'Condition lever', 'CUT-OFF / FEATHER', lt('mixture', 0.05)),
    i('flaps', 'Flaps and gear', 'As the field needs (the gear stays down on a hard surface)'),
    i('electrics', 'Battery and generators', 'OFF once the flaps are set', all(eq('master', false), eq('alternator', false))),
  ], { ...POH('sect. 3, engine failure after take-off'), category: 'emergency' }),
  startFire: checklist('startFire', 'Engine fire during start', [
    i('condition', 'Condition lever', 'CUT-OFF / FEATHER', lt('mixture', 0.05)),
    i('motor', 'Starter', 'Keep MOTORING to blow the fire out of the exhaust'),
    i('pumps', 'Fuel pumps', 'OFF', eq('fuelPump', false)),
    i('secure', 'If the fire persists', 'Starter and battery OFF; evacuate and extinguish; inspect before another start'),
  ], { ...POH('sect. 3, engine fire on the ground'), category: 'emergency' }),
  hotStart: checklist('hotStart', 'Hot or hung start', [
    i('recognise', 'Recognise', 'ITT racing toward 1000 °C, or Ng hung below idle with ITT rising'),
    i('condition', 'Condition lever', 'CUT-OFF / FEATHER at once', lt('mixture', 0.05)),
    i('motor', 'Starter', 'Keep motoring to clear the fuel and cool the ITT, then STARTER INTERRUPT (Shift+N)'),
    i('log', 'Exceedance', 'Record peak ITT and its time; above the limit, maintenance before flight'),
  ], { ...POH('sect. 3, abnormal start'), category: 'emergency' }),
  engineFire: checklist('engineFire', 'Engine fire in flight', [
    i('power', 'Power lever', 'IDLE', lt('throttle', 0.02)),
    i('condition', 'Condition lever', 'CUT-OFF / FEATHER', lt('mixture', 0.05)),
    i('fuel', 'Fuel', 'Emergency fuel shut-off as the POH gives; fuel pumps OFF'),
    i('land', 'Landing', 'Forced landing; do not attempt an air start'),
  ], { ...POH('sect. 3, engine fire in flight'), category: 'emergency' }),
  electrical: checklist('electrical', 'Generator failure', [
    i('check', 'GEN 1 OFF / GEN 2 OFF', 'Identify the generator; reset once, then ON'),
    i('shed', 'If it will not reset', 'Shed the loads GEN 2 cannot carry (ice protection); land as soon as practical'),
    i('volts', 'Bus voltage', 'Monitor on the EIS; ESNTL BUS below 22 V'),
  ], { ...POH('sect. 3, generator failure'), category: 'emergency' }),
  pusher: checklist('pusher', 'Stick shaker and pusher', [
    i('shaker', 'Stick shaker', 'Is the stall warning: relax the back pressure, power as needed'),
    i('pusher', 'Pusher fires', 'Let it push; do not fight it; recover and apply power'),
    i('interrupt', 'PUSHER INTR', 'Hold only if the pusher malfunctions, and fly the speed above the pusher speed'),
  ], { ...POH('sect. 3 and 7-21, stick pusher'), category: 'emergency' }),
};
