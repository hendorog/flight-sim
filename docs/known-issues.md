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
| MBB Bo 105 CB-4 (in development, `available: false`) | [45 entries](../src/aircraft/bo105/KNOWN_ISSUES.md) (22 from the flight model, 23 handed over) |
| Lockheed AH-56A Cheyenne (in development, `available: false`) | [53 entries](../src/aircraft/ah56/KNOWN_ISSUES.md) (15 from the stage-2 flight model, 33 handed over from TW, AU, PN, AX, AC and AH, 5 integration dispositions; see [ah56-integration.md](ah56-integration.md)) |

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
from the first-harmonic pitch, Pitt-Peters feedback from the pitch moment into the mean inflow and wake-curvature terms.
Periodic flap damping reaches the flap harmonics only through the cone (about -2 % hub moment per cyclic at mu 0.35,
against the plan's 3-9 %; on the AH-56A +1.6 % at mu 0.5 against the plan's 8-15 %, H9). Two AR-280 rows miss at
their band edges on the Bo 105: Zw -0.68 1/s (edge -0.70) and Lq/|Lp| 0.19 (band 0.25-0.50).
Evidence: `tests/rotorcraft/hingelessAr280.test.ts` and `bo105Derivatives.test.ts` (it.fails rows).
On the Bo 105 the one-way harmonic inflow raises the hover roll damping (Lp -8.8 -> -12.1 1/s) and doubles Mu and Lv,
so the hover diverges in 2.3 s instead of 17 s and a gentle pilot loses it (Bo 105 KNOWN_ISSUES 17). The AEO climb
turns 83 % of the excess shaft power into climb against the 60-72 % the Bo 105 sources imply (Bo 105 KNOWN_ISSUES 2).
Close with: a lag degree of freedom, Bo 105 hover identification data (Fu & Kaletka 1993, not obtained; the ERF 1989
DLR/AFDD paper, obtained, covers 80 kt only), a manoeuvre-wake inflow model.

### Hingeless rotor in-plane force at zero airspeed (AH-56A, Bo 105) — **defect**

`Rotorcraft.compute` applies the main rotor's in-plane force only when the hub airspeed is above zero, along the
airspeed direction, and drops its side component. A trim at exactly zero airspeed sees none; the first step's 1e-7 m/s
switches on the full hover value (about 330 N on the AH-56A, which flies harmonic cyclic pitch) along an arbitrary
direction: 625 N m of roll and 236 N m of pitch the trim never saw. The AH-56A's hands-off hover leaves its trimmed
attitude in 20 s (AMCS −5.4 → −1.9° roll, ICS −5.3 → −10.5°). A fade over the first 0.3 m/s, gated on the control
gyro, fixes the AMCS hover but moves the hover step responses the gyro was fitted on, so it was not applied
([ah56-integration.md](ah56-integration.md) section 3 item 7). Whether the Bo 105's hover divergence (its KNOWN_ISSUES 17)
shares the cause was not checked.
Close with: the in-plane side component carried through `rotor.ts` / `rotorcraft.ts` (RC), then the AH-56A gyro refit.

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
