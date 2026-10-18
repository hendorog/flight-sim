# Weather fields, accessors and effect slots

This file covers the optional fields of `WeatherSettings` (`src/core/types.ts`) added for cloud types, a mid-level
sheet, precipitation, ground fog and cumulonimbus cells, the accessors that read them (`src/core/weatherFields.ts`),
and the render slots their effects use (`src/render/weather/`, `src/render/post/PostPipeline.ts`).

## Status

- The fields, accessors, the post-TAA overlay slot and the effect registry exist.
- The four effect factories (`createStormCellEffect`, `createFogEffect`, `createPrecipOverlay`,
  `createLightningOverlay`) are stubs that return `null`. No module reads the new fields yet.
- `defaultWeather()` is unchanged and sets none of the new fields.

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

`CLOUD_TYPE_PROFILES` (unconfirmed tuning values, not yet read by the clouds module):

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
  event in `SimEvents` are declared; the simulator and `src/dev/harness.ts` create `weatherFx` with every value 0.
  Nothing writes them yet.

## Recorded gaps

These are limits of the planned designs, recorded before the effects are written:

- Cloud cover is calibrated for `cloudType 'auto'` only. For the other types `cloudCover` has not been measured
  against the rendered cover (`CloudsEffect.measureCover` with `typeCover`).
- Mid-level sheet: drawn only when the camera is below `midAltM`; the camera-above case has no design.
- Ground fog: with the camera above the fog and a cloud between the camera and the fog, the fog's in-scatter is
  not dimmed by that cloud.
- Storm cells: the composite against the cumulus is an approximation from the cumulus front distance and
  transmittance; a cell casts no ground shadow; the sky light does not darken under an anvil.
- Landing-light beam: no volumetric term in fog.
