# Pilatus PC-12/47: known issues

See also the [cross-aircraft issues](../../../docs/known-issues.md#cross-aircraft-issues), the
[flight model](../../../docs/pc12-flight-model.md), the [sources](../../../docs/pc12-sources.md) and the
[turbine model](../../../docs/turbine-model.md). Entries are ordered by pilot impact. Every `notModelled` item of
[index.ts](index.ts) has an entry.

## The /47's own flight manual — **estimate / proxy data**

The /47 AFM (Pilatus Report 02211 with AFMS 33) was not obtained. Engine limits, speeds, weights, CG and propeller
angles are the /47's (EASA TCDS A.089 sect. C, IM.E.008); everything else (the torque limiter, the start, the ground
idle, the quadrant, the stall, take-off, landing and cruise charts, the stick pusher) comes from the PC-12/47E book
(Report 02277), a PT6A-67P aircraft of the same airframe family. The 47E climb and cruise charts are ITT-limited at
820 °C; the /47 at 760 °C makes less power above about 14 000 ft ISA, where the model follows its own ITT, not a /47
chart.
Evidence: [docs/pc12-sources.md](../../../docs/pc12-sources.md), the `47E-PROXY` tags in [facts.ts](facts.ts),
[reference.ts](reference.ts), [tests/conformance/targets/pc12.ts](../../../tests/conformance/targets/pc12.ts).
Close with: AFM 02211 / AFMS 33; the targets re-sourced row by row.

## Keyboard circuit — **passes; round-out fragile**

The conformance suite's keyboard circuit (`keyboardCircuit`, torque in psi) passes in both weathers. At integration
the roll-out was given the 47E technique the keyboard can fly (4.16): 1 s after the mains touch the pilot stops holding
the round-out (`rolloutOnMainsS`), the PCL goes over the gate into ground fine below 75 KIAS (`rolloutReverse`) and the
brakes come on from 80 KIAS. Measured: light turbulence, touchdown 77.2 KIAS at 0.99 m/s, 354 m past the threshold,
stopped after 250 m, 1.8 m off the centreline, minimum 0.55 g, bank at most 26.8 deg; 10 kt crosswind, 77.2 KIAS at
1.67 m/s (limit 1.8), stopped after 269 m, 1.7 m off, minimum 0.53 g. Before, on the gate at FLIGHT IDLE (4-5 kN at a
standstill on the 5.5 deg stop), the aircraft floated nose-high on its mains for up to 66 s and rolled 2.0 km in
turbulence, past the far end of the 1800 m runway. Still open: the condition lever stays at FLIGHT IDLE (the keyboard's
lean key runs it through to CUT-OFF), and the round-out is sensitive to the flare height (P1: flareM 7 crashed the
crosswind circuit at 2.7 m/s and 88 KIAS; flareM 9 stopped 8.8 m off).
Evidence: [conformance test](../../../tests/conformance/pc12.test.ts) (flown tier), [targets](../../../tests/conformance/targets/pc12.ts)
`KEYBOARD_PILOT_TARGETS`.
Close with: a condition-lever detent key (GROUND IDLE) and a round-out that does not depend on the flare height.

Gate 0 (browser, `fly-keyboard.mjs pc12`, default weather 6 kt from 100 deg): climb 130.3-134.4 KIAS, downwind flaps 15
at 123.4-130.9 KIAS (0.9 kt over the 120-130 band at the top), take-off torque 44 psi, touchdown 75.1 KIAS 360 m past the
threshold, beta 0.462 below 60 KIAS (ground fine 0.45), stopped after 268 m, 1.8 m off the centreline. The roll-out
heading wandered +9 / -8 deg while the brakes were on (the pilot's rudder law against the braked mains). Before the
gate's brake change (below) the same roll-out swung 33 deg right with the rudder at -0.9 and stopped 8 m off.

## Brakes — **estimate; changed at gate 0**

Full pedal was 3200 N m a wheel (0.45 g at MLW). With the wing still lifting at 60 KIAS that locked both mains
(no anti-skid), and a locked main has no cornering force: in the default 6 kt crosswind a braked stop from 60 KIAS
swung 20-35 deg against full rudder (headless probe, an ideal rudder: 19.5 deg). At 2400 N m (about 0.34 g, ESTIMATE)
the same stop holds the heading within 2 deg. The chart landing block keeps the same torque as before (1280 N m, now
`brake` 0.533; the reading of "average braking" is unchanged), so its 385 m roll and the 0.75 reverse ratio did not move.
The model's mains still lock briefly at full pedal; no anti-skid and no tyre-skid feel are modelled.
Evidence: [gear.ts](gear.ts), [targets](../../../tests/conformance/targets/pc12.ts).
Close with: a /47 brake capacity figure or a measured maximum deceleration.

## Landing roll in the generic block — **closed (integration)**

The generic landing roll (tests/fdm/measure.ts `landingRoll`) now moves the condition lever to GROUND IDLE at
touchdown (`LandingOptions.rollCondition`) and flies at the chart's weight (`landing.atMaxLanding`, MLW 4500 kg), so
the conformance block flies the chart's technique (Fig 5-2-52: "average braking, ground idle after touch down";
Fig 5-2-54: full reverse). Measured at integration: 385 m on the gate with brakes 0.4 (chart-read 389 +- 30 m),
291 m in full reverse with the PCL back to the gate below 40 KIAS (DERIVED 280 +- 35), ratio 0.75 (DERIVED 0.72 +- 0.08).
Brakes 0.4 is the AGENT reading of "average braking" (0.5 gives 322 m). At FLIGHT IDLE on the roll (the old generic
roll at maxGross) it was 581 m: the 66 % Ng idle pulls about 5 kN at a standstill.
Evidence: [targets](../../../tests/conformance/targets/pc12.ts) `landing`, `node scripts/aircraft-report.mjs pc12 --flown --block landing`.

## Gear horn above 130 KIAS — **closed**

The flight model's `stepRetract` now passes the IAS (`RetractInput.kias`), so the horn's "PCL at idle below 130 KIAS"
rule works in the simulator: gear up, PCL idle, about 170 KIAS: silent; 130 KIAS TAS at 2000 ft: the horn. The 47E's
"below 200 ft radio altitude with torque below 10 psi" rule is not modelled (no radio altimeter).
Evidence: [tests/aircraft/pc12.test.ts](../../../tests/aircraft/pc12.test.ts) "gear horn" (actuator and flight model).

## Reverse torque — **estimate**

Full reverse static absorbs about 16 psi at 1650 rpm (Ng about 75 %, the topping governor holding Np) for 5.35 kN,
52 % of the 10.3 kN static take-off thrust. The 47E's maximum reverse, 900 shp / 34.25 psi at 1650 rpm, is a limit the
model's blade does not reach: its negative side stalls short of it, and a stronger reverse would shorten the reversed
landing roll below the chart's (the model's ratio is 0.73-0.76 against 0.72).
Evidence: [powerplant.ts](powerplant.ts) `PC12_PROPELLER`, `reversingCam`.
Close with: the HC-E4A-3D blade's reverse data.

## Flight-idle low-pitch stop — **calibrated unknown**

The TCDS gives fine 19 deg, minimum on ground 17 deg and minimum in flight 6 deg at the 42 in station; they cannot
all be flight angles there (docs/pc12-flight-model.md "Blade angles"). The model's stop is 5.5 deg (the TCDS 6 deg
less half a degree), calibrated on the 47E ground-idle Np (about 1060 rpm: 1034 measured) and guarded by the flaps-40
approach torque (8-18 psi: 13 psi). The PCL's "6 to 12 deg" schedule forward of the detent is read as a 6 deg rise to
mid-travel (ESTIMATE). With the stop that low the propeller nearly reaches its governed speed at FLIGHT IDLE on the
ground (1526 rpm, 3.7 kN static), and the half-beta taxi (8.2 kt) and the gate taxi (20.7 kt) are close to their
bands' edges. Pilot review 2026-10-17 asked for 10-12 deg: measured and not applied. 10 deg dropped the gate
ground-idle Np to 834 rpm; raising the ground idle to 58-60 % Ng to recover it (949 / 927 rpm) ran the half-beta taxi
at 15-20 kt (8-12) and left 3.0 kN at FLIGHT IDLE on the gate. In flight the blade governs above any of these stops.
Evidence: [powerplant.ts](powerplant.ts) `PC12_FLIGHT_IDLE_STOP`; docs/pc12-flight-model.md "Flight idle".
Close with: the AFM's blade-angle rigging and an idle-thrust figure.

## Idle descents shallow — **owner to judge**

FLIGHT IDLE power is ESTIMATE: 130 shp at 65 % Ng (was 165; pilot review 2026-10-17). Idle descents at MTOW: 120 KIAS
-648 ft/min (was -600), 150 KIAS -978 (-927), 85 KIAS flaps 40 gear down -1282 (-7.4 deg; was -1234). Type experience
(ESTIMATE): -1000 to -1300 at 120-150 KIAS. Lower power breaks the ESTIMATE band for FLIGHT IDLE on the gate (95 shp:
Np 1364 against 1500-1730) and gains little: at 120 KIAS zero propeller thrust gives about the feathered glide
(-889 ft/min); steeper needs the propeller to drag with Np below 1700. The same shallow descent is open on the C208.
Evidence: docs/pc12-flight-model.md "Flight idle"; [targets](../../../tests/conformance/targets/pc12.ts) `idleRpm`.
Close with: whether Np holds 1700 in a real PC-12 idle descent, and an idle torque or descent figure from a PC-12 pilot.

## Take-off swing without rudder trim — **within the plan row; owner to judge**

With the rudder trim at zero the full-power roll swings left at 5-15 kt and the centreline pilot (the test's PI law)
uses up to 0.50 of right pedal at 14 kt, 0.20 steady above 30 kt, the heading within 3.2 deg (plan row: <= 0.6, <= 5
deg). With the scripted pilot's take-off rudder trim (+0.3, ESTIMATE, set at the old swirl) the swing is still to the
left: 0.42 of right pedal, 2.7 deg. The swing is the propeller's swirl on the fin: `swirlBehindWing` 0.5 (ESTIMATE, the DA20's value the comment
always cited); at the first estimate, 0.6, it was 0.67 and 4.2 deg. Full-power climb at 130 KIAS: 0.22 of the pedal.
Evidence: [pc12.test.ts](../../../tests/conformance/pc12.test.ts) "take-off roll heading", [aero.ts](aero.ts).
Close with: the owner's judgement of the swing and of the climb pedal.

## Go-around rudder at flaps 40 — **owner to judge**

Zero-sideslip trims at full PCL (pilot review 2026-10-17): 86 KIAS flaps 40 gear down 0.01 of right pedal; 86 KIAS
flaps 15 0.31, flaps 30 0.10; 95 KIAS flaps 15 0.22; 130 KIAS clean 0.22. Type experience (ESTIMATE): 0.3-0.5 for a
Vref go-around at 44 psi. Measured cause: the rudder is all propeller swirl on the fin (with `swirlBehindWing` 0 every
row is within ±0.05; at 1.0, flaps 15 needs 0.60 and flaps 40 still 0.03). With flaps 40 the aircraft flies at -0.4 deg
of body angle of attack (flaps 15: +5.4), and the jet, which leaves the disc along the free stream, passes the fin
about 1 m lower: its centre 0.4 m below the hub line at the fin, under the upswept tailcone, against the fin's root at
0.5 m above it; at flaps 15 the free-stream line lifts it 1.2 m into the fin. Not tuned: the swirl knob cannot reach
flaps 40 without overshooting flaps 15 and the take-off swing (0.6: 0.67 of pedal at 15 kt), and the model has no
slipstream that wraps the fuselage onto the fin. PCL slam at Vref flaps 40: 44.0 psi, 40 psi after 1.0 s, ITT 772 C,
controls frozen: -9.7 deg of roll and -3.2 deg of heading after 6 s (the pilot review's figures, not re-flown).
Evidence: [aero.ts](aero.ts) `swirlBehindWing`; docs/pc12-flight-model.md.
Close with: a PC-12 pilot's go-around pedal figure, or a fuselage-bound swirl model.

## Flap trim change — **owner to judge (sign and size)**

Level at 130 KIAS, MTOW: the stabiliser goes from -1.55 deg (nose-up trim) clean to +0.98 deg (nose-down) with flaps 15,
2.5 deg of the 6.5 deg range; controls frozen, flaps 0 -> 15: +12.3 deg of pitch in 6 s. Type experience (ESTIMATE): a
modest change, tending nose-down. The model's split: flaps 15 lift so much more at the same angle (the flap lift is
calibrated on the 47E pusher speeds, 95 -> 78 KIAS) that the body angle of attack falls 5.7 deg (4.6 -> -1.1); the
stabiliser, fixed to the body, loses 6.2 deg (0.6 of it the flap's extra downwash at the T-tail), and its download
grows by 4.05 kN; the wing's section moment goes from -0.087 to -0.235 (the Fowler's aft lift) but does not
cancel it. The C208 and the C172S show the same nose-up tendency from the same core. Not tuned: no sourced flap
moment or trim figure; a smaller flap lift would move the pusher speeds.
Evidence: [aero.ts](aero.ts) the Fowler flap; pilot-review logs.
Close with: the sign and size of the PC-12's flap-15 retrim from a PC-12 pilot.

## Trailing-link mains — **simplified**

The main legs are trailing links: the wheel moves about 0.18 m aft over its 0.20 m of travel. The contact model moves
a wheel along a straight leg axis and loads the spring with the tyre's drag along it; with the axis tilted to follow
the link the spin-up and brake forces made the mains chatter between 0 and 39 kN on the roll-out. The legs are
vertical (`PC12_MAIN_LEG_TILT` 0): the wheelbase does not grow as the legs compress.
Evidence: [geometry.ts](geometry.ts), [gear.ts](gear.ts).
Close with: a trailing-link (arc) leg in the gear model.

## The elevator does not float — **simplified**

The trimmed-stabiliser law (physics/controlSystem.ts) applies no stick-free float to the elevator: with one pitch
control the trim solver could not keep the float of the tab kinds consistent with a separate stabiliser. Hands-off
the elevator stays where the yoke puts it; the elevator down-spring (47E 7-3) is not modelled either. Stick-free
stability is therefore the stick-fixed one.
Evidence: [controlSystem.ts](../../../src/physics/controlSystem.ts) header, [systems.ts](systems.ts).
Close with: a down-spring force and a stick-free float in the stabiliser law, with the trim solver splitting the
pitch control three ways.

## Stall above the pusher — **estimate**

The wing's aerodynamic C_L,max is not published (the published stall speeds are pusher speeds). The model's is 1.36
clean, 1.98 / 2.46 / 2.63 with flaps 15 / 30 / 40, which puts the push at 0.91-0.93 of it. The Fowler flap's
`clMaxRatio` (1.22) and its large-deflection table are calibrated, not measured; without the pusher the flapped wing
drops a wing (bank 9-11 deg at the break), as the 47E warns.
Evidence: [aero.ts](aero.ts).
Close with: Pilatus stall data.

## The quadrant's MANUAL OVERRIDE (MOR) — **missing feature**

The MOR lever is drawn fixed at OFF; its emergency fuel path (the FCU Py bellows bypass, no torque limiter, Nf or Ng
governor) is not modelled. The torque limiter, the Nf and the Ng governors always work.
Evidence: [notModelled](index.ts).
Close with: an MOR control acting on the gas generator's fuel directly.

## Pressurisation — **missing feature**

No cabin pressure model: the cabin altitude and differential gauges (panel package) follow a display schedule of
pressure altitude (47E 7-17). No bleed-air cost on the engine.
Evidence: [notModelled](index.ts).
Close with: a cabin volume, the outflow valve and the bleed's ITT and torque penalty.

## Ice protection, inertial separator, pusher ice and safe modes — **missing feature**

Boots, propeller, windshield and probe heat and the inertial separator are absent, with their power, ITT and drag
penalties; the stick pusher's ice mode (8 deg AOA earlier) and safe mode (flaps-0 schedule after a flap asymmetry)
are not modelled.
Evidence: [notModelled](index.ts), [systems.ts](systems.ts) `PC12_STICK_PUSHER`.
Close with: the ice-protection loads on the bus and the pusher's schedule switches.

## Aileron trim — **missing feature**

The left aileron's electric trim tab is not modelled: the yoke trims roll.
Evidence: [notModelled](index.ts).
Close with: a roll-trim control on the aileron.

## Fuel system — **simplified**

One tank a side feeds the engine: the collector tanks, the motive-flow jet pumps and the automatic fuel balance
(above 68 lb, up to 267 lb) are not modelled; the low-fuel warnings are the panel's.
Evidence: [powerplant.ts](powerplant.ts), [notModelled](index.ts).
Close with: collector tanks and the balance logic in the fuel system.

## Legacy CAWS — **partial**

Only the lights the panel package drives are live; the rest are lamp-test only (the legacy legend list itself is from
secondary training material).
Evidence: [notModelled](index.ts); the panel package's docs.
Close with: AFM 02211's CAWS list.

## Engine data — **estimate**

The PT6A-67B running line (fuel flow, ITT and gas power against corrected Ng) is fitted to the 47E maximum-cruise rows
(torque-limited, so valid for the /47), the take-off torque at the limiter, the hot-and-high example and an estimated
ground idle; it is not a P&WC deck. The start (one press: 50 % Ng at 29 s, peak ITT 750 °C) is calibrated with the
starter's torque and the start's fuel schedule.
Evidence: [powerplant.ts](powerplant.ts), [docs/pc12-flight-model.md](../../../docs/pc12-flight-model.md).
Close with: a P&WC deck or the /47 power-setting tables.

## Exterior and cockpit shell — **simplified / estimate**

The windscreen is one lofted surface cut by a sill plane and A-post lines: the real two flat panes and their centre
post are not drawn. The legs are hidden at extension 0, so the main tyres standing about 25 mm proud of the wing root
show only in the last few per cent of the swing. The flap selector is drawn as a slot lever on the panel face over the
pedestal, not the pedestal lever right of the power controls; the MOR lever is drawn fixed at OFF and there is no
aileron trim tab. The exhaust stubs are round, not oval. The cabin has four club seats (the executive layout), not the
nine-seat commuter cabin. ESTIMATE in the drawing: the stabiliser pivot (65 % chord), the drawn wing incidence and
washout (2 deg to 0; the aerodynamic rigging in geometry.ts is -0.5 / -3.0 deg), the tailplane incidence and the
winglet cant (62 deg). A bright lit wedge on the inside of the left A-post in the night cockpit view (probably the
landing light on the post lining) was not investigated.
Evidence: [visual.ts](visual.ts), [docs/pc12-exterior.md](../../../docs/pc12-exterior.md).
Close with: a /47 windscreen and pedestal drawing; the commuter cabin as a variant.

## Panel — **simplified**

GEN 1 and GEN 2 rockers are tied (one `alternator` control) and the two fuel pumps are one rocker. The pusher test,
MOR, EIS FUEL RESET / MENU / TEST buttons, the ice-protection switches, ECS and cabin controls are painted or absent.
The standby instruments are full size, and the RMI places hold NAV indicators (no RMI / HSI renderer); no turn
coordinator is fitted (the attitude indicators carry inclinometers). The EIS is drawn as nine round-dial windows; the
/47's EIS is a monochrome LCD whose window list is not sourced. The HYDR lens shows the emergency gear selection (there
is no hydraulic model). Cabin altitude and differential are a display function of pressure altitude (no
pressurisation).
Evidence: [docs/pc12-panel.md](../../../docs/pc12-panel.md) "Not modelled / KNOWN ISSUES", [panel.ts](panel.ts).
Close with: GEN 2 and the second pump as their own controls; an RMI / HSI; the /47 EIS window list.

## Sound — **estimate**

The PT6A-67B whine orders and strengths, the roar, the gearbox mesh, the igniter rate (2.5/s), the reverse growl's
strength, the shaker's rate (22 Hz), the clacker's rate (8/s), the CAWS chime's pitch (1047 Hz), the gear horn and pump
pitch and the cabin mix are ESTIMATES: there is no PC-12 recording or spectral calibration. The stall warning is the
stick shaker alone (no horn; the 47E's voice "Stall" is not part of the /47). The beta range above flat pitch has no
sound of its own beyond the propeller voice: the growl starts below 0 deg blade angle. The CAWS chimes are struck on the
edge of a new red (warning) or amber (caution) legend (integration: the panel emits the 'caws' event).
Evidence: [audio.ts](audio.ts) header.
Close with: a PC-12 cockpit and exterior recording.
