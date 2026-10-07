// Everything the instructor and examiner say, by cue id ('L04.climbTo', 'common.illStayQuiet'): 1-3 variants
// each, at most 20 words, with {name:format} templates (section 2.6).
//
// Voices (section 1.4). Kate Mercer, FI(A): calm, short sentences, the standard patter ("Lookout, attitude,
// instruments"; "Attitude, power, trim"), praise rare and specific. David Hale, examiner: formal, tasks only, no
// evaluation in flight. Captions are the written form; the phraseology renderer turns templates into speech
// (section 3.7.3). `speak` is given only where the caption has an abbreviation a synthesiser would mangle.
//
// Namespaces:
//   common.*            shared by several lessons
//   Lnn.*, N1.*, C.*    one lesson (or the challenges)
//   demo.*              the demonstration scripts' lines: DEMO_LINES (content/demos.ts) are merged in first,
//                       so an entry here with the same id overrides the copilot module's default
// The engine's own lines ('runner.*', engine/runner.ts RUNNER_LINES) and the coach preset rungs
// (content/coachPresets.ts) live with their code; an entry here with a runner.* id overrides one.
// Lesson lines use cue vars, run variables, signals, vspeed.*, setting.* and tol.* in their templates.
// Briefing summaries (`*.brief`) are 30-45 s and are split at sentence boundaries by the speech backend;
// every sentence is at most 20 words.

import { Priority } from '../types';
import type { InlineCue, LineTable } from '../types';
import { DEMO_LINES } from './demos';

/** Safety: interrupts anything, short TTL (section 3.7.1). */
const safety = (text: string | string[], extra: Partial<InlineCue> = {}): InlineCue => ({ text, priority: Priority.Safety, interrupt: true, ...extra });
const examiner = (text: string | string[], extra: Partial<InlineCue> = {}): InlineCue => ({ text, actor: 'examiner', ...extra });

const COMMON: Record<string, InlineCue> = {
  'common.illStayQuiet': { text: ["This time I'll stay quiet. Fly it as if I'm not here.", "Your turn, and I'll stay quiet. Fly it as if I'm not here."] },
  'common.goodNowCruise': { text: ['Good. Cruise power, {setting.cruiseRpm:rpm}, and trim.', 'Nicely levelled. Cruise power, {setting.cruiseRpm:rpm}, then trim.'] },
  'common.backToArea': { text: ["I've brought us back over the training area.", "I've flown us back to the middle of the area."] },
  'common.linedUp': { text: ['Lined up on runway 07. Your aircraft when ready.', "We're lined up on runway 07 again."], speak: ['Lined up on runway zero seven. Your aircraft when ready.', "We're lined up on runway zero seven again."] },
  'common.endDual': { text: ["OK, I have control. Let's head back and talk about it.", "That's the lesson. I have control; let's go and debrief."] },
};

const L01: Record<string, InlineCue> = {
  'L01.brief': { text: "Today we'll see what each control does. The elevator controls pitch, the ailerons control roll, and the rudder controls yaw. Each works relative to the aircraft, not the horizon. Each control also has further effects: rudder rolls, aileron yaws, and power pitches and yaws. I'll show you each one, then you'll try them yourself. Finally we'll trim the aircraft to fly hands-off. Attitude, power, trim: you'll hear that a lot. Lookout before every manoeuvre." },
  'L01.demoIntro': { text: 'I have control. Follow me through on the controls. Watch the nose against the horizon.' },
  'L01.demoWrap': { text: 'That was every control and its further effects. Now you try.' },
  'L01.pitch': { text: 'Raise the nose about 5 degrees, then lower it to 5 degrees below where it started, then back to level.' },
  'L01.roll': { text: 'Roll to 15 degrees of bank left, then right, then wings level.' },
  'L01.yaw': { text: 'Push the left rudder and watch the nose yaw. Then centre the ball.' },
  'L01.powerSetup': { text: "Now power. I've slowed us to sixty-eight knots, level and trimmed, as at the start of a climb." },
  'L01.power': { text: 'Full throttle, nose up to the climb attitude, {vspeed.Vy:kt}. Watch the ball, then centre it with your feet.' },
  'L01.mistrim': { text: "Now trimming. I'll wind in some nose-down trim: hold the attitude with a little back pressure.", ttlS: 20 },
  'L01.trim': { text: 'Hold the nose there, and trim nose up, a little at a time, until the pressure is gone.' },
  'L01.wrap': { text: "Good. That's how the controls work. I have control; let's talk about it on the ground." },
};

const L02: Record<string, InlineCue> = {
  'L02.brief': { text: "Today we start the engine, taxi to holding point A1 and do the power checks. Before the start, we check every switch and lever. I'll point to each one, say where it goes and why. After the start, oil pressure within 30 seconds, then set 1,000 rpm on the tachometer. A1 is at the far end of taxiway Alpha, beside the runway start, about a kilometre away. I'll call the turns on the taxi: right along the apron, left on B1, right on Alpha, left on A1. Walking pace, on the yellow line. Stop before the double yellow lines." },
  'L02.intro': { text: "Cold and dark. First the before-start checks: I'll point to each control and say where it goes." },
  'L02.start': { text: 'Before we start: look outside, both sides. Nobody near the propeller? Then call "Clear prop!"' },
  'L02.crank': { text: '"Clear prop!" Now the start.' },
  'L02.engineStopped': { text: 'The engine has stopped. Mixture rich, throttle a quarter inch open, then key to START again.' },
  'L02.oilPressure': { text: 'Engine running. Oil pressure first: green within 30 seconds. Then set 1,000 rpm on the tachometer, small throttle movements.' },
  'L02.taxiRoute': { text: 'A1, far end of Alpha by the runway. Route: right on the apron, left B1, right Alpha, left A1.',
    speak: 'Alpha one, at the far end of alpha. Right on the apron, left bravo one, right alpha, left alpha one.' },
  'L02.taxi': { text: "Parking brake off, Shift+B, when you're ready. I'll call each turn as we come to it.",
    speak: "Parking brake off, shift B, when you're ready. I'll call each turn as we come to it." },
  'L02.runupIntro': { text: "Stopped at A1, facing the runway. Now the engine checks: run-up first, then the before take-off checks.",
    speak: 'Stopped at alpha one, facing the runway. Now the engine checks: run-up first, then the before take-off checks.' },
  'L02.runupRpm': { text: 'Parking brake set, into wind if we can. Throttle up slowly to {setting.runupRpm:rpm}.' },
  'L02.mags': { text: 'Right magneto, back to both, left magneto, back to both. Note each drop.' },
  'L02.backAtParking': { text: "We're back on the apron. Let's shut down by the checklist." },
  'L02.wrap': { text: "Engine's off. Good checks. Let's talk about the taxi." },
};

const L03: Record<string, InlineCue> = {
  'L03.brief': { text: "Today is straight and level flight. Lookout, attitude, instruments: most of your attention stays outside, on the attitude. Power sets the speed; attitude holds the altitude. Every change is attitude, power, trim, in that order. We'll fly at cruise first, then at 80 knots, then with flap 20 at 70 knots. Slower speeds need more nose-up attitude and a little more care. Flap lowers the nose and raises the drag. At the end I'll ask for a speed change and stay quiet." },
  'L03.demoIntro': { text: 'I have control. Follow me through. Watch where the horizon sits in the windscreen.' },
  'L03.demoWrap': { text: 'Attitude, power, trim. Every speed has its own attitude. Your turn next.' },
  // The captured altitude and heading are named, so "say again" (R) gives the numbers, as an instructor would.
  'L03.holdCruise': { text: 'Hold {a0:alt}, heading {hdg0:hdg}, at cruise power. Lookout, attitude, instruments.' },
  'L03.slow80': { text: 'Reduce to 80 knots: power to {setting.descentRpm:rpm}, raise the nose, hold the altitude, trim.' },
  'L03.flap20': { text: 'Now flap 20 and 70 knots. The nose will want to rise: hold the attitude.' },
  'L03.cleanUp': { text: 'Cruise power, flap up in stages, back to {vspeed.Vcruise:kt}. Hold the altitude.' },
  'L03.assessCruise': { text: 'Straight and level at cruise: {a1:alt}, heading {hdg1:hdg}. I will ask for a speed change.' },
  'L03.assessSlow': { text: 'Now reduce to 85 knots. Same altitude, same heading.' },
};

const L04: Record<string, InlineCue> = {
  'L04.brief': { text: "Today we climb and descend, and level off on an exact altitude. To climb: attitude, then full power, then trim. Hold the speed with the attitude, not the throttle. Start levelling at ten percent of the rate: fifty feet early at five hundred feet a minute. We'll glide with the throttle closed at the best glide speed. Then we'll descend at five hundred feet a minute and ninety knots, with reduced power. Lookout above before climbing, and below before descending." },
  'L04.demoIntro': { text: 'I have control. Follow me through. Attitude, power, trim.' },
  'L04.demoClimbEntry': { text: 'Full power. Raise the nose to the climb attitude; let the speed settle at {vspeed.Vy:kt}.' },
  // demoLeadLevelOff is said as the climb settles (the segment runs until 50 ft short), demoApt at 50 ft to go.
  'L04.demoLeadLevelOff': { text: "Settled at {vspeed.Vy:kt}, full power, trimmed. Fifty feet before the altitude I'll start levelling." },
  'L04.demoApt': { text: 'Fifty feet to go: lower the nose to the level attitude, power back, trim. Attitude, power, trim.' },
  'L04.demoWrap': { text: 'Level at {alt:alt}. Power back to {setting.cruiseRpm:rpm}, trimmed.' },
  'L04.climbTo': { text: ['Climb to {alt:alt} at {vspeed.Vy:kt}. Lookout first.', 'Lookout, then climb to {alt:alt} at {vspeed.Vy:kt}.'] },
  'L04.settleCruise': { text: 'Settle at cruise power and trim it out.' },
  'L04.glideTo': { text: 'Throttle closed, glide at {vspeed.Vglide:kt}, level at {alt:alt}.' },
  'L04.descend500': { text: 'Descend at 500 feet per minute, {vspeed.Vdescent:kt}, to {alt:alt}.' },
  'L04.wrap': { text: "OK, I have control. Let's head back and talk about it." },
};

const L05: Record<string, InlineCue> = {
  'L05.brief': { text: "Today we turn. Lookout into the turn first, and above and below. Roll on thirty degrees of bank with aileron and a touch of rudder, then hold it there. In a level turn the nose wants to drop, so add a little back pressure. Roll out about half the bank angle before the heading. We'll fly level turns, turns onto headings, then climbing and gliding turns. In a gliding turn, lower the nose to keep the speed." },
  'L05.demoIntro': { text: 'I have control. Follow me through. Lookout left, clear above and below.' },
  'L05.demoWrap': { text: 'Thirty degrees, a little back pressure, roll out fifteen degrees early. Your turn.' },
  'L05.turn360Left': { text: ['Lookout left. A level 360 to the left, 30 degrees of bank.', 'Clear left? Level turn left through 360, 30 degrees of bank.'] },
  'L05.turn360Right': { text: ['Lookout right. A level 360 to the right, 30 degrees of bank.', 'Clear right? Level turn right through 360, 30 degrees of bank.'] },
  'L05.onto290': { text: 'Turn right onto heading 290.', speak: 'Turn right onto heading two nine zero.' },
  'L05.onto110': { text: 'Now turn left onto heading 110.', speak: 'Now turn left onto heading one one zero.' },
  'L05.climbingTurn': { text: 'Full power, climb at {vspeed.Vy:kt}, and turn left through 180 with 15 degrees of bank.' },
  'L05.glidingTurn': { text: 'Throttle closed, glide at {vspeed.Vglide:kt}, and turn right through 180 with 30 degrees.' },
  'L05.powerBackOn': { text: 'Good. Power back on, level off, and trim.' },
};

const L06: Record<string, InlineCue> = {
  'L06.brief': { text: "Today is slow flight, close to the stall but in full control. HASELL checks first: height, airframe, security, engine, location, lookout. At low speed the controls feel soft, so use bigger, slower movements. Power controls the height; attitude controls the speed. High power and low speed make the aircraft yaw left: keep the ball in the middle. If the stall warning sounds, lower the nose a touch and add power. We'll fly clean, then with full flap." },
  'L06.demoIntro': { text: "HASELL checks first, then I'll show you. Follow me through." },
  'L06.demoWrap': { text: 'Power for height, attitude for speed. Bigger control movements. Your turn.' },
  'L06.clean': { text: 'Slow to {vspeed.Vslow:kt} plus ten, clean. Hold the height with power.' },
  'L06.fullFlap': { text: 'Now full flap, and slow to {vspeed.Vslow:kt}. Hold the height and heading.' },
  'L06.recover': { text: 'Full power, flap up in stages, accelerate to cruise. Hold the height.' },
  'L06.assessed': { text: 'Full flap, {vspeed.Vslow:kt}, this height and heading. No stall warning.' },
  'L06.gentleLeft': { text: 'A gentle turn left, 15 degrees of bank, through 90 degrees. Same height.' },
  'L06.gentleRight': { text: 'Now a gentle turn right, 15 degrees, through 90. Same height.' },
};

const L07: Record<string, InlineCue> = {
  'L07.brief': { text: "Today we stall the aircraft and recover. HASELL checks first, and a clearing turn before every stall. The symptoms are a high nose, a low and falling speed, the warning, buffet, then the nose drops. To recover, move the control column forward, apply full power and keep the wings level with rudder. Then climb away. With flap, raise it in stages once above {vspeed.Vx:kt}. We recover at the warning first, then at the stall itself." },
  'L07.demoIntro': { text: "HASELL checks, then I'll show you a stall. Follow me through." },
  'L07.demoWrap': { text: 'Forward to unstall, full power, wings level, climb. Your turn.' },
  'L07.clearingTurn': { text: ['Clearing turn: at least 180 degrees. Look below and behind.', 'Clearing turn first, 180 degrees. Lookout all round.'] },
  'L07.entryCleanWarning': { text: 'Close the throttle. Hold the height as the speed decays. Recover at the stall warning.' },
  'L07.entryCleanBreak': { text: 'Close the throttle, hold the height. This time keep it coming back until the nose drops.' },
  'L07.entryApproachBreak': { text: 'Flap 30, power to 1,500 rpm. Hold the height until the stall.' },
  'L07.recover': safety('Recover: forward, full power, wings level.'),
};

const L08: Record<string, InlineCue> = {
  'L08.brief': { text: "Today is the take-off. Before take-off checks complete, landing light on, flaps up. Check the approach is clear before lining up. Apply full power smoothly and keep straight on the centreline with rudder: the aircraft swings left. Rotate at {vspeed.Vr:kt}: raise the nose to the climb attitude and let it fly off. Accelerate to {vspeed.Vy:kt} and climb on runway heading. If anything is wrong on the roll, close the throttle and brake." },
  'L08.demoIntro': { text: "I have control. I'll fly this take-off; follow me through. Feet on the rudder." },
  'L08.demoWrap': { text: 'Straight on the centreline, rotate, climb at {vspeed.Vy:kt}. Your turn.' },
  'L08.yourTakeoff': { text: ['Your take-off. Full power, keep it straight, rotate at {vspeed.Vr:kt}.', 'Your aircraft. Take off and climb at {vspeed.Vy:kt}.'] },
  'L08.practiceDone': { text: ["Good. I have control. We'll do that again.", 'That will do. I have control; once more.'] },
  'L08.assessedTakeoff': { text: 'Before take-off checks, then take off and climb to 500 feet on runway heading.' },
};

const L09: Record<string, InlineCue> = {
  'L09.brief': { text: "Today we land, starting on a long final. Be stabilised by 300 feet: on speed, on the centreline, landing flap, sink under a thousand feet a minute. If not, go around. Power controls the path; attitude controls the speed. Watch the PAPI: two white, two red. Keep the aim point fixed in the windscreen. At about fifteen feet, close the throttle and flare. Hold it off until the mains touch, nosewheel held off." },
  'L09.demoIntro': { text: "I have control. I'll fly this approach and landing. Follow me through, and watch the aim point." },
  'L09.demoWrap': { text: 'Stabilised by 300 feet, close the throttle, hold it off. Your turn.' },
  'L09.onFinal': { text: ["We're on final, three miles out.", "Back on a three-mile final."] },
  'L09.yourLanding': { text: ['Your aircraft. Land on runway 07; flap 30 at {vspeed.Vref:kt} on short final.', 'Your landing. Stabilised by 300 feet, then land.'], speak: ['Your aircraft. Land on runway zero seven; flap thirty at {vspeed.Vref:kt} on short final.', 'Your landing. Stabilised by three hundred feet, then land.'] },
  'L09.assessedIntro': { text: "Two landings now. I'll only speak if I need to." },
};

const L10: Record<string, InlineCue> = {
  'L10.brief': { text: "Today, the full circuit. Climb straight ahead to 500 feet, then turn left onto crosswind. Level at 1,000 feet on downwind, {setting.circuitRpm:rpm}, {vspeed.Vdownwind:kt}, with the runway just along the wingtip. Do the downwind checks. Abeam the threshold, power back and flap 10. Turn base at about 45 degrees behind the threshold, with flap 20. On final, flap 30 at {vspeed.Vref:kt}, stabilised by 300 feet, then land. Lookout before every turn." },
  'L10.demoIntro': { text: "I have control. I'll fly one circuit; follow me through and listen to the calls." },
  'L10.demoWrap': { text: "That's the circuit. Your turn: same speeds, same checks." },
  'L10.firstCircuit': { text: 'Your aircraft. Take off, climb to 500 feet, then turn left crosswind.' },
  'L10.circuitAgain': { text: ['Your aircraft. Same again: take off and fly the circuit.', 'Off we go again. Your circuit.'] },
  'L10.downwind': { text: ['Downwind: 1,000 feet, wingtip along the runway, checks.', 'Level at 1,000 feet on downwind, and your checks.'] },
  'L10.baseFinal': { text: ['Abeam the threshold, power back, flap 10. Turn base when it looks right.', 'Base and final: flap as you go, stabilised by 300 feet.'] },
};

const L11: Record<string, InlineCue> = {
  'L11.brief': { text: "Today: go-arounds, then landings without flap and without power. To go around: full power, stop the descent, flap to 20, climb at {vspeed.Vy:kt}. Then raise the flap in stages above sixty knots. Unstable at 300 feet means go around: it's a decision, not a failure. A flapless approach is flatter and faster, with a longer float. For the glide approach, close the throttle abeam the aim point and judge the turn onto base." },
  'L11.demoIntro': { text: "I have control. Watch the go-around: power, attitude, then the flap." },
  'L11.demoWrap': { text: 'Full power, stop the descent, flap up in stages. Your turn.' },
  'L11.onFinal': { text: ['On final, two miles. Expect a go-around.', 'Two-mile final. Fly the approach; I may call a go-around.'] },
  'L11.flyApproach': { text: 'Your aircraft. Fly the approach as if to land.' },
  'L11.goAroundNow': safety(['Go around!', 'Go around, go around!']),
  'L11.unstableSetup': { text: "I've set you up. Your aircraft, your decision." },
  'L11.yourDecision': { text: 'Land or go around: your call.' },
  'L11.flaplessSetup': { text: "Downwind. This one's flapless: the flap is unserviceable." },
  'L11.flapless': { text: 'Flapless approach and landing. Speed {vspeed.VappFlapsUp:kt}, and expect a long float.' },
  'L11.glideSetup': { text: 'Downwind again. A glide approach this time.' },
  'L11.glideApproach': { text: 'Close the throttle abeam the aim point, glide at {vspeed.Vglide:kt}, and land.' },
};

const L12: Record<string, InlineCue> = {
  'L12.brief': { text: "Today, engine failures in the circuit. After take-off, lower the nose at once to the glide attitude: speed first. Land ahead, within thirty degrees either side. Never turn back below 700 feet. If there's time, the touch drills: fuel selector both, mixture rich, magnetos both, fuel pump on. On downwind, turn toward the runway early and judge the glide. I'll close the throttle and keep my hand on it. I'll call the go-around." },
  'L12.demoIntro': { text: "I have control. I'll take off, and simulate an engine failure. Watch the nose." },
  'L12.demoWrap': { text: 'Nose down at once, land ahead, drills if there is time. Your turn.' },
  'L12.takeOff': { text: 'Your aircraft. Take off and climb out.' },
  'L12.engineFailure': safety(['Engine failure!', 'Simulated engine failure!']),
  'L12.engineFailureDownwind': safety('Simulated engine failure. Glide to the runway.'),
  'L12.haveThrottle': { text: 'I have the throttle.' },
  'L12.goAround': { text: ['Go around. You have the throttle.', 'Go around now: your throttle.'] },
  'L12.downwindSetup': { text: "We're on downwind at the midpoint." },
};

const L13: Record<string, InlineCue> = {
  'L13.brief': { text: "This is your pre-solo check. You'll fly a circuit to land, a circuit with a go-around, an engine failure after take-off, and a glide approach. Fly as if I'm not here; I'll only give you the tasks. Everything is graded to the test standard, first attempt. Your checks, your lookout, your decisions. If I have to take control, the check stops there. Take your time on the ground and settle in." },
  'L13.intro': { text: "Pre-solo check. I'll give you the tasks only. Your aircraft when you're ready." },
  'L13.goAroundCircuit': { text: 'Another circuit, please. Fly the approach as if to land.' },
  'L13.wrap': { text: "That's the check. I have control. Let's talk on the ground." },
};

const L14: Record<string, InlineCue> = {
  'L14.brief': { text: "Today you fly your first solo: one circuit, full stop. It's exactly what you've flown with me: same speeds, same checks, same circuit. Without my weight, the aircraft climbs better and floats a little further: expect it. Keep the climb speed with the attitude, and trim. Do your downwind checks as always. If the approach doesn't look right, go around. There's no hurry and plenty of fuel. You are ready for this." },
  'L14.kateLeaves': { text: "I'm getting out. One circuit, full stop. The aircraft climbs better without me; expect it." },
  'L14.offYouGo': { text: "You're ready. Enjoy it." },
  'L14.cleared': { text: ['Line up and take off when ready.'] },
  'L14.silent': { text: 'Your circuit.' },
  'L14.congratulations': { text: 'Congratulations: your first solo. Welcome back.' },
};

const L15: Record<string, InlineCue> = {
  'L15.brief': { text: "Today, steep turns at forty-five degrees of bank. Start with a clearing turn. Roll in smoothly, and add power as you pass thirty degrees. Hold the nose on the horizon with firm back pressure, and trim if you need to. Roll out about twenty degrees before the heading, releasing the back pressure. Then the spiral dive: power off, roll the wings level, then ease out of the dive. Never pull in a steep bank." },
  'L15.demoIntro': { text: 'I have control. Follow me through: a steep turn left.' },
  'L15.demoWrap': { text: 'Power on, firm back pressure, nose on the horizon. Your turn.' },
  'L15.steepLeft': { text: 'Lookout left. Steep turn left through 360, 45 degrees of bank.' },
  'L15.steepRight': { text: 'Lookout right. Steep turn right through 360, 45 degrees of bank.' },
  'L15.clearingTurn': { text: 'A clearing turn first, please, 90 degrees.' },
  'L15.spiralBrief': { text: "Next, a spiral dive. When I hand over: power off, wings level, then ease out." },
  'L15.recoverNow': safety('You have control: recover!'),
};

const L16: Record<string, InlineCue> = {
  'L16.brief': { text: "Today, forced landings without power. Glide speed first, then choose the field, then the touch drills, then the plan. Our field is the runway. High key is 2,000 feet abeam the far end; low key is 1,000 feet abeam the threshold. Adjust the pattern, never the speed. Flap only when the field is made. Security checks on final; I'll restore them before the go-around. I'll call the go-around at 200 feet." },
  'L16.demoIntro': { text: "I have control. I'll close the throttle and fly a forced landing. Follow me through." },
  'L16.demoWrap': { text: 'Speed, field, drills, plan, keys. Your turn.' },
  'L16.inPosition': { text: "We're over the field at 3,000 feet." },
  'L16.engineFailure': safety(['Simulated engine failure. I have the throttle.', 'Engine failure! I have the throttle.']),
  'L16.lowKey': { text: 'High key. On to the low key.' },
  'L16.securityChecks': { text: 'Low key. Turn in, and security checks when the field is made.' },
  'L16.restored': { text: "I've restored fuel, mixture and magnetos." },
  'L16.goAround': { text: 'Go around. You have the throttle.' },
};

const L17: Record<string, InlineCue> = {
  'L17.brief': { text: "Today, crosswind take-offs and landings, with the wind from the right. On the take-off roll, hold full aileron into wind, easing it off as the speed builds. On final, crab into wind to track the centreline. Just before touchdown, rudder to align the nose with the runway, and aileron into wind to stop the drift. After touchdown, keep straight and increase the into-wind aileron as you slow. Know your own crosswind limit." },
  'L17.demoIntro': { text: "I have control. Watch the crab on final, then the wing down at the flare." },
  'L17.demoWrap': { text: 'Crab, straighten with rudder, wing down into wind. Your turn.' },
  'L17.onFinal': { text: 'Three-mile final, wind from the right.' },
  'L17.takeoff': { text: 'Your take-off. Aileron into wind as you start the roll.' },
  'L17.land': { text: ['Your aircraft. Crab on final, straighten up before touchdown.', 'Your landing. Keep the centreline; into-wind wing down for the touchdown.'] },
  'L17.stronger': { text: 'The wind has picked up: 13 knots, gusting 17. Your aircraft.' },
};

const L18: Record<string, InlineCue> = {
  'L18.brief': { text: "Today, short-field take-offs and landings. For the take-off: flap 10, hold the brakes, full power, check the gauges, then release. Lift off at 51 knots and climb at {vspeed.Vx:kt} to 50 feet, to clear the obstacle. Then lower the nose to {vspeed.Vy:kt} and raise the flap. For the landing: full flap and {vspeed.VshortField:kt} on final, with power to hold the aim point exactly. Touch down firmly on the point, then brake hard." },
  'L18.intro': { text: "Short-field take-off first. We're lined up." },
  'L18.takeoff': { text: 'Flap 10, brakes on, full power. Release, lift off at 51 knots, climb at {vspeed.Vx:kt}.' },
  'L18.onFinal': { text: 'Two-mile final, full flap.' },
  'L18.land': { text: 'Short-field landing. {vspeed.VshortField:kt}, touch down on the aim point, then brake.' },
};

const L19: Record<string, InlineCue> = {
  'L19.brief': { text: "Today we fly by instruments, under the hood. The attitude indicator is the centre of your scan: glance at one instrument, then come back to it. Believe the instruments, not your senses; in cloud, your balance lies. A rate-one turn is three degrees a second, about fifteen degrees of bank. Then unusual attitudes: read the attitude and the speed, then recover in the right order. Nose low: power off, wings level, ease out." },
  'L19.hoodOn': { text: 'Hood on. From now on, instruments only.' },
  'L19.demoIntro': { text: 'I have control. Watch my scan: attitude, altimeter, attitude, heading, attitude.' },
  'L19.demoWrap': { text: 'Always back to the attitude indicator. Your turn.' },
  'L19.straightLevel': { text: 'Straight and level on instruments. This height and heading.' },
  'L19.rateOneRight': { text: 'A rate-one turn to the right, through 180 degrees.' },
  'L19.rateOneLeft': { text: 'A rate-one turn to the left, through 180 degrees.' },
  'L19.climbTo': { text: 'Climb to {alt:alt} at {vspeed.Vy:kt}, on instruments.' },
  'L19.descendTo': { text: 'Descend at 500 feet per minute to {alt:alt}.' },
  'L19.closeEyes': { text: "I have control. Close your eyes; I'll put us in an unusual attitude." },
  'L19.closeEyesAgain': { text: 'Once more. Close your eyes.' },
  'L19.recoverNow': safety('Open your eyes. You have control: recover!'),
  'L19.hoodOff': { text: 'Hood off. Have a look outside.' },
};

const L20: Record<string, InlineCue> = {
  'L20.brief': { text: "Today, a navigation exercise round the lakes and the town. The nav log gives each leg a heading and a time, solved for the forecast wind. Set heading overhead and start the clock. Fly the heading accurately, then check the map against the ground. At each turning point, turn onto the next heading and note the time. I'll give you a diversion on the way. Then we rejoin overhead and land." },
  'L20.intro': { text: "Here's the route and the nav log. Your aircraft: line up and take off when ready." },
  'L20.takeOff': { text: 'Take off and climb. We set course from overhead.' },
  'L20.climbOverhead': { text: 'Climb to 3,500 feet over the field. We set course from overhead.' },
  'L20.setCourse': { text: 'Overhead. Set course for Foothill Lake, heading {hdg:hdg}, and start the clock.' },
  'L20.leg': { text: ['Heading {hdg:hdg}, about {min:min} to the next point.', 'Next leg: heading {hdg:hdg}, {min:min} on the log.'] },
  'L20.turningPoint': { text: 'Turning point ahead. Then heading {nextHdg:hdg}. Note the time.' },
  'L20.diversion': { text: "Diversion. The weather's closed in ahead. Divert to the glacial lake: work out a heading and turn." },
  'L20.cancelDiversion': { text: "Good, that would get us there. Cancel the diversion; we're past Valley Lake now." },
  'L20.directTown': { text: 'Route direct to the town, then home to the field.' },
  'L20.rejoin': { text: 'Past the town, head for the field. Descend now to join overhead at 2,000 feet above the field.' },
  'L20.deadside': { text: 'Overhead. Descend on the dead side to circuit height, then join crosswind.' },
  'L20.wrap': { text: "Nicely navigated. Let's look at the track on the ground." },
};

const L21: Record<string, InlineCue> = {
  'L21.brief': examiner("Good morning. I'm your examiner today. The test has five sections: departure, general handling, navigation, approach and landing, and emergencies. I'll give you each task in turn. Each item is flown once, to the test standard. I may allow one repeat of an item in a section. I won't comment during the flight; I'll give you the debrief on the ground. Treat me as a passenger, and fly as pilot in command."),
  'L21.intro': examiner('When you are ready, carry out your checks and start the engine.'),
  'L21.taxi': examiner('Taxi to holding point A1, please.', { speak: 'Taxi to holding point alpha one, please.' }),
  'L21.takeoff': examiner('When ready, line up and take off. Climb on runway heading.'),
  'L21.climbOverhead': examiner('Climb to 3,500 feet over the field, please. Set course from overhead.'),
  'L21.setCourse': examiner('Set course for Foothill Lake, please. Heading {hdg:hdg}.'),
  'L21.leg': examiner('Heading {hdg:hdg}, please. Your planned time is {min:min}.'),
  'L21.generalHandling': examiner("We'll do the general handling here."),
  'L21.straightLevel': examiner('Straight and level, please, at cruise power.'),
  'L21.speedChange': examiner('Reduce to 85 knots. Maintain altitude and heading.'),
  'L21.climbTo': examiner('Climb to {alt:alt}, please.'),
  'L21.descendTo': examiner('Descend to {alt:alt} at 500 feet per minute, please.'),
  'L21.mediumTurn': examiner('A level turn left through 360 degrees, 30 degrees of bank.'),
  'L21.steepRight': examiner('A steep turn right, 45 degrees of bank, through 360.'),
  'L21.steepLeft': examiner('And now a steep turn left, 45 degrees, through 360.'),
  'L21.slowFlight': examiner('Slow flight, please: full flap, {vspeed.Vslow:kt}, maintain altitude and heading.'),
  'L21.hood': examiner('Hood on, please, and close your eyes. I have control.'),
  'L21.recover': examiner('You have control. Recover.', { priority: Priority.Safety, interrupt: true }),
  'L21.flapless': examiner('Assume the flap has failed. A flapless approach and landing, please.'),
  'L21.landNow': examiner('Back on final. Land, please, full stop.'),
  'L21.fullStop': examiner('Full stop, please.'),
  'L21.endOfTest': examiner("That's the end of the test. Taxi in; I'll debrief you inside."),
};

const N1: Record<string, InlineCue> = {
  'N1.brief': { text: "Tonight, circuits in the dark. Lights before we move: navigation lights, beacon and strobes; landing light on final. Keep the panel lights low so your eyes adapt. The horizon is hard to see at night, so use the instruments on the climb-out and on downwind. On final, stay on the PAPI: two white, two red. A dark approach looks high; trust the PAPI, not your eyes. We'll fly three circuits to a full stop." },
  'N1.intro': { text: "Lighting checks first. I'll read them." },
  'N1.linedUp': { text: 'Lined up. Your aircraft.' },
  'N1.takeoff': { text: 'Take off; on the instruments once the runway lights drop behind.' },
  'N1.downwind': { text: 'Downwind. Keep the runway lights just along the wingtip.' },
  'N1.final': { text: 'Landing light on. Follow the PAPI down: two white, two red.' },
};

const CHALLENGE_LINES: Record<string, InlineCue> = {
  'C.go': { text: 'Your aircraft. Good luck.' },
  'C.done': { text: "That's it. Let's see your score." },
  'C.spotBrief': { text: "Land on the aim point from a three-mile final. Every foot off the spot costs points, and so does a hard landing. A nose-first or off-runway landing scores nothing. Fly a stabilised approach and a gentle flare." },
  'C.spotLand': { text: 'Spot landing: on the aim point, gently.' },
  'C.deadStickBrief': { text: "The engine is stopped, three miles east of the field at 3,000 feet. Glide in and land on runway 07. Glide speed first, then plan the pattern. Points for the touchdown zone, the glide speed, no stall warning, and a gentle arrival." },
  'C.engineStopped': { text: 'The engine has stopped. No restart.' },
  'C.deadStickGo': { text: 'Your aircraft. Glide speed first.' },
  'C.crosswindBrief': { text: "Thirteen knots of crosswind from the right, gusting 23. Land on the centreline, straight and gently, in the touchdown zone. Crab on final, then rudder straight and the into-wind wing down for the touchdown." },
  'C.crosswindLand': { text: 'Crosswind landing. Keep it on the centreline.' },
  'C.circuitBrief': { text: "One circuit from the line-up to a full stop. Every target counts: climb speed, circuit height, downwind spacing, approach speed and the slope. Trim at every change, and fly the numbers as precisely as you can." },
};

/**
 * The teaching point after a lesson-limit intervention (engine/runner.ts limitTeachLine reads
 * `limit.teach.<limitId>`): said once she has restored straight and level, before she offers control back. The
 * limit ids are the ones syllabus/instruction.ts `limits()` gives; the line before the take-over (the reason) is
 * the limit's own cue.
 */
const LIMIT_TEACH: Record<string, InlineCue> = {
  'limit.teach.bankLeft': { text: ['Wings level again. Small aileron to set the bank, then centralise the wheel to hold it.', 'Level again. Roll on gently, and stop the roll where you want it.'] },
  'limit.teach.bankRight': { text: ['Wings level again. Small aileron to set the bank, then centralise the wheel to hold it.', 'Level again. Roll on gently, and stop the roll where you want it.'] },
  'limit.teach.pitchUp': { text: ['Nose back on the horizon. A few degrees of pitch makes a big change in speed.', 'Level again. Small pitch changes, a couple of degrees at a time.'] },
  'limit.teach.pitchDown': { text: ['Level again. Small, smooth pitch changes, and let the speed settle each time.', 'Nose back on the horizon. Ease it down a little at a time.'] },
  'limit.teach.slow': { text: ["Speed's back. If it gets slow, lower the nose first, then think about power.", 'Speed restored. Keep the airspeed in your scan as the nose moves.'] },
  'limit.teach.fast': { text: ["Speed's back where we want it. A touch higher nose slows us down.", 'Settled again. Attitude controls the speed: small changes, then wait.'] },
  'limit.teach.low': { text: ['Back at our height. Glance at the altimeter often, and correct small errors early.', 'Height restored. Attitude first, then check the altimeter.'] },
  'limit.teach.high': { text: ['Back on our height. Catch it at 50 feet off, not 400.', 'Height restored. Keep the altimeter in your scan.'] },
};

export const LINES: LineTable = Object.freeze({
  // The demo scripts' default lines (content/demos.ts), overridable below.
  ...DEMO_LINES,
  ...COMMON, ...L01, ...L02, ...L03, ...L04, ...L05, ...L06, ...L07, ...L08, ...L09, ...L10, ...L11, ...L12, ...L13, ...L14,
  ...L15, ...L16, ...L17, ...L18, ...L19, ...L20, ...L21, ...N1, ...CHALLENGE_LINES, ...LIMIT_TEACH,
});
