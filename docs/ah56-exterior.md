# AH-56A Cheyenne exterior, heads, gear and crew stations

Package AX of the rigid-rotor programme (plan revision 2, §7.5; §14 C3.21/C3.22). The aircraft drawn is the **AH-56A
AMCS ship 7, 66-8832** (the 1973 Advanced Mechanical Control System aircraft at the Army Aviation Museum), with the
**1972 ICS configuration's 9.7 ft control-gyro "X"** drawn on the head when `state.controlGyro.mode === 'ics'`
(`config=ics`). AMCS as the default and ICS as a runtime configuration are **AGENT choices** (owner-notes.md); so is
everything else on this page that is not tagged P or S (shapes, paint, furniture, hardware proportions).

Tags: **P** primary (ASTA-72 = USAASTA 72-08; AMCS-73 = USAASTA 72-44; APE-I = USAASTA 70-02/71-17; page or paragraph
in research-ah56.md §2, §7, §8, §12–13), **S** secondary (Jane's 1969–70 via Wikipedia), **D** derived (arithmetic
shown), **3V** read from the photographs, **ESTIMATE**. Every station comes from `src/aircraft/ah56/dimensions.ts`
(the geometry contract, owner AG): `x = (298 − FS) · 0.0254`, `y = BL · 0.0254`, `z = (95 − WL) · 0.0254`, ground line
WL 18 (`GROUND_Z`). The rear-cockpit panel face is the integrator-frozen `panelLayout.ts`.

**Built to dimensions.ts, not to the S0 physics stub.** At stage 2 the AH-56A definition still flies the MD 500E's
rotorcraft with four blades (`base.ts`); the visual draws the real 15.62 m rotor, the 10 ft tail rotor and pusher, the
wheels and the gyro from the contract files, so nothing here changes when AG, AC and AH land their physics.

## Files

- `src/aircraft/ah56/visual.ts`: plain data (the livery worker loads it). The loft in stations, the canopy outlines and
  frame stations, the sponsons, wing, fin and stabiliser planforms (derived from the published areas, spans, tapers and
  quarter-MAC stations), the T64 intake/exhaust and transmission-fairing stations, tyres and gear pivots, seats and
  floors, lamps, livery, shadow, the compatibility wheel table (tail wheel, left, right: the ground shadow's creases and
  the dev page's retract flag) and the `rotorcraftVisual` block. `rotorcraft` is the physics `AH56_ROTORCRAFT` itself.
- `exterior.ts`: `ah56ExteriorVisualClass`, injected in `AircraftVisual` (no import cycle). It hides the generic
  helicopter fittings (boom, mast cowl, **skids**) and their static shadow, hides the generic tail rotor (it has the
  stub's blade count) and adds the parts below. It reads the whole rotorcraft state through `readRotorcraft`.
- `exteriorDetails.ts`: transmission fairing and T64 cowl with louvres, static mast, the two bell-mouth intakes and the
  exhaust nozzle, sponsons with their fillets, the wing (NACA 4-digit, 12 % → 8 %, light camber for the trailing-edge
  extension, tip fairings), the walkway over the right sponson, the ventral fin with the tail-wheel housing at its lower
  end, the stabiliser (plain right panel, **bobtailed left** panel) and the tail-rotor gearbox at the left tip, canopy
  bows, sills and the centreline **butterfly hinge line** with hinge blocks, the gunner's sight head, boarding step,
  antennas, pitots, and the **markings** (decals).
- `exteriorWeapons.ts`: XM51 nose turret (40 mm XM129), XM52 belly turret (30 mm XM140) at FS 190, four wing pylons at
  BL 70 / 117, one TOW launcher on each inboard pylon (the default "TOW pair").
- `exteriorGear.ts`: the retractable tail-wheel gear, posed from `state.gear.extension`, `wheels[i].compression`,
  `.rotation` and `.steerAngle` (castering). Its own meshes: the fixed-wing wheel and leg renderers are not used.
- `exteriorRotor.ts`: `AH56MainRotor` (hingeless head, AMCS hardware, ICS gyro X), `AH56TailRotor` (4-blade teetering),
  `AH56Pusher` (3-blade, β and spin from the state).
- `exteriorGeometry.ts`: materials and helpers (aerofoil panel with taper and camber, rounded fairing loft, bodies of
  revolution, loft-following decals and bands, canvas textures). Kept apart from the MD 500E's helpers.
- `cockpitDetails.ts`: both crew stations (below).
- `src/dev/aircraft.ts`: the dev page (below).
- `tests/aircraft/ah56Exterior.test.ts`: the acceptance rows, the gear, head, pusher and cockpit checks, facing and
  disposal.

## Geometry and how it was obtained

| Item | Value in the model | Source / tag |
| --- | --- | --- |
| Nose | FS 30, blunt rounded nose, nose deck WL 89 at FS 66 | dimensions.ts (D/3V) / 3V |
| Front (gunner) canopy | FS 66–129, top WL 125, sill WL 89.5–97.5 | 3V (Rucker front/side) |
| Rear (pilot) canopy | windshield rises FS 129–143 to WL 141, top WL 143.5, back to FS 206, sill WL 108 | 3V, and the frozen panel face (below) |
| Eyes | gunner FS 118 / WL 112, pilot FS 168 / WL 130 (31.5 in above the P seat-pan pickups WL 80.5 / 98.5) | dimensions.ts (P pickups, ESTIMATE eyes) |
| Upper deck | WL 138 behind the rear canopy, transmission fairing to WL 156 at the mast | 3V |
| Main hub | FS 300, WL 165.3 (bottom of the fixed hub at the flange) = the blade plane | P (ASTA-72 p 48) |
| Rotor | 4 × R 7.808 m, chord 0.711 m, −5° twist, t/c 12 % root → 6 % tip | P |
| Equivalent hinge | `hubModel.equivalentHingeOffset` when hingeless, else 10 % R | ESTIMATE (research §5) |
| Intakes | bell mouths each side of the transmission fairing, lip FS 292, BL ±21, WL 147, 19 in | 3V |
| Exhaust | nozzle on the deck at FS 442, WL 144.5, 15 in, aft and 15° up | 3V (Rucker rear, Anefo) |
| Sponsons | centre BL ±35, WL 70, radius 12.5 in, FS 185–405 | 3V |
| Wing | 195 ft², span 26.7 ft (tip BL 160.2), root 9.74 ft, tip 4.87 ft, MAC 7.6 ft at ¼-MAC FS 308.2, dihedral 5°, incidence L 11°52′ / R 12°58′ (to the waterline), twist −3° | P / D (chords from S, b, λ) |
| Wing planform | trailing edge unswept at FS 308.2 + 0.75 MAC = **FS 376.4**; ¼ chord at WL 67 at BL 35 | 3V / D |
| Ventral fin | root WL 114.5, tip WL 37.6, chords 4.84 / 2.84 ft, ¼-MAC FS 620.3, LE swept 32° | P / D / 3V sweep |
| Stabiliser | span 10.83 ft, incidence 2°, TE unswept at FS 637.18 + 0.75 MAC_R = FS 663.7; right 44.0 → 25.0 in, left 45.5 → 26.5 in (D), left TE cut 9 in outboard of BL 40 (the bob) | P / D / 3V |
| Tail rotor | 4 blades, R 5 ft, chord 14 in, hub FS 658.5 / WL 114.5 / BL 72 L, clockwise from the left, ×5.033 | P / D |
| Pusher | 3 blades, R 5 ft, hub FS 675.7 / WL 114.5, CCW from behind, ×6.980; chord 0.277 m from AF 142 (c/D = 142 / 1562) | P / D |
| Spinner tip | FS 686 = nose + 656 in | S (fuselage 54 ft 8 in) |
| Main gear | contacts FS 285, BL ±31 (track 62 in), tyre Ø 22 in, swing forward 98° into the sponsons | dimensions.ts (D/3V) / ESTIMATE |
| Tail wheel | contact FS 640 on the centreline, 5.00×4 (Ø 13.5 in), castering, swings aft 90° into the fin's lower end | P (tyre) / dimensions.ts / ESTIMATE |
| XM52 turret | drum r 10 in at FS 190, bottom WL 39 | P (ASTA-72 para 91) |

**The frozen panel face sets the canopy step.** `panelLayout.ts` puts the 24.4 × 15.7 in face at FS 140 / WL 118,
tilted back 10°, so its top edge reaches WL 125.8 at FS 141.4. A rear windshield rising behind FS 136 (as first drawn)
left the face's top corners outside the skin, so the rear windshield now starts at the front canopy's aft bow (FS 129–131)
and reaches WL 141 by FS 143; the test checks all four face corners inside the cabin lining.

## Acceptance (measured on the built model, `ah56Exterior.test.ts`)

Every row but the height checks `dimensions.ts` constants (P/S/D) on the built model. The **height row is not an
independent measurement**: the top of the ICS model is the gyro X, whose height above the blade plane
(`GYRO.rise` = 0.32 m in `exteriorRotor.ts`) has no source (no dimensioned drawing of the gyro post was found and no
photo ratio was measured). It is an AGENT choice **set to land the published 13 ft 8.5 in**: the hub flange sits at
WL 165.3, the X's top is 0.32 m + 0.068 m (the tip mass's half height) = 0.388 m (15.3 in) above it at WL 180.6, and the
tyre contact plane is WL 18.0 (`GROUND_WL`), so the model stands 180.6 − 18.0 = 162.6 in (−1.2 %). The row confirms the
choice stays inside the 2 % band; it does not validate it.

| Target | Model | Error |
| --- | --- | --- |
| Main rotor Ø 15.62 m (P) | 15.616 m | −0.03 % |
| Fuselage, nose to spinner tip, 54 ft 8 in ± 1 % (S) | 54.667 ft | 0.0 % |
| Span 26.7 ft ± 1 % (P), tip fairings included | 26.88 ft | +0.69 % |
| Height 13 ft 8.5 in ± 2 % (S), ICS head (gyro X): **set** through `GYRO.rise` (see above) | 162.6 in | −1.2 % |
| (AMCS head, no gyro: not a published figure) | 154.2 in | — |
| ICS gyro X over the tip masses 9.7 ft (P) | 9.70 ft | 0.0 % |
| Tail-rotor Ø 10 ft at FS 658.5 / WL 114.5 / BL 72 L ± 1 in (P) | 10.02 ft, hub on the station | +0.2 % / 0 in |
| Pusher Ø 10 ft at FS 675.7 / WL 114.5 ± 1 in (P) | 10.00 ft, hub on the station | 0.0 % / 0 in |
| TR and prop lowest tips ≈ 3 ft (D: 36.5 in) | 36.4 / 36.5 in | −0.1 / 0.0 in |
| Belly turret 21 ± 2 in above the ground (P) | 21.0 in | 0.0 in |
| Main track ≈ 62 in ± 10 % (D) | 62.0 in | 0 % |
| No mesh below the tyre contact plane except the tyres (gear down, in transit and up) | lowest non-tyre vertex ≤ GROUND_Z | pass |

## Heads

- **Blades** are posed per blade about the equivalent hinge: flap and feathering from `state.articulated.blades[]`
  (published by the solver for an articulated or hingeless hub), else a fallback: −0.9° droop at rest (3V) blending to
  the 2° precone at 1 g of rotor thrust, plus the first harmonic from `flapForward/flapRight`, and pitch from the
  collective plus `swashplateCyclic()`. The exposure disc and the blade trail use the same coning and tilt.
- **Blade section**: the generic NACA 0012 blade is re-thickened to a linear 12 % → 6 % t/c taper (P (4.6)3012 →
  (0.6)3006 mod). The generic renderer rewrites every blade vertex from its untapered construction-time copy whenever
  its `tipBend` changes, so `exterior.ts` hands it the coning **without `bending`** (`withoutBladeBending`); the head
  poses the blades itself and never used the generic cone or sag. Tested with a coning that carries `bending`.
- **AMCS** (default): hub drum, the cruciform arms with bearing housings, long blade-root cuffs with leading-edge pitch
  horns, pitch links from the rotating swashplate ring, the swashplate tilted by `swashplateCyclic(def, controls,
  state)` (the gyro's cyclic once AG's gyro exists), scissors. No gyro (Rucker 66-8832).
- **ICS**: the gyro X on a post 0.32 m above the blade plane (AGENT choice set to the published height, see Acceptance), four arms with tip masses, 33° ahead of the blades (P cant),
  tilted relative to the shaft by `state.controlGyro` (pitch + = aft, roll + = right: the `gyroBladeCyclic` convention);
  the pitch links run from the gyro arms to the horns. The drawn tilt is clamped to the configuration's largest stop
  (`maxTilt`, else ±45°) before `tan()`, so any dev-page `gyropitch=`/`gyroroll=` stays finite. The X fades into a ring of its tip masses with the same
  perceptual blur as the blades.
- **Tail rotor**: two crossed teetering yokes and four grips on the shared blade/blur renderer; blade angle −7.4° to
  +24.2° (P) with the pedals.
- **Pusher**: with a pusher state the blades sit at `state.pusher.beta` (blade angle at 0.7 R) and turn at rotor rpm ×
  6.980 (`def.pusher.ratio` when present), the leading edge forward for positive β; without one (stage 2: no pusher in
  the definition) the prop stands **stopped and feathered** (88° drawn; the real blade range ends at +40.8°, so this is
  the plan's stage-2 depiction, not a hardware position). Blades fade into a disc with rpm.

## Gear

Mains: a trunnion inside each sponson (FS 281, WL 69), the oleo inboard of its wheel, torque links, drag brace; the
leg swings forward and up through 98°; the stowed tyre lies within 1.5 in of the sponson envelope (test). Tail wheel: a
strut from a pivot in the fin's lower-end housing (FS 637, WL 44), a castering yoke with a trailing fork and the lock-pin
housing; it swings aft and up into the housing. Compression raises each wheel along its leg; the contacts in
`visual.ts` are the free tyre contacts of the gear contract (`dimensions.ts`). No gear doors are drawn (photographs show
the mains hanging from the sponson bottoms without visible doors; the fin housing is open).

## Crew stations (pilot REAR)

- **Rear (pilot)**: the panel face of `panelLayout.ts` (AGENT reconstruction, unverified: no photograph of the rear
  panel exists) under a glare hood; side consoles at the frozen positions with the **gear handle** (wheel knob) and the
  **tail-wheel lock** T-handle on the left; switch rows; **circuit-breaker panels above and behind the pilot's head**
  (P APE-I 134i); the cyclic between the knees with the four-way trim **coolie hat** (P ASTA-72 para 40) and trigger;
  the collective on the left with the **prop twist grip forward** (turns 130° over the lever, P ≈130° for 52.8° of β)
  and the **engine condition grip** behind it, the same shape (P para 73a), the RPM SET / directional-trim switch box;
  two pedals; armoured seat sides.
- **Front (gunner)**: the swivelling SGS station drawn facing forward: the periscopic sight column with its eyepiece
  and hand grips, side consoles, a small panel under the windshield, its own floor; armoured seat.
- Figures: the pilot through the shared occupants (`cockpit.occupants`), the gunner built with his own floor so his
  feet rest on the lower front floor; both hidden in the cockpit view.

## Markings

Olive drab (FS 34087-like, weathered as the museum airframes); the generic livery's stripe has zero width and its
registration box is parked aft of the loft, so the markings are decals: **ARMY** in black on the tail cone, the
national star and bars ahead of it, the **yellow prop-danger band** round the tail cone with a red arrow pointing aft
and "DANGER KEEP AWAY" on each side, and **U.S. ARMY / 68832** on both sides of the ventral fin: the Army's tail-number
form of serial **66-8832** (the Ames photograph of 66-8835 reads "68835"); `livery.registration` is `66-8832`. Main
blades olive with a yellow tip square, tail and pusher blades dark with yellow tips (Ames, Fort Campbell).

## Dev page (`src/dev/aircraft.ts`, AX)

- `config=amcs|ics`: creates `rotorcraft.controlGyro` (mode; the definition's default when it has a gyro);
  `gyropitch=` / `gyroroll=` (deg) set its tilt.
- `pitch=deg`: also `rotorcraft.pusher.beta` (a pusher block is created; with `def.pusher` it is created at the hover
  detent).
- `gear=0..1`: the extension of the wheels of a wheeled rotorcraft too (the visual reads `state.gear.extension`);
  rotorcraft wheels are drawn free (`comp=` to compress them).
- The default rotor thrust (the type's maximum weight) applies when `rpm > 0.6 × nominalRpm` (was `rpm > 300`). At
  stage 2 the stub's `nominalRpm` is the MD 500E's 492, so the AH-56A shots at 240–246 rpm pass `thrust=81400`
  (18,300 lb) explicitly until AG lands the real rotor.
- A rotorcraft longer than 11 m (fuselage or rotor) gets the fixed exterior presets scaled with its size (k = 16.7 / 11
  for the AH-56A); smaller types keep their framing exactly. `view=gear` on a rotorcraft with more than one visual
  gear entry looks at the left main wheel (a large skid type, `gear: []`, keeps the fixed preset). New: `view=head` (a close three-quarter of the main head) and `eye=x,y,z&at=x,y,z` (a free camera in body FRD
  metres, for matching a reference photograph's viewpoint).

## Photographs consulted (modelling references only; never textures, never committed)

`work/rigid/sources/commons-photos/` (licences in research-ah56.md §14): Rucker 66-8832 side, front and rear (James
Emery, CC BY 2.0) for the profile, canopies, sponsons, intakes, exhaust, gear, markings and the AMCS head; Fort Campbell
66-8831 left profile (Gary Todd, CC0) for the ICS gyro X and the wing incidence; Ames 66-8835 front and rear
three-quarters (NASA, PD) for the gyro head, the bobtailed left stabiliser, the tail rotor, the ventral fin and the
tip paint; the 1969 airfield, Anefo 1971 in-flight and the XM51 / XM52 armament drawings (PD).

## Known issues (handed to the owners named)

1. **Pilot's eye in the definition (AG, `ah56/index.ts`).** The visual's `cockpit.pilotEye` is dimensions.ts
   `PILOT_EYE` (rear seat); the S0 definition still spreads the MD 500E's `geometry.fuselage.pilotEye`, so the
   consistency row "pilot's eye" fails on this branch alone until AG sets the geometry's eye to `PILOT_EYE`.
2. **In-sim pose at stage 2 (AG).** The stub flies the MD 500E's skids and hub: in the simulator the AH-56A model rests
   at the stub's skid height (skids.z 1.20 m against the AH-56A's tyre contact 1.956 m below the reference point: on a
   ground reset its tyres stand 0.76 m into the ground), the main-rotor visual spins at
   the stub's 492 rpm and no `controlGyro` or `pusher` state exists, so `config=ics` shows no gyro X in the simulator
   until AG (gyro, wheels, rotor) and AC (pusher) land. The dev page shows every state.
3. Blade droop at rest uses `AH56_BLADE_CONING` (the MD 500E's at S0) only through the generic renderer's first pose;
   the AH-56A head replaces it with its own fallback (−0.9° ESTIMATE) until the solver publishes the hingeless pose.
4. Hardware proportions of the head, gyro post height, gear legs, sponsons, intakes and exhaust are photographic
   ESTIMATES; no dimensioned three-view was found (research-ah56 §16 gap 5).
5. The wing's incidence is drawn to the waterline (the published datum is unstated, research §7): 12° makes the root
   trailing edge hang about 16 in below the quarter chord, as the photographs show.
6. The stage-2 pusher is drawn feathered at 88°, a position the real hub (−17.2° to +40.8°) could not reach.
7. The ICS height row is set, not measured: the gyro post height `GYRO.rise` = 0.32 m is an AGENT choice that lands
   162.6 in against the published 13 ft 8.5 in (−1.2 %); a photo-ratio derivation (Fort Campbell 66-8831) is open.
8. No blade sag is drawn: the generic `tipBend` is not fed to the AH-56A blades (it would undo the 12 % → 6 % taper). If
   static droop with bending is wanted later, `TeeteringRotor`'s cached blade copy (integrator, `rotor.ts`) must take
   the taper, or the head must apply the sag itself.

These items are repeated in the AX commit body (the PR text) for the integrator to lift into `docs/known-issues.md`.
