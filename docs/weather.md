# Weather fields, accessors and effect slots

This file covers the optional fields of `WeatherSettings` (`src/core/types.ts`) added for cloud types, a mid-level
sheet, precipitation, ground fog and cumulonimbus cells, the accessors that read them (`src/core/weatherFields.ts`),
the storm cells derived from the conditions (`src/physics/weather/stormField.ts`), and the render slots their
effects use (`src/render/weather/`, `src/render/post/PostPipeline.ts`).

## Status

- The fields, accessors, the post-TAA overlay slot and the effect registry exist.
- All six effect factories return an effect on every quality tier, created at boot whether or not the weather
  sets their fields. Each implements `SceneEffect.active` (`src/core/context.ts`); `PostPipeline` skips an effect or
  overlay whose `active(ctx)` returns false without a draw (`renderEffects`), so a frame in `defaultWeather()` draws
  no full-screen pass for them after their first render. Each of the six draws its real material on its first
  render whatever the weather, so the shader warm-up (`Simulator.warmUpShaders`), which renders all six, compiles
  their shaders; the fog composite does this from commit 34193ab on (before it, a boot without fog compiled the
  composite on the first frame with fog). Their GPU cost has not been measured (no GPU on the integration machine).
  - `createStormCellEffect` (`StormCellEffect.ts`): the cells in effect at the camera (`StormField.select`, see
    "Storm cells derived from the conditions"), read from the frame's shared selection (`stormSelection.ts`
    `cameraStormsAt`, below). Their core, anvil, rain and hail shares multiply the densities
    (uniform `uCellW`). A march at `STORM_SCALE` 0.5 resolution with
    `STORM_STEPS` 48 steps, a temporal pass at that resolution (the cumulus layer's `TEMPORAL_FRAG`), then a
    depth-aware composite over the scene. The effect runs before the clouds. The march records the distances at
    which the cells' optical depth from the camera reaches `STORM_TAU_A` 0.1 and `STORM_TAU_B` 1 (the storm layer's
    distance texture, channels b and a); the cumulus march models the storm's optical depth in front of a distance
    as the line through those two points (at most the ray's total), multiplies its result by exp(-tau) at its own
    front, and ends where tau reaches `STORM_STOP_TAU` 4.6. Cumulus in front of a cell covers it; cumulus behind
    storm cloud or rain shows through it. Before 2026-10-20 the cumulus march ended at the distance where the storm's
    transmittance fell below 0.3, which cut the cumulus off along a hard edge when the camera flew out of a shaft.
    Skipped when no cell is in the view frustum, and until the cumulus layer's noise volumes are built.
    - Density (`stormGlsl.ts` header): the cumulus layer's noise volumes (`CloudsEffect.noiseTextures`: the 128^3
      Perlin-Worley shape, the 64^3 Worley detail, the 32^3 warp field), each octave in its own rotated frame, in
      cell-local coordinates offset per cell id. The core and the anvil are a signed margin in metres inside an
      envelope, moved by lobes (shape volume at `STORM_LOBE_M` 5200 m, amplitude `STORM_LOBE_SHARE` 0.22 R) and
      turrets (`STORM_TURRET_M` 1700 m, `STORM_TURRET_AMP_M` 260 m), the domain warped by `STORM_WARP_AMP_M` 350 m,
      and carved by the detail volume at 880, 230 and 61 m (`STORM_DETAIL_M`) to a depth of `STORM_EROSION_SHARE`
      0.12 of each period: inverted (lobes) above the base, plain (wisps) in its lowest `STORM_RAGGED_M` 160 m. An
      octave fades to its mean between 1.5 and 4 of its texels per pixel footprint (`STORM_OCTAVE_FADE`), so the
      mean surface does not move with distance. The density ramps over an edge band of max(`STORM_EDGE_M` 50 m,
      `STORM_EDGE_PX` 2.5 low-resolution pixel footprints). The base is lumped by `STORM_BASE_LUMP_M` 90 m, curves
      up over the outer `STORM_BASE_ROUND_M` 500 m of margin and ramps over `STORM_BASE_SOFT_M` 70 m; scud hangs up
      to `STORM_SCUD_DEPTH_M` 380 m below it within 0.85 R. The anvil has flattened lobes, a lumped underside,
      fibres from a stretched detail octave and an overshooting top of `STORM_OVERSHOOT_M` 700 m over the updraft.
      The rain and hail are the field of `physics/weather/stormPrecip.ts` (below). Core extinction
      `STORM_CORE_SIGMA` 0.08 1/m (0.2 before 2026-10-20). All unconfirmed look values. Before 2026-10-20 the cells
      read two octaves of one private 32^3 Worley texture at 5200 m and 900 m.
    - Sampling: each step's sample lies at a fraction of the step from a 64x64 blue-noise texture
      (`render/clouds/blueNoise.ts`) plus a golden-ratio offset per frame, and the ray moves by a Halton sub-pixel
      offset per frame; the temporal pass (blend 0.1, clip box 1.25 sigma) averages them, and a still view converges.
      Before 2026-10-20 the offset was interleaved gradient noise (Jimenez 2014) with no accumulation of its own,
      which showed as diagonal hatching. Steps end at the interval's end and, in rain, at an optical depth of
      `STORM_RAIN_STEP_TAU` 0.5 at the last sample's rain extinction (the rain at the ray's start sets the first
      step). A coarse step whose cloud optical depth exceeds 0.3 is bisected (`STORM_BISECT` 4) on the coarse density
      and continued with fine steps of `STORM_FINE_BAND` 0.15 of the edge band (at least `STORM_FINE_MIN_M` 8 m),
      lengthened by 1.6 per empty fine step.
    - Cost (stated, not measured on a GPU): per low-resolution pixel at most 48 steps plus 4 bisection samples per
      entry and one start sample. Texture reads per cell a sample touches: 1 warp read per sample, 2 shape and up to
      3 detail reads for the core (1 more for the scud), 1 shape and up to 2 detail reads for the anvil, 2 shape reads
      per core and 1 per anvil for each of the two sun taps. A lit sample in one cell's core: 10 reads; a sample
      outside every envelope: 1. Before: 2 reads per density evaluation, 6 per lit sample. The temporal pass adds 18
      reads per low-resolution pixel; the rain field adds 12 lattice hashes per cell near a shaft.
    - Light per sample (`stormGlsl.ts`): the sun through two coarse-density taps at 120 and 450 m (eroded by
      `STORM_TAP_EROSION` 2 means of the detail erosion, so they measure the lobes shading each other, read with
      `STORM_TAP_BAND` 4 times the edge band and at `STORM_TAP_SIGMA` 0.4 of the extinction) and, beyond
      them, the analytic core columns and anvils of the cells (`STORM_SHADOW_GLSL`: columns of the biweight profile
      (1 - (rho / r)^2)^2, the core out to `STORM_SHADOW_CORE_R` 0.7 R from the base to 250 m above the anvil's
      underside at 0.8 of its extinction, the anvil out to `STORM_SHADOW_ANVIL_R` 1 of its radius from 300 m above
      its underside to the top at 0.75 of its extinction; two nested cylinders before 2026-10-20, whose rims showed
      as arcs in the haze from inside a cell); the side light on rain greyed by `STORM_RAIN_SIDE_GREY` 0.7; multiple scattering of
      the cloud as in the cumulus march (`STORM_MS_ISO` 0.3, `STORM_MS_ISO_K` 0.5, `STORM_MS_LEAK` 0.04), of the rain
      `STORM_MS` 0.6 exp(-0.08 tau) / 4 pi; the sky through the analytic column above; `STORM_SIDE_SKY` 0.25 of the
      horizon radiance from the sides; ground bounce from ground in the cells' shadow that sees
      `STORM_GROUND_SKY_UNDER` 0.3 of the sky under their cloud. The haze in front of a cell keeps `1 -
      STORM_HAZE_SUN_SHARE` (0.2) of its in-scatter plus 0.8 of it times the cells' direct transmission at four
      points along the path. All unconfirmed look values. Extra work per lit sample: two analytic column and two
      shadow loops over the cells (four ray-cylinder chords per cell), no texture reads; per pixel, four shadow
      loops for the haze.
  - `createFogEffect` (`FogEffect.ts`): `fogTopM`, `fogVisibilityM`. One full-resolution draw; skipped when
    `fogOf(w).topM === 0`. It also writes the shared fog uniform (`fogGlsl.ts fogUniformFor`, every frame, from
    `active`); the aircraft light sprites read it only when no weather is passed to `AircraftLights.update`.
  - `createPrecipOverlay` (`PrecipOverlay.ts`): the precipitation at the camera each frame
    (`physics/weather/stormPrecip.ts` `localPrecipAt`: `precipType`, `precipRateMmH` and the storm cells' rain and
    hail, below), so the streaks thicken from the edge of a rain shaft to its core. Skipped at rate 0 without hail
    and on `low`. Storm rain and heavy rain: the streaks are drawn for `streakRateMmH` (the rate up to 10 mm/h, then
    rising toward 25 mm/h), and from 15 mm/h on they widen by up to `RAIN_HEAVY_WIDTH` 0.35, their coverage rises by
    up to `RAIN_HEAVY_ALPHA` 0.4 (both at 80 mm/h) and the fall speed rises from 7 to 9 m/s at 100 mm/h
    (`fallSpeedAt`); a storm-rain drop also carries `STORM_STREAK_SCENE_GAIN` 0.7 of the scene behind it. The direct
    sun on the drops is dimmed by the storm cells' cloud above the camera (`stormOverheadTau`). Hail: a second grid
    aligned with the motion of the mean stone relative to the camera, `HAIL_SLOTS` 2 hashes per shell, stones per
    cell from the number density (`hailNumberDensity`) times `HAIL_COUNT_SCALE` 2, each an opaque white-grey
    pellet (`HAIL_SKY_GAIN` 0.65, `HAIL_SUN_GAIN` 0.2; under 1 px its coverage is its width plus `HAIL_SUBPIXEL_FLOOR`
    0.3; it adds `HAIL_SCENE_GAIN` 0.9 of the scene behind it) of a diameter from the size distribution, streaked by its own
    fall speed. All unconfirmed look values. The streaks have no fade-out. Streaks on shells of 2, 5, 12 and 30 m about the camera on `high` and `ultra`, and
    2, 6 and 20 m on `medium`, up to `MAX_DROPS_PER_CELL` 4 drops per grid cell (`SLOTS_PER_DROP` 3 slots per mean
    drop; at most 16 pcg4d hashes per pixel on `high` and `ultra`, 12 on `medium`). Rain and drizzle streaks span
    the drop's motion in 1/60 s (`STREAK_EXPOSURE_S`), with a width, length and brightness per drop and a fade with
    the shell's radius. Snow draws round flakes 3 to 15 mm across (`SNOWFLAKE_MIN_M`, `SNOWFLAKE_MAX_M`) that sway
    and vary in brightness, streaked over 1/800 s (`SNOW_STREAK_EXPOSURE_S`): 4 mm parked in a 6 kt wind, 6.4 cm at
    100 kt. The sway and brightness phases use `uTime`, the summed render `dt` in s with no wrap (it wrapped at
    3600 s before commit 34193ab). The audio parameter `rain` (`src/audio/params.ts`, index 45) carries the precipitation sound, `hail` and
    `hailSize` (46, 47) the hail on the airframe, from the precipitation at the aircraft (`ctx.weatherFx.precip`).
  - `createHailGroundOverlay` (`HailGroundOverlay.ts`, state in `hailGround.ts` and `groundCover.ts`): hailstones
    landing and bouncing near the camera, and hail and snow lying on the ground, in every camera mode while the
    camera is less than `GROUND_MAX_AGL_M` 120 m above the ground under the camera (`ctx.env.groundElevation` at the
    camera's position). Two draws. A full-screen pass on upward-facing surfaces (normal within `SCATTER_MIN_UP` 0.8
    of vertical) within `SCATTER_RANGE_M` 1500 m (fading from 1200 m) takes each pixel's surface class: pavement
    inside the runway, taxiways and apron (the signed distance of `layout.ts`'s `PAVED_RECTS` joined with fillets of
    `FILLET_RADIUS`, and the runway rectangle, in the airport's frame, softened over the pixel's footprint; only
    with the modern airport), soil elsewhere. It reads that class's state (below, "Hail and snow on the ground"):
    the drawn wetness darkens the ground by `WET_DARK` 0.3 x wetness; the hail and snow covers c become a matte
    layer drawn at 1 - (1 - c)^k with k = 0.4 + 1.2 x a value noise (drifts of 23 m and 8 m; for hail also 2 m and
    0.7 m where the pixel's footprint is under 1 m, for snow 3 m), combined as 1 - (1 - hail)(1 - snow). The layer's
    luminance is the darkest scene luminance of the pixel and the pixels `LAYER_TAP_PX` 6 px left, right, above and
    below it, times `LAYER_OVER_SCENE` 6 (hail) or `SNOW_OVER_SCENE` 8 (snow), at most `LAYER_GAIN` 14 x the
    precipitation overlay's hail radiance, in that radiance's hue, times 0.94..1.06 (hail) or 0.95..1.05 (snow) from
    the noise; the darkest tap keeps the runway paint and the grass texture out of it and the aircraft's shadow in
    it (6 px wider). A pixel whose scene luminance is 1.5 to 3 times the layer's before the cap (the runway and
    approach lights) keeps the scene. Within `NEAR_FIELD_M` 6 m of the camera (fading from 4 m), and only where a
    stone is larger than about a quarter of the pixel's footprint, the pass also draws the lying hailstones one by
    one on a world-anchored `SCATTER_CELL_M` 3 cm grid (a cell holds a stone while its hash is below `SCATTER_FILL`
    1.5 x the hail cover, of a diameter from the size distribution): discs brightened toward their far side by 0.85
    + 0.25 ny, as the pellets, with a contact shadow (0.62) at the foot on the near side. The snow draws no stones.
    Excluded: the aircraft's bounding box (the visible meshes under `ctx.aircraftRoot` in the aircraft's frame,
    measured every 2 s, from `AIRCRAFT_FLOOR_M` 0.2 m above its lowest point, in every camera mode; at 0.08 m the
    runway under the box was left out in the 2026-10-21 chase screenshots) and in the cockpit the cabin box. The
    second draw is 768 instanced quads (`BOUNCE_CELLS` 16 x 16 cells of `BOUNCE_CELL_M` 1 m about the camera,
    `BOUNCE_PER_CELL` 3), each a stone that lands at a hashed point once per cycle of about `BOUNCE_CYCLE_S` 1.6 s
    with a chance set by the impact rate, rebounds at `HAIL_RESTITUTION` 0.4 (+- `HAIL_RESTITUTION_SPREAD` 0.1) of
    its fall speed, bounces a second time and rests, depth-tested in its shader against the scene depth. A stone's
    colour is `ICE_OVER_SCENE` 2.5 times the scene behind it, at least the precipitation overlay's hail radiance.
    The pellets assume flat ground at the aircraft's ground height. The restitution follows the owner's brief (0.3
    to 0.5) and is unconfirmed; every other drawing constant is a look value. Skipped (`active` false) without
    falling hail, lying hail or snow, and wetness left by them.
  - `createWindscreenOverlay` (`WindscreenOverlay.ts`, state in `windscreenWater.ts`): water, snow, hail and cracks
    on the glass, in the cockpit view only. It copies its input and draws the aircraft's glazing meshes (every mesh
    named `glazing` under `ctx.aircraftRoot`, built by `render/aircraft/fuselage.ts` for every fixed-wing type and
    every helicopter) a second time with its own shader, which keeps the glazing's window coverage (its alpha map),
    discards fragments behind the scene depth (the cabin, the panel and the airframe in front of the glass) and
    places everything at the glass's position in the aircraft frame. A hidden airframe (the fixed-panel view) has no
    visible glazing, and the overlay then draws nothing. State, from the precipitation at the aircraft
    (`ctx.weatherFx.precip`; at the camera where it is absent) and the true airspeed: the airflow share
    smoothstep(`AIR_SHARE_LO_MS` 8, `AIR_SHARE_HI_MS` 30 m/s, TAS); the wetness, which moves toward rate / (rate +
    `WET_HALF_MMH` 1.5 mm/h) with `WET_TAU_S` 4 s in rain or drizzle and dries with a time constant of
    `DRY_TAU_PARKED_S` 600 s parked (unconfirmed) to `DRY_TAU_FLYING_S` 6 s at speed; snow toward rate / (rate +
    `SNOW_HALF_MMH` 0.6 mm/h) with `SNOW_TAU_S` 5 s, melting or blowing off with 8 s parked to 1.5 s at speed; slush,
    which follows the snow level up with `SLUSH_RISE_S` 20 s and melts with `SLUSH_MELT_PARKED_S` 400 s parked to
    `SLUSH_BLOW_FLYING_S` 4 s at speed; hail strikes per m^2 and s as two parts, the number density times the mean
    stone's fall speed and times the airspeed. Layers on hashed grids on the glass:
    - sitting drops on 5 and 11 mm grids (each living about `DROP_LIFE_S` 22 s), blown off as the airflow share rises
      except in the aerodynamic shadow: where the window ends within `SHADOW_SILL_M` 25 mm below the pixel or
      `SHADOW_POST_M` 12 mm to either side (the window's coverage ends, or the scene depth shows the coaming, a post
      or the cabin more than 3 cm in front of the glass); at speed a 5 % layer (`BEAD_FLYING_SHARE`) of small drops
      on a 4 mm grid over all of the glass;
    - running drops on an 8 x 16 mm grid along the drops' motion (down the glass under gravity, with a wet trail),
      at a density of 0.18 x wetness x (1 - airflow share);
    - streams at speed: rivulets in columns of `STREAM_COL_M` 30 mm across the motion, one in a cell of 0.455 m
      along it with a chance of `STREAM_SHARE` 0.35 x wetness x airflow share, each 0.1 to 0.4 m long and
      `STREAM_WIDTH_M` 1.5 mm wide (0.75 mm over its tail), its centreline offset by 0.006 sin(40 y) + 0.002 sin(130 y)
      m (y along the glass, the path fixed on the glass) and the stream moved along it at `RUN_PER_TAS` 0.02 x TAS,
      with a 2 mm bead at its head and a soft tail, drawn as a drop (refracting the scene) and darkened to
      `STREAM_DARK` 0.55 of the scene plus `STREAM_SKY` 0.1 of the sky light, at least 1 px wide. The motion at speed is the airflow on the glass plus
      `STREAM_OUTWARD` 0.4 times the direction away from the glazing's centre line (full beyond 8 cm of it) on glass
      facing the airflow, so on a raked windscreen the streams run up and out toward the side posts. The densities of
      the sitting drops, the running drops and the streams change with the airflow share alone, so the pattern goes
      from parked to in-flight continuously with the airspeed;
    - snowflakes on a 7 mm grid that melt into drops over the last 40 % of `SNOW_LIFE_S` 6 s, and slush: white where
      the window ends within 10 to 25 mm (hashed per 12 mm across) times the slush level below the pixel;
    - hail: one strike per 40 mm cell and cycle of `HAIL_WET_S` 1.2 s (0.35 of it at speed), the cell (1 + 3 x airflow
      share) times longer along the motion, at the pixel's strike rate (the fall part times how far the glass faces
      up, the airspeed part times how far it faces the airflow): a white star-shaped splash for `HAIL_SPLASH_S`
      0.08 s, stretched downstream by the same factor, at least `SPLASH_OVER_SCENE` 2 times the scene behind the glass
      in brightness, then a wet spot (a drop of 0.7 times the splash radius) that fades out over the cycle.

    A drop shows the scene from its centre outward by `DROP_REFRACT` 7 times the pixel's offset (inverted), darkened
    at its rim by up to `DROP_RIM` 0.35, with a sky highlight on its upper side; over the sky its centre is darkened
    by up to `DROP_SKY_DARK` 0.15. At speed a water film blurs the view over 2 px. Cracks: see the hail damage below.
    Cost per frame while active (not measured on a GPU): one full-screen copy and one draw of the glazing meshes; per
    window pixel 2 texture reads, 6 to 9 hashes, up to 12 crack loops (each with up to 3 runners), 1 scene read per
    drop and 4 for the film, and up to 3 alpha-map and 3 depth reads for the shadow and the slush. Skipped (`active`
    false) outside the cockpit view and with a dry glass and no cracks. Every constant is a look value.
  - `createLightningOverlay` (`LightningOverlay.ts`): the cells in effect at the camera, from the frame's shared
    selection (`cameraStormsAt`). Schedules strikes (`src/sim/weather/lightning.ts` `strikesBetween`,
    `FLASH_PER_MIN` 6 per minute at intensity 1 times the cell's lightning share, `CG_FRACTION` 0.3; the hashes are
    keyed by the cell's `id`, so a derived cell keeps its strikes when its place in the list changes), keeps up to `MAX_FLASHES` 4
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
      inside the cloud is not drawn. Rain dims it by exp(-0.5 tau) (`RAIN_DIFFRACTION_SHARE`, unconfirmed). The
      transmittance of each channel and branch point is computed when the strike starts and kept with the flash;
      it is recomputed when the camera has moved more than `CHANNEL_TAU_MOVE_M` 200 m from where it was computed
      or the number of cells drawn changes. The cells' drift during the light (under 1 s) is not followed. Cost
      per lit-bolt frame (`LightningOverlay.render` with a fake renderer, one cell, 33 channel points, 2026-10-20):
      averages over 200 frames, 2.03 to 2.04 ms with the camera still and 1.73 to 1.84 ms with the camera moving
      5 m per frame before the cache; with it 0.28 ms over the first 200 frames (which include the strike's
      computation), then 0.04 ms with the camera still, 0.07 to 0.19 ms with it moving.
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
- Shared selection (`src/render/weather/stormSelection.ts`): one `StormField` per simulation context selects the
  cells at the camera once per frame (`cameraStormsAt(ctx)`). The cumulus layer (`CloudModel.update`, which runs
  first), the storm effect and the lightning overlay read the same array; it is selected again only when the
  simulation time, the camera's horizontal position or a weather input of the selection changes.
- `defaultWeather()` is unchanged and sets none of the new fields. Its derived convective activity is 0, so it has
  no storm cells.
- Presets (`src/sim/weatherPresets.ts`): the five earlier menu presets plus `fog` (Radiation fog), `drizzle` (Low
  stratus & drizzle), `rain`, `snow` and `thunderstorm`, also selectable with the `wx=` URL parameter. No preset
  sets `storms`; `thunderstorm` sets conditions whose derived activity is 1 (below).

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
| `storms` | `readonly StormCell[]` | | first 6 entries (`MAX_STORMS`) read | absent: cells derived from the conditions; an array (also empty) replaces them |
| `windsAloft` | `readonly WindAloftLevel[]` | | at most 12 levels, altitudes 2700..60000 ft strictly ascending, kt 0..250, tempC -90..50 | absent or malformed: derived from the conditions; `[]`: no shear above the boundary layer |
| `mountainWaves` | number | gain | 0..1 | 1 |

`visibilityM` stays the prevailing visibility; `fogVisibilityM` applies only inside the fog layer.

`WindAloftLevel` fields: `altFt` (ft MSL), `dirDeg` (wind FROM, degrees true), `kt`, optional `tempC` (deg C). A
table that fails any check (an entry out of range, altitudes not strictly ascending, more than 12 entries) reads as
absent. The lowest altitude, 2700 ft (`ALOFT_ALT_MIN_FT`), is the lowest whole hundred feet above the level the wind
profile ignores (shear base + 100 m = 820 m MSL = 2690 ft): every accepted level sets both its wind and its
temperature. Writers replace the array and do not edit a level in place.

`StormCell` fields: `northM`, `eastM` (NED m at simTime 0), `radiusM` (core radius, 1000..5000 m), `topM` (anvil
top, 6000..14000 m MSL; the base is `cloudBaseM`), `intensity` (0..1), `motionDeg` (direction the cell moves from,
degrees true), `motionKt`, and optional `lightning` (`false` disables flashes; default true). The ranges in this
paragraph are documented in the type; `stormsOf` does not clamp them. Writers replace the `storms` array and do
not edit a cell in place. `storms` absent or `undefined` means the cells are derived from the conditions; any
array, the empty one included (`cb=none`), turns the derived cells off.

Clock changes: `SimPhysics.resetTo` (and `reset`, which calls it) restarts the clock at 0 and moves the cells of the
weather it is given with `weatherPresets.reanchorStorms(w, tOld, tNew)`, so `stormCentreAt(cell, tNew)` after the
reset equals `stormCentreAt(cell, tOld)` before it. `TrainingSystem` records the clock when it copies the player's
weather at a lesson start and re-anchors the cells from it when it restores the copy at the lesson end. A snapshot
restore sets the clock and the weather from the same snapshot and moves no cell. The boot resume restores the
snapshot weather with `restoreWeather`, so an optional field set by the URL and absent from the snapshot goes back
to its `NEUTRAL_EXTRAS` value. Resume snapshots are schema 6 (`src/sim/resume.ts` `SNAPSHOT_SCHEMA`; schema 6 adds
`windsAloft` and `mountainWaves`, and a schema 5 or older snapshot is read with the derived winds aloft; schema 5 adds the hail damage, with the
rotor's level and dose present only once a rotor took damage, and a schema 4 or older snapshot is read with none); a schema 3 or
older snapshot with `storms: []`, the neutral value before the derived cells, is read with `storms` removed, so it
resumes with derived cells (`tests/sim/resume.test.ts`, with a snapshot written by commit 0692043). Derived cells run on the weather clock (`timeOfDay`, `dayOfYear`), which none of
these changes, so they do not move.

## Accessors (`src/core/weatherFields.ts`)

The module does not import three.js. The accessors that take an `out` object write into it and allocate nothing.

| Export | Returns |
| --- | --- |
| `cloudTypeOf(w)` | the cloud type; `'auto'` when absent or unknown |
| `midLayerOf(w, out)` | `{cover, type, altM}` |
| `precipOf(w, out)` | `{type, rateMmH}` |
| `fogOf(w, out)` | `{topM, visibilityM}` |
| `stormsOf(w)` | the explicit cells: `w.storms` when it is an array of well-formed cells (every number finite, `lightning` boolean or absent); otherwise `NO_STORMS` (also when `storms` is absent and the cells are derived) |
| `isStormCell(c)` | the type check `stormsOf` and `sanitizeExtras` apply to each cell |
| `stormCentreAt(cell, t, out)` | `{north, east}`: `northM − cos(motionDeg)·v·t`, `eastM − sin(motionDeg)·v·t`, `v = motionKt · 0.514444` m/s |
| `precipExtinctionPerM(type, rateMmH)` | extinction, 1/m; 0 for `'none'` or rate 0 |
| `effectiveVisibilityM(w)` | `w.visibilityM` itself when the precipitation rate reads as 0; otherwise `3.912 / (3.912 / visibilityM + precipExtinctionPerM)` |
| `deriveCloudTop(partial, current)` | sets `partial.cloudTopM` to `cloudBaseM` + the current layer depth when `partial` has a base and no top |
| `windsAloftOf(w)` | the manual wind-aloft table when `isAloftTable` accepts it (returned as stored; `[]` included); otherwise undefined (derived) |
| `isAloftTable(a)` | the table check of `windsAloftOf` and `sanitizeExtras` |
| `parseAloftParams(values)` | the table of the `aloft=` URL values (sorted; an entry out of range or malformed is left out, not clamped; a repeated altitude keeps its first entry; the lowest 12 kept), `[]` for `none` alone, undefined when nothing usable or when `none` is combined with levels |
| `mountainWavesOf(w)` | the gain clamped to 0..1; 1 when absent or not finite |
| `sanitizeExtras(w)` | deletes each new key whose value fails its type check; keeps values of the right type unclamped |
| `NEUTRAL_EXTRAS` | frozen object with every new key at its "nothing there" value (below) |
| `WEATHER_EXTRA_KEYS` | the eleven new keys in declaration order |
| `CLOUD_TYPE_PROFILES` | per-type uniform inputs for the clouds module (below) |

`NEUTRAL_EXTRAS`: `cloudType 'auto'`, `midCover 0`, `midType 'altostratus'`, `midAltM 4500`, `precipType 'none'`,
`precipRateMmH 0`, `fogTopM 0`, `fogVisibilityM 200`, `storms undefined` (the cells are derived from the
conditions), `windsAloft undefined` (derived winds aloft), `mountainWaves 1`. Its `midAltM` is the fixed 4500 m, not
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
- `src/render/weather/index.ts`: `createWeatherEffects` (`beforeClouds`: the storm cells; `afterClouds`: the fog)
  and `createWeatherOverlays` (precipitation, then lightning), called by `Simulator` after the clouds effect is
  created and before `warmUpShaders()`; the Simulator adds the era effects, `beforeClouds`, the clouds, then
  `afterClouds`. Each factory receives `{ctx, renderer, clouds, post, weather}`.
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
- Convective activity and the drawn layer (`layerActivity`, `layerTowerExt`, `layerTypeBias`): the tower extension
  of the low layer goes from the type's `towerExt` toward the `towering` value (2.5) as the derived activity
  (`convectiveState`) rises, and the type bias of `CLOUD_TYPE_SHAPE` toward the `towering` value (0.6). At
  activity 0 (the default weather and every lesson) both keep the type's value. Measured (`tests/clouds/
  stormClearing.test.ts`, 2026-10-20): the Thunderstorm conditions with `cloudType 'auto'` give activity 0.236 and
  a layer top of 3982 m instead of 3620 m.
- Cumulus around the storm cells (`stormCoverage` and `stormSunTau` in `CLOUD_MODEL_GLSL`, uniforms
  `uStormClear`, `uStormAnvil`, `uStormGust`, `uStormBase`, `uStormClearCount`), over the selected cells with a
  core or anvil share above 0, with the geometry the storm effect draws (`cellGeometry.ts`, at `simTime`; R the
  drawn core radius `drawnCoreRadiusM`, 500..8000 m). The view march and the shadow map read the same uniforms.
  With no cell the count is 0 and every storm term is skipped (`if (uStormClearCount > 0)`). All constants are
  unconfirmed look values.
  - Clearing: the lateral coverage of the weather map is multiplied by 1 − Σ (core_i x smoothstep(`CLEAR_OUTER`
    3 R_i, `CLEAR_INNER` 1.5 R_i, r_i) + rain_i x `SUBSIDE_DEPTH` 0.4 x smoothstep(`SUBSIDE_OUTER` 6 R_i, 3 R_i,
    r_i)), at least 0 (core and rain the cell's shares). The local cumulus top is multiplied by 1 −
    `SUBSIDE_TOP_CUT` 0.6 x min(Σ rain_i x smoothstep(6 R_i, 3 R_i, r_i), 1).
  - Gust front: coverage up to rain_i x `GUST_COVER` 1.4 in a band from `GUST_INNER` 2.5 to `GUST_OUTER` 3.5 R_i
    (peak at `GUST_PEAK` 3 R_i) around the downdraft centre (`convection.ts` `downdraftCentreAt`, 0.6 R toward the
    cell's motion), `GUST_BACK` 0.25 of it on the side away from the motion, top at `GUST_TOP` 0.5 of the nominal
    layer depth; coverage above 1 fills the band's core. Where it exceeds the cumulus coverage it replaces it, and
    the local top moves toward its top. With 0.75 and 0.3 (measured with the density slice, `renderDensitySlice`,
    2026-10-20) the band held cloud only 250 m deep over 1.5 km of its width and was not visible from 7000 m.
  - Shadows: the direct sunlight on each cumulus sample is multiplied by exp(−tau) of the cells' core columns and
    anvils toward the sun (`STORM_SHADOW_GLSL`, biweight columns); the sky light by 4 / (4 + 0.45 tau_v), and the light's diffuse
    transmission (2 + 3 mu0) / (4 + 0.45 tau_v) − exp(−tau_v / mu0) is added, tau_v the cells' optical depth
    straight above the sample (the mid-level sheet's slab). The shadow map multiplies by the cells' direct
    transmission from the cloud base toward the sun, so the ground under an anvil darkens.
  - Sky light at the camera (`SkySystem`, `stormShade.ts`): with the camera under a cell's core column or anvil,
    `ctx.sky.skyColor` is multiplied by 4 / (4 + 0.45 tau_v) and the light's diffuse transmission is added, tau_v
    the vertical optical depth above the camera (`stormOverheadTau`). 0 above the camera leaves it unchanged.
- `extendedLayerTopM(w)`: the low layer's top extended by `layerTowerExt`, the value of `uLayer.y`.
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
| `WindField.stormCells(north, east, t)` | the cells in effect at a point (`StormField.select`); `sample`, `stormTurbulence` and `moisture` use the same selection at their own point |
| `WindBreakdown.convective` | `{up, outN, outE}` from the cells; all 0 without cells |
| `SimEnvironment.moisture(altitudeMSL, north?, east?, time?)` (`environment.ts`) | `inCloud` also inside the fog layer, within 150 m of a mid sheet with cover 0.3 or more, and inside a cell core; dew point spread 0 below the base in rain or drizzle; in a storm cell's rain shaft the spread times 1 − smoothstep(0, 2 mm/h, storm rain rate) (`stormPrecip.ts`) |

Without cells at the sample point `WindField.sample` skips the convective branch, so its arithmetic is unchanged.
A derived cell's wind share (`ActiveStorm.wind`, its selection weight times its life cycle) multiplies its updraft,
downdraft, outflow and severity; `inCore` and `inStormCore` need a core share of at least `CORE_SHARE_MIN` 0.5. An
explicit cell has every share 1. The severity is passed
to the MIL-F-8785C intensities as max(`turbulence`, severity), clamped there at 1. The cockpit head motion
(`src/render/cameras/cockpitRig.ts`) uses the same maximum. The physics clamps a cell's radius, top and intensity
with `cellRadiusM`, `cellTopM` and `cellIntensity`.

## Winds aloft and terrain effects on the wind

Owner decisions: the behaviour below is the default; winds aloft are derived and can be overridden by manual
levels; they exist over a calm surface; `windsAloft: []` and `mountainWaves: 0` turn them off (the calm-air test
rigs set both); schema 5 snapshots are read with the derived winds; the wave grid is 256 x 256 at 500 m.
Constants marked unconfirmed are tuning values or values from literature not checked against a source.

### Free-atmosphere wind (`src/physics/weather/windsAloft.ts`)

- `G0`, the gradient wind: the 10 m wind times `gradientWindFactor` (1.638), veered 25 deg.
- `F(z) = G0 + T Phi(z)`, z in m MSL. `Phi` is 0 up to `PROFILE_BASE_M` (field elevation + 600 m = 720 m), ramps in
  quadratically over 300 m, grows linearly to the jet at 10500 m (the shear falls from 1 to -0.6 between 9000 and
  11400 m), then falls at -0.6 until it is 0.35 of its jet value (20.6 km) and stays there. Unconfirmed shape.
- `T` = baroclinic part toward the east, `q g Gamma_y / (f T_m)`, f = 1.058e-4 1/s at 46.5 deg, T_m = 255 K,
  `Gamma_y = 5.5e-6 + 2.5e-6 cos(2 pi (day - 15) / 365)` K/m (unconfirmed), activity factor
  `q = 0.6 + 0.8 |G0| / (|G0| + 8 m/s)` (unconfirmed; 0.6 in calm air), plus a barotropic part `G0 / 8000 m`
  (unconfirmed). Thermal-wind shear before q: 1.09e-3 1/s on day 196, 2.91e-3 1/s on day 15
  (`tests/weather/windsAloft.test.ts`).
- Manual levels: the (north, east) difference between each level and the derived wind at its altitude is
  interpolated linearly in height, from 0 at `PROFILE_BASE_M`, constant above the top level; levels at or below
  `PROFILE_BASE_M` + 100 m are ignored. Each level is reproduced exactly; opposite directions at two levels pass
  through a speed near 0 between them.
- `windAloftAt(w, z, out)` and `derivedWindAloftAt` are the shared accessors (menu, clouds, storms, training).
- Level temperatures: with any `tempC`, `temperatureProfileOf(w)` gives the atmosphere model a profile (nodes at
  the field elevation with `isaDeviation` and at each level with a temperature, linear in geopotential altitude
  between nodes, constant outside, closed-form hydrostatic pressure per segment, `src/physics/atmosphere.ts`).
  Without temperatures the uniform-deviation code path runs unchanged.

Derived tables (free wind `F`, direction FROM / kt; the 0 ft column is `G0`; the 10 m wind is the setting), from
`tests/weather/windsAloft.test.ts`:

| Weather | 0 | 3000 | 6000 | 9000 | 12000 | 18000 | 24000 | 30000 | 34000 | 39000 ft |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| default (100/6, day 172) | 125/9.8 | 125/9.8 | 132/9.4 | 139/9.2 | 146/9.1 | 161/9.4 | 174/10.2 | 184/11.5 | 187/12.0 | 184/11.5 |
| default, day 15 | 125/9.8 | 126/9.6 | 147/7.5 | 178/7.0 | 205/8.4 | 231/14.2 | 241/21.2 | 246/28.6 | 247/31.0 | 246/28.8 |
| calm, day 196 | 0 | 270/0.1 | 270/1.2 | 270/2.4 | 270/3.5 | 270/5.9 | 270/8.2 | 270/10.5 | 270/11.3 | 270/10.6 |
| calm, day 15 | 0 | 270/0.2 | 270/3.3 | 270/6.4 | 270/9.5 | 270/15.7 | 270/21.9 | 270/28.0 | 270/30.1 | 270/28.2 |
| 270/15, day 172 | 295/24.6 | 295/24.9 | 293/29.7 | 292/34.6 | 291/39.5 | 289/49.4 | 288/59.3 | 288/69.2 | 288/72.5 | 288/69.5 |

### Boundary layer under the winds aloft (`src/physics/weather/windField.ts`)

- Mean wind = the boundary-layer wind of the setting (`u10 windSpeedFactor(agl)` from `dir + windVeer(agl)`) plus
  `s R(-beta) (F(z) - G0)`, `s = windSpeedFactor(agl) / gradientWindFactor`, `beta = 25 deg - windVeer(agl)`, z the
  MSL altitude. Below `PROFILE_BASE_M` and with `windsAloft: []` nothing is added (the arithmetic of the field before
  the winds aloft). The 10 m wind at every airfield (66..366 m) equals the setting.
- Mechanical turbulence uses the equivalent 10 m wind `|F(z)| / gradientWindFactor` above the base.
- Over a synthetic 2000 m ridge, 12 kt westerly, day 15: at 3000 m MSL 36.4 kt over the ridge, 36.7 kt over the
  plain; at 100 m above the ridge 24.8 kt, where the log law of the setting alone gives 16.5 kt.

### Mountain waves (`src/physics/weather/orography/`)

- Tiles (`tiles.ts`): centres every 64 km (the airport at a centre); each solves on 256 x 256 points at 500 m (a
  periodic 128 km domain); weight `1 - smootherstep(16 km, 48 km, |d|)` per axis, so the weights of overlapping
  tiles sum to 1 (largest error 1.6e-15 over 20000 random points) and at most four tiles overlap.
- Terrain per tile (`terrainGrid.ts`, wind-independent, cached): heights from `EnvironmentOptions.orographyTerrain`
  (default `terrain.height`; the world passes `terrainHeight`, which the worker samples too), mean, relief after the
  least-squares plane, envelope (highest terrain within 6 km, 3 km box), channelling tensor from the Hessian of the
  3 km box-smoothed terrain. A tile with relief under 1 m has no waves and no channelling.
- Background (`tileSolve.ts`): layers bounded by the tile mean and 1500, 3000, 4500, 6500, 9000, 11000, 14000 m
  (bounds within 300 m of the mean dropped), each with `F` and `N^2` (`stability.ts`, `N^2 = (g/T)(g/cp + dT/dz)`;
  ISA gives N = 0.0112 1/s at 5 km and 0.0210 1/s above 11 km) at its middle (top layer: 2000 m above its bottom).
- Blocked flow: `h_eff = max(h, envelope - U_low / N_low)` (critical Froude number 1, unconfirmed). On 1000 m
  corrugations 5 km apart the spread of `h_eff` is 1000 m at 40 and 20 kt, 788 m at 10 kt, 394 m at 5 kt.
- Solver (`linearWaves.ts`): per Fourier mode, `sigma = k U + l V - i nu` (nu 1.5e-4 1/s, unconfirmed),
  `m^2 = K^2 (N^2 / sigma^2 - 1)` with Im(m) > 0 (for nu = 0 and a propagating mode, sign(Re m) = sign(Re sigma)), a radiating top layer, eta and sigma^2 eta' continuous at the
  interfaces, critical levels (Re sigma changes sign or |Re sigma| < 0.5 m/s K) absorbing. Wavelengths under 1.5 km
  are removed. Fields w, u, v at 0, 150, 300, 500, 750, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 6000, 7500, 9000,
  10500, 12000, 14000 m above the tile mean, times sqrt(rho(mean) / rho(z)). Checked against analytic solutions in
  `tests/weather/linearWaves.test.ts` (Witch of Agnesi, non-hydrostatic wavelength, evanescent decay, two-layer
  trapped wave, energy flux, critical level).
- Lookup (`orographyField.ts`): terrain-following height `zeta = (z - mean) - (h_eff - mean) exp(-max(0, z - h_eff) / H_s)`,
  `H_s = max(1500 m, 1.2 max|h_eff - mean|)`; trilinear in the window; sum over the tiles with their weights.
- In `WindField`: the horizontal perturbation times `s(agl)` is added to the mean wind; the vertical speed is added
  times `1 - exp(-agl / 300 m)` (the fine-terrain lift `V . grad(h)` keeps its form and its 4 m/s clamp).
  Breaking: `b = -(u' . F) / |F|^2`; for b > 0 every perturbation times `tanh(b / 0.8) / (b / 0.8)`; w limited to
  `12 tanh(w / 12)`; turbulence severity `0.9 smoothstep(0.5, 1, b)` (all unconfirmed). Daytime convection scales the
  waves by `1 - 0.5 w* / 2.2` (unconfirmed).

### Near-surface terrain terms

- Lee shelter (`shelter.ts`): wake top `max over upwind d <= 10 km of h(x - d u) - 0.15 d` for the lowest layer's
  wind, speed factor `1 - 0.6 smoothstep(0, 1, (H_w - z) / max(50, 0.5 (H_w - h)))`; the same smoothstep adds to
  the mechanical-turbulence roughness factor. Behind a 600 m ridge at 3 km and 30 m AGL the factor is 0.4.
- Valley channelling (`channel.ts`): the wind loses `0.7 c_depth (a n n^T) V`, `c_depth` 1 at the floor of a valley
  deeper than 500 m and 0 at the envelope. An 800 m valley removes 3.49 m/s of a 5 m/s cross-valley component and
  none of the along-valley one.
- Slope winds (`slopeWind.ts`): along the fall line, `A min(1, |grad h| / 0.3) (agl / delta) exp(1 - agl / delta)
  (1 - smoothstep(5, 12, |F|))`; day `A = 3 m/s` times the sun and sky terms and the insolation of the slope,
  delta 60 m; night `A = -2 m/s (1 - cover)`, delta 25 m; gradient on a 200 m baseline. Over the world terrain
  (calm, clear, day 172) the largest slope wind is 3.0 m/s at 13:00 at 60 m AGL and 1.8 m/s at 02:00 at 25 m AGL.
- Reference sites (`sites.ts`): the horizontal terms are multiplied by `smoothstep(2 km, 5 km, distance)` for each
  airfield, so the mean wind at every airfield is the boundary-layer wind of the setting.
- `mountainWaves` multiplies all of these terms and the waves; 0 skips the module.
- `WindBreakdown` gains `wave` (the horizontal contribution and the vertical speed, m/s), `slope`, `shelter` (the
  speed factor) and `waveSeverity`.

### Solutions, worker and fades

- Node and tests: a missing solution is solved synchronously on first use (LRU of 8 solutions, 16 tile terrains).
- Cache keys: the terrain function, its terrain tag (`setTerrainTag`; for `terrainHeight` the era id and the world
  seed, `terrainGenerationTag` in `heightfield.ts`) and the tile; a field's wave key holds the tag too.
- Browser: `src/sim/weather/orographyPrefetch.ts` is registered for `terrainHeight` before the physics is built;
  one worker (`orographyWorker.ts`, set up with the terrain workers' era, seed and town site) solves one tile at a
  time from two queues: the tiles `get()` missed (any sampler), first, and the tiles with weight > 0 at the aircraft
  and 60 s and 180 s ahead, rebuilt every frame without touching the first queue. A tile the field holds is not
  queued. The source keeps 10 solutions, least recently used dropped first, and counts the solutions received
  (`version`); a field asks again for a missed tile only after that count changed. `__ready` waits for the tiles
  at the aircraft.
- A field keeps 12 tiles; past that it drops the least recently sampled tile that no sample read in the last 1 s
  (if every tile is in use it keeps them all).
- Fades: a solution that arrives after a miss ramps in over 3 s simulated; a tile dropped and found again without a
  miss keeps its ramp. After a change of the wind, the ISA deviation, the table or the terrain tag, the tiles on
  display fade out over 3 s from the weight each had, while the new ones fade in. A further change while that fade
  runs and part of the newer set is on display waits until the fade ends (at most 3 s). Two changes 1.5 s apart over
  the test hills: largest change of the wave vector per 0.01 s 0.0089 m/s against a largest difference of 3.93 m/s
  between the three settled fields (0.916 m/s before this rule, `tests/weather/orographyTime.test.ts`).
- The day of the year in the wave weather is frozen at a reset and at a weather edit: the date moving on at midnight
  with the clock running re-solves nothing (the free-atmosphere wind of the flight follows the date).
- A scenario reset (`WindField.reset`, also before `SimPhysics.hoverIntoWind`) takes the current weather's tiles in
  full; a sample more than 1 s earlier than the previous one is treated as a reset. The worker path reproduces the
  synchronous solution bit for bit (`tests/weather/orography.test.ts`).
- The airfield windsocks read `WindField.sampleHorizontal`: inside the reference-site mask (2 km of a field) it
  samples no tile, so the windsock leaves out the vertical wave and the wave-breaking turbulence severity there;
  elsewhere it equals `sample()`.
- Memory: a solution with waves holds 8,939,760 bytes (window 193 x 193, 18 levels x 3 fields and 6 terrain and
  shelter windows, float32). On the main thread the source keeps at most 10, a field 12 while no more than 12 tiles
  are sampled within 1 s, and a fading set at most as many as the field held. Under that condition at most 34
  distinct solutions (304 MB) are held when none is shared; the bound before the least-recently-used change was the
  same 34.
- Cost (node, this container, 2026-11-18, with a full test run in the background): 268-306 ms per 256 x 256 solve,
  468 ms to sample a tile's terrain; `env.wind` 13.6 us at 3000 m and 14.5 us at 100 m AGL in
  the four-tile corner at (32 km, 32 km), 10.5 us on flat terrain (the cost tests assert under 30 us).
- Consumers of the winds aloft: the storm steering wind (above; also the anvil offset of `cellGeometry.ts`), the
  cloud drift (`src/render/clouds/cloudModel.ts`: the low layer with `windAloftAt` at its mid-height, the mid-level
  sheet at `midAltM` with a 2-D offset in the world frame, the cirrus at 9000 m along its own axis; the factors 1.8,
  2.2 and 2.5 on the surface wind are gone) and the L20 nav log (`src/training/content/syllabus/route.ts`
  `cruiseWind`, `meanWindAt` at 3500 ft MSL and 2500 ft AGL on day 172: 124.9/14.5 kt, 123.9/14.5 kt before).
  The ATIS, the tower and the training weather line keep the surface wind; the HUD, the windsock, the flight model
  and the precipitation streaks read `env.wind`.
- Wave field for a 25 kt north-westerly, default stability, over 0..60 km north and +/-30 km east, at the altitude
  or 200 m above the ground where that is higher: largest w 6.4 /
  -7.1 m/s at 3000 m, 6.6 / -6.4 m/s at 5000 m, 5.3 / -4.8 m/s at 8000 m; at 4000 m along the wind through the range,
  7 maxima above 0.3 m/s spaced 12.7 km on average.

## Storm cells derived from the conditions (`src/physics/weather/stormField.ts`)

With `storms` absent, the storm cells come from a lattice of candidate sites, at a rate set by a convective
activity 0..1 derived from the other weather fields. There is no activity setting. Every constant named below is
an unconfirmed tuning value except the physical constants and the saturation vapour pressure fit.

### Activity (`convectiveState`)

activity = I x H x D x B x C x Y, each term 0..1:

| Term | Formula | Constants |
| --- | --- | --- |
| I instability | smoothstep(`CAPE_MIN`, `CAPE_FULL`, CAPE) | 300, 1500 J/kg |
| H heating | smoothstep(`HEAT_SUN_MIN`, `HEAT_SUN_FULL`, sLag), sLag = sine of the sun elevation at `timeOfDay` − `HEATING_LAG_H` on `dayOfYear` | 0.25, 0.7; 2 h |
| D depth | 1 for `towering`; otherwise smoothstep(`DEPTH_MIN_M`, `DEPTH_FULL_M`, (`cloudTopM` − `cloudBaseM`) x `towerExt` of the cloud type) | 2000, 4000 m |
| B moisture | 1 − smoothstep(`BASE_MOIST_M`, `BASE_DRY_M`, `cloudBaseM` − 120 m field elevation) | 800, 2000 m |
| C cover | smoothstep(`COVER_MIN`, `COVER_FULL`, `cloudCover`) | 0.05, 0.25 |
| Y cloud type | `TYPE_FACTOR`: towering 1, cumulus 0.8, stratus, stratocumulus and nimbostratus 0; auto 0.8 x (1 − smoothstep(0.6, 0.9, `cloudCover`)) | |

CAPE: a parcel starts at the field elevation at the air temperature plus `HEATING_MAX_K` 4 K x max(0, sLag), rises
at g / cp to `cloudBaseM` (read as the lifting condensation level, as `environment.ts` reads the base), then at the
saturated adiabatic lapse rate g (1 + Lv r / (Rd T)) / (cp + Lv² r ε / (Rd T²)), r from the Bolton (1980)
saturation vapour pressure, in `PARCEL_STEP_M` 200 m steps to `PARCEL_TOP_M` 16 km. The air is the simulator's
atmosphere (`physics/atmosphere.ts`: ISA with `isaDeviation` and `qnhHpa`, 6.5 K/km to 11 km geopotential,
isothermal above), whose fixed lapse rate is the only one the weather defines; its pressure is carried up
hydrostatically from the base. CAPE sums g (Tp − Te) / Te dz over the buoyant steps; the convective inhibition is
not used. The top of the highest buoyant step is the equilibrium level.

`WeatherSettings` has no humidity field. The cloud base is the only moisture input (term B and the parcel's
condensation level).

The term D reads the type's own `towerExt`, not the layer as deepened by the activity (`layerTowerExt`), so the
activity does not feed back into itself. From the pause menu (no cloud-top control, layer depth 1100 m) the
default weather with `towering`, ISA + 8 K, 15:00 and a 900 m base gives activity 1 (same test, 2026-10-20). Cover
term at cover 0.05, 0.1, 0.15, 0.2, 0.25, 0.3: 0, 0.156, 0.5, 0.844, 1, 1.

Activity by preset (`tests/weather/stormField.test.ts`, 2026-10-20):

| Weather | Activity | Terms at 0 |
| --- | --- | --- |
| `defaultWeather()` (09:30, day 172, ISA, cover 0.35 auto, base 1500 m, top 2600 m) | 0 | I (CAPE 0), D (drawn depth 1760 m) |
| Clear, Fair, Gusty crosswind | 0 | I, D; Clear also C |
| Overcast, Low IFR, Low stratus & drizzle, Rain, Snow | 0 | Y (auto at cover 0.95 to 1, stratus, nimbostratus) |
| Radiation fog | 0 | H, C |
| Thunderstorm (cover 0.3) | 1 | none (CAPE 2743 J/kg, equilibrium level 11 500 m) |
| Every lesson preset (`src/training/content/weatherPresets.ts`), built on the default or the Thunderstorm weather | 0 | D (layer depth 1100 or 1200 m with auto), and `storms` is the empty list |
| Fair cumulus of `defaultWeather()` at 15:00 and ISA + 10 K | 0 | D (CAPE 1069 J/kg) |

Activity of the Thunderstorm conditions with one field varied (same test):

| Field | Values | Activity |
| --- | --- | --- |
| `isaDeviation`, K | −15, −10, −5, −2, 0, 2, 4, 6, 8, 12 | 0, 0, 0, 0.02, 0.18, 0.55, 0.97, 1, 1, 1 |
| layer depth (cumulus), m | 600, 1000, 1400, 1800, 2200, 2600, 3000 | 0, 0, 0.03, 0.33, 0.68, 0.80, 0.80 |
| `cloudBaseM` (depth 1700 m), m | 600, 900, 1200, 1500, 1800, 2100 | 1, 1, 0.86, 0.08, 0, 0 |
| `timeOfDay`, h | 5, 7, 9, 10, 11, 12, 13 | 0, 0, 0.34, 0.84, 1, 1, 1 |
| `timeOfDay`, h | 15, 17, 18, 19, 20, 21, 23 | 1, 1, 0.84, 0.34, 0, 0, 0 |
| `dayOfYear` 355 at 15:00 | | 0.048 |
| `cloudType` at ISA | towering, cumulus, auto, stratus | 0.18, 0.043, 0.043, 0 |

### Sites and life cycle

- Lattice: sites every `SITE_SPACING_M` 15 km in world NED. Each site has a period of `PERIOD_MIN_S` 75 to
  `PERIOD_MAX_S` 105 min and a phase hashed from the site and the seed (`STORM_SEED` 1). Each period (generation)
  holds at most one cell, with a lifetime of `LIFE_MIN_S` 30 to `LIFE_MAX_S` 60 min, a birth time inside the
  period, a birth position jittered by up to `SITE_JITTER` 0.35 of the spacing on each axis, a core radius of
  `RADIUS_MIN_M` 1800 to `RADIUS_MAX_M` 4000 m, an intensity of `INTENSITY_MIN` 0.5 to 1 times (0.5 + 0.5
  activity), and a top share, all hashed from the site, the generation and the seed.
- Existence: e = clamp((`EXIST_MAX` 0.5 x a_b x r − u) / `EXIST_SOFT` 0.03, 0, 1), u hashed per generation.
  - a_b: the activity at the cell's birth time, from the weather with its clock set to the birth (the other fields
    as they are). `StormField` samples it every `BIRTH_GRID_S` 600 s of the weather clock, interpolates linearly,
    and recomputes the samples when a field other than the clock changes. The intensity and the top use a_b and
    the equilibrium level at the birth. A falling activity stops births; a cell already born keeps its existence,
    intensity and top. A change of the other fields changes a_b and fades cells in and out.
  - r: the regional factor (`regionFactor`), value noise on a square lattice of `REGION_SPACING_M` 30 km
    (smoothstep-weighted bilinear between hashed lattice values), `REGION_MIN` 0.5 to `REGION_MAX` 1.5, seeded
    from `STORM_SEED`, read at the site's lattice point. Every `StormField` with the same seed reads the same
    factor.
- Tops: base + (ceiling − base) x (0.6 + 0.4 a_b) x (0.8 + 0.2 u), ceiling = min(`TOP_CEILING_M` 14 000 m,
  equilibrium level at birth + `OVERSHOOT_M` 1000 m), at least base + `MIN_CELL_DEPTH_M` 3000 m. During growth the
  top is at least base + `MIN_GROWING_DEPTH_M` 2000 m, the render's floor (`cellGeometry`); the physics floors a
  derived cell's top at `DERIVED_TOP_MIN_M` 2000 m MSL (`cellTopM`, `ActiveStorm.derived`) and an explicit cell's
  at 6000 m, so the field and the drawn cell use the same top.
- Life cycle, a = age / lifetime. Growth to `GROWTH_END` 0.3: the top rises from 0.3 to 1 of its height above the
  base and the core radius from 0.6 to 1 of its value. Shares, all 0 at a = 0 and a = 1:
  core smoothstep(0, 0.1, a)(1 − smoothstep(0.7, 0.95, a)); anvil smoothstep(0.2, 0.4, a)(1 − smoothstep(0.85, 1, a));
  rain smoothstep(0.25, 0.4, a)(1 − smoothstep(0.7, 0.9, a)); lightning smoothstep(0.3, 0.4, a)(1 − smoothstep(0.65, 0.8, a));
  wind smoothstep(0.05, 0.3, a)(1 − smoothstep(0.75, 0.95, a)).
- Time base: T = ((`dayOfYear` − 1) x 24 + `timeOfDay`) x 3600 s. The simulation time is not used: a scenario
  reset (clock to 0) and a resume leave T unchanged. `clock=0` stops T, and the cells stand still. Editing the
  time of day or the date moves T. The date wraps from day 366 to 1, and T goes back a year.
- Drift: from the birth position with the steering wind (`stormSteering`): the free-atmosphere wind at
  `STEERING_ALT_M` 3000 m MSL (`windAloftAt`, "Winds aloft and terrain effects on the wind"). Before the winds
  aloft it was `windDirectionDeg` veered 24.95 deg at `windSpeedKt` x 1.8. A derived cell's
  `motionDeg` and `motionKt` carry it, so the physics and the render move the cell alike. The drift is not stored:
  a change of the wind settings moves each live cell by the change of velocity times its age.

### Selection (`StormField.select`)

At a reference point (render: the camera; physics: the sample point; `weatherLine`: the airport), of the live
cells within `FADE_END_M` 60 km, at most `MAX_STORMS` 6 by the score s = e x max(core, anvil) x (1 − d / 60 km).
Each gets weight = e x (1 − smoothstep(`FADE_START_M` 40 km, 60 km, d)) x clamp((s − sOut) / m, 0, 1), m =
clamp(sPrev − sOut, `RANK_MARGIN_MIN` 0.025, `RANK_MARGIN` 0.05), sOut the seventh-highest score and sPrev the
fifth-highest (each 0 when missing), and every share is multiplied by it. The rank term is 1 for every cell
scoring at least sPrev, so it dims only the sixth cell unless the fifth to seventh scores lie within 0.025. When a
cell leaves the six, its score equals sOut and its weight is 0; when two selected cells swap places their weights
are equal. The result is a function of the weather, the simulation
time and the point: it does not depend on the earlier calls. The live cells are cached within 10 km of the last
point and rebuilt when the weather clock moves more than `CLOCK_REUSE_S` 10 s from the clock they were built at,
or the activity inputs or the wind change. The cache holds every cell alive at some clock reading within 10 s of
its build clock, and the positions, sizes, tops and shares are evaluated at the current clock, so a reused cache
gives the same cells as a rebuild (`tests/weather/stormField.test.ts`, 2026-10-20: 1500 readings with clock steps
of -10 to +15 s and a 40 kt wind, 8988 cells, all fields equal).

Explicit `storms` (URL `cb=`, `__sim.setWeather`, tests) replace the derived cells with the listed ones, every
share 1. `cb=none` (an empty list) gives no cells. The pause menu's storm chips are "From conditions" (`storms`
undefined) and "No storms" (the empty list); a line under them gives the derived activity in percent, or the
number of placed cells when the weather holds an explicit list. The earlier placement chips (distant cell,
overhead cell, line of three) and `stormLayout` are removed.

Measured (`tests/weather/stormField.test.ts`, 4-CPU machine, 2026-10-20):

- Thunderstorm preset from 15:00 for 60 minutes, selection at the airport: a cell with a core share above 0.5
  within 40 km in 60 of 60 minutes, a cell with a lightning share above 0.5 within 40 km in 53; nearest centre
  4.8 km. Weather line: CB in 60 minutes, TS in 10.
- Regional factor over a 600 km square on a 5 km grid: 0.502 to 1.498; 16.6 % of the points below 0.8 and 22.6 %
  above 1.2; mean change 0.044 over 5 km and 0.204 over 30 km. Core share summed within 15 km of a site over
  15:00 to 16:00 on 24 days (calm, 5 min steps): 275.1 at the site with factor 1.49, 115.4 at the site with 0.52.
- Evening, 18:00 to 22:00 at 9 points: the activity is 0 from 20:06; 76 cell samples with a core share after
  that time; the last cell seen at 20:30. Each of the 98 cells kept the intensity of its first sighting.
- 1800 one-second clock steps against one 1800 s step: T differs by 7.5e-9 s; same cells.
- A reset of `SimPhysics` after 20 s: the cells and the convective updraft at a point (0.0035 m/s) are unchanged.
- 250 m/s for 2 h with the clock running: 210 changes of the selected set; the largest change of one cell's
  weight between samples 0.402 at 1 s steps and 0.040 at 0.1 s steps.
- Rank fade, 15:00 to 18:00 at 5 points 30 km apart, 900 selections: 4112 selected cells within 40 km, 3871 of
  them with a weight of at least 0.99; 27 selections had two or more cells within 40 km below 0.99.
- 60 m/s at 300 m for 20 min toward the nearest cell, 0.1 s steps: largest step of a convective wind component
  0.035 m/s, peak 10.45 m/s, 60 changes of the selected set.
- `StormCellEffect.updateCells` and `WindField.stormCells` at 90 points and times: the same cells, centres,
  shares and tops (540 cells compared, 27 of them growing with a top below 6000 m).
- `env.wind` with the Thunderstorm cells, the cost test run alone (2026-10-20, 3 runs each): 13.2 to 13.9 µs per
  call with the clock fixed and 13.7 to 14.2 µs with the clock advanced every 4 calls; before the clock tolerance
  (commit 9b13c5b, same machine) 13.7 to 14.4 µs and 24.9 to 32.2 µs. `StormField.select` with the clock advanced
  by 1/60 s every call: 3.4 to 7.6 µs per call, 44.4 to 54.2 µs before. The explicit four-cell test
  (`tests/weather/convection.test.ts`) 12.4 to 13.2 µs (16.0 µs in one run at 9b13c5b). The limit is 30 µs.

## Local precipitation and hail (`src/physics/weather/stormPrecip.ts`, `hail.ts`)

`localPrecipAt(w, cells, t, capeJkg, north, east, altM, out)` gives the precipitation at a point: the stratiform
fields (`precipOf`) plus the storm cells' rain and hail, with their extinction. Node-safe, no allocation. Without
cells it is `stratiformPrecip(w)`, the values the consumers read before it existed. Consumers: the precipitation
overlay at the camera, `sim/weather/aircraftWeather.ts` at the aircraft (the cells of the wind field's `StormField`; `ctx.weatherFx.precip`, read by the
airframe sound, and `ctx.weatherFx.hail`), `SimEnvironment.moisture`, `weatherLine`. The storm march draws the same
field (`STORM_PRECIP_GLSL`, the same integer hash and value noise), so the rain a camera enters is the rain seen from
outside. The cell geometry it reads (`physics/weather/cellGeometry.ts`, moved from `render/weather` and re-exported
there) is the drawn one.

- Rain (per cell, at the point moved upwind by the curtain's slant, `RAIN_SLANT` 0.25 m per m below the base along
  the anvil's offset): curtain noise cn (value noise at `RAIN_NOISE_M` 1100 and `RAIN_NOISE_FINE_M` 370 m) moves the
  shaft's edge by ± `SHAFT_RAGGED` 0.3 of its radius; the shaft profile smoothstep(shaftR, 0.3 shaftR) times
  0.65 + 0.35 cb (cb at `RAIN_BODY_NOISE_M` 620 m); virga at the rest of the core's footprint, fading out
  `STORM_VIRGA_DEPTH_M` 800 m x (0.5 + cn) below the base; rain inside the cloud up to 50 to 400 m above the base;
  a fade toward the ground of up to `RAIN_GROUND_FADE` 0.45 by `RAIN_FADE_DEPTH_M` 1500 m below the base; times the
  intensity and the rain share. Extinction: that density times `STORM_SHAFT_SIGMA` 0.004 1/m; the rate is the
  inverse of the rain extinction fit (`precipRateForExtinction`), at most `LOCAL_RATE_MAX_MMH` 200 mm/h. All
  unconfirmed look values.
- Hail: the largest stone D_max = 3 C_d rho_a w^2 / (4 g rho_h), the stone whose terminal velocity equals the
  updraft w at the growth level; w = max(the field's wMax, intensity x `HAIL_CAPE_UPDRAFT_SHARE` 0.55 x sqrt(2
  CAPE)), CAPE of the live weather (`StormField.convective`); C_d `HAIL_DRAG_COEFF` 0.6, rho_h `HAIL_DENSITY_KGM3`
  900 kg/m^3, rho_a 0.736 kg/m^3 (ISA at 5000 m); at most 150 mm. Fall speed v_t = sqrt(4 g D rho_h / (3 C_d
  rho_a)) at rho_a 1.1 kg/m^3: 9.4 m/s at 5 mm, 29.9 m/s at 50 mm. C_d, rho_h and the CAPE share are unconfirmed.
  Occurrence smoothstep(3, 8 mm, D_max); the cell's hail share is min(rain share, lightning share) times it.
  Sizes: a truncated exponential from 0.4 min(D_max, 12.5 mm) with scale 0.25 D_max (unconfirmed). Rate: up to
  `HAIL_RATE_FULL_MMH` 12 mm/h in the core out to `HAIL_SHAFT_EDGE` 1.35 shaft radii (beyond the heaviest rain),
  and `HAIL_ANVIL_SHARE` 0.15 of it under the anvil outside the core's footprint in patches. The anvil hail reaches
  the ground only within `HAIL_ANVIL_NEAR_R` 1.6 core radii of the core's centre (falling off from
  `HAIL_ANVIL_NEAR_IN_R` 1.2), so in a band just downwind of the core and the shaft edge; beyond that it falls as
  virga from the anvil's underside and is gone `HAIL_ANVIL_DEPTH_M` 2500 m below it (unconfirmed). All hail ends 0
  to 500 m below the anvil's underside (the top minus `STORM_ANVIL_DEPTH_M` 1500 m). The storm march draws the same
  field. Extinction 3 rho_w R / (v_t rho_h D) at the mean diameter. Measured
  (`tests/weather/stormPrecip.test.ts`, 2026-10-20): D_max 62 mm at intensity 1 and CAPE 2743 J/kg, 11 mm for an
  explicit cell of intensity 0.8 without CAPE, 2.4 mm at intensity 0.2 (no hail).
- Anvil hail by distance (same test, 2026-10-20; a cell 5 km north of the airport, R 3 km, intensity 0.9, default
  weather): 0 mm/h at the airport and on rings 5 to 10 km from the core at 150 and 900 m MSL, no warning level;
  up to 1.62 mm/h 3.3 to 4.3 km from the core. Before this limit the airport had 0.52 mm/h at 150 m and 0.54 mm/h
  at 900 m of 12.8 mm stones, level moderate. A cell of intensity 1 (wind from 250 deg at 10 kt): 0 mm/h under the
  far anvil 6 to 14 km east at 300 m, 0.21 mm/h at 8500 m.
- Continuity (same test): along straight paths through a cell (R 3 km, intensity 0.9) at 200, 500 and 850 m the
  rate changes by at most 0.50 mm/h per 5 m against a peak of 64 to 68 mm/h; a fixed point under a cell moving at
  20 kt, 0.47 mm/h per 0.5 s.
- Hail on the airframe (`sim/weather/hailExposure.ts`): relative speed sqrt(TAS^2 + v_t(D_max)^2) (level flight),
  the largest stone's kinetic energy, the energy flux 1/2 M v^3 and its time integral (the dose, reset with the
  clock). Levels while the rate is at least 0.05 mm/h: severe from 10 J per stone, 300 W/m^2 or 20 kJ/m^2;
  moderate from 1 J, 30 W/m^2 or 2 kJ/m^2; else light. The level rises at once and drops only when the values
  fall below `HAIL_DROP_SHARE` 0.7 of the held level's thresholds (`hailLevelHeld`). The HUD shows `HAIL LIGHT` /
  `MODERATE` / `SEVERE` and a toast "Hail: <level>" appears when the level rises, at most once per
  `HAIL_TOAST_MIN_S` 20 s unless to a level above the last toast's (`ui/hudCues.ts` `HailToasts`). With the rate
  swinging between 0.8 and 1.2 times 0.05 mm/h every 0.5 s for 2 min (`tests/weather/hailHazard.test.ts`,
  2026-10-20): 1 level change and 1 toast; without the hysteresis the level changes 240 times. All thresholds
  unconfirmed.
- Hail damage (`sim/weather/hailDamage.ts`, advanced by `SimPhysics` every `HAIL_DAMAGE_DT_S` 0.1 s of simulation
  time from its own storm selection at the aircraft): the size distribution at 8 quantiles, each stone's velocity
  relative to the airframe (the relative air from the TAS, angle of attack and sideslip plus its fall speed straight
  down in the air density at the aircraft, in body axes) and its normal speed into two surfaces, the leading edges (normal forward) and the windscreen
  (normal `WINDSCREEN_NORMAL_ELEV` 55 deg above the nose). Stone energy 1/2 m v_n^2; the dent dose sums the energy
  above `DENT_STONE_J` 1 J per stone on the leading edges, the crack dose the energy above `CRACK_STONE_J` 5 J on the
  windscreen, both per m^2. Levels 1 - exp(-dose / `DENT_DOSE_FULL_JM2` 1000 J/m^2) and 1 - exp(-dose /
  `CRACK_DOSE_FULL_JM2` 400 J/m^2), 0..1, growing only. Cracking impacts arrive at `WINDSCREEN_AREA_M2` 0.6 m^2
  times the flux of stones above 5 J; each places a crack (at most `MAX_CRACKS` 12) at a direction from the eye
  hashed from the clock and the crack's index. Helicopters also take a rotor dose: the main rotor's blade leading
  edges at `ROTOR_STATION` 0.75 of the radius, normal speed max(0, Omega r + TAS sin psi) at `ROTOR_AZIMUTHS` 8
  azimuths, averaged, with the same 1 J stone threshold, and a rotor level 1 - exp(-dose / 1000 J/m^2). No `Math.random`: two runs of the same flight give the same damage
  (`tests/weather/hailDamage.test.ts`). A scenario reset or a new flight sets it to 0; the resume snapshot carries
  it (schema 5, below). Every threshold, dose, the normal and the area are unconfirmed.
  - Measured (`tests/weather/hailDamage.test.ts`, 2026-10-20): a 6 mm stone at 60 m/s carries 0.18 J and does no
    damage. Dent rate at 55 m/s and 6 mm/h: 0, 2.5, 8.3, 18.6, 25.6 and 33.1 J/m^2/s for largest stones of 10, 15, 20,
    30, 40 and 60 mm. For 30 mm stones the dent rate is 0 parked, 0.06, 5.4, 25.4 and 69.1 J/m^2/s at 20, 40, 60 and
    80 m/s, and the windscreen rate 0 up to 40 m/s, 2.2 at 60 and 8.9 at 80 m/s. In SimPhysics with an explicit
    cell of intensity 1 over the aircraft in the Thunderstorm conditions: parked on the runway for 20 s, crack level
    0.067 with 4 cracks; on the downwind leg for 10 s, crack level 0.53, dent level 0.35, 7 cracks.
  - Aerodynamics (`physics/aero/hailDents.ts`, `AeroModel.setLeadingEdgeDamage`, set by the flight model's
    `setAirframeDamage` on its flight and trim models): the level is rounded to `DENT_LEVEL_STEP` 1/128, so the
    section constants are prepared again at most 128 times in a flight. At dent level L every lifting strip with a
    section of its own (the wing's, the tailplane's and the fin's) gets `DENT_CD0_FULL` 0.002 k L of profile drag and
    its break angles moved toward zero by `DENT_STALL_SHIFT_FULL` 2 deg x k L (not past 2 s1), with k the section's
    `dentFactor`: `DENT_LAMINAR_FACTOR` 1.5 on the Wortmann FX 63-137 (DA20), 1 on every other section (the PC-12's
    NASA LS(1)-0417 is not a laminar section; the PA-34's NACA 65(2)-415 is modelled without its laminar bucket,
    `sections.ts`). The nose gets a drag area `DENT_BODY_CDA_FULL` 0.02 m^2 x L along the relative wind. At L = 0
    none of this runs and the model is bit-identical (`tests/aero/hailDents.test.ts`; `FS_GOLDEN_EXACT=1` goldens
    unchanged). The four constants are values chosen for this model; the standard leading-edge roughness data of the
    NACA section reports could not be fetched to compare them with, and no data for hail dents were found:
    unconfirmed.
  - Measured at full damage (`tests/aero/hailDents.test.ts`, 2026-10-20; drag coefficient at 2 deg and 60 m/s;
    level speed at 65 % of rated power at 1500 m; stall speed from the trimmed CLmax, power off, maximum take-off
    mass, sea level, KTAS):

    | Type | CD | KTAS at 65 % power | CLmax | Stall speed, KTAS |
    | --- | --- | --- | --- | --- |
    | c172s | 0.0431 -> 0.0466 | 110.4 -> 106.1 | 1.514 -> 1.363 | 53.5 -> 56.3 |
    | c152 | 0.0416 -> 0.0453 | 95.9 -> 92.1 | 1.350 -> 1.200 | 47.9 -> 50.8 |
    | pa38 | 0.0626 -> 0.0663 | 94.3 -> 90.8 | 1.393 -> 1.250 | 53.3 -> 56.2 |
    | da20 | 0.0415 -> 0.0460 | 118.8 -> 112.3 | 1.537 -> 1.351 | 52.1 -> 55.6 |
    | pa34 | 0.0756 -> 0.0783 | 144.4 -> 139.4 | 1.431 -> 1.274 | 64.4 -> 68.3 |
    | c208 | 0.0433 -> 0.0466 | 148.0 -> 142.9 | 1.524 -> 1.356 | 74.5 -> 79.0 |
    | pc12 | 0.0480 -> 0.0510 | 219.6 -> 209.3 | 1.250 -> 1.104 | 94.3 -> 100.3 |

    The da42 is a placeholder with the C172S flight model (`src/aircraft/da42/index.ts`) and measures as the c172s.
  - Rotor (`physics/rotorcraft/rotor.ts` `bladeElements` dent, `Rotorcraft.setDamage`, set by `setAirframeDamage`'s
    second argument and rounded to 1/128): at rotor level L the blade sections of the main and the tail rotor get
    profile drag + `DENT_CD0_FULL` L and maxCl - liftSlope x `DENT_STALL_SHIFT_FULL` L. At L = 0 the arithmetic is
    the undamaged rotor's (`tests/rotorcraft/hailDents.test.ts`). Measured (same test, 2026-10-20): R22 blade speed
    159.0 m/s at 0.75 R; in 6 mm/h of hail with 20 mm largest stones the rotor dent rate is 475.1 J/m^2/s in the
    hover and 528.9 J/m^2/s at 40 m/s, and 5 s of hover take the rotor level to 0.907 with the airframe level at 0.
    Trimmed hover out of ground effect at maximum gross weight, sea level, full rotor damage: R22 127.1 -> 134.1 shaft
    hp (+5.5 %; rotor profile power 33.7 -> 39.7 hp), R44 226.0 -> 238.9 shaft hp (+5.7 %; profile power 62.2 -> 73.4
    hp); collective 0.522 and 0.503, unchanged to three decimals. Unconfirmed, as the constants it uses.
  - Windscreen in the cockpit view (`WindscreenOverlay.ts`): each crack is drawn where its direction from the eye
    meets the glazing (one ray cast when the crack first shows), over a radius of 0.05 + 0.13 x its size m, lit by
    the sky ambient and the direct sun, in cast acrylic: 4 to 8 radial cracks of lengths 0.25 to 1 times the radius
    at unequal angles, a crushed white centre of `CRACK_CORE_M` 3 mm (size 0) to 6 mm (size 1) and a whitened zone of
    2.5 times that radius. A crack larger than `RUNNER_SIZE` 0.6 sends 1 to 3 runners: 1 px lines from its centre at
    hashed angles, 0.3 to 0.8 m long (fading over their last 30 %), wandering sideways by 0.01 sin(9 s) + 0.004
    sin(31 s) m (s along the runner) with a 5 px halo of whitening 0.2; where the frame is nearer they end at it. A
    crack larger than `HOLE_SIZE` 0.85 is a hole of 0.3 times its radius (ragged by 12 % and 6 %), where the scene is
    shown without drops, film, snow or splashes, with a white chipped rim of up to 3 mm and 4 short rays. Above
    `SHATTER_LEVEL` 0.7 every crack's size is raised by up to 0.3 at level 1, so more cracks have runners and holes.
    Laminated glass (`GlazingDef.laminated`, set on the PC-12 only) also draws two broken arcs between the radial
    cracks; which types have laminated windscreens is unconfirmed.
  - Toasts (`ui/hudCues.ts` `HailDamageToasts`): "Windscreen cracked by hail" and "Airframe damaged by hail" when the
    crack level, or the larger of the dent and rotor levels, first reaches `HAIL_DAMAGE_TOAST_LEVEL` 0.05, "Windscreen
    shattered by hail" at 0.7, each once per flight. After a restore (`HailDamageState.restores` changes) the flags
    are set from the restored levels without a toast, so a resumed flight does not show them again.
- Airframe sound (`audio/mapping.ts` `hailNoise`, parameters `hail` and `hailSize` appended after `rain`): the rate
  over `HAIL_FULL_MMH` 6 mm/h times a size weight 0.35 to 1 over 5 to 40 mm times the rain's airspeed factor. The
  worklet voice (`hailSound`) draws impacts from its own noise source, rings each through a click band and a body
  band whose pitch falls from 2400 to 520 Hz with the size, and is silent at 0. Tuning values set by ear.

## Hail and snow on the ground (`src/render/weather/groundCover.ts`)

The state the hail-ground overlay draws (`HailGround.surfaces`, a `GroundCover`), advanced with the simulated time
between frames at the camera's ground point. Node-safe, no allocation per update. Two surface classes with the same
precipitation and air: soil (grass and every unpaved surface) and pavement (runway, taxiways and apron). Inputs: the
hail at the camera (`localPrecipAt`), the stratiform snow (`precipOf`, type `snow`; the storm rain is rain whatever
the temperature), the rest of the precipitation as rain, and the surface air temperature T_a under the camera
(`surfaceAirC`: ISA plus `isaDeviation` at `ctx.env.groundElevation`; no solar term, the code has none). Rates in
mm/h liquid equivalent give kg/m^2/s as rate / 3600.

- Skin temperature T_g per class, heat capacity C, conduction K from a deep ground at T_a + `deepWarmC`, exchange
  `AIR_H` 6 W/m^2/K with the air; it starts at the balance of the two, (K T_d + AIR_H T_a) / (K + AIR_H). Soil
  (`SOIL`): C 2000 J/m^2/K, K 4 W/m^2/K, deep 2 K over the air. Pavement (`PAVEMENT`): C 3500 J/m^2/K, K 14 W/m^2/K,
  deep 4 K over the air. Cooling: each kg of hail that melts on landing takes `L_FUSION` 334 kJ/kg plus `C_ICE` 2100
  J/kg/K from the stone's `HAIL_STONE_C` -2 deg C to 0 plus `C_WATER` 4186 J/kg/K up to T_g; a kg that lies takes the
  ice's warming to min(T_g, 0). Snow likewise, from min(T_a, 0); its frozen share on arrival is 1 - smoothstep(0.5, 3
  deg C, T_a) (`SNOW_WET_C0`, `SNOW_WET_C1`), the rest arrives as water at 0 deg C.
- Lying share s = 1 - smoothstep(0, `HAIL_SETTLE_C` 1 deg C, T_g) for hail and 1 - smoothstep(0, `SNOW_SETTLE_C` 0.3
  deg C, T_g) for snow (1 at or below 0 deg C). The lying ice and snow (kg/m^2) take `MELT_U` 1500 W/m^2/K x
  max(T_g, 0) from the skin and melt by their mass shares. Depth: ice at `ICE_DENSITY` 917 kg/m^3, snow at
  `SNOW_DENSITY` 100 kg/m^3. Visible cover: 1 - exp(-depth / `HAIL_COVER_MM` 0.5 mm) for hail, 1 - exp(-depth /
  `SNOW_COVER_MM` 8 mm) for snow, combined as 1 - (1 - hail)(1 - snow).
- Water (kg/m^2): melted hail and snow, the wet snow's water and the rain, at most `WET_HOLD_KGM2` 0.3 (the rest runs
  off), drying with `WET_DRY_S` 1800 s; `wetness` is water / 0.3. The overlay draws the wetness only while
  `frozenWet` is set (hail or snow has fallen since the surfaces were last dry), so rain alone draws nothing.
- Integration: explicit steps of at most `SUBSTEP_S` 0.1 s; a frame advances at most `MAX_ADVANCE_S` 60 s
  (`HailGroundOverlay.ts`). The state is kept while paused (no simulated time passes) and reset when the clock goes
  back (a scenario reset).
- Not modelled: the rain's heat, sunshine, evaporation, the insulation of a lying layer, compaction, the deep
  ground cooling. Unconfirmed: every constant except the latent and specific heats; the thermal constants were
  chosen so that the times match the owner's description (hail lies after one to two minutes of moderate to heavy
  hail; grass before pavement); none has been compared with measurements.
- Hail rates the storm cells give at 120 m (node, 2026-10-21): at most 9.14 mm/h (largest stone 51.6 mm) on a 250 m
  grid over 60 x 60 km under the Thunderstorm preset's derived cells at simulation time 0 (554 of 728 points with
  hail below 3 mm/h); 8.35 mm/h at the centre and 9.13 mm/h 500 m from it under an explicit cell of intensity 1
  (largest stone 62.3 mm).
- Measured (`tests/render/groundCover.test.ts`, 2026-10-21, 0.5 s steps; freezing is T_g at 0.5 deg C; the
  Thunderstorm preset gives T_a 22.2 deg C at the field):

  | case | soil: freezing, cover 0.2, cover 0.5 (s) | pavement: freezing, cover 0.2, cover 0.5 (s) |
  | --- | --- | --- |
  | hail 9.1 mm/h, T_a 22 | 53, 108.5, 223 | 125.5, 222, 419.5 |
  | hail 9.1 mm/h, T_a 15 | 36, 86, 189.5 | 81.5, 151.5, 294.5 |
  | hail 20 mm/h, T_a 22 | 22.5, 43.5, 87 | 45.5, 71, 122.5 |
  | hail 36.7 mm/h, T_a 22 | 12, 23, 45 | 23.5, 35, 59.5 |
  | hail 36.7 mm/h, T_a 10 | 6, 16.5, 38 | 12.5, 23.5, 46 |
  | hail 5 mm/h, T_a 22 | 111.5, 255, 551.5 | not in 1800 s |
  | hail 3 mm/h, T_a 10 | 85, 285.5, 698 | 323, 1540, not in 1800 s |

  No hail lies on either class in 1 h of 2 mm/h at 22 deg C, 1 mm/h at 15 deg C or 1 mm/h at 10 deg C; the
  pavement's wetness reaches 1. Melting after 180 s of 36.7 mm/h (cover under 0.05): at 22 deg C soil 2356 s,
  pavement 931 s (1.77 and 1.51 mm of ice at the stop); at 15 deg C 3546 s and 1414 s; at 10 deg C 5347 s and 2089 s.
  Snow, cover 0.5: 1.5 mm/h at 0.5 deg C soil 1487 s, pavement 2613 s; 2 mm/h at 1 deg C 1271 s and 2135 s; 5 mm/h at
  0 deg C 410 s and 475.5 s. Hail against snow at the same rate, soil cover 0.5: 5 mm/h at 1 deg C 243 s and
  474.5 s; 9.1 mm/h at 0.5 deg C 129.5 s and 226 s; 2 mm/h at 0 deg C 599 s and 1052 s. No snow lies in 1 h of 1
  mm/h at 3.2 deg C, 2 mm/h at 4 deg C or 0.5 mm/h at 3.5 deg C. Largest change in one 1/60 s frame while the hail
  rises to 36.7 mm/h over 10 s, falls until 240 s and stops (600 s in all): 0.020 K and cover 0.00033. Frames of
  1/60, 0.5 and 30 s give the pavement the same ice to 1e-3 kg/m^2 after 300 s of 20 mm/h and 600 s without.

## Training weather line

`weatherLine` (`src/training/content/weatherPresets.ts`) appends present-weather groups only when the fields are
present: `TS` (explicit cells: when a cell has lightning; derived cells, selected at the airport: when a cell with
a core or anvil share of at least 0.1 and a lightning share above 0 lies within `TS_RANGE_M` 18 520 m), `DZ`, `-RA` / `RA` / `+RA` (below 2.5 / 10 mm/h / above), `-SN` / `SN` /
`+SN` (below 1 / 2.5 mm/h / above), `GR` (largest stone 5 mm or more) or `GS` (smaller) when the storm cells' hail
(`hailAtField`: `localPrecipAt` at simulation time 0, 2 m above the field, at the airport and 3 km (`HAIL_NEAR_M`)
north, east, south and west of it) reaches `HAIL_REPORT_MMH` 0.05 mm/h, `FG` for a fog layer, and `CB` after the cloud group (explicit cells: when
any exist; derived cells: when a cell selected at the airport, so within 60 km, has a core or anvil share of at
least 0.1). Lesson weather is built on `withoutExtras`, which sets `storms` to the empty list, so a lesson has no
derived cells. The
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
- Storm cells: the cumulus behind storm cloud or rain is dimmed by one storm optical depth per cumulus pixel (at
  the cumulus front, from a two-point model of the storm's depth along the ray), and is still drawn over the storm's
  in-scatter in front of it; the shadow columns are cylinders and
  discs, not the drawn density; the rain shaft casts no shadow; the moon does not light a cell; the temporal pass
  reprojects cell pixels with the depth buffer or the cumulus layer, whose front is the storm's clip distance where
  no cumulus lies in front of it.
- Storm cell ranges: render (`cellGeometry`: radius 500..8000 m, top at least base + 2000 m), physics
  (`cellRadiusM`, `cellTopM`) and the lightning scheduler (radius only floored at 0) clamp out-of-range cells
  differently. `stormsOf` and `isStormCell` check types, not ranges.
- Derived cells: at most 6 cells are drawn, so a seventh cell within 60 km is not drawn. A cell's drift is
  recomputed from the current wind settings, so editing the wind moves the live cells. The anvil's downwind
  offset (`cellGeometry`) follows the steering wind (`stormSteering`), for an explicit cell too, whatever its
  `motionDeg`; its full offset (half the anvil radius) is reached at `ANVIL_FULL_DRIFT_KT` 36 kt.
- Cumulus and storm cells from the ground: towering cumulus within a few km of the camera can still hide a cell
  (visibility measurement below).
- Downdraft centre: the physics places it toward the cell's motion, and the gust front is centred on it; the drawn
  rain shaft is centred on the core.
- Hail damage: one rotor level for the main and the tail rotor (the dose is the main rotor's); the
  cracks are not drawn on the exterior model; one dent level for the whole airframe (no per-surface damage); stones
  striking the upper surfaces of a parked aircraft dent nothing (only the forward-facing leading edges are counted).
- Hail bounce: drawn on the ground only, not off the airframe's surfaces (the windscreen shows splashes); the pellets
  assume flat ground at the aircraft's ground height.
- Hail and snow on the ground: one state for the ground around the camera (the hail and air temperature at the
  camera's ground point apply out to 1500 m); two surface classes only (no difference between asphalt and
  concrete, or grass and bare soil); no hail or snow on the airframe, buildings or trees; the storm cells give at
  most about 9 mm/h of hail at the ground (measured in "Hail and snow on the ground"), at which the pavement's
  cover reaches 0.5 after 419.5 s at 22 deg C.
- Storm precipitation: the storm rain is reported as `rain` whatever the temperature (no snow or graupel aloft); the
  weather line reports no storm rain at the airport (only GR / GS); the hail extinction uses one mean diameter; the
  precipitation overlay draws storm rain and hail on the camera's grid, so the streak pattern does not follow the
  shaft's curtain noise inside a few metres.
- Storm march noise: on SwiftShader the temporal pass needs about 40 frames to converge (frames rendered in
  `dev/weather.html` at 640x360); a GPU frame rate has not been measured.
- Landing-light beam: no volumetric term in fog.
- Wet pavement: only the hail-ground overlay's darkening after hail or snow; rain alone draws no wet ground (its
  water is in `GroundCover`'s wetness, unused). The windscreen drops are drawn in the cockpit view only, not on the
  exterior glass.
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
- `npx vitest run` at commit 34193ab (storm cells re-anchored across clock resets, boot resume through
  `restoreWeather`, fog composite warm-up, precipitation `uTime` without a wrap), 2026-10-18: 327 files, 4280 tests
  passed, 13 failed, 318 skipped, in 1654 s on a 4-CPU machine. The 13 failures are in the list recorded at commit
  2223678: 11 time-outs and the 2 `c172Sim` golden records. `FS_GOLDEN_EXACT=1 npx vitest run tests/golden`: 51 of
  53 pass; the 2 failures are the same `c172Sim` records.
- Browser check at commit 34193ab, `index.html` on `quality=medium`, Chromium with SwiftShader at 960x540, chase and
  cockpit view, 2026-10-18: the default weather and `wx=fog`, `drizzle`, `rain`, `snow` and `thunderstorm` reached
  `__ready` in 184 to 215 s, with no console errors or warnings and an empty `__sim.errors` on every page.
  `dev/weather.html` at 640x360, `q=medium`, `tod=19.2`, `flash=1`, one cell 10 km north: one cloud-to-ground strike
  logged (3 strokes), no console errors or warnings.

## Integration checks (2026-10-19, derived storm cells)

- `npx tsc --noEmit`: no errors.
- `npx vitest run tests/weather tests/sim tests/render tests/sky tests/clouds tests/training/syllabus.test.ts
  tests/aircraft/contract.test.ts`: 50 files, 607 tests passed, 3 skipped. `tests/training/runner.test.ts tests/ui
  tests/audio`: 24 files, 263 passed.
- `FS_GOLDEN_EXACT=1 npx vitest run tests/golden`: 51 of 53 pass; the 2 failures are the `c172Sim` records
  `autoflight.runway` and `restore.cruise`, with output identical to the tree before this change.
- Browser check, Chromium with SwiftShader, 640x360, `quality=medium`: `dev/weather.html?wx=thunderstorm` reached
  `__ready` in 25 to 27 s, `index.html?wx=thunderstorm&scenario=cruise&cam=chase` in 127 s. No console errors or
  warnings and an empty `__sim.errors`. At 15:00 on day 196 the page selected four cells 17.1, 23.5, 29.5 and
  35.6 km from the camera at the airport (activity 1, CAPE 2743 J/kg). From 7000 m MSL, 8 km south of the airport,
  the nearest cell drew a core column and an anvil above the cumulus layer.

## Integration checks (2026-10-20, cumulus clearing, regional and birth activity)

- `npx tsc --noEmit`: no errors.
- `npx vitest run tests/weather tests/sim tests/render tests/sky tests/clouds tests/training/syllabus.test.ts
  tests/aircraft/contract.test.ts tests/ui`: 59 files, 677 tests passed, 3 skipped.
- `FS_GOLDEN_EXACT=1 npx vitest run tests/golden`: 51 of 53 pass; the 2 failures are the `c172Sim` records
  `autoflight.runway` and `restore.cruise`, with failure output identical to commit f10ece8.
- `npx vitest run` at commit 9bfaa92: 329 files, 4319 tests passed, 2 failed, 318 skipped, in 1113 s on a 4-CPU
  machine. The 2 failures are the `c172Sim` golden records. The 24 time-outs of the baseline list did not occur
  in this run.
- Browser check, Chromium with SwiftShader, 640x360, `quality=medium`, no console errors or warnings and no shader
  compile errors on any page below. `dev/weather.html` with `freeze=1`:
  - Default weather, camera 400 m AGL at the airport: 128 of 230 400 pixels differ from commit f10ece8, by at
    most 1 of 255. Two runs of the same tree differ by 221 pixels (this tree) and 29 776 pixels (f10ece8, at most
    13 of 255).
  - `wx=thunderstorm` at 15:00, camera 400 m AGL at the airport: six cells selected at 18.9, 22.5, 28.3, 28.4,
    34.0 and 34.3 km. Toward the cell 22.5 km west the tower and the anvil show above the cumulus. Toward the cell
    18.9 km east, cumulus within a few km of the camera fill the view and the cell is not visible. 10 km west of
    that cell the tower, the anvil and the rain shaft show with the cumulus cleared around the cell.
  - Same preset at 16:00: toward a cell 20.9 km north-north-east the tower and the anvil show above the cumulus,
    with a second anvil behind. At 16:40, toward a cell 14 km east, cumulus overhead fill the upper view and a
    grey base and rain shaft show under the cumulus base.
  - From 7000 m MSL, 8 km south of the airport: two cells with columns and anvils above the cumulus, and a ring
    without cumulus around the nearer cell.
  - Explicit cell `cb=4.59,16.458,11,0.8,3` from 400 m MSL at the airport: at `cover=0.15` and `cover=0.5` cumulus
    within a few km of the camera hide the cell; at 0.5 a grey rain shaft shows below the cumulus base. At
    `cover=0` (explicit cell 18.9 km east) the tower and the anvil are drawn in full.
- `index.html?wx=thunderstorm&scenario=runway&cam=cockpit`: `__ready` in 160 s, empty `__sim.errors`; the view
  along the runway (070) shows the cumulus layer and no cell.

## Integration checks (2026-10-20, storm lighting, order and cumulus terms)

- Storm march terms before the change (`dev/weather.html`, `wx=thunderstorm`, 15:00, `q=medium`, 640x360,
  SwiftShader; values read from the march target in scene units, one frame):
  - Camera 10 km west of the cell 18.9 km east of the airport, 400 m AGL: at the rain shaft 365 to 434 of 420 to 500
    from direct sun, 58 from ground bounce, 2 from the sky; the shaft's output equal to the background behind it
    within 0.87 to 1.13.
  - Camera at the airport toward the cell 22.5 km west: haze transmittance 0.38 to 0.40 in front of the base; the
    base's own radiance 165 against a pixel of 450.
- Visibility of the cells from the ground: cameras at 8 bearings 6 km from the airport, 400 m AGL, 15:00, each
  selected cell within 25 km with a core share above 0.5 (17 pairs). Per pair, 8 points on the cell's axis from
  the base + 300 m to 1500 m below the top; a point is visible where (1 − storm transmittance) x the cumulus
  transmittance in front of the storm exceeds 0.5 (before: the old composite's rule, cumulus front nearer than the
  storm front; after: the clipped cumulus march), a cell where half its points are. Before (commit a4b067e): 5 of
  17. After: 7 of 17. The lowest point (under the cumulus base) was visible in 16 and 17 of 17.
- Default weather, camera 400 m AGL at the airport, `freeze=1`: 292 of 230 400 pixels differ from commit a4b067e,
  by at most 1 of 255.
- No console errors or warnings and no shader compile errors on any page above.

## Integration checks (2026-10-20, cumulus noise for the cells, local precipitation, hail)

- `npx tsc --noEmit`: no errors.
- `npx vitest run tests/weather tests/sim tests/render tests/sky tests/clouds tests/audio tests/ui
  tests/aircraft/contract.test.ts tests/training/syllabus.test.ts`: 78 files, 867 passed, 3 skipped, 1 failed (a
  5 s time-out in `tests/sim/weatherPresets.test.ts`, which passes run alone).
- `FS_GOLDEN_EXACT=1 npx vitest run tests/golden`: 51 of 53 pass; the 2 failures are the `c172Sim` records
  `autoflight.runway` and `restore.cruise`.
- `npx vitest run` (with browser screenshot jobs running beside it): 4318 passed, 30 failed, 318 skipped, in
  2468 s. 23 of the failures are in the baseline list. The other 7 (time-outs in `s269Setup`, `firstMinuteTrace`,
  `weatherPresets`, two in `stormField`, one in `weather`, and the `env.wind` cost tests at 34.1 and 39.8 µs) pass
  when run alone with no browser running; `env.wind` then measures 11.8 µs with the clock fixed and 24.2 µs with the
  clock advanced every 4 calls (derived cells), 11.2 µs for the four explicit cells.
- Browser checks, Chromium with SwiftShader, 640x360, `quality=medium`, no console errors or warnings and no shader
  compile errors on any page below:
  - Default weather, `dev/weather.html`, camera 400 m AGL at the airport, `freeze=1`: 479 of 230 400 pixels differ
    from commit 9269cf4, by at most 1 of 255. Two runs of 9269cf4 differ by 1979 pixels (at most 1 of 255); two runs
    of this tree by 1491 pixels (at most 1 of 255) and, in one further run, by 24 570 pixels (at most 10 of 255).
  - Commit 9269cf4, same page, a cell 1.5 km north, camera 303 m MSL under a 420 m base: diagonal hatching over the
    murk, the pattern the owner's screenshots show.
  - Camera flown north through a cell (R 3 km, intensity 0.9, base 700 m) at 300 m MSL in 750 m steps, `mode=cockpit`
    (the march's near clip only): the precipitation at the camera rose 0, 15.6, 31.6, 49.9, 58.2 mm/h to the core and
    fell 54.4, 27.3, 7.0, 0 mm/h beyond it; no frame shows a straight edge or an arc of the shaft.
  - `index.html?scenario=cruise&cam=cockpit`, a cell of intensity 0.9 at the start of the cruise: within 25 s of
    simulated flight the C172 lost 500 m and broke up at 181 KCAS (the cells' downdraft and turbulence, physics
    unchanged); with intensity 0.6, 55 s and the same end. The exit and entry sequences were therefore taken with the
    simulation paused and the fixed camera moved 300 m per frame at 1250 m MSL (12 frames each, 3.3 km): the murk
    thins over frames 5 to 9 of the exit, the cumulus at the horizon appears without a cut edge, and no frame shows
    a straight edge or an arc. The HUD showed `HAIL MODERATE` with the aircraft in the core.
  - The storm march converges in about 40 frames on SwiftShader; shots taken after 16 to 20 frames still show the
    jitter's noise on lit lobes.

## Integration checks (2026-10-20, windscreen, hail on the ground, hail damage)

- `npx tsc --noEmit`: no errors.
- `npx vitest run tests/weather tests/ui tests/audio`: 32 files, 335 passed. `tests/sim tests/render`: 275 tests, 274
  passed; the failure, a 5 s time-out in `tests/sim/weatherPresets.test.ts`, passes run alone (19 of 19).
  `tests/aero tests/fdm tests/aircraft` (with a browser running beside it): 682 passed, 9 failed, all time-outs; run
  alone, `r44Setup`, `s269Exterior` and `s269Setup` pass, and the remaining `md500Exterior` (3), `r44Exterior` (1) and
  `importOrder` (2) time-outs are in the baseline list.
- `FS_GOLDEN_EXACT=1 npx vitest run tests/golden`: 51 of 53 pass; the 2 failures are the `c172Sim` records
  `autoflight.runway` (124 of 1044 values) and `restore.cruise` (444 of 817), the same counts and worst values as at
  commit c893d97; `c172Audio/script` 0 of 570 values differ.
- `npx vitest run`: 4695 tests, 4364 passed, 13 failed, 318 skipped, in 1603 s on a 4-CPU machine. The 13 failures are
  in the baseline list (time-outs and the 2 `c172Sim` golden records).
- Damage update cost (node, 20 000 updates, 2026-10-20): 0.7 µs per update in the default weather, 11.2 µs with the
  Thunderstorm conditions' derived cells and no hail at the point, 8.3 µs under an explicit cell with hail. One update
  runs every 0.1 s of simulation time (every 24 steps at 240 Hz), against about 120 to 150 µs per physics step.
- Browser checks, Chromium with SwiftShader, 640x360, `quality=medium`, `index.html`, no console errors or warnings and
  an empty `__sim.errors` on every page. SwiftShader advances `simTime` too slowly to let the glass wet or dry, so the
  water and snow states and the ground cover were set through `__sim.post` with the simulation paused; the hail at the
  aircraft, the cracks' placement and the pellets came from the running code. Screenshots in `shots/procedural6/`
  (not committed). In the default weather the precipitation, hail-ground and windscreen overlays reported no draw.
  - `dry-cockpit-parked.png`, `dry-cockpit-a2.png`: runway, default weather; the overlays reported no draw.
  - `rain-cockpit-parked.png`: 6 mm/h, wetness 0.75, parked: drops of 1 to 4 px on the windscreen and the left side
    window, the larger ones as rings with the scene inside, and short wet trails below some drops.
  - `rain-cockpit-cruise.png`: cruise at 112.9 KIAS, wetness 0.75: short streaks along the airflow (horizontal on the
    side window), fewer sitting drops, and the water film's blur over the windscreen.
  - `snow-cockpit-parked.png`: 2 mm/h, snow 0.85: white flakes 2 to 6 px across over the windscreen and side window.
  - `hail-cockpit-parked.png`: an explicit cell of intensity 1 over the aircraft in the Thunderstorm conditions: 8.8
    mm/h of hail at the aircraft, largest stone 62 mm, 1.43 strikes per m^2 and s on the glass; no splash is in the
    frame at that rate. `hail-splashes-cockpit.png`: the strike rate forced to 120 per m^2 and s: two white star
    splashes.
  - `cracks-low-cockpit.png`: crack level 0.15, 3 cracks: radial cracks, arcs and white centres; the toast
    "Windscreen cracked by hail". `cracks-severe-cockpit.png`: level 0.95, 12 cracks: a crazed, whitened area over
    the left half of the windscreen; the toast "Windscreen shattered by hail".
  - `hail-bounce-runway.png`: a fixed camera 1.6 m over the runway 10 m ahead of the aircraft, the simulation
    running under the cell: light pellets spread over the runway ahead. `hail-scatter-runway.png`,
    `hail-runway-chase.png`, `hail-runway-cockpit.png`: ground cover 0.6: the runway and the grass speckled white.
    In `hail-runway-cockpit.png` one crack from the running hail damage shows on the lower left glass.

## Integration checks (2026-10-21, acrylic cracks, rivulets, hail cover, rotor dents)

- `npx tsc --noEmit`: no errors.
- `npx vitest run tests/weather tests/render tests/ui tests/audio`: 47 files, 449 passed. `tests/sim`: 165 tests, 164
  passed; the failure, a 5 s time-out in `tests/sim/weatherPresets.test.ts`, passes run alone (19 of 19).
  `tests/aero tests/fdm`: 244 passed, 1 skipped.
- `FS_GOLDEN_EXACT=1 npx vitest run tests/golden`: 51 of 53 pass; the 2 failures are the `c172Sim` records
  `autoflight.runway` (124 of 1044 values) and `restore.cruise` (444 of 817), the same counts as at commit a3bebe1;
  `c172Audio/script` passes.
- `npx vitest run`: 4704 tests, 4374 passed, 12 failed, 318 skipped, in 1531 s on a 4-CPU machine. The 12 failures are
  in the baseline list (time-outs and the 2 `c172Sim` golden records).
- Browser checks, Chromium with SwiftShader, 640x360, `quality=medium`, `index.html`, no console errors or warnings and
  an empty `__sim.errors` on every page. As in the previous round, the water, snow and slush states, the ground
  cover and the cracks were set through `__sim.post` and `__sim.physics` with the simulation paused; the hail at the
  aircraft (8.8 mm/h, largest stone 62 mm, 1.42 strikes per m^2 and s from the fall part and 0.17 from the airspeed
  part, parked) came from the running code. Screenshots in `shots/procedural7/` (not committed):
  - `dry-cockpit-parked.png`: default weather; the precipitation, hail-ground and windscreen overlays reported no
    draw.
  - `rain-cockpit-parked.png`: 6 mm/h, wetness 0.75, parked: sitting drops and short wet trails as before.
  - `rain-cockpit-cruise.png`: 112.9 KIAS, wetness 0.75: thin dark wandering streams running up and outward on the
    windscreen (up-left left of the centre line, up-right right of it), small beads, the film's blur.
    `rain-cockpit-35kt.png`: the airflow share at 18 m/s TAS: sitting drops and streams together.
  - `snow-cockpit-parked.png`: snow 0.85: white flakes. `slush-cockpit-parked.png`: snow 0, slush 0.7: a broken white
    band a few px high along the windscreen's lower edge at the glareshield; none is visible on the left side window.
  - `hail-cockpit-parked.png`, `hail-splashes-cockpit.png` (strike rate forced to 120 per m^2 and s),
    `hail-wetspots-cockpit.png` (0.5 s later): small white splashes, then drops where the stones struck.
  - `cracks-low-cockpit.png`: level 0.15, 3 cracks of size 0.3 to 0.7: radial cracks of unequal lengths, one runner
    from the size-0.7 crack across the side window. `cracks-severe-cockpit.png`: level 0.95, 12 cracks: runners over
    most of the windscreen and the left side window, no crazed net. `crack-hole-cockpit.png`: a size-0.95 crack in
    rain at wetness 0.6: a ragged hole with a white rim and no drops inside it, short rays and runners.
  - `hail-runway-chase.png`, `hail-runway-cockpit.png`, `hail-scatter-runway.png` (fixed camera 1.6 m over the
    runway): ground cover 0.6: an even grey-white whitening of the runway and the stripes without per-pixel speckle;
    no single stones are resolved at 640x360 beyond about 2 m.
  - `r22-rain-cockpit.png`: R22, 6 mm/h, wetness 0.75, parked: drops over the bubble canopy.

## Integration checks (2026-10-21, ground temperature, lying hail and snow)

- `npx tsc --noEmit`: no errors.
- `npx vitest run tests/weather tests/render tests/sim tests/ui`: 44 files, 461 tests, 460 passed; the failure, a 5 s
  time-out in `tests/sim/weatherPresets.test.ts`, passes run alone (19 of 19). `tests/render` after the last shader
  change: 16 files, 125 passed.
- `FS_GOLDEN_EXACT=1 npx vitest run tests/golden`: 51 of 53 pass; the 2 failures are the `c172Sim` records
  `autoflight.runway` and `restore.cruise`.
- Browser checks, Chromium with SwiftShader, 640x360, `quality=medium`, `index.html?scenario=runway`, no console
  errors or warnings and an empty `__sim.errors` on every page. SwiftShader takes about 30 s per screenshot, so the
  simulation was paused and the ground state advanced through `__sim.post` (`HailGround.update` in 0.5 s steps) with
  the hail, its largest stone and the rain the overlay sampled at the camera and the surface air temperature it
  computed; to stop the hail the cell was moved 90 km north (`__sim.setWeather`). Screenshots in `shots/procedural8/`
  (not committed), chase and cockpit views:
  - `default-chase.png`: default weather; the hail-ground overlay reported no draw.
  - `cell-*`: the Thunderstorm preset with an explicit cell of intensity 1 over the airport (`cb=0,0,11,1`): 8.75
    mm/h of hail, largest stone 62.3 mm, 28.7 mm/h of storm rain, T_a 22.2 deg C. t0: green grass, dry runway,
    pellets. t30, t60: the grass and the runway darker (wetness 1), no cover (soil cover 0.012 at t60). t90, t120:
    the grass greyer in large patches (soil cover 0.12, 0.22), the runway wet. t180: the grass grey-white in patches
    (0.38), the runway wet with no visible cover (0.087). t600: the grass a continuous light grey (0.88), the runway
    grey with the threshold stripes faint (0.63). 5 min after the hail stops: the sky clears; the grass white
    (0.81), the runway wet and bare (0.023). 15 min: the grass white with lighter and darker patches (0.53), the
    runway wet (0.72).
  - `heavy40-*`: the same page with the hail rate forced to 36.7 mm/h (40 mm/h of ice). t30: the grass grey in
    patches (soil cover 0.31), the runway wet (0.12). t60: the grass light grey (0.64), the runway lighter between
    the stripes (0.50). t90 to t180: a continuous light grey layer over grass and runway (0.81 to 0.97 and 0.72 to
    0.95), the stripes and the centreline faint, the aircraft's shadow on it; the red runway-end lights seen at t0
    and t30 are not visible from t120. In the cockpit view at t180 single stones and their dark contact shadows
    show next to the fuselage. 5 min after: grass and runway still white (0.95, 0.87). 15 min after, under a clear
    sky: the grass white (0.89), the runway bare and wet (0.11).
  - `snow-*`: 1.5 mm/h of stratiform snow, nimbostratus at 600 m, `temp=-13.7` (T_a 0.52 deg C). t0: green grass.
    t300, t600: the grass grey-green in patches (soil cover 0.12, 0.24), the runway wet (pavement 0.05, 0.13).
    t1200: the grass light grey (0.43), the runway darker grey with white stripes (0.26). t1800, t2700: the grass
    lighter (0.57, 0.72) than the runway (0.37, 0.51) in the same frame; the runway edge and end lights stay bright.
    Cockpit views at t1200 and t2700: the grass left of the runway white, the runway grey with its stripes.
  - `probe-a-clear.png`, `probe-b-clear.png`: default weather with the state set directly (soil 1 kg/m^2 of hail
    and pavement 0.3 kg/m^2; soil 3 kg/m^2 of snow and pavement 0.5 kg/m^2): the grass white in sunlight, the runway
    partly covered with its stripes showing, the aircraft's shadow drawn on the layer.
