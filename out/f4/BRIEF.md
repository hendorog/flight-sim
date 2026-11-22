# Foundation stage 4: steep mountain slopes (threshold hillslopes) — before stage 3, owner's choice

Branch exp/foundation4, worktree ~/github/fs-exp/foundation4, from exp/foundation2-sealevel e9997ef
(stage 1 + stage 2 + the sea-level river fix). Nothing merges. Don't touch other worktrees.

## Read first
- out/tree/PLAN.md §3.2 ("threshold hillslopes"), §3.3 (consumers), §3.6 item 4.
- out/f2/REPORT.md (stage 2: model, keptHollows, orogen, gates, scripts, views) and out/f2s/REPORT.md (sea-level fix:
  markCourse, faultFit).
- ~/github/fs/out/landforms/validation.md (targets + how to re-run validate.py; read-only, another session owns it).

## The problem
The new wide mountain masses are smooth green domes (out/f2/shots/s42-river-hi-f2.png, s42-mtn-f2.png). Seed-42
box (centre N -44250 E 6250, 60 km, 20 m): slope p50 18.6°, 1 km relief 398 m. NZ ranges: slope peak 33-40°, p50
25-34°, p90 >= 40°, 1 km relief 400-650 m, valley b 0.9-1.2 for 1-100 km² catchments (V valleys).
Stage 2 named one cause: gully/detail amplitude comes from the noise (`amplitude = hillAmp + 3100 uplift`), so the
orogen's new mountains between the old belts carry hill-country fine relief.

## Key point: a slope limiter cannot steepen a dome
PLAN's "slope-limiter sweep at 33-37°" only lowers cells already steeper than that; on these massifs it does
nearly nothing. Steepness must come from INCISION by the sub-km channel network, with hillslopes rising from each
channel floor at about the threshold angle until they meet the ridge envelope (a threshold landscape: sharp ridges
between V valleys, relief set by valley spacing x tan(Sc)). You choose the construction (e.g. ground = min(envelope,
channel level + distance-to-channel x tan Sc) on the 250 m raster with sub-raster detail; or a local 250 m stream-
power pass; or amplitude from T's own relief plus incision) — justify the choice with numbers.

## Order of operations (avoid circularity)
Channels first, ground from them, then streams.ts traces what's there. streams.ts traces the 250 m raster over
`naturalHeightSmooth`; if you reshape that ground from a channel set, the traced streams must land in the valleys
the slopes were built from. Rivers (riverNetwork lines) and their floors stay as they are.

## Must not change
- River floors (`markCourse`, 9a318f9), fault falls (`faultFit`), kept lowland lakes and their held rims
  (`keptHollows`), the home-field cap under approach/climb-out/circuit and homeRecheck.
- Restrict the pass to the orogen's mountain mask (range uplift >= 0.3, stage 2's "own classes"), fading at its
  edge; hill country and plains unchanged (hill country target is separate: median 12-18°, relief 120-200 m — report
  it, don't chase it here).
- Seed 0 byte-identical; tests/era/presentGuard.test.ts passes without re-pinning; seed 7 golden boards may re-bake
  (seed 0's entry byte-equal).

## Compute once
Build any 250 m result in the model worker and cache it with the model (bump MODEL_VERSION), not at sample time.
Stage 1 already put mountain sample cost +0.45-0.85 µs over the old +0.3 µs line; report the sample-cost probe and
first/cached load times. Load time is not a hard constraint for the owner, but keep cached loads near stage 2's.

## Gates (seeds 1 / 42 / 777777 unless noted)
Hard:
- seed-42 validation box, validate.py at 20 m (same box/tool as validation.md so numbers line up): slope p50 >= 25°,
  a slope peak in 30-40°, p90 >= 38°; 1 km relief 400-650 m; valley b median <= 1.3 for 1-100 km². Also run one box
  on seeds 1 and 777777 inside the orogen.
- Closed pits > 10 m deep: per 100 km² no worse than stage 2 on the same box; aim <= 2 (NZ ~1). Sub-km reshaping
  doubled pits once before (A1b) — this is the gate most likely to fail.
- riverZero must not regress (0 / 2.9 / 2.0 km). Lakes stay 70 / 74 / 59 (±small). homeCheck ok on seeds 1, 2, 5, 7,
  42, 1234, 99991, 777777. No NaNs; edge steps no worse.
- Full suite: npx vitest run --no-file-parallelism tests/terrain tests/world tests/era tests/career (~11 min; re-run
  career "200 boards" with --testTimeout=120000 before calling a timeout a failure).
Report (not hard): water over ground > 10 m, river over dry bank, walls; streams km, stream sinks, unfed heads; tree
measures; Flint θ; rock/scree/snow cover share (steeper slopes shift rock weights through the shared slope inputs;
the CPU biome.ts and shader must still agree).

## Pictures
Re-shoot stage 2's views (out/f2/views.txt, shots.sh) as <view>-f4.png next to -f2, plus 3-4 cockpit-height views
(300-600 m above ground) inside mountain valleys on seeds 42 and 777777, and one high view of a whole massif. Each
with its fly-to URL (index.html?seed=..&camPos=..&camLook=..&scenario=runway&tod=10&ui=0&wx=clear&cover=0&clock=0).
Serve on port 5200 (never 5177/5178); stop it at the end.
Shot tool: V2_ROOT=<tree> node ~/github/fs-exp/streams3/out/verify3/shot.mjs "<url>" out.png --wait 7000 --timeout 180000
Note: dark hedge-wall shelterbelts in shots are a known old bug fixed on main; ignore them.

## Commits / deliverable
Logical commits on exp/foundation4; messages end "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>". No merge,
no push. Write files with shell heredocs if Write is refused.
out/f4/REPORT.md: short version first (what the owner will see), gate table stage 2 -> stage 4, method choice and why,
paths. Hand back concisely: owner decisions first, then gates, then paths.
