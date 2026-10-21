# Lockheed AH-56A Cheyenne: source and setup record

Stage 2 (AG, 21 October 2026): the control gyro on the non-compound aircraft, the T64, the hingeless hub and the wheels are built
on the sources below; what each number is and how it was used is in `docs/ah56-flight-model.md` and `docs/control-gyro-model.md`.
The section "Stage 2: how the sources were used" at the end lists the additions and the readings taken.

The aircraft is the **Lockheed AH-56A Cheyenne compound helicopter**. It has a four-blade hingeless ("rigid") main rotor driven through a control gyro, a 195 ft² low
wing, a 10 ft three-blade reversible pusher propeller and a four-blade teetering tail rotor on the left stabiliser tip. All three rotors are driven by one GE T64 on one
fixed-ratio shaft.

**Owner-accepted plan** (owner-notes 2026-10-21):
- Staged build: gyro on a non-compound AH-56 first, with pre-AMCS and AMCS feedback switchable; then the wing; then the shared-shaft pusher; then high-advance-ratio
  aerodynamics.
- The half-P hop is a scripted event.

**AGENT choices** (owner-notes lists the first two as agent choices too):
- AMCS is the default configuration, with the pre-AMCS gyro as the selectable variant.
- id `ah56`, `available:false`.
- AMCS means the 1973 ship #7 (66-8832) as tested by the Army in USAASTA 72-44.
- AMCS normal Nr is 97.5 % of 246 rpm (239.85 rpm, the 1973 test and App B value); the ICS variant runs at 100 %. Panel Nr % is referenced to 246 rpm.
- The pre-AMCS variant is the 1972 AHRE "ICS" aircraft (66-8834) of USAASTA 72-08.
- The pilot flies from the **rear** seat (the standard configuration); the front seat is the copilot/gunner's swivelling station.
- The engine is labelled T64-GE-716, with the 3925 shp transmission limit as the cap.
- The pilot panel is reconstructed from the report text, because no rear-panel photo was found.

## Source hierarchy and cache

Retrieved 21 October 2026. There is no flight manual: the POMM 55-1520-222-10 operator's manual (1971/1973) was not found. The **three USAASTA Army test
reports** are the controlling documents for limits, configuration tables and handling targets. Each one carries an Aircraft Description and a Flight Control
Description appendix and the safety-of-flight release (SoF) that set that test's limits. **Each report describes a different configuration; do not mix
their tables.** Cite printed pages (paragraph numbers for AD0905910, whose OCR pages are unreliable).

Downloads, OCR text and the manifest (`MANIFEST.txt`, SHA-256 prefix and bytes) live under the session work directory `work/rigid/sources/`. They are not in git.
Copy them to worker worktrees. Do not commit PDFs or photographs. The full numbers-with-cites record is `work/rigid/research-ah56.md`.

| Cached file | Primary document / use | Download |
| --- | --- | --- |
| `lockheed/AD0771914.clean` | **USAASTA 72-08, Attack Helicopter Evaluation, June 1972** (66-8834, ICS). App B aircraft description (pp 47–56), App C flight controls (pp 57–60), App E SoF and gauge markings (pp 64–74), App J TOW mission weights (p 144); hover/level/acceleration performance; handling data | [archive.org OCR](https://archive.org/details/DTIC_AD0771914) |
| `dtic-ad0910262/AD0910262_djvu.txt` | **USAASTA 72-44, Engineering Evaluation of the AH-56A with AMCS, March 1973** (66-8832). AMCS rotor (0° sweep, 1°53′ droop, 97.5 % rpm), AMCS gyro 1.5 slug-ft² / 26 in, control travels and forces, measured pitch/roll response, pull-up/push-over, SoF | [archive.org OCR](https://archive.org/details/DTIC_AD0910262) |
| `lockheed/AD0905910.clean` | USAASTA 70-02/71-17, APE I and RDAT I, March 1972 (66-8834 / 66-8831, ICS). T64-GE-16 configuration; **torque gauge calibration (100 % = 3435 shp, 114 % = 3925 shp)**; APE 1.1/1.2 gauge markings; cockpit shortcomings; 1971 configuration deltas | [archive.org OCR](https://archive.org/details/DTIC_AD0905910) |
| `lockheed/ADA007953.clean` | Hohenemser, AGARDograph 197 (1974): development history (50.4 → 51.2 ft, 17,060 → 18,300 lb, 130 → 195 ft²), AMCS model and response figures, pitch-flap/pitch-lead couplings | [archive.org](https://archive.org/details/DTIC_ADA007953) |
| `ntrs-19740026394/` | Anderson & Johnston (Lockheed), regressive in-plane mode stability, 1974: Hop/roll mode frequencies, AMCS tip-weight removal | [NTRS](https://ntrs.nasa.gov/citations/19740026394) |
| `ge-t64-datasheet/` | GE T64 data sheet AE-44610: T64-100 4330/4090/3810 shp, SFC, 720 lb (used as the rating ladder ESTIMATE for the -716) | [GE](https://www.geaerospace.com/sites/default/files/datasheet-T64_1.pdf) |
| `secondary-wikipedia/` | Wikipedia AH-56 (Jane's 1969–70 spec box, Landis & Jenkins history, survivors) and T64 pages; **secondary** | [WP](https://en.wikipedia.org/wiki/Lockheed_AH-56_Cheyenne) |
| `commons-photos/` | Wikimedia Commons reference photos, licences in research-ah56.md §14. NASA Ames tunnel views (PD); Fort Campbell 66-8831 profile (CC0); Army Aviation Museum 66-8832 AMCS (CC BY 2.0, James Emery); turret drawings (PD) | [Commons](https://commons.wikimedia.org/wiki/Category:AH-56_Cheyenne) |
| (other session) `…/work/pcmd/sources/md500/nasa-cr-3144/` | Heffley CR-3144, AH-1G loading summary (p 120), used to scale the inertia ESTIMATES | already cached |
| `lockheed/ntrs-19710028118/` | **NASA CR-114362** (Watts, London & Snoddy, Lockheed, May 1971), *Trim, Control, and Stability of a Gyro-Stabilized Hingeless Rotor at High Advance Ratio and Low Rotor Speed*: Appendix A (the eight-DOF rotor-gyroscope-body equations: the gyroscope's stationary-axis terms, swashplate springs and dampers, rotating feathering damping), Appendix C (the gyro precessive "control mode" and the effect of swashplate springs and dampers). Downloaded for stage 2 (AG) | [NTRS](https://ntrs.nasa.gov/citations/19710028118) |
| `lockheed/AD0675445.clean` | Lentine et al., XH-51A compound maneuverability (USAAVLABS TR 68-23): the XH-51A gyro (7.5 slug-ft²) and response times 0.15 s roll / 0.25 s pitch, the check of tau = Lambda I / H | [archive.org](https://archive.org/details/DTIC_AD0675445) |

## Resolved installation facts

- **Configuration split.** The ICS and AMCS aircraft differ in more than the gyro:

  | | ICS 1972 (pre-AMCS variant) | AMCS 1973 (default) |
  | --- | --- | --- |
  | Rotor speed | 246 rpm (100 %), 660 ft/s | **239.85 rpm (97.5 %)**, 643 ft/s |
  | Blade sweep / droop | 4° / 3°10′ | **0° / 1°53′** |
  | Gyro | **45 slug-ft², 9.7 ft**, on the head, feathering-moment feedback | **1.5 slug-ft², 26 in**, below the transmission (S); irreversible servos, sliding spatial lever and spring flapping feedback |
  | Collective range | 0°30′–18°30′ | **4.5–20.8°**, indicated scale +7° ("13° ≙ +6° ICS") |
  | Cyclic travel long × lat | 11.0 × 7.5 in | **9.9 × 5.8 in** |
  | Pedal travel | 6.75 in | 6.4 in |

  [ASTA-72 pp 48–60; AMCS-73 pp 21–30]
- **Rotation and anti-torque.** The tail rotor is on the **left** stabiliser tip, thrust inboard, clockwise viewed from the left. The main rotor is therefore
  **counter-clockwise from above** (INF: left yaw on engine failure, left pedal with collective [ASTA-72 paras 39, 68]). The prop turns counter-clockwise
  viewed from behind. The right wing has +1°06′ more incidence and a 1° trailing-edge-down deflection to offset prop-torque roll.
- **Seats and controls.**
  - Pilot **aft** (floor ≈ FS 170); CP/G forward (≈ FS 124–130), in a swivelling station with a periscopic sight.
  - Boosted cyclic with force-feel, with a 4-way coolie-hat trim on the grip.
  - Collective head: the **prop twist grip forward, an identical-shaped engine-condition grip (OFF/IDLE/RUN) behind it**, and a thumb directional-trim switch.
  - Collective friction is mechanical plus an electric brake.
  - Also in the cockpit: Nf beeper and a sensitive ALTERNATE Nf switch; tail-wheel lock lever; gear handle; rotor brake; parking brake (AMCS); butterfly canopies
    opening to the side; boarding over the right sponson.
- **Engine and limits.** The T64-GE-716 is rated 4330 shp (1972) or 4275 shp (1973). The **transmission is limited to 3925 shp = 114 % torque**, and 100 % =
  3435 shp at 100 % Nf. Gauge limits:
  - TIT 740 °C max continuous; 740–770 °C 30 min; 770–780 °C 10 min; 785 °C inspection.
  - Ng idle 58–72 %, run 63–100 %, 101.5 % red.
  - Nf 95/98–105 %, overspeed cut-off 113 %.
  - Nr power-on 95–105 %, power-off 85–110 %.
  - Transmission oil 70–110 psi; hydraulics 2800–3400 psi (systems 1, 1A, 2).
  - Fuel flow 103–1720 pph; low-fuel light at 390 lb.

  The torque, TIT, Ng, Nf and Nr gauges are **rectangular tape gauges** [ASTA-72 p 30]. Do not reuse the 250-C20B or PT6 limit sets.
- **Drivetrain.** A single fixed-ratio shaft, no pilot-selectable clutch: **prop 6.98 × MR, TR 5.03 × MR** (D from 1717/1238/246 rpm; the AMCS rpms agree).
  The reflected inertias give MR 9748 + 1000 = 10,742 slug-ft² equivalent (published). The engine power turbine at 13,600 rpm (S) makes it **55.3:1 to the MR** (ESTIMATE).
  The Army assumed a 90 shp transmission loss. The rotor brake is used below 40 % Nr with the engine off.
- **Propeller system.** Hamilton Standard 3-blade, 10 ft, AF 142.
  - Blade angle −12 to +40.8° in flight (design −17.2°). Hover detent −2.2°. Autorotation +8°.
  - Twist grip 130–140° for 52.8–58° of blade angle, non-linear: 3:1 near 35–40° and 2:1 near −10…−5°. Blade angle creeps down above 33°.
  - **Delta-beta** automatically cuts β to +18° on torque/g loss (−7/−8.5° from reverse). The pilot must take it on to +8°.
  - Power is very sensitive to β above +28°.
- **Gear.** **Conventional tail-wheel layout, fully retractable.**
  - The mains retract into the sponsons.
  - A full-swivelling, lockable 5.00×4 (100 psi) tail wheel retracts into the ventral fin.
  - Lock the tail wheel for take-off and landing and above 20 kt taxi; unlock it for turns.
  - Gear speed limit 130 KCAS. Gear up at ≈ 95 KCAS, down at ≈ 120 KCAS.
  - Wheel brakes plus reverse thrust; aft cyclic on the ground is prohibited.
- **Augmentation.**
  - ICS: pitch desensitizer (0 gain ≤ 100 kt → full at 170 kt; doubles the stick; ±0.757 in); pitch/roll decoupler (110 → 200 kt; 30 °/s saturation); roll
    compensator (1 Hz, ±0.329 in, 16/32 Hz notches, hover–80 KCAS); lift/roll decoupler; bobweight 9 lb/g.
  - AMCS: bobweight; airspeed-scheduled longitudinal trim "stability augmentor"; sideslip lateral SAS (0 → full at 40–60 kt; 0.5 in at 12.5°).

## Geometry contract

Stations are inches in the Lockheed system. FS increases aft, WL increases upward, BL is measured from the centreline. **The datum origin is not given.** Imperial source values take
precedence. A future `src/aircraft/ah56/dimensions.ts` should cite each group.

| Quantity | Source value | Source / treatment |
| --- | --- | --- |
| Main rotor | 51.23 ft (R 25.617 ft); 4 blades; hub (fixed-hub flange) FS 300.0, WL 165.3; shaft 0°; precone 2° | ASTA-72 p 48 (**P**); 50.4 ft was the original design (Hoh-74) |
| MR blade | chord 28 in theoretical (27.5–27.89 in); NACA (4.6)3012 mod root → (0.6)3006 mod tip; twist −5°; σ 0.1159; 4° sweep and 3°10′ droop (ICS) / 0° and 1°53′ (AMCS); MR polar inertia 9748 slug-ft²; Lock 6.4 | **P**; ν_β 1.10–1.15, ν_ζ 1.4–1.6 /rev **ESTIMATE** |
| Gyro | ICS 45 slug-ft², 9.7 ft, cant 33°, input rotation 36°, ±15°, 278/337 ft-lb/in, 4100 ft-lb/rad; AMCS 1.5 slug-ft², 26 in, tilt +10.11/−18.05° pitch, 12.27 R / 18.08 L | **P**; AMCS gains **gap** |
| Tail rotor | 10 ft, 4 blades, teetering, chord 14 in, σ 0.297, δ3 37.5°, pitch −7.4…+24.2°; hub FS 658.5, WL 114.5, BL 72.0 L; arm 29.88 ft; 1238 rpm | **P** |
| Propeller | 10 ft, 3 blades, hub FS 675.7, WL 114.5, BL 0; 1717 rpm; 13.98 slug-ft² | **P** |
| Wing | 195 ft², span 26.7 ft (tip BL 160.2), AR 3.66, MAC 7.6 ft, ¼-MAC FS 308.2, λ 0.50, Γ 5°; root 9.74 ft / tip 4.87 ft (**D**); t/c 12 → 8 %; incidence 11°52′ L / 12°58′ R (datum unstated); twist −3° | **P**; incidence plausible by lift check (research §7) |
| Horizontal stabiliser | 31.83 ft² (L 16.25 bobtailed / R 15.58), span 10.83 ft, ¼-MAC FS 637.2, incidence 2°, 0012–0018 sections; right TE 2.8° down | **P** |
| Ventral fin | 24.6 ft², WL 37.6–114.5 (span 6.41 ft), ¼-MAC FS 620.3 WL 79.4, NACA 0018; root 4.84 / tip 2.84 ft (**D**); no dorsal fin | **P** |
| Envelope | fuselage 54 ft 8 in; height 13 ft 8.5 in | **S** (Jane's); nose ≈ FS 20–40 and ground ≈ WL 15–20 **3V/ESTIMATE** |
| Gear | tail-wheel, retractable; track ≈ 5 ft 2 in (pivot-radius reading, **D**); mains at FS 268 (stage 2: the Fort Campbell left and Rucker right side photos put the main wheels 30–35 in ahead of the mast; **3V**), tail wheel ≈ FS 640 in the fin tip; tyres 11 in / 6.75 in rolling radius (**3V**, 5.00×4 tail **P**) | **P** layout; positions **3V** |
| Turrets | nose turret (XM51 40 mm / XM53 7.62 mm); belly turret XM52 30 mm at FS 190, 21 in ground clearance | **P**; shapes from PD Army line drawings **3V** |
| Stores | 4 wing pylons at BL 70 / 117; 2 fuselage (tank) pylons; stores ΔFe 2 ft² at 110 KTAS → 6 ft² at 200 KTAS | **P** |
| Occupants | pilot (aft) ≈ FS 170 floor; CP/G ≈ FS 124–130 | **P** sensor stations; eye points **ESTIMATE** |
| Mass | production empty 12,874 lb; OWE 14,712; TOW mission 18,750 (2000 lb fuel); design 18,300; max 20,500 (ICS) / 19,200 (AMCS); CG FS 296.4 mid, 298 ± 1 (AMCS) | **P** (ASTA-72 App J p 144; AMCS-73 p 37) |
| Inertia | Ixx 8,000, Iyy 42,000, Izz 37,000, Ixz 2,000 slug-ft² at 18,300 lb | **ESTIMATE** (AH-1G Heffley k scaled by length 1.226, kx raised for wing) |

Shapes of the nose, canopy frames, sponsons, engine intake/exhaust, tail cone and gear fairings are **3V/photo estimates**. The best side view is the Fort Campbell CC0 profile
(66-8831, ICS head). The AMCS head (no gyro X on top) is shown by the CC BY 2.0 Army Aviation Museum photos of 66-8832.

## Performance and handling evidence for the next worker

**Performance:**
- **V_H 194 KTAS** in the TOW configuration (18,750 lb, SL std, 5° collective) at the **3925 shp transmission limit**; cruise 158 KTAS [ASTA-72 para 14].
- The AMCS aircraft flew 215–220 KTAS level and 245 kt in a dive (Hoh-74 P; Landis & Jenkins S).
- Raising collective from 3 to 7° *reduced* power required in the tested speed range.
- Hover ceilings:
  - 18,750 lb: IGE 11,800 ft, OGE 8500 ft std; 6800 / 3850 ft at 95 °F.
  - 20,500 lb: 9300 / 6000 ft std; 4650 / 1500 ft at 95 °F.
- Acceleration 0 → 188 KTAS: 0.09 g average, 107 s. Deceleration 196 KTAS → hover: 0.31 g, 33 s, < 4000 ft.
- Autorotation ≈ 2200 fpm at 95 KCAS and 19,700 lb.
- Jane's: climb 3000 ft/min, 20,000 ft ceiling and 1063 nmi range (S only).

**Calibration targets (AMCS default) [AMCS-73 paras 33–41]:**
- Pitch **6 °/s per inch** (9 °/s² per inch), about constant hover–180 KCAS.
- Roll **16 °/s per inch** (60 → 53 °/s² per inch), on 9.9 × 5.8 in of travel.
- Pull-up from 180 KCAS reaches 1.75 g at ≈ 1 s and 2.43 g at 2.1 s, losing ≈ 30 kt with pitch ≤ 30°.
- Push-over from 165 KCAS reaches 0.28 g at 2.5 s.
- Positive, linear stick-fixed and stick-free maneuver stability; slightly positive speed stability at 100 and 180 KCAS.
- Trimmed lateral stick ≈ 0.5 in left at 190 KCAS; 13° collective above 80 KCAS.
- Directional stability is weak below 100 KCAS and side-force cue is poor below 120 KCAS (the Army's remaining deficiency).
- Hohenemser adds 9 → 6 °/s/in in pitch from 0 to 200 kt, 13 °/s/in in roll, 1 in/g at 200 kt, and trim within 1 in from 0 to 200 kt.

**Calibration targets (ICS variant) [ASTA-72 paras 25, 45–65]:**
- Full-stick roll rate 77 °/s right but only 42 °/s (122 KCAS) or 49 °/s (152 KCAS) left.
- Pitch response falls between 121 and 152 KCAS, and is slow above 170 KCAS.
- Maneuver stability goes neutral above 1.3–1.4 g. A **moment-stall uncommanded pitch-up and right roll at 1.4 g/122 KCAS and 1.5 g/154 KCAS** (HQRS 10).
- Transition trim shifts at 19,500 lb: 1.1 in left lateral, 0.7 in forward longitudinal, 2.3 in right pedal; the aircraft rolls right, pitches up and yaws left.
- The hover sits ≈ 5° left-wing-low; pitch attitude is adjustable with prop β.
- Do not make successive cyclic stirs above 0.5 Hz.

**Engine-failure behaviour [ASTA-72 paras 66–68]:**
- Cues: left yaw, a drop in rotor noise, slight right roll.
- Delta-beta stopped at ≈ +24° in test. Without manual β reduction, Nr reached **68 %** on a 123-KCAS climb entry.
- The critical control is collective at 60 KCAS, both controls at 120 KCAS, and **prop β at 188 KCAS**.

**Audio (D):**
- MR blade passage 16.4 Hz (16.0 at 97.5 %).
- Prop 85.9 Hz and TR 82.5 Hz, which gives a ≈ 3 Hz beat.
- Advancing-tip Mach 0.885 at 194 KTAS, rising to 0.91 at 220 KTAS (AMCS rpm).
- 8/rev vertical vibration at the pilot seat floor reached ≈ 0.4 g.
- FLAWS tones and a voice warning system.

## Stage 2: how the sources were used (AG)

- **The gyro equation** is CR-114362 App A's stationary-axis gyroscope reduced to precession (the antisymmetric 2 Omega_G I_G term; the swashplate springs
  and dampers diagonal in the stationary axes, App A pp 211-231; rotating "feathering" damping C_R in the rotating axes, App A p 211). App C's finding that a
  swashplate spring makes the gyro's precessive mode PRECESS (its frequency falls through zero as rpm falls) is why G1 is read as a precession rate K/H and
  a circle centre M/K, not a first-order lag (docs/control-gyro-model.md).
- **AMCS-73 paras 33-34 define the response numbers**: "control response (maximum angular velocity per inch of control displacement) and sensitivity
  (maximum angular acceleration per inch)". Longitudinal 6 deg/s/in and 9 deg/s^2/in, "approximately constant throughout the airspeed range"; lateral 16
  deg/s/in, 60 deg/s^2/in at the hover to 53 at 180 KCAS. Para 35: pitch-roll cross-coupling "encountered during ICS testing ... virtually eliminated with
  the AMCS". The AMCS stick moments and K_R were fitted to these (and to Hohenemser's 9 deg/s/in at the hover).
- **The AMCS tilt stops** (App C p 29) are read as blade cyclic (SSL gain 1): forward 18.05 > aft 10.11 and left 18.08 > right 12.27 is a cyclic rigging
  pattern, and a gain of 10 would give 100-180 deg of cyclic (plan G5a).
- **The 28 ft-lb feather-bearing friction** (ASTA-72 App C) is flown as CR-114362's rotating damping (its describing-function equivalent at a 5 deg cyclic
  amplitude), not as a Coulomb dead band.
- **The main gear station** moved from the scaffold's FS 285 to FS 268 (3V, the two side photos): at FS 285 the mains were 13 in ahead of the CG and
  braking above 0.17 g would tip the aircraft onto its nose.
- **The Lock number 6.4** (Hoh-74, AMCS) is matched about the shaft with the blades' own share of the P rotor polar inertia (88 %; the hubs are the rest).

## Scaffold boundaries

Nothing here implies a calibrated Cheyenne rotor or gyro:
- **The AMCS gyro's drive speed and gains** (rotor feedback gain, negative spring, lag τ) are not published in anything found. The stage-2 gyro block is
  tuned to the measured AMCS responses above (the stick moments and K_R; docs/control-gyro-model.md "AMCS fit"); its momentum is fixed at the ICS value.
- The ICS gyro numbers are complete enough for a physical model of the switchable variant.
- **Estimates and gaps (research-ah56.md §16):**
  - Estimates: airframe inertias, flap and lag frequencies.
  - Gaps: internal fuel capacity; gear positions and strokes; T64 Ng/Nf rpm; the n–V and V_NE figures (only text values: 1.43 g at 190 KCAS ICS, 0.25–2.5 g AMCS); rotor/prop power split;
    the rear-panel layout.
- The wing, the pusher on the rotor shaft and the delta-beta/twist-grip prop control are compound-stage behaviour (stages 3–4). Do not express them through
  the fixed-wing aero path (it replaces rotor loads) or through `externalDrive` (it zeroes the rotorcraft prop) without the planned changes.
