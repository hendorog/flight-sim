# Lockheed AH-56A Cheyenne: the compound (stages 3–4)

Package AC, plan revision 2 section 7.3. The wing and the Hamilton Standard pusher on the rotor's shared shaft, added to AG's stage-2
helicopter through the frozen assembly (`src/aircraft/ah56/rotorcraft.ts`): `compound.ts` is applied last. The stage-5 high-advance-ratio
aerodynamics and the half-P hop (AH, `highSpeed.ts`) follow.

Files:
- `src/physics/rotorcraft/wings.ts`: `WingPanelDef`, `wingLoads`, `panelCoefficients`.
- `src/physics/rotorcraft/pusher.ts`: `PusherDef`, `PusherDrive`, `pusherTrimLever`, `pusherLeverBeta` / `pusherBetaLever`.
- `src/aircraft/ah56/compound.ts`: the data (wing panels, stores, tail downwash, the prop and its grip, the trim schedules, the governor's
  prop anticipation, the fuselage flat plate, the AMCS refit, the provisional rotor section).
- Tests:
  - `tests/rotorcraft/ah56Pusher.test.ts`;
  - `ah56Compound.test.ts`;
  - `ah56CompoundPerformance.test.ts`.

  `AH56_TRACE=<dir>` writes the reports. `[ah56]` lines in the logs give every measured number next to its target.

Tags: P primary (ASTA-72 = USAASTA 72-08, the 1972 ICS aircraft; AMCS-73 = USAASTA 72-44, the 1973 AMCS ship 7; pages in
`docs/ah56-sources.md`), D derived (arithmetic shown), 3V photos, ESTIMATE judged, FITTED (an ESTIMATE set to a named row). None of the
choices below is an owner decision; the AGENT choices are marked.

## 1. The wing (`wings.ts`; data in `compound.ts`)

| Item | Value | Tag |
|---|---|---|
| Panels | two, one per side, each with its own local flow (the body's air velocity, the rotation at its arm, the rotor's wash) | plan 7.3 |
| Area, span | 195 ft² (9.06 m² per panel), 26.7 ft including the carry-through from BL 0 | P ASTA-72 p 53 |
| Aspect ratio, lift slope | 3.66; 3.73 /rad by Helmbold, 2πA / (2 + √(A² + 4)) (the XH-51A's measured wing-body slope was 3.47) | P / D |
| Quarter-MAC | FS 308.2 (P); BL 71.2: the MAC station of a 0.5 taper, (b/2)(1 + 2λ)/(3(1 + λ)) (D); WL 70.2: the dihedral line through the exterior's quarter-chord WL 67 at BL 35 (3V) | P / D / 3V |
| Dihedral | 5° | P |
| Incidence | root L 11°52′, R 12°58′ (P), to the water line (datum unstated, plan 7.3), plus the area-mean washout of the −3°06′ L / −3°02′ R twist on a 0.5 taper: (1/3)/(3/4) = 0.444 of the tip twist (D). Mean chord: L 10.49°, R 11.62° | P / D |
| Section | zero-lift −2° (the trailing-edge extension that "defies aerodynamic description", P; the value ESTIMATE, set by C8); attached maximum 1.2, Cd0 0.009, Oswald 0.85 (ESTIMATES); a finite flat plate (C_N 1.2, Hoerner, AR ≈ 4) through a 0.35 rad stall fade | ESTIMATE |
| Rotor wash on the panels | `washBySkew` × the rotor's mean momentum inflow: 1.29 in the hover, the actuator disc's wake 2.40 m below the disc, 1 + z/√(z² + R²) (D); 1.15 at 60° of skew; 1.0 at 90° (the disc's own induced field, about 1.1 m/s ≈ 0.8° of downwash at 150 KTAS with half the lift on the rotor, plan 7.3) | D / ESTIMATE |
| Stores | four XM159 pods on the BL 70 / 117 pylons: ΔFe 2 ft² at 110 KTAS rising to 6 ft² at 200 KTAS (P ASTA-72 Fig B), half per panel, on the forward flow at BL 93.5, FS 310, WL 52 (3V) | P / 3V |
| Downwash at the stabiliser | the stabiliser (FS 637, P) sits about one span behind the wing and 44 in above it: ε = 0.8 × 2 C_L/(πA) = 0.139 C_L rad, applied as the stabiliser lift it removes, faded in by about 30 kt (`tail`, ESTIMATE). airframe.ts washes the stabiliser with the rotor only; without this term the ICS trims at 170–190 KCAS needed full aft stick | ESTIMATE |

The wing's local flow gives these derivatives without fitting (150 KTAS, `ah56Compound.test.ts`):
- the dihedral effect: −3.3 kN m of roll for 5° of sideslip from the right;
- roll damping: −9.9 kN m per rad/s;
- a right yaw rate rolls the aircraft right (+0.47 kN m at 0.1 rad/s).

The hover wake (13.2 m/s at the panels) loads them down by 3.7 kN and forward by 0.72 kN: the leading-edge-up panel (10.5° / 11.6°)
carries its broadside force along its normal, whatever the sign of a small airspeed. The angle is the full-range `atan2(normal, flow.x)`
and the lift direction (normal, −flow.x)/speed, so a reversed flow lands on the flat plate with the incidence's own sign.

*Fixed in the assessment round (AC finding 1).* The first version took `|flow.x|` in the angle and `sign(flow.x)` in the lift's x
component (the fin's resolution). The download's x force then flipped with the airspeed: +720 N at +0.05 m/s, 0 at 0, −720 N at
−0.05 m/s. That is a negative speed damping of about 1.7 % of the weight in the hover and a 0.9 kN m pitching-moment step across zero
airspeed. In rearward flight (−10 kt, 12 m/s wake) it gave 0.54 kN aft where the plate gives 0.67 kN forward. Forward flight
(flow.x > 0) is unchanged to the last bit. What it changed is in section 6 ("was" columns) and section 7.

## 2. The pusher (`pusher.ts`; data in `compound.ts`)

**The prop** (P ASTA-72 pp 51–52, AMCS-73 pp 23–24): Hamilton Standard 1311 GB 30/11FA 10A4-0, 3 blades, 10 ft, AF 142 per blade
(the tabulated chord gives 142.0 through the BEMT's elements), integrated design lift coefficient 0.411, blade angles at the 42 in station
(0.7 R), CCW from behind, 1717 / 246 = 6.980 × the rotor (D), 13.98 slug-ft² = 18.95 kg m² (P). The drivetrain referred to the rotor is
14,573 kg m² with it (P 14,564: 0.06 %).

It runs through the existing propeller maps (`Propeller`, one BEMT slice per 3° from −12° to +40.8°, tabulated when the drive is built).
The prop's own numbers:
- **Section**:
  - zero-lift angle −2.2° to the quoted blade angle, FITTED so the static thrust is zero at the −2.2° hover detent (P: "minimum
    power, level attitude"). −c_li/2π = −3.75° to the chord of an a = 1.0 mean line put the zero at −3.8°, and which line the angle is
    quoted to is not stated.
  - maximum lift 1.45, losing 0.4 per unit Mach above 0.3. ESTIMATE for thin (4–7 %) high-speed sections, FITTED so the blade does not
    stall short of the 40.8° stop at V_H. The McCauley Clark-Y's 1.45 and 1.6/Mach stalled this blade at 10 kN at 190 KTAS.
  - helix twist P/D 1.3 and the thickness: ESTIMATES. P/D 1.0–2.1 and 3–4 % tips change the efficiency by under 0.03.
- **Efficiency at the V_H loading** (J 1.15, C_P 0.34 at 190 KTAS and 1674 rpm): 0.753, 18.3 kN for 3,191 shp; 0.67 at the stop.
  About 0.80 is expected for a 3-blade AF-140 prop there (ESTIMATE, general Hamilton Standard chart knowledge: not in the research).
  The drag fit absorbs the difference (section 4, where the refit attempt is).
- **Static**:

  | Blade angle | −6° | −2.2° | +4° | +10° |
  |---|---|---|---|---|
  | Thrust, kN | −2.9 | −0.07 | +3.9 | +9.0 |

  At the detent the prop absorbs 252 shp.
- **C14**: above +28° the power per degree is 6–16 times that at +10° at the same speed (80 / 100 KTAS: 160 / 204 shp/° against
  25 / 12).
- **C15**: at the trimmed angle the thrust falls 143–164 N per knot of speed (120–190 KTAS): speed stable.

**The grip** (`beta.lever` / `angle`): ≈130° of grip for −12 … +40.8° (P AMCS-73 p 23), 2:1 grip-degrees per blade-degree from −10° to −5°
and 3:1 from 35° to 40° (P ASTA-72 para 43). The input profile's three snaps (AG's linear `ah56PropLever`) are points of the table, so they
land on −2.2° / +8° / −12° exactly. Between them the gearing is 2.94:1, 2.46:1 and 2.35:1 (D).

**The blade angle's states** (`RotorcraftState.pusher`; they advance on the flight's clock, `BodyState.time > 0`; the trim's settle runs at
time 0 and puts the blades on the grip at once, so the trim never creeps or latches):

| State | Value | Tag |
|---|---|---|
| Slew | 10°/s behind the grip | ESTIMATE |
| Creep (C25) | above 33° with the grip untouched, 0.1°/s: 36° set → 35.0° after 10 s. A touch of the grip re-seats the blades on it (the sim's grip does not move with the blades) | P sense (ASTA-72 para 43) / ESTIMATE rate |
| Delta-beta (C13) | latched when the engine's torque at the rotor falls below half the prop's rotor-referred torque, released when the engine carries the prop again; it cuts a forward angle to +18° and a reverse angle to −8.5° (AMCS; the ICS's −7° is not separated) at 15°/s. The sensor arms only while the prop draws more than 1,600 N m (`armTorque`, about 390 shp at 1717 rpm): a shutdown at the hover detent (1,060–1,068 N m static, on the ground or in the hover) no longer latches it; C13's chop at 25° and 150 KCAS draws 3,420 N m. The P sensor reads main-rotor shaft torque **and load factor** (ASTA-72 paras 66–67); the load-factor channel is not modelled | P (targets, sensor quantities) / ESTIMATE (the torque sensor, the floor, the rate) |

**Loads** (`PusherDrive.compute`):
- thrust and the in-plane force at the hub (FS 675.7, WL 114.5: 0.495 m above the reference point, P / ESTIMATE WL_cg);
- the disc's own moment (P-factor);
- the main rotor's wake at the disc (0.35 of the mean inflow, faded with speed as the tail rotor's; ESTIMATE). It enters as a descending
  flow: the hub's velocity through the air gets −wake in z, as the wing and the tail rotor do. *Sign fixed in the assessment round
  (AC finding 3)*: in the hover the in-plane force is +95 N and the moment +0.94 kN m nose up (it was −80 N and −0.74 kN m);
- **the shaft reaction about the prop's axis**: −Q about the spin vector, +Q about x for CCW from behind, a right roll of 12.5 kN m at
  190 KTAS and 37°;
- **the prop's share taken back out of the mast reaction**. rotorcraft.ts reacts the engine's whole torque about the main-rotor shaft
  (rotation × driveTorque), and in a steady state that includes the prop's 87 kN m (rotor-referred). The moment returned subtracts
  rotation × shaftTorque about the mast, so the steady yaw is the main and tail rotors' alone.

  In an engine failure driveTorque drops to zero while the prop still draws its torque out of the rotor's inertia. The remaining
  −rotation × shaftTorque is the airframe's reaction to the rotor being slowed through the gearbox: the left yaw of ASTA-72 para 68
  (16–20°/s in C20).

The other outputs:
- `shaftTorque` = Q × 6.98 joins `RotorcraftState.torque`, so the drivetrain and the Nf governor carry the prop.
- `h` = −I_p × 6.98 × Ω along x joins the angular momentum.
- `power` is a diagnostic (`compoundPower.pusher`).

**The trim schedules** (`pusherTrimLever`): the AMCS schedule is FITTED at 18,300 lb, SL, stores on.
- From 80 KTAS: the angle that puts the trimmed collective on 13° indicated (AMCS-73: "13 degrees indicated ... at 80 KCAS and above",
  P).
- The hover: −2.2° (P).
- 20–60 KTAS: about 2° nose up (ASTA-72 para 32, P).
- The angles:

  | KTAS | 0 | 20 | 40 | 60 | 80 | 100 | 120 | 140 | 160 | 180 | 190 | 200 | 210 |
  |---|---|---|---|---|---|---|---|---|---|---|---|---|---|
  | Blade angle, ° | −2.2 | 5 | 7.5 | 13 | 15.0 | 16.9 | 20.1 | 23.9 | 28.2 | 32.9 | 35.5 | 38.3 | 40.8 |

The ICS (246 rpm) needs about 1° less from 80 KTAS for 6° indicated (the middle of its 5–7°, P): `trimScheduleByConfig.ics`. The flight
model does not pass the configuration to `pusherTrimLever` yet (contract request). Until it does, an ICS reset uses the AMCS angles and
trims 0.6–1.2° of collective low: 5.3 / 5.2 / 4.8° indicated at 120 / 140 / 160 KCAS, against 6.0 / 5.95 / 6.0° on its own schedule.

**The Nf governor's anticipation** (`governor.propAnticipation` 0.15, ESTIMATE, FITTED):
- the reset's beep set point stays within 0.42 % from the hover to 190 KTAS on the schedule (0.65 % without);
- the Nr dip after a +0.1 lever step at 150 KTAS falls from 1.38 % to 1.17 %.

## 3. The collective reference (AGENT choice, evidence for the owner)

ASTA-72's rotor table (p 48, P) writes "Geometric twist, θ1, from center of rotation to rotor station 302.4: −5 deg" and "Collective pitch
range, θ0: 0°30′ to 18°30′". That is the θ(r) = θ0 + θ1 r/R notation, which would put the quoted collective at the rotor centre, 3.75°
above the model's 0.75 R pitch. Both readings were flown. Measured at 18,300 lb on 13° AMCS indicated:

| | AG's reading (13° ind = 6.0° at 0.75 R) **kept** | centre reading (13° ind = 2.25°) |
|---|---|---|
| Pitch at 80 / 100 / 120 / 160 / 190 KCAS | +0.7 / −0.9 / −1.7 / −2.6 / −2.9° | +8.0 / +4.5 / +2.3 / −0.2 / −1.4° |
| Rotor lift share 120 / 160 / 190 | 71 / 47 / 26 % | 54 / 30 / 11 % |
| Hover collective (AMCS, travel 4.5–21.5° P) | 18.8° indicated | 22.5° (past the stop) |
| Rolling take-off on 13° at 60 KIAS (AMCS-73 para 19) | wheels carry 16 %; airborne on 15° | far short (the rotor needs about 6° at 0.75 R) |
| Fitted fuselage flat plate for V_H | 1.0 m² | 0.8 m² |

AG's reading is kept. AMCS-73's operation is P and in this rotor model fits only it:
- 13° flown from 80 KCAS at ordinary attitudes;
- lift-off on 13°;
- the hover within the travel.

The research's incidence check also predicts about 3° nose down at 190 KTAS with the wing carrying about 80 %; this reading gives −2.9° and
77 %. The cost is C6, the ESTIMATE lift-share band from the XH-51A trend: the rotor carries 10–20 points more than it.

## 4. The drag budget, V_H and the Mach placeholder

- **The fuselage, turrets, hub and gyro flat plate** (`dragArea.x`): FITTED to 1.0 m² (10.8 ft²), against AG's stage-2 2.0. With the stores
  it is 1.53 m² at 194 KTAS, against the plan's ≈ 2.2 m² budget, which assumed a prop efficiency of 0.8.
  - **The prop refit was tried and does not reach 0.80** (AC finding 10; `Propeller.evaluate` at 190 KTAS, 1674 rpm, the blade angle
    for C_P 0.34):

    | Variant | Efficiency | Note |
    |---|---|---|
    | as built (clMinDrag 0.4, dragDueToLift 0.01, cdMax 1.6) | 0.753 | β 37.75°, 18.34 kN |
    | dragDueToLift 0 | 0.758 | the section knobs the finding names move it by under 0.006 |
    | clMinDrag 0.6 / 0.8 | 0.756 / 0.757 | |
    | sections 30 % thinner | 0.759 | |
    | helix twist P/D 1.0 / 1.7 / 2.2 (1.3 built) | 0.742 / 0.760 / 0.761 | P/D above 1.3 moves the detent's static thrust off zero (−0.35 / −0.62 kN) |
    | chord taper ±1 about 0.7 R (AF kept near 142) | 0.747 / 0.754 | |
    | lift slope 2π (0.9 × 2π built) | 0.755 | |
    | no compressibility (sound speed × 100) | 0.784 | the BEMT's induced, swirl and tip losses at this loading; the actuator disc's ideal is 0.91 (D) |

    So the loss sits in the BEMT's induced/swirl/tip-loss terms (`src/physics/propulsion/**`, TW's) and in 0.03 of wave drag at the
    0.84 helical tip Mach number, not in the section polar. The flat plate is **not** re-fitted: it stays fitted to the prop the model
    has. 0.05 of efficiency is about 1.2 kN at 194 KTAS, 0.2 m² of flat plate (D): the airframe would be about 1.2 m² with an
    0.80 prop (1.73 m² with the stores).
  - So "1.0 m²" stands for the drag the model's prop can push, not a physical estimate of the airframe.
- **Power on the AMCS schedule** (13° indicated from 80 KCAS, 18,300 lb, SL ISA, stores; `trims` in `ah56Compound.json`). No mid-speed
  level-flight power data is in the research, so only V_H checks the curve:

  | KTAS | hover (OGE) | 80 | 100 | 120 | 160 | 190 | V_H (stores, 18,750 lb, 114 %) |
  |---|---|---|---|---|---|---|---|
  | Torque, % | 85.9 | 36.4 | 36.1 | 39.6 | 60.8 | 96.5 | 114 at 198.7 KTAS (196.9 with the Mach placeholder) |
  | Prop blade angle, ° | −2.2 | 15.0 | 16.9 | 20.1 | 28.2 | 35.5 | |
  | Rotor's share of the lift | 108 % | 88 % | 80 % | 71 % | 47 % | 26 % | |
- **C4 and C5 together pin it**: V_H (stores) must reach 194 ± 5 %, and the clean AMCS must pass 210 KTAS. The AMCS's prop at 1674 rpm meets
  its 40.8° stop near 212 KTAS, so C5 caps the drag from below.
- **The provisional Mach drag rise** (`PROVISIONAL_SECTION`: the base polar through section.ts with cd += 3 (M − 0.78)²; M_dd 0.78 ESTIMATE
  plan 7.4; the rise ESTIMATE, Korn's 20(M − M_crit)⁴ with M_crit = M_dd − 0.1 at the 194 KTAS advancing tip, M 0.886, D) is **not
  flown**. The S0 section stub also replaces RC's hinge-forcing polar, and with it G3's ICS auto-trim on a fixed shaft goes from 4 % to
  30 % of the locked-gyro gust moment (the locked moment itself 9.9 → 1.9 kN m).
- **C4 is therefore asserted twice**: with the placeholder (the fit, 196.9 KTAS) and as flown (198.7 KTAS). AH's section (stage 5)
  replaces the placeholder: if its Mach drag is like this one, V_H lands near 197; plan 7.3 gives any re-fit to the integrator through
  AH's PR text. **C5 with the placeholder is 211.7 KTAS: 1.7 KTAS of margin** above 210 (212.8 as flown). Not flying the placeholder is
  an AGENT deviation from plan 7.3 (section 9).
- **C4 and C24 are trimmed with the AMCS gyro's mechanics at the ICS's 246 rpm.** AG's ICS gyro trim runs out of forward stick above
  about 170 KCAS at these collectives: also on AG's stage-2 aircraft, 5.37 of 5.5 in at 150 KCAS and saturated at 170. The gyro does not
  enter the trim's power.

## 5. The AMCS refit on the compound (AG: "mandatory")

The wing, the pusher and the unloaded rotor take AG's AMCS pitch response at 150 KCAS from 4.27 to 3.86 °/s/in (band 4.2–7.8). Only AG's two
fitted numbers move, through `compound.ts`'s `controlGyro`: the flapping feedback gain K_R and the full longitudinal stick moment.

**First refit** (stage 4, before the assessment): K_R 7,500 → 5,000 N m/rad, stick moment 811 → 715 N m. The grid (compound, first-peak
rates °/s/in, sensitivity °/s²/in), measured with the wing's hover x-force sign defect still in:

| K_R / stick moment | hover | 100 | 150 | 180 KCAS | sensitivity hover / 100 |
|---|---|---|---|---|---|
| 7,500 / 811 (AG) | 5.93 | 4.56 | 3.86 | 3.39 | 11.3 / 10.5 |
| 6,000 / 811 | 6.47 | 4.98 | 4.35 | 3.88 | 12.4 / 11.2 |
| 5,000 / 811 | 6.91 | 5.42 | 4.79 | 4.30 | 13.2 / 11.9 |
| 5,000 / 715 | 6.09 | 4.90 | 4.26 | 3.80 | 11.6 / 10.8 |

**Second refit** (assessment round). The wing and pusher sign fixes (sections 1–2) changed the hover only: at 5,000 / 715 the hover rate
went 6.09 → 6.22 and the hover sensitivity 11.6 → **12.0, outside G5's 6.3–11.7**. The stick moment alone cannot fix it (the hover
sensitivity needs it × ≤ 0.974, the 150 KCAS rate × ≥ 0.986). A lower K_R lowers the hover sensitivity per unit of 150 KCAS rate:

| K_R / stick moment (sign fixes in) | hover | 100 | 150 | 180 KCAS | sensitivity hover / 100 | sensitivity ÷ 150 KCAS rate |
|---|---|---|---|---|---|---|
| 5,000 / 715 | 6.22 | 4.90 | 4.26 | 3.80 | 12.0 / 10.8 | 2.82 |
| 4,000 / 715 | 6.67 | 5.35 | 4.72 | 4.24 | 12.8 / 11.5 | 2.71 |
| 3,500 / 640 | 6.20 | 5.02 | 4.45 | 4.01 | 11.9 / 10.7 | 2.67 |
| 3,000 / 715 | 7.19 | 5.88 | 5.27 | 4.78 | 13.7 / 12.4 | 2.60 |
| **3,000 / 590 (flown)** | **5.94** | **4.85** | **4.34** | **3.93** | **11.4 / 10.2** | 2.62 |

Roll at 3,000 / 590 (the lateral stick moment is AG's 975 N m, unchanged): 15.6 / 16.7 / 16.7 / 16.6 °/s/in at 0 / 100 / 150 / 180 KCAS,
sensitivity 65.2 / 66.9 / 65.4 °/s²/in at 0 / 150 / 180. At 5,000 / 715 it was 14.8 / 15.5 / 15.3 / 15.3 and 62.2 / 63.0 / 61.4.

- The model's sensitivity per unit response stays ≈ 1.9 /s; AMCS-73's 9/6 is 1.5 /s. So no pair holds 4.2 °/s/in at 180 KCAS with the
  hover sensitivity under 11.7 (C18's gap; 3.93 at 180 now).
- **Fragile margins** (all AGENT fits, recorded for the integrator): G5 hover sensitivity 11.37 against 11.7 (2.8 %); G5 150 KCAS pitch
  4.34 against 4.2 (3.3 %); G5 roll sensitivity at 150 KCAS 66.9 against 68.9 (2.9 %); G8 AMCS p/q at 100 KCAS 0.165 against 0.2
  (0.127 at K_R 5,000); C9 at 190 KCAS 0.47 against 0.5 in.
- G5a: full aft AMCS stick now commands 9.9° of gyro pitch (11.3° = stick moment / K_R), 10.1° of flap, against the ≥ 8° of blade cyclic.
- What K_R does elsewhere: the AMCS's steady lateral stick per kN m of roll moment falls (C9's 125–190 KCAS shift 0.19 → 0.13 in, C26,
  C23-AMCS); the bank under a steady 625 N m roll moment drifts more slowly (2.9° in 20 s at the hover against 10.2° at 5,000 with the
  sign fixes, 21° before them). The ICS is untouched.
- **These AMCS numbers live in `compound.ts`, overriding AG's `gyro.ts`** (AG's docs/control-gyro-model.md section 6 calls the compound
  refit mandatory). AGENT choice in two files: section 9 asks the integrator to move the pair into gyro.ts with the compound as the
  fitting condition, or to point gyro.ts at this override.

## 6. Results (measured; 18,300 lb SL unless stated)

Measured after the assessment round's fixes (wing and pusher wake signs, AMCS K_R 3,000 / 590 N m, delta-beta floor). "Was" is the first
submission. The two sign fixes act in the hover and at low speed (C1–C3, C22 attitudes, C23, the hands-off hover); the K_R refit acts on
the AMCS's stick per moment and its rates (C9, C18, C19, C22 held-cyclic sizes, C26). Separated by a run with the sign fixes at the old
K_R 5,000 / 715: C9 190 KCAS 0.56 in, C26 0.56 / 0.69 / 0.12 in, C19 4.60 in, C22 held +10° −5.6° / −6° +2.9°, 5.3 kt — the K_R's;
C1, C22 over the spot and C23-ICS the same as with K_R 3,000 — the sign fixes'; C23-AMCS lateral 0.11 → 0.15 in is the K_R's.

| Row | Target (tag) | Measured | |
|---|---|---|---|
| C1 hover download | 4–8 % of the weight (ESTIMATE) | 4.87 % (OGE, AMCS); hover torque 85.9 %, 18.8° indicated, pitch +0.9° (was +0.2°), roll 5.4° left | pass |
| C2 HOGE 18,750 lb | 8,500 ft ± 1,000 (P para 12) | 8,625 ft (was 8,750; engine-limited at the 10-min rating: 95.5 % torque, Ng 101.3 %, TIT 766 °C) | pass |
| C3 20,500 lb | OGE 6,000 / IGE 9,300 ft ± 1,000 (P para 11) | 6,000 / 9,000 ft (was 6,125 / 9,000) | pass |
| C4 V_H, stores, 18,750 lb, 5° | 194 KTAS ± 5 % (P para 14) | 196.9 with the Mach placeholder; 198.7 as flown | pass |
| C5 AMCS clean, 13° | 210–225 KTAS (P Hoh-74 220; S 215) | 212.8 as flown; 211.7 with the placeholder (1.7 KTAS of margin); 199 with the stores | pass |
| C6 rotor lift share | 40–60 / 20–35 / 10–25 % at 120 / 160 / 190 (ESTIMATE) | 71 / 47 / 26 %; the sense (falling with speed; the wing 76 % at 190) holds | **gap** (section 3) |
| C7 collective on the schedule | AMCS 13° ± 2 (P); ICS 5–7° (P) | AMCS 12.99–13.05° at 80–190 KCAS; ICS on its own schedule 5.95–5.98° at 120–160; the default definition in ICS today 5.33 / 5.17 / 4.84° | pass; default-ICS at 160 **gap** until the flight model passes the configuration (section 9) |
| C8 pitch at 190 KTAS | −1 … −5° (ESTIMATE) | −2.9° (80 / 100 / 120 / 160: +0.72 / −0.85 / −1.67 / −2.57°) | pass |
| C9 lateral trim (AMCS, 5,000 ft, 18,500 lb, P test condition) | very small 85–125, about 0.5 in left 125–190, no pedal shift, forward with speed (P AMCS-73 para 22) | 85→125: 0.08 in; 125→190: 0.13 in left (was 0.19); pedal span 0.39 in; longitudinal +0.41 → −1.10 in | sense pass; the 0.5 in **gap** |
| C9 (plan wording) | within 0.5 in at 125–190 | 0.26 / 0.36 / 0.47 in left at 120 / 160 / 190 (was 0.56 at 190) | pass (190 by 0.03 in, the K_R refit's) |
| C10 acceleration (AMCS, 19,200 lb, 1500 ft, stores) | 0 → 188 KTAS in 107 s ± 20 % (P Table 3) | 0 → 165 in 61.0 s (P 53 s: pass ± 20 %); 165 → 188 in 20.1 s (P 54 s) | 0 → 188 **gap**: 81 s |
| C11 deceleration | 196 → 0 in 33 s ± 20 %, < 4,000 ft; 196 → 165 in 5.4 s (P Table 3) | 196 → 165 in 5.9 s (pass); below 150 KTAS 0.15–0.2 g; still moving after 90 s, 6,770 ft | 196 → 0 **gap** |
| C12 autorotation, 19,700 lb, 2,700 ft, 95 KCAS, +8° (ICS) | 2,200 ± 300 ft/min (P para 69) | 2,492 ft/min (zero shaft torque at 100 % Nr; collective 1.0° at 0.75 R; prop −3.4 kN) | pass (at the edge) |
| C13 delta-beta | +18° within 1.5 s from 25° at 150 KCAS; with the stop at 24° on a 123 KCAS climb entry Nr 60–75 % in 5 s (P paras 66–67, 68 %) | latched in 0.01 s (prop torque 3,420 N m at the chop), 18° at 0.48 s; Nr 72.1 % at 5 s; a shutdown at the detent (1,060 N m) on the ground or in the hover does not latch | pass |
| C14 power per degree | above 28° ≥ 2 × at +10° (P para 81) | 6–16 × | pass |
| C15 speed stability | ∂T/∂V < 0, 120–190 KTAS (P para 47) | −143 … −164 N/kt | pass |
| C16 reverse on the ground | right yaw and right roll (P para 29) | right roll 0.29°, backward 6.8 kt, 6.9 kN of reverse thrust; the nose yaws **left** 2.3° | roll pass; yaw **gap** |
| C16 rolling take-off | lift-off on +13° at about 60 KIAS (P AMCS-73 para 19) | 60 KIAS in 18.5 s on 20° of prop; on 13° the wheels still carry 15 %; on 15° airborne at 61.9 KIAS, pitch change +1.6°, peak rate 6.1 °/s | **gap** (2° more collective: AG's rotor, as the hover) |
| C17 ICS full stick, 122 / 152 KCAS | 77 R; 42 / 49 L; ratio 1.5–1.9 ± 20 % (P para 60) | 40.2 R / 33.8 L (1.19); 43.5 R / 31.0 L (1.40); trims 0.27 / 0.51 in left | sense pass; size **gap** (AG's ICS rates) |
| C18 AMCS to 180 KCAS | pitch 6 °/s/in, roll 16 °/s/in ± 30 %; roll sensitivity 53 at 180 ± 30 % (P AMCS-73) | pitch 5.94 / 4.85 / 4.34 / 3.93; roll 15.6 / 16.7 / 16.7 / 16.6; 65.4 °/s²/in at 180 | pitch at 180 **gap** (section 5) |
| C19 pull-up / push-over | 2.43 g in ≈ 2.1 s from 180 KCAS, 1.75 g at 1 s (± 20 %); 0.28 g in 2.5 s from 165 (± 0.1 g) (P paras 39–40) | **4.49 in of aft stick (91 % of the 4.95 in travel) over 1 s for 2.43 g**, peak at 1.99 s, 1.77 g at 1 s; push 2.46 in forward for 0.28 g at 2.04 s (was 4.60 / 2.53 in) | pass (the time, the g at 1 s and the stick inside the travel; the peak g is the bisection's target and is not asserted) |
| C20 engine failure | the prop the critical control at 188 KCAS, the collective at 60; left yaw (P para 68) | prop share of the shaft load 30 / 45 / 83 % at 60 / 120 / 188; with the delta-beta off and one action at 1 s, Nr at 3 s: 188 KCAS 82.9 % (prop) vs 70.2 % (collective), 60 KCAS 79.9 % (prop) vs 84.1 % (collective); yaw 16–20 °/s left | pass |
| C22 hover by blade angle | see the note below | over the spot: +4° → 2.6° nose UP (T/W predicts 2.8°), 0.07 in aft stick; +10° → 6.1° up; −6° → 1.8° down. Cyclic held 5 s: +10° → 3.8° nose down, 12.3 kt forward (was 5.3°, 14.3 kt); −6° → 1.9° nose up, 4.5 kt rearward (was 1.1°, 4.9 kt) | sense pass; +10° held size pass (2–5°); −6° held sizes and the +4° stick **gap** (ESTIMATE bands) |
| C23 transition shift hover → 100 KCAS (19,500 lb) | ICS 1.1 in L ± 0.4, 0.7 in fwd ± 0.3, 2.3 in R pedal ± 0.7; AMCS lateral 0.4–0.7 in; frozen controls 30–70 KCAS: right roll, nose up, nose left (P para 25; AMCS-73 para 17) | ICS 0.87 in **right**, 0.52 in forward (was 0.97), 2.34 in right pedal; AMCS 0.15 in left, 2.50 in right pedal; frozen: −3.3 °/s roll (left; was −1.8), +10.7 °/s pitch (was +6.5), −6.4 °/s yaw (was −16.8) | pedal, ICS longitudinal, nose up / left pass; lateral shifts and the right roll **gap** |
| C24 collective 3 → 7° at 158 KTAS | power falls (P para 14) | 65.0 → 57.5 % torque | pass |
| C25 creep | 36° → 35° ± 0.3 in 10 s (P sense / ESTIMATE) | 35.0° | pass |
| C26 the reaction in the lateral trim | without the asymmetry 0.8–1.5 in left; as built 0 ± 0.5 (D) | as built 0.47 in left; symmetric 0.55 in left; the reaction reversed 0.21 in left | sense pass; the D band **gap** (the AMCS needs 0.01–0.02 in per kN m: the 12.5 kN m reaction is about 0.3 in) |

**C22 note (AGENT deviation from the plan row).** Plan C22 asks 3–6° nose DOWN for +4° re-trimmed over the spot. That has the force
balance backwards. Forward prop thrust held over a spot needs the disc tilted aft, which on a hingeless rotor takes the fuselage nose up
by about T/W (2.8° for 3.98 kN; measured 2.6°). ASTA-72 para 30 (P) keeps rearward flight level with reverse thrust, the same physics from
the other side. The tests assert the physical sense, the +10° held-cyclic size (2–5° nose down: 3.8°), and carry as KNOWN GAP rows the
plan's other sizes: the +4° stick (0.3–0.8 in aft; 0.07 in) and the −6° held cyclic (2–4° nose up: 1.9°; 10–15 kt rearward: 4.5 kt in
5 s, where the −2.9 kN of static reverse thrust is 3.6 % of the weight, about 3.4 kt in 5 s before drag, D). The sign correction is an
AGENT finding for the owner, not an owner decision (section 9).

**Cost.** One physics step at 120 KTAS takes 181–205 µs (two runs), against 177–182 µs for AG's stage 2 and 152–156 µs for the MD 500E on the
same machine: 1.2–1.3 × the MD 500E. AH's H10 budget is 2 × the MD 500E. `wingLoads` and
`PusherDrive.compute` allocate nothing per call (module scratch; a 3 s flight digest at 0 / 30 / 150 / 190 KTAS in both configurations is
bit-identical to the allocating version).

**Hold probe** (`scripts/probes/heliHold`, AC=ah56; informational; `traces/ah56-hold-ac2.jsonl`): no disconnects.
- Calm hover: **0.03 m RMS** (typical and max gross; 0.70 m before the wing sign fix; AG's stage 2: 0.03 m). The sign defect was the cause.
- Windy hover: 1.9–2.7 m RMS (before 1.9–2.8; AG's stage 2: 1.9–2.6).
- Sequence: altitude RMS 1.97–2.12 m.

## 7. AG's rows on the compound (C21)

AG's list on this definition: **68 pass, 11 expected-fail, 4 fail** (before the assessment round: 69 / 11 / 3). The four reds are AG's
tests, which AC does not own; each has a disposition for the integrator in section 9:
- **G10 fails** (8,594 ft against 9,000–11,500). "No wing, no pusher" no longer describes `AH56_DEFINITION`. Its band is superseded by C2
  (8,625 ft on the same 18,750 lb standard day, P 8,500 ± 1,000).
- **G7a fails.** The ICS full stick at 120 KCAS gives 39.0 R / 35.9 L °/s (band 40–65 R), ratio 1.09 (band 1.5–1.9); the trim is 0.12 in
  left (stage 2: 0.76 in left, 50.0 R / 31.1 L, 1.61). The compound's P row for the same manoeuvre is C17 (77 R / 42 L at 122 KCAS:
  40.2 R / 33.8 L measured). The ICS stick moments are P-pinned by G4 (278 / 337 ft-lb/in) and the gyro by G1–G4, so no ICS refit inside
  compound.ts reaches it.
- **G8-ICS fails.** p/q at 1 s after a pure longitudinal step: +0.26 hover, −0.44 at 100 KCAS (|p/q| ≤ 0.3 asserted). The input-rotation
  sweep on the compound (the only ICS knob not pinned by a P row):

  | ICS input rotation (advanced) | 5° | 9° | 13° (AG) | 17° | 21° | 25° |
  |---|---|---|---|---|---|---|
  | p/q hover | −0.03 | +0.11 | +0.26 | +0.42 | +0.60 | +0.83 |
  | p/q 100 KCAS | −0.80 | −0.62 | −0.44 | −0.26 | −0.08 | +0.10 |

  The two speeds sit 0.68 apart at every angle, so no single angle holds both within 0.3 (15° gives about +0.34 / −0.35). Not refitted.
- **G6 variant fails (new: caused by AC's wing sign fix).** AG's informational self-consistency row: a steady 625 N m roll moment at the
  hover, the bank rate between 2 and 3 s against K_R β/H (asserted 0.5–1.5 of it). Measured 0.036 °/s against 0.099 predicted (0.37);
  0.48 at K_R 5,000 with only the sign fixes; at every K_R from 2,500 to 5,000 it is 0.43–0.48. Before the fix it read 1.05, but the bank
  then diverged: 21° in 20 s (3.3 °/s at 20 s); now 0.57° in 10 s and 2.9° in 20 s. The 0–10 s mean rate is 0.057 °/s = 0.58 of the
  prediction, inside the test's 0.5–1.5. The 2–3 s window is an early transient of a slow drift; the row moved because the hover
  stopped diverging.
- G5 passes after the second refit (section 5; margins 2.8 % / 3.3 %). G5a passes (9.9° gyro pitch at full aft stick). G6 holds the bank
  within 0.47° (keyboard tap 0.06°). G9 is 4.7° left, pitch +0.6°.
- G11 runs on the drivetrain with the prop: Nr to 90 % in 0.54 s.

All digests are unchanged (legacyDigest, s269Legacy, contactAirborne: 35 cases; section 9 lists the guard runs).

**Hands-off hover** (20 s from the 15 m hover spawn, 18,300 lb, controls frozen at the trim; headless runs are calm: the test environment
carries no wind; the 8 kt rows are the in-sim readouts of `scripts/shot.mjs`, `W/shots/AC2/`):

| Case | Pitch | Roll | Drift | Vertical | Was (first submission) |
|---|---|---|---|---|---|
| ICS, compound, calm (headless) | +12.7° (+0.9° at reset; −0.5° at 10 s) | 2.3° left | 12.3 kt | −3 ft/min | +17.6°, 11.6 kt |
| ICS, compound, sim, 8 kt wind (`ah56-ics-hover.png`) | +7.9° | **13.3° left** | 9.2 KIAS, 16 kt over the ground | 0 ft/min at 43 ft | +29°, 22 kt, −280 ft/min at 37 ft |
| AMCS, compound, calm (headless) | +0.9° (unchanged from the trim) | 4.9° left | 8.3 kt | +50 ft/min | +2.4°, 5.2° left, 6.6 kt |
| AMCS, compound, sim, 8 kt wind (`ah56-hover.png`) | −4.4° | 2.0° right | 18.7 KIAS, 12 kt over the ground | +143 ft/min at 59 ft | −4.4°, 3.6° right, 20.7 KIAS, +176 ft/min |

The AMCS in-sim readout (Nr 239.8 rpm = 97.5 %, Ng 92.6 %, TIT 594 °C, torque 85.5 %, prop at −2.2° windmilling −1.11 kN): the aircraft
holds its attitude and weathercocks into the wind; the drift, the nose-down attitude and the climb are the wind and translational lift
acting on frozen controls. Not separated further.

**The ICS pitch-up, isolated** (headless, calm, 20 s, pitch at 20 s from +0.2 … +0.9° at reset):

| Variant | Pitch at 20 s | Roll | Drift |
|---|---|---|---|
| compound | +12.7° | 2.3° L | 12.3 kt |
| main-rotor wake at the prop off (`wake` 0) | +9.8° | 2.0° L | 13.6 kt |
| prop turning the other way (`rotation` +1) | +9.8° | 7.3° L | 7.6 kt |
| no pusher | +6.3° | 3.3° L | 12.3 kt |
| no wing | +5.7° | 0.2° L | 15.6 kt |
| AG's stage 2 (no wing, no pusher) | −6.2° | 0.4° R | 11.1 kt |

The ICS hands-off hover diverges in pitch in every configuration (AG's G7 gaps: the ICS's weak attitude retention); the wing and the
pusher (the wake at its disc and the windmilling drag of about 1.1–1.3 kN above the reference point once it drifts) each tip it nose up
by 3–7°. The divergence is slow: −0.5° at 10 s, +12.7° at 20 s. KNOWN ISSUE (section 9).

## 8. What is not modelled

- The prop's slipstream on the airframe: the reverse wake over the ventral fin and the tail rotor (C16's right yaw), and the fuselage's
  wake into the disc.
- The wing's upwash on the rotor.
- The wing's own pitching moment beyond the lift at its quarter chord.
- A per-configuration delta-beta reverse target.
- The pylon/pod download in the hover.
- The load-factor channel of the delta-beta's sensor (P: "senses MR shaft torque and load factor").
- The grip's own creep: the sim's grip position does not move with the blades.

## 9. Handover to the integrator (plan 8.1: AC's KNOWN_ISSUES rows, contract requests and deviations go in PR text)

Everything here is an AGENT finding or request; none of it is an owner decision.

### 9.1 Contract requests

1. **flightModel.ts reset (TW's file):** `if (d.pusher) c.propLever = pusherTrimLever(d, ic.airspeed, ic.rotorcraftConfig);`
   (`ic.rotorcraftConfig` is already in InitialConditions, plan 3.4). Today an ICS reset trims on the AMCS's blade angles: 5.33 / 5.17 /
   4.84° indicated at 120 / 140 / 160 KCAS (P band 5–7°); on its own schedule 5.97 / 5.95 / 5.98°. Then drop the `icsSchedule` variant in
   `ah56Compound.test.ts` (C7, C17, C23) and turn the C7 `it.fails` into a pass on `AH56_DEFINITION`.
2. **AG's four red rows on the compound** (AC does not own them; do not merge with them red). Per row, the measured value and the
   disposition (section 7 has the evidence):
   - **G10** (ah56Systems): 8,594 ft against 9,000–11,500 ft "no wing, no pusher". Replace the band with C2's 8,500 ± 1,000 ft (P ASTA-72
     para 12) or delete it as superseded by C2 (8,625 ft on AC's rig).
   - **G7a** (ah56Handling): 39.0 R / 35.9 L °/s, ratio 1.09, trim 0.12 in left at 120 KCAS (band 40–65 R, 1.5–1.9). Convert to
     `it.fails` KNOWN GAP with these numbers, pointing at C17 (the compound's P row: 77 R / 42 L at 122 KCAS; 40.2 R / 33.8 L measured).
     No ICS refit in compound.ts reaches it: the ICS stick moments are P-pinned by G4 and the gyro by G1–G4.
   - **G8-ICS** (ah56Handling): p/q +0.26 hover, −0.44 at 100 KCAS (|p/q| ≤ 0.3). Convert to `it.fails` with these numbers and the
     input-rotation sweep of section 7 (the two speeds sit 0.68 apart at every angle from 5° to 25°).
   - **G6 variant** (ah56Handling; red since AC's wing sign fix): 2–3 s window 0.37 of K_R β/H (0.48 at K_R 5,000; 1.05 before the fix,
     when the bank diverged to 21° in 20 s). Measure the rate over 0–10 s (0.58 of the prediction, inside 0.5–1.5), or record the window
     as a KNOWN GAP. AC caused this red.
3. **The AMCS gyro numbers live in compound.ts:** K_R 3,000 N m/rad and the full longitudinal stick moment 590 N m override AG's gyro.ts
   (7,500 / 811) through `AH56_COMPOUND_GYRO`. Move the pair into gyro.ts with the compound as the fitting condition, or add a comment in
   gyro.ts pointing at the override. **Done in the final fix round:** the flown pair (3,200 / 566 after AH's refit) is in gyro.ts with
   the compound named as its fitting condition, and compound.ts no longer overrides the gyro. The margins are fragile (section 5): G5 hover sensitivity 2.8 %, G5 150 KCAS rate 3.3 %, G5 roll
   sensitivity at 150 KCAS 2.9 %, G8 AMCS p/q at 100 KCAS 0.165 of 0.2, C9 at 190 KCAS 0.03 in.
4. **Plan C22's sign** (owner to see): +4° re-trimmed over the spot is nose UP by about T/W, not 3–6° nose down (section 6, C22 note).
5. **The rotor Mach placeholder is not flown** (plan 7.3 flies it): C4 196.9 KTAS with it / 198.7 as flown; C5 211.7 with it (1.7 KTAS of
   margin) / 212.8 as flown. AH's section and any C4/C5 re-fit (plan 7.3: the integrator applies AH's) start from these.
6. **Prop efficiency** 0.753 at J 1.15, C_P 0.34 against the ≈ 0.80 ESTIMATE: the loss is in the BEMT's induced/swirl/tip-loss terms and
   the wave drag (`src/physics/propulsion/**`), not in AC's section data (section 4). If that is changed, re-fit `FUSELAGE_DRAG_X`
   (about 1.2 m² at 0.80) and both trim schedules (C7).

### 9.2 KNOWN_ISSUES entries (one line each: measured, target, suspected term)

1. C6 rotor lift share 71 / 47 / 26 % at 120 / 160 / 190 KCAS (ESTIMATE 40–60 / 20–35 / 10–25 %): AG's collective reading (13° indicated
   = 6.0° at 0.75 R), kept for the AMCS's own operation (section 3).
2. C7 an ICS reset of the default definition trims 4.84° indicated at 160 KCAS (P 5–7°): the flight model does not pass the configuration
   to `pusherTrimLever` (9.1 item 1).
3. C9 the AMCS lateral trim moves 0.13 in left from 125 to 190 KCAS (P about 0.5 in): small steady stick per kN m of roll moment
   (K_R / K_hub over the stick moment per inch).
4. C10 0 → 188 KTAS in 81 s (P 107 s ± 20 %); 165 → 188 in 20 s (P 54 s): too much thrust margin at high speed (the prop map's
   efficiency and the flat plate fitted to it).
5. C11 196 → 0 KTAS: still moving after 90 s and 6,770 ft (P 33 s, under 4,000 ft): the reverse prop gives only 0.15–0.2 g below
   150 KTAS (the reverse map at speed; no slipstream on the airframe).
6. C12 autorotation 2,492 ft/min (P 2,200 ± 300): at the band's edge.
7. C16 reverse thrust on the ground yaws the nose 2.3° LEFT (P right yaw): the prop's reverse slipstream over the ventral fin and the tail
   rotor is not modelled.
8. C16 the rolling take-off needs 15° indicated (lift-off at 61.9 KIAS) where P lifts off on 13°: AG's rotor wants about 2° more
   collective for the same lift (as the 18.8° hover).
9. C17 ICS full stick 40.2 R / 33.8 L °/s at 122 KCAS (1.19), 43.5 R / 31.0 L at 152 (1.40) against 77 R / 42–49 L (P): AG's ICS steady
   rates (G7 gaps) with the wing's roll damping (−9.9 kN m per rad/s).
10. C18 AMCS pitch 3.93 °/s/in at 180 KCAS (P 6 ± 30 %): the model's sensitivity per unit response is 1.9 /s against AMCS-73's 1.5 /s.
11. C22 cyclic held at −6°: 1.9° nose up (ESTIMATE 2–4°), 4.5 kt rearward in 5 s (ESTIMATE 10–15 kt): the −2.9 kN static reverse thrust is
    0.035 g.
12. C22 +4° re-trimmed over the spot takes 0.07 in of aft stick (ESTIMATE 0.3–0.8 in): the AMCS stick commands a rate.
13. C23 the ICS lateral trim shift hover → 100 KCAS is 0.87 in RIGHT (P 1.1 in left): AG's ICS feedback sets both trims.
14. C23 the AMCS lateral shift is 0.15 in (P 0.4–0.7 in): as item 3.
15. C23 frozen controls (ICS) between 30 and 70 KCAS roll LEFT at 3.3 °/s (P right roll): no prop slipstream; the ICS's roll coupling.
16. C26 the symmetric-wing trim at 190 KTAS is 0.55 in left (D 0.8–1.5 in): the AMCS needs 0.01–0.02 in per kN m (the D band assumed
    0.1).
17. Hands-off hover, ICS: +12.7° nose up in 20 s calm (headless); in the sim with 8 kt of wind +7.9° and 13.3° left roll at 9 KIAS: the ICS's
    attitude retention (AG's G7 gaps) plus the wing's (+7°) and the pusher's (+6°) nose-up terms (section 7 isolation).
18. Prop efficiency 0.753 at the V_H loading against about 0.80 (ESTIMATE): the BEMT's loss terms; the 1.0 m² flat plate compensates.
19. AG rows red on the compound: G6 variant, G7a, G8-ICS, G10 (9.1 item 2).

### 9.3 AGENT deviations from the plan

- C22's sign (9.1 item 4).
- `PROVISIONAL_SECTION` not flown (9.1 item 5).
- The AMCS gyro pair overridden in compound.ts (9.1 item 3): plan 7.3 lets compound.ts override "airframe aero that compounding changes";
  the gyro feedback is AG's data, refitted here because AG's doc calls the compound refit mandatory.
- The collective reading (section 3: AG's, kept).
- C19's stick is bisected for the P peak g (AMCS-73 gives no stick size); the peak g is not asserted.
- The delta-beta sensor's 1,600 N m arming floor (ESTIMATE; section 2).

### 9.4 Guards run on the AC branch

Commands of plan §10 for AC, on 4eeb206 plus the doc and test-comment edits (W/guards/ac2, W/logs-ac2):
- G0 `npx tsc --noEmit`: clean.
- GR: legacyDigest + s269Legacy + contactAirborne 35/35 (all digests unchanged); GR2 64/64; GR3 57 + 3 expected-fail; GR4 83 + 6
  expected-fail.
- GA 249/250: the one red is `consistency` ah56 (pilot's eye, audio rated power, panel red line): the AX / AU / PN stubs not on this
  branch, the same red as on AG's and AC's first guard runs. Not AC's.
- GS 98/98.
- GF: goldens 38/40, the two reds the c172Sim baseline exceptions; GF2 79/79.
- AG list: 68 pass, 11 expected-fail, 4 fail (G6 variant, G7a, G8-ICS, G10: 9.1 item 2).
- AC list: 47 pass, 15 expected-fail, 0 fail; `AH56_TRACE=W/traces/ah56-s4` written.
- heliHold (AC=ah56): no disconnects; calm hover 0.03 m RMS (`W/traces/ah56-hold-ac2.jsonl`).
- Shots (one at a time, looked at): `W/shots/AC2/ah56-hover.png`, `W/shots/AC2/ah56-ics-hover.png` (the visual is the stub, AX's
  exterior is not on this branch).

## 10. Pilot-review round on the integrated aircraft (2026-10-22, integrator; KNOWN_ISSUES R2, R3)

Measured, not changed (AGENT routing to the compound's owner; numbers in KNOWN_ISSUES R2 / R3 and `work/rigid/flight-numbers.md`):
- **Pitch balance at speed (R3).** At 160 KCAS SL on the ICS schedule the wing's downwash on the stabiliser (`TAIL_DOWNWASH`,
  0.139 per unit wing Cl, ESTIMATE; DATCOM gives about 0.118 for this tail position) is +30.5 kN m nose up, the stabiliser's own load
  +6.1, the wing −16.8, the pusher −0.8: the rotor carries −17.6 kN m of hub moment, which the ICS feels through the sweep (G4: 5.39
  kN m per inch) as about 3 in of forward stick. At ASTA-72 para 44's conditions the ICS gradient about trim is 0.10 in/kt against
  P 0.015 / 0.012 in/kt and there is no 190 KCAS trim; without the downwash on the tail the trims move 2.6-4.4 in aft and the gradient
  falls to 0.037 / 0.076 in/kt at 120 / 150 KCAS. `WingPanelDef` carries no section pitching moment: thin-airfoil theory ties the −2°
  zero-lift ESTIMATE to Cm ≈ −0.05 (D), about −8.7 kN m at 160 KCAS SL. A refit against para 44 moves C6, C8, C9, C23, H4 / H5 and
  the AMCS schedule.
- **Reverse deceleration (R2).** 165-80 KTAS at 0.20 g against P 0.31 g; the reverse map is within thin-section data (clMin −0.8,
  cdMax 1.6 above Viterna's 1.2), and the rotor holds the weight at a near-level attitude (the C6 lift share), so holding height with
  the cyclic never flares the aircraft.

## 11. Final fix round: the wing section Cm and the DATCOM downwash (2026-10-22, AGENT; KNOWN_ISSUES "Final fix round")

`WingPanelDef` gains `cm0` and `chord`: the section pitching moment q S c cm0 about the panel's spanwise axis in attached flow,
applied as a chordwise force couple (no net force; its power is the pure moment's; `ah56Compound` "the wing section pitching
moment"). The wing flies cm0 = (π/2) α0 = −0.055 (D from the −2° zero-lift ESTIMATE; thin-airfoil parabolic camber) over the
2.316 m MAC (P). The downwash at the stabiliser is DATCOM's for this tail position (D: K_A 0.174, K_λ 1.214, K_H 0.683 with the
stabiliser 27 ft aft and 44 in above the wing; dε/dα 0.443, / 3.73 = 0.119 per unit wing C_L), replacing section 10's ESTIMATE
0.139.

ASTA-72 para 44-45 (ICS, aft CG FS 299.8, stores, 4,000 ft, 18,300 lb; the collective and the prop blade angle held at the V0 trim,
± 5 kt with the cyclic, the path free; `W/probes/fix-final/icsstab.test.ts`):

| Variant | 120 KCAS trim / gradient | 150 KCAS trim / gradient | 190 KCAS trim |
|---|---|---|---|
| as merged (0.139, no Cm) | 3.01 in fwd / 0.106 in/kt | 4.83 / 0.098 | none (5.5 in stop) |
| Cm −0.055, downwash × 1 (0.139) | 2.13 / 0.084 | 3.60 / 0.079 | none |
| Cm, × 0.85 (0.118) | 1.73 / 0.073 | 3.02 / 0.071 | 4.47 |
| **flown: Cm, DATCOM 0.119** | **1.74 / 0.073** | **3.04 / 0.071** | **4.50** (gradient 0.126) |
| Cm, × 0.5 | 0.82 / 0.049 | 1.52 / 0.093 | 1.77 |
| Cm, × 0.25 | 0.20 / 0.032 | 0.15 / 0.064 | 1.53 aft |
| Cm, no downwash | 0.41 aft / 0.017 | 1.15 aft / 0.031 | 3.21 aft |
| P (ASTA-72 para 45) | 0.015 ± 0.010 in/kt (AGENT tolerance) | 0.012 ± 0.010 | a trim point |

No physical downwash reaches para 45 at both speeds; only none at all reaches the 120 KCAS band. The flown pair takes the D values
and keeps the gradient row a KNOWN GAP with the "ICS pitch trim" hint. Before / after on the rows the review named: C4 now flies the
ICS configuration itself (201.2 KTAS at 114 %, 5.1 in forward; was the AMCS gyro's mechanics at 246 rpm); C5 clean 212.7 → 216.7
KTAS; C6 71 / 48 / 30 → 71 / 49 / 29 %; C8 −3.28 → −3.25° at 190 KTAS; C9 0.25 / 0.36 / 0.48 → 0.21 / 0.29 / 0.34 in left at 120 /
160 / 190 KCAS; C18 pitch at 180 KCAS 4.23 → 4.32 °/s/in; C19 2.43 g at 1.79 → 1.75 s; G4 4.60 / 5.58 kN m/in (unchanged); H4 onsets
1.4 → 1.3 g (122 KCAS), 1.5 → 1.4 g (154), and at 190 KCAS / 1.43 g 0.27 → 0.69° of right roll (KNOWN GAP against the row's 0.5°);
C23 ICS longitudinal shift hover → 100 KCAS 0.69 → −0.03 in forward (P 0.7 ± 0.3; the Cm alone 0.17, the downwash alone 0.49:
KNOWN GAP). (The "before" column of these rows already includes the final round's rotor fixes; the stage-5 merge numbers are in
docs/ah56-integration.md section 4.)

