# Scenarios, URL parameters and resume

Start conditions, the parameters `index.html` accepts, the automation API, time acceleration and resume on reload.

## Scenarios

| id | Start |
|---|---|
| `runway` (default) | Lined up on runway 07, engine idling, parking brake set |
| `apron` | Parked on the apron, cold and dark (battery off, engine stopped) |
| `final` | 3 NM final for runway 07 on a 3° glide path, 70 KIAS, flaps 20, trimmed |
| `cruise` | 4500 ft MSL, 110 KIAS, eastbound along the foothills with the Alps on the left (over 15 min of terrain clearance on the hold) |
| `downwind` | Left downwind for runway 07 at pattern altitude (1000 ft AGL), 90 KIAS |

## URL parameters

All are optional, for example `index.html?scenario=final&cam=chase&tod=20.5&ap=1`.

| Parameter | Meaning |
|---|---|
| `scenario=` | `runway`, `apron`, `final`, `cruise`, `downwind`; `safari` in the Cretaceous era |
| `aircraft=` | Fly this type for this page only (see [aircraft.md](aircraft.md)) |
| `era=` | `present` or `cretaceous` (Deep Time); default: the era chosen in the menu |
| `cam=` | `cockpit` (default), `chase`, `orbit`, `flyby`, `tower` |
| `tod=`, `doy=` | Local solar time in hours; day of year (default 9.5 h, day 172) |
| `cover=`, `base=` | Cloud cover 0..1 (the sky fraction an observer sees, in oktas / 8); cloud base in m MSL (default 0.35, 1500 m) |
| `cirrus=` | Cirrus deck cover 0..1, independent of `cover=` (default 0.1) |
| `vis=`, `qnh=`, `temp=` | Visibility in m; sea-level pressure in hPa; ISA deviation in K |
| `wind=dir,kt[,gust]`, `turb=` | Wind FROM, degrees true, and speed in kt; turbulence 0..1 |
| `top=` | Cloud top in m MSL, at least 100 m above a base given by `base=` or `wx=` (default: the base keeps the layer depth) |
| `wx=` | A menu weather preset, applied before the other weather parameters: `clear`, `fair`, `overcast`, `gusty`, `lowifr`, `fog`, `drizzle`, `rain`, `snow`, `thunderstorm` (`src/sim/weatherPresets.ts`) |
| `ctype=` | Low layer type: `auto` (default), `stratus`, `stratocumulus`, `cumulus`, `towering`, `nimbostratus` |
| `mid=as\|ac,cover[,altM]` | Mid-level sheet: altostratus or altocumulus, cover 0..1, altitude in m MSL (default max(4500, cloud top + 1000)) |
| `precip=type,rate` | Precipitation `drizzle`, `rain` or `snow` at a rate in mm/h 0..50; `precip=none` for none |
| `fog=topM[,visM]` | Ground fog depth above the field, 0..300 m, and the visibility inside it, 50..1000 m (default 200) |
| `cb=northKm,eastKm[,topKm[,intensity[,radiusKm[,fromDeg,kt]]]]` | A cumulonimbus cell from the airport (defaults: top 11 km, intensity 0.8, core radius 3 km, stationary); repeat for up to 4 cells; `cb=none` removes a preset's cells. Fields and accessors: [weather.md](weather.md) |
| `quality=` | `low`, `medium`, `high` (default), `ultra` |
| `dpr=`, `scale=` | The 3D view renders at CSS-pixel resolution (device pixel ratio capped at 1 on every quality); `dpr=2` raises the cap on a HiDPI screen, `scale=0.5..1` sets the render scale (default 0.75 on `low`, 1 otherwise; also a menu slider). The DOM UI stays at native resolution. The 3D cockpit view alone renders at up to 1.25x / 1.5x CSS pixels (never above the screen's ratio) on high and ultra: menu, Display & camera, 3D cockpit sharpness, stored as `fs.cockpitSharpness`; Auto is 1.25x on high and 1x on ultra (src/sim/displayPrefs.ts has the GPU timings). `dpr=` overrides it |
| `depth=` | `reversed` (default where `EXT_clip_control` exists: reversed-Z float depth, keeps early-Z) or `log` (logarithmic depth written per fragment) |
| `clock=0` | Freeze the local time of day (by default it runs with the simulation and its time scale) |
| `assist=0` | Keyboard assists off: no ground-steering auto-rudder (feet off the pedals on the ground) and no roll trim |
| `hud=0`, `ui=0`, `mute=1` | Hide the external-view HUD; hide every overlay; no sound |
| `ap=1` | Autoflight flies the scenario: take-off and climb (runway), approach, landing and stop (final), hold (cruise, downwind) |
| `run=<s>` | After loading, fast-forward the simulation this many seconds |
| `freeze=1` | Pause once loading and `run=` are done |
| `camPos=n,e,alt`, `camLook=n,e,alt`, `fov=` | Fixed camera in NED metres (altitude MSL) |
| `resume=0`, `resume=1` | Resume on reload: `0` neither resumes nor saves the flight; `1` resumes even when `scenario=` is given or the menu toggle is off (see below) |
| `career=1`, `career=0` | Career (present day only, [career.md](career.md)): `1` opens the Career hub at boot (what a Career type switch adds; the boot then removes it from the address, so a later reload does not open the hub again); `0` never opens it at boot and counts as an explicit start (no Career job is resumed or placed). Absent: the Career's boot plan |
| `cstore=mem`, `cstore=session` | Where the Career save is kept: `mem` in memory only (tests; a type switch is refused), `session` in sessionStorage (browser checks across a type switch). Absent: `localStorage` (`fs.career.v1`). Neither writes a Career resume block |

The Flight School's parameters (`school=`, `lesson=`, `tstore=`, `unlock=1` and others) are in
[flight-school.md](flight-school.md); `unlock=1` also unlocks the Career for the session.

`window.__ready` becomes true once the terrain around the camera is built and exposure has settled.
`window.__sim` is the automation API: `step(s)`, `reset(id)`, `pause(bool)`, `setAutoflight(on)`,
`setCamera(mode)`, `setFixedCamera(pos, look)`, `setWeather({...})` (including `cirrusCover` and the optional
fields of [weather.md](weather.md); a `cloudBaseM` without `cloudTopM` keeps the layer depth), `summary()`,
`errors`, `depthMode`, `warmUpMs`, and the live objects (`ctx`, `physics`, `flightModel`, `autoflight`,
`autopilot`, `systems`, `post`, `cloudShadows`). `__sim.autoflight.targetAltitude` is the held altitude (m MSL,
NaN when not holding). `__sim.training` drives the Flight School and `__sim.career` the Career
([career.md](career.md), "Automation").

## Menu and time acceleration

The menu (Escape) has tabs for the flight (scenarios, autopilot, cabin dome light, keyboard assists, simulation
rate with the rate actually achieved), weather (presets, including radiation fog, low stratus and drizzle, rain,
snow and thunderstorm; wind, gusts, turbulence, cloud cover and base, cirrus, visibility, cloud type, mid-level
sheet cover, altitude and kind, precipitation type and rate, ground fog depth and visibility, storm cells placed
from the aircraft, temperature, QNH), time of day and date, display (quality, render scale, camera, HUD), the controls
reference and joystick setup.

Time acceleration (menu, up to 16x) keeps the display smooth: above 4x the airborne flight model runs at
120 Hz (60 Hz above 8x; full rate whenever a wheel is near the ground), and the physics gets at most 8 ms of
CPU per frame; if that is not enough the simulation runs slower than asked (`ctx.achievedTimeScale`, and a
toast) rather than the frame rate collapsing. The local clock and sun run with simulated time. A scenario
restart from the menu or Shift+R and a graphics-quality change fade to a curtain and hold the simulation
while the trim, the shader compiles and the terrain rebuild happen, instead of freezing mid-flight. All
shader variants for the cockpit and exterior views are compiled and linked behind the loading screen.

## Resume on reload

A reload (browser refresh, dev-server reload, a lost-and-restored WebGL context) continues the
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
A Career job in progress writes its own block into the snapshot, so a reload resumes the job with the flight
([career.md](career.md), "Persistence, boot and reloads").

## Aircraft switch

Choosing another type in the menu's aircraft chooser (or `commands.setAircraft`, or `__sim.swapAircraft(id)`)
switches it in place: the world stays loaded and the flight carries on in the new type
(`Simulator.swapAircraft`). What a switch keeps: the position, velocity, attitude and body rates exactly (in the
air; on the ground the new type stands on its own wheels or skids at the same north/east and heading, rolling at
the same ground speed), the clock, the weather and time of day, the radios and their tuning, the altimeter
setting, heading bug and OBS, the camera mode, the time scale, the keyboard assists and the mouse-yoke mode, the
stations' memory of you and the traffic (no reset; the callsign on the radio becomes the new type's registration),
and an engaged autopilot (re-engaged holding what it finds, in the air). What
it does not: the new type is trimmed at the old airspeed and flight path, clamped into its own envelope (a toast
lists what was clamped), with its typical payload, the old fuel fraction and the switch positions of the phase;
gyros are spun up when the engines run; every held key is let go. The physics side is `SimPhysics.setAircraft`
(`src/sim/aircraftSwap.ts`); the shell rebuilds the aircraft model (with its panel textures and livery bake), the
instrument panel, the cameras' eye point, the post pipeline's radius and cabin box, the input and sound
profiles, the UI (HUD, hints, control widget, checklist, fixed panel, cockpit clicks, menu and key list,
autopilot link), the R22 demonstrations, the Flight School's instructor-pilot and the cloud-shadow and floodlight
patches. Nothing kept from boot points at the old type: the Flight School, the radio and the Career read the panel
and the type live. No `reset` event is sent (the radio, the traffic and the Career would take it for a new flight).

The new type's definition and presentation are loaded lazily, as at boot, while the old type flies on (the menu
holds the simulation while it is open). The rebuild then runs with the simulation held. A type not built yet in
this session, or whose rebuild was measured above 200 ms, goes behind a short curtain with a shader warm-up; a
quick one does not. Afterwards the choice is stored (`fs.aircraft`), the address becomes the one a reload would
have used (no `aircraft=`, `scenario=`, `resume=`, `ap=`, ...) and the flight is saved under the new type, so F5
resumes it there. A switch keeps the menu from asking "Leave this flight?" (`commands.aircraftHotSwap()`); it closes
the menu, and a toast names the new type.

The reload of old is still used, unchanged, when a switch in place could break something: a lesson in any phase,
a placed Career job or one being placed, the Career's or the Flight School's own type switch (`open:`), an R22
demonstration, a curtain already up, a crashed aircraft, another switch under way, or the new type's chunks failing
to load. The menu asks first for a lesson or a job, as before. A type the physics cannot build leaves the old one
flying, with a toast.

`node scripts/swap-check.mjs` checks it in headless Chrome: a C172S in cruise switched to the R44, PA-34, C152,
C208 and back, each switch paused so position, velocity, attitude and clock compare exactly (all unchanged), then
3 s of flight against the velocity, the panel texture on the new model, the old model gone, the address and the
stored snapshot, no errors, a cockpit and an exterior picture (`--reference` adds each type booted straight into
cruise, for comparison); a switch made from the menu's chooser (no question, the menu closes, the flight goes
on); a second, paused round trip with the GPU resource and window-listener counts (no growth),
its way back forced through the quick path; F5 resuming in the type last flown; and a switch lined up on the runway
(C172S to C152 on its own wheels at the same spot and heading). Measured on the dev server (the rebuild; the whole
switch with its curtain): C172S and C152 0.28-0.33 s, 1.0-1.1 s (0.27 s by the quick path, no curtain); PA-34
1.1 s, 2.1 s and C208 1.5 s, 2.4 s the first time (their propeller maps); R44 1.6-1.7 s, 2.2-3.0 s (its model
is built on the main thread); a reload 7.7 s.

## Sound

Sound starts on the first click, tap or key press (browsers allow audio only after a user gesture). It needs a
secure page: http://localhost, or HTTPS when flying from another device on the network (`npm run dev:https`);
opened by IP address over plain http there is no sound and a message says why. If the browser stops the sound
on its own (a phone call, the screen lock, another app taking the audio on a phone or tablet), it comes back
by itself or on the next tap. On an iPhone or iPad the simulator asks for media playback, so the ring/silent
switch does not mute it (Safari 16.4 and later). F8 shows the state of the audio path under the frame time.
