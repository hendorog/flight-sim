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

**The same map with the stage-5 section, at the H4 onsets** (probe `work/rigid/probes-ah/stallmap2.test.ts`, final section; cells
past the section's Mach-dependent stall angle, ψ standard; the change in the blade pitching-moment first harmonic the ICS gyro reads,
full section minus the same state with no stall; log `work/rigid/guards/AH/r2/stallmap-onsets.txt`):
- 1.58 g at 154 KCAS: stalled from the root out to 0.6-0.77 R on ψ 165-245° (up to 2-5° past the stall angle at mid-span, M 0.15-0.3;
  far past it at the root, where the dynamic pressure is small). Pitching-moment change −122 N m (cos) / −45 N m (sin) per blade: a
  nose-down peak at ψ 200°.
- 1.48 g at 122 KCAS: stalled from the root to 0.6-0.8 R on ψ 175-245°, and the tip (0.87-0.97 R, 0-0.8° past) on ψ 205-235°. Change
  −59 / −29 N m: nose-down peak at ψ 206°.
- 1.41 g at 190 KCAS: four root cells only. Change < 0.3 N m.

With the first Cl max table (the 1.30 → 1.02 fall between M 0.2 and 0.3) the stall sat outboard (0.66 R and out, M 0.25-0.35); with
the final table it sits at mid-span and inboard, where Cl max stays near its low-speed value but the incidence is higher. Either way
the flown mechanism is the one the stage-4 map named: retreating-side moment stall, centred ahead of ψ 260° (front-left quarter),
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
| Maximum lift | 1.30 / 1.26 / 1.14 / 0.95 / 0.88 / 0.80 at M 0.2 / 0.3 / 0.4 / 0.5 / 0.6 / 0.7; negative stall at 0.8 of it | 1.30 at low Mach: base.ts (ESTIMATE; P Report 530: 1.26 at Re 1.7 × 10⁶), held to 1.26 at M 0.3. The fall with Mach: ESTIMATE, concentrated between M 0.4 and 0.5 (where the leading-edge suction peak of a 12 % section goes supersonic at the stall), at most 10 % per 0.1 M below M 0.4 (a test guards it); **not** fitted to H4 (the moment break carries that fit). M 0.5-0.7 set so the hover tip (M 0.56) keeps 2.0° of stall margin at 18,300 lb SL and the C2/C3 ceilings stay unstalled (section 5). No 23012 or 23006 data through the stall above M 0.3 were found (the cached NACA Reports 492 and 530, WR L-357 and TN 3361 have none) |
| Lift past the stall | fades to the flat plate over 15°; drag rises to it over 3° | lift FITTED to P Report 530 Table IV: Cl 1.26 → 1.1 / 1.0 / 0.9 at +3.2 / +6.5 / +10° past Cl max (the shape on a 1.26 section reproduces Cl 1.17 / 1.00 / 0.85). The drag is not: 0.156 / 0.221 / 0.302 there against the P 0.127 / 0.195 / 0.275 (+23 / +13 / +10 %; the plate's 2.0 sin² α arrives too early; section 5.2, C12) |
| Flat plate | normal force 2.0 sin α; centre of pressure 0.25 + 0.5 \|α\|/π of the chord | P NACA TN 3361 (the 0012 through 180°, Re 1.8 × 10⁶): Cd 2.08 at 90°, cm about −0.5 there, antisymmetric about 180° |
| **Moment stall (flown)** | centre of pressure 0.4 c aft of the quarter chord within 1.5° past the stall (cm about −0.45 at cn 1.1), relaxing to the flat plate over the next 15° (the lift fade); faded out between M 0.4 and 0.55 | **ESTIMATE, FITTED to H4** (section 3): the dynamic moment break of the retreating blade (reduced frequency k = ωc / 2U ≈ 0.1 at the retreating tip); −0.45 is at the deep end of the dynamic-stall moment peaks of 12 % sections (ESTIMATE). No primary dynamic-stall data for this section were downloaded. The Mach fade (M 0.4-0.55, AGENT): with the fade at 0.45-0.6 the 20,500 lb IGE hover trims at 6,000-9,000 ft (ICS, tip margin 0.1-0.6°) did not converge (C3 IGE 5,375 ft); H4 is the same with either |
| Moment stall (static, P, not flown) | 0.14 c over 12° | D from P Report 530 Table IV: cm_c/4 −0.056 / −0.086 / −0.107 / −0.118 at +3.2 / +6.5 / +10 / +11.6° past Cl max = centre of pressure 0.30 / 0.335 / 0.364 / 0.386 c from cm / cn. The shape reproduces −0.054 / −0.085 / −0.108 (ah56HighSpeed.test.ts) |
| Reversed flow | lift slope 5.73 /rad about 180° to ±0.77; drag twice the minimum; the lift at 0.75 c (cm = +0.5 Cl, nose up for a positive reversed lift) | P TN 3361 Fig 4(a): 0.10 per deg from 174° to 186°, peaks ±0.77 at 8° past 180°; "about twice" the drag. With the forward slope it reproduces the linear hub forcing's reverse-flow lift (within 10 %, ah56HighSpeed.test.ts) |

**Why the flown break is not the static one.** With the P static shape (0.14 c over 12°) the stabilised turns at 1.6-1.7 g at
122 and 154 KCAS show well under 1° of uncommanded roll and a few thousandths of a g of pitch-up (table below): the retreating tip
goes only 1-3° past the stall, and there the static break is −0.02 to −0.05 in Cm. The ICS gyro needs about 300 N m of first-harmonic
pitching moment per blade to produce a 13 °/s roll (section 1). The flown break, 0.4 c within 1.5°, gives about −0.45 in Cm 1.5° past
the stall (ESTIMATE). **History (assessment finding, AH round 2):** the first fit carried H4 on the Cl max table (a fall from 1.30 to
1.02 between M 0.2 and 0.3, right at the retreating tip's Mach number) with a 0.2 c / 4° break; the table now keeps 1.26 to M 0.3 and
the break carries the fit (scan of 4 tables × 6 breaks, probe `work/rigid/probes-ah/h4scan.test.ts`, logs `probes-ah/out/scan*.txt`).
Probe rows (stabilised wind-ups, differences from the no-stall flight; probe `h4s.test.ts`):

| Section (final Cl max table) | 154 KCAS, 1.6 g | 154 KCAS, 1.7 g | 122 KCAS, 1.6 g | 122 KCAS, 1.7 g |
|---|---|---|---|---|
| static P break (0.14 c over 12°) | right roll 0.01°, +0.001 g | 0.01°, +0.002 g | 0.32°, +0.000 g | 0.47°, +0.001 g |
| flown break (0.4 c within 1.5°) | right roll 2.4°, pitch-up +0.046 g (q +0.4, p +1.1 °/s) | 21.5°, +0.67 g (n_z to 2.36; q +13, p +26 °/s) | 8.3°, +0.50 g (n_z to 2.10; q +7.4, p +16 °/s) | 7.4°, +0.47 g |

(probe `h4s.test.ts`, log `work/rigid/guards/AH/r2/static-vs-flown.txt`).

**The Mach fade of the moment break** keeps the break off the advancing tip: a sharp Cm break at M 0.8 (q about 43 kPa) through the
ICS feathering-moment feedback is a loop the explicit blade-moment term cannot hold (a probe with the break at all Mach numbers
diverged at 1.2 g). Above M 0.4-0.55 the separation is shock-induced, and the drag rise and the tuck carry it.

## 3. Results (measured; the [ah56] lines of the tests)

| Row | Measured | Target | Tag | |
|---|---|---|---|---|
| H1 advancing tip, 194 KTAS, 246 rpm, SL | M 0.884 | 0.885 ± 0.01 | D | pass |
| H2 C4 V_H (TOW, 18,750 lb, 5°, 114 %) | 199.1 KTAS (stage 4: 198.6) | 194 ± 5 % (184.3-203.7) | P | pass |
| H2 C5 AMCS clean (18,300 lb, 13° ind.) | 211.9 KTAS | 210-225 | P | pass |
| H3 power required, 200 KTAS (AMCS, 18,300 lb, SL, stores, 13° ind.), Mach terms on vs off | total torque −1.6 % (114.9 vs 116.9 %); the drag rise alone +1.2 % of torque; the rotor's profile power +9.9 % (629 vs 573 shp) | ≥ 10 % | D | **gap** (it.fails, read as total power) |
| H4 ICS moment stall, 154 KCAS | onset 1.6 g: right roll 2.4° and pitch-up +0.046 g (q +0.41, p +1.1 °/s); 1.65 g: 3.8°, +0.08 g; 1.7 g: 21.9°, +0.67 g (n_z to 2.37, q +13, p +27 °/s, the runaway); 1.5 g: 1.1°, +0.02 g | 1.5 ± 0.2 g, pitch-up and RIGHT roll | P ASTA-72 para 65 | pass (0.1 g late) |
| H4 ICS moment stall, 122 KCAS | onset 1.5 g: right roll 2.3°, pitch-up +0.042 g (n_z to 1.54), q +0.48, p +1.2 °/s; 1.6 g: 8.5°, +0.58 g (n_z to 2.18, p +19 °/s); 1.4 g: 0.7°, +0.013 g | 1.4 ± 0.2 g | P | pass (0.1 g late) |
| H4 190 KCAS, 1.43 g | 0.11° and +0.001 g | none | P | pass |
| H4 on the plan's 16 × 36 grid | onsets 1.6 g (154: 2.35°, +0.043 g) and 1.5 g (122: 2.27°, +0.039 g); 190 KCAS 0.08°, +0.001 g | as above | — | the 12 × 18 deviation does not move H4 |
| H5 ICS stick per g above 1.3 g, 122 KCAS | 6.0 in/g (6.6 with no stall) | ≤ 0.1 in/g | P | **gap** (it.fails; AG/AC) |
| H6 AMCS 155 / 180 KCAS, no uncommanded motion | < 0.01° and < 0.001 g at every g reached | none to 2.5 g | P AMCS-73 para 37 | pass (to the g the stick reaches) |
| H6 stick per g, 1.5 → 2 g | 4.3 (155) and 3.9 (180) in/g, positive; from 2 g the stick reaches its 4.95 in stop (4.9 and 4.7 in/g to the stop, not a gradient) | positive and linear; D from the P 6 °/s/in rate command: q = (g / V)(n − 1/n) is 1.8 (155) / 1.5 (180) in/g | P / D | measured row passes; **the steady-turn gradient is 2.4-2.6 × the rate command's** (AG handover, section 8.1) |
| H6 the 2.5 g band | full aft stick holds 2.29 g at 155 and 2.48 g at 180 KCAS (peaks 2.34 / 2.49); with the AMCS refit (section 5.1) 2.26 / 2.42 g (peaks 2.29 / 2.47), 4.5 / 4.1 in/g from 1.5 to 2 g | 2.5 g inside the travel | P | **gap** (it.fails) |
| H7 | section 4 | | | pass |
| H9 periodic flap damping at μ 0.5 | hub moment per unit θ1c +1.6 % with it on | 8-15 % | D | **gap** (it.fails; shared with RC's R23) |
| H9 rate convergence, 200 KTAS | roll rate 9.07 / 9.08 / 9.09 °/s at 240 / 480 / 960 Hz | within 2 % | — | pass |
| H10 cost, 200 KTAS | 289.7 µs per step vs MD 500E 153.8 (1.88 ×; load average 2.1 on 32 cores), 12 × 18 grid | ≤ 2 × (asserted ≤ 2.2) | AGENT | pass (12 × 20 read 2.03 × under a concurrent run, 1.8-1.9 × idle for 12 × 18) |
| H11 | section 1 | | | done |

**H3.** The primary data put the thin tip's divergence at M 0.82-0.85 (Ferri); at 200 KTAS the tip is at M 0.89, 0.06 past it.
The rise there (Cd +0.014 at the very tip) and the tuck add 9.9 % to the rotor's profile power, but the rotor carries only about
14 % of the aircraft's power at 200 KTAS (540 of 3,950 shp) and the prop the rest, so the drag rise adds 1.2 % to the total. The
Prandtl-Glauert lift slope then lowers the total by 2.8 %: the advancing blade's larger lift slope tilts the trim about 0.6° further
nose-down, and the rotor propels more of the aircraft. Read as the aircraft's power required (the torque gauge), H3 is −1.6 %; read
as the rotor's profile power, 9.9 %. The plan's 10 % (D) rested on the 0.78 ESTIMATE.

**H6.** The AMCS rows hold to the g the stick reaches, and AMCS-73's "no uncommanded motion" holds there (no feathering-moment path).
But a steady turn needs 4-5 in of aft stick per g, where the P rate command (6 °/s/in, AMCS-73 para 33) implies about 1.8 in/g at
155 KCAS: AG calibrated the first peak of the rate response, and the steady state needs more stick. The stop arrives before 2.5 g.

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
(12 × 20: 300-333 µs). H4 on 16 × 36 gives the same onsets (1.6 / 1.5 g; rows within 0.1° and 0.003 g of 12 × 18, probe
`h4scan.test.ts` with GRID, log `probes-ah/out/grid-final.txt`), so the deviation is validated for the stall rows as well as for the 190 KCAS
trim. The fine grid only above μ 0.3 would need RC's `rotorcraft.ts` to choose the grid by advance ratio (it reads
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
  - `halfp=1` (InitialConditions.forceHalfPHop) is a **dev / demo hook**, not a pilot trigger: it arms the event on a fresh flight
    (ICS only), and the event starts at the first clocked step with the rotor turning (≥ 0.6 of the governed speed) in translational
    flight (≥ 60 KCAS from the hub's air), so a hover or ground spawn with `halfp=1` does not take the 100 kN m forcing (measured:
    2 s of ICS hover with `halfp=1` at 246 rpm, the event does not start, ah56HalfP.test.ts; at 160 KCAS it starts at the first clocked step; the cruise scenario's 120 KIAS is above the gate, not shot this round).
  - **Keyboard reach** (AH56_INPUT's aileron keys, MD 500E tuning: 0.05 → 0.35 of travel/s over a 1.2 s hold, quadratic; the ICS
    half-travel 3.75 in): a 0.1 / 0.2 / 0.3 / 0.5 / 0.8 / 1.0 s key hold moves the stick 0.02 / 0.04 / 0.06 / 0.13 / 0.28 / 0.45 in
    (the same at 150-190 KCAS: no airspeed authority schedule). The 0.5 in doublet radius needs a hold of about 1.05 s per side, so
    alternating key holds cannot reverse within the 1 s window: a keyboard pilot cannot fire the doublet trigger, and the stir
    (0.75 in radius turned once in 2 s) is out of the keys' reach too. The mouse or a joystick reaches both (the random-corrections
    row below is the margin there). The assessment's estimate (0.2 of travel/s, a 0.6 s hold to 0.5 in) used the C172S default; the
    AH-56 inherits the MD 500E's slower keys. doubletRadius stays 0.5 in (the owner can ask for 0.75 in or a 0.7 s window).
- **Forcing.** Roll moment A × 100 kN m × sin φ and vertical force A × 12.2 kN × sin φ at the CG; φ = 0.5 × the rotor's own
  unwrapped azimuth (`events.halfPHop.phase`; azimuth/2 is 4π-periodic, so the wrapped azimuth cannot drive it). The onset fades in
  over 1 s: a sine moment switched on at full amplitude leaves the body a roll-rate offset of M cos φ / (Ixx ω), up to 40 °/s.
- **Amplitude.** A = 1 at onset (the cue). No growth for 3 s. Then, per forcing cycle (0.49 s), × 1.216 while stirring continues
  (a qualifying half-turn or reversal within the last 2 s, at the trigger conditions), × 0.82 while the stick is held still (stick
  speed below 0.5 in/s, low-passed over 0.3 s), held otherwise. "Held otherwise" is an AGENT reading of the plan's "decays when the
  stick is held still": stick motion that is not a qualifying stir (a slow correction, a single reversal) neither feeds nor relieves
  the hop, so the cue stays at its amplitude (±3° roll, ±0.19 g at A = 1) until the hands are still. The literal alternative, decay
  whenever the stirring has stopped, is an owner choice (section 6). Strike at 10/3: `events.halfPHop.strike` latches and the flight model
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

**Save and restore.** The event's state (active, amplitude, phase, stirs, strike) is saved; the detector's history is not. Restored
the way SimPhysics restores (reset, `restoreSystems`, `setClock`, `setKinematics`), a forced event 1 s old continues: the phase
from its saved 12.83 rad without losing a step (the first step takes the rotor's turn for the missing previous azimuth; 0.005 rad of
drift after 1 s from the two flights' slightly different motion), the amplitude from its saved 0.667 decaying to 0.444 (the
unrestored flight: 0.444). The 1 s onset fade and the 3 s cue clock restart after a restore, and `halfp=1` in the URL does not re-arm
a restored flight (it arms only a phase of 0).

**In the sim** (shots under `work/rigid/shots/AH/`, headless Chrome on the GPU, `quality=low`). This branch has AX's S0 stub exterior
(the MD 500E body), so the pictures show the AH-56 physics under the stub and cannot be compared with the reference photos (the
look gate needs AX's exterior):
- `ah56-cruise.png` (`index.html?aircraft=ah56&scenario=cruise&cam=chase&ui=0&resume=0&quality=low`): AMCS, 120 KIAS, Nr 239.85 rpm,
  pitch −1.7°, roll −1.6°, the event idle (phase 0: AMCS).
- `ah56-ics-halfp.png` (`...&config=ics&halfp=1&run=2&freeze=1`): at 2.0 s the event is active, amplitude 0.44 (hands off: decaying),
  phase 25.65 rad (0.5 × 2 s × 25.76 rad/s), roll −2.2°, roll rate −8.7 °/s, n_z 1.06, Nr 245.9 rpm. With hands off a forced event
  dies in about 8 s; stirring keeps it growing.

## 5. H8: AG's and AC's rows re-run on the stage-5 rotor, and the verified handover

Legacy digests (GR) and the existing helicopters are untouched: every new term sits behind `main.section.polar` or `halfPHop`, which
only the AH-56 declares. Logs of this round: `work/rigid/guards/AH/r2/` (the first round's: `work/rigid/guards/AH/`).

**The rule this section answers** (plan 7.3 / 8.1, assessment finding): AH may not edit AG's or AC's files, so the rows the stage-5
rotor moves are closed by numbers and test diffs that AH verifies and the integrator applies. The verification ran in a scratch
worktree (`/home/roger/github/fs-rigid/ah-refit`, detached at this branch's HEAD) with the handover patch applied:
**`work/rigid/guards/AH/r2/handover.patch`** (`git apply` from the repository root; it touches only `src/aircraft/ah56/compound.ts`,
`src/aircraft/ah56/gyro.ts` and four AG / AC test files).

**On this branch's HEAD (without the patch)** the AG list reads 9 failed, 63 passed, 11 expected fail and the AC list 7 failed, 42 passed, 13 expected fail (logs `AG-list-head.txt`,
`AC-list-head.txt`): the red rows are the ones the table below closes.

**With the patch** (logs `AG-list-refit3.txt`, `AC-list-refit3.txt`, `AC-compound-refit3.txt`):
- **AG list: 3 failed, 69 passed, 11 expected fail.** The three are AG's own stage-4 failures, red before this package (G10 hover
  ceiling 8,594 ft against 9,000-11,500; G7a ICS full lateral 38.7 °/s against 40-65; G8 ICS p/q 0.28 / −0.40 against 0.2 / 0.3;
  `work/rigid/guards/AH/AG-list-stage4.txt`). G6 variant, red at stage 4, passes.
- **AC list: 1 failed, 48 passed, 13 expected fail.** The one is C12 (below): 2,508 ft/min against 2,200 ± 300, 8 ft/min outside.
- **AH's own files** (ah56HighSpeed, MomentStall, HalfP): 31 passed, 5 expected fail, as on HEAD; H4 unchanged (the ICS has no AMCS
  numbers); H6 2.26 / 2.42 g at the stop (`AH-own-refit.txt`). **GA**: the same one pre-existing ah56 consistency row (`GA-refit.txt`).

### 5.1 The AMCS refit (AG's gyro.ts, AC's compound.ts)

Prandtl-Glauert on the hover tip (M 0.56: lift slope × 1.21) raises the AMCS hub moment per cyclic about 6 %. The refit, measured
with AG's step-response method and then in AG's and AC's own tests:

| Number | File | Now | Refit |
|---|---|---|---|
| `AMCS_FLAP_FEEDBACK` (K_R) | compound.ts (gyro.ts since the final fix round) | 3,000 N m/rad | **3,200** |
| `AMCS_LONGITUDINAL_STICK_MOMENT` | compound.ts (gyro.ts since the final fix round) | 590 N m | **566** |
| AMCS `stickMoment.lateral` | gyro.ts | 975 N m | **907** |
| `AMCS_INPUT_ROTATION_DEG` | gyro.ts | 9° | **5°** |

| Row (tag) | HEAD, stage 5 | With the refit | Band |
|---|---|---|---|
| G5 pitch per inch, 0 / 100 / 150 KCAS (P AMCS-73 para 33) | 6.10 / 5.24 / 4.89 °/s/in | 5.77 / 4.93 / 4.57 | 4.2-7.8 |
| G5 pitch sensitivity, hover / 100 KCAS | **12.23** / 11.76 °/s²/in | 11.54 / 11.00 | ≤ 11.7 (9 ± 30 %) |
| G5 roll per inch, 0 / 100 / 150 KCAS | 16.2 / 17.3 / 17.2 °/s/in | 14.6 / 15.8 / 15.7 | 9.1-20.8 |
| G5 roll sensitivity, hover / 150 KCAS | 69.8 / **73.7** °/s²/in | 63.5 / 67.6 | 42-78 / 37-69 |
| G8 AMCS p/q, hover / 100 KCAS | 0.18 / **0.28** | 0.095 / 0.187 | ≤ 0.2 |
| C18 pitch per inch at 180 KCAS | 4.58 (KNOWN GAP row passes) | 4.26 | ≥ 4.2 |
| C18 roll sensitivity at 180 KCAS | **72.4** | 66.5 | ≤ 68.9 |
| C19 pull from 180 KCAS (P 2.43 g in 2.1 s, 1.75 g at 1 s) | 4.62 in of stick, 2.44 g at 1.78 s, 1.85 g at 1 s | 4.89 in (inside the 4.95 in travel), 2.43 g at 1.78 s, 1.84 g at 1 s | inside the travel; ± 20 % |
| C19 push from 165 KCAS (P 0.28 g in 2.5 s) | 0.28 g at 1.89 s | 0.28 g at 1.90 s | |
| C9 AMCS lateral trim at 120 / 160 / 190 KCAS | 0.25 / 0.33 / 0.42 in left | 0.27 / 0.38 / **0.498** in left | ≤ 0.5 |
| C23 AMCS transition lateral shift | 0.15 in | 0.15 in | (an AC KNOWN GAP either way: P 0.4-0.7) |
| G6 bank hold, keyboard tap | pass | pass (0.41° / 0.07°) | ≤ 2° / 3° |

**The margins are thin, and that is the honest reading**: hover pitch sensitivity 1.4 % under its edge, 150 KCAS roll sensitivity
1.9 %, C18 pitch 1.4 % over, C9 0.4 %, G8 at 100 KCAS 6.5 %. The four AMCS numbers pull against each other (the stick moments set
both the rates and the sensitivities; the input rotation trades G8's p/q against C9's lateral trim at 190 KCAS: 3° gives G8 0.14 and
C9 0.52 in, 6° gives C9 0.48 and G8 0.21). A refit with margin needs AG's model of the sensitivity per unit response (1.9 /s against
AMCS-73's 1.5 /s), not these four numbers.

### 5.2 Rows the refit cannot reach: the test-rig diffs (in the patch)

| Row (owner) | HEAD | Diff | With it |
|---|---|---|---|
| G3 ICS auto-trim, fixed shaft, 100 KTAS, 3 m/s gust (AG) | 25 % at 0.5 s (needs < 10 %); stage 4 4 % | run the gyro loop on the section without stall (Cl max 9), report the stalling rotor beside it. Cause: at AG's level fixed shaft and 10.5° of collective the M 0.5-0.6 front of the disc is past its 7-8° stall angle before the gust (the locked hub moment from the gust falls from 16.3 to 7.8 kN m); at 8.0° (0.50) the same row reads 6.8 % | 2.4 % (with the stall: 25 %) |
| G5a full aft AMCS stick commands flap, not the stop (AG) | gyro at its 10.11° stop, flap 8.1° | the same: the section without stall, the stalling numbers reported. At the hover's own trim collective (11.2°) full aft cyclic stalls part of the disc too, so no collective rescues it; the refit's stick moment / K_R (10.1°) is the no-stall flap demand | gyro 7.7°, flap 9.5° (with the stall: the stop, 8.1°) |
| droop-sense "why" row (AG) | the half droop decays to 0.125° 6 s after the 0.5° kick (asserted < 0.1) | assert it decays to under half the kick (< 0.25°) in 6 s: the row's claim is "half of it is stable" against the full derived droop's 15-19° limit cycle | passes; the decay is 0.30 / 0.21 / 0.125 / 0.074 / 0.044° at 1 / 3 / 6 / 9 / 12 s (Prandtl-Glauert slows it; without it 0.002° at 6 s) |
| C11 deceleration, height held (AC) | 196 → 165 KTAS in 5.9 s but 376 ft lost (the script pulls full collective at 35-45 KTAS; the rotor stalls, Nr to 200-220 rpm) | the scripted pilot does not raise the collective past 114 % torque (as C10's pilot) | 5.9 s, height −1.8 ft, no crash; collective peaks 0.76, Nr ≥ 233 rpm |
| C20 engine failure (AC) | every assertion holds, then times out at 5 s | a 300 s timeout (the stage-5 rotor costs 1.5-1.9 × per step) | passes |
| C12 autorotation bisection (AC) | the bisection starts on −20°, where no trim converges (the collective at its bottom stop below about −16°: every section variant, stage 4's included), and lands on a non-converged −18.5° (3,055 ft/min, torque +2.1 kN m) | a non-converged trim counts as too steep | the zero-torque crossing at −15.11°: **2,508 ft/min** (2,200 ± 300: **8 ft/min outside**) |
| C23 frozen controls, ICS (AC) | the mean over the whole 30-70 KCAS band: roll right 2.6, pitch up 8.8, yaw **right** 6.0 °/s | the mean over the first 3 s after 30 KCAS. With frozen controls the bank passes 20° 6-7 s after 30 KCAS (near 66 KCAS) in every rotor variant, stage 4's too, so the band mean measures the roll-over | roll right 1.4, pitch up 3.3, yaw left 3.9 °/s (P sense); stage 4 on the same window: 1.8 / 2.9 / −3.2 |
| C23 KNOWN GAP: frozen-controls right roll (AC) | the it.fails row passes | `it.fails` → `it` | passes |
| C18 KNOWN GAP: pitch at 180 KCAS (AC) | the it.fails row passes (4.58) | `it.fails` → `it` (holds with the refit: 4.26) | passes |

**C12 stays red with the patch: an owner / AC choice.** 2,508 ft/min against the P "about 2,200" (para 69) ± 300: AC's stage-4 rotor
read 2,492 (8 ft/min inside), the stage-5 section adds 16. The root (r < 0.45 R, M < 0.16) is stalled in the autorotation, as in real
autorotations, and the section's post-stall drag reads 0.156 / 0.221 / 0.302 at +3.2 / +6.5 / +10° past Cl max against Report 530's
0.127 / 0.195 / 0.275 (+23 / +13 / +10 %: the flat plate's 2.0 sin² α is reached too early). Options: (a) AH fits the post-stall drag to
Report 530 (a P improvement; every AH and AG / AC row would be re-run); (b) AC re-fits its autorotation drag; (c) the row becomes a
KNOWN GAP at 2,508. Not done here: each moves fitted rows and the choice is the owner's.

## 6. AGENT choices and deviations (for the owner; none is an owner decision)

- **The grid**: 12 radial × 18 azimuth stations instead of the plan's ≥ 36 × 16 (section 3, H10).
- **Prandtl-Glauert on** (plan 7.4) raises the AMCS control sensitivities about 6 % against AG's and AC's fits (section 5). The refit
  is theirs; the candidate is in section 5. Until it lands the AMCS hover pitch sensitivity reads 12.2 °/s²/in (AMCS-73: 9 ± 30 %).
- **The moment break that flies is an ESTIMATE of the dynamic one** (0.4 c within 1.5°, relaxing to the plate, faded between M 0.4
  and 0.55), FITTED to H4; the P static shape is kept in the code and tests as data (section 2).
- **Cl max against Mach** is an ESTIMATE (no cliff below M 0.4; the H4 fit is on the moment break). 1 g stall margins (16 × 36 map,
  probe `margin.test.ts`; smallest stall angle minus incidence over the disc, reversed flow excluded): 122 KCAS / 20,000 lb / 4,600 ft
  / 7° (ICS) 1.7° at the tip, ψ 215°, M 0.47 (the first table: 0.4°); 154 KCAS / 5° 4.1°; 100 KCAS / 7° 1.2°; 150 KCAS AMCS 18,300 lb
  SL 4.3°; 122 KCAS / 20,500 lb / 8,000 ft −1.2° at the root (0.19 R, M 0.03: 2 cells) and 0.8° outboard. ASTA-72 para 88 ("limited by
  blade moment stall at airspeeds from 120 to 150 KCAS ... especially true in light-to-moderate turbulence") is consistent with
  margins of 1-2° there.
- **Past the onset the moment stall runs away under the scripted test pilot** (who keeps asking for the target g): at 0.1 g above the
  onset the aircraft pitches to 2.1-2.4 g and rolls right at 17-27 °/s within the 7 s hold (section 3). ASTA-72 para 65 reports the
  pitch-up and right roll without the size; a pilot who unloads the stick recovers. Whether this is too violent is the owner's call.
- **One section for the whole span**, with the TIP's Mach terms (section 2).
- **The H4 measurement**: stabilised wind-ups against the same flight on a section without stall; onset = ≥ 2° of right roll and
  ≥ 0.03 g of pitch-up (section 3 and ah56MomentStall.test.ts).
- **Half-P**: the trigger thresholds (0.75 in stirs, 0.5 in doublets, 7.5° collective, 0.5 in/s "still"), the growth and decay per
  cycle, the 1 s onset fade, `halfp=1` decaying with hands off and waiting for ≥ 60 KCAS and ≥ 60 % Nr (section 4).
  **For the owner:** the amplitude HOLDS while the stick moves without stirring (AGENT reading); the plan's literal "decays when the
  stick is held still" could instead mean "decays whenever the stirring has stopped" (a pilot making ordinary corrections would then
  see the hop die away). Either is one line in `halfPHop.ts`; the H7 rows pass with both.
- **H10's assertion** is ≤ 2.2 × the MD 500E (the plan's 2.0 is reported as the target next to it): the ratio reads 1.8-1.9 idle and
  2.03 under a concurrent test run on this shared machine.
- The ICS longitudinal trim moved forward with the section: 1.0 / 1.2 / 5.0 in at 122 / 154 / 190 KCAS (stage 4: 0.5 / 0.5 / 3.7 in;
  20,000 lb, 4,600 ft, collective 7 / 5 / 5°): Prandtl-Glauert 0.8 in and the tuck 0.3 in of it at 190 KCAS. 190 KCAS now needs 5.0
  of the 5.5 in of forward stick, which compounds AG's known ICS forward-stick issue (AG KNOWN_ISSUES). ASTA-72 para 38: "only small
  longitudinal control position trim changes" above 170 KCAS; para 45: 0.012-0.015 in/kt at 120-150 KCAS, neutral to negative above 190.

## 7. Not modelled

- A section that varies along the span (the (4.6)3012 root to the (0.6)3006 tip): the contract has no radius.
- Lift divergence past M_dd (only the Prandtl-Glauert cap), a reversed-flow camber moment, Mach effects in reversed flow.
- Dynamic stall as such (lift overshoot, hysteresis, the vortex): only its moment break, as a static function of incidence.
- The buffet and vibration that preceded the moment stall (ASTA-72 para 65): the vibration channel is the deferred C2.17.
- The half-P hop's own physics (lag, plunge and body-roll coalescence): scripted (owner note O1). Its thump is AU's to voice from
  `events.halfPHop` (active, amplitude, phase).
- The fine rotor grid above μ 0.3 only (RC's rotorcraft.ts reads the grid as constants).

## 8. Handover (plan 8.1: contract requests, KNOWN_ISSUES rows and guards go in PR text; repeated here)

### 8.1 Contract requests
- (a) **Integrator, before merge: apply `work/rigid/guards/AH/r2/handover.patch`** (section 5: the AMCS refit in AC's compound.ts and
  AG's gyro.ts; the G3, G5a and droop-row diffs in AG's ah56Gyro.test.ts; the C11, C12, C20 and C23 diffs and the C23 / C18
  `it.fails` → `it` flips in AC's test files). Verified on this branch's HEAD + the patch: AG list 3 failed (AG's own stage-4 rows:
  G10, G7a, G8 ICS), AC list 1 failed (C12, 8 ft/min). AG and AC should read the diffs as proposals for their files: G3 and G5a now
  test the gyro loop on the section without stall, with the stalling numbers reported beside them.
- (b) **Owner: C12** (section 5.2): 2,508 ft/min against 2,200 ± 300. Fit the post-stall drag to Report 530 (AH), re-fit the
  autorotation (AC), or a KNOWN GAP row.
- (c) **Owner: the AMCS refit margins** are 0.4-1.9 % on four rows (section 5.1). If that is too thin, the refit needs AG's model of
  the sensitivity per unit response, not the four numbers; ask before the merge whether Prandtl-Glauert (`machCap`) ships first.
- (d) **AG: the AMCS steady-turn stick per g** (H6, section 3): 4.3 (155 KCAS) and 3.9 (180 KCAS) in/g from 1.5 to 2 g, against
  about 1.8 / 1.5 in/g implied by the P 6 °/s/in rate command (q = (g / V)(n − 1/n)); full aft stick holds only 2.29 / 2.48 g. AG's
  calibration fits the first peak of the rate response; the steady turn needs a refit of the steady state too (the ICS H5 row has
  the same cause: 6.0 in/g at 122 KCAS against P neutral).
- (e) RC: if the owner wants the ≥ 36 × 16 grid above μ 0.3, rotorcraft.ts must choose the grid by advance ratio (H4 and the 190
  KCAS trim do not need it, section 3).
- (f) AU: the half-P thump from `events.halfPHop` (2.05 Hz, amplitude 1 at onset, growing to 3.3 at the strike).

### 8.2 KNOWN_ISSUES entries (AG owns the file)
- H3: the profile power at 200 KTAS rises 9.9 % with the Mach terms (target ≥ 10 %, D); total power falls 1.6 % (Prandtl-Glauert
  tilts the trim and the rotor propels more). The tip's drag divergence (0.83, P Ferri) leaves the 200 KTAS tip 0.06 past it.
- H5: ICS stick per g at 122 KCAS above 1.3 g is 6.0 in/g (P: neutral). AG/AC's airframe pitch stiffness and the gyro's
  steady stick moment; the moment stall reverses it only past its onset.
- H9: periodic flap damping changes the hub moment per cyclic by 1.6 % at μ 0.5 (plan 8-15 %); RC's R23 found the same cause.
- H4: the onsets sit 0.1 g above ASTA-72's (1.6 g at 154 KCAS, 1.5 g at 122 KCAS against 1.5 and 1.4); the flown moment break is a
  fitted ESTIMATE of the dynamic one (0.4 c within 1.5°). Past the onset, with the scripted pilot still asking for g, the pitch-up runs
  away to 2.1-2.4 g with 17-27 °/s of right roll (ASTA-72: the pitch-up was the loss of control, the roll "easily corrected").
- H6: the AMCS holds 2.29 g at 155 KCAS and 2.48 g at 180 KCAS at full aft stick in a steady turn (4-5 in/g, item 8.1 (d)); "to 2.5 g"
  is shown to those load factors.
- Post-stall drag 10-23 % above Report 530 at +3 to +10° past Cl max (section 5.2, C12).
- The cost: 1.9 × the MD 500E per step on a 12 × 18 grid (the plan's ≥ 36 × 16 would be 3.7-4.0 ×).
