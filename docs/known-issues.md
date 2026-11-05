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

### Landing damage: stage-A calibration gaps — **estimate**

The leg loads of the landing-damage model (`src/physics/damage.ts`, each type's `gear.ts` `damage` block) were set by
drops at MTOW (tests/gear/damage.test.ts), and these gaps remain:
- **PA-34 and PC-12 oleo loads absurdly high.** Their oleo springs stiffen too much near the end of the stroke, so the
  axial loads in a hard landing run far above what a real oleo carries; the hard / yield / ultimate loads were set
  against those numbers, so the bands come out right in sink rate but the loads themselves are not physical. Close
  with: a flatter oleo force curve (efficiency about 0.8 over the stroke), then the damage loads re-set by the drops.
- **Spring mains: owner's strength, not the research's.** On the owner's judgement the spring and leaf mains (C152,
  C172S, PA-38, DA20, C208) yield at about 6 m/s mains-first and their ultimate load is an 8 m/s drop's, beyond the
  7 m/s terrain impact (any wheel on the ground with the CG sinking faster than that is the impact crash), so a main
  collapse is not reachable in a level landing; a one-wheel arrival can still load one leg past it. The research's
  bands (§7: Cessna bent 4.3-4.6 m/s, collapse 6.6-6.9; PA-38 / DA20 bent 3.0, collapse 5.0) are no longer used for
  these legs. The permanent set is small (about 1-3 cm between 6 and 7 m/s; `maxSet` 0.04 m at the ultimate load).
- **PA-38 wing-skin stop: estimated clearance.** The leaf travel to the tyre's strike on the lower wing skin
  (`MAIN_STOP` 0.30 m in pa38/gear.ts) is an estimate from the geometry (+/-0.04 m), reached at about 5.3 m/s
  mains-first at MTOW (the owner expected 4.5-5). Beyond it the top of the tyre squashes against the skin at the
  tyre's own stiffness (125 kN/m). Close with: a measured tyre-to-skin clearance; 0.28 m would put the strike at
  about 4.9 m/s.
- **Spring main legs deflect far.** The linear leg springs carry no stop of their own (the PA-38's wing skin
  excepted): a C172S main flexes about 0.33 m along its axis at 6 m/s and 0.43 m at 7 m/s. Close with: a measured
  leg load-deflection curve, then the damage loads re-set by the drops.
- **Propeller contact time is cumulative.** The time a propeller has spent touching the ground (`propDigTime`, 0.12 s)
  adds up over the whole flight, so several light tip strikes on separate bounces can add up to a dig-in that stops
  the engine. Close with: a contact time that restarts once the disc has been clear for a moment.
Also: the solo-lesson debrief after disabling damage says "That flight ended in a crash"; career repair costs and
grounding days (`DAMAGE_RULES`) are estimates for the owner to tune; lesser damage is dropped by an aircraft hot swap
and by a Career refuel at a stop (both start a new flight model; the Career keeps billing what was recorded).

### Ground rolling resistance: estimates and knock-ons — **estimate / owner decision**

Rolling resistance is now tyre hysteresis from the tyre's deflection, a surface sinkage term and a breakaway at rest
(docs/simulator.md, Ground rolling resistance). Open items:
- **Coefficients are estimates.** `HYSTERESIS` 0.145 and `BREAKAWAY` 0.1 (tyre.ts) and the grass `rollingDrag` 0.045
  (surfaces.ts) are set to the owner's handling report and the handbook ranges, not to a measured tyre. `HYSTERESIS`
  0.12 is the value that keeps the C172S short-field roll inside 10 % of the POH (then coasting at idle from 12 kt
  takes 70-80 s to stop and the PA-38 does not stop within 2 min).
- **C172S short-field roll band widened to 15 %** (ground.test.ts, conformance target): 330 m against the POH's 293
  (+12.5 %; it was +6 % at the old 0.02). The other light types moved toward their handbook rolls. Close with: the
  C172S take-off calibration (thrust or lift-off), then the band back to 10 %.
- **DA20 runs away at idle on pavement once rolling.** Its 1020 rpm idle (AFM) gives about 477 N of static thrust,
  0.061 of its weight. Its static Ct (0.146) is the same at every rpm and the highest of the light types (0.128-0.14),
  with the lowest figure of merit (0.67 against 0.79-0.83), although its Sensenich W69EK7-63 is the coarsest of their
  propellers (P/D 0.91 against 0.78-0.84); its section's full-static calibration leans on a maximum-lift loss with
  Mach number above 0.3 (da20/powerplant.ts clMaxMachLoss 1.0), which is silent at idle (M 0.2 at 0.75 R). From rest
  it stays put (it breaks away at about 1110 rpm), but from a taxi speed it accelerates to about 25 kt: coasting to a
  stop would take an idle static thrust below about 0.038 of its weight (300 N). Tried and withdrawn: blade-section
  losses at low Reynolds number (clmax with Re^0.15, profile drag with Re^-0.2 below Re 1e6, the order of NACA TR
  586) took only 4 % off the DA20's idle (477 -> 460 N; Re about 6e5 at its idle against 4e5 for the Cessnas', which
  lost 9-12 %), left full-power static thrust within 0.1 %, but stopped the C152, C172S and PA-38 propellers
  windmilling at best glide (0 rpm against the POH's windmilling glide) and moved every flight golden. Not done:
  a DA20-only propeller recalibration (owner request, 2026-11-03). With Ct flat in rpm the idle thrust is the
  full-power static thrust times (1011 / static rpm)^2, so 300 N at idle needs a full-power static thrust under
  1550 N at the AFM band's top static rpm (2300; 1170 N at 2000), a static figure of merit near 0.3 at the 75-80 kW it
  absorbs there, against the 2.4 kN the gear comment cites (AFM 4.4.7) and the other types' 0.79-0.83. Bringing the
  figure of merit in line (0.8) instead raises the idle thrust to about 600 N. Lighter blades (chord 1.2 -> 0.7 x the
  172's) did reach 276 N at idle with the take-off roll still in its band (419 m), but at 2640 static rpm and with the
  cruise calibration (2800 rpm at 129 KTAS) gone. Close with: owner decision; a Reynolds-number model that leaves
  windmilling alone, or the DA20's documented fast idle taxi accepted.
- **Turboprop tyres: a lower hysteresis factor (owner decision).** The C208's and PC-12's tyre springs now follow
  their inflation pressures (three times softer than before), and with the light types' `HYSTERESIS` their rolling
  resistance would be 0.038-0.040 (0.065 at rest): none of the idle-taxi cases moves at maximum weight even after
  the pilot breaks the aircraft away, the PC-12 landing roll falls to 357 m (band 359-419), and the PC-12 at ground
  idle on the gate, which its handbook taxis in beta because it is too fast, stands still. They use
  `TURBOPROP_HYSTERESIS` 0.08 instead (about 0.022, Torenbeek's 0.02 for transport tyres near rated deflection).
  At maximum weight the idle levers alone still do not start them (measure.ts idleTaxi breaks them away with power:
  "a fair amount of breakaway power", AOPA 2009). The C208 pressures (60 psi mains, 40 psi nose) are ESTIMATES
  without its POH section 8. The softer tyres take more of a hard landing's energy, so the C208's and PC-12's
  landing-damage loads were re-set by the drops to keep their sink-rate bands.
- **Keyboard rotation in the gusty crosswind (C172S) fails its tail-strike margin.** tests/input/rotation.test.ts:
  the closed-loop key pilot now reaches 12.5-14 deg nose-up with a main wheel still down (limit 12; the tie-down ring
  touches at about 13), against 9.8-11.6 before. The preset has no margin: on the old model a flat 0.022 instead of
  0.02 already puts one seed at 12.9; a flat 0.035 gives 12.7-13.7 and `HYSTERESIS` 0.12 fails three seeds of four.
  The calm-air key-pilot rotation hardly moves (8.3 -> 8.4 deg on the mains). Mechanism (seed 0 traced): the mains'
  larger drag, below the centre of gravity, needs more back elevator to lift the nosewheel (0.17-0.19 against
  0.136-0.141); as the wheels unload (their drag goes as load^1.5) the wound-in elevator becomes excess and the nose
  comes up at 13-15 deg/s against 10-12, faster than the hold-position yoke can be eased forward on the keys; gust
  lulls (43-47 KIAS) force a second rotation with more wound in. The key pilot now rotates at Vr plus half the gust
  factor (the usual gusty-day technique, owner decision): seeds 0, 2 and 3 pass (11.2, 11.2, 9.5 deg), seed 1 reaches
  12.05 and is an expected failure (keyboardFlight.ts gustKnownFail). The 12 deg limit stands. Close with: owner check
  of a keyboard rotation in gusts.
- **C152 main tyre spring.** 125 kN/m, as the PA-38's at 30 psi, although the C152's mains run at 21 psi (about
  87 kN/m by Raymer's estimate): its rolling resistance is a little low for its soft tyres.

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
(run with `--silent=false` to see the measured values); [ah56-integration.md](ah56-integration.md) sections 12-15.
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

### Parked aircraft carry no registration — **missing feature (cosmetic)**

The home apron's parked aircraft (`world/airport/props.ts` ParkedAircraft) share one livery per type, baked without a
registration: a per-aircraft bake would hold its own textures (~86 MB at the C172S's size). The AI traffic's own
exteriors carry theirs.
Close with: a registration-only decal per parked aircraft (a small texture over the shared livery), or per-aircraft
bakes at the downsampled 1024 px size (~5 MB each).

### First AI exterior can stall on its shader compile — **defect (performance), pre-existing**

The first traffic exterior drawn compiles its materials' programs on that frame (a few hundred ms on a slow GPU) unless
a parked aircraft's full-detail model, which uses the same programs, was drawn first (the player started within 50 m
of one).
Close with: `renderer.compileAsync` on a new exterior before it is shown (the far model meanwhile).

### AI traffic taxis round corners in a series of jinks — **resolved 2026-11-05, owner to check in the sim**

Owner report: an AI aircraft took a taxiway corner as a polygon, short straights joined by abrupt heading changes.
`stepTaxi` slewed the heading at 25 deg/s toward each point of the rounded route, so it stepped at every point:
1500-3000 deg/s/s of yaw acceleration, 33-112 steps per route. It now steers on the arc to a point 6 m (or 1.5 s)
along the route from abeam it, and the yaw rate follows that arc's rate through a 0.35 s nosewheel lag: 16-28
deg/s/s, no steps, within 1.7 m of the route. An arrival used to be turned from nose-in to nose-out at once on its
spot; it now swings round there in about 10 s (`turnOnSpot`). `tests/atc/taxiSteer.test.ts`.
Check: from a cockpit following an AI aircraft round the apron corners and onto its spot.

### AI aircraft sat on their wheel hubs — **resolved 2026-11-05, owner to check in the sim**

Owner report: an AI PA-38 on the ground had its hubs at the ground. Every type did, when posed rather than flown
(all of them on the ground). Two causes:
- The kinematic pose stood it at the field elevation, but the drawn pavement is raised (taxiways 5 cm, runway 9 cm),
  and the flight models stand on it.
- After being posed in the air, its gear stayed hanging free on the ground (about 5 cm more).
It now stands on the ground the flight models feel, with each type's strut compressions and pitch taken from the
flight model settled at rest. `tests/atc/trafficPose.test.ts`; `scripts/probes/traffic-wheels.mjs` pictures each AI
aircraft on the ground at wheel height, with how high it stands (a parked DA20: 1.020 m before, 1.072 m after,
rest 1.07 m).

### External camera slowly drifts down to the ground — **defect (owner report 2026-11-05), cause not yet found**

In an external view the camera creeps down by itself until it sits at the ground. Candidates:
- The mouse/trackpad drag adds to `elevation` (chaseRig) or `targetElevation` (orbitRig) without a dead-band or
  decay, so a captured pointer's small residual dy accumulates. This is the likeliest on a laptop.
- The chase frame's pitch lag (PITCH_FOLLOW, PITCH_TAU) settles nose-down.
- The ground-clearance clamp (1.0 m) pushes the camera along the ground instead of up.
Close with: log `elevation` / `targetElevation` and the pointer dy over a minute with hands off, in both rigs, then
fix the source (a dead-band on the drag, or ignore motion while the pointer is not dragging).

### Yellow taxiway lines broaden and blur with distance — **defect (owner report 2026-11-05)**

The further away a yellow line is, the wider and fuzzier it looks. The likely cause is in `world/airport/pavementGlsl.ts`.
Taxiway centrelines, lead-on lines and the tie-down tees are box-filtered over `fw = 0.5 * (w.x + w.y)`, the
average of the pixel footprint along the layout's u and v axes. Seen at a grazing angle, a pixel spans many metres
along the view and only centimetres across it, so that average is much wider than the footprint across the line.
The 15 cm line is spread over it, which is why it looks broad and blurred. Lines straight ahead are hit hardest,
and the curves join at an angle that suits neither axis.
Close with: filter each line over its own footprint across the line,
`length(vec2(dFdx(d), dFdy(d)))` of its distance d (segDist / arcDist / leadOnDist), rather than the averaged
axes. Optionally, past a pixel's worth of footprint, keep the width and fade the line out instead of spreading it
(a long-thin-line correction).
Check: cockpit shots along taxiway A at 100, 300 and 600 m, before and after. The runway's side stripes and centreline already
use per-axis w.x / w.y (aligned with the runway); if they stay sharper in the same shots, that supports the diagnosis.

## Career

Open items of the air-operator career ([career.md](career.md), on `feat/career` as of 2026-11-01).

### R44 at sloped sites — **unvalidated**

The wave-4 build saw the scripted pilot's R44 mast-bump while setting down at a sloped medevac site, possibly from a
skid contact impulse rather than the pilot's inputs. Sites are held under 5 deg (`SITE_RULES`), but nothing has
measured an R44 set-down at the steepest ones; no test pins the case.
Evidence: [sites.ts](../src/career/sites.ts) `SITE_RULES`; the R44's own
[known issues](../src/aircraft/r44/KNOWN_ISSUES.md).
Close with: a headless R44 set-down at the steepest sites of seeds 0 and 7 recording the mast angle and skid loads,
and a lower `maxSlopeDeg` or a pilot fix if it bumps.

### Medevac GPS points at the hospital, not the site — **missing feature**

The GPS direct-to is the destination field; the strip and the smoke flare show the site. The board's detail and the
dispatch page say so, the strip does not. A GPS user waypoint would change the instrument code the moving map uses.
Evidence: [board.ts](../src/career/ui/board.ts) `routeRule`.
Close with: a user waypoint in the navigation module set to the site until it is done, then the hospital.

### Medevac deadlines are generous — **estimate**

A medevac's deadline is the base formula: 25 min of taxi, the route at slack 1.3 and 15 min in hand, so a 10 NM route
(to the site and on to the hospital) in a piston helicopter allows 55 min for under 10 min of cruise. On time is easy.
Evidence: [types.ts](../src/career/types.ts) `PAY_RULES.medevac`, `DEADLINE_RULES`.
Close with: the owner's flights; a shorter taxi allowance and margin for medevac if they agree.

### Smoke flare grainy on low quality — **defect (cosmetic)**

The flare is drawn opaque with stochastic transparency, which the temporal anti-aliasing averages into a plume on
medium quality and up. On low there is no temporal pass, so the plume shows as moving grain.
Evidence: [smokeMarker.ts](../src/career/render/smokeMarker.ts) header.
Close with: a blended fallback on low quality, drawn after the post chain's sky.

### First board after a boot is slow — **defect (performance)**

A helicopter site is resolved when a board first draws its anchor (the vegetation query costs a few milliseconds a
cell), so the first board with wave-4 offers can take up to about 400 ms; later boards use the cache.
Evidence: [sites.ts](../src/career/sites.ts) header.
Close with: resolving the sites in idle time after the boot, or in a worker.

### Load-sheet CG band is the type's preset loadings, not its envelope — **estimate**

The dispatch page's CG band runs between the CGs of the type's own `forward` and `aft` loadings (`CareerPerf.cg`). For
the PC-12 the empty airframe (0.15 m) is already forward of that band (0.10 m), so a light load with a pilot alone
shows the amber "forward of the PC12's usual loadings" warning although it is an ordinary loading. It only warns.
Evidence: [perf.ts](../src/career/perf.ts) `pc12.cg`; [loadsheet.ts](../src/career/loadsheet.ts) the `cg` warning.
Close with: each type's POH CG envelope (forward and aft limits against mass) in the table.

### Hub's last-job card covers the Checklist button — **defect (cosmetic)**

At 1280x720 the hub's "Last job" card sits over the top-right "Checklist · F" button; only its edge shows.
Close with: moving the card below the button, or hiding the button while the hub is open.

### Slow board test — **test time**

The 200-board check in `tests/career/system.test.ts` (every class-eligible type through the real load sheet at
seeds 0 and 7) takes close to 5 s, near the default test time limit.
Close with: fewer boards in the fast run and the full 200 in the slow list.

### Review fixes left partial — **missing feature**

- Survey and scenic points passed above the height limit are not tracked one by one; the route-missed debrief names
  the limit but not which points were too high (a new report field).
- A save written by a newer version is read-only, but a placed job in it is still placed at boot (never saved).
- A tab holding a stale save says so on its next command or hub refresh; with no `storage` event listener its
  in-memory state differs until the player reloads.
- A lost job's report keeps block time 0 (the abandon, give-up and rest reports carry the flown time).

### Not yet flown in the browser — **unvalidated**

Covered by headless and unit tests only: `scripts/fly-job.mjs` after the review fixes (its `career=1` check now
expects the parameter consumed), the stale-tab and read-only banners, the hub's "Fly it" for a parked job, Abandon
at a medevac site, the held sim under the "Abandon the job?" card, a full medevac with the smoke flare and the
spot cue, a survey below 500 ft AGL, and the company callsign in a live radio exchange. The owner's three-job
flight (C152, C172S, R44) is still owed.
Close with: those flights in the browser, and `node scripts/fly-job.mjs` re-run.

## Test evidence

There are two gross/solo expected-failing autorotation landings per helicopter: [R22](../tests/rotorcraft/flights.test.ts),
[R44](../tests/rotorcraft/r44Flights.test.ts) and [269](../tests/rotorcraft/s269Flights.test.ts).
Passing companion trajectory checks does not accept those landings.
The [conformance open-request list](../tests/conformance/requests.ts) is empty. Skipped training tests are opt-in
coverage (for example [FS_CONFORMANCE](../tests/training/conformance.stage1.test.ts) and
[FS_REMARKS](../tests/training/syllabus.remarks.test.ts)), not additional recorded aircraft defects.
