# fs: a Cessna 172S flight simulator in the browser

A physically based light-aircraft simulator in TypeScript, three.js (r186) and WebGL 2. The flight
model is X-Plane-style blade-element physics: no stability-derivative tables. Everything you see and hear
is procedural (terrain, trees, airport, aircraft, clouds, sky, instruments, engine sound); there are no
external assets.

## Running it

```sh
npm install
npm run dev          # opens a Vite dev server; load http://localhost:5173/
npm run build        # production build into dist/
npm run preview      # serve dist/
```

It needs a browser with WebGL 2 and a real GPU. Measured at 1600x900 on an AMD Radeon 8060S (integrated), GPU
timer-query median of the whole post pipeline: about 5.2 ms per frame on `high` and 8.1 ms on `ultra` in the
runway cockpit view, 6.4 ms and 9.3 ms in the cruise chase view under the cumulus layer (whole-frame CPU+GPU
throughput 5.5-6.7 ms on `high`, 9.5-10.5 ms on `ultra`); `low` renders at 0.75 scale. Loading takes about 5 s (terrain tiles are built in
workers). Press **Escape** for the menu: scenarios, weather, time of day, display quality, controls and
joysticks.

Sound starts on the first click, tap or key press (browsers allow audio only after a user gesture). It needs a
secure page: http://localhost, or HTTPS when flying from another device on the network (`npm run dev:https`);
opened by IP address over plain http there is no sound and a message says why. If the browser stops the sound
on its own (a phone call, the screen lock, another app taking the audio on a phone or tablet), it comes back
by itself or on the next tap. On an iPhone or iPad the simulator asks for media playback, so the ring/silent
switch does not mute it (Safari 16.4 and later). F8 shows the state of the audio path under the frame time.

## Aircraft

| id | Type | Notes |
|---|---|---|
| `c172s` (default) | Cessna 172S Skyhawk SP: four seats, Lycoming IO-360 fuel-injected, 180 hp, fixed pitch | Everything below is written for it |
| `c152` | Cessna 152 (1978): two seats, Lycoming O-235-L2C carburetted, 110 hp, fixed pitch | See below |
| `pa38` | Piper PA-38-112 Tomahawk II: two seats, low wing, T-tail, Lycoming O-235-L2C carburetted, 112 hp, fixed pitch | See below |
| `da20` | Diamond DA20-C1: two seats, composite low wing, T-tail, stick, Continental IO-240-B fuel-injected, 125 hp, fixed pitch | See below |
| `pa34` | Piper PA-34-200 Seneca I: six seats, light twin, two Lycoming IO-360 fuel-injected, 2 x 200 hp, counter-rotating constant-speed feathering propellers, retractable gear | See below |

Choose the type at the top of the menu's Flight page (Escape). The choice is remembered per browser and the page
reloads into it; airborne or moving it asks first. Each type keeps its own resumed flight, so switching to another
type and back continues where you left it. `index.html?aircraft=<id>` flies a type for that page only (it is not
remembered). The Flight School teaches in the C172S; the other types are flown free.

**Experimental helicopters.** An initial R22 Beta II rotorcraft path is available at
`index.html?aircraft=r22&scenario=runway&resume=0` (not yet listed in the chooser).
Use the arrows for cyclic, Z/X for pedals, and hold F5/F6 to lower/raise collective.
Insert toggles the clutch; Delete toggles the governor. Throttle remains independent.
The HUD shows rotor NR separately from engine RPM. This adds blade-element rotor loads,
dynamic inflow, drivetrain/freewheel/governor behavior and skid contacts, but is not yet
flight-test validated. See [the model notes](docs/r22-flight-model.md) for controls, data
provenance, fidelity limits and the path to R44 and Schweizer 269 support.

**Cessna 152.** The keys are the C172S's with these differences:

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

**Piper PA-38 Tomahawk II.** The keys are the C172S's with these differences:

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

**Diamond DA20-C1.** The keys are the C172S's with these differences:

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

**Piper PA-34-200 Seneca I.** A twin: the engine keys act on the selected engine(s). The keys are the C172S's with
these differences:

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

## Controls

The Controls tab in the menu lists the same table. Joysticks, yokes and pedals (Gamepad API) are set up in
the menu's "Joysticks & yokes" tab. In the cockpit view the panel is clickable: switches toggle, knobs turn
with the wheel or a click, and holding the key at START runs the starter.

| Keys | Action |
|---|---|
| **Flight controls** | |
| ↓ / ↑ | Yoke back (nose up) / forward (nose down); stays where you leave it |
| ← / → | Yoke left / right (roll); stays where you leave it |
| Z or Q / X or E | Left / right rudder; stays where you leave it |
| Num 5, 5 | Centre aileron, elevator and rudder |
| F5 / F6 | Flaps up / down one notch (0°, 10°, 20°, 30°) |
| Home, Num 7 / End, Num 1 | Elevator trim nose down / nose up |
| Y | Toggle mouse yoke |
| **Brakes** | |
| , / . | Left / right toe brake (hold) |
| B | Both brakes (hold) |
| Shift+B | Parking brake on/off |
| **Engine** | |
| F2, Page Down / F3, Page Up | Throttle back / forward |
| F1 / F4 | Throttle idle / full |
| M / Shift+M | Mixture lean / rich (hold; lean to rich takes about 3 s) |
| S | Starter (hold) |
| 1 / 2 / 3 / 4 | Magnetos OFF / R / L / BOTH |
| **Switches** | |
| W | Master switch (BAT + ALT) |
| Shift+W | Alternator half of the master |
| I / Shift+I | Avionics master / pitot heat |
| J / Shift+J | Auxiliary fuel pump / fuel selector (BOTH, LEFT, RIGHT, OFF) |
| **Lights** | |
| L / Shift+L | Landing / taxi light |
| N | Navigation lights |
| O / Shift+O | Strobes / beacon |
| ' | Panel lights: off, dim, medium, bright |
| **Instruments** | |
| G / Shift+G | Heading bug right / left (hold to turn faster) |
| K / Shift+K | Altimeter setting up / down (1 hPa) |
| U / Shift+U | NAV1 OBS course up / down |
| D | Align the heading indicator with the compass (hold) |
| **View** | |
| C / Shift+C | Next / previous camera (cockpit, chase, orbit, flyby, tower) |
| V, Backspace, middle click | Recentre view |
| = , Num + / - , Num - , mouse wheel | Zoom |
| Shift+arrows, Num 4/6/8/2 | Look around (hold) |
| Drag (either button) | Look around / orbit the aircraft |
| \` | Toggle captured mouse-look |
| **Simulation** | |
| P, Pause | Pause / resume |
| A | Autopilot on/off (airborne only), KAP 140 style: HDG mode flies the heading bug (synchronised to the present heading on engagement; G / Shift+G turn it) and ALT holds the altitude; the throttle stays yours. Moving the yoke or rudder disconnects it |
| T / Shift+T | Autopilot altitude up / down 100 ft |
| H | Cabin dome light on/off |
| Shift+R | Restart the scenario (a restart asked for while a curtain is up runs when it lifts) |
| Shift+[ / Shift+] | Simulation rate slower / faster: 0.5x, 1x, 2x, 4x, 8x, 16x |
| Escape | Menu |
| F9 / F8 | HUD on/off / frame-time readout |

The keyboard yoke and rudder **hold position**, as in FSX / MSFS: a held arrow or rudder key moves the control,
and letting go leaves it where it is (the control-position widget at the bottom of the screen shows where; it
stays up while the keyboard controls are off centre). **Num 5** or **5** glides aileron, elevator and rudder back
to centre (the trimmed position of the scenario) in at most 0.25 s. The rate is non-linear: a key starts slowly,
so a tap is a fine adjustment, and speeds up quadratically the longer it is held. The travel a key can reach, and
so its rate, shrink with airspeed (constant load factor per key in pitch, constant roll rate per key in roll), so
the same hold does about the same manoeuvre at every speed:

| Key | Rate at key-down | Full rate after | Full rate | Travel moved by a 0.1 s / 0.5 s / 1 s hold | Measured with the C172 flight model |
|---|---|---|---|---|---|
| Elevator (↑ ↓) | 0.15 | 1.5 s | 0.6 | 0.009 / 0.050 / 0.13 at 70 KIAS | a 1 s hold reaches 1.24 g within that second at 70 KIAS (1.27 g at 93, 1.33 g at 113 KIAS); a 0.6 s hold arrests a 400 fpm approach sink in about 1.6 s at 1.2 g; a 2 s hold is a ~2 g pull |
| Aileron (← →) | 0.2 | 1.2 s | 1.0 | 0.019 / 0.11 / 0.35 at 70 KIAS | the roll rate the key leaves: about 0.5 °/s after a tap, 4 °/s after 0.5 s, 11-13 °/s after 1 s, at 70, 93 and 113 KIAS alike |
| Rudder (Z X) | 0.25 | 1.0 s | 1.2 | 0.025 / 0.16 / 0.57 below 58 KIAS | about 0.5 s of X gives the right pedal a full-power take-off roll needs |

Rates are fractions of the airspeed-dependent limit per second (travel is ±1). A key moves the control back toward
centre 1.2-1.3 times faster than away from it. On the ground (either main wheel down) the elevator key runs at 60 %
of its airborne rate, because pivoting on the mains gives the nose no flight-path damping. After a rotation the
yoke stays back, so ease the nose to the climb attitude with ↑ (or press 5) once airborne. The brakes (B , .)
stay hold-to-apply, and the trim, throttle and mixture keys are unchanged. The mouse yoke and joystick axes are
absolute and unaffected. When the autopilot flies, the keyboard yoke follows it (as a hand resting on it), so
taking over or disengaging does not jump.

The keyboard assists (both off while hardware or the mouse yoke owns that axis) act only while you are not
holding that control yourself:
- **Ground steering** is an auto-rudder for the ground roll. It holds the heading while the keyboard rudder is
  centred (untouched since the start or the last 5). Your first rudder key press takes the pedals over from it
  without a bump: the rudder it was holding becomes your held rudder. Pressing 5 on the take-off or landing roll
  (above 8 m/s) hands the pedals back to it at that position, so centring does not swerve the aircraft.
- **Roll trim** holds the small steady aileron the aircraft needs (propeller torque in the climb) while the
  keyboard ailerons are centred and the wings are within 6° of level. It hands over to your first roll key press
  the same way.
- **Rotation guard**: while the nose-up key is held with a main wheel on the ground (and for as long as that same
  press lasts after lift-off), it stops the key pulling further once the nose comes up at more than about
  5 °/s or nears 11° (the tail-strike attitude is ~13-14°). It never moves a yoke you have let go of.
- A soft load-factor stop eases a held keyboard elevator back beyond 2.2 g or below 0.35 g.

Both assists can be switched off in the menu (Flight tab) or with `assist=0`. With ground steering off and the
keyboard rudder centred (no rudder axis in use), your feet are off the pedals: the rudder floats, the nosewheel
follows it through the steering bungee (held by the loaded nose tyre), and the full-power roll wanders left
with the propeller's yaw unless you hold right rudder (X or E), as in the aeroplane. Pitch trim (Home / End) is
incremental and is what holds the attitude with the yoke centred.

## Scenarios

| id | Start |
|---|---|
| `runway` (default) | Lined up on runway 07, engine idling, parking brake set |
| `apron` | Parked on the apron, cold and dark (battery off, engine stopped) |
| `final` | 3 NM final for runway 07 on a 3° glide path, 70 KIAS, flaps 20, trimmed |
| `cruise` | 4500 ft MSL, 110 KIAS, eastbound along the foothills with the Alps on the left (over 15 min of terrain clearance on the hold) |
| `downwind` | Left downwind for runway 07 at pattern altitude (1000 ft AGL), 90 KIAS |

## URL parameters (index.html)

All are optional, for example `index.html?scenario=final&cam=chase&tod=20.5&ap=1`.

| Parameter | Meaning |
|---|---|
| `scenario=` | `runway`, `apron`, `final`, `cruise`, `downwind` |
| `cam=` | `cockpit` (default), `chase`, `orbit`, `flyby`, `tower` |
| `tod=`, `doy=` | Local solar time in hours; day of year (default 9.5 h, day 172) |
| `cover=`, `base=` | Cloud cover 0..1 (the sky fraction an observer sees, in oktas / 8); cloud base in m MSL (default 0.35, 1500 m) |
| `cirrus=` | Cirrus deck cover 0..1, independent of `cover=` (default 0.1) |
| `vis=`, `qnh=`, `temp=` | Visibility in m; sea-level pressure in hPa; ISA deviation in K |
| `wind=dir,kt[,gust]`, `turb=` | Wind FROM, degrees true, and speed in kt; turbulence 0..1 |
| `quality=` | `low`, `medium`, `high` (default), `ultra` |
| `dpr=`, `scale=` | The 3D view renders at CSS-pixel resolution (device pixel ratio capped at 1 on every quality); `dpr=2` raises the cap on a HiDPI screen, `scale=0.5..1` sets the render scale (default 0.75 on `low`, 1 otherwise; also a menu slider). The DOM UI stays at native resolution |
| `depth=` | `reversed` (default where `EXT_clip_control` exists: reversed-Z float depth, keeps early-Z) or `log` (logarithmic depth written per fragment) |
| `clock=0` | Freeze the local time of day (by default it runs with the simulation and its time scale) |
| `assist=0` | Keyboard assists off: no ground-steering auto-rudder (feet off the pedals on the ground) and no roll trim |
| `hud=0`, `ui=0`, `mute=1` | Hide the external-view HUD; hide every overlay; no sound |
| `ap=1` | Autoflight flies the scenario: take-off and climb (runway), approach, landing and stop (final), hold (cruise, downwind) |
| `run=<s>` | After loading, fast-forward the simulation this many seconds |
| `freeze=1` | Pause once loading and `run=` are done |
| `camPos=n,e,alt`, `camLook=n,e,alt`, `fov=` | Fixed camera in NED metres (altitude MSL) |
| `resume=0`, `resume=1` | Resume on reload: `0` neither resumes nor saves the flight; `1` resumes even when `scenario=` is given or the menu toggle is off (see below) |

`window.__ready` becomes true once the terrain around the camera is built and exposure has settled.
`window.__sim` is the automation API: `step(s)`, `reset(id)`, `pause(bool)`, `setAutoflight(on)`,
`setCamera(mode)`, `setFixedCamera(pos, look)`, `setWeather({...})` (including `cirrusCover`), `summary()`,
`errors`, `depthMode`, `warmUpMs`, and the live objects (`ctx`, `physics`, `flightModel`, `autoflight`,
`autopilot`, `systems`, `post`, `cloudShadows`). `__sim.autoflight.targetAltitude` is the held altitude (m MSL,
NaN when not holding).

The menu (Escape) has tabs for the flight (scenarios, autopilot, cabin dome light, keyboard assists, simulation
rate with the rate actually achieved), weather (presets; wind, gusts, turbulence, cloud cover and base, cirrus,
visibility, temperature, QNH), time of day and date, display (quality, render scale, camera, HUD), the controls
reference and joystick setup.

Time acceleration (menu, up to 16x) keeps the display smooth: above 4x the airborne flight model runs at
120 Hz (60 Hz above 8x; full rate whenever a wheel is near the ground), and the physics gets at most 8 ms of
CPU per frame; if that is not enough the simulation runs slower than asked (`ctx.achievedTimeScale`, and a
toast) rather than the frame rate collapsing. The local clock and sun run with simulated time. A scenario
restart from the menu or Shift+R and a graphics-quality change fade to a curtain and hold the simulation
while the trim, the shader compiles and the terrain rebuild happen, instead of freezing mid-flight. All
shader variants for the cockpit and exterior views are compiled and linked behind the loading screen.

**Resume on reload.** A reload (browser refresh, dev-server reload, a lost-and-restored WebGL context) continues the
flight instead of going back to the runway. While flying, about once a second and again on pagehide,
beforeunload and when the tab is hidden, the simulator writes a 2.4 kB snapshot to `localStorage`
(`fs.resume.snapshot`). It holds the flight-model clock and rigid-body state, the engine, propeller, fuel per
tank and battery, the surface and flap positions, every pilot control (trim, mixture, brakes, lights, switches,
knobs), the weather and time of day, the camera, graphics quality, scenario and the autopilot's modes and
targets. On boot it is restored through the flight model's own API (`src/sim/resume.ts`,
`SimPhysics.restore`), and a toast says "Resumed flight from m:ss ago". Shift+R or the menu still restarts the
scenario. The flight resumes only when the URL has no `scenario=` (or has `resume=1`) and the menu's "Resume
where I left off on reload" toggle (Flight tab, on by default) is on. A snapshot is not resumed if it
is more than 12 hours old, from a crashed aircraft, or from one parked with the engine off; corrupt or
older-format snapshots are ignored. A restart from the menu or Shift+R marks the snapshot so that a reload
starts that scenario fresh, until the new flight has run for 5 s. When the flight resumes, the snapshot's
weather, camera and quality take precedence over the URL's; the simulation rate restarts at 1x.
`__sim.resume` exposes the boot decision, `save()`, `stored()` and `clear()`. Measured in the real app after
45 s of cruise on the autopilot: position, altitude, heading, attitude, rpm, flaps, trim, weather, camera and
autopilot mode come back exactly (airspeed within 0.25 kt, as the pitot and aerodynamic lags restart), and the
flight continues without a jump. Airborne, a resumed flight stays within millimetres of an uninterrupted one
over 10 s; resumed mid take-off roll it drifts about 2 m in 10 s, because the tyre states restart from rest.

## Flight School

An instructor-led course from the first flight to the PPL skill test, flown in the same aircraft and world as
free flight (design: `docs/instructor-spec.md`). "Open Flight School" on the menu's Flight tab (Escape) opens
the school home: the syllabus, the logbook, the challenges and the settings (EASA or FAA standard, instructor
voice, captions). A first visit opens a welcome card.

**What is in it.** 21 lessons in five stages: handling (L01 effects of controls to L07 stalling), circuits
(L08 take-off to L14 first solo), advanced (L15 steep turns to L19 instrument appreciation), navigation (L20)
and the skill test (L21), plus the N1 night rating and four challenges (spot landing, dead-stick, crosswind
master, precision circuit) unlocked by the matching lessons. A lesson unlocks when the ones it needs are competent;
anything else can be flown for practice (no logbook credit).

**How a lesson works.** A briefing (aim, points, the exercises and their standards) behind the curtain, then the
flight: the instructor demonstrates ("follow me through"), offers you control (the strip at the top shows who
has it: press Enter to take it), coaches while you fly (captions, and spoken with the Web Speech voices when
available), and takes control back when a safety limit is passed ("I have control!"): near the ground with
full power and a climb, never by closing the throttle. With "Instructor saves" off in the school settings she
does not take over, but she still calls the danger ("Too much bank! Roll the wings level!"). The task card (Tab
cycles it) shows the targets and tolerances of the current exercise; checklists are challenge and response
or flows (see the guidance below for how a dual lesson talks you through them). Every exercise is graded 1-4 against the EASA or FAA tolerances, as the
weakest required criterion over every task that scored it in one run of its phase (an assessed circuit is
graded on all its legs); a task flown again within the run replaces its earlier try, and the best run counts
(the first in check and test lessons). The lesson is Competent when every required exercise reaches
Satisfactory, and the stars (1-3) follow from the grades. The debrief shows the exercise table, the main points and the flight trace; the logbook keeps every
attempt. During a lesson time acceleration is limited to what the lesson allows (a toast says so), the
autopilot (A) is only available where the exercise permits it, and a reload resumes the lesson at the step it
was on ("Right, where were we."), with the flight. A crash in a lesson offers the debrief (which starts with
what happened; items a crash cut short are not graded), a retry from the last checkpoint, or a restart.

**Feedback while you fly.** Each exercise the instructor talks you through has its own commentary (TaskFeedback
in `src/training/types.ts`): the instruction, then "Go ahead..." once you have control (never while she has it);
progress remarks as you reach each stage ("Fifteen left... Now roll smoothly through level to 15 right"), of
which only the latest one still true is said when she finishes talking, so she never praises a stage you have
already left; a confirmation when the goal is met ("Good. Elevator controls pitch..."); and neutral reminders
after a quiet spell while the goal is not yet met. When an exercise ends, its lines still waiting to be said are
dropped (only the confirmation carries over). Such an exercise shows live targets on the card even when it is
graded, and the strip shows ASSESSMENT only on the exercises she flies in silence, which end with "Thank you."
In stage 1 (L01-L08) she talks sooner and more often. If you hand control back (Shift+Enter) mid-exercise, its
clock stops until you take control again (Enter, then Enter on her "You have control"); she reminds you every
30 s. At the end of an airborne lesson she takes control and her closing line is heard before the debrief opens.

**Guidance in the cockpit and on the ground** (dual lessons; the owner's playtest of L01 and L02).
- *Callouts.* Whenever the instructor names a control or an instrument (a checklist item, a step that points at
  something, a reminder), a pulsing ring sits on it with a label: its name, the state it must be in ("ON",
  "OFF", "RICH", "BOTH", "1,000 RPM"), the key that works it ("hold S" for the starter, "hold Shift+M" for
  the mixture) and, on its first reading, why. Off screen, an arrow on the screen edge points toward it. Clicking
  the label presses the key. One callout at a time; it turns green when the state is reached.
- *Glance.* When a callout's control is off screen the cockpit view turns briefly toward it and comes back to
  the forward view when it is done or after 6 s. School settings: "Glance" (on by default). The look keys
  still move the view as usual.
- *Guided checklists.* Each item is read with its required state, where the control is and its key (the first
  time that control comes up) and a reason of 15 words or fewer ("Avionics off for the start: the starter's
  voltage dip can damage the radios"). The item is done the moment the aircraft is in that state (no Enter);
  only items that cannot be seen from the state (the propeller area, the engine instruments) take Enter. The next
  item is read only once she has finished speaking about the last, so every line is heard in order. Reminders
  say what is still wrong ("The throttle is still at 1,840 rpm: it needs to be 1,000 rpm, key F2"), never in
  the same words twice; after two she offers to show you ([), and if it is left too long she sets it herself.
  L02's before-start checklist verifies the whole set-up before the start, including the prime (fuel pump on,
  then off) and the throttle opened a quarter inch (two taps of F3).
- *Engine rpm on the ground.* Standing still above 1,200 rpm for 5 s: "Bring the power back to 1,000 rpm"
  (pointing at the throttle, key F2), then the tachometer, then an offer of help; still high after that, she
  brings the throttle back herself. L02 does not leave the stand above 1,250 rpm.
- *Taxi guidance.* A route from the stand to the holding point along the real taxiway centrelines. She calls
  it as an instructor would, from the distance along the route (whatever the cross-track): "Straight ahead out
  of the stand to the yellow line, then turn right along it", "B1 is the next left, in about 40 metres", "Now
  follow Alpha ahead, about 800 metres. A1 will be on the left", "Holding point A1 ahead: stop before the double
  yellow lines". A taxi panel shows the next action (left, right, straight), its distance and the turns after
  it, the cross-track on the yellow line, and HOLD SHORT in red on the last connector. The ground coach watches
  the speed (over 15 kt), the yellow line (over 3 m off), the brake test, the grass ("Stop! We're off the
  taxiway", repeated while it lasts) and a parking brake left on.
- *Reminders follow the state.* A nudge names what is still missing, and says nothing when nothing is (no
  "throttle up to 1,800" at 1,800); a reminder never repeats the previous line's words.

**Lesson limits.** Each exercise has limits suited to it (L01: bank 45°, pitch +20/−15°, 60-125 KIAS; trimming
also ±400 ft). Beyond one for 1.5 s she takes control ("I have control." and why), restores straight and level at
the height, heading and speed the exercise started from, talking through it ("Wings coming level... nose on the
horizon"), gives a teaching point, and hands back with the three-way call; the exercise then starts again. On
the third time on one exercise she says she will come back to it and moves on, and the exercise fails. A limit
intervention is not a safety intervention: it never ends the lesson, but that exercise cannot reach grade 4, and
the debrief names it ("I took control three times when the bank went past the lesson limit"). The safety
envelope above still takes precedence. With "Instructor saves" off she says the line but does not take over.

**Keys during a lesson** (they only act while a lesson runs; elsewhere they keep their free-flight meaning):

| Key | Action |
|---|---|
| Enter | Acknowledge: take control when offered, confirm a checklist item, continue |
| Shift+Enter | Hand control back to the instructor |
| R | Say again (repeat the last instruction) |
| [ | Show me (the instructor demonstrates the current exercise again) |
| Tab | Cycle the task card: compact, expanded, hidden |
| Shift+R | Retry the current phase from its checkpoint |

**URL parameters** (in addition to the ones above):

| Parameter | Meaning |
|---|---|
| `school=0`, `school=1` | 0: never open the welcome card or school home on boot; 1: open it even when a flight is resumed or `scenario=` is given (automated browsers behave as `school=0` unless `school=1`) |
| `lesson=L04` | Open that lesson's briefing directly (locks ignored: practice credit unless it is available) |
| `phase=climb` | With `lesson=`: start at that phase (no logbook credit) |
| `brief=0` | With `lesson=`: skip the briefing and start flying |
| `voice=0` | Captions only, no speech |
| `standard=easa`, `standard=faa` | The grading standard for this session (the saved profile is not changed) |
| `tstore=mem` | In-memory school store: nothing is read from or written to `localStorage` |
| `unlock=1` | Every lesson available this session (practice credit only) |
| `student=auto` | Development (dev server only): the scripted AutoStudent flies the student's tasks |

`window.__sim.training` is the automation API: `start(id, {phase, brief, standard})`, `state()` (phase, step,
authority, captions, strip and card), `input(cmd)` (`ack`, `handback`, `sayAgain`, `showMe`, `retryPhase`,
`restartLesson`, `abandon`), `skipStep()`, `end()`, `result()`, `transcript()`, `profile()`, `export()`, `import(json)`,
`command(cmd)` (the School UI's commands), and the live `runner`, `store` and `system`.

The school's progress (profile, lesson results, logbook, traces) is in `localStorage` (`fs.training.v1`); the
school's settings screen downloads and imports it as a JSON file. A reload mid-lesson writes the lesson's resume block into
the flight snapshot (snapshot schema 2; schema-1 snapshots still resume as free flight).

**Conformance.** The lessons are tested headless with the real flight model, lesson runner, copilot,
telemetry, grader and speech scheduler (captions on a simulated clock): `tests/training/conformance*.test.ts`
fly lessons with a scripted student (`tests/training/autoStudent.ts`), which must end each one competent
(the skill test: pass) within its time limit, with no crash, no intervention and every demonstration done; a
negligent student (biased or oscillating targets) must end not yet competent with the right coaching, and a
70° bank must bring the instructor in. A reload mid-lesson must resume at the same step and finish. By default
the suite flies a representative set (L04, L09, L12, L15); `FS_CONFORMANCE=1 npx vitest run tests/training/conformance`
flies every lesson and challenge and the negligent-student course (about 12 minutes on 32 cores). Recorded telemetry of real flights
(`tests/training/fixtures/`, re-recorded with `node scripts/record-telemetry.mjs`) checks the event detectors
and the landing, steep-turn and altitude grading. In the real app, `node scripts/fly-lesson.mjs L04` flies a lesson
in headless Chrome with screenshots of the briefing, a demonstration, the handover, a coaching remark, the
debrief and the logbook (`shots/school/flights/<id>/`); `--reload` reloads mid-practice and checks the resume,
`--keys` flies the student's tasks with real key events.

## Architecture

```
src/main.ts            entry: new Simulator().boot()
src/core/              the shared contract: types.ts (ControlInputs, AircraftState, Environment, weather;
                       frames and units), context.ts (SimContext, SceneEffect, events; the PHOTOMETRIC
                       SCALE: scene units = 0.1 x cd/m^2), c172.ts (geometry), world.ts (airport, runway)
src/sim/               the application shell
  Simulator.ts           boot order, frame loop, commands, window.__sim / __ready
  SimPhysics.ts          fixed 240 Hz stepping with interpolation, time-acceleration budget, resets (node-safe)
  clock.ts               local time of day advancing with simulated time
  overlays.ts            boot-error, context-lost and fade-curtain overlays
  scenarios.ts           the five start conditions;  autoflight.ts  scripted pilot + autopilot
  worldEnvironment.ts    terrain + airport pavement as the physics Environment
  cloudShadows.ts        scene-wide material patches: cloud shadows on the sun term, apron floodlights
  params.ts              URL parameters
src/physics/           flight model: aero/ (blade elements, lifting line, slipstream, bodies),
                       propulsion/ (propeller BEMT, engine, thermal, fuel, electrical), gear/ (tyres,
                       struts, steering), weather/ (wind field, turbulence), trim.ts, autopilot.ts,
                       c172FlightModel.ts (6-DOF RK4 assembly)
src/world/terrain/     procedural heightfield, quadtree LOD tiles built in workers, land cover, trees
src/world/airport/     runway, taxiways, markings, lights, signs, buildings, valley town and roads
src/render/sky/        atmosphere scattering, sun/moon, cascaded shadows, environment map
src/render/clouds/     volumetric cumulus layer: a multi-scale weather map (cell size sets cloud height, with
                       congestus towers up to 1.6x the layer depth); from ~50 % to ~90 % cover the cells flatten
                       into a stratocumulus deck of 1-3 km cells with soft undulations, so `cover=0.9`-`1` reads
                       as a grey overcast base rather than a quilt of puffs; two-scale curl-warped Worley erosion
                       (cauliflower lobes and turrets on growing tops, ragged wisps at bases and on small clouds),
                       mottled bases with darker pockets, ray march with multiple-scattering octaves, blue-noise
                       jitter, temporal filter, depth-aware upsampling, shadow map, aerial haze
src/render/post/       aerial perspective, bloom, eye adaptation, local exposure, AgX tone mapping
src/render/aircraft/   the C172 model, cockpit, lights, livery bake (worker), contact shadow
src/render/cameras/    cockpit, chase, orbit, flyby and tower cameras
src/instruments/       the panel: instrument dynamics (gyros, pitot-static lags, engine gauges) and 2D canvas;
                       layout.ts is the panel geometry shared with the 3D cockpit and the click hotspots
src/input/             keyboard, mouse yoke, gamepads, key bindings, assists
src/audio/             engine / propeller / wind / gear synthesis in an AudioWorklet, mix and 3D panning
src/ui/                menu, HUD, loading screen, toasts, controller setup, cockpit panel clicks;
                       school/ the Flight School screens, lesson strip, task card and captions
src/training/          the Flight School: TrainingSystem.ts (glue to the simulator), engine/ (lesson runner,
                       authority, safety), content/ (syllabus, demonstrations, lines), copilot/, telemetry/,
                       grading/, speech/, career/ (store, logbook)
src/dev/, dev/*.html   one isolated test page per module
```

Each frame runs input, then fixed physics steps, then the aircraft pose, aircraft model, cameras, sky,
terrain and airport, panel, UI, audio, and finally the post chain (scene, aerial perspective, clouds, bloom,
exposure, tone mapping). All light is in physical units (the sun is about 1e5 lux), and auto exposure brings
it to display range, so lamps, displays and the sky stay consistent with each other.

## How the physics works

The aircraft is a 6-DOF rigid body integrated with RK4 at a fixed 240 Hz. The mass, CG and inertia follow
the fuel load. Aerodynamic forces are not taken from coefficient tables. The wing, tailplane and fin are cut
into strips, each with a horseshoe vortex (Weissinger lifting line, solved by Newton's method every step)
and full ±180° section data for NACA 2412/0009/0012. That section data includes Reynolds effects, flap and
control-surface deflections, and dynamic stall. A plain control surface's large-deflection loss depends on the
section's own angle of attack through a thin-aerofoil coupling (0.54 for the elevator, 0.41 for the ailerons,
0.52 for the rudder), so a fully back yoke cannot hold the wing unrealistically deep into the stall. The fuselage adds slender-body and cross-flow forces. The
wing's downwash and wake reach the tail with a convective delay, and the fuselage boundary layer slows the
flow over the tailplane roots (tail efficiency about 0.94). The propeller is solved by blade-element
momentum theory into four-quadrant maps: static, windmilling or stopped, with P-factor from each azimuth;
it sits in the wing's upwash, and the cowling just behind it slows the axial inflow by about 2 %. The blade
section is the Clark Y family member at the blade's load-weighted thickness (9 %), with its zero-lift angle
(-4.5°) taken to the flat face that the blade angle and the 60 in pitch are measured on. Full throttle gives
about 2,350 rpm static, 2,700 rpm and 127 KTAS in level flight at sea level, and the best-rate climb is within
4 % of the POH table from sea level to 12,000 ft (full rich, about 14.6 gph, below 3,000 ft; leaned above)
(`tests/fdm/performance.test.ts`). Its slipstream (an axial jet along the propeller shaft plus swirl) washes the
strips behind it, which is where the torque yaw, the destabilising effect of power on pitch stability and
the extra rudder and elevator authority at full power come from. The left-turning tendency (the swirl over
the fin, P-factor and the torque) needs about a quarter of right pedal for a balanced full-power climb at Vy
(0.26 of travel; 0.32 at Vx) and a little in cruise (0.06 at 100 KIAS); full power applied hands-off at
65 KIAS swings the nose left at up to about 3 °/s, 9° in 5 s, with the ball out to the right. On the take-off
roll about a fifth of right pedal keeps it straight; with the pedals left centred it swings well to the left
(`tests/fdm/handling.test.ts`, `tests/fdm/ground.test.ts`). The engine models induction, combustion
versus mixture, friction and temperatures, with the fuel system (injector flow, pump priming, starvation and
restart) and the electrical bus. The landing gear has series strut and tyre springs (the nose oleo is an
air-oil strut serviced to 45 psi, so it stiffens quickly under braking), a brush tyre model with relaxation
lengths, wheel spin and brakes, and a nosewheel steering bungee. A trim solver starts airborne scenarios in
equilibrium, and the free-floating elevator makes "hands off" a real trimmed state. The rudder can float too
(feet off the pedals), in the fin's local dynamic pressure (mostly slipstream on the take-off roll); on the
ground the loaded nosewheel restrains it. Turbulence is a
Dryden model on top of a wind field with gusts. Crashes are classified (gear collapse, prop strike, tail strike,
wingtip, or "Terrain impact at N kt" for high-energy contacts).

## Tests and tools

```sh
npx tsc --noEmit                 # type check
npx vitest run                   # all tests (105 files, 1,351 tests, ~4 min): physics vs POH figures, handling, gear, instruments,
                                 # audio levels, input flying the real model, scenario integration, the Flight School
                                 # (1,301 run; the 50 skipped are the opt-in conformance lessons beyond the quick set,
                                 # the negligent-student course and the calibration probe)
FS_CONFORMANCE=1 npx vitest run tests/training/conformance
                                 # fly every lesson and challenge headless with the AutoStudent, and the course
                                 # with a negligent student that must fail (51 tests, ~12 min on 32 cores)
node scripts/fly-lesson.mjs <lessonId> [outDir] [--keys] [--reload] [--trace]
                                 # one Flight School lesson in the real app, with screenshots (see Flight School)
node scripts/record-telemetry.mjs [name ...]
                                 # re-record the telemetry fixtures of tests/training/fixtures/
npx vitest run tests/sim         # integration: every scenario, a full autoflight landing, time stepping
node scripts/shot.mjs "index.html?scenario=cruise&cam=chase" out.png [--w 1600 --h 900] [--wait ms]
                                 # [--eval "js"] [--keys Escape] [--fps [--frames 120]]
                                 # render a page in headless Chrome on the GPU, print console errors;
                                 # --fps: drained CPU+GPU throughput (readPixels before and after N frames)
                                 # and GPU timer-query p10/p50 of the post pipeline. The rAF interval is not
                                 # a frame-rate figure here: without vsync rAF is not back-pressured by the GPU
node scripts/fly-circuit.mjs [outDir]
                                 # fly a full left-hand circuit through window.__sim, with screenshots and a
                                 # JSON log (NaN / crash / g / touchdown monitoring)
node scripts/fly-keyboard.mjs [outDir] ["assist=0"]
                                 # a whole circuit (take-off to full stop) flown only with real key events in
                                 # real time by the tests' keyboard pilot; NaN / crash / console-error monitoring
node scripts/check-keys.mjs <outDir>
                                 # real key events: hold-position yoke/rudder, 5 recentre, F2/F3 throttle, F5/F6
                                 # flaps, no page reload on F5 in the menu
npm run build && node scripts/check-build.mjs ["scenario=runway"] [out.png]
                                 # smoke-test the production build (workers, audio worklet, errors); with
                                 # "lesson=L04&brief=0&tstore=mem&voice=0" it also checks that a lesson runs
node tests/sim/resume-release-check.mjs <outDir> [flySeconds]
                                 # resume on reload in the real app: cruise on the autopilot, reload, compare
                                 # state and rates before / after; scenario= ignores the snapshot; a menu
                                 # restart or Shift+R then reload starts fresh; a crashed snapshot is not resumed
node tests/sim/resume-reload.mjs [outDir] [flySeconds]
                                 # the same for the default take-off on the autopilot, with screenshots
```

The screenshot matrix of the current build is in `shots/final/`, with one `.log` of state per image.

## License

Copyright (C) 2026 Roger Henderson

This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public
License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later
version.

This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied
warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.

You should have received a copy of the GNU General Public License along with this program (`LICENSE`). If not, see
<https://www.gnu.org/licenses/>.
