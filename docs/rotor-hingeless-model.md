# Hingeless rotor model (the rotor core of the Bo 105 and the AH-56A)

How a hingeless ("rigid") main rotor is flown in this simulator, and what was measured against flight data. Package
RC of the rigid-rotor programme (plan revision 2, section 4). Code: `src/physics/rotorcraft/articulated.ts` (the
harmonic flap solver with the spring, `hubForcing`, `aerodynamicHubMoment`, `flapSystem`), `inflowHarmonic.ts`
(Pitt-Peters harmonic inflow), `rotor.ts` (the blade-element options, `tppPitchHarmonic`), `rotorcraft.ts` (the
hingeless branch), `swashplate.ts` (the control phase), `hingeless.ts` (`hingelessBlade`, `hingelessSpring`),
`groundRotor.ts`. Tests: `tests/rotorcraft/hingeless*.test.ts`, `inflowHarmonic.test.ts`, `rcSeams.test.ts` on the
test-local Bo 105 `hingelessFixture.ts`, with the AR-280 reference `ar280.ts`.

Tags as everywhere in the programme: **P** primary, **D** derived (arithmetic shown), **F** family, **3V** three-view
or photo, **ESTIMATE** judged. Nothing here is an owner decision; every choice below is an AGENT choice.

Everything is opt-in. R22, R44, S269 and MD 500E run the legacy text: the exact digests (`legacyDigest`, `s269Legacy`,
`contactAirborne`) are unchanged, and the new code sits behind `hubModel.kind === 'hingeless'`, a control gyro, or
one of the new `RotorDefinition` options.

## 1. The hub: an equivalent hinge with a spring

A hingeless blade bends at the root. The model replaces it with a rigid blade on an **equivalent flap hinge** at
offset `e` with a **flap spring** `Kβ` (Ward, NASA: the cantilever blade "can be replaced by an equivalent offset-hinge
rigid blade with a spring", research report). The existing slow-amplitude harmonic solver (S269, MD 500E) carries it;
there is no new solver.

- **Spring from the frequency.** `hingelessSpring(def) = max(0, ν² − 1 − e·Mβ/Iβ)·Iβ·Ω_ref²` with the solver's own
  blade moments (`hingelessBlade`: the hub's measured set, else the uniform estimate from `main.inertia`). A constant
  spring, so ν rises as Nr falls.
- **In the solver** (`FlapSpring`): δ = e·Mβ·Ω² + Kβ (+ the mean δ3 stiffness) on the diagonal of
  `[δ, sCΩ; −sCΩ, δ]`, the cone divisor Ω²(Iβ + e·Mβ) + Kβ, the cone forcing + Kβ·precone, and the cone pole of
  `advanceFlap`. The flap phase lag behind cyclic is emergent: tan φ = CΩ/δ.
- **Hub moment** `hingeMoment`: k = (B/2)(e·Mβ·Ω² + Kβ) per radian of first-harmonic flap = (B/2)(ν² − 1)·Iβ·Ω² at
  Ω_ref. The spring carries moment at zero thrust (the hingeless rotor keeps control at low g) and at zero rpm. The δ3
  stiffness is aerodynamic and never enters the hub moment.
- **Stopped rotor.** At Ω ≤ 0 the slow-amplitude reduction is singular. A spring hub then takes the **static spring
  solution** M/δ for the harmonics and (M0 + Kβ·precone)/Kβ for the cone, also on zero-dt queries: a stopped rotor
  with no air carries no hub moment, and a save resumed at Ω = 0 with stale harmonics applies none (R16). Above zero
  the exact exponential step already converges to the static solution (its decay rate grows as 1/Ω).
- **Mast moment.** `state.mastMoment` = |hub moment| in the shaft frame, N m, on real steps (the Bo 105 indicator;
  BO sets `mastMomentLimit`/`mastMomentYellow`).
- **Hingeless decisions** at every site the codemap listed: `reset` creates `state.articulated` (the per-blade pose
  block, four blades), `state.harmonicInflow` (when declared) and `state.mastMoment`, never lazily; `publishBlades`
  poses the blades with the hub's coning definition (spring and precone in `bladeConing`); `groundRotor.ts` never runs
  the two-blade teeter on a hingeless hub, and its blade path takes the swashplate law; `settle` seeds the flap from the
  swashplate law, the cone at the precone and the harmonic inflow at zero.

**The (e, Kβ) split.** ν at nominal rpm fixes one combination of e and Kβ only. NASA TM-85990 (downloaded to
`W/sources/bo105/tm-85990/`) gives the rotating frequencies at 425 rpm (flap 1.10, lag 0.73, torsion 3.56/rev, Table 1,
P) but no non-rotating flap frequency, so the Southwell second condition is not available: e stays at 0.12 R (P,
BK117-ERF7: "an effective flap hinge offset of 12 percent (zero spring), and a corresponding flap frequency ratio of
1.10") and the spring makes up the rest. Handling at 85-110 % Nr is insensitive to the split; the parked pose is BO's
(`droopStop` ESTIMATE about −1.5°, `bending` set 3V from parked photos).

## 2. Control phase and δ3

**Control phase** (`hubModel.controlPhase`, rad) goes through one function, `swashplateCyclic(d, c, state)`, used by
`compute`, `publishBlades`, the settle seed and the ground blade path, and by the new exteriors (BX, AX import it).
Positive advances the swashplate cyclic in the rotation sense: the steady hover hub moment turns by +φ in the rotation
sense (R13: 15.01° and 30.03° for 15° and 30°, magnitude unchanged within 0.03 %). A hingeless rotor lags its cyclic by
about 70° instead of 90°, so a phase of 90° − 70° = 20° undoes the cross-coupling in the hover with the inflow off; with
the Pitt-Peters inflow on and at 80 kt the off-axis angle is larger (section 6). A control-gyro type takes no control
phase (consistency rule: the gyro has its own 36° input rotation).

**δ3** (`hubModel.delta3`): θ ← θ − tan δ3·β. Its mean aerodynamic stiffness Σ k|ut|·ut·arm·tan δ3 (no extra r) is
folded into δ exactly; its azimuth-periodic remainder is explicit from the previous harmonics. In the hover with
e → 0 it is (γ/8)·Iβ·Ω²·tan δ3 (R14: Δν² 0.234 and 0.494 against (γ/8) tan δ3 = 0.235 and 0.496 for 20° and 37.5°; the
lag through the whole rotor equals atan(CΩ/(δ + Ka)) to 1e-13). Both the Bo 105 and the AH-56A have δ3 = 0.

## 3. Hub-aware blade elements

`bladeElements` (rotor.ts) works in the wind axes of the tip-path plane (ψ = 0 downwind, ut = Ωr + V sin ψ) and every
hub used to pass `teetering = true`: the free-hinge cancellation pitch −μ(8/3 θ.75 − 2λ)/(1 + 1.5μ²)·sin ψ. A stiff hub
does not cancel its lift moment, so a hingeless hub with `bemFromFlap` (default true) passes the first-harmonic pitch
**relative to the tip-path plane** instead (`tppPitchHarmonic`):

- θ_TPP(ψ) = θ_shaft(ψ) − rotation·dβ/dψ (a tilt of the reference plane changes the section pitch by the plane's
  slope along the blade's motion), from the swashplate cyclic and the solved harmonics;
- turned into the BEM's azimuth: ψ_BEM = rotation·(ψ + α) + π, α the direction of the hub's motion through the air
  in the tip-path plane (the flap solver's ψ = 0 is FORWARD, e_r = (cos ψ, −sin ψ));
- with `radialFlow`, the coning's radial-flow term up += β0·V·cos ψ_BEM.

In the free-hinge limit this is the cancellation formula (R8: 0.3 %, 1.5 %, 3.9 % at μ 0.1, 0.2, 0.35 for a blade from
5 % R; the closed form integrates from the shaft. With the Bo 105's 22 % root cutout the quadrature sits 0.9 %, 2.4 %
and 5.1 % from it). The retreating-stall moment gate stays teetering-only.

## 4. First-harmonic (Pitt-Peters) inflow

**Source correction.** The plan pointed at NASA TM-88327 (Chen & Hindson 1986, NTRS 19870015049, downloaded to
`W/sources/rotor/tm-88327/`). That memo carries only the **uniform** mode (its eqs 4-5, the M11 = 128/(75π) that
rotor.ts's `inflowTimeConstant` already uses). The harmonic rows come from NASA **TM-102219** (Chen 1989, "A survey of
nonuniform inflow models...", NTRS 19900006622, `W/sources/rotor/tm-102219/`, P): the gain matrix in wake-skew form
(eq 13b), the mass-flow parameter (eq 14) and the apparent masses (eqs 17-18):

```
L = [ 1/(2vT)                   0                    15π/(64 vm) tan(χ/2) ]      vT = (μ² + λ²)^½
    [ 0                         −4/(vm(1+cos χ))     0                    ]      vm = (μ² + λ(λ + v0)) / vT
    [ 15π/(64 vT) tan(χ/2)      0                    −4 cos χ/(vm(1+cos χ)) ]    M = diag(8/(3π), 16/(45π), 16/(45π))
```

with ψ = 0 downwind, λ the total inflow through the disc and χ = atan(μ/λ) the wake skew. (TM-102219's eq 16,
labelled "L_cruise", is the time-constant matrix L·M at χ = 90°, not the gain matrix; eq 13b was used.)

What the model keeps (AGENT choices):

- **One-way coupling.** The uniform mode stays rotor.ts's momentum inflow and time constant, untouched (plan). So the
  harmonics take CT through L31 and the moments through L22/L33; the L13 feedback (pitch moment → v0) and the v0-rate
  term of the cosine row are dropped.
- **L31 is the total-value form** 15π/(64 vT) tan(χ/2): with momentum v0 = CT/(2 vT) it gives the downwind gradient
  λ1c/λ0 = (15π/32) tan(χ/2) (R9: 1.3836 against 1.3836 at μ 0.2, χ 86.4°).
- **Each harmonic row in time-constant form**, τ_row = |L_row|·16/(45π)/Ω, integrated exactly over dt > 0. In the
  hover τ = 16/(45π)/(v0 Ω) = 0.051 s for the Bo 105 (R10: 0.0510 s against 0.0509 s; steady gradient M/(ρπR³ v0)
  exactly).
- **Signs made physical**, not left to the coefficient signs: more lift on one side of the disc gives more downwash on
  that side; thrust in forward flight gives more downwash at the rear. The state `harmonicInflow {cos, sin}` (m/s,
  shaft axes) is in the flap solver's azimuth: a blade element at radius r sees up += (r/R)(cos·cos ψ + sin·sin ψ); as a
  vector in the shaft plane the gradient is g = (cos, −sin). The forcing is the rotor's **aerodynamic** moment about
  the shaft (`aerodynamicHubMoment`: Σ L·r with this step's flap and flap rates; the inertial Coriolis transport is not
  a wake load).
- **inducedFactor and ground effect** act on the uniform state only; the gains use the momentum induced velocity out
  of ground effect. The skew uses |λ| (an upward autorotative wake skews like a downward one); vm is floored at 2 v0
  (its hover value) and 0.01 (momentum theory fails in the vortex ring, and a zero-thrust rotor would have an infinite
  gain).
- The BEM stays uniform.

**What it does (measured on the fixture).**

| Effect | Inflow OFF | Inflow ON | Note |
|---|---|---|---|
| Hover hub moment per lateral cyclic, on-axis | 3,008 N m | 2,628 N m (−13 %) | magnitude −7 %, response turned ≈ 9° against the rotation |
| 80 KCAS on-axis roll moment per lateral cyclic | 1,181 N m | 1,109 N m (−6 %) | the extra downwash goes to the lifted (left) side |
| 80 kt Lp / Mq | −10.64 / −3.10 1/s | −10.68 / −4.09 1/s | |
| 80 kt Lq / Mp | +0.77 / −0.19 1/s | +2.56 / −0.66 1/s | the cross-derivatives are mostly the inflow |
| Transverse flow, extra LEFT lateral cyclic | — | 0.46° at 5, 0.90° at 10, 1.50° at 20, **1.66° at 30**, 1.54° at 40 KIAS | R11 band 0.5-3.0° peaking 10-30 KIAS |

D (why the steady hover reduction is only 7 %, not the 1/(1 + aσ/16λ0) = 1/1.51 of the plan's estimate): the
inflow gradient answers the rotor's **aerodynamic** moment, and in a steady state that equals the hub moment, which is
only (ν² − 1)/(γ/8) ≈ 0.34 of the cyclic's pitch moment; the gradient aσ/(16 v0) × 0.34 ≈ 0.17 of the cyclic sits 70°
behind it, so it trims the on-axis moment by 13 % and turns it. The 1/1.51 applies to the pitch input itself, i.e. to
fast transients. At 80 kt the crosswind (roll) gain stays near its hover value (|L22| ≈ 4/vm ≈ 18 against 1/v0 ≈ 20)
while the downwind (pitch) gain falls with cos χ: a pitch rate's precession needs an aerodynamic ROLL moment, the
crosswind gradient resists it and the disc has to flap further, so **Lq rises from 0.77 to 2.56 and Mq from −3.10 to
−4.09**, while Lp barely moves. R18's cross-derivatives therefore measure the Pitt-Peters crosswind gain more than the
hub, which is the dependence the fitting rule was written to expose.

The settle relaxation (0.05 s steps) with the flap and inflow coupled explicitly did not two-cycle: every trim
converged with a Newton residual below 1e-4 with the inflow on (R16).

## 5. Radial flow and periodic flap damping

- **Radial flow** (`hubModel.radialFlow`): a flapped blade sees the radial component of the hub's air velocity normal
  to it, up += −β(ψ)·(V·e_r), with the full β(ψ) = β0 + βc cos ψ + βs sin ψ of the previous step (explicit at
  240 Hz: γΩ/16·dt ≈ 0.06). It carries the coning's lateral flap and the coning-harmonic coupling terms (R12: 0.448°,
  1.087°, 1.874° added at μ 0.1, 0.2, 0.3 against (4/3)μβ0/(1 + μ²/2) = 0.451°, 1.094°, 1.885°).
- **Periodic flap damping** (`main.periodicFlapDamping`): the full flap-rate moment −Σ k|ut|·arm²·β̇(ψ), with
  β̇ = rotation·Ω(βs cos ψ − βc sin ψ) from the previous harmonics, minus its azimuth-mean part (already in the implicit
  matrix as the sCΩ terms). Off is bit-identical (R23). **Finding:** with the damping linear in ut (Σ k|ut|arm²), the
  periodic part is 1/rev and has **no first harmonic** without reverse flow (1.5e-11 N m against a 4,031 N m flap-rate
  moment with a 1.8 m root; 1.07 N m with the Bo 105's 1.10 m root at μ 0.35, where the reverse-flow circle reaches the
  blade). It reaches the harmonics only through the cone: at μ 0.35 the hub moment per unit lateral cyclic changes by
  −2.1 % (longitudinal −1.1 %), not the plan's 3-9 % (D from about μ²/2). The plan row is kept as an `it.fails` row
  (`hingelessBem.test.ts`). The μ² first-harmonic coupling of the classical equations is the radial-flow stiffness
  (μ² sin 2ψ), which `radialFlow` already carries. AH's H9 (8-15 % at μ 0.5) should expect the same.

## 6. Contracts for the other packages

- **Grid and section** (`main.radialStations`, `main.azimuthStations`, `main.section`, `main.cm0`): both the BEM and the
  hinge forcing use the grid (legacy 12 × 16) and, with a section, call `sectionCoefficients(section, α, M, reverse)`
  (section.ts, AH's) with **α the incidence of the relative wind to the chord line in (−π, π]**, M = |(ut, up)|/a, and
  **reverse = |α| > π/2** (flow from the trailing edge). The normal force is q·c·(cl cos φ − cd sin φ). The S0 stub's
  `clamp(slope·α)` is wrong in reverse flow (it returns +maxCl near α = ±π); AH's section must handle the full range.
  The flap damping C and the cyclic Jacobian stay the attached-flow linear ones.
- **Gyro coupling** (AG): `flapSystem(...)` returns the `FlapSystem` {a, f, b, θ0, hub} of one step,
  dx/dt = a·x + f + b·(θ − θ0) for x = [cosine, sine] = [−flapForward, flapRight], with `a` including the yaw transport,
  b = P⁻¹·∂M/∂θ exact for the linear forcing, and hub = [0, k; k, 0] (the shaft hub moment). When `Rotorcraft.gyro`
  exists, compute calls `gyro.advanceCoupled(dt, c, rateShaft, system, previousFlap, bladeMoments)` in place of
  advanceFlap's harmonics (the cone keeps advanceFlap's pole), in compute and in settle's relaxation; there is no
  sequential explicit gyro step. **flapSystem returns null** at Ω ≤ 0 or with no damping and no rotation (a stopped
  rotor): compute then keeps advanceFlap's static spring solution and does not call advanceCoupled that step (R21: a
  zero-coupling test gyro reproduces advanceFlap to 3e-15 through 160 settle and 240 compute calls).
- **Gyro blade moments**: with a control gyro, `hubForcing` returns `GyroBladeMoments` per blade (pitching moment from
  the section's Cm or `cm0`, in-plane moment = tangential force × r), first harmonics in the solver's azimuth.
- **Seams kept** (R22): the pusher's loads and shaft torque, the half-P forcing, and extra H before ω×H, tested with
  stand-ins on the fixture and the MD 500E.

## 7. Validation on the test-local Bo 105 (hingelessFixture.ts)

The fixture spreads the S0 bo105 definition and overrides it with research data; it is not the bo105 aircraft (BO's).

| Item | Value | Tag |
|---|---|---|
| Rotor | 4 × R 4.92 m, chord 0.27 m, root 1.10 m, twist −6.2°, 424.5 rpm, CCW | P (dimensions.ts) |
| Lift slope | 6.0 /rad | ESTIMATE (2π × 0.95; F Padfield a0 6.113, UNVERIFIED) |
| Hub | e 0.12 R, ν 1.11, precone 2.5°, Kβ 9,196 N m/rad (13 % of (ν² − 1)IβΩ²) | P BK117-ERF7 / AGENT (ν inside 1.10 TM-85990 - 1.12 TM-103867) / D |
| Polar inertia | 900 kg m² (Lock number about the shaft 5.17 at SL) | ESTIMATE |
| Control phase | 30° | calibrated (section 8) |
| Mass, inertia | 2200 kg; Ixx 1433, Iyy 4973, Izz 4099, Ixz 660 kg m², CG 0.96 m below the hub | P AR-280 / F METU |
| Shaft tilt | 3° forward | P |
| Stabiliser | 0.8 m², 0° incidence, lift slope 3.5/rad | P AR-280 / ESTIMATE |
| Fin, endplates | 3V outline (shoelace) lift slope 2.5; endplates 0.38 m², 2.0 | 3V / ESTIMATE |
| Fuselage | drag areas 1.6/5.5/6.5 m²; moment derivatives pitch 0.55, yaw 0.35 Nm/(Pa rad) (the MD 500E's × 2.3 cabin volume) | ESTIMATE |
| Engine | one 250-C20B with every power, flow and inertia doubled (the twin as one shaft) | ESTIMATE |

Every airframe coefficient was set from geometry before measuring and is not a knob. AR-280's derivative tables are
state-matrix entries (Ixz folded in): the DLR set assembled that way reproduces its own Table 6.2.13 modes (roll 8.49
against 8.49, Dutch roll [0.14, 2.53] against [0.14, 2.50], phugoid [−0.16, 0.33] against [−0.15, 0.33]), while read as
L/Ixx with the Ixz coupling outside the roll mode would be 9.8. The fixture's derivatives go through the flight
model's own Ixz-coupled Euler equations, ω×h removed as in flight.

| # | Item | Target | Measured | Result |
|---|---|---|---|---|
| R2 | ν from free decay (density 1e-4), ν = √(1 + 2ω_r/Ω) | (0.12R, 1.10), (0.152R, 1.126), (0, 1.117) ±1 % | 1.1000, 1.1260, 1.1170 | pass |
| R3 | Kβ formula; e 0.12 R, ν 1.10 → ≈ 0 | ≤ 5 % of IβΩ²·0.21 = 3,212 | 2,435 N m/rad (pure-offset ν 1.0964) | pass |
| R4 | hover flap lag, inflow off | 60-73° (D: 70.2°) | 70.7° | pass |
| R5 | hub moment per unit flap | (B/2)(ν²−1)IβΩ² = 142.0 kN m/rad ±1 % | 142.0 roll and pitch | pass |
| R6 | lateral TPP stiffness with thrust term | 3.2 kN m/deg ±30 % | 2.85 | pass |
| R7 | (ν²−1) Bo 105 / MD 500E | 3.0-4.5 | 0.232 / 0.0638 = 3.64 | pass |
| R8 | free-hinge BEM pitch vs cancellation formula | ±3/3/5 % at μ 0.1/0.2/0.35 | 0.3 / 1.5 / 3.9 % (5 % R root) | pass |
| R9 | λ1c/λ0, rear > front | (15π/32) tan(χ/2) ±5 % | exact; fixture at 80 KCAS: rear +3.68, front −3.68 m/s at the tips | pass |
| R10 | hover τ to an imposed moment | 16/(45π)/(v0Ω) = 0.0509 s ±5 % | 0.0510 s | pass |
| R11 | transverse-flow left cyclic 0-40 KIAS | 0.5-3.0°, peak 10-30 KIAS | 1.66° at 30 KIAS | pass (peak at the band's edge) |
| R12 | lateral flap from coning, free hinge | (4/3)μβ0/(1+μ²/2) ±20 % | −0.7 / −0.7 / −0.6 % | pass |
| R13 | control phase turns the hover hub moment | φ ±0.5° | 15.01°, 30.03° (inflow off and on) | pass |
| R14 | δ3 20°, 37.5°: Δν² | (γ/8) tan δ3 ±10 % | −0.5 %, −0.5 % | pass |
| R15 | hover roll rate 0.5 s after a 0.2 step, 240/480/960 Hz | < 2 % | 18.96 / 19.00 / 19.02 °/s | pass |
| R16 | dt = 0 purity; trims 0-145 KIAS; stop; resume at Ω = 0 | residual < 1e-4; < 50 N m within 5 s; none | residuals ≤ 8e-5; 0 N m; 0 N m | pass |
| R17 | roll acceleration to a 10 % lateral step at 0.2 g vs 1 g, 100 KIAS | ≥ 80 % | 101.5 vs 111.5 °/s² = 91 % (at 0.20 g) | pass |
| R18 | 80 kt derivatives (table below) | DLR/AFDD envelope ×0.7/×1.3 | Lp, Mq, Nr, Xu, Lq, Mp inside; Mw sign +; Mw, Zw, Lv, Nv, Lq/\|Lp\| outside | see below |
| R19 | modes | roll 8.49 ±30 %; DR 2.5 ±30 %, ζ 0.05-0.30; phugoid unstable 12-30 s | roll 10.79; DR 2.78 rad/s ζ 0.19; phugoid 20.7 s ζ +0.004 (stable) | phugoid stability misses |
| R20 | coupled roll/flap mode, matrix pencil, 0.1 s pulse at 78 KIAS | 13.7 rad/s ±30 %, ζ 0.3-0.7 (P LS-178) | 12.4 rad/s, ζ 0.60 | pass |
| R21 | gyro coupling wiring | 1e-12 | 3e-15 | pass |
| R22 | seams | exact | pass on the fixture and the MD 500E | pass |
| R23 | periodic flap damping | off identical; hover 1e-9; μ 0.35: 3-9 % | identical; < 1e-9; −2.1 % | band missed (section 5) |

**R18 at 80 KCAS, 3000 ft, 2200 kg** (quasi-static central differences, rotor states re-settled; 1/s, rad/(s m)):

| | Lp | Mq | Nr | Mw | Zw | Lv | Nv | Xu | Lq | Mp |
|---|---|---|---|---|---|---|---|---|---|---|
| envelope | −11.41…−5.95 | −5.84…−2.45 | −1.39…−0.60 | +0.037…+0.125 | −1.54…−0.70 | −0.352…−0.145 | +0.057…+0.152 | −0.077…−0.027 | +1.5…+4.5 | −1.6…−0.3 |
| inflow ON | −10.68 | −4.09 | −1.33 | **+0.007** | **−0.683** | **−0.094** | **+0.167** | −0.048 | +2.56 | −0.66 |
| inflow OFF | −10.64 | −3.10 | −1.31 | −0.017 | −0.683 | −0.090 | +0.168 | −0.049 | +0.77 | −0.19 |

Ratios: Lq/|Lp| 0.240 (target 0.25-0.50, DLR 0.36), Mp/|Mq| −0.160 (−0.1…−0.3). Lq and Mp with the 30° control
phase and with none agree to 1e-10 (the phase touches control only).

**What sets the misses** (component decomposition, Mw/Lv/Nv):

| Configuration | Mw | Lv | Nv |
|---|---|---|---|
| fixture | +0.0069 | −0.094 | +0.167 |
| no stabiliser | +0.0668 | −0.093 | +0.167 |
| no fins | +0.0070 | −0.134 | +0.097 |
| rotor and tail rotor only | +0.0642 | −0.133 | +0.099 |

The rotor alone gives Mw +0.064, inside the envelope; the fixture's stabiliser ESTIMATE (3.5/rad, 0.8 m², 4.4 m arm)
takes −0.060 of it. The fins make Nv too large (+0.07) and Lv smaller (+0.04). These are **FIXTURE AIRFRAME** rows for
BO's real airframe. Zw (2 % short of 0.7 × DLR), Lq/|Lp| (0.240 against 0.25) and the rotor's Lv (−0.134 against
−0.145) are **ROTOR/INFLOW** misses. The phugoid is neutral-to-stable (ζ +0.004) because Mw is small. Each miss is an
`it.fails` row in `hingelessAr280.test.ts`, so a change that closes one turns it red.

The repo's fuselage pitch-moment derivatives (R22 0.12, MD 500E 0.25, the fixture 0.55 Nm/(Pa rad)) are about 15×
smaller than a slender-body (Munk) estimate for the Bo 105 cabin (≈ 2 × volume × (k2 − k1) ≈ 9 m³): that alone would add
about +0.05 to Mw. BO should look at it when calibrating Mw.

## 8. The hub set for BO, and what moves it

**Recorded set (R18-R20 under the fitting rule): e 0.12 R, ν 1.11, polar inertia 900 kg m² (Lock number about the
shaft 5.17 at SL with a = 6.0), controlPhase 30°, harmonicInflow, radialFlow and bemFromFlap on.** ν was chosen from
the sources before measuring (1.10 TM-85990 calculated, 1.12 TM-103867) and was not moved afterwards.

**Control phase calibration.** At 80 KCAS / 3000 ft the settled off-axis moment ratios of ±0.02 cyclic steps
(lateral step M/L, longitudinal step L/M) were fitted by least squares on a 1° grid to the means of the DLR and AFDD
control derivatives (AR-280 Table 6.2.11: −0.085 and +0.145): best 30° (lateral −0.069, longitudinal +0.181). D check:
Ward's "control phasing retarded to about 60°" is a 30° lead on the articulated 90°. In the hover, with the inflow on,
the steady lateral-cyclic response is turned 28° from on-axis without a phase: a phase near 30° also squares the hover.

**The (ν, inertia) grid** (80 KCAS, 3000 ft, inflow on; γ about the shaft at SL with a = 6.0):

| inertia kg m² (γ) | ν | Lp | Mq | Lq | Mp | Lq/\|Lp\| | Mw | roll 1/T | phugoid ζ |
|---|---|---|---|---|---|---|---|---|---|
| 850 (5.47) | 1.10 | −9.18 | −3.53 | 1.39 | −0.36 | 0.151 | −0.004 | 9.41 | +0.023 |
| 850 (5.47) | 1.11 | −9.80 | −3.77 | 1.91 | −0.49 | 0.195 | +0.003 | 9.99 | +0.005 |
| 850 (5.47) | 1.12 | −10.38 | −3.99 | 2.48 | −0.64 | 0.239 | +0.010 | 10.50 | −0.012 |
| 900 (5.17) | 1.10 | −10.03 | −3.84 | 1.94 | −0.50 | 0.193 | −0.000 | 10.21 | +0.021 |
| **900 (5.17)** | **1.11** | **−10.68** | **−4.09** | **2.56** | **−0.66** | **0.240** | **+0.007** | **10.79** | **+0.004** |
| 900 (5.17) | 1.12 | −11.28 | −4.32 | 3.22 | −0.83 | 0.286 | +0.014 | 11.27 | −0.013 |
| 950 (4.90) | 1.10 | −10.89 | −4.16 | 2.54 | −0.65 | 0.234 | +0.003 | 11.00 | +0.019 |
| 950 (4.90) | 1.11 | −11.57 | −4.42 | 3.27 | −0.84 | 0.282 | +0.011 | 11.55 | +0.003 |
| 950 (4.90) | 1.12 | −12.18 | −4.65 | 4.03 | −1.03 | 0.331 | +0.018 | 12.00 | −0.013 |

At ν 1.11 the only inertia that clears both Lq/|Lp| ≥ 0.25 and the roll mode ≤ 11.04 is about 912-916 kg m², a fit
four kg m² wide on an ESTIMATE; it was not taken. ν 1.12 (TM-103867; DLR's 15.2 % virtual hinge gives 1.126; the plan's
own expectation) clears Lq/|Lp| and makes the phugoid unstable, at the cost of a roll mode of 10.5-11.3 (the upper
band edge is 11.04). The inertia above 930 kg m² is outside the Lock-number band with a = 6.0. **BO chooses with the
real airframe**: the stabiliser, fin and fuselage moment move Mw, Nv and the phugoid more than anything in this grid.

## 9. Owner-facing numbers from the fixture (pilot units, not the Bo 105 yet)

- Roll: hover roll rate 19 °/s 0.5 s after a 10 % lateral step; at 100 KIAS a 10 % lateral step gives 112 °/s² of
  initial roll acceleration (AR-280 L_lat 0.185 rad/s²/% = 106 °/s² per 10 %), and still 102 °/s² at 0.2 g; roll mode
  1/T 10.8 1/s (τ 0.093 s against AR-280's 0.118 s); the coupled roll/flap mode 12.4 rad/s, ζ 0.60.
- Hub: 142 kN m per radian of flapping (2.48 kN m/deg); with the thrust term 2.85 kN m/deg of lateral tip-path tilt;
  mast moment in the fixture's trims 0.49 / 0.76 / 0.55 / 1.64 / 4.50 kN m at 0 / 40 / 80 / 120 / 145 KIAS.
- Trim attitudes (fixture airframe, SL, 2200 kg): pitch +2.9° hover, +1.5° at 40, −2.0° at 80, −6.5° at 120, −9.3° at
  145 KIAS; roll 4.1° left in the hover.
- The cyclic travel (±10°) is an ESTIMATE (control rigging not found): BO fits it to AR-280's per-% control
  derivatives.

## 10. Not modelled (known issues for the integrator's list)

- The lag degree of freedom is absent (soft in-plane 0.66-0.73/rev on the Bo 105): no air or ground resonance, no
  lead-lag damper loads.
- Blade flap bending beyond the equivalent hinge (higher modes) and the blade's elastic torsion are absent.
- The periodic flap damping reaches the harmonics only through the cone (section 5); the plan's R23 band and AH's H9
  band assume more.
- The harmonic inflow is one-way from the uniform mode (no L13 feedback); the BEM stays uniform; no wake curvature
  (manoeuvre) terms.
- The rotor's in-plane side force (Y) from the first-harmonic pitch is not resolved (the BEM returns H along the flow
  only).
