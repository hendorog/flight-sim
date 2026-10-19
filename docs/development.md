# Development

Performance, code layout, the physics model, and the test and screenshot tools.

## Performance

It needs a browser with WebGL 2 and a real GPU. Measured at 1600x900 on an AMD Radeon 8060S (integrated), GPU
timer-query median of the whole post pipeline: about 5.2 ms per frame on `high` and 8.1 ms on `ultra` in the
runway cockpit view, 6.4 ms and 9.3 ms in the cruise chase view under the cumulus layer (whole-frame CPU+GPU
throughput 5.5-6.7 ms on `high`, 9.5-10.5 ms on `ultra`); `low` renders at 0.75 scale. Loading takes about 5 s (terrain tiles are built in
workers).

## Architecture

```
src/main.ts            entry: new Simulator().boot()
src/core/              the shared contract: types.ts (ControlInputs, AircraftState, Environment, weather;
                       frames and units), context.ts (SimContext, SceneEffect, events; the PHOTOMETRIC
                       SCALE: scene units = 0.1 x cd/m^2), c172.ts (geometry), world.ts (airport, runway)
src/aircraft/          one folder per type (c172s, c152, pa38, da20, pa34, da42, c208, pc12, r22, r44, s269, md500):
                       aero, powerplant, gear, systems, panel, geometry, visual, audio, checklists and
                       KNOWN_ISSUES.md; registry.ts is the catalogue and lazy loader
src/sim/               the application shell
  Simulator.ts           boot order, frame loop, commands, window.__sim / __ready
  SimPhysics.ts          fixed 240 Hz stepping with interpolation, time-acceleration budget, resets (node-safe)
  clock.ts               local time of day advancing with simulated time
  overlays.ts            boot-error, context-lost and fade-curtain overlays
  scenarios.ts           the five start conditions;  autoflight.ts  scripted pilot + autopilot
  worldEnvironment.ts    terrain + airport pavement as the physics Environment
  cloudShadows.ts        scene-wide material patches: cloud shadows on the sun term, apron floodlights
  params.ts              URL parameters
  weatherPresets.ts      the menu's weather presets (also `wx=`)
  weather/lightning.ts   strike scheduler for the storm cells (node-safe)
src/physics/           flight model: aero/ (blade elements, lifting line, slipstream, bodies),
                       propulsion/ (propeller BEMT, engine, thermal, fuel, electrical), gear/ (tyres,
                       struts, steering), weather/ (wind field, turbulence, storm-cell updraft, downdraft and
                       outflow in convection.ts), trim.ts, autopilot.ts,
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
                       jitter, temporal filter, depth-aware upsampling, shadow map, aerial haze; an optional
                       cloud type (`cloudType`: stratus, stratocumulus, cumulus, towering, nimbostratus; absent =
                       the cover-driven look) and a mid-level altostratus / altocumulus sheet (`midCover`,
                       `midType`, `midAltM`) drawn from below and coupled into the sky light (render/sky/cloudSky.ts)
src/render/weather/    storm cells and ground fog (scene effects after the clouds), precipitation streaks and
                       lightning (overlays after the temporal pass); fields, accessors and gaps: docs/weather.md
src/render/post/       aerial perspective, bloom, eye adaptation, local exposure, AgX tone mapping
src/render/aircraft/   shared aircraft rendering: airframe, cockpit, lights, rotor blur, livery bake (worker),
                       contact shadow (each type's own geometry is in src/aircraft/<id>/)
src/render/cameras/    cockpit, chase, orbit, flyby and tower cameras
src/instruments/       the panel: instrument dynamics (gyros, pitot-static lags, engine gauges) and 2D canvas;
                       layout.ts is the panel geometry shared with the 3D cockpit and the click hotspots
src/input/             keyboard, mouse yoke, gamepads, key bindings, assists
src/audio/             engine / propeller / wind / gear / rain synthesis in an AudioWorklet, mix and 3D panning;
                       thunder.ts schedules thunder for each lightning strike on the main thread
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
