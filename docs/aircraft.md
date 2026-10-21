# Aircraft

The types the simulator flies, how to choose one, and the keys and handling notes that differ from the Cessna 172S. Outstanding work is listed in [known issues by aircraft](known-issues.md).

| id | Type |
|---|---|
| `c172s` (default) | Cessna 172S Skyhawk SP: four seats, Lycoming IO-360 fuel-injected, 180 hp, fixed pitch. The keys in [controls.md](controls.md) are written for it |
| `c152` | Cessna 152 (1978): two seats, Lycoming O-235-L2C carburetted, 110 hp, fixed pitch |
| `pa38` | Piper PA-38-112 Tomahawk II: two seats, low wing, T-tail, Lycoming O-235-L2C carburetted, 112 hp, fixed pitch |
| `da20` | Diamond DA20-C1: two seats, composite low wing, T-tail, stick, Continental IO-240-B fuel-injected, 125 hp, fixed pitch |
| `pa34` | Piper PA-34-200 Seneca I: six seats, light twin, two Lycoming IO-360 fuel-injected, 2 x 200 hp, counter-rotating constant-speed feathering propellers, retractable gear |
| `c208` | Cessna 208 Caravan 675: single-engine turboprop utility aircraft, PT6A-114A 675 shp, beta and reverse (in development; see [turbine-model.md](turbine-model.md)) |
| `pc12` | Pilatus PC-12/47: pressurised single-engine turboprop, PT6A-67B 1200 shp, beta and reverse (in development; see [pc12-flight-model.md](pc12-flight-model.md)) |
| `r22` | Robinson R22 Beta II: two-seat training helicopter, O-360 derated to 131 hp |
| `r44` | Robinson R44 Raven II: four-seat helicopter, IO-540 fuel injected, 245 hp take-off |
| `s269` | Schweizer 269C-1 / 300CB: two-seat articulated-rotor trainer, HO-360 180 hp (in development) |
| `md500` | MD Helicopters MD 500E: five-seat turbine helicopter, 250-C20B 375 shp take-off (in development; see [md500-flight-model.md](md500-flight-model.md)) |
| `bo105` | MBB Bo 105 CB-4: five-seat twin-turbine helicopter with a hingeless rotor, 2 x Allison 250-C20B, 2500 kg (in development, `available: false`: not in the chooser, flown only at `index.html?aircraft=bo105`; see [bo105-flight-model.md](bo105-flight-model.md) and [bo105-integration.md](bo105-integration.md)) |
| `ah56` | Lockheed AH-56A Cheyenne: two-seat compound attack helicopter with a hingeless rotor and a control gyro (AMCS 1973 default, ICS 1972 with `config=ics`), wing, shared-shaft pusher propeller, T64-GE-716 (in development, `available: false`: not in the chooser, flown only at `index.html?aircraft=ah56`; see [ah56-flight-model.md](ah56-flight-model.md), [ah56-compound.md](ah56-compound.md), [ah56-high-speed.md](ah56-high-speed.md) and [ah56-integration.md](ah56-integration.md)) |

The Diamond DA42 NG (`da42`) is defined but not yet offered in the chooser. The Bo 105 (`bo105`) and the Lockheed
AH-56A Cheyenne (`ah56`) are registered with `available: false` until the owner approves them.

Choose the type at the top of the menu's Flight page (Escape). The choice is remembered per browser and the page
reloads into it; airborne or moving it asks first. Each type keeps its own resumed flight, so switching to another
type and back continues where you left it. `index.html?aircraft=<id>` flies a type for that page only (it is not
remembered). The Flight School teaches in the C172S; the other types are flown free.

## Helicopters

The R22 Beta II is available in the aircraft chooser and at
`index.html?aircraft=r22&scenario=runway&resume=0`.
Use the arrows for cyclic, Z/X for pedals, and hold F5/F6 to lower/raise collective.
Insert toggles the clutch; Delete toggles the governor. Throttle remains independent.
The HUD shows rotor NR separately from engine RPM. This adds blade-element rotor loads,
dynamic inflow, drivetrain/freewheel/governor behavior and skid contacts, but is not yet
flight-test validated. See [the model notes](r22-flight-model.md) for controls, data
provenance, fidelity limits and the path to R44 and Schweizer 269 support.

### Watch the R22 scripted flights

Open the autorotation demonstration (`index.html?aircraft=r22&demo=autorotation&resume=0`), or choose
**Escape → Flight → R22 demonstrations**. The URL `demo=` accepts:

| Demo | Flight | Approximate simulated time |
|---|---|---|
| `startup` | Cold start, clutch, governor, warm-up, 3 m hover | 115 s |
| `hover` | Hover, ETL, 60 KIAS climb, 85 KIAS cruise | 145 s |
| `approach` | Cruise, approach, hover, vertical landing | 123 s |
| `autorotation` | Engine failure, 65 KIAS descent, flare, level, cushion, touchdown | 55 s |
| `circuit` | Full cold-start engineering flight, including a 360° cruise turn and landing | 489 s |

The captions show the pilot's action, rotor RPM, IAS, vertical speed, skid height and controls. Expand **Live
trace**, or add `trace=1`; autorotation opens the trace automatically. Use **C** to change view, **P** to pause
and **Shift+[ / Shift+]** to change simulation rate. Every other non-view key (including **Enter**), a flight
control input, or **Take control** releases the demo. Keyboard controls stay where the pilot left them;
hardware axes pick up after matching those positions (within 5% travel). Deliberate axis movement beyond
4% travel ends the demo; resting hardware does not. Flights pause at their end. Press **Enter** to continue
flying, or choose another demo from the menu.

These flights run the same shared control-only pilots as the R22 tests. They start afresh at maximum gross
loading in calm standard weather, overriding `scenario=`, resume and weather URL settings. The demo flight
is not saved as a resumed flight. The circuit is a handling sequence, not a navigated airport traffic pattern;
it finishes in a field. **The autorotation landing is a known failure:** the flare balloons and touchdown
rotor RPM is about 67% in the app. The original sea-level gross/solo landing checks remain expected failures.
Its existing test entry begins with collective down and mixture cut; it does not demonstrate a pilot's
reaction delay to a failure. See [implementation and verification details](r22-flight-model.md#live-scripted-demonstrations).

### Helicopter hover and hold modes

R22, R44 and Schweizer 269 now support opt-in helicopter hover/position, heading,
altitude and forward-speed hold. Start at
`index.html?aircraft=r22&hover=1&ap=1&resume=0` (or choose **Start helicopter hover test**
in the Flight menu). **A** engages/disconnects; **Escape → Flight → Autopilot** sets
targets and enables optional bounded adaptation. Moving cyclic, pedals or collective
returns control to you. S269 throttle must be managed manually: it has no governor.
See [flying instructions and identification limits](helicopter-adaptive-control.md).

## Cessna 152

The keys are the C172S's with these differences:

| Keys | Action |
|---|---|
| / | Carburettor heat cold / hot (heated air from the muffler shroud: 150-200 rpm less at full throttle) |
| Shift+J | Fuel shut-off valve ON / OFF (there is no LEFT / RIGHT selector: both tanks feed by gravity) |
| J | Nothing: there is no electric fuel pump |

The flaps have the same detents (0°, 10°, 20°, 30°); the only trim is the elevator's. The engine ices: with a
humid day and part throttle the rpm sags until carburettor heat is pulled (the menu's carburettor-icing switch turns
it off). Speeds: rotate at 50 KIAS, Vy 67, best glide 60, approach 65 with flap 20 and 60 with flap 30, stall 40
clean / 35 with flap 30, Vfe 85, Vne 149. Not modelled: the hand primer (a cold engine starts without priming) and
the missing accelerator pump (no stumble on a fast throttle opening); the optional wheel fairings and long-range
tanks; fuel cross-feed between the tanks on a slope; the ailerons' rigged droop and the rudder tab beyond a fixed
rigging offset; the 108 hp O-235-N2C of 1983 on; spins (a full-aft, full-rudder entry ends in a spiral, not a
developed spin, on every type).

## Piper PA-38 Tomahawk II

The keys are the C172S's with these differences:

| Keys | Action |
|---|---|
| / | Carburettor heat cold / hot |
| Shift+J | Fuel selector LEFT, RIGHT, OFF (there is no BOTH: change tanks every hour, electric pump on for the change) |
| J | Electric fuel pump on / off (on for the start, take-off, landing and tank changes) |

The hand-lever flaps have two notches, 21° and 34° (F6 / F5 step 0°, 21°, 34°); the pedals steer the nosewheel
directly, without the 172's bungee, so it is quicker on the ground. The trim is the wheel's spring trim, the only
one; the stall horn and light are electric and silent with a dead bus. Speeds: rotate at 53 KIAS, Vx 61, Vy 70,
best glide 70, approach 70 with flap 21 and 67 with full flap, stall 52 clean / 49 with flap 34, Vfe 89, Vne 138.
Not modelled: the hand primer (a cold engine starts without priming; no over-priming, no stumble on a fast throttle
opening); the flow strips as anything but an earlier stall over their span (their stations are estimates); the
T-tail's rattle and shake in the wing's wake at the stall (the buffet is the generic one); detonation at full
throttle with carburettor heat on (the power falls, nothing breaks); the Tomahawk I (outboard strips only, smaller
wheels); the ground-adjustable rudder tab beyond a fixed rigging offset; spins.

## Diamond DA20-C1

The keys are the C172S's with these differences:

| Keys | Action |
|---|---|
| / | Alternate air (the unfiltered second inlet, if the air filter is blocked) |
| Shift+J | Fuel shut-off valve OPEN / CLOSED (there is no tank selector) |
| J | Electric fuel pump on / off (it primes; on for the start, take-off, landing and below 1,400 rpm) |
| Rudder keys | On the ground at taxi speed: also brake the inside wheel (the nosewheel casters freely and does not follow the pedals) |

The flaps are CRUISE, T/O and LDG (0°, 15°, 45°; F6 / F5). The trim is electric: with the master off it does not
move. The airspeed indicator reads 5-10 kt below the calibrated speed at low speed, as the real one does (AFM
5.3.1). Speeds: rotate at 44 KIAS
(52 on a short-field take-off), Vx 60, Vy 75, best glide 73, approach 60 with flap T/O and 55-65 with flap LDG,
stall 44 clean / 36 with LDG flap, Vfe 100 (T/O) and 78 (LDG), Vne 164. Not modelled: the electric pump's high
speed (FUEL PRIME) and priming (a cold engine starts without priming; no flooded or hot starts); the
altitude-compensating fuel pump of some aircraft; the canopy (it is always closed and latched); the trim indicator
shows the trim switch's command while the spring datum follows it at 2°/s, only with bus power; the structural
temperature limit (55 °C on a hot ramp); the optional MT propeller and G500 TXi panel; spins.

## Piper PA-34-200 Seneca I

A twin: the engine keys act on the selected engine(s). The keys are the C172S's with these differences:

| Keys | Action |
|---|---|
| 8 / 9 / 0 | Select the left / right / both engines for the throttle, propeller, mixture, fuel selector and starter keys |
| ; / Shift+; | Propeller lever(s): lower / higher rpm |
| Shift+F | Feather the selected engine's propeller (above 800 rpm; below it the blades latch in fine pitch) |
| F7 / Shift+F7 | Landing gear down / up (retract below 109 KIAS); F10 emergency extension (below 87 KIAS) |
| \\ / Shift+\\ | Cowl flaps open / closed (open for ground running and the climb) |
| 6 / 7 | Rudder trim left / right |
| / | Alternate air on / off (fuel injection: no carburettor heat) |
| Shift+J | Fuel selector of the selected engine: ON, CROSSFEED, OFF (crossfeed in level flight only) |
| J | Electric fuel pumps on / off (on for take-off, landing and priming) |
| S | Starter: with both engines selected the left starts first, then the right |

Start each engine primed: mixtures full rich, the pumps on for 3-5 s until fuel flow shows, then off, and crank; an
unprimed cold engine needs several seconds of cranking, and a minute of pump floods it. The hand flaps have three
notches, 10°, 25° and 40° (F6 / F5). Speeds: rotate at 72 KIAS, Vx 78, Vy 91, Vyse (blue line) 91, Vmc (red line)
69, best glide 91, approach 91 with flap 25 and 83 over the fence with flap 40, stall 64 clean / 60 with gear and
flap 40, Vfe 139 / 122 / 109 (flap 10 / 25 / 40), Vle 130, Vne 188. With one engine failed: identify, feather it
(Shift+F with the dead engine selected), and fly at Vyse with the ball half out toward the live engine; on one
engine at sea level it climbs about 230 ft/min. Not modelled: the aileron-rudder spring interconnect (feet-off Dutch
roll and the roll due to pedal differ a little); the hand-operated alternate-air doors beyond a switch per engine;
the 4000 lb maximum landing weight (landing heavier is permitted); the propeller dampers and the 2200-2400 rpm avoid
band; the feathering dome's nitrogen charge (a propeller always feathers and never overspeeds from a lost charge);
the gear lights' dimming with the nav lights, the nose-gear mirror and a hydraulic leak dropping the gear; the
optional heater, ice protection and autopilot; spins.
