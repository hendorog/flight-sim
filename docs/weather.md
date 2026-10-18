# Weather fields, accessors and effect slots

This file covers the optional fields of `WeatherSettings` (`src/core/types.ts`) added for cloud types, a mid-level
sheet, precipitation, ground fog and cumulonimbus cells, the accessors that read them (`src/core/weatherFields.ts`),
and the render slots their effects use (`src/render/weather/`, `src/render/post/PostPipeline.ts`).

## Status

- The fields, accessors, the post-TAA overlay slot and the effect registry exist.
- All four effect factories return an effect on every quality tier, created at boot whether or not the weather
  sets their fields. Each implements `SceneEffect.active` (`src/core/context.ts`); `PostPipeline` skips an effect or
  overlay whose `active(ctx)` returns false without a draw (`renderEffects`), so a frame in `defaultWeather()` draws
  no full-screen pass for them (storm cells, precipitation and lightning after their first render, which compiles
  their shaders). The shader warm-up (`Simulator.warmUpShaders`) renders all
  four regardless, as before. Their GPU cost has not been measured (no GPU on the integration machine).
  - `createStormCellEffect` (`StormCellEffect.ts`): `storms`. A march at `STORM_SCALE` 0.5 resolution with
    `STORM_STEPS` 48 steps, then a depth-aware composite against the cumulus layer. Skipped when no cell is in the
    view frustum.
  - `createFogEffect` (`FogEffect.ts`): `fogTopM`, `fogVisibilityM`. One full-resolution draw; skipped when
    `fogOf(w).topM === 0`. It also writes the shared fog uniform (`fogGlsl.ts fogUniformFor`, every frame, from
    `active`); the aircraft light sprites read it only when no weather is passed to `AircraftLights.update`.
  - `createPrecipOverlay` (`PrecipOverlay.ts`): `precipType`, `precipRateMmH`. Skipped at rate 0 and on `low`; the
    streaks have no fade-out. Streaks on shells of 2, 5, 12 and 30 m about the camera on `high` and `ultra`, and
    2, 6 and 20 m on `medium`, up to `MAX_DROPS_PER_CELL` 4 drops per grid cell (`SLOTS_PER_DROP` 3 slots per mean
    drop; at most 16 pcg4d hashes per pixel on `high` and `ultra`, 12 on `medium`). Rain and drizzle streaks span
    the drop's motion in 1/60 s (`STREAK_EXPOSURE_S`), with a width, length and brightness per drop and a fade with
    the shell's radius. Snow draws round flakes 3 to 15 mm across (`SNOWFLAKE_MIN_M`, `SNOWFLAKE_MAX_M`) that sway
    and vary in brightness, streaked over 1/800 s (`SNOW_STREAK_EXPOSURE_S`): 4 mm parked in a 6 kt wind, 6.4 cm at
    100 kt. The audio parameter `rain` (`src/audio/params.ts`, index 45) carries the precipitation sound.
  - `createLightningOverlay` (`LightningOverlay.ts`): `storms`. Schedules strikes (`src/sim/weather/lightning.ts`
    `strikesBetween`, `FLASH_PER_MIN` 6 per minute at intensity 1, `CG_FRACTION` 0.3), keeps up to `MAX_FLASHES` 4
    lit, emits the `lightning` event and writes `ctx.weatherFx.flash`. Its `active` advances the strike schedule; it
    is skipped while no flash is lit.
    - Cloud-to-ground channel (`boltGeometry.ts` `boltPath`, `boltBranches`): 32 segments from 3000 m above the base
      to the ground point, the top moved sideways by up to `BOLT_SLANT` 0.3 of the height and pulled in to at most
      `BOLT_TOP_MAX_R` 0.5 of the core radius from the cell's centre (unconfirmed), and 2 to 4 side branches
      of 8 segments rooted on the channel below the base, all seeded by the strike id. Drawn per pixel as a
      Gaussian core of radius `BOLT_CORE_PX` 0.7 px and a halo of `BOLT_HALO_SHARE` 0.05 of the core falling off
      over `BOLT_HALO_PX` 2.5 px; these widths are CSS pixels (render-buffer pixels divided by the ratio of the
      render width to the canvas's CSS width, at least 1). The core radiance is the lower of `BOLT_RADIANCE` 1e5 scene units and
      `BOLT_CORE_EXPOSED` 64 in the tone map's input units at the last frame's adaptation. The channel follows the
      stroke envelope (`flashEnvelope`); the branches follow the first stroke only, at `BRANCH_SHARE` 0.6, fading to
      `BRANCH_TIP` 0.1 at the tip. All are unconfirmed look values.
    - Channel occlusion: the scene depth; the cumulus layer's front (hidden behind a front with transmittance below
      0.9); the storm cells by the optical depth from the camera to each channel point, integrated on the CPU over
      the cells' density at mean noise (`stormTau`, which skips a cell whose bounding circle the ray's ground track
      misses). Cloud optical depth dims the channel by exp(-tau), so the part
      inside the cloud is not drawn. Rain dims it by exp(-0.5 tau) (`RAIN_DIFFRACTION_SHARE`, unconfirmed).
    - Intracloud strikes draw no channel. They light the storm cloud in full and send `FLASH_IC_OUTSIDE` 0.15 of
      their light to surfaces and the cumulus (unconfirmed).
    - Cloud light of a flash: reduced by the factor 1 / sqrt(1 + L / Lmax), Lmax = `FLASH_CLOUD_MAX` 6 times a
      white surface under the light before the flash; once the eye adaptation is known, the result L' is reduced
      again by 1 / (1 + L' / Lc), Lc = `FLASH_CLOUD_EXPOSED_MAX` 8 in the tone map's input units at the last
      frame's adaptation, so the lit cloud stays below the channel core's 64 (both unconfirmed).
- Thunder: `src/audio/thunder.ts`, scheduled by `AudioSystem` on the `lightning` event; no sound beyond
  `THUNDER_MAX_DISTANCE_M` 20 km.
- Physics (`src/physics/weather/convection.ts`, `windField.ts`, `src/physics/environment.ts`): updraft, downdraft
  and outflow of the storm cells, their turbulence severity, and moisture from fog, mid sheet, cells and rain.
- `defaultWeather()` is unchanged and sets none of the new fields.
- Presets (`src/sim/weatherPresets.ts`): the five earlier menu presets plus `fog` (Radiation fog), `drizzle` (Low
  stratus & drizzle), `rain`, `snow` and `thunderstorm`, also selectable with the `wx=` URL parameter.

## Fields

All fields are optional. An absent field, a non-finite number, a value of the wrong type and an unknown enum string
all read as the default in the last column.

| Field | Type | Unit | Range read | Default (absent) |
| --- | --- | --- | --- | --- |
| `cloudType` | `'auto' \| 'stratus' \| 'stratocumulus' \| 'cumulus' \| 'towering' \| 'nimbostratus'` | | | `'auto'` |
| `midCover` | number | fraction | 0..1 | 0 (no sheet) |
| `midType` | `'altostratus' \| 'altocumulus'` | | | `'altostratus'` |
| `midAltM` | number | m MSL | 0..15000 | max(4500, `cloudTopM` + 1000) |
| `precipType` | `'none' \| 'drizzle' \| 'rain' \| 'snow'` | | | `'none'` |
| `precipRateMmH` | number | mm/h liquid-water equivalent | 0..50 | 0; also 0 whenever `precipType` reads as `'none'` |
| `fogTopM` | number | m above `AIRPORT.elevation` (120 m) | 0..300 | 0 (no fog) |
| `fogVisibilityM` | number | m | 50..1000 | 200 |
| `storms` | `readonly StormCell[]` | | first 4 entries read | `NO_STORMS` (empty, frozen) |

`visibilityM` stays the prevailing visibility; `fogVisibilityM` applies only inside the fog layer.

`StormCell` fields: `northM`, `eastM` (NED m at simTime 0), `radiusM` (core radius, 1000..5000 m), `topM` (anvil
top, 6000..14000 m MSL; the base is `cloudBaseM`), `intensity` (0..1), `motionDeg` (direction the cell moves from,
degrees true), `motionKt`, and optional `lightning` (`false` disables flashes; default true). The ranges in this
paragraph are documented in the type; `stormsOf` does not clamp them. Writers replace the `storms` array and do
not edit a cell in place.

## Accessors (`src/core/weatherFields.ts`)

The module does not import three.js. The accessors that take an `out` object write into it and allocate nothing.

| Export | Returns |
| --- | --- |
| `cloudTypeOf(w)` | the cloud type; `'auto'` when absent or unknown |
| `midLayerOf(w, out)` | `{cover, type, altM}` |
| `precipOf(w, out)` | `{type, rateMmH}` |
| `fogOf(w, out)` | `{topM, visibilityM}` |
| `stormsOf(w)` | `w.storms` when it is an array of well-formed cells (every number finite, `lightning` boolean or absent); otherwise `NO_STORMS` |
| `isStormCell(c)` | the type check `stormsOf` and `sanitizeExtras` apply to each cell |
| `stormCentreAt(cell, t, out)` | `{north, east}`: `northM − cos(motionDeg)·v·t`, `eastM − sin(motionDeg)·v·t`, `v = motionKt · 0.514444` m/s |
| `precipExtinctionPerM(type, rateMmH)` | extinction, 1/m; 0 for `'none'` or rate 0 |
| `effectiveVisibilityM(w)` | `w.visibilityM` itself when the precipitation rate reads as 0; otherwise `3.912 / (3.912 / visibilityM + precipExtinctionPerM)` |
| `deriveCloudTop(partial, current)` | sets `partial.cloudTopM` to `cloudBaseM` + the current layer depth when `partial` has a base and no top |
| `sanitizeExtras(w)` | deletes each new key whose value fails its type check; keeps values of the right type unclamped |
| `NEUTRAL_EXTRAS` | frozen object with every new key at its "nothing there" value (below) |
| `WEATHER_EXTRA_KEYS` | the nine new keys in declaration order |
| `CLOUD_TYPE_PROFILES` | per-type uniform inputs for the clouds module (below) |

`NEUTRAL_EXTRAS`: `cloudType 'auto'`, `midCover 0`, `midType 'altostratus'`, `midAltM 4500`, `precipType 'none'`,
`precipRateMmH 0`, `fogTopM 0`, `fogVisibilityM 200`, `storms NO_STORMS`. Its `midAltM` is the fixed 4500 m, not
the cloud-top rule of the absent default; with `midCover 0` no sheet is drawn.

`precipExtinctionPerM` uses power laws in the rate R, 1/km: rain 0.25·R^0.63, drizzle 1.5·R^0.5, snow 1.3·R^0.8.
Unconfirmed: no source has been checked for these coefficients.

`CLOUD_TYPE_PROFILES` (unconfirmed tuning values; read by `src/render/clouds/cloudModel.ts`):

| Type | deckOverride | deckWeight | extinctionScale | shapeFreqScale | towerExt |
| --- | --- | --- | --- | --- | --- |
| auto | 0 | 0 | 1 | 1 | 1.6 |
| stratus | 1 | 1 | 0.6 | 0.15 | 1.0 |
| stratocumulus | 1 | 1 | 1 | 1 | 1.2 |
| cumulus | 0 | 1 | 1 | 1 | 1.6 |
| towering | 0 | 1 | 1.2 | 1 | 2.5 |
| nimbostratus | 1 | 1 | 2.0 | 0.3 | 1.0 |

The `auto` row's `towerExt` equals `TOWER_EXTENSION` in `src/render/clouds/cloudModel.ts`.

## Render slots

- `PostPipeline.addEffect`: scene effects, run in order after the opaque scene and before the temporal pass.
- `PostPipeline.addOverlay`: overlays, run in order after the temporal pass and before bloom and exposure. Each
  reads the previous colour and the scene depth and writes one of the two ping targets, never the one its input
  belongs to (`renderOverlays`). An overlay writes the input's alpha unchanged (the tone map's point-source flag,
  `ToneMap.ts`). With no overlays the frame takes the same path as before the slot existed.
- `PostPipeline.cabinFromView(ctx, out)`: view space to the cabin box's [-1, 1]^3, the matrix the tone map's
  outside mask uses.
- `src/render/weather/index.ts`: `createWeatherEffects` (storm cells, then fog) and `createWeatherOverlays`
  (precipitation, then lightning), called by `Simulator` after `post.addEffect(clouds)` and before
  `warmUpShaders()`. Each factory receives `{ctx, renderer, clouds, post, weather}`.
- `SimContext.weatherFx.flash` (`{x, y, z, energy}`, three.js world, energy 0 when none) and the `lightning`
  event in `SimEvents`. The simulator and `src/dev/harness.ts` create `weatherFx` with every value 0;
  `LightningOverlay` writes `flash` (the brightest lit flash) and emits `lightning` once per strike.
  `FLASH_INTENSITY_CD` is 1e8 (unconfirmed tuning value).

## Clouds module (`src/render/clouds/`, `src/render/sky/cloudSky.ts`)

- `CLOUD_TYPE_SHAPE` (`cloudModel.ts`, uniform `uCloudShape`): render-only shape terms per type (deck top scale,
  base raggedness, erosion scale, type bias). Unconfirmed tuning values. With `'auto'` every uniform holds its
  value from before the types existed.
- `MID_TAU_MAX` (`cloudModel.ts`): sheet optical depth at full cover, altostratus 6, altocumulus 2 (unconfirmed).
  `midSheetTau(cover, type)` = mix(0.5, `MID_TAU_MAX`, cover). For altocumulus this is the patch mean; element
  centres carry up to 6 times it.
- `extendedLayerTopM(w)`: the low layer's top extended by the type's `towerExt`, the value of `uLayer.y`.
  `CloudModel.midAboveLayer` is `mid.cover > 0 && mid.altM > extendedLayerTopM`. The sheet is drawn, shadows the
  ground and enters the sky model only when it is true.
- `cloudSky.ts`: `directGround` takes the sheet's direct transmission; `directCamera` and `deckDirect` take it only
  while the camera is below the sheet. The shadow pass multiplies by `uMidTrans`. Plan section 3.2 had
  `deckDirect` take it unconditionally; the code follows the low deck's `(1 - above)` convention instead. This
  difference is open for decision.
- Stratiform lighting and deck haze (`marchShader.ts`, `CloudsEffect.ts`). `deckType` = `deckOverride` x
  `deckWeight` of the cloud type: 1 for stratus, stratocumulus and nimbostratus, 0 for `'auto'`, cumulus and
  towering. With `deckType` > 0: the light-march optical depth is scaled to the column above the sample along the
  light, at the mean density of the light-march samples (an approximation, not checked against a reference);
  `MS_ISO_K` is mixed toward `MS_ISO_K_SLAB` = 0.11 (0.75 (1 - g), g = 0.85); the 4 % sky-ambient floor at the base
  is removed; the direct-sun share of `uGroundRadiance` is scaled by `cloudSky.directGround`. `uDeckHaze` =
  `deckHaze(w)` = smoothstep(0.8, 1.0, cover) x max(`deckType`, 1 - `effectiveVisibilityM` / `visibilityM`). It
  scales down the blend toward the frame behind the clouds in `hazeAlong` and the cloud-shadow dimming of the haze
  below the layer. With `'auto'` and no precipitation, `deckType` and `uDeckHaze` are 0 and the march is unchanged.
- Sky, environment map refresh and cloud haze read `effectiveVisibilityM(w)` (`SkySystem.ts`, `CloudsEffect.ts`,
  `Atmosphere.ts`).

## Physics (`src/physics/`)

| Export | What it does |
| --- | --- |
| `cbSample(cells, p, t, agl, groundM, baseM, out)` (`weather/convection.ts`) | updraft `up`, outflow `outN`/`outE`, `severity` and `inCore` of the cells at a point; writes `out` |
| `WindField.stormTurbulence(p, t)` (`weather/windField.ts`) | the cells' severity 0..1 at a point, 0 without cells; read-only |
| `WindBreakdown.convective` | `{up, outN, outE}` from the cells; all 0 without cells |
| `SimEnvironment.moisture(altitudeMSL, north?, east?, time?)` (`environment.ts`) | `inCloud` also inside the fog layer, within 150 m of a mid sheet with cover 0.3 or more, and inside a cell core; dew point spread 0 below the base in rain or drizzle |

Without cells `WindField.sample` skips the convective branch, so its arithmetic is unchanged. The severity is passed
to the MIL-F-8785C intensities as max(`turbulence`, severity), clamped there at 1. The cockpit head motion
(`src/render/cameras/cockpitRig.ts`) uses the same maximum. The physics clamps a cell's radius, top and intensity
with `cellRadiusM`, `cellTopM` and `cellIntensity`.

## Training weather line

`weatherLine` (`src/training/content/weatherPresets.ts`) appends present-weather groups only when the fields are
present: `TS` when a cell has lightning, `DZ`, `-RA` / `RA` / `+RA` (below 2.5 / 10 mm/h / above), `-SN` / `SN` /
`+SN` (below 1 / 2.5 mm/h / above), `FG` for a fog layer, and `CB` after the cloud group when cells exist. The
visibility group still prints `visibilityM`, not `effectiveVisibilityM`.

## Recorded gaps

- Cloud cover is calibrated for `cloudType 'auto'` only. For the other types `cloudCover` has not been measured
  against the rendered cover (`CloudsEffect.measureCover` with `typeCover`).
- Mid-level sheet: drawn only when the camera is below `midAltM`; the camera-above case has no design. The cloud
  shadow lookup's fades also move the sheet's share toward 1 (`cloudShadow.ts` header); the simulator runs with
  `compositeShadows` off, so this shows on the dev page only.
- Ground fog: with the camera above the fog and a cloud between the camera and the fog, the fog's in-scatter is
  not dimmed by that cloud. The light sprites write no depth, so a lamp seen against a sky pixel is fogged with
  that pixel's path instead of the lamp-to-camera path. Inside the fog the removed sun beam returns as diffuse
  light with no surface-normal dependence and no ground reflection (`FOG_DIFFUSE_K` in `src/sim/cloudShadows.ts`,
  unconfirmed).
- Storm cells: the composite against the cumulus is an approximation from the cumulus front distance and
  transmittance; a cell casts no ground shadow; the sky light does not darken under an anvil; the moon does not
  light a cell; the temporal pass reprojects cell pixels with the depth buffer or the cumulus layer.
- Storm cell ranges: render (`cellGeometry`: radius 500..8000 m, top at least base + 2000 m), physics
  (`cellRadiusM`, `cellTopM`) and the lightning scheduler (radius only floored at 0) clamp out-of-range cells
  differently. `stormsOf` and `isStormCell` check types, not ranges.
- Downdraft centre: the physics places it toward the cell's motion; the drawn rain shaft is centred on the core.
  For a cell moving across the wind the two are 0.6 R apart.
- Landing-light beam: no volumetric term in fog.
- Windshield drops and wet pavement: not built.
- GPU timings: none of the plan's per-effect budgets (clouds +0.2 ms, fog 0.3 ms, precipitation 0.5 ms, storm cells
  1.5 ms with two cells and under 0.05 ms with none, on `high`) has been measured. The test machine renders with
  SwiftShader only.

## Integration checks (2026-10-18)

- `npx vitest run` after merging wx/W1, W6, W2, W3, W5 and W4: 323 files, 4238 tests passed, 14 failed, 318 skipped,
  9 expected fail, in 1809 s on a 4-CPU machine. 12 of the 14 failures are time-outs in aircraft, fauna and
  rotorcraft tests that also time out at commit 2223678, before the weather work. The other 2 are the
  `c172Sim` golden records `autoflight.runway` and `restore.cruise`.
- `FS_GOLDEN_EXACT=1 npx vitest run tests/golden`: 51 of 53 pass; the 2 failures are the same `c172Sim` records.
  They fail from commit 1e19186 (autopilot ball gain `BALL_KP_CRUISE`, merged in 48337e7) on. With 1e19186
  reverted on top of the integrated tree, 53 of 53 pass under `FS_GOLDEN_EXACT=1`. The golden data has not been
  regenerated.
- Browser check, `index.html` on `quality=medium` in Chromium with SwiftShader at 960x540: the default weather and
  `wx=fog`, `drizzle`, `rain`, `snow` and `thunderstorm`, each in chase and cockpit view. No console errors or
  warnings, no THREE shader compile errors and an empty `__sim.errors` on every page. SwiftShader advanced
  `simTime` by 0.27 s in 40 s of wall time, so no lightning strike was observed in the browser.
- Lightning check, `dev/weather.html` at 640x360, `q=medium`, Chromium with SwiftShader, one cell 10 km north
  (`cb=10,0`), camera 300 m MSL, strike held 4 ms after its first stroke (`flash=1`, `flash=ic`), 2026-10-18: no
  console errors or warnings at `tod=13`, `19.2` and `23`. The eye adaptation's target (log2 scene units) was
  -11.65 with no flash and -10.67 with the cloud-to-ground flash held at `tod=23` (+0.98 EV), and -10.98 with the
  intracloud flash held (+0.67 EV).
- Same page and views after `FLASH_CLOUD_EXPOSED_MAX` was added, 2026-10-18: at `tod=23` the rain shaft under the
  base at 230 px from the top read RGB 199, 205, 214 with the cell 10 km north (207, 213, 220 before) and 180, 188,
  199 with the cell 23 km away (213, 219, 226 before). No console errors or warnings.
- Same page at 320x180, `q=low`, `tod=23`, clock running: SwiftShader drew about 1 frame per second, so each frame
  advanced `simTime` by 0.1 s and the adaptation by 0.25 s. After one injected and one scheduled cloud-to-ground
  strike (sim time 0.97 s and 1.67 s), the adapted level peaked 0.51 EV over its level before the strikes and was
  back within 0.1 EV at sim time 2.87 s.
