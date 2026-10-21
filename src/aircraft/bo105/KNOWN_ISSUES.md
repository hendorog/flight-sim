# MBB Bo 105 CB-4: known issues

Owner: BO (flight model package). Ordered by pilot impact, with the test that tracks each (an `it.fails` row turns red
when a later change closes it). Numbers are measured on the definition (2200 kg mid-CG unless stated); the calibration
record is `docs/bo105-flight-model.md`. Other packages hand their entries over in PR text; the integrator adds them.

## Flight model

1. **Control travels are fitted, not rigged.** No rigging data was found (MM ch 103 not obtained). The travels are fitted
   to AGARD AR-280's control derivatives taking "%" as % of FULL travel (an assumption): longitudinal 13.4 deg of blade
   cyclic, lateral 8.25 deg, pedal 16.7 deg of tail-rotor pitch, collective 19.2 deg. Consequences a pilot sees:
   - the 120 KIAS trim sits 0.44 of the longitudinal travel forward of the hover's. The row was re-sourced at the
     flyability pass (2026-10-22) from the plan's ESTIMATE 0.20-0.35 (then a KNOWN TRAVEL GAP) to 0.40-0.60 (F/D) and
     passes: NASA CR-3144 (F: Heffley 1979, the analytical BO-105C, section III) trims 5.49 deg forward of its hover at
     120 kt against its own 10 deg rig, 0.549 (0.409 on the model's 13.43 deg). CR-3144's rig is the only one found:
     longitudinal 10 deg, collective 14, pedal 16 (the model's fitted 16.74), lateral printed ".28 deg/%" (probably .08,
     the model's 0.0825); its mid-CG trims span 9.1 of the 10 deg, so its hover sits at least 0.82 of the travel from
     the forward stop, further aft than the sim's 0.754: the hover stick is not moved toward centre (a centring re-rig
     would need about 17 deg and +27 % on the AR-280 M_lon fit). Its 80 kt control derivatives per % of its own full
     travels agree with AR-280 on all four controls (M_lon 0.126 / 0.093, L_lat 0.226 / 0.185, N_ped 0.069 / 0.049,
     Z_col -0.349 / -0.349): the first external support for "% = % of full travel" (docs section 4);
   - the envelope needs 12.0 of the 13.4 deg (9.4 forward at 145 KIAS aft CG, 2.6 aft in 20 kt rearward flight at forward
     CG): the stops are placed (AGENT) to leave 5.2 % at each end, not the plan's 10 % for rearward flight (KNOWN TRAVEL
     GAP; CR-3144's rig is at least as tight, 0.45-0.9 deg spare at its mid-CG trim extremes); the hover stick sits about 0.25 of the travel aft of centre (0.757 of the travel from the forward stop at
     2200 kg IGE, 0.773 at 2500 kg);
   - quick stops (pilot review, 2026-10-21; 2200 kg mid-CG, height held within 11 ft): from 80 KIAS with a 20 deg flare
     the stick reaches +0.544 on the -1..1 axis (0.772 of the travel from the forward stop), leaving **22.8 %** of the
     travel to the aft stop (mast moment 2.1 kN m, NR 101.0 %); from 100 KIAS with a 25 deg flare **13.7 %** is left (NR
     106.5 % with the collective dumped); a 30 deg flare from 80 KIAS meets the aft stop near zero ground speed with the
     nose high. Holding a 30 deg flare at 80 KIAS at speed needs only +0.30 (35 % margin): the stop is met as the speed
     bleeds off (W/probes/pilot-bo handling and extra probes);
   - the lever is not the hub stiffness alone: raising it (the polar inertia, which scales the equivalent-hinge moment)
     cuts the cyclic needed for the CG offset (145 KIAS aft CG 9.41 -> 9.27 deg at 925 kg m^2) but raises M_lon per % by
     6 % (0.0933 -> 0.0990), so the M_lon fit would shorten the travel to about 12.7 deg and leave less room, not more
     (item 19, docs/bo105-flight-model.md section 4). What is unsourced is where the stops sit and the blade cyclic per %
     of travel;
   - the lateral stop (about 4.1 deg each way) caps the hub moment a pilot can make on a slope, which set the mast-moment
     marks (item 6);
   - 100 % NR in autorotation at 2500 kg / 75 KIAS takes 0.08 of the collective's travel (plan 0.15-0.35;
     `bo105Performance` KNOWN COLLECTIVE-RANGE GAP).
   If the owner's "%" is another unit, the travels scale with it and these rows move.
2. **AEO climb is too strong** (`bo105Performance` KNOWN CLIMB GAP): 2,107 ft/min at 2200 kg and 1,637 at 2500 kg at
   2 x 86 %, 60 KIAS, SL (plan 1,575 +/-20 % and 1,150-1,400). The OEI climb (+31 / +315 ft/min at 2500 / 2200 kg), hover
   torque, Vy (60 KIAS) and maximum cruise (130 KTAS) sit inside their bands. Re-examined at the pilot review
   (2026-10-21; docs/bo105-flight-model.md section 8), **no Bo 105 parameter closes it, and the power required is not the
   cause**:
   - the power required matches the one Bo 105 power-required curve in the sources (S: Kerler et al. ERF 2012 Fig 1,
     after Kessler's TUM lecture; digitised): at 2300 kg the model needs 444 kW in the OGE hover (source 426), 256 kW at
     60 KIAS (232), 275 / 333 / 433 / 500 kW at 80 / 100 / 120 / 130 KTAS (266 / 344 / 449 / 508). The bucket is 10 %
     ABOVE the source, not below it;
   - the model turns 83 % of the excess shaft power into climb (7.6 ft/min per kW at 2200 kg: 45 ft/min per % torque per
     engine). The CB-5 chart (F: 1,900 ft/min at 2200 kg, 1,380 at 2500 kg) and Jane's (S: 1,575 ft/min, quoted beside
     the 2,500 kg maximum mass in the Bo 105 CB data block) over the source's power curve imply 60-72 %;
   - the plan's 2200 kg rows cannot both pass by moving the power required: the AEO band's top (1,890 ft/min) needs +4.8 %
     per engine at the bucket, the OEI band's floor (+300 ft/min, now +315) allows +0.3 %;
   - sweep (2500 kg OGE torque held at 82.7 % by refitting inducedFactor): profileCd 0.011 (inducedFactor 1.067) gives
     a bucket of +1.8 % per engine, AEO 2,022 / 1,569, OEI +225 / -41 ft/min (2200 kg OEI out of band), 127.8 KTAS,
     autorotation NR 104.8 %; profileCd 0.012 (1.039): +3.0 %, AEO 1,965 / 1,524, OEI +165 / -89, 126.4 KTAS, NR 103.2 %
     (out of band). dragArea.z x 1.5 (the download): hover +1.7 %, bucket 0.
   Closing it needs a climb-efficiency mechanism in the rotor core (RC) or restated bands (architect): Jane's 1,575 ft/min
   plausibly belongs to 2,500 kg, where the model is +4 % from it. **Flyability pass (2026-10-22; gate finding 5, the
   pilot reviewer's "about 10 % strong at 2200 kg", rated nice):** against the CB-5 chart (F, Type 2 blades, itself
   optimistic for a CB-4) the model is +11 % at 2200 kg (2,107 against 1,900 ft/min) and +19 % at 2500 kg (1,637 against
   1,380); it turns 83 % of the excess shaft power into climb against the 60-72 % the sources imply over Kessler's power
   curve. Restating the band to the CB-5 chart +/-15 % (1,615-2,185 ft/min at 2200 kg) would pass it, but the model
   exceeds even the optimistic chart and the tolerance would swallow that: **not taken; the row stays `it.fails` and the
   band is the architect's call.** No Bo 105 parameter closes it (the OEI floor allows +0.3 % of bucket shift).
3. **Hover derivatives against the flight-identified hover** (`bo105Derivatives` hover rows, re-sourced at the
   flyability pass, 2026-10-22). The hover rows are now against Kaletka & Gimonet, ERF 1995 paper VII-7, Table 1 (P: the
   DLR and CERT 6 DOF identifications of the DLR S-123 in the hover; `W/sources/bo105/erf-1995-vii07/`), with the AR-280
   envelope rule [min x 0.7, max x 1.3]. 2200 kg IGE 3 ft, SL:
   | Row | sim | ERF 1995 DLR / CERT | band | status |
   |---|---|---|---|---|
   | Lp 1/s | -12.09 | -8.54 / -10.89 | -14.16..-5.98 | pass (was the ESTIMATE -6..-10 KNOWN HOVER-DAMPING GAP: re-sourced, not loosened) |
   | Lq 1/s | +2.86 | +2.42 / +2.38 | +1.67..+3.15 | pass |
   | Mq 1/s | -3.27 | -2.32 / -1.79 | -3.02..-1.25 | KNOWN HOVER MISS (ROTOR/INFLOW) |
   | Mu 1/(s m) | +0.088 | +0.043 / +0.058 | +0.030..+0.076 | KNOWN HOVER MISS (ROTOR/INFLOW) |
   | Mp 1/s | -0.762 | -1.105 / -1.9 | -2.47..-0.774 | KNOWN HOVER MISS (at the edge, 1.5 %) |
   | Mw 1/(s m) | -0.005 | +0.051 / +0.059 | +0.036..+0.077 | KNOWN HOVER MISS (sign; stabiliser / fuselage ESTIMATEs, item 15) |
   | Nv 1/(s m) | +0.0003 | +0.096 / +0.066 | +0.046..+0.125 | KNOWN HOVER MISS (no hover weathercock; tail rotor / fin ESTIMATEs) |
   | Nr 1/s | -0.54 | -0.974 / -1.10 | -1.43..-0.68 | item 20 |
   | Zw 1/s | -0.275 | -0.295 / -0.251 | -0.38..-0.18 | pass |
   | L_lat rad/s^2 per % | 0.189 | 0.171 / 0.196 | 0.120..0.255 | pass (was ESTIMATE 0.13-0.24) |
   | M_lon | 0.0815 | 0.0719 / 0.0724 | 0.050..0.094 | pass (was ESTIMATE 0.065-0.12) |
   | N_ped | 0.042 | 0.0477 / 0.0474 | 0.033..0.062 | pass |
   | Z_col m/s^2 per % | -0.287 | -0.238 / -0.23 | -0.31..-0.16 | pass |

   The excess on-axis Mu, Mq and Lp (and Lv -0.35 against -0.21 in Heffley's analytical BO-105C, NASA CR-3144, S) is RC's
   harmonic inflow on this stiff hub: the moment feedback (L22 / L33) is a damper that supplies the identified rate
   cross-coupling (Lq / Mp: with the inflow off -0.13 / +0.03) and raises Lp / Mq; the L31 wake-skew gradient's flap
   response gives Lu +0.35 and Mv +0.09 1/(s m) (the Helisim-type model's pattern too, S) and doubles Mu. No Bo 105 knob
   reaches them: inertia, nu and the control phase are pinned by the 80 kt fit (item 19). The one measured variant that
   brings Mu inside the band is the L31 gradient x 0.5 (Mu 0.065, doubling 3.6 s): a shared-core parameter with no
   classical coefficient behind it, **a note for RC, not done**. The identified hover Xu / Yv (-0.345 / -0.131) are an
   order above any model's (the paper's own caveat on the hover velocity reconstruction) and are not used. Plan section
   4's "the hover inflow gradient cuts roll damping" was the control response (hub moment per cyclic -7..-13 %), not the
   rate damping: measured, the gradient raises Lp (-8.8 with the harmonic inflow off, -12.1 on), as RC's docs say.
4. **Rotor/inflow limits carried from the rotor core** (RC docs section 10): Zw -0.68 1/s against the envelope's -0.70
   edge (a climb-rate settling time of about 1.5 s against DLR's 1.0 s after a collective step); the rate cross-coupling
   ratio Lq/|Lp| 0.19 against 0.25-0.50 (Lq +2.1 and Mp -0.52 1/s are inside their own bands). `bo105Derivatives` KNOWN
   MISS rows.
5. **Pedal step sideslip** (`bo105Handling` KNOWN SIDESLIP GAP): a 10 % pedal step at 80 KIAS peaks at 8.3 deg/s in 0.5 s
   and the yaw rate is under 3 deg/s by 2 s, as the plan asks, but the sideslip settles near 4 deg, not 5-8 (Nv 0.136
   1/(s m), inside the AR-280 envelope but above DLR's 0.117; the fins are not a knob).
6. **Mast-moment marks are AGENT/ESTIMATE**: LIMIT 15.5 kN m, yellow from 0.5 of it (7.75 kN m; the plan's 6.2 ratio),
   set from the plan's rows as measured: slope landings at 2200 kg peak at 14.4 kN m (15 deg left-down) and 14.3 (8 deg
   right-down) with LIMIT off (top third of yellow, above 12.9), 16.7 (20 deg left-down) with LIMIT on; a full lateral
   reversal at 80 KIAS 13.3 kN m (yellow). Every steady trim in the legal envelope reads green: level flight 3.4 / 4.8 kN m
   at 130 / 145 KIAS mid CG, 5.6 / 6.9 kN m at the 2200 kg aft CG limit (6.0 at 2400 kg aft, 145 KIAS), 2.9 kN m in a
   forward-CG hover; a smooth 2.5 g pull at 100 KIAS 3.1 kN m and a steady 60 deg turn 1.8 kN m (green). **Pilot review
   (2026-10-21)**: the yellow had been at 0.17 (2.6 kN m), which put ordinary cruise in yellow (mid CG from about 119
   KIAS, aft CG from 60 KIAS) while the 2.5 g pull read less than 130 KIAS level flight; the needle follows the
   TPP-to-shaft tilt (hub moment), not g. The plan's ESTIMATE row "a 2.5 g pull reaches yellow" was restated to "stays
   green" (AGENT; `bo105Handling` mast-moment rows). In flap terms (D): the hub moment per radian of TPP-to-shaft flap is
   (B/2)(e M_beta Omega^2 + K_beta) = 2 x (0.590 x 50.03 x 1976 + 8,685) = 134 kN m/rad, 2.34 kN m/deg, so **LIMIT is
   6.6 deg of equivalent flap** and yellow starts at 3.3 deg; the plan's estimate was LIMIT at about 16-17 deg (about 40 kN
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
   torque = T100 x (3 - 2 N2)); touchdown is gentle (0.6 m/s at 2.1 s). **Flyability pass (2026-10-22; gate finding 7,
   rated nice):** the pilot reviewer's second pass (W/probes/pilot-bo2 `oei.log`; engine 2 failing in a 3-10 ft IGE
   hover, with a cushion) read the survivor at **114.6-139.9 % torque at NR 78.5-90.7 %**, at its 104.8 % N1 stop and
   810 C. That is free-turbine behaviour: the gas generator at its stop and the power turbine's torque rising as N2
   droops, T = T100 x (a - (a - 1) N2) with a = `stallTorqueRatio` 3 (ESTIMATE, the MD 500E's value): x1.10 at 95 % NR,
   x1.20 at 90 %, x1.30 at 85 % (a ratio of 2: x1.05 / 1.10 / 1.15, but ground idle then falls to 51.8 % NR against
   P5's "about 60 %", so 3 is kept). The CB-4's limit is 95 % OEI with no transient allowance in the pages read (P5 FM
   2-9); the 105 % / 110 % OEI ratings belong to the FS 72E retrofit only (P TCDS footnote d). No change; pilot note
   (the single-engine-failure checklist): "an OEI cushion overtorques the survivor as NR droops: cushion late and only
   as much as needed".
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
17. **The hover is unstable hands-off, as the real Bo 105's is; the plan's own gate shot crashes without the aids**
   (re-sourced at the flyability pass, 2026-10-22). The real aircraft: in the DLR hover identification flight "a few
   seconds after the input signal was started a diverging response in the lateral directional motion (roll and pitch)
   was seen ... he had to retrim the helicopter after about 14 seconds as the roll attitude had reached about 45 degrees
   and the yaw rate was more than 20 degrees/second"; "all hover flight tests were flown with additional stabilizing
   pilot inputs" (P ERF 1995 VII-7, pp 2-3). Its Figure 13 (6 DOF, DLR and CERT) puts the hover phugoid in the right
   half-plane at about sigma +0.20..+0.25 rad/s, omega_d 0.50..0.55 rad/s (doubling about 2.8-3.5 s, period 11-13 s),
   with the markers spanning sigma +0.1..+0.4, omega_d 0.4..0.7 (doubling 1.7-7 s, period 9-16 s): read off a small
   printed plot. The sim (`bo105Derivatives` hover-modes row, trace keys `hoverModes`, `hoverPhugoid`), 2200 kg IGE 3 ft:
   sigma +0.308, omega_d 0.51 rad/s (**doubling 2.3 s, period 12.3 s**), inside the band on its fast side; 2500 kg at
   16 m (the hover scenario) doubling 2.3 s, period 11.6 s. ADS-33E-PRF Fig 7 (P) places both the sim and the identified
   aircraft at Level 3 (sigma > 0.139 rad/s, doubling under 5 s). The same lateral 3211 (5 % of travel) then hands off
   reaches 45 deg of roll at 11.4 s with the yaw rate above 20 deg/s from 8 s (W/bofly/probes `hoverDlr`): the flight's
   order, on the fast side. Mechanism: the L31 wake-skew gradient's flap response on the stiff hub gives Lu +0.35 and Mv
   +0.09 1/(s m), which split the two coincident 0.51 rad/s pendulum modes (longitudinal and lateral) into one strongly
   unstable pair and one strongly stable one; the L22 / L33 moment feedback is a damper and supplies Lq / Mp.
   Comparison (2200 kg IGE; Lv, Lu, Mv are not in ERF Table 1):

   | | sim (inflow ON) | sim (inflow OFF) | ERF 1995 DLR / CERT (P) | Heffley CR-3144 (S) | Helisim-type (S) |
   |---|---|---|---|---|---|
   | Lp / Mq 1/s | -12.1 / -3.27 | -8.8 / -2.39 | -8.54 / -2.32, -10.89 / -1.79 | -9.24 / -3.40 | -14 / -4 |
   | Mu / Lv 1/(s m) | 0.088 / -0.349 | 0.046 / -0.187 | 0.043, 0.058 / - | 0.066 / -0.208 | 0.01 / -0.20 |
   | Lu / Mv 1/(s m) | +0.353 / +0.094 | -0.017 / -0.004 | - | -0.037 / -0.013 | +0.35 / +0.08 |
   | Lq / Mp 1/s | +2.86 / -0.76 | -0.13 / +0.03 | +2.42 / -1.1, +2.38 / -1.9 | +2.30 / -0.84 | - / -0.1 |
   | hover phugoid sigma / omega_d rad/s | +0.31 / 0.51 | +0.04 / 0.43 | about +0.1..0.4 / 0.4..0.7 | +0.02 / 0.42 | decoupled only |
   | doubling | 2.3 s | 17 s | about 1.7-7 s; 45 deg of roll in about 14 s | 31 s | - |

   The roll / flap mode in the hover (matrix pencil): -4.4 +/- 10.2j against the identified 9 DOF about -6 +/- 10j (DLR) /
   -7 +/- 9j (CERT). Heffley's 31 s and the inflow-off 17 s are what the flight test contradicts (no 45 deg of roll in
   30 s); `harmonicInflow: false` is therefore not a fix (it would also lose the hover Lq / Mp and the 80 kt Lq row).
   **Plan section 10 gate shot** (`index.html?aircraft=bo105&hover=1&cam=chase&resume=0&run=20`, 2500 kg, 16 m, 8 kt of
   wind, hands off) at `03ec6e1`: after 20 s roll 53.5 deg, crashed (main rotor strike) (W/shots/BO/bo105-hover.png): the
   sourced behaviour, kept. Two ways to fly the hover scenario: the hover hold `&ap=1` hands off (after 20 s pitch +3.5,
   roll 3.0 left, torque 80.6 / 80.6 %, TOT 738 C; heliHold position RMS 0.07 m calm, 2.3-2.5 m in 8 kt gusts, no
   disconnect), and the STAB ASSIST sim aid on the keys (default ON on the Bo 105, Shift+A for the raw aircraft; section
   "Flyability pass").
   **Pilot review (2026-10-21)**: a delayed test pilot (attitude gains 1.2 per rad and 0.6 per rad/s, the state read tau s
   late; 2200 kg IGE, calm 15 s then an 8 kt side gust; W/probes/pilot-bo `hover`, `extra2`, `tune-inflow`) holds the raw
   hover up to tau 0.5 s and loses it at 0.6 s (23 s); at half the attitude gain it is lost at every tau, in calm air too
   (tau 0: 43 s; 0.75 x gain holds within 0.3-1.1 m). The MD 500E on the same pilot holds at half gain to tau 0.4 s. That
   is where a first-time keyboard pilot sits, hence the assist.
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
   cross-check against Padfield's Bo 105 data before the inertia is touched again. Inertia sweep at the pilot review
   (2026-10-21; Lp / roll mode / M_lon per % / autorotation-entry NR minimum with a 1 s delay at 100 KIAS):
   850 kg m^2 -10.67 / 10.85 / 0.0933 / 73.1 %; 925 -12.04 / 12.06 / 0.0990 / 74.7 %; 950 -12.50 / 12.45 / 0.1008 /
   75.2 %; 1000 -13.42 / 13.20 / 0.1044 / 76.1 %. Every step above 850 puts Lp and the roll mode outside their AR-280
   envelopes (-11.41, 11.04) and M_lon outside its +/-5 % fit; the sourced Lock number (F METU Table 9: 5.54, about 840
   kg m^2 at a = 6.0) supports 850. Kept (item 22).
20. **Hover yaw damping is half the identified value; hover pedal turns are strong** (`bo105Derivatives` KNOWN HOVER MISS
   Nr; re-examined at the flyability pass, 2026-10-22). Hover Nr -0.537 1/s (2200 kg IGE) against the flight-identified
   -0.974 (DLR) / -1.10 (CERT) (P ERF 1995 Table 1; band -1.43..-0.68); N_ped 0.042 per % is inside (0.0477 / 0.0474).
   So the pilot reviewer's "pedals 3x too sensitive" is wrong on control power and right on feel: a 10 % pedal step
   (attitude held) reaches 36.4 deg/s at 3 s and is still rising (50.9 at 8 s, tau 1.86 s); with Nr about -1.0 it would
   settle near 23 deg/s by 3 s. Where the model's hover Nr comes from (W/bofly/probes-fix `yaw`, quasi-static,
   rotor states re-settled): tail rotor alone -0.43, the main rotor's yaw-rate coupling (`yawInRotorSpeed`) -0.08, the fin
   -0.03 (its tail-rotor blockage `tailRotorFlow` +0.03), the fuselage 0, the tail rotor's Pitt-Peters inflow 0 (it
   settles in milliseconds). **Momentum theory does not support more from the tail rotor** (D): with the hover tail
   thrust 1,335 N, lambda_i 0.0625, a sigma 0.688, Omega R 222 m/s, the settled-inflow derivative dT/dVa =
   rho A Omega R (a sigma / 8) / (1 + a sigma / (16 lambda_i)) = 39 N per m/s (Padfield's hover Zw form), Nr_tail = -39 x
   5.94^2 / 4099 = **-0.34 1/s**: the model's -0.43 is already 27 % above it. (The judge's plan R2 used a sigma / 4, which
   doubles it to 78 N per m/s and -0.68; with the inflow frozen, a sigma / 4 without the inflow factor, it would be 132
   N per m/s and -1.14, close to the identified value; the tail inflow time constant is about 10 ms, so the frozen case
   does not apply.) Heffley's analytical BO-105C (NASA CR-3144, F) has hover N'r -0.33 and 80 kt -0.53 against the
   flight's -0.86 / -1.07 at 80 kt: the analytical models sit at about half the identified yaw damping at both speeds.
   One-probe sweep of the per-definition knobs (80 kt at 3000 ft, the AR-280 condition; constraints: 80 kt Nr in
   -1.39..-0.60, Nv 0.057..0.152, N_ped 0.049 +/-30 %, Dutch roll 2.5 rad/s +/-30 % zeta 0.05-0.30, hover N_ped
   0.033..0.062):

   | Variant | hover Nr | hover N_ped | 80 kt Nr | 80 kt Nv | 80 kt N_ped | Dutch roll rad/s, zeta |
   |---|---|---|---|---|---|---|
   | as built | -0.537 | 0.042 | -1.241 | 0.136 | 0.049 | 2.70, 0.18 |
   | tail lift slope 6.3 (2D NACA 0012) | -0.554 | 0.045 | -1.285 | 0.144 | 0.053 | 2.76, 0.19 |
   | tail root cut-out 0.10 | -0.539 | 0.042 | -1.255 | 0.139 | 0.049 | 2.72, 0.18 |
   | fin lift slope 1.5 | -0.537 | 0.042 | -1.130 | 0.116 | 0.050 | 2.55, 0.17 |
   | tail lift slope x 2 (11.4, unphysical) | -0.656 | 0.060 | **-1.577** | **0.193** | **0.076** | 3.12, 0.22 |
   | the same, pedal range / 2, fin slope 1.0 | -0.656 | 0.030 | **-1.421** | 0.164 | 0.039 | 2.93, 0.20 |

   No per-definition set reaches the band: even a doubled tail-rotor lift slope moves the hover only to -0.66 (the
   settled inflow absorbs most of it) and breaks the 80 kt Nr / Nv / N_ped rows. **Kept as built (the plan's fallback);
   the row stays a KNOWN HOVER MISS.** The keyboard pilot gets the identified damping through the STAB ASSIST's yaw-rate
   term (0.3 of the pedal axis per rad/s: about -0.63 1/s more, D: N_ped 0.042 per % x 50 % per unit x 0.3; Nr about
   -1.17 with it on, inside the ERF band; flyability pass section in "Integration"). A full pedal step in the IGE hover
   (2200 kg) peaks at 165 deg/s right and 129 deg/s left (90 deg/s reached in 0.93 / 1.46 s) against the FM's 90 deg/s
   turn-rate limit; the test asserts only >= 90 deg/s within 3 s. Per keyboard tap the Bo 105 is already the gentlest
   of the five helicopters (a 0.5 s tap: 7.0 deg/s at 3 s against 13.8-35.4 on the others), so the pedal keys are not
   slowed. **Round 2 (2026-10-22, the round-1 pilot gate):** with the non-centring pedal keys the rate damping alone left
   a steady turn after every pedal tap and a swing on every collective tap (a 0.3 s F6 tap: 84 deg in 8 s). The STAB
   ASSIST now holds the heading once the pedal keys rest (docs section 9; 0.3 s collective taps +/-1.3 deg, a 0.5 s
   pedal tap settles 2.3 deg round), inside the same 6.5 % of pedal travel, so the physics' Nr miss above is unchanged
   and a 0.6 s collective tap (0.26 of the pedal axis) still swings the nose.
21. **The mass envelope's 1140 kg minimum is unreachable**: the TCDS minimum (P, facts.ts) sits 136 kg below this
   airframe's empty mass (1276 kg, S Jane's CB), so the CG envelope's 1140 kg point is data only; the lightest rig case is
   1400 kg. A CB-4 weighing record would settle it.
22. **Autorotation entry leaves little NR margin for a slow hand** (pilot review, 2026-10-21; W/probes/pilot-bo
   `tune-inertia`). Both levers OFF at 100 KIAS, 2200 kg (2 x 54.6 %), the pilot holding speed: collective lowered at once
   over 1 s: NR minimum 84.4 % at 2.9 s (over 0.5 s: 87.4 %); 0.3 s reaction then 0.7 s: 82.2 %; held 0.5 s then lowered
   over 1 s: 78.1 %; held 1.0 s: 73.1 % (below 90 % at 0.6 s, 85 % at 1.0 s; 100 % again at 5.6 s, overshoot 110.9 %);
   1.5 s: 69.3 %; 2.0 s: 66.7 %. At 120 KIAS: 82.3 / 74.6 / 69.1 % after 0.5 / 1.0 / 1.5 s; at 60 KIAS with 1 s: 81.1 %;
   2500 kg within 1 % of these. The double-engine-failure decay row (collective held at 120 KIAS: 95 % at 0.22 s, 85 % at
   0.73 s) is inside its D bands. The energy is consistent (840 kJ in the rotor at 850 kg m^2 against 325 kW, a decay
   of about 19 %/s), so the polar inertia is the only parameter, and it is held at 850 by the sourced Lock number and
   the AR-280 rows (item 19: 925 kg m^2 would lift the 1 s case by 1.6 % NR). The rest is technique: lower the collective
   within about 0.5 s. Owner judgement on the rotor's feel. **Flyability pass (2026-10-22; gate finding 4):** the
   laptop-specific loss was the keyboard collective (0.12 of the travel per second: 2.9-3.7 s to full down from 100-120
   KIAS, 6-23 % of NR against a hand). Shift+F5 / Shift+F6 now lower / raise it at 1.0 / 0.5 per second
   (`collectiveFastRate`); bare F5 / F6 stay the fine hover keys. Through the InputSystem, both levers OFF at 100 KIAS,
   attitude held, the key held after the delay: 0.5 s 80.7 % (bare F5 71.3 %), 1 s **75.1 %** (69.0 %), 2 s 68.0 % (67.2
   %); at 120 KIAS 1 s **78.1 %** (58.9 %). The tone starts at 0.30 s (100 KIAS) / 0.23 s (120). After a 2 s delay the key
   rate hardly matters (the NR has already fallen to about 75 % when the pilot reacts): the judge's "4 points above
   bare F5 at 2 s" was set against an estimated 63 % for bare F5; measured, bare F5 gives 67.2 %. The physics and the
   inertia are unchanged; the double-engine-failure checklist note and the hints carry the technique (Shift+F5 at once,
   75 KIAS, flare at 6-10 ft and Shift+F6 to cushion). No automatic collective (the FM's checklist is the pilot's).
   **Round 2 (2026-10-22, the round-1 pilot gate): the entry stop.** Held to the floor, Shift+F5 overspun the rotor past
   the power-off limit (110 %, P5 FM 2-8): 118 % at 100 KIAS, 126 % at 120 KIAS. The sim's steady 75 KIAS autorotation
   with the collective full down runs at 110 % NR at 2200 kg and 117 % at 2500 kg (W/bofly/r2 `autoSteady`): the FM's
   "collective fully down, keep NR within limits" asks for some collective at the heavy end. Shift+F5 now stops at 0.08
   of the travel (about 97 / 102 % NR steady); bare F5 goes on down. Held after the failure at 100 KIAS the NR peak is
   108.6 % (15 deg flare to 70 KIAS); from 120 KIAS a 10-15 deg flare still reaches 112-117 % (2500 kg: up to 126 %), the
   flare's energy, which the pilot meets with the collective. **Cost, recorded:** the round-1 NR minimum at 120 KIAS with
   the entry attitude held falls from 78.1 to 72.6 % (bare F5 58.9 %; 100 KIAS 75.1 -> 74.2 %): with the nose held the
   speed runs to 130 KIAS, where 0.08 holds the rotor back. A dip to the floor and back up to the stop keeps 78.1 % but
   overspeeds again in the flare (114-125 %); no fixed stop does both, and an NR-following collective would be an
   autopilot. The powerFailure checklist's collective item ticks at 0.1 or below with NR in the limits.

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
- **Fixed-wing trim cue under the hold** (legacy `src/ui/status.ts:226-235`; the Bo 105 exposes it): with `hover=1&ap=1`
  the HUD control box shows "Yoke held back: trim nose up (End)" in both Bo 105 runs at 20 s. The MD 500E does not show
  it on the same URL. Two legacy rules combine:
  - the cue counts the hold autopilot as the pilot (`othersFlying` covers only the demo and the instructor);
  - the cue's direction reads the absolute elevator, not the offset from the keyboard neutral.

  The hold flies the Bo 105 at elevator 0.333 against a spring-trim anchor of 0.459. The 8 kt wind trims the stick
  forward of the zero-wind reset trim, so the stick sits 0.126 forward of the neutral. The cue still says "held back",
  because the elevator is positive. The MD 500E sits 0.025 from its anchor (0.398 against 0.423), under the 0.04 threshold.
  **Fixed at look gate 1** (a look-review item, against plan section 2.5 item 5, which kept legacy rules out of scope;
  the change is UI only, no physics): `src/ui/uiSystem.ts` counts an engaged autopilot or hover hold among
  `othersFlying`, and `src/ui/status.ts` reads the direction (and the 0.04 threshold) from the keyboard yoke's offset
  to its neutral and words the cue for the cyclic on every helicopter ("Cyclic held aft: trim aft (End)"). The Bo 105
  under `hover=1&ap=1` shows no cue at 20 s (`W/shots/bo105-gate-1/bo105-hover-ap.png`); `tests/ui/trimCue.test.ts`.
- **`summary().engines[1].propRpm`** reads engine 2's output-shaft rpm (6156) rather than the rotor's 425. It has two
  readers: the muted engine-2 prop voice, and the propeller visual, which the Bo 105 does not have. No visible or
  audible effect.

### Flyability pass (2026-10-22, branch `rigid/bofly`; W/bofly/fix-plan.md, report W/bofly/fix-report.md)

The owner has no helicopter experience, flies a laptop and asked us to go with the recommendations on flyability and
control sensitivity. Physics first: the hover rows were re-sourced to the flight-identified hover (ERF 1995, P; items 3,
17, 20), which shows the sim's hover divergence is the real Bo 105's; no physics changed (nothing under
`src/physics/rotorcraft/`, and `bo105/rotorcraft.ts` only in a comment). Flyability through the control path, Bo 105
only, each labelled:
- **STAB ASSIST** (`src/sim/rotorcraft/stabilityAssist.ts`): a sim aid (the CB-4 has no SAS), default ON, Shift+A for the
  raw aircraft, `stab=0` / `stab=1` in the URL; docs section 9 has the law and the numbers. **Owner decision flagged:**
  the default is one line in `bo105/input.ts` (`stabilityAssist.default`).
- Shift+F5 / Shift+F6 hand-rate collective (item 22); the 5-key centring at 1 travel per second and Shift+5 keyboard trim
  here (item 1); the helicopter control box (`BO105_UI.controlBox`; gate finding 6).
- **Shared files touched** (owners: TW for `src/input/**`, the sim for `src/sim/**`, UI for `src/ui/**`): `input/profile.ts`
  (optional fields `stabilityAssist`, `collectiveFastRate`, `centreRate`, `setTrimHere`), `input/bindings.ts` (Shift+A,
  Shift+F5 / F6, Shift+5 / Shift+Num 5, profile-gated through `actionForKey`'s fallback), `input/InputSystem.ts`,
  `input/virtualYoke.ts` (`stepCentre`'s rate argument, default 4), `sim/SimPhysics.ts` (the assist around the flight
  model's step, built only when the profile has one), `sim/Simulator.ts`, `sim/params.ts`, `aircraft/types.ts`
  (`UiProfile.controlBox`), `ui/status.ts`, `ui/styles.ts`, `ui/uiSystem.ts`. The R22 / R44 / S269 / MD 500E legacy digests
  are bit-identical (35/35) and their control box is unchanged; their TRIM 0 % and missing F5 / F6 in the box are an
  owner call, not fixed here.
- Not done, recorded: the L31 inflow gradient x 0.5 (Mu inside the ERF band, doubling 3.6 s) is a shared-core note for
  RC; the AEO climb band is the architect's (item 2); nudge-to-reposition under the hover hold is a shared Simulator /
  autopilot change for every helicopter (owner decision).

#### Round 2 (the round-1 pilot gate's follow-ups; probes W/bofly/r2, logs `out/`)

- **Heading hold** in the STAB ASSIST (item 20; docs section 9): the heading is captured when the pedal keys rest and held
  through collective taps and gusts, inside the round-1 yaw authority (6.5 % of pedal travel); full below 20 KIAS, gone
  at 30. Limit: a 0.6 s collective tap needs twice that authority. The 1 s roll-tap row changed meaning: round 1's
  "bank held" came from the nose weathercocking 84 deg into the sideward drift; with the heading held the drift's airflow
  rolls the bank back (9.4 deg at 3 s, 2.5 at 8 s; the row now asserts the 3 s bank, no reversal, and the yaw under 50
  deg). The hover hint was reworded.
- **Datum on a decelerating approach** (docs section 9): the cyclic datum relaxes toward the flown attitude while the
  airspeed falls and the pilot is flying the stick (one e-fold per 2 kt); hands off or speeding up it does not. In the
  hover after a 45 KIAS deceleration the series term is 2.5 % of travel and the stick at the hover trim within 0.05
  (round 1: 10 %, 0.2 forward).
- **Pedal term on unloading skids** (`groundYawLoad` 0.5): simple and safe (it only damps / holds the yaw, no integral on
  the ground), but small: the hover wants 21 % of pedal travel left of the runway start's centred pedal, three times the
  authority (lift-off yaw 9.0 deg/s against 10.6). The hint says pedal with the collective.
- **Shift+F5 entry stop** 0.08 (item 22), with the NR-minimum cost at 120 KIAS recorded there.
- **Shared files touched:** `src/core/types.ts` (`ControlInputs.pedalWorked`, optional, set only for a profile with a STAB
  ASSIST; the flight model ignores it), `src/input/profile.ts` (optional `kpsi`, `kpsiI`, `datumRelaxKt`,
  `groundYawLoad`, `collectiveFastRate.downStop`), `src/input/InputSystem.ts` (the stop; the flag). Every other type
  leaves them absent.

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
- From the right seat the A-post, its lining trim and the door-window rubber cover about 5 deg of the view to the right
  at eye height (look gate 1; 10-12 deg at gate 0; docs/bo105-exterior.md known issue 8). Owner's judgement.
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
- The mast-moment marks (item 6: LIMIT 15.5 kN m, yellow from 0.5 of it since the pilot review, so that steady flight in
  the legal envelope reads green) and the stabiliser slope 3.0 (item 15, chosen to bring Mw to its band edge).
- The control-travel rigging offsets (item 1), the ground attitude 1.25 deg nose-up (P5 FM Fig 1-1's 1.5 deg dimension
  read as nose-up), the keyboard aileron key (baseRate 0.07, maxRate 0.35, accelTime 1.5: a 1 s tap at 80 KIAS gives
  about 11 deg of bank 2 s after the release).
