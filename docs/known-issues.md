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
| Pilatus PC-12/47 (not yet available) | [21 entries](../src/aircraft/pc12/KNOWN_ISSUES.md) |
| Robinson R22 Beta II | [7 entries](../src/aircraft/r22/KNOWN_ISSUES.md) |
| Robinson R44 Raven II | [12 entries](../src/aircraft/r44/KNOWN_ISSUES.md) |
| Schweizer 269C-1 / 300CB | [12 entries](../src/aircraft/s269/KNOWN_ISSUES.md) |
| MD Helicopters MD 500E (not yet available) | [14 entries](../src/aircraft/md500/KNOWN_ISSUES.md) |

Kinds: **defect** = demonstrated wrong behavior; **unvalidated** = evidence or acceptance still missing;
**estimate** = a parameter without a measured/published value; **missing feature** = behavior not implemented.
Scope is the current [registry](../src/aircraft/registry.ts). Later integration reports take precedence over
older worker handoffs; an estimate is not by itself proof of a handling defect.

## Cross-aircraft issues

### Fixed-panel lighting — **missing feature**

The flat panel does not reproduce 3D cockpit lighting or dimmer shading, although dimmer state is shared.
Evidence: [README fixed-panel limitations](../README.md#controls) and [FixedPanel.draw](../src/ui/fixedPanel.ts).
Close with: a lighting/dimmer presentation for the flat canvas and day/night comparisons.

### Fixed-panel control coverage — **missing feature**

Decorative radio controls and 3D parts without panel hotspots are not operable in the fixed panel.
Evidence: [README fixed-panel limitations](../README.md#controls); existing keyboard actions remain available where defined.
Close with: hotspot/action definitions for the missing controls and pointer/keyboard parity checks.

### Turboprop full power in the autothrottle and the instructor — **defect (latent)**

The autopilot's autothrottle and the instructor's recovery (`c.throttle = 1`, src/training/copilot/instructorPilot.ts)
command the full power lever. On the C208 that is about 2270 ft lb against the 1865 limit (its take-off lever is 0.885);
the PC-12's torque limiter caps it at 44.3 psi. Latent: neither turboprop is in the syllabus, and the approach
autothrottle rarely goes near full.
Evidence: [C208 targets](../tests/conformance/targets/c208.ts) `C208_TAKEOFF_LIMITS`; T1b hand-over (integration).
Close with: an optional maximum autothrottle lever in `AutopilotGains`, used by the instructor's recovery too.

### Reverse held to a stop with full brakes — **defect**

On a turboprop with reverse (C208; the same on the turbine-core test-bed), full reverse held to a standstill with full
brakes unloads the nose and one main and collapses the other main leg (55-71 kN). Out of reverse to ground fine by 40
KIAS, as the handbooks say, the roll ends normally. Not reproduced on the PC-12's conformance rolls (cancelled at 40 KIAS).
Evidence: [C208 known issues](../src/aircraft/c208/KNOWN_ISSUES.md), [turbine model](turbine-model.md) hand-over 3.
Close with: the brake and tyre model with aft thrust near zero speed (src/physics/gear).

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
Evidence: [README aircraft scope](../README.md#aircraft), [R44 definition](../src/aircraft/r44/index.ts), [269 exterior/audio limits](s269-exterior.md), [R22 definition](../src/aircraft/r22/index.ts).
Close with: validated type-specific training/demo content and acoustic references for each helicopter.

## Test evidence

There are two gross/solo expected-failing autorotation landings per helicopter: [R22](../tests/rotorcraft/flights.test.ts),
[R44](../tests/rotorcraft/r44Flights.test.ts) and [269](../tests/rotorcraft/s269Flights.test.ts).
Passing companion trajectory checks does not accept those landings.
The [conformance open-request list](../tests/conformance/requests.ts) is empty. Skipped training tests are opt-in
coverage (for example [FS_CONFORMANCE](../tests/training/conformance.stage1.test.ts) and
[FS_REMARKS](../tests/training/syllabus.remarks.test.ts)), not additional recorded aircraft defects.
