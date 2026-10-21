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
