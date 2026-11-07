# Foundation stage 2: the wide orogen (+ lowland lakes back, snow line re-set)

Branch exp/foundation2, worktree ~/github/fs-exp/foundation2, from exp/foundation cbaeee4 (stage 1). Nothing merges.
Do NOT touch ~/github/fs-exp/foundation (stage 1's tree; keep it as the bisect base).

## Read first
- out/tree/PLAN.md (whole plan; stage 2 = §3.6 item 2, layout/envelope design earlier in the file, `widefull` spike)
- out/f1/REPORT.md, out/f1/INVENTORY.md, out/f1/after5/summary.md (stage 1: what changed, gates, scripts)
- out/brief/source-to-sea.md (owner's direction; NZ is only the teacher)
- ~/github/fs/out/landforms/validation.md and review-drainage-tree.md (targets; read-only, owned by another session)

## Owner decisions (2026-11-07/08)
- Load time is no concern (cache exists). Mountain lakes may be lost until the glacier stage.
- LOWLAND LAKES MUST STAY. Stage 1 lost every lake (0 on seeds 1/42/777777, from ~230-260). Bring back the
  hill-country and plain lakes in this stage.
- Go ahead with stage 2 on top of stage 1.

## Tasks
1. **Lowland lakes stand-in.** The old hollows no longer exist in T (seed 42's lake valley rose ~360 m), so "keep the
   hollows" is not enough. Suggested mechanism (yours to improve): select the noise ground's closed sinks that lie in
   hill/plain relief class (the layout's own classification as used in ssCalib, not a bare height cut; mountain-class
   sinks stay graded away), and treat each as a fixed internal base level in the steady-state iteration, like the sea:
   held at its noise-ground height (lake floor/spill), excluded from the priority flood, so the ground around grades
   toward it and riverNetwork/LakeMask find a real lake there. Lakes must sit in the drainage tree (inflow and outflow
   rivers where they had them). Restore the two test assertions stage 1 relaxed: tests/terrain/seededWorld.test.ts
   (> 3 lakes) and tests/career/landmarks.test.ts seed 7 (> 4 lake landmarks), with comments updated. Report lake and
   tarn counts by relief class vs today's world (pre-stage-1, cea3349) on 1/42/777777.
2. **Gradient floor check first, before the layout change.** Stage 1 rivers at 400-700 m run p50 1.5-2.7 % over 2 km
   (real foothill rivers 0.2-0.7 %). Find whether that sits on the gentlest-gradient floor (0.06 A^-0.45) or on U/K.
   If it is the floor, a wider orogen will not move it: re-examine the floor constant as an explicit sub-task.
3. **The wide orogen** (PLAN.md stage 2): uplift-rate envelope, gated per seed type, `widefull` iteration. Re-rolls
   the mountains of every seeded world. Pass gates on seeds 1, 42, 777777:
   - largest exit / mouth p50 >= 0.4; >= 45 km2 joins inside the ranges >= 40 %;
   - mountain distance to front p90 >= 15 km; Re of sea basins <= 0.65;
   - river gradient p50 over 2 km in the 200-400 and 400-700 m bands toward 0.2-1 % (report; aim, not hard gate);
   - lake count > 0 on all three, with lowland lakes roughly as common as today;
   - home siting succeeds (keep stage 1's approach/climb-out/circuit cap and homeRecheck on seeds 1, 7, 42, 1234, 99991, 777777);
   - coast and plains still present; no NaNs; domain-edge steps no worse than stage 1.
4. **Snow line / peak heights.** Stage 1 pushed p99 2465 -> 2995 m on the seed-42 box and summits became smooth white
   domes. Re-set peak heights and/or the snow line with the new layout: two places must match (shader snowLineBase()
   and CPU biome.ts; PLAN.md §3.5). Aim for snow on the highest summits and ridges, not whole massifs. Do not try to
   make hillslopes steep/sharp here: threshold hillslopes are stage 4 (the 1 km lattice can't give 33 degree slopes).
   Do report the validate-style slope/relief numbers so stage 4 has a baseline.

## Constraints
- Seed 0 byte-identical; never re-pin presentGuard (tests/era/presentGuard.test.ts must pass untouched).
- Seed 7 golden boards may re-bake; seed 0's entry must stay byte-equal.
- Never use ports 5177 or 5178 (owner's). Use 5198 for your vite server; stop it when done.
- Commit in logical commits on exp/foundation2; messages end with
  "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>". Don't merge anything anywhere; don't push.
- Write files with the shell (heredocs) if the Write tool is refused.
- Full suite: npx vitest run --no-file-parallelism tests/terrain tests/world tests/era tests/career (~11 min; career
  "200 boards" can time out under load, re-run with --testTimeout=120000 before calling it a failure).
- Probes: npx vitest run --config scripts/probes/vitest.config.ts scripts/probes/<name>.test.ts --silent=false

## Pictures
Re-shoot the same 10 views as stage 1 (out/f1/shots, same camPos/camLook from its .log files / scripts) so the
comparison chains: <view>-f2.png beside stage 1's before/after. The views may now show different ground; also add
2-4 new views that show the stage-2 result best (a big river leaving the ranges through one gorge, a Y confluence
inside the mountains, a lowland lake in the drainage, the snow line), each with its URL (index.html?seed=..&camPos=..
&camLook=..&scenario=runway&tod=10&ui=0&wx=clear&cover=0&clock=0) so the owner can fly there.
Shot tool: V2_ROOT=<tree> node ~/github/fs-exp/streams3/out/verify3/shot.mjs "<url>" out.png --wait 7000 --timeout 180000
(serve your tree on 5198 first; stage 1's scripts in out/f1 show how it was done).

## Deliverable
out/f2/REPORT.md: short version first (what the owner will see), gate table before (cea3349) / stage 1 / stage 2 on
1/42/777777, the gradient-floor finding, lake counts by class, snow line change, load time (first and cached),
sample cost, what is left for stage 3/4. Then hand back a concise summary with paths.
