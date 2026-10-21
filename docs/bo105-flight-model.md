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
| Hover turn, full pedal (IGE) | 90 deg/s at 0.9 s (right), 1.5 s (left); peaks 165 / 129 deg/s (implied steady about 260 deg/s: N_ped 0.049 per %, hover Nr -0.54) | >= 90 deg/s within 3 s (ESTIMATE; FM limit 90 deg/s; no hover source, the peaks are not bounded) |
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

**Rows at their band edges** (little or no slack; KNOWN_ISSUES 19): 80 kt Lp -10.67 (edge -11.41), roll mode 10.85 1/s
(edge 11.04), Mw +0.040 (edge +0.037); hover roll 2.97 deg left (1-3); 145 KIAS pitch -8.8 deg (-6..-9); hover torque
2500 kg OGE 82.7 % (79-83), 2500 kg IGE 72.0 % (72-78), 2200 kg IGE 61.8 % (61-69). The inertia 850 kg m^2 and the
stabiliser slope 3.0 reach these at a cost: hub stiffness 134 kN m/rad against DLR's 183.7 (-27 %), an 80 kt phugoid
doubling in 8.7 s against DLR's 14 s, and a HIGE - HOGE gap of 3,100 ft against the CB-5 chart's 2,350.

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

**Inertia and the autorotation entry (pilot review, 2026-10-21; `W/probes/pilot-bo/tune-inertia`).** The reviewer found
the entry harsh (both levers OFF at 100 KIAS, 2200 kg: NR 84.4 % with the collective lowered at once over 1 s, 73.1 % with
a 1 s delay) and proposed 925-950 kg m^2 after Padfield's I_beta 231 kg m^2 (the reviewer's own unverified recollection;
plan section 0 item 3 keeps the Padfield set out of the inputs). The sweep, at 80 KCAS / 3000 ft and the entry at 100
KIAS:

| polar inertia kg m^2 | Lp 1/s (edge -11.41) | roll mode 1/s (edge 11.04) | M_lon per % (0.093 +/-5 %) | NR min, lowered at once / 0.5 s / 1 s delay | 120 KIAS 1 s | double failure 95 / 85 % |
|---|---|---|---|---|---|---|
| **850** (as built) | -10.67 | 10.85 | 0.0933 | 84.4 / 78.1 / 73.1 % | 74.6 % | 0.22 / 0.73 s |
| 925 | -12.04 | 12.06 | 0.0990 | 85.4 / 79.5 / 74.7 % | 76.2 % | 0.24 / 0.79 s |
| 950 | -12.50 | 12.45 | 0.1008 | 85.7 / 80.0 / 75.2 % | 76.7 % | 0.25 / 0.81 s |
| 1000 | -13.42 | 13.20 | 0.1044 | 86.2 / 80.8 / 76.1 % | 77.6 % | 0.26 / 0.86 s |

Kept at 850: each step up buys 1-3 % of NR at the entry minimum and puts two P rows (Lp, roll mode) and the M_lon fit
outside their bands, while the sourced Lock number (F METU Table 9, 5.54: about 840 kg m^2 at a = 6.0) supports 850. The
rest is technique (lower the collective within about 0.5 s); KNOWN_ISSUES 22.

**Control phase** (sole knob of the off-axis control ratios): RC's least-squares method (settled off-axis moment ratios
of +/-0.02 cyclic steps against the means of the DLR and AFDD control derivatives, -0.084 and +0.145, 1 deg grid) on
this airframe: best **28 deg** (RC's fixture: 30). Before/after: lateral-step M/L -0.106 -> -0.065, longitudinal-step
L/M +0.203 -> +0.172 (bands 0.25 / 0.3). Lq and Mp are identical with the phase and without it (1e-6).

**Parked blades** (coning.ts): the solver's uniform blade (20.7 kg of the 850 kg m^2 polar inertia; M_beta 50.0 kg m,
I_beta 146 kg m^2 about the hinge), the derived spring (8,685 N m/rad), a droop stop -1.5 deg (ESTIMATE) and a bending
rigidity 1.1e4 N m^2 (3V: parked tip about 0.25 m below the hub plane in the photos; D rest angle 0.74 deg below the
hinge plane, 0.06 m at the tip, plus 0.19 m of sag; non-rotating first flap about 1.35 Hz). The exterior draws the blades from this definition (BX imports `BO105_BLADE_CONING`).

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

**Mass.** Empty 1276 kg (S Jane's; 136 kg above the TCDS minimum of 1140 kg, so that envelope point is never flown, the
lightest rig case being 1400 kg); seats and cargo 3V (pilot RIGHT front, P TCDS p11); tanks under the floor; the AR-280
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

Quick stops (pilot review, 2026-10-21; 2200 kg mid-CG, height held within 11 ft): from 80 KIAS with a 20 deg flare 22.8 %
of the travel is left to the aft stop (stick +0.544 of the -1..1 axis; mast moment 2.1 kN m, NR 101.0 %); from 100 KIAS with
25 deg 13.7 % (NR 106.5 % with the collective dumped); a 30 deg flare from 80 KIAS meets the stop near zero ground speed.
Hover IGE trims sit 0.757 (2200 kg) / 0.773 (2500 kg) of the travel from the forward stop. A stiffer hub does not buy aft
room: at 925 kg m^2 (a 9 % stiffer equivalent hinge) the 145 KIAS aft-CG trim needs 9.27 deg instead of 9.41, but M_lon
per % rises 6 %, so the M_lon fit would shorten the travel to about 12.7 deg (section 2). Where the stops sit and the
blade cyclic per % of travel stay unsourced; nothing was changed.

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
13.7 rad/s +/-30 %, 0.3-0.7).

**Hover (IGE 3 ft, SL, 2200 kg) against the flight-identified hover** (P: Kaletka & Gimonet, ERF 1995 VII-7, Table 1, the
DLR and CERT 6 DOF columns; the AR-280 envelope rule; `tests/rotorcraft/ar280.ts` ERF1995_HOVER; re-sourced at the
flyability pass, 2026-10-22, from the plan's ESTIMATE bands):

| | Lp | Lq | Mq | Mu | Mp | Mw | Nv | Nr | Zw | L_lat | M_lon | N_ped | Z_col |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ERF 1995 DLR / CERT | -8.54 / -10.89 | +2.42 / +2.38 | -2.32 / -1.79 | +0.043 / +0.058 | -1.105 / -1.9 | +0.051 / +0.059 | +0.096 / +0.066 | -0.974 / -1.10 | -0.295 / -0.251 | 0.171 / 0.196 | 0.0719 / 0.0724 | 0.0477 / 0.0474 | -0.238 / -0.23 |
| band (x0.7 / x1.3) | -14.16..-5.98 | 1.67..3.15 | -3.02..-1.25 | 0.030..0.076 | -2.47..-0.774 | 0.036..0.077 | 0.046..0.125 | -1.43..-0.68 | -0.38..-0.18 | 0.120..0.255 | 0.050..0.094 | 0.033..0.062 | -0.31..-0.16 |
| sim | -12.09 | +2.86 | **-3.27** | **+0.088** | **-0.762** | **-0.005** | **+0.0003** | see section 9 | -0.275 | 0.189 | 0.0815 | 0.042 | -0.287 |

Units 1/s, 1/(s m), rad/s^2 (m/s^2 for Z_col) per % of full travel. Bold: KNOWN HOVER MISS rows (`it.fails`). The old
ESTIMATE rows (Lp -6..-10, L_lat 0.13-0.24, M_lon 0.065-0.12) were replaced by these: Lp passes the sourced band (it was
the KNOWN HOVER-DAMPING GAP), which is a re-sourcing, not a loosening. Mq, Mu, Lp and Lv (-0.35; Heffley's analytical
BO-105C -0.21, S) are in excess: the harmonic inflow's moment feedback (L22 / L33) is a damper that raises Lp / Mq and
supplies the identified rate cross-coupling (Lq / Mp: -0.13 / +0.03 with the inflow off), and the L31 wake-skew
gradient's flap response on the stiff hub gives Lu +0.35 and Mv +0.09 1/(s m) and doubles Mu. Plan section 4's "the hover
inflow gradient cuts roll damping" was the control response (hub moment per cyclic -7..-13 %), not the rate damping.
No Bo 105 knob moves them (inertia, nu, control phase are pinned at 80 kt); the L31 gradient x 0.5 (Mu 0.065, doubling
3.6 s) is recorded as a note for RC, not done.

**The hover modes.** The real Bo 105 hover is "highly unstable" (ERF 1995: 45 deg of roll about 14 s after a lateral
identification input, the yaw rate above 20 deg/s, "all hover flight tests were flown with additional stabilizing pilot
inputs"); its Figure 13 (6 DOF, DLR and CERT) puts the hover phugoid in the right half-plane at about sigma +0.20..+0.25,
omega_d 0.50..0.55 rad/s (doubling 2.8-3.5 s, period 11-13 s; the markers span sigma +0.1..+0.4, omega_d 0.4..0.7, read off a
small printed plot). The sim's 8-state model of its hover derivatives: an unstable pair zeta -0.52 at 0.60 rad/s, **sigma
+0.308, omega_d 0.51 (doubling 2.3 s, period 12.3 s)**, and a stable one zeta 0.47 at 0.64 rad/s; roll subsidence 12.0
1/s, pitch 3.55 1/s, subsidences 0.23 and 0.48 1/s. Inside the identified band on its fast side (the hover-modes row
asserts sigma +0.05..+0.45 and omega_d 0.3..0.8: the read band widened by a marker width). ADS-33E-PRF Fig 7 (P) puts both
at Level 3 (sigma > 0.139 rad/s, doubling under 5 s); ADS-33E 3.3.2.3 makes an attitude-hold response type the
compliance route, which is what the flyability aids are (section 9). Mechanism: Lu +0.35 and Mv +0.09 split the two
coincident 0.51 rad/s pendulum modes. With the harmonic inflow OFF: zeta -0.095 at 0.43 rad/s (doubling 17 s; Mu +0.046,
Lv -0.187, Lp -8.8, Mq -2.39); Heffley's analytical BO-105C (NASA CR-3144, S) doubles in 31 s: both are what the flight
test contradicts. At the hover scenario's 2500 kg / 16 m: zeta -0.49 at 0.62 rad/s (doubling 2.3 s, period 11.6 s; inflow
off -0.096 at 0.47). The hover roll / flap mode (matrix pencil): -4.4 +/- 10.2j against the identified 9 DOF about
-6 +/- 10j (DLR) / -7 +/- 9j (CERT). Trace keys `hoverModes`, `hoverPhugoid`, `hoverErf1995`.

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
peak 101.3 %, split 2.9 %, TOT max 609 C (plan 10-20 s: below it, KNOWN T15 TIME GAP; the row asserts <= 15 s as TW's
twinOei T15 does). T16: one lever at IDLE in flight: that engine 0.0002 %, needles split, the other
80.4 % (82.2 % before), NR 99.4 %. Snap deceleration: N1 77.4 -> 65 % in 2.34 s, never below 64.4 % (P5: >= 2 s, >= 59 %).
OEI: T7a NR min 97.5 %, survivor 88.1 % settled, 93.8 % peak, N1 101.9 %, nose LEFT 6.7 deg/s; T7b survivor at 104.8 % N1,
103.7 % torque, 810 C, NR 96.8 % at 1 s, 96.14 % at 5 s, 96.0 % at 16 s, 95.87 % at 24 s (band 93-96 from 5 s: **up to
0.14 % above until 16 s, and never down to 95 %, so the RPM light stays out**, known gap; TW's twinOei T7b, in this
package's guard list, fails on the same 0.12 %: KNOWN_ISSUES 7), collective down at 2 %/s restores 97 %; level flight on one engine at 2200 kg: 82.2 / 84.1 / 89.2 %
at 60 / 70 / 80 KIAS. Double engine failure at 120 KIAS: NR 95 % at 0.22 s, 85 % at 0.73 s, nose LEFT.

## 7. Mast-moment indicator (hub.ts BO105_MAST_MOMENT)

The FM gives colour bands only. The marks are AGENT/ESTIMATE, set from the plan's rows as measured on this definition
(`bo105Handling.test.ts`): a standard-technique landing at 2200 kg mid-CG (sink at 0.3 m/s holding attitude; at first
contact the collective down at 0.12 of its travel per second, the lateral cyclic keeping the disc level, to its stop if
need be) peaks at **14.4 kN m on a 15 deg left-down slope and 14.3 on an 8 deg right-down slope** (both with the lateral
cyclic at its stop), and **16.7 kN m on 20 deg left-down** (and the aircraft then slides). In flight: a full lateral stick
reversal at 80 KIAS 13.3 kN m, a smooth 2.5 g pull at 100 KIAS 3.1 kN m, a steady 60 deg turn at 100 KIAS (2.15 g, level
within 30 ft/min) 1.8 kN m. Hence **LIMIT 15.5 kN m** (the 15 and 8 deg landings below it, the 20 deg above). The plan's
"LIMIT at about 16-17 deg of TPP-to-shaft tilt" (about 40 kN m) assumed the disc held level on a 15 deg slope; the fitted
lateral travel caps the TPP tilt near 4 deg, so the slope peaks are set by the stop. In flap terms (D): (B/2)(e M_beta
Omega^2 + K_beta) = 2 x (0.590 x 50.03 x 1976 + 8,685) = 134 kN m/rad = 2.34 kN m/deg, so LIMIT is **6.6 deg** of
equivalent TPP-to-shaft flap, against the plan's 16-17 deg. The lever is the "% = % of full travel" assumption (section
4): twice the lateral travel would roughly double the slope peaks and the LIMIT. PN's panel reads these two numbers.

**Yellow onset (pilot review, 2026-10-21): 0.17 -> 0.5 of LIMIT (2.6 -> 7.75 kN m, 1.1 -> 3.3 deg of equivalent flap).**
The needle reads the hub moment, which follows the TPP-to-shaft tilt (the CG offset, the fuselage's pitching moment at
speed), not g. With yellow at 2.6 kN m the needle sat in yellow in ordinary cruise (mid CG from about 119 KIAS, aft CG
from 60 KIAS) while the 2.5 g pull, which had set it, read less than 130 KIAS level flight. Steady readings (kN m, SL ISA,
trimmed level flight; `W/probes/pilot-bo/tune-mast`):

| kg / CG | hover IGE | 60 | 100 | 110 | 120 | 130 | 140 | 145 KIAS |
|---|---|---|---|---|---|---|---|---|
| 2200 forward (STA 3.06) | 2.88 | 2.49 | 1.57 | 1.35 | 1.35 | 1.73 | 2.42 | 2.86 |
| 2200 mid (3.20) | 1.20 | 0.80 | 1.59 | 2.07 | 2.68 | 3.42 | 4.29 | 4.78 |
| 2200 aft (3.35) | 2.56 | 2.65 | 3.72 | 4.22 | 4.84 | 5.58 | 6.45 | 6.92 |
| 2400 aft (3.29) | 1.98 | - | 2.93 | - | 3.98 | 4.68 | 5.49 | 5.95 |
| 2500 forward / mid / aft | 2.86 / 1.55 / 1.73 | - | 1.64 / 1.24 / 2.52 | - | 1.42 / 2.09 / 3.53 | 1.70 / 2.73 / 4.21 | - | - |
| 1400 (pilot only, STA 3.29) | 1.37 | - | 2.73 | - | - | 5.08 | - | 6.72 |

Level flight above about 130 KTAS needs more than the AEO 86 % (the trims at 140-145 KIAS read the 95 % N1-stop torque):
in service those speeds are flown descending, at about the same hub moment. The highest steady reading in the legal
envelope is 6.9 kN m (145 KIAS, 2200 kg, aft CG), so the plan's 0.5 (6.2 "about 0.5"; section 0 item 5 "yellow from
about 8-9 deg with LIMIT at 16-17") keeps every steady trim green with 0.8 kN m to spare; the reviewer's 0.30-0.35 would
have left aft-CG cruise at 130 KIAS (5.58) in yellow. Manoeuvres then read: lateral steps of 10 / 20 / 50 % of travel at
80 KIAS 1.2-2.1 / 1.8-3.2 / 5.2-6.1 kN m (green), quick stops 2.0-2.9 (green), the 2.5 g pull 3.1 (green), a full
lateral reversal at 80 KIAS 13.3 (yellow), the slope landings 14.3 / 14.4 (top third of yellow, above 12.9), 20 deg
left-down 16.7 (LIMIT). The plan's ESTIMATE row "a 2.5 g pull at 100 KIAS reaches yellow" is restated as "stays green"
(AGENT) and a steady-trim row was added (`bo105Handling` mast-moment rows: 2200 kg forward / mid / aft at 130 and 145
KIAS, 2400 kg aft at 145, 2500 kg aft at 130, forward-CG hovers at 2200 and 2500 kg, all below yellow). On the panel
PN's dial paints its arcs at its 0.5 display fallback and marked the old 0.17 onset with a lone yellow tick inside the
green arc; with 0.5 the painted arcs are the hub's (green 0-50 % of LIMIT, yellow 50-100 %, red above).

## 8. Performance calibrations

| Knob | Before | After | Rows |
|---|---|---|---|
| `main.inducedFactor` (hover torque) | 1.15: 2500 kg OGE 85.1 %, IGE 74.0 %; 2200 kg OGE 72.5, IGE 63.4 %; HOGE about 1,700 ft | **1.11**: 82.7 / 72.0 / 70.6 / 61.8 %; HOGE 3,130 ft, HIGE 6,235 ft | torque rows, ceilings |
| `main.minPitch` (autorotation NR law) | 1.0 deg: 110.9 % (2200 kg), 88.0 (1400), 118.4 (2500) | **1.35 deg**: 107.5 / 85.4 / 114.7 %; 85.4 % at 1400 kg / 60 KIAS (1.4 deg gave 84.97 %) | NR rows, pilot row |
| `dragArea.x` (cruise) | 1.5 m^2: 130 KTAS | unchanged | max cruise |
| `profileCd` | 0.0095 | unchanged | - |

The ceiling is set by the 105 % N1 stop above about 2,500 ft (TOT 790-800 C there), not by the 86 % torque. Vy 59.5 KIAS
from the power curve.

**The AEO climb gap, re-examined at the pilot review (2026-10-21; `W/probes/pilot-bo/tune-climb`).** At 2 x 86 %, 60
KIAS, SL: 2,107 ft/min at 2200 kg, 1,637 at 2500 kg (plan 1,575 +/-20 %, S; 1,150-1,400, ESTIMATE with the CB-5 chart's
1,380 as the upper bound). The reviewer's reading, "the power required in the bucket is too low", does not hold against
the one Bo 105 power-required curve in the sources (S: Kerler et al., ERF 2012, Fig 1 after Kessler's TUM lecture; read
as shaft power, digitised from the PDF):

| 2300 kg, SL | hover OGE | 60 KIAS | 80 | 100 | 120 | 130 KTAS |
|---|---|---|---|---|---|---|
| Kessler (S), kW | 426 | 232 | 266 | 344 | 449 | 508 |
| this model, both engines, kW | 444 | 256 | 275 | 333 | 433 | 500 |

The model's bucket sits 10 % above the source; elsewhere it is within 4 %. What differs is how much of the excess power
becomes climb: the model gives 45 ft/min per % torque per engine at 2200 kg (7.6 ft/min per kW of shaft power, 83 % of
the ideal W x dh/dt = P; the tail rotor and the transmission take most of the rest). The CB-5 chart (F: 1,900 ft/min at
2200 kg, 1,380 at 2500 kg, read +/-150) and Jane's (S: 1,575 ft/min; the Bo 105 CB data block that quotes it gives the
maximum mass as 2,500 kg; Jane's entries usually give performance at maximum mass, not verified for this figure), set
over the source's power curve, imply 60-72 %. Two consequences:
- at 2200 kg the plan's two climb rows cannot both pass by moving the power required: the AEO band's top (1,890 ft/min)
  needs +4.8 % torque per engine at the bucket, the OEI band's floor (+300 ft/min; +315 now) allows +0.3 %, because the
  same bucket shift moves both climbs by the same 45 ft/min per %;
- the listed knobs cannot close it either (2500 kg OGE torque held at 82.7 % by refitting `inducedFactor`):

| Set | bucket % / engine | AEO 2200 / 2500 ft/min | OEI 2200 / 2500 | max cruise KTAS | NR down, 75 KIAS, 2200 / 2500 kg | descent 60 KIAS, 100 % NR |
|---|---|---|---|---|---|---|
| profileCd 0.0095, inducedFactor 1.11 (as built) | 41.1 | 2,107 / 1,637 | +315 / +31 | 129.9 | 107.5 / 114.7 % | 2,039 ft/min |
| profileCd 0.011, inducedFactor 1.067 | 42.9 | 2,022 / 1,569 | **+225** / -41 | 127.8 | 104.8 / 111.8 % | 2,132 |
| profileCd 0.012, inducedFactor 1.039 | 44.1 | 1,965 / 1,524 | **+165** / -89 | 126.4 | **103.2** / 110.1 % | 2,194 |
| dragArea.z x 1.5 (the download) | 41.1 | (hover +1.7 %, bucket unchanged) | | | | |

So `profileCd` stays 0.0095. Closing the gap needs either restated bands (the architect: Jane's 1,575 ft/min plausibly
belongs to 2,500 kg, where the model is +4 % from it; the CB-5 chart is an upper bound for the CB-4) or a climb-efficiency
mechanism in the rotor core (RC: the share of excess shaft power that becomes climb at 60 KIAS, 83 % here against 60-72 %
implied by the sources). Recorded as KNOWN_ISSUES 2; the `it.fails` CLIMB GAP row stays.

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
pitch +3.5 deg, roll 3.0 deg left, split synchronised (-1.3 % N1) (W/shots/BO/bo105-hover-ap.png). **The plan section 10
gate shot** (`hover=1` without the hold, hands off) after 20 s: roll 53.5 deg, crashed (main rotor strike), NR 424.7 rpm,
N1 101.2 / 101.2 %, torque 84.2 / 84.2 % (W/shots/BO/bo105-hover.png): the hover diverges after about 8 s (section 5's
hover model: zeta -0.49 at 0.62 rad/s at 2500 kg / 16 m, doubling in 2.3 s; inflow off 15 s). The MD 500E on the same
URL is upright after 20 s (roll -5.8 deg, 2.7 m/s drift). That divergence is the real Bo 105's (section 5: ERF 1995,
P); the physics stays, and the aids for flying it are the hold (`&ap=1`) and the STAB ASSIST (section 9). heliHold probe (`AC=bo105`, 32 flights): no disconnect; hover position RMS 0.07 m calm, 2.3-2.5
m in 8 kt gusts; the sequence's 40 kt step overshoots by 12 kt (the hold's tuning, TW's).

## 11. Known gaps (it.fails rows; `src/aircraft/bo105/KNOWN_ISSUES.md` has the list)

Zw (rotor/inflow, structural); Lq/|Lp| 0.19; hover Mq -3.27, Mu +0.088, Mp -0.762 (edge), Mw -0.005, Nv 0.0003 against
ERF 1995 (section 5; the hover Lp row now passes its sourced band); pedal-step sideslip 4 deg; 120 KIAS stick 0.44 of travel;
rearward margin 5.2 %; AEO climb +34 % at 2200 kg (+11 / +19 % on the CB-5 chart; section 8); autorotation collective 0.08 of travel; descent weight effect +0.5 %; T7b NR 96.1 %
with the light out; T15 98 % NR in 4.35 s (plan 10-20 s); OEI IGE cushion torque 114 %. Guards red at BO HEAD and not
fixable in BO's files: GA consistency bo105 row (BX/PN stubs; resolved by merging BX and PN with or before BO) and TW's
twinOei T7b (KNOWN_ISSUES "Integration").
