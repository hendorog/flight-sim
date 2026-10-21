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

The hover wake loads the panels down by 3.6 kN.

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
- **Efficiency at the V_H loading** (J 1.15, C_P 0.34 at 190 KTAS and 1674 rpm): 0.75, 18.2 kN for 3,190 shp; 0.69 at the stop. Hamilton
  Standard's charts give about 0.80 for a 3-blade AF-140 prop there. The drag fit absorbs the difference (section 4).
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
| Delta-beta (C13) | latched when the engine's torque at the rotor falls below half the prop's rotor-referred torque, released when the engine carries the prop again; it cuts a forward angle to +18° and a reverse angle to −8.5° (AMCS; the ICS's −7° is not separated) at 15°/s | P (targets, ASTA-72 paras 66–67) / ESTIMATE (the sensor, the rate) |

**Loads** (`PusherDrive.compute`):
- thrust and the in-plane force at the hub (FS 675.7, WL 114.5: 0.495 m above the reference point, P / ESTIMATE WL_cg);
- the disc's own moment (P-factor);
- the main rotor's wake at the disc (0.35 of the mean inflow, faded with speed as the tail rotor's; ESTIMATE);
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
  - This prop map gives 0.72–0.75 at that loading.
  - 0.08 of efficiency is about 2 kN of thrust at 194 KTAS, 0.33 m² (D).
  - So "1.0 m²" stands for the drag the model's prop can push, not a physical estimate of the airframe.
- **C4 and C5 together pin it**: V_H (stores) must reach 194 ± 5 %, and the clean AMCS must pass 210 KTAS. The AMCS's prop at 1674 rpm meets
  its 40.8° stop near 212 KTAS, so C5 caps the drag from below.
- **The provisional Mach drag rise** (`PROVISIONAL_SECTION`: the base polar through section.ts with cd += 3 (M − 0.78)²; M_dd 0.78 ESTIMATE
  plan 7.4; the rise ESTIMATE, Korn's 20(M − M_crit)⁴ with M_crit = M_dd − 0.1 at the 194 KTAS advancing tip, M 0.886, D) is **not
  flown**. The S0 section stub also replaces RC's hinge-forcing polar, and with it G3's ICS auto-trim on a fixed shaft goes from 4 % to
  30 % of the locked-gyro gust moment (the locked moment itself 9.9 → 1.9 kN m).
- **C4 is therefore asserted twice**: with the placeholder (the fit, 196.9 KTAS) and as flown (198.7 KTAS). AH's section (stage 5)
  replaces the placeholder: if its Mach drag is like this one, V_H lands near 197; plan 7.3 gives any re-fit to the integrator through
  AH's PR text.
- **C4 and C24 are trimmed with the AMCS gyro's mechanics at the ICS's 246 rpm.** AG's ICS gyro trim runs out of forward stick above
  about 170 KCAS at these collectives: also on AG's stage-2 aircraft, 5.37 of 5.5 in at 150 KCAS and saturated at 170. The gyro does not
  enter the trim's power.

## 5. The AMCS refit on the compound (AG: "mandatory")

The wing, the pusher and the unloaded rotor take AG's AMCS pitch response at 150 KCAS from 4.27 to 3.86 °/s/in (band 4.2–7.8). Only AG's two
fitted numbers move, through `compound.ts`'s `controlGyro`: K_R 7,500 → 5,000 N m/rad and the full longitudinal stick moment 811 → 715 N m.

The grid (compound, first-peak rates °/s/in, sensitivity °/s²/in):

| K_R / stick moment | hover | 100 | 150 | 180 KCAS | sensitivity hover / 100 |
|---|---|---|---|---|---|
| 7,500 / 811 (AG) | 5.93 | 4.56 | 3.86 | 3.39 | 11.3 / 10.5 |
| 6,000 / 811 | 6.47 | 4.98 | 4.35 | 3.88 | 12.4 / 11.2 |
| 5,000 / 811 | 6.91 | 5.42 | 4.79 | 4.30 | 13.2 / 11.9 |
| **5,000 / 715** | **6.09** | **4.90** | **4.26** | **3.80** | **11.6 / 10.8** |
| 4,000 / 700 | 6.40 | 5.11 | 4.58 | 4.14 | 12.1 / 11.0 |
| 3,000 / 700 | 6.91 | 5.63 | 5.11 | 4.66 | 13.0 / 11.8 |

- The sensitivity per unit response stays ≈ 1.9 /s; AMCS-73's 9/6 is 1.5 /s. So no pair holds 4.2 °/s/in at 180 KCAS with the hover
  sensitivity under 11.7 (C18's gap).
- The chosen pair passes AG's G5 assertions (0 / 100 / 150 KCAS) with margins of 1.4 % (150 KCAS) and 0.7 % (hover sensitivity).
- Roll at the refit: 14.8 / 15.5 / 15.3 / 15.3 °/s/in, sensitivity 61.8 (hover) / 61.4 (180 KCAS) °/s²/in.

## 6. Results (measured; 18,300 lb SL unless stated)

| Row | Target (tag) | Measured | |
|---|---|---|---|
| C1 hover download | 4–8 % of the weight (ESTIMATE) | 4.9 % (OGE, AMCS); hover torque 85.7 %, 18.8° indicated | pass |
| C2 HOGE 18,750 lb | 8,500 ft ± 1,000 (P para 12) | 8,750 ft (engine-limited at the 10-min rating: 95.4 % torque, Ng 101.4 %, TIT 768 °C) | pass |
| C3 20,500 lb | OGE 6,000 / IGE 9,300 ft ± 1,000 (P para 11) | 6,125 / 9,000 ft | pass |
| C4 V_H, stores, 18,750 lb, 5° | 194 KTAS ± 5 % (P para 14) | 196.9 with the Mach placeholder; 198.7 as flown | pass |
| C5 AMCS clean, 13° | 210–225 KTAS (P Hoh-74 220; S 215) | 213.1 as flown; 210.9 with the placeholder; 199 with the stores | pass |
| C6 rotor lift share | 40–60 / 20–35 / 10–25 % at 120 / 160 / 190 (ESTIMATE) | 71 / 47 / 26 %; the sense (falling with speed; the wing 76 % at 190) holds | **gap** (section 3) |
| C7 collective on the schedule | AMCS 13° ± 2 (P); ICS 5–7° (P) | AMCS 12.99–13.05° at 80–190 KCAS; ICS on its own schedule 5.95–5.98° at 120–160 (the real ICS gyro); the default definition in ICS today 5.3 / 5.2 / 4.8° | pass; default-ICS at 160 **gap** until the flight model passes the configuration |
| C8 pitch at 190 KTAS | −1 … −5° (ESTIMATE) | −2.9° | pass |
| C9 lateral trim (AMCS, 5,000 ft, 18,500 lb, P test condition) | very small 85–125, about 0.5 in left 125–190, no pedal shift, forward with speed (P AMCS-73 para 22) | 85→125: 0.09 in; 125→190: 0.19 in left; pedal span 0.39 in; longitudinal +0.47 → −1.30 in | sense pass; the 0.5 in **gap** |
| C9 (plan wording) | within 0.5 in at 125–190 | 0.27 / 0.40 / 0.56 in left at 120 / 160 / 190 | 190 **gap** by 0.06 in |
| C10 acceleration (AMCS, 19,200 lb, 1500 ft, stores) | 0 → 188 KTAS in 107 s ± 20 % (P Table 3) | 0 → 165 in 61.9 s (P 53 s: pass ± 20 %); 165 → 188 in 20.1 s (P 54 s) | 0 → 188 **gap**: 82 s |
| C11 deceleration | 196 → 0 in 33 s ± 20 %, < 4,000 ft; 196 → 165 in 5.4 s (P Table 3) | 196 → 165 in 5.9 s (pass); below 150 KTAS 0.15–0.2 g; still moving after 90 s, 6,700 ft | 196 → 0 **gap** |
| C12 autorotation, 19,700 lb, 2,700 ft, 95 KCAS, +8° (ICS) | 2,200 ± 300 ft/min (P para 69) | 2,490 ft/min (zero shaft torque at 100 % Nr; collective 1.0° at 0.75 R; prop −3.4 kN) | pass (at the edge) |
| C13 delta-beta | +18° within 1.5 s from 25° at 150 KCAS; with the stop at 24° on a 123 KCAS climb entry Nr 60–75 % in 5 s (P paras 66–67, 68 %) | latched in 0.01 s, 18° at 0.48 s; Nr 72.1 % at 5 s | pass |
| C14 power per degree | above 28° ≥ 2 × at +10° (P para 81) | 6–16 × | pass |
| C15 speed stability | ∂T/∂V < 0, 120–190 KTAS (P para 47) | −143 … −164 N/kt | pass |
| C16 reverse on the ground | right yaw and right roll (P para 29) | right roll 0.25° (the reaction), backward 6.6 kt, 6.9 kN of reverse thrust; the nose yaws **left** 2.1° | roll pass; yaw **gap** |
| C16 rolling take-off | lift-off on +13° at about 60 KIAS (P AMCS-73 para 19) | 60 KIAS in 18.5 s on 20° of prop; on 13° the wheels still carry 16 %; on 15° airborne at 62 KIAS, pitch change +1.0°, peak rate 5.5 °/s | **gap** (2° more collective: AG's rotor, as the hover) |
| C17 ICS full stick, 122 / 152 KCAS | 77 R; 42 / 49 L; ratio 1.5–1.9 ± 20 % (P para 60) | 40 R / 34 L (1.19); 43 R / 31 L (1.40); trims 0.27 / 0.51 in left | sense pass; size **gap** (AG's ICS rates) |
| C18 AMCS to 180 KCAS | pitch 6 °/s/in, roll 16 °/s/in ± 30 %; roll sensitivity 53 at 180 ± 30 % (P AMCS-73) | pitch 6.09 / 4.90 / 4.26 / 3.80; roll 14.8 / 15.5 / 15.3 / 15.3; 61.4 °/s²/in | pitch at 180 **gap** (section 5) |
| C19 pull-up / push-over | 2.43 g in ≈ 2.1 s from 180 KCAS, 1.75 g at 1 s (± 20 %); 0.28 g in 2.5 s from 165 (± 0.1 g) (P paras 39–40) | 2.43 g at 1.90 s, 1.81 g at 1 s (4.6 in aft over 1 s); 0.28 g at 1.93 s (2.5 in forward) | pass |
| C20 engine failure | the prop the critical control at 188 KCAS, the collective at 60; left yaw (P para 68) | prop share of the shaft load 30 / 45 / 83 % at 60 / 120 / 188; with the delta-beta off and one action at 1 s, Nr at 3 s: 188 KCAS 82.9 % (prop) vs 70.2 % (collective), 60 KCAS 80.0 % (prop) vs 84.2 % (collective); yaw 16–20 °/s left | pass |
| C22 hover by blade angle | see the note below | over the spot: +4° → 2.7° nose UP (T/W predicts 2.8°), +10° → 6.0° up, −6° → 1.9° down; cyclic held 5 s: +10° → 5.3° nose down, 14 kt forward; −6° → 1.1° nose up, 4.9 kt rearward | sense pass (physical); sizes partly outside the ESTIMATE bands |
| C23 transition shift hover → 100 KCAS (19,500 lb) | ICS 1.1 in L ± 0.4, 0.7 in fwd ± 0.3, 2.3 in R pedal ± 0.7; AMCS lateral 0.4–0.7 in; frozen controls 30–70 KCAS: right roll, nose up, nose left (P para 25; AMCS-73 para 17) | ICS 0.82 in **right**, 0.97 in forward, 2.33 in right pedal; AMCS 0.12 in left, 2.49 in right pedal; frozen: −1.8 °/s roll (left), +6.5 °/s pitch, −16.8 °/s yaw | pedal, ICS longitudinal, nose up / left pass; lateral shifts and the right roll **gap** |
| C24 collective 3 → 7° at 158 KTAS | power falls (P para 14) | 65.0 → 57.5 % torque | pass |
| C25 creep | 36° → 35° ± 0.3 in 10 s (P sense / ESTIMATE) | 35.0° | pass |
| C26 the reaction in the lateral trim | without the asymmetry 0.8–1.5 in left; as built 0 ± 0.5 (D) | as built 0.56 in left; symmetric 0.69 in left; the reaction reversed 0.12 in left | sense pass; the D band **gap** (the AMCS needs about 0.02 in per kN m: the 12.5 kN m reaction is 0.26 in) |

**C22 note.** Plan C22 asks 3–6° nose DOWN for +4° re-trimmed over the spot. That has the force balance backwards. Forward prop thrust held
over a spot needs the disc tilted aft, which on a hingeless rotor takes the fuselage nose up by about T/W. ASTA-72 para 30 (P) keeps
rearward flight level with reverse thrust, the same physics from the other side. The test asserts the physical sense; the plan row's
sign is a contract request.

**Cost.** One physics step at 120 KTAS takes 182–206 µs, against 176–180 µs for AG's stage 2 and 151–158 µs for the MD 500E. That is
1.2–1.3 × the MD 500E; AH's H10 budget is 2 ×.

**Hold probe** (`scripts/probes/heliHold`, AC=ah56; informational): no disconnects.
- Windy hover: 1.9–2.8 m RMS (AG's stage 2: 1.9–2.6).
- Sequence: altitude RMS 1.97–2.11 m.
- Calm hover: 0.70 m RMS (AG 0.03 m). The generic hold works the lateral stick against the prop and the wing in the hover.

## 7. AG's rows on the compound (C21)

AG's list on this definition: 69 pass, 11 expected-fail, 3 fail. The changed rows:
- **G10 fails.** "No wing, no pusher" no longer describes `AH56_DEFINITION`. Its 9,000–11,500 ft band is superseded by C2 (8,750 ft).
- **G7a fails.** The ICS full stick at 120 KCAS gives 39.0 R / 35.9 L °/s, ratio 1.09.
- **G8-ICS fails.** p/q is −0.44 at 100 KCAS.

  Both are AG's ICS feedback at the compound's unloaded-rotor operating point. Without the wing the ICS lateral trim at 120 KCAS is still
  1.0 in right; the prop's reaction moves it 0.65 in left (the right sense) and the wing asymmetry 0.34 in right.
- G5 and G7b-AMCS pass after the refit (section 5). G6 holds the bank within 0.24°. G9 is 4.7° left.
- G11 now runs on the 14,573 kg m² drivetrain: Nr to 90 % in 0.54 s.

All digests are unchanged (legacyDigest, s269Legacy, contactAirborne: 35 cases).

**Hands-off hover** (20 s from the 15 m hover spawn, 18,300 lb):

| Case | Pitch | Roll | Drift | Note |
|---|---|---|---|---|
| ICS, compound, calm (headless) | +17.6° | | 11.6 kt | stage 2: −6.2° pitch, 11.1 kt |
| ICS, compound, sim, default 8 kt wind (`ah56-ics-hover.png`) | +29° | | 22 kt | descending 280 ft/min at 37 ft |
| AMCS, compound, calm (headless) | +2.4° | −5.2° | 6.6 kt | G9's band |
| AMCS, AG's hover-readout row (rig air data) | +4.8° | +0.5° | 7.8 kt | AG's `it.fails`; K_R 7,500 before the refit gave −2.2°, inside the band, so the refit costs it |

The ICS's pitch-up is not separated. The prop's windmilling drag above the reference point once the aircraft drifts (about −1.25 kN,
+0.6 kN m nose up) acting on the ICS's weak attitude retention is the likely term. KNOWN ISSUE.

## 8. What is not modelled

- The prop's slipstream on the airframe: the reverse wake over the ventral fin and the tail rotor (C16's right yaw), and the fuselage's
  wake into the disc.
- The wing's upwash on the rotor.
- The wing's own pitching moment beyond the lift at its quarter chord.
- A per-configuration delta-beta reverse target.
- The pylon/pod download in the hover.
- The load-factor channel of the delta-beta's sensor (P: "senses MR shaft torque and load factor").
- The grip's own creep: the sim's grip position does not move with the blades.
