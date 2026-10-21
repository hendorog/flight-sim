# MBB Bo 105 CB-4: known issues

Owner: BO (flight model package). Ordered by pilot impact, with the test that tracks each (an `it.fails` row turns red
when a later change closes it). Numbers are measured on the definition (2200 kg mid-CG unless stated); the calibration
record is `docs/bo105-flight-model.md`. Other packages hand their entries over in PR text; the integrator adds them.

## Flight model

1. **Control travels are fitted, not rigged.** No rigging data was found (MM ch 103 not obtained). The travels are fitted
   to AGARD AR-280's control derivatives taking "%" as % of FULL travel (an assumption): longitudinal 13.4 deg of blade
   cyclic, lateral 8.25 deg, pedal 16.7 deg of tail-rotor pitch, collective 19.2 deg. Consequences a pilot sees:
   - the 120 KIAS trim sits 0.44 of the longitudinal travel forward of the hover's (plan 0.20-0.35;
     `bo105Handling` KNOWN TRAVEL GAP);
   - the envelope needs 12.0 of the 13.4 deg (9.4 forward at 145 KIAS aft CG, 2.6 aft in 20 kt rearward flight at forward
     CG): the stops are placed (AGENT) to leave 5.2 % at each end, not the plan's 10 % for rearward flight (KNOWN TRAVEL
     GAP); the hover stick sits about 0.25 of the travel aft of centre;
   - the lateral stop (about 4.1 deg each way) caps the hub moment a pilot can make on a slope, which set the mast-moment
     marks (item 6);
   - 100 % NR in autorotation at 2500 kg / 75 KIAS takes 0.08 of the collective's travel (plan 0.15-0.35;
     `bo105Performance` KNOWN COLLECTIVE-RANGE GAP).
   If the owner's "%" is another unit, the travels scale with it and these rows move.
2. **AEO climb is about a third too strong** (`bo105Performance` KNOWN CLIMB GAP): 2,110 ft/min at 2200 kg and 1,640 at
   2500 kg at 2 x 86 %, 60 KIAS, SL (plan 1,575 +/-20 % and 1,150-1,400). The OEI climb (+30 / +315 ft/min at 2500 / 2200
   kg), hover torque, Vy (59.5 KIAS) and maximum cruise (130 KTAS) sit inside their bands: the power required at the bottom
   of the bucket (about 42 % per engine at 60 KIAS, 2200 kg) is about 18 % below what the CB-5 chart's AEO climb implies,
   and no listed knob moves it without moving the hover torque.
3. **Hover roll damping above the ESTIMATE band** (`bo105Derivatives` KNOWN HOVER-DAMPING GAP): hover Lp about -12.1 1/s
   (roll time constant 0.083 s) against -6..-10. With the harmonic inflow on, the hover roll damping rises by about the
   quasi-steady theory's 1/1.51 (RC docs section 8); at 80 kt Lp (-10.7) and the roll mode (10.9 1/s) are inside their
   AR-280 bands. **No Bo 105 hover derivatives in the sources used**: Bo 105 hover identification results exist and were not
   obtained (research-bo105 section 18 gap 3: Fu & Kaletka JAHS 1993 and the DLR/AFDD ERF 1989 paper, DTIC ADA216828; the
   assessor also points to Kaletka / von Grünhagen, unverified), so every hover handling number is unvalidated until one
   is. Note for the architect: plan section 4 says the hover inflow gradient "cuts" roll damping; measured on this
   definition it raises it (2200 kg IGE: Lp -8.8 with the harmonic inflow off, -12.1 with it on), as RC's docs say.
4. **Rotor/inflow limits carried from the rotor core** (RC docs section 10): Zw -0.68 1/s against the envelope's -0.70
   edge (a climb-rate settling time of about 1.5 s against DLR's 1.0 s after a collective step); the rate cross-coupling
   ratio Lq/|Lp| 0.19 against 0.25-0.50 (Lq +2.1 and Mp -0.52 1/s are inside their own bands). `bo105Derivatives` KNOWN
   MISS rows.
5. **Pedal step sideslip** (`bo105Handling` KNOWN SIDESLIP GAP): a 10 % pedal step at 80 KIAS peaks at 8.3 deg/s in 0.5 s
   and the yaw rate is under 3 deg/s by 2 s, as the plan asks, but the sideslip settles near 4 deg, not 5-8 (Nv 0.136
   1/(s m), inside the AR-280 envelope but above DLR's 0.117; the fins are not a knob).
6. **Mast-moment marks are AGENT/ESTIMATE**: LIMIT 15.5 kN m, yellow from 0.17 of it (2.6 kN m), set from the plan's rows
   as measured: slope landings at 2200 kg peak at 14.4 kN m (15 deg left-down) and 14.3 (8 deg right-down) with LIMIT
   off, 16.7 (20 deg left-down) with LIMIT on; a smooth 2.5 g pull at 100 KIAS 3.1 kN m (yellow), a steady 60 deg turn at
   100 KIAS 1.8 kN m (green), a full lateral reversal at 80 KIAS 13.3 kN m (yellow). Level flight reads 1.6 kN m at 100
   KIAS and 4.8 kN m (yellow) at 145 KIAS. In flap terms (D): the hub moment per radian of TPP-to-shaft flap is
   (B/2)(e M_beta Omega^2 + K_beta) = 2 x (0.590 x 50.03 x 1976 + 8,685) = 134 kN m/rad, 2.34 kN m/deg, so **LIMIT is
   6.6 deg of equivalent flap** and yellow starts at 1.1 deg; the plan's estimate was LIMIT at about 16-17 deg (about 40 kN
   m), which assumed a disc held level on a 15 deg slope. The fitted lateral travel (+/-4.125 deg of blade cyclic, item 1)
   caps the slope-landing hub moment near 14.4 kN m, so it set the LIMIT: **the "% = % of full travel" assumption is the
   lever** (twice the lateral travel would roughly double the slope peaks and the LIMIT with them). The hub stiffness is
   27 % below DLR's 183.7 kN m/rad (plan section 4, from AR-280; item 19). The real indicator's calibration is not
   published.
7. **OEI droop and torque** (`bo105Systems` KNOWN OEI-DROOP GAP, `bo105Performance` KNOWN OEI-TORQUE GAP): from 2 x 55 %
   in the hover with the collective held the survivor at its N1 stop (104.8 %, TOT 810 C) holds NR 96.8 % at 1 s, 96.14 %
   at 5 s, through 96 % at 16 s and 95.87 % at 24 s: up to 0.14 % above the plan's 93-96 % from 5 s to 16 s, and never
   down to 95 %, so the RPM light and the 650 Hz tone stay out; its torque peaks at 103.7 % (inside 105 %).
   **TW's `tests/rotorcraft/twinOei.test.ts` is in BO's plan section 10 guard list and its T7b row is red at BO HEAD**
   ("expected 96.12 to be less than or equal to 96"); at the merge base eb5919f it was already red on a different
   assertion (survivor torque 106.39 % at NR 94.57 %, and T7c), which this rotor and engine map fix. twinOei's rig
   (TW's `twinRig.ts`) re-spreads TW's `BO105_TURBOSHAFT_INDICATION` (datum 0.773, anticipation 0.39) over BO's refit
   (0.774 / 0.469, rotorcraft.ts), so it does not fly BO's governor rigging. The band is TW's (BO may not edit the file):
   an architect/TW decision to restate it (measured 96 +/-0.5, ESTIMATE) or record the red row as a TW exception.
   **At the integration** the rig was moved onto the definition's own governor and the 93-96 % band became an `it.fails`
   KNOWN GAP row in `twinOei.test.ts` (NR 96.12 % at 5 s, 95.81 % at 25 s; survivor 103.85 % torque, 104.80 % N1,
   810 C); the band itself is still the architect's to restate. In a 3 ft IGE
   hover at 2200 kg with a cushion, NR falls to about 91 % and the survivor reads about 114 % (the power-turbine law,
   torque = T100 x (3 - 2 N2)); touchdown is gentle (0.6 m/s at 2.1 s).
8. **The lead-lag degree of freedom is absent** (soft in-plane 0.66-0.73/rev): no air or ground resonance, no lag damper
   loads; blade elastic modes beyond the equivalent hinge and blade torsion are not modelled.
9. **CG height**: the body reference point is 0.96 m below the hub (F METU, the Theodore model), but the mass model puts
   the 2200 kg CG about 1.53 m below the hub (an ESTIMATE component breakdown, mass.ts): at 0.96 m the AR-280 roll inertia
   and the underfloor fuel cannot both hold (the fuel alone would carry two thirds of Ixx and the empty airframe's roll
   inertia would go negative at 1400 kg). The empty CG (STA 3.43 m, 1.75 m up) is not a weighing; with it the forward
   CG limit needs nose ballast, and the named 'forward' loading sits at STA 3.24 m.
10. **Autorotative descent barely grows with weight** (`bo105Performance` KNOWN WEIGHT-EFFECT GAP): with NR held at 100 %
   at 60 KIAS, 2500 kg descends within about 1 % of 2200 kg's 2,040 ft/min (plan +8 %, from sqrt(disc loading)).
11. **Performance is the CB-5's** (Type 2 blades), with the hover ceilings set about 1,700 ft lower for the CB-4
   (ESTIMATE). HOGE 3,130 ft and HIGE 6,235 ft at 2500 kg, HIGE 8,510 ft at 2300 kg (ISA, take-off power), limited by the
   105 % N1 stop. No CB-4 chart was found.
12. **Tail rotor**: delta-3 (delta-hinged hub, angle not found), rotation sense (not found) and speed (233 rad/s, F) are
   not sourced; the tail rotor has no flap degree of freedom. Its hub height (2.80 m) is 3V/D.
13. **Fuel transfer approximation**: the two main-tank transfer pumps are modelled by each feed drawing the main tank
   fifty times for each draw on the supply tank (the fuel system draws equal shares), so the supply tank still holds
   66 kg when the main tank runs dry and LOW FUEL (supply below 60 kg) comes with about 60 kg in all. Pump failures and
   the "both main pumps failed" LOW FUEL case are not modelled (a sequential draw is requested from the fuel system's
   owner).
14. **Ground idle and starts**: both levers at IDLE hold about 59 % NR on the ground (P5 FM "about 60 %"); one engine at IDLE
   about 49 %. The start, idle (64 % N1) and snap deceleration below 85 % N1 are the MD 500E's 250-C20B calibration.
   T15 (both levers IDLE -> FLIGHT over 5 s): NR 58.9 -> 98 % in **4.35 s**, inside the lever ramp, against the plan's
   10-20 s (ESTIMATE; `bo105Systems` KNOWN T15 TIME GAP); peak 101.3 %, split 2.9 %, TOT max 609 C. The T15 row asserts
   98 % within 15 s with no lower bound, mirroring TW's assessed twinOei T15; the band is an architect/TW question (at flat
   pitch the rotor needs about 240 kW to gain 9 %/s against about 513 kW available, so NR following the levers is
   plausible).
15. **Stabiliser and fuselage aerodynamics are ESTIMATES**: the stabiliser's effective lift slope (3.0 per rad, the Mw
   knob: Mw +0.040 at 80 KCAS, phugoid time to double 8.7 s) and the fuselage moment derivatives (a Munk estimate x 0.6)
   carry no measured data; AR-280's "NACA 0010/C020" profile is read as symmetric.
16. **Airspeed limits**: the OEI 100 KIAS Vne (P5 FM 2-4) is not read by the limit reader (it knows power-off only).
17. **The hover is unstable hands-off, and the plan's own gate shot crashes** (no Bo 105 hover source was used; DLR's
   hover identification exists, item 3). The 8-state hover model (`bo105Derivatives` hover-modes row, trace key
   `hoverModes`), harmonic inflow ON as flown: 2200 kg IGE 3 ft, an oscillation zeta -0.52 at 0.60 rad/s (period 12 s,
   doubles in 2.3 s), Mu +0.088 1/(s m), Lv -0.349, Lp -12.1, Mq -3.27; 2500 kg at 16 m (the hover scenario) zeta -0.49
   at 0.62 rad/s (doubles in 2.3 s), Mu +0.099, Lv -0.384. With the inflow OFF the same airframe gives zeta -0.095 at
   0.43 rad/s (doubles in 17 s; Mu 0.046, Lv -0.187, Lp -8.8) and 2500 kg / 16 m zeta -0.096 at 0.47 (15 s): the harmonic
   inflow roughly doubles Mu and Lv and makes the hover divergence about seven times faster. At 80 kt Mu is 0.046 (DLR
   0.029, AFDD 0). **Plan section 10 gate shot** (`index.html?aircraft=bo105&hover=1&cam=chase&resume=0&run=20`, 2500 kg,
   16 m, 8 kt of wind, hands off): after 20 s roll 53.5 deg, crashed (main rotor strike), NR 424.7 rpm, torque 84.2 /
   84.2 %, N1 101.2 % (W/shots/BO/bo105-hover.png); the MD 500E on the same URL is upright after 20 s (roll -5.8 deg,
   2.7 m/s drift). With the hold engaged (`&ap=1`, the app's own hover URL) it hovers: after 20 s pitch +3.5, roll 3.0
   left, torque 80.6 / 80.6 %, TOT 738 C (W/shots/BO/bo105-hover-ap.png); heliHold position RMS 0.07 m calm, 2.3-2.5 m in
   8 kt gusts, no disconnect. A hingeless hover doubling in 2-4 s is the right order for the class, but nothing is tuned
   until DLR's hover derivatives are sourced; how fast the Bo 105 diverges is the owner's judgement.
18. **Hold autopilot on the Bo 105** (TW's `sim/rotorcraft/autopilot.ts`, tuned on the other types): the heliHold
   sequence overshoots its 40 kt speed step by 12 kt and settles in 28-30 s; heading steps overshoot 6.6-9.5 deg.
19. **Rows that pass at their band edges** (no slack; owner judgement on each): 80 kt Lp -10.67 (edge -11.41), roll mode
   10.85 1/s (edge 11.04), Mw +0.040 (edge +0.037); hover IGE roll 2.97 deg left (band 1-3 left); 145 KIAS pitch -8.8 deg
   (band -6..-9); hover torque per engine 2500 kg OGE 82.7 % (79-83), 2500 kg IGE 72.0 % (72-78), 2200 kg IGE 61.8 %
   (61-69). The polar inertia 850 kg m^2 (lower edge of the fitting band) and the stabiliser slope 3.0 were chosen to reach
   these; the costs are a hub stiffness of 134 kN m/rad against DLR's 183.7 (-27 %; RC's R6 was run on its 900 kg m^2
   fixture, not on this set) and an 80 kt phugoid that doubles in 8.7 s (zeta -0.20 at 0.39 rad/s) against DLR's 14 s
   (zeta -0.15 at 0.33, P AR-280 Table 6.2.13). Ground effect sits at the strong edge too: HIGE - HOGE 3,100 ft at 2500 kg
   against the CB-5 chart's 2,350. The CG 1.53 m below the hub (item 9; METU/Theodore 0.96 m) is the first thing to
   cross-check against Padfield's Bo 105 data before the inertia is touched again.
20. **Hover pedal authority is unvalidated and strong**: a full pedal step in the IGE hover (2200 kg) peaks at **165 deg/s
   right and 129 deg/s left** (90 deg/s reached in 0.93 / 1.46 s) against the FM's 90 deg/s turn-rate limit; the test
   asserts only >= 90 deg/s within 3 s. With N_ped fitted at 80 kt (0.049 rad/s^2 per %) and hover Nr -0.54 1/s the
   implied steady rate is about 260 deg/s. No hover source; owner judgement.
21. **The mass envelope's 1140 kg minimum is unreachable**: the TCDS minimum (P, facts.ts) sits 136 kg below this
   airframe's empty mass (1276 kg, S Jane's CB), so the CG envelope's 1140 kg point is data only; the lightest rig case is
   1400 kg. A CB-4 weighing record would settle it.

## Integration (feat/rigid-rotor, Bo 105 stage 1)

- **GA consistency is green on the integration branch** after the BX and PN merges (the visual's eye point and the panel's
  145 kt red line now match the definition); it was red on the BO branch alone.
- **twinOei T7b / twinGovernor T6** (item 7): resolved at the integration by moving TW's rig onto the definition's
  governor (BO's refit), holding attitude in T6 (N2 101.93 / 98.12 % at the 102 / 98 % stops) and recording T7b's NR
  band as an `it.fails` KNOWN GAP row. See `docs/bo105-integration.md`.
- **Verifier gate 0** (`docs/bo105-integration.md` section 9): item 17 re-measured on the integrated branch.
  - Hands off, the plan readout crashes at about 19 s with a main rotor strike at 53.5 deg of roll. The hover drifts
    downwind at 4.6 m/s from the start: the scenario trims at airspeed 0 in the default 8 kt wind.
  - With `&ap=1`, a 31 s recording stays 5.4 m from the start position and holds within 2 m after 11 s.
  - The plan's `sim-record ... 12 30` covers only 6.9 s.
- **Fixed-wing trim cue under the hold** (legacy `src/ui/status.ts`, every type): "Yoke held back: trim nose up (End)" can
  show while the hold autopilot flies. The hold moves the stick away from the keyboard neutral, and `othersFlying` counts
  only the demo and the instructor. It is intermittent: seen once on a Bo 105 `hover=1&ap=1` frame. It was not seen in a
  later run or on the MD 500E.
- **`summary().engines[1].propRpm`** reads engine 2's output-shaft rpm (6156) rather than the rotor's 425. It has two
  readers: the muted engine-2 prop voice, and the propeller visual, which the Bo 105 does not have. No visible or
  audible effect.

## Handed over by other packages (added by the integrator; numbers as each package measured them)

From TW (twin drivetrain, `docs/twin-turboshaft.md`):
- The N1-split warning cannot be reset (TM 00-44 says it is resettable), so in OEI flight the RPM light and the N1-split
  beeping stay on.
- The MD 500E auto-reignition logic runs per engine: a cut engine's igniters fire while its N1 is below 55 % with
  transmission pressure. Harmless with the lever OFF, but the Bo 105 has no such system.
- With two engines sharing, each N2 governor droops less, so NR settles about 0.5 % higher than on one engine at the same
  power (T8); the pilot re-beeps.
- The OEI flag needs N1 below 55 %, about 1.4 s after a fuel cut; in between the survivor is judged on AEO limits and
  the power-limit warning can flash.
- ENGINE TRIM rate and authority (0.7 % N1/s, +/-6 %) and the 1.3 % N1 rig mismatch (a 3.6 % torque split until
  synchronised) are ESTIMATE / AGENT values; the FM gives neither.

From RC (rotor core, `docs/rotor-hingeless-model.md` section 10):
- Periodic flap damping acts once per rev and reaches the flap harmonics only through the cone: about -2 % hub moment per
  lateral cyclic at mu 0.35, not the plan's 3-9 %.
- The harmonic (Pitt-Peters) inflow is driven one way from the uniform mode: no pitch-moment feedback into the mean
  inflow, no wake-curvature (manoeuvre) terms; the blade-element thrust stays on the uniform inflow.
- The rotor's in-plane side force from the first-harmonic pitch is not resolved (H acts along the in-plane flow only).
- The non-rotating flap frequency of the Bo 105 was not found, so e = 0.12 R with the spring making up nu 1.11.

From AU (sound, `src/aircraft/bo105/audio.ts`):
- The two engines are not panned apart: the worklet's engine output is one mono channel (AGENT choice).
- No ENGINE OUT horn (AGENT choice): the warning unit replaces it.
- N1 SPLIT reuses the NR LOW tone (650 Hz at 5 beeps/s): the TM says "intermittent tone" without pitch or rate. The
  cyclic-grip RPM-warning cut-off is not modelled.
- Flown end to end the cabin sits 3-4 dB below the scripted mix window (hover -18.9 dBFS against the MD 500E's -18.1 on
  the same path; measured by AU on the S0 stub, not re-measured on the integrated rotor).

From BX (exterior and cockpit, `docs/bo105-exterior.md`):
- The skid tubes are drawn level; the physics rests the fuselage 1.25-1.35 deg nose-up (`dimensions.ts`
  `SKID_FRONT_Z`), so the drawn front toes float about 5 cm (BO's request to BX, not done).
- The drawn virtual hinge is e + L/2 = about 0.17 R, above the 12-15.2 % band; the physics hinge stays at e. The drawn
  tip is up to 2.1 cm lower than a rigid blade hinged at e at 5 deg coning.
- Hub hardware proportions, endplate split, pitot, deck intakes, louvres, exhaust stubs and cockpit furniture are
  photographic ESTIMATEs (no dimensioned drawing). The outer roof is 2.055 m (dimensions' 2.02 m read as the lining).
- From the right seat the A-post and door frame cover about 12 deg of the view to the right (owner's judgement).
- Dual controls are not fitted; the livery is generic (white, dark blue cheat line, D-HBOX) (AGENT choices).
- The tail-rotor hub (2.80 m) and fin outline follow BO's revised `dimensions.ts`; `bo105-side` / `bo105-tail` shots
  were taken by BX before that change and have not been re-rendered.

From PN (panel, `docs/bo105-panel.md` "Compromises"):
- The overhead power levers and the console / overhead switches are painted on the pedestal canvas; BX's 3D levers and
  consoles are visual only, clicks reach the controls through the canvas.
- Only the generators, supply-tank pumps, emergency valves and lights are switches; main-tank pumps, GEN TRIP / RES,
  HYDR TEST, anti-ice, pitot heat, voltmeter / ammeter and circuit breakers are not drawn (no state). HY BLOCK, FILT,
  HYD, MAG PLUG, BAT 60 / 70 light only on the lamp test.
- Dial spacing is artwork (no scale drawing); TOT and fuel dots are thin arcs; both INSTR / CONSOLE dimmers set one
  panel-light level; the STARTER / GENERATOR switch is drawn as a STARTER rocker plus separate generator switches.
- The HUD readout block (11 rows) is partly hidden by the flight-cue panel at 900 px window height.

## Owner-facing AGENT choices in this package (not owner decisions)

- The hub set: e 0.12 R, nu 1.11, polar inertia 850 kg m^2 (inside the fitting rule's band, at its lower edge; 900 put Lp
  and the roll mode outside their AR-280 bands on this airframe; costs in item 19), control phase 28 deg (least squares to
  AR-280's off-axis ratios).
- The mast-moment marks (item 6) and the stabiliser slope 3.0 (item 15, chosen to bring Mw to its band edge).
- The control-travel rigging offsets (item 1), the ground attitude 1.25 deg nose-up (P5 FM Fig 1-1's 1.5 deg dimension
  read as nose-up), the keyboard aileron key (baseRate 0.07, maxRate 0.35, accelTime 1.5: a 1 s tap at 80 KIAS gives
  about 11 deg of bank 2 s after the release).
