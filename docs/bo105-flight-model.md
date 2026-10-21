# MBB Bo 105 CB-4 flight model

Package BO of the hingeless / rigid-rotor programme (plan revision 2, sections 0, 4 and 6.1-6.2). The aircraft is the
**Bo 105 CB-4** (two Allison 250-C20B, ZF FS 72B, 2500 kg, Type 1 blades), an AGENT choice; nothing in this file is an
owner decision. Code: `src/aircraft/bo105/{hub,coning,rotorcraft,dimensions,facts,reference,mass,powerplant,limits,input,
sim,index}.ts`; the rotor core is RC's (`docs/rotor-hingeless-model.md`), the twin drivetrain TW's
(`docs/twin-turboshaft.md`, data `bo105/twin.ts`). Tests: `tests/rotorcraft/bo105{Rig.ts,Derivatives,Handling,Performance,
Systems}.test.ts`, `tests/aircraft/bo105Physics.test.ts`; `BO105_TRACE=<dir>` writes each file's numbers as JSON.

Tags: **P** primary (EASA TCDS R.011, AGARD AR-280, LS-178, NASA, BK117-ERF7), **P5** the CB-5 flight manual used for the
CB-4, **F** family (CB-5 performance, METU/Theodore), **S** secondary (Jane's), **D** derived (arithmetic shown), **3V**
three-view or photo, **ESTIMATE** judged. Each calibration has one knob (plan 6.2) and its before/after numbers below.
Known gaps are `it.fails` rows; none is fitted.

## 1. What a pilot will notice (2200 kg mid-CG unless stated; target and tag beside each)

| | Measured | Target (tag) |
|---|---|---|
| Roll, 10 % lateral step at 80 KCAS | peak 11.0 deg/s (0.5 s), 9.2 deg/s at 1 s; roll mode 1/T 10.9 1/s (tau 0.092 s) | 12.5 deg/s +/-30 %; 8.49 1/s +/-30 % (P AR-280; DLR model peak 11.8) |
| Pitch, 10 % longitudinal step | 53.5 deg/s^2 quasi-static; 12.3 deg/s at 0.5 s (time response peak 34.9 deg/s^2: the flap lag) | 53 deg/s^2 +/-30 %; DLR model 12.5 deg/s at 0.5 s (P/D) |
| Pedal, 10 % step at 80 KCAS | peak 8.3 deg/s in 0.5 s; -2.6 deg/s at 2 s; sideslip 3.1 deg at 2 s, about 4 deg steady | 8-15 deg/s; < 3 deg/s; 5-8 deg (ESTIMATE; DLR model 3.5 deg at 2 s, 5.5 steady) - **sideslip gap** |
| Keyboard: 1 s lateral key tap at 80 KCAS | stick 0.11 of the axis (5.6 % of travel); bank 11.0 deg 2 s after the release, still rolling 4 deg/s | 8-14 deg (ESTIMATE) |
| Hover IGE attitude | pitch +3.0 deg, roll 3.0 deg left | +1..+4; 1-3 left (ESTIMATE) |
| Pitch in level flight | +0.4 (60 KIAS), -3.5 (100), -5.8 (120), -8.8 deg (145) | -1..+2, -2..-5, -4..-7, -6..-9 (ESTIMATE) |
| Ground stance / lift-off | fuselage +1.35 deg on level ground; hover +3.0 (jump 1.6 deg) | within 1.5 deg of level; jump <= 2 deg |
| Hover turn, full pedal (IGE) | 90 deg/s at 0.9 s (right), 1.5 s (left); peaks 165 / 129 deg/s | >= 90 deg/s within 3 s (ESTIMATE; FM limit 90 deg/s) |
| Low g (100 KIAS) | roll acceleration to a 10 % step: 87.8 % of the 1 g value at 0.2 g, 84.8 % at 0.01 g | >= 80 % (D) |
| Hover torque per engine, SL | 2500 kg OGE 82.7 %, IGE 72.0 %; 2200 kg OGE 70.6 %, IGE 61.8 % | 79-83, 72-78, 67-74, 61-69 % (D from the ceiling row) |
| Hover ceilings, 2500 kg ISA | HOGE 3,130 ft, HIGE 6,235 ft; HIGE 8,510 ft at 2300 kg | 3,850 / 6,200 / 8,900 ft +/-1,500 (ESTIMATE / S) |
| Vy, cruise, fuel | Vy 59.5 KIAS; max cruise 130 KTAS at 2500 kg MCP (86 % at 760 C); 145 kg/h at 90 KCAS 2500 kg | 60 +/-8 (P5); 125-135 (S/F); 143 +/-15 % (D/F) |
| Climb at 60 KIAS SL | AEO 2 x 86 %: 2,110 ft/min (2200 kg), 1,640 (2500 kg); OEI 95 %: +315 / +30 ft/min | 1,575 +/-20 %, 1,150-1,400 (S/ESTIMATE) - **climb gap**; +300..+650, -100..+250 (ESTIMATE) |
| Autorotation, collective full down, 75 KIAS, engines off | NR 107.5 % (2200 kg), 85.4 % (1400 kg), 114.7 % (2500 kg); 85.4 % at 1400 kg / 60 KIAS | 104-110, 83-88, 111-117; >= 85 % (ESTIMATE in P 85-110 %) |
| Autorotative descent, NR held 100 % | 2,040 ft/min (60 KIAS), 2,120 (75 KIAS); 2,280 at 100 KIAS / 87 % NR | 1,800-2,400; 2,000-2,600; faster at 100 / 85 % (ESTIMATE / P5 order) |
| Double engine failure at 120 KIAS | nose LEFT; NR 95 % at 0.22 s, 85 % at 0.73 s | LEFT; 0.15-0.35 s; 0.6-1.1 s (P sense / D) |
| One engine out (T7a, 60 KIAS, 2 x 45 %) | NR min 97.5 %; survivor 88.1 % settled; nose LEFT first at 6.7 deg/s | >= 92 %; <= 95 %; LEFT <= 10 deg/s |
| Ground idle, both levers IDLE | 58.9 % NR at 64 % N1 | about 60 % (P5 FM 4-11) |

## 2. The hub and the rotor (hub.ts, coning.ts)

RC's recorded set, adopted (docs/rotor-hingeless-model.md section 8): equivalent hinge **e 0.12 R** (0.590 m; P
BK117-ERF7 "12 percent, zero spring"), rotating first flap frequency **nu 1.11/rev** (AGENT inside 1.10 TM-85990 - 1.12
TM-103867; the spring makes up the rest, K_beta 13 % of (nu^2 - 1) I_beta Omega^2, derived by `hingelessSpring`),
**precone 2.5 deg** (P TM-85990), delta-3 0, and the three rotor-model options on (Pitt-Peters harmonic inflow, radial
flow, hub-aware blade elements): the fitting rule's binding configuration. Lift slope 6.0/rad (RC's ESTIMATE), maxCl 1.3
(ESTIMATE), root cut-out 1.10 m (F/S METU Table 9: 3.61 ft), twist -6.2 deg (P AR-280, AGENT over -8 deg).

**The fitting rule's two knobs on the real airframe.** ν stayed at 1.11 (chosen before measuring). The (ν, inertia) grid
at 80 KCAS / 3000 ft with this airframe (stabiliser slope 3.5, before its own calibration):

| inertia kg m^2 (gamma) | nu | Lp | Mq | Lq | Mp | Lq/\|Lp\| | Mw | roll 1/T | phugoid zeta |
|---|---|---|---|---|---|---|---|---|---|
| 850 (5.47) | 1.10 | -10.06 | -3.76 | 1.50 | -0.37 | 0.149 | 0.024 | 10.30 | -0.131 |
| **850 (5.47)** | **1.11** | **-10.67** | **-4.00** | **2.07** | **-0.52** | **0.194** | **0.031** | **10.85** | **-0.148** |
| 850 (5.47) | 1.12 | -11.24 | -4.21 | 2.67 | -0.67 | 0.238 | 0.038 | 11.34 | -0.163 |
| 900 (5.17) | 1.10 | -10.95 | -4.08 | 2.10 | -0.52 | 0.192 | 0.027 | 11.12 | -0.123 |
| 900 (5.17) | 1.11 | -11.59 | -4.33 | 2.76 | -0.69 | 0.238 | 0.035 | 11.67 | -0.139 |
| 900 (5.17) | 1.12 | -12.17 | -4.55 | 3.46 | -0.87 | 0.284 | 0.042 | 12.13 | -0.153 |
| 950 (4.90) | 1.11 | -12.50 | -4.66 | 3.51 | -0.88 | 0.281 | 0.038 | 12.45 | -0.131 |

Envelope edges: Lp -11.41, roll mode 11.04 (8.49 x 1.3), Lq/|Lp| 0.25. On this airframe (its CG 1.53 m below the hub,
section 3) RC's 900 kg m^2 puts Lp (-11.59) and the roll mode (11.67) outside; **850 kg m^2** is the only inertia in the
band that keeps both inside at ν 1.11. Lq/|Lp| then misses (0.194), as it did on RC's fixture (0.240): the hub gives
almost none of it (RC docs section 4). Calibration: inertia 900 -> 850 kg m^2 (Lp -11.59 -> -10.67, roll mode 11.67 ->
10.85 1/s, Lq/|Lp| 0.238 -> 0.194).

**Control phase** (sole knob of the off-axis control ratios): RC's least-squares method (settled off-axis moment ratios
of +/-0.02 cyclic steps against the means of the DLR and AFDD control derivatives, -0.084 and +0.145, 1 deg grid) on
this airframe: best **28 deg** (RC's fixture: 30). Before/after: lateral-step M/L -0.106 -> -0.065, longitudinal-step
L/M +0.203 -> +0.172 (bands 0.25 / 0.3). Lq and Mp are identical with the phase and without it (1e-6).

**Parked blades** (coning.ts): the solver's uniform blade (21.9 kg), the derived spring, a droop stop -1.5 deg (ESTIMATE)
and a bending rigidity 1.1e4 N m^2 (3V: parked tip about 0.25 m below the hub plane in the photos; D non-rotating first
flap about 1.4 Hz). The exterior draws the blades from this definition (BX imports `BO105_BLADE_CONING`).

## 3. Airframe, mass and CG (rotorcraft.ts, dimensions.ts, mass.ts)

The physics flies the geometry contract: hub at STA 3.150 m, 2.90 m above the skid soles; tail rotor on the LEFT at the
fin top, STA 9.14 m, **2.80 m** up (raised from the scaffold's 2.30 m at BX's request: the MM's "about 3.80 m with a
blade vertical" less R, OCR UNVERIFIED, and the D-HADO near-profile; 3V/D); the stabiliser 0.8 m^2 at STA 7.55 m with
two 0.19 m^2 endplates; the swept fin from its 3V outline; the skids on two bending cross tubes (the R44's gear law scaled
by mass, ESTIMATE), track 2.53 m (P5), contacts at STA 2.00 and 4.25 m, set **1.25 deg nose-up** to the fuselage
(AGENT: FM Fig 1-1's 1.5 deg dimension read as nose-up, the ground-stance row's knob: level skids gave 0.07 deg on the
ground and a 2.9 deg jump at lift-off; now 1.35 deg and 1.6 deg).

Aerodynamic ESTIMATES set from geometry before measuring: fuselage moment derivatives from a slender-body (Munk) estimate
of the pod and boom times 0.6 (pitch 4.5, yaw 3.0 N m/(Pa rad)); drag areas 1.5 / 5.5 / 6.5 m^2 (x the cruise knob:
130 KTAS at MCP, inside 125-135, so unchanged); fin slope 2.5 with half of it in the tail rotor's intake stream; the
stabiliser's effective lift slope is the **Mw knob** (plan 6.2): 3.5 -> **3.0** per rad, Mw +0.031 -> +0.040 at 80
KCAS (envelope from +0.037), phugoid time to double 12.3 -> 8.7 s (7-30 s). Slopes 2.5 and below give Mw +0.048..0.065
but a phugoid doubling in 6.6 s or less.

**Mass.** Empty 1276 kg (S Jane's); seats and cargo 3V (pilot RIGHT front, P TCDS p11); tanks under the floor; the AR-280
inertia (P) about the CG of the 2200 kg typical loading. The empty CG is not a weighing: longitudinally it is placed so
the typical loading sits at mid-envelope for 2200 kg (STA 3.202 m, D from the TCDS p11 lines), vertically it comes from
an ESTIMATE component breakdown (blades and hub high, the FS 72B 152 kg (P MM), engines, deck, boom, cabin, interior,
skids: 1.75 m above the soles). **The Theodore model's "CG 3.15 ft below the hub" (F METU) cannot hold** with the AR-280
roll inertia and underfloor fuel: placing the empty CG to reach it (2.6 m up) left the fuel alone carrying 945 of the 1433
kg m^2 of Ixx, and the empty airframe's own roll inertia fell to 70 kg m^2 at 1500 kg and below zero at 1400 kg; the
flight model then diverged numerically within ten steps of a collective dump. With the breakdown the 2200 kg CG is 1.53 m
below the hub and Ixx stays 888 kg m^2 at 1400 kg. The body reference point stays 0.96 m below the hub (dimensions.ts).

## 4. Control travels and the rigging (rotorcraft.ts, hub.ts)

No rigging data (research-bo105 section 8). Each TOTAL travel is fitted to its AR-280 control derivative at 80 KCAS /
3000 ft / 2200 kg, taking AR-280's "%" as % of FULL travel (0.02 of the sim's -1..1 axis; 0.01 of the collective):

| Knob | Before | After | Target (P AR-280 DLR) |
|---|---|---|---|
| longitudinal travel | +/-10 deg: M_lon 0.136 | 13.43 deg: 0.0933 | 0.093 rad/s^2 per % +/-5 % |
| lateral travel | +/-8 deg: L_lat 0.346 | 8.25 deg: 0.186 | 0.185 +/-30 % (L_lat/M_lon 2.00, band 1.5-2.5) |
| tail-rotor pitch range | 28 deg: N_ped 0.086 | 16.74 deg: 0.0490 | 0.049 +/-30 % |
| collective range | 15 deg: Z_col -0.272 | 19.23 deg: -0.352 | -0.349 m/s^2 per % +/-30 % |

Where the stops sit is an AGENT/ESTIMATE rigging: the envelope needs 9.41 deg forward (145 KIAS, 2200 kg, aft CG) and
2.63 deg aft (20 kt rearward, 2500 kg, forward CG), so the longitudinal stops are 10.10 forward / 3.33 aft of the zero-cyclic
swashplate (5.2 % of travel left at each end; the plan's 10 % for rearward flight cannot be had: known gap); lateral
+/-4.125 (25 kt sideward from the left at 2500 kg needs 2.42 deg left: 21.9 % left); tail rotor -1.89 to +14.85 deg (25 kt
sideward from the right at 2500 kg needs 13.18 deg, 10.9 % pedal left; a 75 KIAS autorotation about 0.2 deg). These
travels are the strongest assumption in the model: they set the 120 KIAS stick position (0.44 of travel forward of the
hover, plan 0.20-0.35), the slope-landing hub moment (section 7) and the autorotation collective (0.08 of travel at
2500 kg for 100 % NR, plan 0.15-0.35).

## 5. R18-R20 on the real definition (80 KCAS, 3000 ft, 2200 kg; quasi-static, rotor states re-settled)

| | Lp | Mq | Nr | Mw | Zw | Lv | Nv | Xu | Lq | Mp |
|---|---|---|---|---|---|---|---|---|---|---|
| envelope | -11.41..-5.95 | -5.84..-2.45 | -1.39..-0.60 | +0.037..+0.125 | -1.54..-0.70 | -0.352..-0.145 | +0.057..+0.152 | -0.077..-0.027 | +1.5..+4.5 | -1.6..-0.3 |
| inflow ON | -10.67 | -3.96 | -1.24 | +0.040 | **-0.683** | -0.199 | +0.136 | -0.045 | +2.07 | -0.52 |
| inflow OFF | -10.61 | -2.97 | -1.22 | +0.017 | -0.683 | -0.199 | +0.137 | -0.047 | +0.37 | -0.09 |

Ratios Lq/|Lp| **0.194** (0.25-0.50: miss, RC's rotor/inflow limit), Mp/|Mq| -0.130 (-0.1..-0.3). Mw +0.039 at 120 KCAS.
Control derivatives as section 4. Modes (8-state model of these derivatives): roll 1/T 10.85 1/s (tau 0.092 s; 8.49 +/-30 %),
Dutch roll 2.70 rad/s zeta 0.18 (2.5 +/-30 %, 0.05-0.30), phugoid zeta -0.20 at 0.39 rad/s (period 16.3 s, doubles in
8.7 s; DLR -0.15 / 0.33 rad/s). R20 (matrix pencil, 0.1 s lateral pulse at 78 KIAS): 12.6 rad/s, zeta 0.63 (P LS-178
13.7 rad/s +/-30 %, 0.3-0.7). Hover (IGE, SL; ESTIMATE bands): L_lat 0.189 and M_lon 0.082 per % (inside), **Lp -12.1 1/s,
tau 0.083 s** (band -6..-10, 0.1-0.2 s: miss; the hover inflow gradient, RC docs section 8). The hover's 8-state model:
roll subsidence 12.1 1/s, pitch 3.56 1/s, an unstable oscillation 0.31 +/- 0.53i (period 12 s, doubling in 2.3 s; Mu
+0.094), a stable one -0.29 +/- 0.58i, subsidences 0.24 and 0.50 1/s.

## 6. Engines, governor and fuel (powerplant.ts, rotorcraft.ts)

Both engines are **TW's installed 250-C20B** (`BO105_INSTALLED_C20B`: 82 % at 738 C, 95 % at 810 C at the N1 stop). A
power-turbine law of 2 (the repo's PT6A types) was tried to remove TW's "BLOCKING" OEI torque conflict and **rejected**:
it lowered the engines' torque at low N2 so far that both levers at IDLE held 51.8 % NR on the ground (P5: about 60 %;
the law of 3 gives 58.9 %), and on this rotor the law of 3 no longer breaks the bound: the T7b survivor tops at 103.7 %
with NR at 95.9-96.8 % (the scaffold's rotor drooped to 94.6 % and read 106.4 %).

Indication and limits: `BO105_TURBOSHAFT_INDICATION` (TW): torque in % of 298 kW, AEO 86 %, OEI 95 %, TOT 779 / 810 C,
N1 105 %. Freewheel cap 899 N m (TW). The droop compensator re-fitted on this rotor by TW's two readings (docs/
twin-turboshaft.md section 8): flat pitch on the ground at 100 % NR, N1 77.40 % per engine (datum 0.773 -> **0.774**), the
2200 kg OGE hover at collective 0.3827 with N1 95.34 % (anticipation 0.39 -> **0.469**). After: a hover reset reads N2 SET
99.97 % (T10, was 100.13 % before the refit), the beep stops give N2 98.09 / 101.91 % (T6, within 0.2 %).

Fuel: supply 74 kg (tank 0, `fuel.left`), main 382 kg (tank 1, `fuel.right`), as the panel reads them. The two transfer
pumps keep the supply tank full until the main tank is empty (P5 FM 7-14): the fuel system draws equal shares, so each
feed lists the main tank fifty times and the supply tank once (ESTIMATE approximation): the supply tank holds 66.3 kg when
the main tank runs dry and LOW FUEL (supply < 60 kg) comes with 60.0 kg in all; 456.05 kg burned of 456. A sequential
draw is requested from the fuel system's owner.

Starts (one engine, OAT 15 C): light-off at 13 % N1 (1.7 s), TOT peak 795 C (never above 810), the rotor turning by 25 % N1,
starter off at 58 % N1 (28.8 s), idle 64.2 % N1. T14: engine 2's start with engine 1 at IDLE dips NR 0.75 % (49.1 % NR on one
engine), engages at 16.0 s, no N1-split light 10 s later. T15: both levers IDLE -> FLIGHT over 5 s: NR 58.9 -> 98 % in 4.4 s,
peak 101.3 %, split 2.9 %, TOT max 609 C. T16: one lever at IDLE in flight: that engine 0.0002 %, needles split, the other
80.4 % (82.2 % before), NR 99.4 %. Snap deceleration: N1 77.4 -> 65 % in 2.34 s, never below 64.4 % (P5: >= 2 s, >= 59 %).
OEI: T7a NR min 97.5 %, survivor 88.1 % settled, 93.8 % peak, N1 101.9 %, nose LEFT 6.7 deg/s; T7b survivor at 104.8 % N1,
103.7 % torque, 810 C, NR 96.8 -> 95.9 % over 25 s (band 93-96: **0.5 % above for the first 15 s, so the RPM light stays
out**, known gap), collective down at 2 %/s restores 97 %; level flight on one engine at 2200 kg: 82.2 / 84.1 / 89.2 %
at 60 / 70 / 80 KIAS. Double engine failure at 120 KIAS: NR 95 % at 0.22 s, 85 % at 0.73 s, nose LEFT.

## 7. Mast-moment indicator (hub.ts BO105_MAST_MOMENT)

The FM gives colour bands only. The marks are AGENT/ESTIMATE, set from the plan's rows as measured on this definition
(`bo105Handling.test.ts`): a standard-technique landing at 2200 kg mid-CG (sink at 0.3 m/s holding attitude; at first
contact the collective down at 0.12 of its travel per second, the lateral cyclic keeping the disc level, to its stop if
need be) peaks at **14.4 kN m on a 15 deg left-down slope and 14.3 on an 8 deg right-down slope** (both with the lateral
cyclic at its stop), and **16.7 kN m on 20 deg left-down** (and the aircraft then slides). In flight: a full lateral stick
reversal at 80 KIAS 13.3 kN m, a smooth 2.5 g pull at 100 KIAS 3.1 kN m, a steady 60 deg turn at 100 KIAS (2.15 g, level
within 30 ft/min) 1.8 kN m; level flight 1.4 (hover) / 1.6 (100 KIAS) / 4.8 kN m (145 KIAS). Hence **LIMIT 15.5 kN m** (the
15 and 8 deg landings below it, the 20 deg above) and **yellow from 0.17 of it, 2.6 kN m** (the pull in yellow, the turn
green; the slope landings in the top third of yellow, above 11.2 kN m); before: a 24 kN m / 0.5 placeholder. The plan's
"LIMIT at about 16-17 deg of TPP-to-shaft tilt" (about 40 kN m) assumed the disc held level on a 15 deg slope; the fitted
lateral travel caps the TPP tilt near 4 deg, so the slope peaks are set by the stop. PN's panel reads these two numbers.

## 8. Performance calibrations

| Knob | Before | After | Rows |
|---|---|---|---|
| `main.inducedFactor` (hover torque) | 1.15: 2500 kg OGE 85.1 %, IGE 74.0 %; 2200 kg OGE 72.5, IGE 63.4 %; HOGE about 1,700 ft | **1.11**: 82.7 / 72.0 / 70.6 / 61.8 %; HOGE 3,130 ft, HIGE 6,235 ft | torque rows, ceilings |
| `main.minPitch` (autorotation NR law) | 1.0 deg: 110.9 % (2200 kg), 88.0 (1400), 118.4 (2500) | **1.35 deg**: 107.5 / 85.4 / 114.7 %; 85.4 % at 1400 kg / 60 KIAS (1.4 deg gave 84.97 %) | NR rows, pilot row |
| `dragArea.x` (cruise) | 1.5 m^2: 130 KTAS | unchanged | max cruise |
| `profileCd` | 0.0095 | unchanged | - |

The ceiling is set by the 105 % N1 stop above about 2,500 ft (TOT 790-800 C there), not by the 86 % torque. Vy 59.5 KIAS
from the power curve. The climb rows are the known gap: the power required at the bucket (42 % per engine at 60 KIAS) is
below what the CB-5 chart's AEO climb implies, while the OEI climb, which shares the same bucket, sits inside its band.

## 9. Owner keyboard and the sim profile (input.ts, sim.ts)

Power levers: `engineLever 'overheadPowerLevers'`, the stops OFF < 0.05, IDLE 0.25, FLIGHT 1 (`BO105_POWER_LEVER`, AGENT),
the MD 500E twist-grip labels dropped. Keyboard aileron: the plan's starting values (baseRate 0.03, maxRate 0.22,
accelTime 1.5) gave 5.7 deg of bank 2 s after a 1 s tap at 80 KCAS (0.058 of the axis); the tap row's knob: **0.07 / 0.35
/ 1.5** gives 11.0 deg (0.11 of the axis). Elevator key 0.04, mouse expo 0.9 and dead zone 0.02 (the plan's). Presets:
every running state with both levers at FLIGHT, fuel pumps on, ignition off; N2 held at 100 % by the reset (the
pre-take-off "trim to 98 %" is the pilot's beep).

## 10. In the sim

`index.html?aircraft=bo105&hover=1&ap=1` (the app's hover test, 2500 kg, 16 m, 8 kt of wind, hold engaged), after 20 s:
NR 424.7 rpm (100.0 %), N1 99.6 / 99.6 %, N2 100.0 / 100.0 %, torque 80.6 / 80.6 %, TOT 738 C, mast moment 1.7 kN m,
pitch +3.5 deg, roll 3.0 deg left, split synchronised (-1.3 % N1). Without the hold (`hover=1` alone) the hover diverges
after about 8 s and the rotor strikes the ground near 20 s (the unstable hover oscillation, section 5's hover model: 0.53
rad/s, doubling in 2.3 s). heliHold probe (`AC=bo105`, 32 flights): no disconnect; hover position RMS 0.07 m calm, 2.3-2.5
m in 8 kt gusts; the sequence's 40 kt step overshoots by 12 kt (the hold's tuning, TW's).

## 11. Known gaps (it.fails rows; `src/aircraft/bo105/KNOWN_ISSUES.md` has the list)

Zw (rotor/inflow, structural); Lq/|Lp| 0.19; hover Lp -12.1; pedal-step sideslip 4 deg; 120 KIAS stick 0.44 of travel;
rearward margin 5.2 %; AEO climb +34 %; autorotation collective 0.08 of travel; descent weight effect +0.5 %; T7b NR 96 %
with the light out; OEI IGE cushion torque 114 %.
