# Bo 105 CB-4 exterior, hingeless head and cockpit

Package BX of the hingeless / rigid-rotor programme (plan revision 2, §6.3). The aircraft is the **MBB Bo 105 CB-4**
(two Allison 250-C20B, unstretched cabin): a rounded cabin pod with large glazing and chin windows, the upper deck
over the transmission and the two engines, a tapered boom, the stabiliser with endplates, the swept fin with the
**two-blade tail rotor on the LEFT at its top**, skid gear on two bending cross tubes, and the **four-blade HINGELESS
main rotor**. The pilot sits in the **right** seat (the certificated minimum-crew position, TCDS p11). Everything
else on this page (paint, furniture, hardware proportions, the single set of pilot controls) is an **agent choice**
or an ESTIMATE, tagged as such. Nothing here is an owner decision.

Tags: **P** primary (EASA TCDS EASA.R.011, MM ch 01, AGARD AR-280), **P5** the CB-5 flight manual used for the CB-4,
**D** derived (arithmetic shown), **3V** measured on FM Fig 1-1 or the photographs, **ESTIMATE** judged. Primary
geometry stays in `src/aircraft/bo105/dimensions.ts` (BO's contract); the cockpit layout is the integrator-frozen
`src/aircraft/bo105/panelLayout.ts`. Neither is edited by BX: changes go through PR text (below).

## Files

- `src/aircraft/bo105/visual.ts`: plain data (the livery worker loads it). The pod loft in stations and heights
  above the skid soles, the glazing and door outlines, the deck and boom-root fairings, the boom, the fin (the
  `dimensions.ts` outline, clipped to the fuselage end), the stabiliser and endplates, the tail skid (placed on the fin
  outline), seats, controls positions, lamps, livery (white with a generic dark blue cheat line, `D-HBOX`; not an
  operator's scheme), shadow, and the `rotorcraftVisual` block. `rotorcraft` is the physics `BO105_ROTORCRAFT` itself
  (consistency rule); `rotorcraftVisual.main.coning` is BO's `BO105_BLADE_CONING`, so the static droop follows BO.
- `exterior.ts`: `bo105ExteriorVisualClass`, injected in `AircraftVisual` (no import cycle). It hides the generic
  Robinson fittings and their static shadow, reads the **whole** rotorcraft state through `readRotorcraft`, and adds
  the parts below.
- `exteriorDetails.ts`: the deck fairing (transmission oil-cooler inlet, the engine air intakes and louvres, cowling
  seams and hinges), the mast and servo rods on the 3° shaft, the tapered boom with the **driveshaft fairing** on top
  and its root fairing, the swept fin with the **intermediate gearbox** at its base and the **tail-rotor gearbox on
  the left at its top**, the stabiliser at 0° with endplates, the tail skid, the skid gear (straight tubes with curled
  toes, the two arched cross tubes, saddles, wear shoes, belly fittings, a boarding step), the windscreen centre post
  and roof beam, the nose bow, A-posts and roof frame, door seals and handles, crew-door hinges, the **sliding-door
  rails**, the **aft clamshell doors'** edges, hinges and centre seam, the nose-compartment cover, pitot, antennas,
  landing-light window, fuel filler and beacon base.
- `exteriorRotor.ts`: `Bo105MainRotor` (the titanium hub star, four feathering-bearing housings with collars and
  flange bolts, the blade forks with their two bolts, pitch horns, the balance weights under the forks, pitch links,
  the swashplate and rotating scissors, and the **bending blade roots**) and `buildBo105TailHead` (teetering yoke,
  crosshead, grips that follow the blades).
- `exteriorGeometry.ts`: materials; the bent-blade law (`bentAxis`, `outboardBladeMatrix`, `virtualHinge`,
  `BendingNeck`); the loft-following helpers are re-exported from the MD 500E's pure module.
- `cockpitDetails.ts`: the right-seat crew compartment (below).
- `tests/aircraft/bo105Exterior.test.ts`: the acceptance checks below, the bend law, the four-blade pose chain from
  the published state and from the fallback, the swashplate from `swashplateCyclic()`, the physics pose, the left tail
  rotor, glazing masks, cockpit placement, outward facing of every shell, disposal.

## The hingeless head

There is **no flap or lag hinge** anywhere in the head (the test fails on any object named *hinge*). Each blade
flaps by bending its glass-fibre root:

- The bend starts at the **equivalent hinge offset** `e` — the hub model's `equivalentHingeOffset` once the
  definition declares `hubModel.kind === 'hingeless'` (RC/BO), else `dimensions.ts` 0.12 R = 0.590 m (P BK117-ERF7
  "12 %, zero spring") — and runs **0.1 R = 0.492 m** outboard (plan §6.3). Inboard of `e` the root only feathers.
- Over the bend the root is a circular arc of constant curvature whose slope grows from 0 to the blade's flap angle
  β; outboard of it the blade is straight at β (`bentAxis`). Arc length is preserved and the slope is continuous
  (tested to 2e-4 rad per centimetre step).
- β is `RotorcraftState.articulated.blades[i].flap` when the physics publishes it (it already includes coning), and
  feathering is the published `pitch`. Without a published pose (the dev page, and the S0 physics stub's MD 500E hub
  until RC publishes a hingeless pose) β follows the same coning law as the MD 500E adapter
  (`articulatedBladeConing` on `BO105_BLADE_CONING` with the harmonic flapping), and the feathering is
  θ0 + rotation × (right · sin ψ + aft · cos ψ) from `swashplateCyclic()`.
- The aerodynamic blade (from the 1.10 m root cut-out, `dimensions.ts`) is drawn rigidly on the straight part; the
  root shank from inside the fork (0.40 m) to 1.12 m is a lofted mesh whose vertices are re-posed each frame
  (`BendingNeck`): its section goes from a flattened shank to the blade's chord, 12 % thickness, quarter-chord
  position and root twist, and every vertex outboard of the bend lands exactly on the rigid blade transform (tested to
  2e-6 m), so there is no step at the root.
- **Drawn virtual hinge.** The straight outboard blade, extended inboard, crosses the hub plane at
  `e + (L/β) tan(β/2)` ≈ `e + L/2` = 0.836 m (0.17 R). That is ABOVE the literature's 12–15.2 % band: the physics
  hinge stays at `e`; only the drawing's virtual hinge is outboard of it (the plan's "bent over 0.1 R past the
  equivalent-offset station" read literally). Against a rigid blade hinged at `e` the drawn tip sits (L/2) sin β lower:
  1.3 cm at 3° of coning, 2.1 cm at 5°. The disc and the blade trail use the same virtual hinge. Kept as an **agent
  choice** after review: centring the 0.492 m bend on `e` would start it at 0.344 m, inside the fork (0.38–0.54 m) and
  the housing; shortening it so it starts at the fork end (L ≈ 0.10 m) would turn the root through 5° over 10 cm, a
  visible kink. Either would put the drawn virtual hinge on `e`.
- **At flight rpm** the renderer's perceptual blur hides the instanced blades (solid only below about 107 rpm); the
  bending roots hide with them and are not re-posed while hidden (4 × 650 vertices and their normals per frame at
  424 rpm → none). The pitch links stay fitted to the horns, which stay drawn. The exposure disc is re-posed on the
  bent-blade law whenever the mean flap changes OR the base rotor has rewritten it for its own cone (checked on the
  disc's first vertex, as the MD 500E adapter does).
- **When BO adds `bending` to `BO105_BLADE_CONING`** (coning.ts plans a 0.2–0.3 m tip sag), the base renderer will
  sag the shared blade geometry counter-rotated by the base's collective pitch, and the per-blade outboard transform
  is applied on top, so the sag plane will not follow each blade's own feathering (a small plane error; the sag is
  about zero at the root, so the neck still meets the blade). BX re-checks the root-step test then and either
  counter-rotates per blade or records the error.
- **Swashplate.** Its tilt is `swashplateCyclic(def, controls, state)` (the one swashplate law: the stick law rotated
  by the hingeless `controlPhase`, or the gyro's cyclic), never the stick alone; the test builds a hingeless
  definition with a 0.3 rad control phase and checks that the plate follows the law and not the raw stick. The plate
  rises 0.04 m over the collective's travel.
- **Shaft tilt.** The whole head (hub, blades, disc, swashplate) stands on the shaft tilted **3° forward**
  (`definition.shaftTilt`, else `dimensions.ts` SHAFT_TILT, P5 FM Fig 1-1 / P AR-280); the mast housing, mast and
  servo rods sit on the same axis. (The MD 500E visual draws its mast upright.)
- Hardware proportions are ESTIMATES from the 0570b head photograph scaled by the 0.27 m chord: hub star radius
  0.115 m, housings to 0.40 m (radius 0.062 m), forks 0.38–0.54 m, pitch-horn ball at 0.30 m, swashplate 0.27 m
  below the hub (rotating ring radius 0.165 m), hub cap 0.10 m above the hub centre (the 3.00 m head height).

## Geometry and how it was obtained

| Item | Value in the model | Source / tag |
| --- | --- | --- |
| Axes | x = 3.150 − STA, z = SKID_Z − height above the soles (dimensions.ts) | BO's contract |
| Nose / pod end | STA 0.70 / 5.00: hull **4.30 m** | P TCDS p8 / dimensions.ts |
| Pod | widest **1.58 m** at 1.15 m; belly 0.40 m; roof **2.055 m outside** (2.03 m lining) | P / 3V (D-HILF, D-HADO, Flying Bulls) |
| Doors | hinged crew door STA 1.14–1.78; **sliding** door 1.82–2.80 (rails to 3.78); **clamshells** aft of 4.33; nose-compartment cover under the chin windows | P TM 00-6, P5 FM Fig 7-1 / 3V (D-HADO window stations scaled by the hull and checked on the mast at 3.15) |
| Glazing | windscreen to the nose bow at 1.05 m, roof glazing over the crew to STA 1.92, chin windows to the nose, crew-door upper and lower windows, two sliding-door windows | 3V |
| Deck fairing | STA 2.69–5.50, top 2.41 m, half width 0.52 m; intakes at STA 3.62, louvres, exhausts on top at STA 4.42, ±0.30 m | P5 FM 7-16 / 3V |
| Boom | centre 1.86 → 1.58 m, radius 0.22 → 0.10 m, STA 5.10–8.95; driveshaft fairing on top | 3V ESTIMATE |
| Main hub | STA 3.15, 2.90 m; head top **3.00 m** | dimensions.ts (P TCDS p8) |
| Shaft tilt | **3°** forward | P5 FM Fig 1-1, P AR-280 |
| Tail-rotor hub | STA 9.14, 0.26 m **left**, 2.30 m (dimensions.ts, 3V ESTIMATE; see the request below) | dimensions.ts |
| Fin | dimensions.ts FIN_OUTLINE, trailing edge clipped at STA 9.26 (the outline reaches 9.35, 9 cm past the 8.56 m fuselage end) | 3V / D |
| Stabiliser | span **2.0 m** over the endplates' outer faces, chord 0.4 m, 0° | P AR-280 |
| Endplates | 0.45 × 0.42 m, half above and half below the stabiliser | dimensions.ts ESTIMATE / photographs |
| Skids | track **2.53 m** (tube centres), STA 1.75–4.45, tube radius 0.038 m; cross tubes at STA 2.12 and 3.98, arched under the belly | P5 FM Fig 1-1 / 3V |
| Pilot | **RIGHT** seat, eye at `PILOT_EYE` (STA 1.62, 0.36 m right, 1.70 m) | P TCDS p11 / 3V ESTIMATE eye |

## Acceptance (measured on the built model, `bo105Exterior.test.ts`)

| Target | Model | Error |
| --- | --- | --- |
| Overall length, rotors turning, 11.86 m ± 1 % (P5 FM Fig 1-1) | 11.860 m | 0.00 % |
| Fuselage incl. tail, 8.56 m ± 1 % | 8.568 m | +0.09 % |
| Hull 4.30 × 1.58 m ± 2 % (P TCDS p8) | 4.300 × 1.580 m | 0.0 % / 0.0 % |
| Height to the rotor head 3.00 m ± 2 % (P TCDS p8) | 3.002 m | +0.07 % |
| Skid track 2.53 m ± 2 % (tube centres) | 2.522 m | −0.3 % (tube tessellation) |
| Rotor Ø 9.84 m | 9.839 m (rotor at rest, droop) | −0.01 % |
| Tail rotor Ø 1.90 m | 1.900 m | 0.0 % |
| Stabiliser span 2.0 m ± 3 % (P AR-280) | 2.008 m | +0.4 % |
| Shaft tilt 3° | 3.000° | 0 |
| Nothing below the skid sole | lowest visible vertex ≤ sole + 2 mm | pass |
| Pilot's eye within 3 cm of `geometry.fuselage.pilotEye` | `cockpit.pilotEye` = `dimensions.ts` PILOT_EYE (0.32 m under the lining); `BO105_DEFINITION.geometry.fuselage.pilotEye` is still the MD 500E's | **RED until BO request 1**: 1.295 m apart (0.78 / 0.69 / 0.77 m in x / y / z); the test measures the definition, as `consistency.test.ts` does |

## Cockpit (pilot RIGHT)

Built round the frozen `panelLayout.ts`, single set of pilot controls (an **agent choice**: many operators fit dual
controls; the Policía CB photograph shows them):

- **Pedestal**: the narrow instrument face (0.34 × 0.62 m, tilted back 12°) on the centreline with a deep shell, the
  large **hood** over its top and upper sides, and its body down to the floor. The panel texture is PN's.
- **Centre console** (FM Fig 7-4) from the frozen layout: the sloping switch face with four toggle rows and the two
  red-guarded EMERG FUEL VALVE switches, its box to the floor and a low extension aft between the seats.
- **Overhead console** (FM Fig 7-5) under the roof beam with three rows of toggles, and the **two power levers**
  (engine 1 left, engine 2 right) hanging from a roof quadrant at the frozen pivots, each posed from its own engine's
  lever (`engineControl(c, i, 'throttle')`) over the frozen 60° travel: OFF aft, IDLE, FLIGHT forward (ESTIMATE
  sense).
- **Cyclic**: the curved "goose-neck" stick rising from the floor ahead of the right seat, grip with trim hat,
  trigger and button; 10° pitch / 8° roll shown.
- **Collective** on the pilot's left, between the right seat and the console, no twist grip (hidden: the power
  levers are overhead), ending in a switch box with the **four-way ENGINE TRIM switch**: fore/aft follows
  `n2Beep` (fore = INCREASE, both N2), left/right follows `n2BeepSplit` (right = more torque on engine 2) (FM 7-12;
  the throw directions are an agent choice), plus the landing-light switch, trim-release button and friction knob.
- **Pedals**: the pilot's pair. Seats with bolsters and harness, the rear bench for three against the cabin bulkhead
  at STA 2.80 (cargo compartment aft of it, reached through the clamshells), a fire extinguisher by the left door post.
  The standby compass hangs on the windscreen centre post.

## Shots (`work/rigid/shots/BX/`)

`bo105-sheet`, `-side`, `-front`, `-rear`, `-34`, `-top`, `-tail`, `-head`, `-head-turning`, `-cockpit`,
`-viewout` (plan §11; at 424 rpm `-head-turning` is a blurred disc by the renderer's perceptual blur, blades solid
only below about 107 rpm), plus `-head-close`, `-head-turning-close` (fov 12), `-head-bend` (100 rpm, so the bent roots
show before the blades blur), `-cockpit-levers` (the overhead power levers) and `proposal-tail-*` (the requested
tail-rotor height, rendered from an uncommitted local edit of dimensions.ts).

## Photographs consulted (modelling references only; never textures, never committed)

From `work/rigid/sources/bo105/commons-photos/` (licences in research-bo105.md §16): D-HILF (Munich, left side and
quarter views) for the profile, glazing, deck, boom and tail; D-HADO in flight for the door and window stations,
the boom and fin, the endplates and the skids; the Flying Bulls CB for the nose, chin windows, deck and exhausts;
the 0570b rotor head for the hub; Christoph 7, Policía CB and schoschie for the pedestal, hood, consoles and controls.

## Requested changes (PR text; files BX does not own)

1. **BO, `src/aircraft/bo105/index.ts`**: `geometry.fuselage.pilotEye = D.PILOT_EYE` (and the fuselage length, nose,
   tail, width and height from dimensions.ts, as the MD 500E's index does). The S0 stub still spreads the MD 500E's
   geometry, so `consistency.test.ts` reports "pilot's eye: geometry (0.7531, −0.3302, −0.5322), visual (1.53, 0.36,
   0.24)" on this branch; that is the only red row of GA.
2. **BO, `src/aircraft/bo105/dimensions.ts`**: `TAIL_HUB.z` 2.30 m → about **2.80 m** and `FIN_OUTLINE` → about
   `[[8.10, 1.70], [8.98, 2.80], [9.26, 2.86], [8.72, 1.38]]` (3V / D). Evidence: the MM height "about 3.80 m with a
   tail-rotor blade vertical" (research-bo105 §14, OCR, UNVERIFIED) less R 0.95 m gives a hub at about 2.85 m; the
   D-HADO near-profile puts the TR hub a few tenths below the main hub and the fin's root leading edge near STA 8.1;
   plan §6.2 itself says "the Bo 105 TR sits at the fin top near hub height". The visual follows both constants with no
   BX change (the fin, gearboxes, tail light and tail skid are placed from them); `proposal-tail-*.png` show it.
3. **RC, `src/physics/rotorcraft/rotorcraft.ts`**: create and publish `state.articulated` for a `hingeless` hub as the
   articulated branch does (flap about the equivalent offset from `hubModel.coning`), so the exterior shows the solver's
   per-blade pose; until then it uses its coning-law fallback.
4. **PN, `src/aircraft/bo105/panel.ts`**: leave `console` (hood / pedestal outlines) undefined: `cockpitDetails.ts`
   builds the hood and pedestal round the frozen face. The S0 panel stub (the MD 500E's) is stretched over the narrow
   face in the sim (`bo105-viewout.png`).
5. **AX, `src/dev/aircraft.ts`** (optional): the `side` (13 m) and `rotorside` (18 m) presets frame the Bo 105 small;
   the close head shots here use `fov=12`.

## Known issues (for `src/aircraft/bo105/KNOWN_ISSUES.md`, BO)

1. Tail-rotor hub height and fin outline: built to `dimensions.ts` (2.30 m), which the photographs and the MM height
   put about 0.5 m too low (request 2).
2. The S0 definition's pilot eye is the MD 500E's (request 1), 1.295 m from the cockpit's; the plan's eye row and
   GA's consistency row are red until BO lands it.
3. Blade droop at rest uses the provisional MD 500E coning data under the Bo 105 name (`BO105_BLADE_CONING`, BO): a
   free hinge on a −2° droop stop, not the hingeless root's precone and bending.
4. The drawn virtual hinge is e + L/2 ≈ 0.17 R, above the 12–15.2 % band (the physics hinge stays at e; the drawn
   tip is ≤ 2.1 cm lower than a rigid blade hinged at e at 5° coning).
8. From the right seat the A-post / crew-door front frame subtends about 12° of the view to the right (geometry as
   built from the photographs); owner judgement on the sightline.
5. Hub hardware proportions, the endplates' vertical split, the pitot position, the deck intakes and louvres and the
   cockpit furniture are photographic ESTIMATES; no dimensioned drawing was found.
6. The outer roof is 2.055 m (dimensions.ts CABIN_ROOF_HEIGHT 2.02 m is read as the lining) so the frozen overhead
   console and power-lever pivots hang inside the cabin.
7. Dual controls are not fitted (agent choice). Paint is generic (white, dark blue cheat line, `D-HBOX`).
