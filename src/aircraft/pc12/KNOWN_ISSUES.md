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

## Keyboard circuit — **passes, fragile (needs the input package)**

The conformance suite's keyboard circuit (`keyboardCircuit`, torque in psi) passes in both weathers with the pilot
targets brakeKias 80 (brakes as soon as the nosewheel is down) and flareM 8: light turbulence: touchdown 77 KIAS at
1.0 m/s, 354 m past the threshold, stopped 0.7 m off the centreline, minimum 0.55 g; 10 kt crosswind: 77 KIAS at
1.7 m/s (limit 1.8), 425 m past, 0.2 m off. The roll-out still stays on the gate at FLIGHT IDLE (about 4-5 kN at a
standstill on the 5.5 deg stop) and the aircraft floats nose-high on the mains for up to 55 s: in light turbulence it
touches down 354 m past the threshold and stops about 600 m beyond the far end of the 1800 m runway (a 2.0 km roll; the
harness has no roll-length item, so this passes). With the old brakeKias 50
the roll was 2.3-2.7 km with 0.21 g of nose-leg rocking and 11-12 m of drift in the crosswind. The pass is not robust:
flareM 7 crashes the crosswind circuit (2.7 m/s at 88 KIAS), flareM 9 stops 8.8 m off (limit 8). The 47E technique
(4.16: PCL to IDLE at touchdown, reverse as required, condition lever to GROUND IDLE) is the keyboard pilot's
(tests/input/keyboardPilot.ts, the input package's: "beta/reverse engaged below 60 KIAS").
Evidence: [conformance test](../../../tests/conformance/pc12.test.ts) (flown tier), [targets](../../../tests/conformance/targets/pc12.ts).
Close with: the keyboard pilot's roll-out taking the PCL into beta and the condition lever to GROUND IDLE.

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
mid-travel (ESTIMATE). With the stop that low the propeller reaches its governed 1700 rpm at FLIGHT IDLE on the
ground, and the half-beta taxi (8.5 kt) and the gate taxi (22 kt) are close to their bands' edges.
Evidence: [powerplant.ts](powerplant.ts) `PC12_FLIGHT_IDLE_STOP`.
Close with: the AFM's blade-angle rigging and an idle-thrust figure.

## Take-off swing without rudder trim — **within the plan row; owner to judge**

With the rudder trim at zero the full-power roll swings left at 5-15 kt and the centreline pilot (the test's PI law)
uses up to 0.50 of right pedal at 14 kt, 0.20 steady above 30 kt, the heading within 3.2 deg (plan row: <= 0.6, <= 5
deg). With the scripted pilot's take-off rudder trim (+0.3, ESTIMATE, set at the old swirl) the swing is still to the
left: 0.42 of right pedal, 2.7 deg. The swing is the propeller's swirl on the fin: `swirlBehindWing` 0.5 (ESTIMATE, the DA20's value the comment
always cited); at the first estimate, 0.6, it was 0.67 and 4.2 deg. Full-power climb at 130 KIAS: 0.22 of the pedal.
Evidence: [pc12.test.ts](../../../tests/conformance/pc12.test.ts) "take-off roll heading", [aero.ts](aero.ts).
Close with: the owner's judgement of the swing and of the climb pedal.

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
