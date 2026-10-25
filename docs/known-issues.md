# Known aircraft issues

Outstanding work is kept beside each aircraft model, ordered by pilot impact:

| Aircraft | Issues |
| --- | --- |
| Cessna 172S | [1 entry](../src/aircraft/c172s/KNOWN_ISSUES.md) |
| Cessna 152 | [6 entries](../src/aircraft/c152/KNOWN_ISSUES.md) |
| Piper PA-38 Tomahawk II | [7 entries](../src/aircraft/pa38/KNOWN_ISSUES.md) |
| Diamond DA20-C1 | [7 entries](../src/aircraft/da20/KNOWN_ISSUES.md) |
| Piper PA-34 Seneca I | [8 entries](../src/aircraft/pa34/KNOWN_ISSUES.md) |
| Diamond DA42 NG | [1 entry](../src/aircraft/da42/KNOWN_ISSUES.md) |
| Cessna 208 Caravan 675 | [8 entries](../src/aircraft/c208/KNOWN_ISSUES.md) |
| Pilatus PC-12/47 (in development) | [24 entries](../src/aircraft/pc12/KNOWN_ISSUES.md) |
| Robinson R22 Beta II | [7 entries](../src/aircraft/r22/KNOWN_ISSUES.md) |
| Robinson R44 Raven II | [12 entries](../src/aircraft/r44/KNOWN_ISSUES.md) |
| Schweizer 269C-1 / 300CB | [12 entries](../src/aircraft/s269/KNOWN_ISSUES.md) |
| MD Helicopters MD 500E (in development) | [14 entries](../src/aircraft/md500/KNOWN_ISSUES.md) |
| MBB Bo 105 CB-4 (in development, `available: false`) | [Bo 105 known issues](../src/aircraft/bo105/KNOWN_ISSUES.md) (the flight model, the integration, the flyability pass, tune pass 1 and its round 2, tune pass 2, its fix round and that round's gate; items handed over by other packages; the open beginner rows are summarised below) |
| Lockheed AH-56A Cheyenne (in development, `available: false`) | [AH-56A known issues](../src/aircraft/ah56/KNOWN_ISSUES.md) (15 from the stage-2 flight model, 33 handed over from TW, AU, PN, AX, AC and AH, 5 integration dispositions, 7 from the pilot-review round, the final fix round, and the tuning rounds T1-T11; see [ah56-integration.md](ah56-integration.md) sections 11-15; the open beginner rows are summarised below) |

Kinds: **defect** = demonstrated wrong behavior; **unvalidated** = evidence or acceptance still missing;
**estimate** = a parameter without a measured/published value; **missing feature** = behavior not implemented.
Scope is the current [registry](../src/aircraft/registry.ts). Later integration reports take precedence over
older worker handoffs; an estimate is not by itself proof of a handling defect.

## Cross-aircraft issues

### Fixed-panel lighting — **missing feature**

The flat panel does not reproduce 3D cockpit lighting or dimmer shading, although dimmer state is shared.
Evidence: [fixed-panel limitations](controls.md#fixed-instrument-panel) and [FixedPanel.draw](../src/ui/fixedPanel.ts).
Close with: a lighting/dimmer presentation for the flat canvas and day/night comparisons.

### Fixed-panel control coverage — **missing feature**

Decorative radio controls and 3D parts without panel hotspots are not operable in the fixed panel.
Evidence: [fixed-panel limitations](controls.md#fixed-instrument-panel); existing keyboard actions remain available where defined.
Close with: hotspot/action definitions for the missing controls and pointer/keyboard parity checks.

### Turboprop full power in the autothrottle and the instructor — **defect (latent)**

The autopilot's autothrottle and the instructor's recovery (`c.throttle = 1`, src/training/copilot/instructorPilot.ts)
command the full power lever. On the C208 that is about 2270 ft lb against the 1865 limit (its take-off lever is 0.885);
the PC-12's torque limiter caps it at 44.3 psi. Latent: neither turboprop is in the syllabus, and the approach
autothrottle rarely goes near full.
Evidence: [C208 targets](../tests/conformance/targets/c208.ts) `C208_TAKEOFF_LIMITS`; T1b hand-over (integration).
Close with: an optional maximum autothrottle lever in `AutopilotGains`, used by the instructor's recovery too.

### Reverse held to a stop with full brakes — **not reproduced on the integrated aircraft; test-bed not re-run**

At T1b, full reverse held to a standstill with full brakes collapsed a C208 main leg (55-71 kN). Re-run on the
integrated C208 and PC-12 (polish 2026-10-17: landing roll with no cancel, then reverse and full brakes held 10 s at
the stop, four loadings each): no crash. C208 rolls 180-196 m, mains at most 20.3 kN, reverse -2.9 kN at Np 1801 and
Ng 85 %; PC-12 at maxGross, MLW and the forward limit mains at most 25.5 kN. The PC-12 at MTOW on its aft limit sits
back on its tail (13.7 deg, nose wheel off 9.6 s): a CG and thrust matter on ESTIMATE geometry (CG height 1.54 m, hub
1.635 m), tracked in its own KNOWN_ISSUES. The turbine-core test-bed graft has no reverse-to-stop case and was not re-run.
Evidence: [C208 known issues](../src/aircraft/c208/KNOWN_ISSUES.md), [PC-12 known issues](../src/aircraft/pc12/KNOWN_ISSUES.md),
[turbine model](turbine-model.md) hand-over 3.
Close with: the same case on the test-bed graft; a reverse-to-stop conformance item if a POH gives the technique.

### Human helicopter input in wind — **unvalidated**

R22/R44/269 mouse hover is covered by a calm 20-second script, not human wind/gust trials; R22 keyboard trials are also calm-only.
Evidence: [mouse hover tests](../tests/rotorcraft/mouse.test.ts), [R22 control evidence](r22-flight-model.md) and the individual aircraft lists.
Close with: human mouse/keyboard/hardware trials in steady wind and gusts, recording drift and workload.

### Magnetic compass errors — **implemented; approximate field and calibration**

All aircraft now share a damped wet-compass model with dip/turning errors, ANDS, force-driven swing, an 18° tilt
stop and per-aircraft residual deviation. Cockpits use a rotating/tilting spherical card with a correction
placard; both fixed-panel sections show the same state. DG alignment copies the compass indication.
Evidence: [model, parameters, sources and limitations](magnetic-compass.md), [dynamics tests](../tests/instruments/magneticCompass.test.ts),
[shared 3D compass](../src/render/aircraft/compass.ts).
Remaining: the world retains its zero-variation heading datum; inclination is a latitude/dipole approximation,
and deviation cards/damping are simulation estimates. The DA42 still inherits its existing placeholder cockpit.

### Rotor/ground-contact limits — **estimate / unvalidated**

Reduced cross-tube yielding, soil/edge snagging, blade/airframe intersection, low-speed teeter friction/sailing and 269 gas/poppet support are implemented with estimated coefficients. Flexible-body/soil history and closed blade/body stop-work coupling remain absent; the 269 still has no production lag or ground resonance.
Evidence: [ground-contact model and tests](helicopter-ground-contact.md), including exact airborne comparisons and explicit remaining limitations.
Close with: measured structural, collision, friction and oleo/damper data; coupled-model validation across surfaces, slopes and low-speed rotor conditions.

### Type-specific training and helicopter sound — **missing feature**

Flight School is C172S-only; R44/269 have no demonstrations, and helicopter audio is synthesized without measured type-specific recordings/spectra.
Evidence: [aircraft scope](aircraft.md), [R44 definition](../src/aircraft/r44/index.ts), [269 exterior/audio limits](s269-exterior.md), [R22 definition](../src/aircraft/r22/index.ts).
Close with: validated type-specific training/demo content and acoustic references for each helicopter.

### Hingeless rotor core (Bo 105, AH-56A) — **estimate / missing feature**

The hingeless hub is an equivalent hinge plus a spring inside the existing harmonic flap solver
([model and limits](rotor-hingeless-model.md), section 10). Not modelled: the lead-lag degree of freedom (no air or
ground resonance, no lag loads), blade bending beyond the equivalent hinge and blade torsion, the in-plane side force
from the first-harmonic pitch until the final fix round (now applied), Pitt-Peters feedback from the pitch moment into the mean
inflow and wake-curvature terms.
Periodic flap damping reaches the flap harmonics only through the cone (about -2 % hub moment per cyclic at mu 0.35,
against the plan's 3-9 %; on the AH-56A +1.6 % at mu 0.5 against the plan's 8-15 %, H9). Two AR-280 rows miss at
their band edges on the Bo 105: Zw -0.68 1/s (edge -0.70) and Lq/|Lp| 0.19 (band 0.25-0.50).
Evidence: `tests/rotorcraft/hingelessAr280.test.ts` and `bo105Derivatives.test.ts` (it.fails rows).
On the Bo 105 the one-way harmonic inflow raises the hover roll damping (Lp -8.8 -> -12.1 1/s) and doubles Mu and Lv,
so the hover diverges in 2.5 s instead of 17 s and a gentle pilot loses it (Bo 105 KNOWN_ISSUES 17); the DLR / CERT hover
identification (ERF 1995 VII-7, P) puts the real Bo 105 at 1.7-7 s, so this is kept as the sourced behaviour. The AEO climb
turns 83 % of the excess shaft power into climb against the 60-72 % the Bo 105 sources imply (Bo 105 KNOWN_ISSUES 2).
Close with: a lag degree of freedom, a manoeuvre-wake inflow model (the Bo 105 hover identification is now in the sources:
ERF 1995 VII-7).

### Hingeless rotor in-plane force at zero airspeed (AH-56A, Bo 105) — **resolved in the final fix round**

`Rotorcraft.compute` applied the hingeless rotor's in-plane force as a scalar along the hub's air velocity (the teetering
expression) and dropped its side component, so a zero-airspeed trim met the full hover value (about 330 N on the AH-56A)
along the first step's 1e-7 m/s of drift. `bladeElements` now returns both in-plane components and `Rotorcraft` turns them
back in the BEM's own wind frame (`inPlaneForce`; checked against a direct per-element sum in the articulated frame for
both rotation senses). The AH-56A's hands-off hover now holds (AMCS −5.35 → −5.49° roll, 0.4 kt; ICS −5.25 → −5.13°,
0.3 kt in 20 s calm; was 14.3 / 6.6 kt); the Bo 105's hover phugoid moves from doubling 2.3 s to 2.5 s (still inside the
ERF 1995 flight-identified band). The side component also acts in forward flight, which moved the AH-56A ICS lateral trim
and two sense rows (C17, C23 frozen-controls roll; [ah56-integration.md](ah56-integration.md) section 11).

### AH-56A on the keyboard and trackpad (tuning passes 1 and 2) — **missing feature / owner decision**

The STAB ASSIST (a labelled sim aid, ON by default) lets a keyboard beginner lift off, hover, go out to 40 KIAS and back
at a 0.8 s reaction pace, fly the circuit and land in the hover on a held F5. Open, each with an it.fails KNOWN GAP row or
a recorded measurement ([AH-56A known issues](../src/aircraft/ah56/KNOWN_ISSUES.md) T1-T11):
- The hands-off knock (owner decision, nothing shipped): a 1 s arrow tap then hands off from the 15 m hover drifts
  200-440 m in 60 s; a 2 s tap climbs out to 44-273 m AGL, 957-1,179 m away. Measured options: arming the prop schedule
  only once the nose-down key is held at 15 KIAS (600-824 m, no climb-out, but the deliberate hover -> 40 KIAS -> hover
  takes 33.7-39.5 s instead of 27.1-29.7 s and comes back worse), or the shared translational-rate term at katt 1.0 (5-19 m,
  but the 1.2 s pace's landing heading spun 142 deg, and it is the pitch/roll aid the owner would rather not have).
- The run-on landing on keys (`ah56Assist` it.fails): at the 1.2 s pace the approach touches down at 547-565 fpm and
  collapses a main; full brakes above 20 kt can nose over (2 of 7); the beginner's own Z / X on the wheels crashed 10 of 16.
  The hints put the hover landing first. The ground-roll heading hold (opt-in, AH-56A only) keeps 7 of 7 roll-outs intact
  with brakes below 20 kt.
- Hover -> 40 KIAS -> hover at the 1.2 s pace (`ah56Assist`, `ah56KeyMission` it.fails): not stopped within 90 s, the
  heading 44-57 deg off.
- The IGE engine failure: survivable only in a narrow pull window (1.75-2.25 m of wheel height with the wings levelled;
  hands off only 2.0-2.25 m, 175 kN against the 180 kN limit). The hint now cues the pull on the HUD AGL first reading 8 ft
  (the 6-7 ft cue read 0.5 s late collapsed a main); the test rows still pull on the true height.
- Shift+F5 is gated to act as F5 only below 30 kt of forward air speed: at 35-40 KIAS and 30 m it is still the full
  hand-speed drop and hits the ground 2.5 s later at 2,440-2,740 fpm (a 500 ft AGL gate is proposed). After a run-on the
  walked keyboard pedal centre stays and doubles the next lift-off's heading swing.
- The ICS configuration on keys (needs per-configuration ground presets in SimProfile); the ICS 60 s hands-off oscillation,
  its boom trim (17.1 % of stick) and the 10 in CG case (80-83 % of travel); the unlocked tail-wheel taxi divergence above
  about 5 kt (G13 rows; free-castor physics); Nr minimum 80.7 % against the P 82 % after the 63 KCAS engine failure.
- Physics changes carried by these passes (ESTIMATE, owner-visible): the main-leg collapse load 140 -> 180 kN (one
  constant in `src/aircraft/ah56/gear.ts`), and the AMCS net gyro spring 1059 -> 250 N m/rad with the input rotation
  5 -> 3 deg (`gyro.ts`; the gyro-alone hover was speed- and dihedral-unstable).
Evidence: `tests/rotorcraft/ah56Assist.test.ts`, `ah56KeyMission.test.ts`, `ah56GyroHover.test.ts`, `ah56Ground.test.ts`
(run with `--silent=false` to see the measured values); [ah56-integration.md](ah56-integration.md) sections 13-15.
Close with: the owner's choice on the knock; an approach-path or sink-rate aid above the height-hold band before the run-on
is offered as beginner-safe; the Shift+F5 height gate; SimProfile ground presets for the ICS.

### Bo 105 on the keyboard and trackpad (tuning passes 1 and 2) — **missing feature / defect**

The STAB ASSIST (translational rate command at the hover, attitude hold in cruise, height hold and a climb-rate command on
held F5 / F6, keyboard cyclic limits) lets a keyboard beginner fly the hover, the accelerations, the circuit (6 of 8 rig
variants), the landings and one engine out. Open ([Bo 105 known issues](../src/aircraft/bo105/KNOWN_ISSUES.md), the tune
sections):
- The hand-held stick (mouse yoke / trackpad) in cruise, the fix-round gate's must, not fixed: the datum relaxes toward the
  flown attitude whenever the airspeed falls while the stick moved, so a pointer-0.5 nudge then back to the centre crashes
  6 of 27 and leaves a held attitude error in the rest (up to +14 deg pitch, +47 deg bank). The hand stick also has no
  travel cap (pointer 0.7: 16 of 27 crash; a 1 s nudge in the hover crashes).
- One engine out in cruise (`bo105KeyFlows` it.fails KNOWN OEI-CRUISE TORQUE GAP): holding the cruise attitude at 100 KIAS
  keeps the survivor at 101 % torque (over the 95 % rating); at 120 KIAS (above the OEI Vne) the beginner sinks into the
  ground at 42-45 s unless they follow the hint (slow to about 70 KIAS). No toast or voice at the failure.
- An arrow key held 1.5-3 s at speed then hands off: 9 of 60 dive into the ground (the commanded 9 deg nose-down held).
- KNOWN REVERSAL-DRIFT GAP (an arrow-key reversal in the hover ends 57-59 m away), KNOWN LEVEL-TAPPER GAP (1 s looks past
  30 m at about 20 s, 7 kt), KNOWN TAILWIND GAP (the 10 kt tailwind deceleration with 1 s taps reaches no hover)
  (`bo105KeyFlows`, `bo105KeyTransitions` it.fails).
- The double engine failure has no keyboard landing in 121 variants; the 16 m hover failure sits in the H-V avoid area.
- Pre-existing: the by-hand acceleration ends about 35 kt sideways with full left pedal; the phugoid growth at 120 / 140 KCAS
  is recorded, not fitted; the AEO climb and the AR-280 band edges (see the hingeless rotor core above).
Evidence: `tests/rotorcraft/bo105KeyFlows.test.ts`, `bo105KeyTransitions.test.ts`, `bo105Assist.test.ts`,
`tests/input/bo105Aids.test.ts`; [bo105-flight-model.md](bo105-flight-model.md) sections 9 and 11.
Close with: the speed relaxation of the hand-stick datum only in the fade band, and a hand-stick travel cap; an engine
failure toast (shared UI); a trim mark on the attitude indicator for the level tapper (shared panel); a stronger heading
hold below 10 kt for the tailwind case.

### Multi-engine resume: one-frame gauge glitch — **defect (cosmetic)**

After a resume the published N1 and TOT of a multi-engine type stay at the reset values until the first physics step
(T11 probe: 93.1 against 91.8 % N1 for one frame). `SimPhysics.ts` republishes rotor rpm from the snapshot but not
`engines[i].ng` / `itt`.
Close with: republish them from the snapshot in the restore path.

## Test evidence

There are two gross/solo expected-failing autorotation landings per helicopter: [R22](../tests/rotorcraft/flights.test.ts),
[R44](../tests/rotorcraft/r44Flights.test.ts) and [269](../tests/rotorcraft/s269Flights.test.ts).
Passing companion trajectory checks does not accept those landings.
The [conformance open-request list](../tests/conformance/requests.ts) is empty. Skipped training tests are opt-in
coverage (for example [FS_CONFORMANCE](../tests/training/conformance.stage1.test.ts) and
[FS_REMARKS](../tests/training/syllabus.remarks.test.ts)), not additional recorded aircraft defects.
