# Lockheed AH-56A Cheyenne: high advance ratio, moment stall and the half-P hop (stage 5)

Package AH, plan revision 2 section 7.4 (and section 0 item 10; critique rows C1.10, C1.11, C1.16, C2.13, C3.23). Owner notes O1: the
half-P hop is a **scripted event**, not emergent. Files:
- `src/physics/rotorcraft/section.ts`: the blade section model (`RotorSectionDef`, `sectionCoefficients`).
- `src/physics/rotorcraft/halfPHop.ts`: the scripted half-P hop (`HalfPHopDef`, `HalfPHop`).
- `src/aircraft/ah56/highSpeed.ts`: the AH-56A data (the section, the grids, periodic flap damping, the half-P event).
- Tests: `tests/rotorcraft/ah56HighSpeed.test.ts` (H1-H3, H9, H10), `ah56MomentStall.test.ts` (H4-H6), `ah56HalfP.test.ts` (H7).

Tags: P primary (ASTA-72 = USAASTA 72-08, the 1972 ICS aircraft; AMCS-73 = USAASTA 72-44; the NACA reports below), D derived
(arithmetic shown), ESTIMATE judged, FITTED (an ESTIMATE set to a named row). Nothing here is an owner decision; AGENT choices are marked.

## 1. H11: the mechanism map, measured on the stage-4 aircraft before the section model

Written before `section.ts` changed (plan 7.4, H11). The aircraft is AC's stage-4 compound (merge `802157c`, the base polar of
`base.ts`: lift slope 5.73 /rad, Cl max 1.3, Cm0 −0.012, no Mach terms), in the **ICS** configuration at the ASTA-72 para 62 test
condition: 4,600 ft density altitude, 20,000 lb, collective 7° (122 KCAS), 5° (154 and 190 KCAS) at 0.75 R, the prop set so the
level trim needs that collective. A scripted test pilot flies a wind-up turn at 0.1 g/s (bank for the load factor, stick for n_z,
pedals for zero sideslip, the prop lever for the airspeed). The map is taken when n_z first reaches the target.

Incidence α (deg) of the blade element to its relative wind, from the same quadrature as the hub forcing (the flap and its rate,
the radial flow, the harmonic inflow; probe `work/rigid/probes-ah/windup.ts`). Azimuth in the **standard** convention: ψ = 0 over
the tail, 90° advancing (right, the AH-56 rotor turns counter-clockwise seen from above), 180° over the nose, 270° retreating
(left). `R` = reversed flow (|α| > 90°). (The code's azimuth has ψ = 0 forward: ψ_code = ψ − 180°.)

**1.5 g at 154 KCAS** (μ 0.419; advancing tip M 0.855; cyclic 2.0° forward, 1.8° left):

| r/R \ ψ | 0 | 30 | 60 | 90 | 120 | 150 | 180 | 210 | 240 | 270 | 300 | 330 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0.25 | 5.7 | 5.9 | 5.0 | 4.6 | 5.4 | 7.9 | 16.5 | 35.3 | R | R | R | −50.9 |
| 0.40 | 6.3 | 5.3 | 4.1 | 3.6 | 4.2 | 6.2 | 11.7 | 16.3 | 34.4 | R | 9.2 | 6.4 |
| 0.55 | 6.1 | 4.6 | 3.3 | 2.6 | 3.1 | 4.9 | 9.2 | 12.0 | 16.1 | 15.8 | 10.2 | 7.5 |
| 0.70 | 5.6 | 3.9 | 2.4 | 1.7 | 2.1 | 3.7 | 7.5 | 9.7 | 12.3 | 12.1 | 9.5 | 7.3 |
| 0.85 | 5.0 | 3.2 | 1.6 | 0.8 | 1.1 | 2.7 | 6.2 | 8.2 | 10.3 | 10.5 | 8.8 | 6.8 |
| 0.95 | 4.6 | 2.7 | 1.1 | 0.2 | 0.5 | 2.0 | 5.4 | 7.3 | 9.3 | 9.6 | 8.3 | 6.4 |

Local Mach at ψ = 265°: 0.12 at 0.61 R, 0.21 at 0.77 R, 0.27 at 0.87 R, 0.34 at 0.97 R. At ψ = 95°: 0.59 at 0.56 R, 0.78 at 0.87 R,
0.84 at 0.97 R (α 0.2-2.6°).

**1.4 g at 122 KCAS** (μ 0.328; advancing tip M 0.800; cyclic 2.4° forward, 2.2° left):

| r/R \ ψ | 0 | 30 | 60 | 90 | 120 | 150 | 180 | 210 | 240 | 270 | 300 | 330 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0.25 | 4.2 | 5.8 | 5.4 | 5.2 | 5.9 | 8.0 | 14.0 | 20.6 | R | R | R | −10.6 |
| 0.40 | 6.3 | 5.8 | 4.9 | 4.4 | 4.9 | 6.7 | 11.1 | 13.8 | 17.2 | 12.8 | 5.1 | 5.6 |
| 0.55 | 6.6 | 5.4 | 4.2 | 3.6 | 3.9 | 5.6 | 9.4 | 11.5 | 13.6 | 12.3 | 9.3 | 7.6 |
| 0.70 | 6.5 | 4.9 | 3.5 | 2.8 | 3.1 | 4.6 | 8.2 | 10.0 | 11.9 | 11.6 | 9.7 | 8.0 |
| 0.85 | 6.1 | 4.4 | 2.8 | 2.0 | 2.2 | 3.7 | 7.1 | 8.9 | 10.7 | 10.8 | 9.5 | 7.8 |
| 0.95 | 5.8 | 3.9 | 2.3 | 1.4 | 1.7 | 3.1 | 6.4 | 8.2 | 10.0 | 10.3 | 9.2 | 7.6 |

Local Mach at ψ = 265°: 0.14 at 0.56 R, 0.26 at 0.77 R, 0.36 at 0.92 R, 0.39 at 0.97 R. At ψ = 95°: 0.78 at 0.97 R (α 1.4°).

**1.43 g at 190 KCAS** (μ 0.523; advancing tip M 0.917; cyclic 3.4° forward, 1.6° left):

| r/R \ ψ | 0 | 30 | 60 | 90 | 120 | 150 | 180 | 210 | 240 | 270 | 300 | 330 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0.25 | 1.7 | 3.9 | 3.3 | 2.9 | 3.4 | 5.2 | 10.2 | 31.1 | R | R | R | R |
| 0.40 | 4.0 | 3.8 | 2.8 | 2.2 | 2.6 | 4.2 | 8.1 | 11.0 | R | R | R | −2.7 |
| 0.55 | 4.4 | 3.4 | 2.1 | 1.5 | 1.8 | 3.3 | 6.8 | 8.8 | 11.2 | 3.1 | 0.1 | 4.1 |
| 0.70 | 4.3 | 2.8 | 1.5 | 0.7 | 1.0 | 2.5 | 5.7 | 7.4 | 9.2 | 8.1 | 5.9 | 5.3 |
| 0.85 | 3.9 | 2.2 | 0.7 | −0.0 | 0.2 | 1.6 | 4.7 | 6.4 | 8.1 | 8.0 | 6.6 | 5.3 |
| 0.95 | 3.6 | 1.8 | 0.3 | −0.5 | −0.3 | 1.1 | 4.1 | 5.7 | 7.5 | 7.6 | 6.5 | 5.2 |

Local Mach at ψ = 265°: 0.12 at 0.71 R, 0.21 at 0.87 R, 0.27 at 0.97 R. At ψ = 95°: 0.84 at 0.87 R, 0.90 at 0.97 R (α −0.1 to −0.6°).

At 1 g the same conditions give a retreating outboard α of 8.7-8.9° (122), 6.3-6.6° (154) and 3.0-3.6° (190 KCAS).

**What the map shows.**
- The retreating side carries α above 10° at both HQRS-10 conditions: 10-12° outboard (0.7-0.97 R, M 0.2-0.4) and 12-16° at mid-span
  (0.55-0.7 R, M 0.1-0.2), centred on ψ 240-270°. The plan's concern (C1.11: "CT/σ 0.056, the section may never stall") does not hold
  in this model, because the stage-4 rotor carries more of the load than the ESTIMATE lift-share band (AC's C6 gap: 71 % at 120 KCAS).
- At 1.43 g / 190 KCAS the outboard retreating α stays at or below 8.2°: no section stalls there. The discriminator ("none to 1.43 g
  at 190 KCAS", P) separates the conditions by about 2-3° of α.
- The advancing tip reaches M 0.84 (154 KCAS) and 0.90 (190 KCAS) at α of −0.6° to +1°: past the drag divergence of the thin tip
  section (section 2), the Mach-tuck region.
- Reversed flow covers r < μR sin ψ: to 0.40 R at 154, 0.33 R at 122 and 0.51 R at 190 KCAS; dynamic pressure there is below 2 % of the
  advancing tip's.

**The sign chain, checked before the section was written** (probe `work/rigid/probes-ah/sign.test.ts`). From the ICS trim at
154 KCAS (4,600 ft, 20,000 lb, 5°), a first-harmonic blade pitching moment of 300 N m per blade, **nose down at azimuth ψ**, was added
to the blade moments the gyro reads (`GyroBladeMoments.pitching`, which the ICS feathering-moment feedback takes with
`pitchingMomentGain` 1). Body rates 1 s later, change from the undisturbed flight (°/s; p + = right roll, q + = nose up):

| Nose-down peak at ψ | 0 (tail) | 90 (advancing) | 180 (nose) | 210 | 240 | 270 (retreating) | 300 |
|---|---|---|---|---|---|---|---|
| p | −1.0 | −13.0 | +0.7 | +7.1 | +11.8 | +13.3 | +11.2 |
| q | −2.2 | +1.0 | +2.5 | +1.7 | +0.3 | −1.1 | −2.1 |

The chain: a nose-down moment harmonic → the ICS gyro reads it like a hub moment (the feedback path, rotated 33° by the cant) → the gyro
precesses to cancel what it reads → the cyclic follows the gyro → the hub moment changes the other way → the body rolls and pitches.
Measured: a nose-down moment on the **retreating** side (ψ 210-300°) rolls the aircraft **right**; one centred ahead of 260° also pitches
it **up**; one behind 260° pitches it slightly down. The roll is about 10 times the pitch in the first second (the roll mode's τ ≈ 0.5 s
on 10,850 kg m², the pitch's 1-2.5 s on 56,900 kg m²).

**Mechanism (H11's answer).** Retreating-blade **moment stall** of the cambered section, the classical one ASTA-72 para 65 names
("suddenly, greatly increasing the aerodynamic nose-down pitching moment of a cambered airfoil ... feeds back to the control gyro"):
- it is on the retreating side, where α exceeds 10° at the HQRS-10 conditions and not at 190 KCAS;
- its nose-down Cm break on ψ 210-270° gives RIGHT roll, and pitch-up from the part ahead of ψ ≈ 260°.

The alternatives the plan named fail the sign chain:
- the advancing-tip Mach Cm break (nose-down at ψ 90°) gives LEFT roll;
- the reverse-flow root moment (nose UP: the reversed section's lift is downward and acts at its own quarter chord, 0.75 c from the
  leading edge, behind the feathering axis) on ψ 240-300° gives LEFT roll too, and its dynamic pressure is under 2 % of the tip's.

**The same map with the stage-5 section, at the H4 onsets** (probe `work/rigid/probes-ah/stallmap2.test.ts`; cells past the section's
Mach-dependent stall angle, ψ standard; the change in the blade pitching-moment first harmonic the ICS gyro reads, full section minus
the same state with no stall):
- 1.63 g at 154 KCAS: stalled outboard of 0.66 R on ψ 195-245° (0.3-2.8° past the stall angle at M 0.25-0.35), and inboard of 0.6 R
  on ψ 165-260° (low dynamic pressure). Pitching-moment change −107 N m (cos) / −34 N m (sin) per blade: a nose-down peak at ψ 197°.
- 1.48 g at 122 KCAS: stalled on ψ 185-250° across the span (0.4-2.3° past outboard). Change −81 / −49 N m: nose-down peak at ψ 211°.
- 1.41 g at 190 KCAS: four root cells only (M < 0.1). Change < 0.3 N m.

The flown mechanism is the one the stage-4 map named: retreating-side moment stall, centred ahead of ψ 260° (front-left quarter),
which the sign chain turns into RIGHT roll and pitch-up.

## 2. The section model (`section.ts`; data in `highSpeed.ts`)

One section serves the whole span (the contract `sectionCoefficients(s, alpha, mach, reverse)` has no radius). Its attached polar
is the base's; its Mach terms are the TIP's, where the Mach numbers are. A section without `polar` keeps the S0 stub arithmetic, so
AC's provisional placeholder (compound.ts `PROVISIONAL_SECTION`, the C4 "with the Mach placeholder" row) is unchanged.

| Term | Value | Tag and source |
|---|---|---|
| Lift slope, profile drag | 5.73 /rad; Cd 0.0085 + 0.01 Cl² | base.ts (AG, ESTIMATE; with the blade set, the P Lock number 6.4) |
| Prandtl-Glauert | slope × 1/√(1 − M²), capped at its value at M 0.83: 1.79 | D |
| Cm0 | −0.012, no subcritical Mach change | P NACA Report 530 Table IV (−0.011 to −0.014 to Cl max, full-scale tunnel, Re 1.7 × 10⁶); P NACA WR L-357 (Becker 1941): "negligibly small" subcritical variation |
| Drag divergence | M_dd = 0.83 − 0.1 \|Cl\| at the tip | P NACA ACR L5E21 (Ferri 1945) Fig 75(a): the 6 % sections diverge between 0.82 (2306, cambered) and 0.85 (0006-34); the tip (0.6)3006 has a fifth of the 2306's camber. The Cl term D (Korn form; Becker: lower critical speeds at higher lift) |
| Drag rise | 20 (M − M_crit)⁴, M_crit = M_dd − 0.1 | FITTED (Lock's fourth-power law) to P Becker Fig 3(a), the 23012 at 0°: +0.0010 / +0.0040 / +0.0105 at M 0.69 / 0.71 / 0.745 (the law with M_dd 0.69: 0.0020 / 0.0041 / 0.0115), and P Ferri Fig 75(a), 6 %: +0.004-0.006 at M 0.86, +0.010-0.016 at 0.90 (the law: 0.0057 / 0.0167) |
| Mach tuck | Cm − 0.1 (M − M_crit), at most −0.03 | ESTIMATE: P Becker Fig 5(a) gives the 23012 about −0.15 to −0.2 per unit Mach past its critical speed; the tip has a fifth of its camber and half its thickness |
| Maximum lift | 1.30 / 1.05 / 1.00 / 0.95 / 0.88 / 0.80 at M 0.2 / 0.3 / 0.4 / 0.5 / 0.6 / 0.7; negative stall at 0.8 of it | 1.30 at low Mach: base.ts (ESTIMATE; P Report 530: 1.26 at Re 1.7 × 10⁶). The fall with Mach: ESTIMATE; M 0.3-0.4 FITTED to H4 (section 3); M 0.5-0.7 set so the hover tip (M 0.56) keeps 2.0° of stall margin at 18,300 lb SL and the C2/C3 ceilings stay unstalled (section 5). No 23012 or 23006 data through the stall above M 0.3 were found |
| Lift past the stall | fades to the flat plate over 15°; drag rises to it over 3° | FITTED to P Report 530 Table IV: Cl 1.26 → 1.1 / 1.0 / 0.9 at +3.2 / +6.5 / +10° past Cl max; section drag 0.127 / 0.195 / 0.275 there (the shape on a 1.26 section reproduces Cl 1.17 / 1.00 / 0.85) |
| Flat plate | normal force 2.0 sin α; centre of pressure 0.25 + 0.5 \|α\|/π of the chord | P NACA TN 3361 (the 0012 through 180°, Re 1.8 × 10⁶): Cd 2.08 at 90°, cm about −0.5 there, antisymmetric about 180° |
| **Moment stall (flown)** | centre of pressure 0.2 c aft of the quarter chord within 4° past the stall; faded out between M 0.45 and 0.6 | **ESTIMATE, FITTED to H4** (section 3): the dynamic moment break of the retreating blade (reduced frequency k = ωc / 2U ≈ 0.1 at the retreating tip). No primary dynamic-stall data for this section were downloaded |
| Moment stall (static, P, not flown) | 0.14 c over 12° | D from P Report 530 Table IV: cm_c/4 −0.056 / −0.086 / −0.107 / −0.118 at +3.2 / +6.5 / +10 / +11.6° past Cl max = centre of pressure 0.30 / 0.335 / 0.364 / 0.386 c from cm / cn. The shape reproduces −0.054 / −0.085 / −0.108 (ah56HighSpeed.test.ts) |
| Reversed flow | lift slope 5.73 /rad about 180° to ±0.77; drag twice the minimum; the lift at 0.75 c (cm = +0.5 Cl, nose up for a positive reversed lift) | P TN 3361 Fig 4(a): 0.10 per deg from 174° to 186°, peaks ±0.77 at 8° past 180°; "about twice" the drag. With the forward slope it reproduces the linear hub forcing's reverse-flow lift (within 10 %, ah56HighSpeed.test.ts) |

**Why the flown break is not the static one.** With the P static shape (0.14 c over 12°) the wind-ups to 1.8 g at 122 and 154 KCAS
showed less than 0.3 °/s and 0.3° of uncommanded motion: the retreating tip goes only 1-3° past the stall before the pilot's
stabilisation, and there the static break is −0.02 to −0.05 in Cm. The ICS gyro needs about 300 N m of first-harmonic pitching moment
per blade to produce a 13 °/s roll (section 1). The flown break, 0.2 c within 4°, gives −0.2 in Cm 4° past the stall, the size of
the dynamic-stall moment peaks of 12 % sections at k ≈ 0.1 (ESTIMATE). Probe rows (stabilised wind-ups, differences from the no-stall
flight; probe `h4v.test.ts`):

| Section | 154 KCAS, 1.7 g | 122 KCAS, 1.6 g |
|---|---|---|
| static P break (0.14 c over 12°) | roll −0.8°, pitch-up −0.07 g, stick +0.62 in aft | roll +0.4° right, pitch −0.04 g, stick +0.8 in aft |
| flown break (0.2 c over 4°) | roll +6.1° right, pitch-up +0.18 g | roll +9.7° right, pitch-up +0.26 g |

(The flown-break row is the final section; the static row is from the probe before the Cl max table's high-Mach entries were raised.)

**The Mach fade of the moment break** keeps the break off the advancing tip: a sharp Cm break at M 0.8 (q about 43 kPa) through the
ICS feathering-moment feedback is a loop the explicit blade-moment term cannot hold (a probe with the break at all Mach numbers
diverged at 1.2 g). Above M 0.45-0.6 the separation is shock-induced, and the drag rise and the tuck carry it.

## 3. Results (measured; the [ah56] lines of the tests)

| Row | Measured | Target | Tag | |
|---|---|---|---|---|
| H1 advancing tip, 194 KTAS, 246 rpm, SL | M 0.884 | 0.885 ± 0.01 | D | pass |
| H2 C4 V_H (TOW, 18,750 lb, 5°, 114 %) | 199.1 KTAS (stage 4: 198.6) | 194 ± 5 % (184.3-203.7) | P | pass |
| H2 C5 AMCS clean (18,300 lb, 13° ind.) | 212.2 KTAS | 210-225 | P | pass |
| H3 rotor profile power, 200 KTAS (AMCS, 18,300 lb, SL, stores, 13° ind.), Mach terms on vs off | +9.9 % (629 vs 573 shp); total torque −1.6 % (114.9 vs 116.8 %); the drag rise alone +1.2 % of torque | ≥ 10 % | D | **gap** (it.fails) |
| H4 ICS moment stall, 154 KCAS | onset 1.65 g: right roll 2.1° and pitch-up +0.03 g; at 1.7 g 6.1° and +0.18 g (q +2.6 °/s, p +3.2 °/s) | 1.5 ± 0.2 g, pitch-up and RIGHT roll | P ASTA-72 para 65 | pass |
| H4 ICS moment stall, 122 KCAS | onset 1.5 g: right roll 11.9°, pitch-up +0.23 g (n_z to 1.73), q +3.8 °/s, p +4.5 °/s; 1.4 g: 0.7°, +0.004 g | 1.4 ± 0.2 g | P | pass |
| H4 190 KCAS, 1.43 g | 0.09° and +0.001 g | none | P | pass |
| H5 ICS stick per g above 1.3 g, 122 KCAS | 7.0 in/g (6.6 with no stall) | ≤ 0.1 in/g | P | **gap** (it.fails; AG/AC) |
| H6 AMCS 155 / 180 KCAS | no uncommanded motion (< 0.14°, < 0.003 g); stick per g 4.3 → 5.1 and 3.9 → 5.0 in/g, positive and near linear; full aft stick (4.95 in) reaches 2.27 g at 155 and 2.46 g at 180 KCAS | none to 2.5 g; positive and linear | P AMCS-73 para 37 | pass (to the g the stick reaches) |
| H7 | section 4 | | | pass |
| H9 periodic flap damping at μ 0.5 | hub moment per unit θ1c +2.2 % with it on | 8-15 % | D | **gap** (it.fails; shared with RC's R23) |
| H9 rate convergence, 200 KTAS | roll rate 9.07 / 9.08 / 9.09 °/s at 240 / 480 / 960 Hz | within 2 % | — | pass |
| H10 cost, 200 KTAS | 294.7 µs per step vs MD 500E 154.9 (1.90 ×), 12 × 18 grid | ≤ 2 × | AGENT | pass (load-sensitive: 12 × 20 read 2.03 × under a concurrent test run, 1.8-1.9 × idle for 12 × 18) |
| H11 | section 1 | | | done |

**H3.** The primary data put the thin tip's divergence at M 0.82-0.85 (Ferri); at 200 KTAS the tip is at M 0.89, 0.06 past it.
The rise there (Cd +0.014 at the very tip) adds about 9.9 % of rotor profile power, but the rotor carries only 13 % of the
aircraft's power at 200 KTAS (540 of 3,900 shp) and the prop the rest, so the total rises 1.2 % from the drag rise. The
Prandtl-Glauert lift slope then lowers the total by 2.9 %: the advancing blade's larger lift slope tilts the trim 0.7° further
nose-down, and the rotor propels more of the aircraft. The plan's 10 % (D) rested on the 0.78 ESTIMATE.

**H5.** Before the stall the ICS needs 6.6-7.0 in of aft stick per g at 122 KCAS in this model: the gyro's steady stick moment
sets the hub moment (G4: 5.4 kN m per inch), and the airframe's pitch stiffness asks for about 35 kN m per g (the stabiliser at
FS 637 and AC's tail downwash). ASTA-72 para 63 found it "positive for very small load factor changes" and neutral above 1.3 g;
its Figs 43-44 (the gradient) are not in the cached OCR. The moment stall turns the gradient over only past its onset (the
pilot pushes 2-3 in forward to hold 1.5-1.6 g at 122 KCAS).

**H9.** RC's R23 found the same: the periodic part of the flap damping, linear in u_t, is 1/rev and reaches the first harmonics
only through the cone and the reverse-flow region (1-3 % at μ 0.35, RC). At μ 0.5 it is +2.2 %.

**H10 and the grid (AGENT deviation from plan 7.4).** The plan's ≥ 36 azimuth × 16 radial stations cost 590-620 µs per step,
3.7-4.0 × the MD 500E (150-160 µs), on this machine. Across grids from 12 × 16 to 16 × 36 the 190 KCAS ICS trim moved less than 0.01
in of stick and H3's torque less than 0.1 %. The flown grid is 12 radial × 18 azimuth (20° steps), the largest inside 2 ×
(12 × 20: 300-333 µs). The fine grid only above μ 0.3 would need RC's `rotorcraft.ts` to choose the grid by advance ratio (it reads
`radialStations` / `azimuthStations` as constants): a contract request, not done here. The section itself costs about 35 % over the
legacy polar at the same grid (RC's section path adds `Math.hypot`, `cos φ`, `sin φ` per element; the attached branch of
`sectionCoefficients` uses no trigonometry).

## 4. The half-P hop (`halfPHop.ts`; data in `highSpeed.ts`)

A **scripted event** (owner note O1). The 1969-1971 ICS aircraft had a coupled roll / regressive in-plane / rotor plunge mode whose
plunge frequency fell to 0.5-0.6 P at high speed and low collective, where it met the body roll (P And-74 pp 185-196); lateral
doublets near 1.5 Hz or cyclic stirs excited it. The slow-amplitude flap model has no lag or plunge degree of freedom, so the event
forces the body directly:

- **Detector** (on every real step of the flight's clock: dt > 0 and BodyState.time > 0, so the trim's settle() neither advances nor
  feels it, as pusher.ts does). The stick's deviation from its trim point (a 4 s low-pass of the stick):
  - a STIR is the deviation turning one way round the trim point, from when its radius reaches 0.75 in until it falls below 0.6 in;
    each full turn completed within 2 s (0.5 Hz) counts a cycle; 3 consecutive cycles trigger;
  - a DOUBLET is single-axis excursions beyond ±0.5 in, alternating, each reversal within 1 s of the last, the other axis inside
    ±0.5 in; 4 full cycles (8 reversals) trigger;
  - only at ≥ 150 KCAS (from the hub's air), collective ≤ 7.5° at 0.75 R (ICS cruise 5-7°, P SoF), and a gyro configuration in
    `configs` (`['ics']`), read from `state.controlGyro.mode` on every call.
  - `halfp=1` (InitialConditions.forceHalfPHop) starts the event at the first clocked step, in the ICS only.
- **Forcing.** Roll moment A × 100 kN m × sin φ and vertical force A × 12.2 kN × sin φ at the CG; φ = 0.5 × the rotor's own
  unwrapped azimuth (`events.halfPHop.phase`; azimuth/2 is 4π-periodic, so the wrapped azimuth cannot drive it). The onset fades in
  over 1 s: a sine moment switched on at full amplitude leaves the body a roll-rate offset of M cos φ / (Ixx ω), up to 40 °/s.
- **Amplitude.** A = 1 at onset (the cue). No growth for 3 s. Then, per forcing cycle (0.49 s), × 1.216 while stirring continues
  (a qualifying half-turn or reversal within the last 2 s, at the trigger conditions), × 0.82 while the stick is held still (stick
  speed below 0.5 in/s, low-passed over 0.3 s), held otherwise. Strike at 10/3: `events.halfPHop.strike` latches and the flight model
  crashes, "Main rotor struck the fuselage (half-P hop)". Below 0.05 the event is over.
- **Numbers.** The onset roll moment D: ±3° at 2.05 Hz on Ixx 10,850 kg m² needs Ixx ω² × 3° = 94 kN m (about the rotor's whole
  hub-moment capacity, K_hub × 0.1 rad = 110 kN m: acceptable for a scripted strike event, plan 7.4); FITTED × 1.06 to the measured
  cue (the ICS rotor damps the roll). The plunge D: 0.15 g × 18,300 lb = 12.2 kN; the measured vertical cue is ±0.18-0.20 g with the
  plunge anywhere from 0.6 to 1.0 of it (the rotor's thrust follows the roll), so it stays at D. Growth and decay ESTIMATES set to the
  plan's times.

H7 measured (ah56HalfP.test.ts; ICS, 160 KCAS, 18,300 lb, SL, collective 4.4° at 0.75 R):

| Item | Measured | Target |
|---|---|---|
| 0.8 in circular stirs at 1.0 Hz | active at 3.25 s (the end of the third cycle) | within 2 cycles after 3 cycles |
| Frequency | 2.05 Hz | 2.05 Hz ± 2 % (P) |
| Onset cue | ±3.0° roll, ±0.19 g | ±3°, ±0.15 g (ESTIMATE) |
| Cue | amplitude ≤ 1 for 3 s | ≥ 3 s before growth can strike |
| Stirring on | strike 6.0 s after onset; crash "Main rotor struck the fuselage (half-P hop)" | 4-10 s |
| Hands still after 4 s of stirring | amplitude halves 2.5 s after release; the event ends 8.2 s after | halves in ≤ 3 s |
| One 2 cps stir | none | none |
| Lateral 0.6 in reversals at 1 Hz | onset at 4.16 s (after 4 cycles) | none before 4 cycles |
| Random single-axis 0.3-0.6 in, 0.3-1 Hz, 60 s (71 half-cycles, seeded) | none | none |
| AMCS, the same stirs; 135 KCAS | none; none | never in AMCS |
| Phase over 10 revolutions | = 0.5 × the unwrapped azimuth to 1e-9; sin φ steps ≤ 0.054 per step | continuous |
| halfp=1 | trim identical to the unforced one; active at the first clocked step; never in AMCS | |

In the sim (`index.html?aircraft=ah56&config=ics&halfp=1&scenario=cruise&run=2&freeze=1`): at 2.0 s the event is active, amplitude
0.44 (hands off: decaying), phase 25.65 rad (0.5 × 2 s × 25.76 rad/s), roll rate −8.7 °/s, n_z 1.06. With hands off a forced event
dies in about 8 s; stirring keeps it growing.
