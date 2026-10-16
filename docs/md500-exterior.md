# MD 500E exterior, five-blade head and cockpit

Package M2 of the PC-12 / MD 500E feature (plan §6.3). The aircraft is the **MD 500E (Hughes 369E)** with the
Rolls-Royce (Allison) 250-C20B, a five-blade fully articulated main rotor, the conventional two-blade tail rotor on
the left of the boom and the pointed "E" nose (owner-notes item 2). Everything else on this page (paint, furniture,
hardware proportions, the single set of pilot controls) is an **agent choice** or an ESTIMATE, tagged as such.

Tags: **P** primary (RFM CSP-E-1 Rev 16, FAA TCDS H3WE Rev 21), **D** derived (arithmetic shown), **F** family
reference (OH-6A, Heffley NASA CR-3144; 500C, NASA CR-166256), **3V** measured on RFM Fig 1-1 / Fig 6-3 or the
three-view, **ESTIMATE** judged from photographs. Primary geometry stays in `src/aircraft/md500/dimensions.ts` (T2);
the panel face stays in `panelLayout.ts` (M3).

## Files

- `src/aircraft/md500/visual.ts`: plain data (the livery worker loads it). The egg loft in RFM stations and
  waterlines, glazing and door outlines, seats, controls positions, lamps, livery (white with a generic blue/red
  sweep, registration `N500EA`; not a factory scheme), shadow, and the `rotorcraftVisual` block. `rotorcraft` is
  the physics `MD500_ROTORCRAFT` itself (consistency rule). Only the unused fixed-wing carriers (wing, tail, gear)
  are compatibility data, in the R44 pattern; nothing of the S269 airframe is spread into it any more.
- `exterior.ts`: `md500ExteriorVisualClass`, injected in `AircraftVisual` (no import cycle). It hides the generic
  Robinson fittings and their static shadow and adds the details below.
- `exteriorDetails.ts`: engine air-inlet fairing over the mast (inlet slot, exit louvres), the exposed **static
  mast** with three non-rotating control rods, the tapered boom and its root fairing, aerofoil-section upper and lower
  fins, the **T-stabiliser** at its incidence with **toed endplates**, the tail-skid bumper, the **tail-rotor
  gearbox and output shaft on the left**, the skid gear (straight rails, tall upturned toes, faired struts with step
  plates and saddles, wear shoes, ground-handling fittings), the windshield centre post and horizontal nose bow, the
  painted chin strip, the A-posts, door seals, hinges and handles, window surrounds, pitot, antennas, fuel filler.
- `exteriorRotor.ts`: `MD500MainRotor` (five arms: flap and lag hinges at the dimensions.ts offsets, pitch
  housings with blade-root fittings and quick-release pins, leading-edge pitch horns, pitch links to the swashplate,
  elastomeric lead-lag dampers, the **V-strap pack** drawn as a five-pointed star of laminated plates joining each
  root to the two opposite roots, the flattened dome) and `buildMD500TailHead` (teetering yoke, teeter bolt,
  crosshead, grips that follow the blades). NACA 0015 main blades (F) via the shared `setRotorBladeThickness`.
- `exteriorGeometry.ts`: materials, the aerofoil panel, faired strut, rounded fairing loft, loft-following strips
  and paths.
- `cockpitDetails.ts`: LH-command crew compartment (below).
- `src/render/aircraft/rotorcraft/rotor.ts`: adds the exported `setRotorBladeThickness` (a generic copy of the
  S269 section helper; the S269 file is untouched).
- `tests/aircraft/md500Exterior.test.ts`: the acceptance checks of the table below, the five-blade pose chain, the
  physics pose (five published blades), the left tail rotor, glazing masks, cockpit placement and disposal.

## Geometry and how it was obtained

| Item | Value in the model | Source / tag |
| --- | --- | --- |
| Axes | x = (100 − STA) × 0.0254, z = SKID_Z − (WL + 15.2) × 0.0254 (mast origin, level skids) | dimensions.ts (T2) |
| Nose | STA 15.0, point at WL ~26.5 (about 40 % up the body) | P (Fig 6-2/6-3) / 3V (G-SSCL, FOX 52) |
| Pod | roof WL 66.0 (6.77 ft), belly WL 0 (1.27 ft), max width 4.57 ft at the doors, closing at STA 178 on the exhaust collector | P (Fig 1-1) / 3V |
| Main hub | STA 100, WL 83; dome top WL 89.5 | P (Fig 6-3) |
| Hinges | flap = lag = 0.140 m; blade root 0.480 m | F / ESTIMATE (500C) |
| Engine air-inlet fairing | STA 84–158.6, top WL 77 at the mast | 3V (G-SSCL, three-view) |
| Boom | straight from the cant STA 197.78, WL 55.34 to the TR hub height; radii 0.135 → 0.068 m | P (root) / D (end) / 3V radii |
| Tail-rotor hub | STA 284, BL −0.30 (left), **WL 51.4 in level axes** | P / F (BL) / **D** (below) |
| Upper fin | dimensions.ts outline, leading and trailing edges extended down to the boom | 3V (T2) |
| Stabiliser | span 5.43 ft, chord 0.30, centreline WL 96.91; drawn leading edge **down 6.17°** to the waterline | P / ESTIMATE chord / D |
| Endplates | height 0.30 (40 % above, 60 % below), chord 1.2 × stab, toe 5° in | ESTIMATE (dimensions.ts, photographs) |
| Skids | track 6.45 ft outside, STA 28–128, struts at STA 78.5 / 124 (feet 0.08 m ahead of the tops) | P / 3V / ESTIMATE lean |
| Pilot | LEFT seat, eye at `PILOT_EYE` (STA 70.4, BL −13.0, 1.73 m above the sole) | P (seat arms) / ESTIMATE eye |

**Tail-rotor hub height (D).** RFM Fig 1-1's heights are measured in the ground attitude, 4.7° nose up with full fuel
(Fig 1-1 note 1); the hub-fairing top (STA 100, WL 89.5) reads 8.72 ft, so the heights pivot at the mast. The lowest
TR tip at 2.0 ft puts the hub at 2.0 ft + R = 51.5 in above the ground in that attitude; 184 in aft of the mast the
attitude lowers it by 184 × sin 4.7° = 15.1 in, so in level body axes the hub is at **WL 51.4**. Independent check:
the fin top at 8.4 ft (Fig 1-1, ground attitude, STA ~293) becomes WL 101.4 by the same rule, against the stabiliser
top WL 102.17 of Fig 6-3 (0.8 in apart). `dimensions.ts` `TAIL_HUB.z` applies the ground-attitude height to the level
axes (WL 36.3), which would droop the boom 13° and leave both fin outlines of the same file (root WL 60 / top WL 50,
drawn for a boom near WL 52) off the tube. The visual uses the level-axis value and keeps `TAIL_HUB.x/y`; the change
of `TAIL_HUB.z` is handed to T2 (PR text).

**Stabiliser incidence.** TCDS p14: 8.92–9.42° (mid 9.17°) measured to a line perpendicular to the mast; the mast is
tilted 3° forward, so the stab sits 6.17° to the fuselage waterline. It is drawn leading edge down (a download in
forward flight, the heli-archive description of the 500D stab). The aerodynamic sign is T2's to prove (plan §6.2);
the drawing follows `HORIZONTAL_STABILIZER.incidenceToMastNormalDeg` and `SHAFT_TILT_DEG`.

## Acceptance (measured on the built model, `md500Exterior.test.ts`)

| Target (RFM Fig 1-1) | Model | Error |
| --- | --- | --- |
| Overall length, rotors turning, 30.81 ft = 9.391 m ± 1 % | 9.398 m | +0.08 % |
| Fuselage (nose to aft-most fin/endplate) 23.88 ft = 7.279 m ± 1 % | 7.238 m | −0.56 % |
| Height to the hub-fairing top 8.72 ft = 2.658 m ± 2 % | 2.659 m | +0.05 % |
| Skid track outside 6.45 ft = 1.966 m ± 2 % | 1.972 m | +0.3 % |
| TR lowest tip 2.0 ft = 0.61 m ± 0.05 (ground attitude) | 0.605 m (4.7° nose up); 0.988 m in level axes | −0.005 m |
| Nothing below the skid sole | lowest visible vertex ≤ sole + 2 mm (spline tolerance) | pass |
| Pilot's eye within 3 cm of `PILOT_EYE` | `cockpit.pilotEye` = `PILOT_EYE` exactly; 0.29 m to the cabin lining above | 0 |

The occupant figure (shared `occupants.ts`) leans on the seat back at the STA 78.5 bulkhead, so its head centre is
about 0.11 m aft of the camera eye, at the same height; the figure is hidden in the cockpit view.

The fuselage length is carried by the endplates (chord 1.2 × the stab chord): the shared `UPPER_FIN_OUTLINE` ends at
STA 296 and the stab trailing edge at STA 298.8, 0.08 m short of the RFM's aft-most point.

## Cockpit (pilot LEFT)

Single set of controls (an agent choice: the 500E's dual controls are removable; the pedals are dual):

- **Cyclic**: the curved 500 stick rising from the floor ahead of the left seat, its grip canted aft with the 4-way
  trim "coolie" on top and the ICS trigger in front (RFM Fig 4-4; Radecki photograph). It pivots at the floor
  (STA 52) and moves with the cyclic inputs (11° pitch, 9° roll shown).
- **Collective** on the pilot's left with the ribbed **twist grip**, the **idle-release ring** at its head, the end
  cap with the **START button**, the switch box with the **governor INC/DEC (beep) switch** and the landing-light
  switch, and the friction nut (RFM Fig 4-4). The lever and grip follow the collective and throttle.
- **Pedals**: two pairs, heel plates.
- **Panel**: the shared rotorcraft console on `panelLayout.ts` (17.3 × 13.7 in face, tilted back 15°), the glare hood
  over the annunciator strip, and the **slant console** below it (16.3 × 10.1 in, 45°) with two switch rows, the
  red FUEL VALVE pull knob, the key switch and the fresh-air knob (research §12). The panel texture is M3's.
- **Overhead**: the roof frame between the eyebrow windows with the cabin/map light and a grab handle; the wet
  compass hangs on the windshield centre bow. No overhead circuit-breaker panel is drawn: the CB column is on the
  console (research §12).
- Seats on the cargo-compartment bulkhead (STA 78.5), bulkhead behind them, fire extinguisher by the left door post.

## Photographs consulted (modelling references only; never textures, never committed)

From `work/pcmd/sources/md500/commons-photos/` (licences in research-md500.md §15): G-SSCL left side in flight
(Adrian Pingstone, public domain) for the profile, door shapes, inlet fairing, boom root and skids; D-HHRM front and
quarter (CC BY 3.0 de; its four-blade tail rotor ignored) for the nose glazing, chin strip, endplates and strut
splay; the Kauai head-on (CC BY 4.0) for the skids and belly beacon; the Radecki cockpit (CC BY 2.5) for the stick,
console and door frames; the FOX 52 three-view (CC BY-SA 4.0) for the plan and side outlines.

## Known issues (handed to the owner of `md500/KNOWN_ISSUES.md`, T2)

1. `TAIL_HUB.z` in `dimensions.ts` is a ground-attitude height in level axes (above). The visual uses WL 51.4; until
   T2 adopts it, the physics tail-rotor hub sits 0.38 m lower than the drawn one.
2. The rotor hubs in the physics (`MD500_ROTORCRAFT`) are still the S269's until T2 merges; the visual hubs come from
   `dimensions.ts`, so the drawn and aerodynamic hubs differ in the meantime (no consistency rule compares them).
3. Blade droop at rest uses the provisional S269 coning data under the MD 500 name (`MD500_BLADE_CONING`, T2).
4. The occupant figure's head is ~0.11 m aft of `PILOT_EYE` (shared figure leaning on the seat back).
5. Hardware proportions of the head (strap pack, housings, dampers, swashplate) are photographic estimates: no
   dimensioned 369D/E hub drawing was found. The strap pack's flexure is drawn as fixed plates; flap and lag happen at
   discrete hinges at the published 0.140 m offset.
6. Paint is generic (white, blue/red sweep, `N500EA`), not a factory scheme; the main blades are grey with an orange
   tip band, the tail blades white with red bands.
