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
`setCamera(mode)`, `setFixedCamera(pos, look)`, `setWeather({...})` (including `cirrusCover` and the optional
fields of [weather.md](weather.md); a `cloudBaseM` without `cloudTopM` keeps the layer depth), `summary()`,
`errors`, `depthMode`, `warmUpMs`, and the live objects (`ctx`, `physics`, `flightModel`, `autoflight`,
`autopilot`, `systems`, `post`, `cloudShadows`). `__sim.autoflight.targetAltitude` is the held altitude (m MSL,
NaN when not holding).

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

## Sound

Sound starts on the first click, tap or key press (browsers allow audio only after a user gesture). It needs a
secure page: http://localhost, or HTTPS when flying from another device on the network (`npm run dev:https`);
opened by IP address over plain http there is no sound and a message says why. If the browser stops the sound
on its own (a phone call, the screen lock, another app taking the audio on a phone or tablet), it comes back
by itself or on the next tap. On an iPhone or iPad the simulator asks for media playback, so the ring/silent
switch does not mute it (Safari 16.4 and later). F8 shows the state of the audio path under the frame time.
