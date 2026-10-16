# Pilatus PC-12/47: exterior and 3D cockpit

`src/aircraft/pc12/visual.ts` describes the PC-12/47 as plain `AirframeVisualDef` data. The shared builders under
`src/render/aircraft/` turn that data into the 3D model. This page covers where the shapes come from, which choices
were made by the agent, what the builders gained for the type, and what is still open.

## Sources and tags

| Tag | Source |
| --- | --- |
| TCDS | EASA TCDS A.089 Issue 11, section C (PC-12/47). Span 16.28 m, length 14.408 m, height 4.26 m, propeller 2.67 m with 4 blades turning clockwise from behind, datum 3.000 m ahead of frame 10. |
| 3V | Pilatus Report 02277 (PC-12/47E POH) Fig 1-1, PDF p. 70, read at 300 dpi. The /47 airframe is the same. Side view: 41.5 px/m vertically and 40.8 px/m along the body. Ground line at page row 1130, fuselage depth bracket at rows 1014 and 1089. Front view: 126 px/m from the 4.53 m track. |
| 47E | The same POH, as text. Doors (§1-8), flaps and trim (§7-3), gear (§7-4), quadrant (§7-10). |
| PHOTO | Wikimedia Commons: N814WA (left side), HB-FPT (right side), ZS-JDD (approach, flaps down), "propeller and nose", and the two cockpit photographs "Cockpit PC-12 linke/rechte Seite". These are modelling references only. They are never used as textures and are never committed. |
| ESTIMATE | An agent judgement with no source. |

The fact files are `pc12/geometry.ts` (P1) and `pc12/panelLayout.ts` (P3). The visual reads these from them: the
propeller hub and disc, the wheel contact points and radii, the wing span, area, chords, root station, dihedral, flap
and aileron stations and winglet height, and the tailplane span, chords and quarter-chord.

## The airframe

Heights are written as heights above level ground, `hz(h) = PC12_REST_HEIGHT - h`, so the drawing follows the
reference point if P1 moves the CG height.

- **Fuselage (3V).** The roof line is 2.80 m and the belly line 0.99 m above the ground. The fuselage depth is 1.81 m
  (the TCDS-era figure is 1.83). The spinner centre is at 1.60 m in the front view and 1.73 m in the side view. The
  drawing is the side view lowered by 0.07 m, so its thrust line meets the geometry's hub at 1.635 m. That gives a
  roof at 2.73 m, a belly at 0.93 m and a windscreen sill at 2.18 m. The nose keys are written against the thrust
  line. Width is 1.69 m. The wing-root fairing deepens the belly to 0.87 m between stations 5.1 and 7.8.
- **Nose.** A pointed spinner 0.48 m across, from station 1.025 to its tip at station 0.55. Below it is the crescent
  chin inlet: a wide, low superellipse, 0.46 × 0.13 m. One exhaust stub stands out on each side of the cowling at the
  thrust line, at station 1.85, pointing out and aft (PHOTO). The builder's new `exhaust.mirror` draws the second
  stub.
- **Glazing (3V, PHOTO).** The windscreen runs from the sill at station 3.30 up to the roof at station 4.20; its panes
  drop slightly toward the sides. The cockpit side windows run from station 3.47 to 4.45 at 2.06 to 2.50 m, which is
  the 3V's 2.13 to 2.57 m less 0.07. The cabin windows are ovals, 0.29 m wide and 0.36 m tall. There are four on the
  left (three between the doors and one in the cargo door) and five on the right; the second right window is in the
  over-wing exit. That makes nine in total (47E §7-2).
- **Doors (47E §1-8, 3V).** Airstair door on the left front, 0.61 × 1.35 m (stations 4.76 to 5.37). Cargo door on the
  left rear, 1.38 × 1.34 m. Over-wing emergency exit on the right, 0.49 × 0.68 m.
- **Wing.** Low and straight-tapered: 2.10 m chord on the centre line and 1.08 m at the half span, with the
  quarter-chord line unswept. Dihedral is 5°. The section is LS(1)-0417 as a NACA 4-digit stand-in (2.2 % camber at
  40 %, 16.5 % thick). Incidence is 2° at the root washing out to 0° (ESTIMATE). The wing passes under the cabin
  (`root: 'conform'`) at a root chord plane of 1.05 m (3V front view: root fairing from 0.87 to 1.27 m).
- **Winglets.** 0.45 m high (geometry.ts), canted 62° up from the wing plane. This is an ESTIMATE between the 3V front
  view (about 30°) and the photographs (60–70°). Each has a 32° sweep and its chord tapers from 0.95 m to 0.45 m. The
  flat wing ends at y = 7.88 m so that the winglet tips meet the TCDS span (16.28 m drawn; 16.283 m measured on the
  built mesh).
- **Flaps.** Fowler flaps from the fuselage side to 5.05 m, 30 % of the chord, 40° full. At full flap they move 0.42 m
  aft and 0.10 m down (PHOTO ZS-JDD on approach). There are two flap-track canoe fairings under each wing (a third
  track is hidden in the root fairing); they are `fairings` lofts.
- **Ailerons and boots.** The ailerons run from 5.15 m to 7.80 m: geometry.ts's 7.95 is held 8 cm inside the flat tip.
  The black pneumatic de-ice boots wrap the leading edge in two panels per wing, back to 6 % of the chord on top and
  7 % underneath. The builder's new `wing.boots` draws them.
- **Tail.** A T-tail. The tailplane span (5.20 m), chords (1.25 / 0.75 m) and root quarter-chord (station 13.85,
  4.05 m up) come from geometry.ts. The tip quarter-chord sits 0.42 m aft (about 12° of leading-edge sweep, 3V top
  view). Incidence is −1.5° (ESTIMATE). The elevators take 36 % of the chord. A bullet fairing 0.2 m in radius runs to
  the tail's end at station 14.958. The fin is from the 3V: base at 2.05 m (inside the tailcone) with leading edge at
  station 11.80 and a 1.95 m chord, tip under the tailplane with a 1.20 m chord. The rudder takes 34 % of the chord.
  There is a long dorsal fin from station 9.3, a small ventral fin, and a pair of ventral strakes from station 9.9 to
  12.3, 0.2 m deep, rooted 48° round from the keel and leaning out 40°. The builder's new `tail.strakes` draws them.
- **Stabiliser trim.** The whole tailplane, with both elevators, turns about a lateral line through 65 % of its root
  chord (ESTIMATE, the rear spar). It turns by `SurfaceState.elevatorTrim`, and + means leading edge up, which is
  nose-down trim, as in plan §3.6. In the builder (`tail.h.trim`), the stabiliser hinge is `TailParts.tabs[0]` with
  `tabGearing 0`. `AircraftVisual`'s existing tab loop therefore drives it without any change to that file. The
  elevators are children of that hinge and still turn on their own hinges.
- **Gear (47E §7-4).** Trailing-link mains: a post down from the wing to the arm's pivot 0.38 m ahead of the axle, the
  arm running aft and down to the axle. Each main leg folds 90° inward about a fore-aft hinge at the post's top (1.08 m
  up, in the wing). It then lies flat in the wing root, its centre 1.08 m up and 1.51 m from the centre line (the tyre
  about flush with the wing's lower skin), with a leg door and a well decal. The nose leg is an oleo with torque links and steering. It folds 96° aft about a lateral
  hinge at station 2.74, 1.12 m up, into the nose bay under two doors. Tyres are 8.50-10 on the mains and
  17.5 × 6.25-6 on the nose (TCDS C.III.19). The legs are not drawn at extension 0 (builder behaviour), so the
  "wheels 25 mm proud" look shows only during the last few per cent of travel.
- **Propeller.** Hartzell HC-E4A-3D: 4 blades, 2.67 m, variable pitch, built at 17° (the flight-idle low-pitch stop
  the flight model starts from, plan §5.1). The state's `bladePitch` turns each blade from there: −17.5° in full
  reverse and 79.6° feathered. The blades are slender (0.19 m at their widest), dark grey with white tips.
- **Lamps.** Navigation lights and strobes at the flat wing tips. White tail light in the bullet's tail, red beacon on
  the bullet's top (PHOTO ZS-JDD). Landing light in the left leading edge. Taxi light on the nose leg (PHOTO).
- **Livery.** Generic white with a blue cheat line (34, 62, 128) and a grey accent line under it. The line runs from
  the cowl along the lower cabin and sweeps up the tailcone to the fin. Registration "N47PC" on the tailcone. No
  operator branding.

## The cockpit

The cockpit is fitted to the pilot's eye. The eye is at station 4.20, 0.40 m left of the centre line and 2.33 m up.
That puts it 0.30 m under the windscreen's top line over the seat, in the middle of the side window, and 1.15 m above
the floor. The panel face is 0.60 m ahead of the eye, with its top 0.27 m below the eye. It shows P3's 2048 × 1024
canvas at 1250 px/m, less 64 px on each side (±0.77 m; the cabin is 1.52 m wide inside, 47E §1-8). A 0.12 m
glareshield sits above the panel. There are two crew seats, four club seats, two control wheels on columns, and the
pedals. The knee panel, the centre pedestal and the overhead panel sit behind the windscreen's top edge. The compass
is on the glareshield.

**Quadrant (47E §7-10; owner-notes clarification).** These levers stand on `PC12_PEDESTAL`'s lever slots:

- **MANUAL OVERRIDE.** A white T-grip drawn fixed at OFF (fully aft), using the builder's new `fixed`. The MOR is not
  modelled.
- **POWER CONTROL LEVER.** A black grip working the `throttle` control. Aft of the idle gate it swings on by a further
  0.45 × its 0.8 rad travel as `ControlInputs.reverse` goes from 0 to 1 (`reverseTravel`). A red gate stop and red
  ticks mark the beta/reverse range on the quadrant.
- **CONDITION lever.** A red grip working the `mixture` control. White notches mark its three `detents`:
  CUT-OFF/FEATHER at 0, GROUND IDLE at 0.1, FLIGHT IDLE at 1. The value 0.1 is `turbineEngine.ts` `CUTOFF_BELOW`,
  where LOW IDLE starts. AGENT choice; P1 and P3 should use the same lever values.
- **Flap selector.** Drawn as a lever in a slot low on the panel face over the pedestal, UP to 40 over 80 px.
- **Gear handle.** At `PC12_GEAR_HANDLE`, left of the CAWS.
- **Parking brake handle.** Low on the left of the panel.

There is no propeller lever: the CSU governs 1700 rpm.

## Builder changes (shared, default off)

Each change sits behind a new optional field. Without the field, the old geometry is unchanged, and
`geometry.regression.json` was not re-recorded.

| Field | Builder | Test (`tests/aircraft/variants.test.ts`, "PC-12 builder variants") |
| --- | --- | --- |
| `tail.h.trim {pivotFraction}` | `tail.ts`: stabiliser and elevators on one hinge, which is `tabs[0]` with gearing 0 | trimmable stabiliser: LE up and TE down by 0.05 × arm; elevators still turn; refused together with a tab |
| `tail.strakes` | `tail.ts`: mirrored lens plates out of the lower skin | ventral strakes: mirrored, within their stations, below the widest line, beyond the skin |
| `fuselage.exhaust.mirror` | `fuselage.ts`: the second stack mirrored in y | pc12Visual: both stubs stand out more than 0.6 m from the centre line |
| `wing.boots[]` | `wings.ts`: black skin round the leading edge, 2 mm proud | de-ice boots: within their span and chord, mirrored, facing out |
| `OutlineDef.oval` | `livery.ts`: exact window distance near the corners, so the seal follows an oval instead of drawing its bounding box | oval window: box distance 5 mm against the exact 4 cm or more at the corner |
| engine-control `reverseTravel`, `detents`, `fixed` | `cockpit.ts`: the aft swing with `reverse` (per-engine overrides respected), the notches, the gate and arc, a never-animated lever | quadrant: gate, full reverse, per-engine reverse, fixed lever unmoved, marks present |
| (no change) four-blade variable pitch | `propeller.ts` | four blades into reverse: 4 instances, balanced, −17.5° on every blade |
| (no change) trailing link folding inward with a door | `gear.ts` | trailing-link mains folding inward: the axle on the rigid swing of its post hinge |

T1b sets the C208's lever `reverseTravel` in `c208/visual.ts`, not this package.

## Measured against the targets (`tests/aircraft/pc12Visual.test.ts`)

| Item | Target (source) | Built |
| --- | --- | --- |
| Span | 16.28 m ±1 % (TCDS) | 16.283 m |
| Length, spinner tip to tail light | 14.408 m ±1 % (TCDS) | 14.424 m |
| Height, ground to beacon on the bullet | 4.26 m ±2 % (TCDS) | 4.31 m (bullet top 4.25 m) |
| Propeller diameter | 2.67 m exact (TCDS) | 2.67 m |
| Track / wheelbase | 4.53 / 3.48 m ±3 % (3V) | 4.53 / 3.48 m (geometry.ts contacts) |
| Propeller tip clearance at rest | — | 0.30 m |
| Eye | within 3 cm of `PC12_EYE` | **not met against the scaffold value**: 3V eye at station 4.20, 2.33 m (see below) |
| Render cost over the C172S, chase view | ≤ +30 draws, ≤ +60 000 triangles (c208Visual pattern) | within, in flight and on the ground |

## Requested geometry changes (P1, `src/aircraft/pc12/geometry.ts`)

The scaffold's `PC12_FUSELAGE` heights, `PC12_EYE`, `rootChordPlaneZ` and the stowed gear points were read from Fig
1-1's 6 ft bracket as if it stood on the ground. The bracket is the fuselage depth, and it sits on a belly about 1 m
up (page rows 1014 and 1089 against the ground line at row 1130). The hub at 1.635 m (3V 1.60–1.73) needs no
change. Requested values, all tagged 3V (POH Fig 1-1, PDF p. 70); they are exported as `PC12_VISUAL_HEIGHTS`:

| Name | Now | Requested |
| --- | --- | --- |
| `PC12_FUSELAGE.roofZ` | H(2.33) | H(2.73) |
| `PC12_FUSELAGE.bellyZ` | H(0.50) | H(0.93) |
| `PC12_WING.rootChordPlaneZ` | H(0.70) | H(1.05) |
| `PC12_EYE` | station 4.00, H(2.03) | station 4.20, H(2.33). At 4.00 the windscreen glass stands 0.25 m in front of the face. The W&B pilot arm, 4.071 m, is the occupant's CG, not the eye. |
| `PC12_GEAR.stowed.leftMain/rightMain` | station 6.25, y ∓1.05, H(0.62) | station 6.30, y ∓1.51, H(1.08): the drawn swing |
| `PC12_GEAR.stowed.nose` | station 3.20, H(0.75) | station 3.62, H(1.29) |
| `PC12_GEAR.hinges` | mains at y ∓1.95, H(0.85); nose station 2.75, H(0.95) | mains axis +x at station 5.92, y = contact y, H(1.08), angle ±90°; nose axis +y at station 2.74, H(1.12), angle −96° |
| wing tip | flat wing to 8.14 m | flat wing to 7.88 m, with a 0.45 m winglet canted 62° reaching 8.14 m |
| aileron outer end | 7.95 m | 7.80 m (8 cm inside the flat tip) |

## Known issues (for `src/aircraft/pc12/KNOWN_ISSUES.md`, owned by P1)

- The windscreen is one lofted surface cut by a sill plane and A-post lines. The real windscreen has two flat panes and
  a centre post, and the centre post is not drawn.
- The legs vanish at extension 0, so the main tyres standing about 25 mm proud of the wing root are seen only in the
  last few per cent of the swing.
- The flap selector is drawn as a panel-face slot lever over the pedestal, not as the real pedestal lever right of the
  power controls.
- The MOR is drawn fixed at OFF (not modelled). There is no aileron trim tab.
- The stabiliser pivot (65 % chord), the tailplane incidence (−1.5°), the wing incidence and washout (2° to 0°) and the
  winglet cant (62°) are ESTIMATE.
- The exhaust stubs are round, not oval.
- The cabin is drawn with four club seats (the executive cabin), not the nine-seat commuter cabin.
- Until P3 lands, the PC-12 panel is the C208's 2920 × 920 canvas mapped onto the PC-12's 2048 × 1024 face. One C208
  hotspot (`dgAlign`) falls outside the shown face.

## Shots

The shots are in `work/pcmd/shots/P2/` (not committed):

- `pc12-sheet.png`, `pc12-sheet-landing.png`
- `pc12-side.png`, `pc12-front.png`, `pc12-rear.png`, `pc12-34.png`
- `pc12-gear-transit.png`, `pc12-fowler.png`
- `pc12-cockpit.png`, `pc12-cockpit-reverse.png`, `pc12-quadrant-reverse.png`, `pc12-prop-reverse.png`
- `pc12-viewout.png`, `pc12-cruise.png`, `c208-cockpit-reverse.png`

Until P1 and P3 land, the sim pages fly and show the C208's definition and panel. In flight the gear stays down, and
the dev page's side view shows the C208's rest attitude.
