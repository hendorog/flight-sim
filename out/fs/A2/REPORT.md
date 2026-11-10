# Round V A2: what makes the floor-edge bands, the pits and the floor height (probes only)

Branch `exp/round-v`, on A1 (`de23e20`). Nothing in the shipped path changes. Six build variants are switched by
temporary setters (`src/world/terrain/a2Probe.ts`), and only `scripts/probes/a2Attrib.test.ts` calls them. A3's commit
deletes the setters. Seeds 42 (sites, owner box, pits) and 1 / 42 / 777777 (the three 60 km landform boxes).

## 1. Verdict

| fault | the term at fault | evidence |
|---|---|---|
| **Floor-edge bands (> 40 degrees)** | **The slope pass at the held river core's edge.** Two pass terms make the band. The core's raster taper `blend`, the pass's weight falling from 1 to 0 over CORE_TAPER 250 m, makes 28-97 % of each band's drop (34-93 % of its steepest step). The pass's own ground `hs`, which stands 100-200 m over the model's flat floor just outside the core, makes −9 to 55 % (1-49 %). Together they make 78-102 % of each band's drop at all nine transects (67-111 % of the steepest step). | (b) no core held removes all twelve of (a)'s bands on the nine transects: the steepest step there falls from 40.7-53.3 to 19.7-36.5 degrees. But (b) makes one new band, at own3 1540-1689 m on the opposite wall (41.9 degrees). There the unheld pass's own slope makes 56 % and the network's second valley carve, fading out at its reach edge (valley term −77 → −40 m), 43 %. So once floors are not held, RN19 / HF12 can make a band where it meets the pass: A3 should expect to remove those rows, or the band family moves rather than goes. With the envelope lift at 0 as well (`a-lift0`, through the existing `setSlopeParams`) they are all gone too, at 3.8-28.2 degrees, and no floor moves. (d) markCourse off and (e) the second valley off leave every band within 0.4 degrees. In the owner box, > 40 degrees covers 3.28 km² in (a) and 1.63 km² in (b), against V0's 3.27. In the 300-700 m ring about the rivers (the core's taper) of the three 60 km boxes, it covers 38.8 / 42.6 / 36.3 km² in (a) and 7.5 / 8.3 / 7.2 km² in (b), against V0's 16.4 / 12.1 / 17.5. |
| **Seed-42 pits** | **The held core's taper.** 92 of A1's 108 pits deeper than 10 m (85 %), and 84 of the 93 new ones, have their centre on a fine node on the taper (0 < core < held). Their nearest river is 385 m away (p50). | Pits per 100 km²: V0 1.89; (a) 3.00; **(b) 0.22**; (c) 2.86; (c2) 3.44; (d) 3.25; (e) 3.19; (f) 3.44. Only (b) brings them down. |
| **Floor height** | **The slope pass's own ground on the floor, wherever the floor is not held.** In A1 the held floor is the model's own ground (pass weight m = 0 at all nine lowest points). Unheld, as in (b), the pass's `hs` stands +52 to +107 m over the model's floor at 7 of 9 transects. It builds that floor from its own base level and gradient. The envelope lift (`Gf + lift·L`, lift 100 m) is what lets it stand over the model's floor: with lift 0, the same unheld pass cuts 16-105 m under it (`b-lift0`). | Owner's cross-valley lows (V0 665 / 689 / 649 m): (a) 670 / 702 / 642; (b) 739 / 762 / 721, V4's 738 / 761 / 721 reproduced; (c2), (d), (e) within 2 m of (a). lowlift p50 against V0 over the three boxes: (a) −1.5 / −0.6 / −0.1 m; (b) **+35.7 / +41.0 / +43.4 m**, V4's +36 / +41 / +43 reproduced. |
| A1's own p90 lowlift rises (+54 / +65 / +87 m; > 50 m in 11 / 12 / 17 % of windows) | **Not settled.** | On seed 42, 80 % of these windows lie more than 1 km from any drawn line, V0's or A1's (rivers only: 97 / 97 / 96 % on the three seeds). The rises are matched by sinks (p10 −43 / −37 / −44 m). No variant (c)-(f) changes them: lowlift between (a) and (d) or (e) is 0 at p50 and within ±5 m at p10 / p90. (b), which removes every core, raises the lowest ground by more than 50 m over 41-43 % of windows (seeds 42 and 1), 68-72 % of them more than 1 km from any line. So the cores, as the pass's base levels, reach that far. The likely cause is that the pass re-graded to the cores' new places (A1 moved them onto the model's courses; V0's axes lay 389-468 m from those, p50), but no variant here isolates it. |

**The 1 km corner fix (owner question 5) is not implicated in the bands or the pits.**
- At the bands its own share is −4 to +6 % of each band, and −4 to +4 % of its steepest step.
- Taking it out of the drawn delta only (c) leaves seven of the nine bands, at 41.9-53.1 degrees. Not applying it at
  all (c2) leaves six, at 42.4-49.9 degrees. Both make new bands elsewhere on the transects (own1: 47.5 degrees in (c),
  50.0 in (c2)), and those are again blend + hs at the core's taper (section 3). In the 60 km boxes' taper ring, > 40 degrees covers 46.9 / 49.4 / 45.0 km² (c) and
  37.7 / 41.5 / 36.1 km² (c2), against (a)'s 38.8 / 42.6 / 36.3.
- Pits: 2.86 (c) and 3.44 (c2) against 3.00.
- The weakest bands go: own3 (43.1 degrees) and ext2 (40.7) in both (c) and (c2), and own2 (41.2) in (c2).
  - At own3 and ext2 the change is in the pass's input ground: in (c2) `hs` beside the floor stays at G instead of
    standing about 100 m over it.
  - At own2 the same taper stays in (c2), `hs` still 18-124 m over G, and the step only falls from 41.2 to 37.9
    degrees.
  - The corner term itself makes +2 %, −4 % and −1 % of those three steepest steps.
- The corner fix does hold diagonal floors down, but only because the carve's depth is worked out against the fixed
  lattice:
  - (c), with the carve against the fixed lattice and the delta without the fix: the lowest surface rises 90-207 m at
    the nine transects (189-207 m at five), and lowlift p50 is +75 / +80 / +70 m.
  - (c2), with the carve against the unfixed lattice: floors stay at the model's level (p50 +0.5 / +0.8 / +1.6 m), but
    p90 rises to +84 / +107 / +119 m (from +54 / +65 / +87), and lakes go 71 / 74 / 61 → 66 / 74 / 59.
  - That fits PLAN-V's "channels of 10-30 cells" gap. Not proven.

So A2 does not put the bands on the corner fix. Owner question 5 does not arise from A2, and A3 takes the plan's first
branch: **the held core's raster**. The line sources at the model's floor level, with the model's floor half-width
and no envelope lift over a fixed floor, are the fix. riverCore, courseHold and the taper go (HF5 / HS2). The second
diagnostic (`a-lift0`) shows what A3's "the envelope lift never raises it" must do on its own: with no lift the bands
go and the floors stay at the model's level. lift 0 everywhere is not a fix, though: it also flattens the ridges (the
owner box goes to 0.93 km² over 40 degrees, natural faces included).

## 2. Method

**Variants** (a2Probe.ts; every flag false is A1):

| | setter | what it switches |
|---|---|---|
| (a) | – | A1 as built (raster cores held) |
| (b) | `noCore` | heightfield.ts mountainSlopes: `riverCore` of no axes: nothing held, no taper (model-rivers' RIVER_CORE_HOLD = false, V4) |
| (c) | `cornerOff: 'delta'` | erosion.ts buildErosion: the drawn change from the cells before the corner fix. The lattice the drainage settles lakes on, the carve's surface and the valley depth keep the fix, and the routing never had it. |
| (c2) | `cornerOff: 'all'` | the corner-fix loop not run: the drawn lattice, its lakes and cuts, and the carve's surface too (extra row) |
| (d) | `noMarkCourse` | heightfield.ts buildWater: markCourse not called |
| (e) | `noValley` | riverNetwork.ts valleyInfluence = 1 m: RN19's reach and HF12's excess·t² gorge. The floodplain and the channel stay. Not 0, because carveNetwork divides by it. |
| (f) | (c) + (d) + (e) | |
| a-lift0, b-lift0 | (a) or (b) with `SLOPE_PARAMS={"lift":0,"crown":0}` (the existing setSlopeParams) | diagnostic: the slope pass's envelope |

**Inert at the defaults.** (a)'s three 60 km boxes and the owner box are byte-identical to A1's (`out/fs/VA1`), and its
owner transect matches `VA1/probes/trparts-owner.log` value for value. presentGuard passes 2/2, `tsc --noEmit` is
clean, and `tests/era` and `tests/fixtures` are untouched.

**Terms.** At each point, `debugA2` (heightfield.ts) splits the drawn ground into parts that sum to it exactly (the
probe's `check` column is 0.0 everywhere):

    drawn = coarseRaw + d + c − w·(coarseRaw − r)   [= gModel, the model's ground]
          + m·(hs − gModel)                        [the slope pass, by its weight m]
          + gullies and small relief + airfields / a stream's smoothing (pre) + the second valley + the channels

- `d` is split into the change without the corner fix (`dR`) and the corner fix's share (`corner`).
- `w` is split into the floor `f`, the valley fade `g` and markCourse's `k`.
- The core value `kr` and the held state are printed too.

Each 50 m step's change is split exactly, with mean weights m̄:
- (1−m̄) times each model part: `noise`, `dR`, `corner`, `carve` and `resid`;
- the pass's own slope `hs` = m̄·Δhs;
- the core taper `blend` = Δm·mean(hs − gModel);
- `gul`, `valley` and `chan` as they are.

A **band** is a run of steps over 40 degrees, together with the steps over 30 degrees on either side that fall the same
way. Each band shows each part's share of its whole drop, and of its steepest step.

**Sites** (transects across the valley, along the normal of the nearest A1 river at the site; ends in `out/fs/a2.sh`):
- windL (wind's left wall low, the grey face) and windR (wind's right-wall scoop). Ray-cast from the wind picture to
  -12309,-40675 and -11766,-41396.
- floor (floor's forest foot, -13580,-41719).
- V141 (the mid-wall cliff band, -21450,-26809; river line 99).
- ext1 and ext2 (the owner-box slope map's NW band at its NE end, -9400,-39050, and its SE band at its SW end,
  -14675,-43575).
- own1-3, the owner's three cross-valley transects (tr-owner-B).

Every site lies 425-483 m from its river, on the core's taper. Of the owner box's > 40-degree land that is new in A1
(1.57 km²), 1.21 km² lies 300-600 m from a river. More than 1.5 km out, as much went (0.33 km²) as came (0.30 km²).

## 3. Per-site tables

In each first table, the shares are of the band's drawn change, and of its steepest step. A positive share steepens the
band. `hs` + `blend` is the slope pass. In each second table, the steepest step within 150 m of (a)'s band is given per
variant (**bold** over 40 degrees), with the transect's lowest surface (ground or river water, as tr-owner reads it).
That column cannot see a band that moves. Each transect's steepest step anywhere, and every band per variant, are in
`A2/<v>/tr.log`. The bands a variant makes away from (a)'s, with their two largest parts:

| variant | transect | new band | steepest | largest parts |
|---|---|---|---|---|
| (b) | own3 | 1540-1689 m | 41.9 deg | hs 56 %, valley 43 % |
| (c) | windR | 1999-2149 m | 40.2 deg | blend 38 %, hs 31 % |
| (c) | own1 | 1010-1111 m | 47.5 deg | blend 51 %, hs 26 % |
| (c) | own2 | 1881-1980 m | 41.5 deg | hs 36 %, dR 29 % |
| (c2) | windL | 303-605 m | 41.0 deg | hs 94 %, gul 6 % |
| (c2) | own1 | 960-1162 m | 50.0 deg | blend 47 %, hs 35 % |
| (f) | windR, own1, own2 | as (c) | 40.1 / 47.3 / 41.2 deg | as (c) |

All of them are the slope pass again, and with the cores held they are the core's taper. The one exception is (b)'s
own3 band, where the second valley's carve meets the unheld pass (section 1).


#### Site windL

| (a) band | drawn change | mean / steepest slope | noise | dR | corner | carve | resid | hs | blend | gul | valley | chan |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2018-2220 m, band | +196 m | 44.1 / 52.4 deg | 3 % | 3 % | -1 % | 3 % | 0 % | 44 % | 41 % | 7 % | 1 % | 0 % |
| steepest step at 2119 m | | 52.4 deg | 3 % | 3 % | -1 % | 3 % | 0 % | 32 % | 48 % | 11 % | 1 % | 0 % |

| variant | steepest within 150 m of 2018-2220 m | lowest surface |
|---|---|---|
| (a) | **52.4 deg** | 719 m (+0) |
| (b) | 30.5 deg | 773 m (+54) |
| (c) | **51.5 deg** | 912 m (+193) |
| (c2) | **47.1 deg** | 719 m (+0) |
| (d) | **52.4 deg** | 719 m (+0) |
| (e) | **52.1 deg** | 719 m (+0) |
| (f) | **51.3 deg** | 912 m (+193) |
| (a-lift0) | 20.3 deg | 719 m (+0) |
| (b-lift0) | 22.0 deg | 673 m (-46) |

#### Site windR

| (a) band | drawn change | mean / steepest slope | noise | dR | corner | carve | resid | hs | blend | gul | valley | chan |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1100-1299 m, band | -198 m | 44.7 / 53.3 deg | 3 % | 3 % | -1 % | 3 % | 0 % | 41 % | 37 % | 13 % | 1 % | 0 % |
| steepest step at 1250 m | | 53.3 deg | 3 % | 3 % | -1 % | 3 % | 0 % | 31 % | 42 % | 19 % | 0 % | 0 % |

| variant | steepest within 150 m of 1100-1299 m | lowest surface |
|---|---|---|
| (a) | **53.3 deg** | 714 m (+0) |
| (b) | 31.5 deg | 770 m (+56) |
| (c) | **53.1 deg** | 911 m (+197) |
| (c2) | **49.0 deg** | 714 m (+0) |
| (d) | **53.3 deg** | 714 m (+0) |
| (e) | **53.1 deg** | 714 m (+0) |
| (f) | **53.0 deg** | 911 m (+197) |
| (a-lift0) | 20.4 deg | 714 m (+0) |
| (b-lift0) | 22.4 deg | 670 m (-44) |

#### Site floor

| (a) band | drawn change | mean / steepest slope | noise | dR | corner | carve | resid | hs | blend | gul | valley | chan |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 956-1308 m, band | -301 m | 40.5 / 53.0 deg | -3 % | 12 % | -2 % | 4 % | 0 % | 53 % | 28 % | 8 % | 1 % | 0 % |
| steepest step at 1258 m | | 53.0 deg | -5 % | 17 % | -2 % | 6 % | -1 % | 25 % | 42 % | 17 % | 1 % | 0 % |
| 2013-2114 m, band | +91 m | 42.0 / 43.0 deg | 13 % | -18 % | 6 % | 3 % | -1 % | 24 % | 65 % | 7 % | 1 % | 0 % |
| steepest step at 2114 m | | 43.0 deg | 9 % | -12 % | 4 % | 2 % | 0 % | 31 % | 77 % | -11 % | 0 % | 0 % |

| variant | steepest within 150 m of 956-1308 m | steepest within 150 m of 2013-2114 m | lowest surface |
|---|---|---|---|
| (a) | **53.0 deg** | **43.0 deg** | 661 m (+0) |
| (b) | 29.2 deg | 26.0 deg | 731 m (+70) |
| (c) | **52.1 deg** | **42.6 deg** | 782 m (+121) |
| (c2) | **49.9 deg** | **42.4 deg** | 660 m (-1) |
| (d) | **53.0 deg** | **43.0 deg** | 661 m (+0) |
| (e) | **52.9 deg** | **42.9 deg** | 661 m (+0) |
| (f) | **51.3 deg** | **42.4 deg** | 781 m (+120) |
| (a-lift0) | 28.2 deg | 3.8 deg | 661 m (+0) |
| (b-lift0) | 25.3 deg | 12.5 deg | 631 m (-30) |

#### Site V141

| (a) band | drawn change | mean / steepest slope | noise | dR | corner | carve | resid | hs | blend | gul | valley | chan |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1094-1293 m, band | -191 m | 43.9 / 51.7 deg | 1 % | 8 % | -2 % | 4 % | 0 % | 39 % | 46 % | 3 % | 1 % | 0 % |
| steepest step at 1243 m | | 51.7 deg | 1 % | 8 % | -1 % | 4 % | 0 % | 29 % | 55 % | 5 % | 1 % | 0 % |
| 1989-2187 m, band | +162 m | 39.2 / 44.0 deg | -1 % | 16 % | -2 % | 6 % | 0 % | 33 % | 45 % | 2 % | 1 % | 0 % |
| steepest step at 2088 m | | 44.0 deg | -1 % | 18 % | -2 % | 7 % | 0 % | 21 % | 52 % | 5 % | 1 % | 0 % |

| variant | steepest within 150 m of 1094-1293 m | steepest within 150 m of 1989-2187 m | lowest surface |
|---|---|---|---|
| (a) | **51.7 deg** | **44.0 deg** | 869 m (+0) |
| (b) | 36.5 deg | 19.7 deg | 867 m (-2) |
| (c) | **49.6 deg** | **46.2 deg** | 1058 m (+189) |
| (c2) | **49.2 deg** | **44.5 deg** | 869 m (+0) |
| (d) | **51.7 deg** | **44.0 deg** | 869 m (+0) |
| (e) | **51.5 deg** | **43.8 deg** | 869 m (+0) |
| (f) | **49.3 deg** | **45.9 deg** | 1058 m (+189) |
| (a-lift0) | 20.5 deg | 22.6 deg | 869 m (+0) |
| (b-lift0) | 34.0 deg | 32.1 deg | 766 m (-103) |

#### Site ext1

| (a) band | drawn change | mean / steepest slope | noise | dR | corner | carve | resid | hs | blend | gul | valley | chan |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1092-1291 m, band | -179 m | 42.0 / 50.4 deg | 10 % | 2 % | -3 % | 4 % | -1 % | 33 % | 52 % | 2 % | 1 % | 0 % |
| steepest step at 1241 m | | 50.4 deg | 9 % | 3 % | -3 % | 4 % | -1 % | 20 % | 58 % | 8 % | 1 % | 0 % |
| 2036-2234 m, band | +189 m | 43.5 / 51.1 deg | -7 % | 17 % | -1 % | 3 % | -1 % | 34 % | 47 % | 8 % | 1 % | 0 % |
| steepest step at 2135 m | | 51.1 deg | -7 % | 16 % | -1 % | 4 % | -1 % | 22 % | 55 % | 11 % | 1 % | 0 % |

| variant | steepest within 150 m of 1092-1291 m | steepest within 150 m of 2036-2234 m | lowest surface |
|---|---|---|---|
| (a) | **50.4 deg** | **51.1 deg** | 840 m (+0) |
| (b) | 26.1 deg | 25.0 deg | 860 m (+20) |
| (c) | **49.3 deg** | **48.8 deg** | 1032 m (+192) |
| (c2) | **49.9 deg** | **49.6 deg** | 840 m (+0) |
| (d) | **50.4 deg** | **51.1 deg** | 840 m (+0) |
| (e) | **50.2 deg** | **50.9 deg** | 840 m (+0) |
| (f) | **48.8 deg** | **48.3 deg** | 1032 m (+192) |
| (a-lift0) | 22.4 deg | 20.4 deg | 840 m (+0) |
| (b-lift0) | 27.8 deg | 27.4 deg | 760 m (-80) |

#### Site ext2

| (a) band | drawn change | mean / steepest slope | noise | dR | corner | carve | resid | hs | blend | gul | valley | chan |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2129-2228 m, band | +76 m | 37.5 / 40.7 deg | -14 % | 19 % | -4 % | 3 % | 1 % | -9 % | 97 % | 5 % | 1 % | 0 % |
| steepest step at 2179 m | | 40.7 deg | -16 % | 22 % | -4 % | 4 % | 1 % | 1 % | 93 % | -1 % | 1 % | 0 % |

| variant | steepest within 150 m of 2129-2228 m | lowest surface |
|---|---|---|
| (a) | **40.7 deg** | 606 m (+0) |
| (b) | 25.4 deg | 682 m (+76) |
| (c) | 22.8 deg | 696 m (+90) |
| (c2) | 19.8 deg | 606 m (+0) |
| (d) | **40.8 deg** | 606 m (+0) |
| (e) | **40.5 deg** | 606 m (+0) |
| (f) | 21.9 deg | 696 m (+90) |
| (a-lift0) | 5.5 deg | 606 m (+0) |
| (b-lift0) | 8.5 deg | 586 m (-20) |

#### Site own1

| (a) band | drawn change | mean / steepest slope | noise | dR | corner | carve | resid | hs | blend | gul | valley | chan |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1869-2121 m, band | +221 m | 41.2 / 48.0 deg | -5 % | 19 % | -2 % | 7 % | 0 % | 51 % | 28 % | 2 % | 1 % | 0 % |
| steepest step at 2020 m | | 48.0 deg | -3 % | 12 % | -1 % | 5 % | 0 % | 48 % | 34 % | 4 % | 1 % | 0 % |

| variant | steepest within 150 m of 1869-2121 m | lowest surface |
|---|---|---|
| (a) | **48.0 deg** | 670 m (+0) |
| (b) | 32.7 deg | 739 m (+69) |
| (c) | **41.9 deg** | 807 m (+137) |
| (c2) | **42.7 deg** | 670 m (+0) |
| (d) | **48.0 deg** | 670 m (+0) |
| (e) | **47.7 deg** | 670 m (+0) |
| (f) | **40.9 deg** | 806 m (+136) |
| (a-lift0) | 28.2 deg | 670 m (+0) |
| (b-lift0) | 24.0 deg | 639 m (-31) |

#### Site own2

| (a) band | drawn change | mean / steepest slope | noise | dR | corner | carve | resid | hs | blend | gul | valley | chan |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 940-1138 m, band | -149 m | 37.0 / 41.2 deg | 3 % | 2 % | -1 % | 2 % | 1 % | 55 % | 47 % | -10 % | 1 % | 0 % |
| steepest step at 1089 m | | 41.2 deg | 3 % | 2 % | -1 % | 3 % | 1 % | 49 % | 62 % | -19 % | 1 % | 0 % |

| variant | steepest within 150 m of 940-1138 m | lowest surface |
|---|---|---|
| (a) | **41.2 deg** | 702 m (+0) |
| (b) | 33.2 deg | 762 m (+60) |
| (c) | **42.0 deg** | 909 m (+207) |
| (c2) | 37.9 deg | 704 m (+2) |
| (d) | **41.2 deg** | 702 m (+0) |
| (e) | **40.9 deg** | 702 m (+0) |
| (f) | **41.7 deg** | 909 m (+207) |
| (a-lift0) | 16.7 deg | 702 m (+0) |
| (b-lift0) | 18.9 deg | 662 m (-40) |

#### Site own3

| (a) band | drawn change | mean / steepest slope | noise | dR | corner | carve | resid | hs | blend | gul | valley | chan |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 845-1043 m, band | -154 m | 37.7 / 43.1 deg | 11 % | -10 % | 5 % | -2 % | -2 % | 42 % | 56 % | 1 % | 1 % | 0 % |
| steepest step at 944 m | | 43.1 deg | 4 % | -4 % | 2 % | -1 % | -1 % | 42 % | 51 % | 6 % | 1 % | 0 % |

| variant | steepest within 150 m of 845-1043 m | lowest surface |
|---|---|---|
| (a) | **43.1 deg** | 642 m (+0) |
| (b) | 28.9 deg | 721 m (+79) |
| (c) | 19.7 deg | 745 m (+103) |
| (c2) | 10.3 deg | 643 m (+1) |
| (d) | **43.1 deg** | 642 m (+0) |
| (e) | **42.8 deg** | 642 m (+0) |
| (f) | 19.8 deg | 745 m (+103) |
| (a-lift0) | 12.9 deg | 642 m (+0) |
| (b-lift0) | 12.6 deg | 621 m (-21) |


### Floor point terms (lowest surface of each transect)

| transect | (a) gModel / pass | (b) gModel / pass (m = 1) | b-lift0 pass |
|---|---|---|---|
| windL | 726 / 0 | 726 / **+52** | −48 |
| windR | 720 / 0 | 720 / **+55** | −45 |
| floor | 666 / 0 | 666 / **+86** | −23 |
| V141 | 876 / 0 | 876 / −4 | −105 |
| ext1 | 848 / 0 | 848 / +18 | −82 |
| ext2 | 612 / 0 | 612 / **+80** | −19 |
| own1 | 677 / 0 | 677 / **+69** | −28 |
| own2 | 709 / 0 | 709 / **+59** | −41 |
| own3 | 649 / 0 | 649 / **+107** | −16 |

In (a) the floor is the model's ground, less the network's second valley (4-7 m). In (c) the model's ground itself
stands 190-207 m higher at six sites: gModel 916 / 914 / 1069 / 1050 / 878 / 916 m at windL / windR / V141 / ext1 / own1
/ own2.

## 4. Box measures by variant

| | V0 | (a) | (b) | (c) | (c2) | (d) | (e) | (f) |
|---|---|---|---|---|---|---|---|---|
| owner box > 35 / > 40 deg, km² (slopemap.py) | 7.50 / 3.27 | 7.12 / 3.28 | **4.17 / 1.63** | 6.97 / 3.16 | 8.81 / 3.69 | 7.12 / 3.29 | 7.08 / 3.24 | 6.93 / 3.12 |
| 60 km boxes > 40 deg, km² (s42 / s1 / s777777) | 654 / 553 / 623 | 642 / 535 / 609 | 605 / 483 / 544 | 581 / 474 / 553 | 689 / 549 / 637 | 643 / 532 / 612 | 641 / 534 / 593 | 581 / 474 / 532 |
| ... of it 300-700 m from a river (the taper ring) | 16.4 / 12.1 / 17.5 | 38.8 / 42.6 / 36.3 | **7.5 / 8.3 / 7.2** | 46.9 / 49.4 / 45.0 | 37.7 / 41.5 / 36.1 | 38.8 / 42.6 / 36.3 | 37.9 / 41.6 / 32.9 | 41.7 / 43.6 / 34.6 |
| ... of it within 300 m of a river | 7.7 / 10.9 / 7.8 | 0.1 / 0.1 / 0.6 | 9.3 / 9.7 / 3.3 | 0.4 / 0.4 / 1.3 | 0.1 / 0.0 / 2.4 | 0.1 / 0.1 / 0.7 | 0.1 / 0.1 / 1.1 | 7.7 / 6.9 / 7.4 |
| seed-42 pits > 10 m per 100 km² | 1.89 | 3.00 | **0.22** | 2.86 | 3.44 | 3.25 | 3.19 | 3.44 |
| ... centre on a taper / held / off-core node (A1's core) | 17 / 21 / 30 | **92** / 4 / 12 | 1 / 0 / 7 | 78 / 5 / 20 | 107 / 3 / 14 | 95 / 10 / 12 | 97 / 6 / 12 | 92 / 15 / 17 |
| lowlift p50 (2 km) against V0, m | – | −1.5 / −0.6 / −0.1 | **+35.7 / +41.0 / +43.4** | **+75.4 / +80.1 / +70.3** | +0.5 / +0.8 / +1.6 | −1.6 / −1.4 / −0.5 | −1.3 / −0.4 / 0.0 | **+75.3 / +82.7 / +71.2** |
| ... p90, m | – | +54 / +65 / +87 | +102 / +103 / +106 | +219 / +227 / +231 | +84 / +107 / +119 | +53 / +66 / +87 | +54 / +66 / +90 | +219 / +230 / +233 |
| ... rose > 50 m, share of windows | – | 11 / 12 / 17 % | 40 / 47 / 49 % | 63 / 62 / 61 % | 16 / 19 / 22 % | 11 / 12 / 17 % | 11 / 12 / 18 % | 62 / 63 / 62 % |
| owner's lows (V0 665 / 689 / 649), m | 665 / 689 / 649 | 670 / 702 / 642 | 739 / 762 / 721 | 807 / 909 / 745 | 670 / 704 / 643 | 670 / 702 / 642 | 670 / 702 / 642 | 806 / 909 / 745 |
| lakes (s1 / s42 / s777777) | 71 / 74 / 61 | 71 / 74 / 61 | 71 / 74 / 61 | 70 / 72 / 61 | 66 / 74 / 59 | 71 / 73 / 61 | 71 / 74 / 61 | 70 / 72 / 61 |

- pitnear3.py's broader classes (within 500 m) do not separate the causes: in A1, 91 % of pits lie within 500 m of a
  taper node, 81 % of a corner-lowered cell and 46 % of a V0 axis. The same holds for V0's own pits: 78 / 76 / 71 %.
  Cores, corner strips and old axes all lie along the same valleys. The node class above (the 250 m node nearest the
  pit's centre) and variant (b) are what separate them.
- (e) changes no floor level at any of the nine transects (lowest surface identical to (a)), so the river levels there
  did not move. It does draw a step at the floodplain's edge: the parallel lines along the floor in its slope map.
- (c) and (f) change lakes because the lake mask is flooded on the drawn ground. (c2) changes them because its first
  flood runs on the unfixed lattice. (d) loses one seed-42 lake; not chased.

## 5. Maps and pictures

- `maps/slope42-variants.png`: the owner-box slope map, orange over 35, red over 40 degrees, in eight panels: V0 / (a) /
  (b) / (c) on top, (c2) / (d) / (e) / (f) below.
  - Both ruler-straight red bands along the floor edges are in (a), (c), (c2), (d), (e) and (f).
  - Only (b) loses them. Its floor is also wider and smoother in the shading, and stands higher.
- `maps/lift0.png`: a-lift0 | b-lift0. No bands. Most of the natural steep faces are gone too.

Renders are on port 5280, one at a time, none with "preload timed out". A1 renders are `out/fs/shotsV/<view>-A1.png`
or `shots/<view>-A1.png`, variant renders `shots/<view>-<v>.png`, side by side in `shots/cmp/` (not committed). Each is
opened; one line per picture on what a pilot sees:
- **wind (a → b):** the pale bare scoop on the right wall and the grey face low on the left wall are gone. But the
  valley becomes a narrower forested V. The fields shrink to a strip on each side, and the near reach keeps its white
  flecks.
- **floor (a → b):** the dark bare face at the forest foot is gone, and the forest slope runs straight down to the
  river. The fields lie on the right bank only.
- **42-V141-wide (a → b):** the 1 km grey cliff band and its neighbour on the wall are gone. A smooth forested wall
  comes down to the river, with fields on the near side.
- **ext1 (a → b):** A1 shows a row of pale rock slabs about 2 km long along the wall, 200-300 m above the river. In (b)
  they are gone and the wall is smooth forest. The small field floor at the lower left is gone, and short straight side
  channels join the river from both sides like a comb.
- **ext2 (a → b):** A1 shows a broad field floor with the river and forested walls; the 40.7-degree band lies under
  forest and does not show. In (b) the field floor is much narrower, the river runs near the wall foot and the fields
  are strips.
- **ext2 (a → c2):** almost the same as A1: a broad field floor and the river, with a few more pale rock patches on
  the far right wall.
- **wind (a → c2):** as A1. The pale scoop on the right wall and the pale face on the far left wall are both still
  there.
- **42-valley-head (a → c2):** the main floor, fields and river are as A1, and the grey faces on both walls remain. The
  flat field strip with its side channel at the left becomes a forested slope.
- **ext1, first A1 render (camera at 1400 m, under the 1420 m ground):** inside the trees and not evidence. It is
  re-rendered from 1900 m; the bad frame is kept as `shots/ext1-A1-badcam.png`.

What (b) shows in pictures is PLAN-V 0.2's V4: the bands and faces go, but the floor narrows and rises, and fields are
lost. A3's line sources must keep (a)'s floor and lose (a)'s bands at once.

## 6. Rules, setters, files

- **Rule rows:** unchanged at 201. A2 adds probes and temporary setters only, and they are not rule rows. Delete them
  in A3: `a2Probe.ts`, its imports, the `A2.*` checks (erosion.ts buildErosion corner loop and change, heightfield.ts
  mountainSlopes / buildWater / carveNetwork), `a2Sample` (erosion.ts), `debugA2` (heightfield.ts) and riverNetwork.ts
  valleyInfluence's `A2.noValley`.
- **Probe:** `scripts/probes/a2Attrib.test.ts`. A2_VAR selects the variant, A2_TR the transects, A2_BOX the owner box,
  A2_EXPORT the boxes, A2_DUMP the corner and core nodes, and A2_RAY places picture features. The runner is
  `out/fs/a2.sh tr|box`.
- **Tools** (out/fs/tools2):
  - `perp.py`: a transect across the valley through a site;
  - `a2table.py`: the tables above;
  - `pitnear3.py`: pits by class and by the node class;
  - `steep.py` and `steepnear.py`: > 40 degrees in the boxes, by distance from a river;
  - `liftwhere.py`: where lowlift's > 50 m rises lie.
- **Logs:** `A2/<v>/tr.log` (every transect row with its parts) and `A2/<v>/box-s*.log` are in the tree but not
  committed, because `.gitignore` drops `*.log`; `tables.md` is their parse. `a/dump-s42.json` is committed. The exports
  (`A2/<v>/seed*.f32`, 36 MB each), the owner-box slope arrays (`A2/<v>/slope/`) and the renders are not committed.
- **Build time** (box runs, 7 at once under load): 10.2-14.1 s a seed-42 build. Single runs take 5.8-8.5 s. This is not
  a gate.

## 7. Open

1. A1's far-field lowlift rises (p90 +54 / +65 / +87 m) are not attributed (section 1). A3's lowlift gate (> 50 m
   rises in ≤ 5 % of windows) needs that cause found. The next probe is the slope pass's own receivers and levels by
   sub-basin, A1 against V0's cores.
2. (c2)'s rise in p90 lowlift and the 7 lakes it loses fit the plan's "diagonal channels of 10-30 cells have no
   course", but that is not shown.
3. The two bands that (c) and (c2) remove (own3, ext2) go through the pass's input ground, not through the corner term.
   Why the pass stands at G there in (c2) was not traced.
