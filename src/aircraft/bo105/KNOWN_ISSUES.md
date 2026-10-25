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
   **Final fix round (feat/rigid-rotor):** with the hingeless rotor's in-plane force applied as a vector (it had been pointed
   along the first tiny drift in the hover, and its side component was missing in forward flight) the 2200 kg IGE hover phugoid
   reads sigma +0.278, omega_d 0.504 rad/s (**doubling 2.5 s, period 12.5 s**), still inside the ERF 1995 band on its fast side
   (was +0.308 / 0.51, 2.3 s); hover Lp / Mq / Mu / Lv unchanged (-12.09 / -3.27 / +0.088 / -0.349).
   **Pilot review (2026-10-21)**: a delayed test pilot (attitude gains 1.2 per rad and 0.6 per rad/s, the state read tau s
   late; 2200 kg IGE, calm 15 s then an 8 kt side gust; W/probes/pilot-bo `hover`, `extra2`, `tune-inflow`) holds the raw
   hover up to tau 0.5 s and loses it at 0.6 s (23 s); at half the attitude gain it is lost at every tau, in calm air too
   (tau 0: 43 s; 0.75 x gain holds within 0.3-1.1 m). The MD 500E on the same pilot holds at half gain to tau 0.4 s. That
   is where a first-time keyboard pilot sits, hence the assist.
18. **Hold autopilot on the Bo 105** (TW's `sim/rotorcraft/autopilot.ts`, tuned on the other types): the heliHold
   sequence overshoots its 40 kt speed step by 12 kt and settles in 28-30 s; heading steps overshoot 6.6-9.5 deg.
19. **Rows that pass at their band edges** (no slack; owner judgement on each; final fix round values after "->", with the rotor's
   in-plane force as a vector): 80 kt Lp -10.67 -> -9.96 (edge -11.41), roll mode 10.85 1/s (edge 11.04), Mw +0.040 (edge +0.037);
   hover IGE roll 2.97 deg left (band 1-3 left) -> **3.01 deg left, 0.01 past the band: a KNOWN GAP row in bo105Handling**; 145 KIAS pitch -8.8 deg
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
   and a 0.6 s collective tap (0.26 of the pedal axis) still swings the nose. **Round 3 (the round-2 gate):** the hold
   has its own 15 % of pedal travel (the rate damping keeps 6.5 %, so full-pedal turns are unchanged) and the keyboard
   pedals are walked to the trim: 0.5 / 0.6 / 1.0 s collective taps are back within 1.3 deg by 15 s (flyability round 3).
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
   **Tune pass 2 (2026-10-25; the round-2 gate's nice item, W/tune2/bo105 `q8_nrhigh`): the keyboard beginner's entry.**
   Both levers OFF from level flight at 600 m, Shift+F5 held from 1 s after the cut, the gate's tapping beginner holding
   the nose 3 deg up (looks every 1 s): at 100 KIAS NR peaks at 127.9 % (2200 kg; 3.6 s over 110 %) and 177.5 % (2500 kg),
   120.2 / 146.0 % with an 8 deg flare; bare F5 to the floor 149.7 / 227.6 % (the heavy one crashed). These are not the
   gate's hand pilot's numbers above (it held the attitude and slowed to 75 KIAS: 115.7 % at 2500 kg / 100 KIAS, 117.2 %
   at 120 KIAS / 2200 kg, 126.1 % at 120 / 2500): the tapping beginner lets the entry's pitch go. At 120 KIAS the dump
   (0.36 of the travel in 0.36 s) meets the collective's pitch coupling (M_col 0.089 rad/s^2 per % at 120 KCAS: about 3.2
   rad/s^2 nose down, against the series authority's 0.9 rad/s^2 in the cruise attitude hold): the aircraft bunts through -85
   deg of pitch, rolls inverted and NR runs to 195 % in the dive; of the four Shift+F5 entries at 120 KIAS (with and
   without an 8 deg flare, 2200 / 2500 kg) the two at 2500 kg crashed. The NR HIGH tone (108 %, 2600 Hz)
   reaches the audio bus whenever it is on (the battery bus at 25.5 V, cut-off 18 V; no case missed it). Recorded: the
   real Bo 105 pitches the same way to a fast collective dump at speed (the coupling is sourced at 80 kt, `bo105Derivatives`), and
   the FM's entry is the pilot's (aft cyclic with the collective); a collective-to-cyclic crossfeed in the cruise hold
   would be the sim-aid answer and is not built (it needs its own gate). The engine-failure hint now says to hold
   ArrowDown about a second with Shift+F5 at cruise speed: then 0 of 4 of these crash (100 / 120 KIAS, 2200 / 2500 kg;
   1 of 4 without), NR still 120-194 % in the flare that follows (the collective is the pilot's).
   **Tune pass 2 fix round (2026-10-25; the pass-2 gate's nice item, W/tune2/bo105 `gate1/k3_dual`, `fix1/f_dual`): the
   hinted entry flown to the ground.** 2200 kg, both levers OFF at 300 m, Shift+F5 1 s later with ArrowDown held 1 s,
   then the tapping beginner (1 s looks) holding 75 KIAS: the glide is steady, 10.7 m/s down at 75 KIAS with NR 95.2 %
   (from 100 KIAS the entry costs NR to 60 % and the glide runs 13.6 m/s). No keyboard landing was found: of 121
   variants (from 75 and 100 KIAS: the beginner's flare to +15 deg from 15 / 20 / 25 / 30 / 35 / 45 / 50 m, or ArrowDown
   held 1 / 1.5 / 2 / 2.5 / 4 s; the nose levelled at 8 / 12 m or below 15 kt; Shift+F6 held from 3 or 6 m; F6 taps over
   108 % NR) every one crashed: the tapped flare comes 1-2 s late (the nose 9-20 deg up at the ground, about 10 m/s
   down), a held key over-rotates (50-85 deg; with the keyboard limit at speed since this round, 15-20 deg), and the
   best flares (ArrowDown 2 s at 45 m: 75 -> 40 kt, the sink down to 1.7 m/s at 16 m) end at 4-5 m/s with the tail
   low (hard skid, tail stinger or, with Shift+F6 from 6 m pitching the nose up, the tail rotor). The gate's 16 m hover
   double failure is inside the double-engine-failure height-velocity avoid area (P5 FM Fig 5-7, agent reading: 2100 kg
   at sea level, the top about 660 ft at 0 kt, the knee about 48 kt at about 100 ft): recorded as that, not as a gap. Its
   60 KIAS / 100 m case is outside the area, and it crashes the way the 300 m glides do (the keyboard flare). The Engine
   failure hint now says the power-off landing on the keys has not been flown in the sim's tests and gives the glide to
   practise at height. The entry re-flown at the end of the round (`q8_nrhigh`, `fix1/f_q8`): with the keyboard limit at
   speed (one press of ArrowDown at most 0.12 of the axis; the 1 s press used to reach about 0.14) the hinted 1 s press
   leaves 1 of 4 crashing (120 KIAS at 2500 kg, NR 207 % in the dive; 1.5 s the same), two presses of about 0.8 s with
   0.4 s between 0 of 4; the corner is close (without the limit the 1 s press 0 of 4, two presses 1 of 4). The hint now
   says two presses. NR still peaks at 108-209 % in the flare that follows (the collective is the pilot's).

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
- **Pedal term on unloading skids** (`groundYawLoad` 0.5; round 3: `groundLoad`, the cyclic too): simple and safe (it
  only damps / holds the yaw, no integral on the ground), but small: the hover wants 21 % of pedal travel left of the
  runway start's centred pedal, three times the authority (lift-off yaw 9.0 deg/s against 10.6). The hint says pedal with
  the collective.
- **Shift+F5 entry stop** 0.08 (item 22), with the NR-minimum cost at 120 KIAS recorded there.
- **Shared files touched:** `src/core/types.ts` (`ControlInputs.pedalWorked`, optional, set only for a profile with a STAB
  ASSIST; the flight model ignores it), `src/input/profile.ts` (optional `kpsi`, `kpsiI`, `datumRelaxKt`,
  `groundYawLoad`, `collectiveFastRate.downStop`), `src/input/InputSystem.ts` (the stop; the flag). Every other type
  leaves them absent.

#### Round 3 (the round-2 pilot gate's must items; probes W/bofly/pilot-r3, logs `out/final`)

The gate flew the keys through the InputSystem with its tapping beginner: the 3 ft hover after a runway lift-off was
lost at 18-25 s with every pedal technique, a keyboard deceleration from 45 / 30 KIAS crashed 2-10 s after the stop,
and a 0.5 s F6 tap with the pedals untouched spun the nose 180 deg. Docs section 9 has the law and the numbers; the rows
are `tests/rotorcraft/bo105KeyTransitions.test.ts` (the gate's beginner in `bo105KeyPilot.ts`) and
`bo105Assist.test.ts`.
- **Fixed:** collective taps (the hold's own authority, `holdAuthority` 0.3, and the keyboard pedals' trim follow-up:
  0.5 / 0.6 / 1.0 s F6 back within 1.3 deg by 15 s; round 2: 180 deg); the lift-off (not lost in 30 s with the pedals
  untouched or 2 s of left pedal; the cause was the skids touching in the low hover, which switched the cyclic term off:
  it now works on light skids, `groundLoad`); 5 once after a lift-off keeps the followed pedal (18 deg/s; round 2 42).
- **Still open (round 3; the tune pass closed it, below): the keyboard deceleration to the hover.** Better (the stick 0.33-0.45 at the stop against round 2's
  0.18, the hover 0.51; the stop reached more often) but lost: below 20 kt the beginner's F5 / F6 taps swing the
  collective and it lets go in an 8-12 m/s sink with the collective at 0.13-0.31 (hover 0.39). The assist never touches
  the collective. Recorded as an `it.fails` row. A below 25 kt is a way out (the hold flies on at that speed, heading and
  height without a loss; it hovers only when engaged under 3 m/s), not a way into the hover. Candidates, owner / shared
  decisions: a keyboard collective aid (a height hold on the keys below 20 kt), or a hold that decelerates to a hover
  when engaged moving (shared HelicopterAutopilot, every helicopter).
- **The gate's deceleration numbers are partly a rig artefact.** Its probes (pilot-r2 `decel`, `decelTrace`, `decel2`)
  reset the physics after attaching the input module without the `reset` event the Simulator sends, so the keyboard
  pedal stayed at the hover's -0.42 against the 45 KIAS trim's +0.18: a 30 deg/s yaw and 40 deg of heading at the start
  of every run (pilot-r3 reproduces the gate's numbers exactly that way, `b_decel.gaterig.log`). With the event, the
  round-2 law still crashed (stop 13.7 s, crash 20.1 s). Its "stop" was the body-forward ground speed, which a spin
  crosses; pilot-r3 uses the ground-speed magnitude. The lift-off and off-trim probes were not affected.
- **Recorded limits:** a pedal set with the keys (KeyZ 2 s at lift-off) is thrown away by 5 (62 deg/s, 136 deg; 5
  centres the keys on the followed trim, not on the pilot's pedal; the tune pass: 5 keeps the pedals, 12 deg/s). The gate's 1 s ArrowUp knock in the 3 ft hover is
  still lost at about 38 s: not the trim (the stick at the hover trim, the series term inside its limit) but the probe's
  own tap loop, a growing pitch / roll oscillation (-5 to +14 deg, about 4 s) that ends in the yaw. Longer F6 from the
  hover (1.5 s and more) runs past the torque limit and the left pedal stop with or without the aid. The gate's
  "energetic tapper" (0.5 s, roll taps to 1 s) crashes the deceleration at 8 s on every law, the raw aircraft too.
- **Measured, not adopted:** a collective-to-pedal crossfeed (2.5 of the pedal axis per unit of collective; the trim
  slope is about -3) held every F6 tap within 5 deg but double-compensated a pilot who pedals (2 s of left pedal at
  lift-off: -39 deg/s, the heading round). (The tune pass adopted a washed-out, airborne-only crossfeed, below.) A pedal follow-up gain of 2 rang the heading +/-12 deg after a collective tap.
- **Shared files touched:** `src/core/types.ts` (`ControlInputs.keyboardCyclic`, `keyboardPedals`, `pedalFollowUp`,
  optional, set only for a profile with a STAB ASSIST; the flight model ignores them), `src/input/profile.ts`
  (`holdAuthority`, `followUp`; `groundYawLoad` renamed `groundLoad`), `src/input/InputSystem.ts` (the flags; the pedal
  centre follows `pedalFollowUp`). Every other type leaves them absent; the legacy digests are unchanged.

#### Tune pass (2026-10-22, branch `tune/bo105`; probes W/tune/bo105, logs `out/`)

The round-3 open items, with the owner's delegation ("go with recommendations on the flyability and control
sensitivity"). Docs section 9 ("Tune pass") has the laws and every number; the rows are in `bo105KeyTransitions`,
`bo105Assist`, `tests/input/bo105Aids` and `twinGovernor` T11. No physics changed.
- **Fixed: the keyboard deceleration to the hover** (item 1). The mechanism was the beginner's collective (lagged F5 / F6
  taps: 0.14 -> 0.50 -> 0.10, torque 24 -> 94 %, the nose round at up to 66 deg/s), not the cyclic. Two STAB ASSIST
  parts on the keys: a **height hold** on the keyboard collective (ADS-33E rate command / height hold, full below 30
  KIAS, gone at 40) and a **washed-out collective-to-pedal crossfeed** on the keyboard pedals. Judged at a hover (under
  3 kt, |vz| under 1.5 m/s, within 15 deg for 2 s), the tapping beginner reaches it from 45 KIAS (taps every 1 / 2 / 3 s,
  nose 8 or 12) and 30 KIAS and, flying on, holds it 20 s; 9 of 10 probe variants (round 3: 0 of 10). And the **hover
  hold slows to a hover** when A is pressed below 30 kt (1.5 kt/s; 15.8 s from 25 kt), the Bo 105 only.
- **Fixed: the hover scenario in wind** (item 2): it starts into the wind, trimmed at the start's wind, still over the
  ground (`hoverIntoWind`); the beginner holds it 60 s within 2.9-4.0 m in 8 kt (with gusts too) and 3.2 m in 15 kt
  from behind the runway heading (before: 11.1 kt of ground speed at the start; round 2 crashed at 14-15 s).
- **Fixed: 5 keeps the pedals** (item 3; `centreKeepsPedals`): KeyZ 2 s at lift-off then 5: 12 deg/s, 11.7 deg (round 3:
  62 deg/s, 136 deg). The hint and the key label say so. In the production build the pedals are the same with and
  without the 5 (-0.540 / -0.541).
- **Fixed: resume** (item 4): the snapshot carries the assist's state (optional `assist`, like `era`: older snapshots
  restore with a fresh capture; a malformed block is dropped); `ControlInputs.pedalFollowUp` is zeroed on restore. The
  restored series command is the unbroken flight's to 2e-16 (re-captured: 0.082 of the axis); T11 runs with the assist
  on (Nr step 0.002 %, re-captured 0.25 %).
- **In-browser gates** (item 5): `check-build "aircraft=bo105&hover=1&cam=cockpit"` passes (no console errors, audio
  running); a real-key flight script (W/tune/bo105 `browser-bo105.mjs`, production build, docs section 10) flew the
  hands-off hover, `&ap=1`, `&stab=0`, an F6 tap in 8 kt and the 5 key: as in the rig. `scripts/fly-keyboard.mjs` is
  the fixed-wing keyboard circuit (take-off roll, rotation, flaps; conformance targets only for the fixed-wing types):
  it has no helicopter pilot, and its id parser reads only the `AIRCRAFT_IDS` literal, so `fly-keyboard bo105` took
  `bo105` for the output directory and flew the Cessna 172S (stopped; the stray directory removed). With
  `aircraft=bo105` as a URL parameter it loads the Bo 105 on the runway and its fixed-wing pilot never raises the
  collective (0 %, 18 % torque, 0 kt): no lift-off, timed out at 420 s (W/tune/bo105 `out/browser/flykb-bo105`). Not a
  Bo 105 gate; recorded for the script's owner (a helicopter pilot for it would be new work), not changed here.
- **Item 6, AEO climb** (item 2 above): unchanged; nothing in this pass touches the physics and no sourced parameter
  closes it.
- **Restated rows** (behaviour descriptions the new aids changed, not sourced bands): the 1 s roll tap's bank is back to
  level at 8 s (-0.01 deg; round 2-3: 2.5, "stays on the tapped side"), restated as "not past level by more than 1 deg"
  with the heading band tightened from 50 to 10 deg (measured 3.0); the round-1 / round-2 contrast rows of the
  collective taps run without the new aids (with them even those laws hold the heading); the series-term row flies both
  hover starts (into the wind the walk is 0.034 of the axis in 5 s; with the air 0.0002, inside round 3's 0.02); the
  collective-tap peak band tightened from 25 to 6 deg (measured 2.0-4.1).
- **Open (closed in tune round 2, below): KNOWN DRIFT GAP** (`bo105KeyTransitions` it.fails): the beginner letting go at the hover drifts past 30 m in
  10.5 s (attitude 5.9 deg, not crashed): the STAB ASSIST holds attitude, not position (ACAH, not ADS-33E's
  translational rate command); the hold (A) holds position. A position-holding sim aid on the keys is the next step if
  the owner wants let-go hovering without A.
- **Recorded limits (tune round 2 below closed the held F5, the F6 torque and the side gust, and the 60 KIAS case is no
  longer lost):** the deceleration from 60 KIAS with 1 s taps is lost at 12.6 s with or without the aids (above
  their 40 KIAS band: the beginner's own flare). The tapped hover through an 8 kt side gust (calm 15 s then the gust;
  round-2 gate "nice" item) is lost later (by drift at 53.6-55.8 s, not crashed; one of four not lost) than without the
  new aids (34.9-44.7 s, two crashed): the heading goes round in the side wind (`n_gust.log`). F5 held down from 16 m
  still lands hard (5.9 m/s); the hint says land in F5 taps (0.48 m/s at touchdown). Holding F6 for seconds from the
  hover still passes the maximum continuous torque (the pilot's key; the hold never raises above it): 87 / 90 / 94 / 99 %
  for 1.5 / 2 / 3 / 5 s (round 3: 107 / 113 / 125 / 144 %), the nose within 8-19 deg (round 3: round from 2 s).
- **Owner-facing choices (AGENT, on the owner's delegation):** the height hold's band is [30, 40] KIAS, not the plan's
  "below about 20 kt" ([20, 30] reached the hover in 2-4 of 10 decelerations, [30, 40] in 6-9); below 30 KIAS a held
  collective key behaves close to a climb-rate command and a released one holds the height (a tap is a height step, a
  descent to land is F5 taps); the crossfeed reverses round 3's "measured, not adopted" on new evidence (washed out over
  3 s, airborne only, off while a pedal key is held: the round-3 case, 2 s of left pedal at lift-off, now 25 deg against
  round 3's 21, where the always-on crossfeed gave -39 deg/s); the hold slows to a hover below 30 kt (above, it holds the
  speed); the hover start faces the wind; 5 leaves the pedals. Each is one line in `bo105/input.ts` or `bo105/sim.ts`.
- **Shared files touched:** `src/sim/rotorcraft/stabilityAssist.ts` (the height hold, the crossfeed, export / import),
  `src/sim/rotorcraft/autopilot.ts` (`slowToHover`, null unless set), `src/sim/SimPhysics.ts` (the snapshot's
  `assist`, `hoverIntoWind`, `slowToHover` from the profile, `pedalFollowUp` zeroed on restore), `src/sim/resume.ts`
  (optional `assist`), `src/input/profile.ts` (`centreKeepsPedals`, `heightHold`, `pedalCrossfeed`),
  `src/input/InputSystem.ts` (5 leaves the pedals with `centreKeepsPedals`; `keyboardCollective` / `collectiveWorked`
  on a type with a STAB ASSIST), `src/core/types.ts` (`ControlInputs.keyboardCollective`, `collectiveWorked`, optional),
  `src/aircraft/types.ts` (`SimProfile.heliHoldSlowToHover`, `hoverIntoWind`, optional), `tests/rotorcraft/twinGovernor.test.ts`
  (T11 without its workaround). Every other type leaves them absent: the legacy digests are unchanged (17/17).

#### Tune round 2 (2026-10-22, branch `tune/bo105`; probes W/tune/bo105 `r2/`, logs `r2/out`)

The round-1 pilot gate (5/10, W/tune/bo105 `gate1/`) found three flows in which the keyboard beginner still crashed.
Docs section 9 ("Tune round 2") has the laws and every number; section 10 the production-build flights. No physics
changed.
- **Fixed: letting go at the hover** (gate issue 1, must). The STAB ASSIST held the attitude it was let go at; the
  deceleration's left a sideways slide that crashed 41 s later. A **translational rate command** on the keyboard cyclic
  (ADS-33E TRC; `translationalRate`) leans the datums against the ground speed and walks them to the zero-ground-speed
  trim once the keyboard stick rests: let go after the deceleration, 60 s within 10.6 m (round 1: past 30 m in 10.5 s,
  crashed at 41 s); a 1 s / 0.3 s ArrowUp knock back to a hover within 27.7 / 3.4 m (490 / 65 m). The KNOWN DRIFT GAP row
  is a passing 60 s row. A mouse yoke or hardware stick keeps the attitude command.
- **Fixed: holding F5 to descend** (gate issue 2, must): a bare F5 / F6 held airborne is a **climb-rate command**
  (`heightHold.held`: the key's move taken back, the lever walked to 2 m/s, the sink slowing to 0.7 m/s near the ground,
  the lever stopped at the power limit and backed off while F6 stays held). F5 held from 16 m and from 3 ft touches down
  at 0.44 m/s (crashed at 5.9 m/s; 2.2 m/s); F5 held 4 s then released is caught at 7.9 m (crashed); F6 held 5 s peaks
  at 86.2 % torque against the 86 % AEO limit (118.6 %). Shift+F5 / Shift+F6 stay raw (no longer damped either).
- **Fixed: cruise on the keys** (gate issue 3: the hints, must; "either owner" should): the hints route the beginner
  through A ("press A between 30 and 45 kt", G, T, back below 30 kt with A to the hover) and a **cruise attitude hold** on
  the keyboard cyclic (`cruiseHold`) keeps the attitude command / attitude hold above the 30-50 KIAS fade. The gate's
  tapping beginner at 60 / 80 / 100 KIAS: 0 of 15 cases crashed in 60 s (10 of 15 at 14-52 s without it). The A route is
  a row (lift-off, by hand to 35 kt, A, a heading-bug turn, A off, A to the hover, land with F5 held; calm and 6 kt).
- **Fixed: the let-go row** (gate issue 4): now 60 s and passing, as above.
- **Wind deceleration rows** (gate issue 5): a beginner who looks at the ground below 8 kt reaches the hover from 45 KIAS
  with 6 kt from ahead and behind (10 of 10 of the gate's wind variants); the gate's own wings-level beginner reaches it
  into the 6 kt wind (7 of 10 variants, round 1: 3). **Open: KNOWN TAILWIND GAP** (`bo105KeyTransitions` it.fails): the
  wings-level beginner in a 10 kt tailwind with 1 s taps pirouettes (up to 73 deg/s) and reaches no hover by 60 s (15.7
  kt at the end); with 2 s taps it does (33.7 s). Its 1 s pedal taps keep the heading hold from capturing while the fin
  weathercocks it; the hints say to hover into the wind. A counter-pedal variant of the heading hold (a pedal key
  against a swing keeps the held heading) was measured and not adopted (4-5 of 10 against 6, `p5b_c*`).
- **Fixed: the crossfeed on light skids** (gate issue 6, should): it pedals the lift-off's collective unless a pedal
  key was worked on the skids: the untouched lift-off's first 6 s 38.2 deg (59.7 airborne only), the 2 s left-pedal
  lift-off unchanged at 24.1. Over the whole 30 s with the skids brushing the ground (the row's beginner holds the
  lift-off height) the heading scatters 40-140 deg across 12 beginner variants with or without the round-2 parts (the
  row's 83.6 / 30.9 deg; tune pass 76.4 / 25.2): a recorded limit of the skid-brushing hover, not of the lift-off.
- **Engine-failure hint** (gate issue 8, nice): Shift+F5 within about a second; the height hold stops with an engine.
- **No change needed: hoverIntoWind's wind time** (gate issue 10, nice): a reset restarts the clock at 0 and fm.reset
  samples the wind at 0, so a later hover start faces the wind it is trimmed in (the comment says so; a row resets a
  second time after 60 s of gusts: ground speed 0).
- **Recorded limits:** the 1 s tapper above about 110 KIAS still loses control with the cruise hold (120 KIAS: the
  attitude through 180 deg, not crashed in 60 s; 140: crashed at 38.9 s); the 2 and 3 s tappers hold 120 KIAS, at 140
  only the 3 s one; by-hand accelerations out of the hover (the gate's
  g1, 12 cases) 6 not lost (round 1: 0): the rest fly into the ground accelerating at 3 ft or over-torque climbing at
  1.5 m/s (the held-key command fades out with the height hold above 40 KIAS); the deceleration from 60 KIAS with 1 s taps
  is no longer lost but reaches no hover in 60 s; a 1 s ArrowUp knock in the app's default 8 kt wind (production build)
  comes back to a hover 37 m from the start (calm 27.7); A let go the moment it reaches the hover (still 9 deg nose up
  from its stop) moves the attitude 7.7 deg in 2 s, 1.5 deg after 5 s of settling (the hint says let it settle).
- **For the physics owner (pre-existing, measured here):** trimmed at 60 KIAS with the assist off and the stick frozen, a
  -0.05 collective step gives pitch -11 / roll -17 deg at 5 s (gate1 g11), and hands off at 120 / 140 KIAS the raw
  aircraft diverges (crashed at 51 / 16 s, `p12_ch1hi`): check the collective-to-pitch / roll coupling and the high-speed
  pitch stability against DLR / ERF 1995 (L_dcol, M_dcol, M_w). One engine out in the hover with the beginner tapping F6:
  the survivor reaches 168-172 % torque at 62-64 % NR and lands (gate1 g4): no torque / TOT limit response on the
  survivor (bo105/limits.ts has the OEI limits).
- **For the hold's owner:** engaged at 35 kt the hover hold settles at 28-31 kt (engaged at 42 kt: 31 kt, gate1 g10).
  autopilot.ts is shared: tightening the speed loop would change every helicopter's hold, so it is left.
- **Owner-facing choices (AGENT, on the owner's delegation; each one line in `bo105/input.ts`):** (a) the arrow keys at
  rest below 30 kt now bring the helicopter back to a hover over the ground (to move slowly keep tapping; the mouse yoke
  keeps the attitude command); (b) below 30 KIAS a held F6 climbs at up to 2 m/s and stops raising the lever at the
  torque limit: for take-off power in the hover use Shift+F6; a held F5 descends at up to 2 m/s, 0.7 near the ground;
  (c) on the keys the STAB ASSIST holds the attitude at every speed (Shift+A for the raw aircraft); (d) the crossfeed
  pedals the untouched lift-off.
- **Shared files touched:** `src/sim/rotorcraft/stabilityAssist.ts` (the four parts, export / import of the new state),
  `src/input/profile.ts` (`translationalRate`, `heightHold.held`, `pedalCrossfeed.onLightSkids`, `cruiseHold`, optional),
  `src/input/InputSystem.ts` and `src/core/types.ts` (`ControlInputs.collectiveFastWorked`, set only on a type with a STAB
  ASSIST), `src/sim/SimPhysics.ts` (a comment). No other type has a STAB ASSIST: the legacy digests are unchanged.

#### Tune pass 2 (2026-10-25, branch `tune2/bo105`; probes W/tune2/bo105, logs `out/*.base.log` / `out/*.cfg3.log`)

The round-2 pilot gate (6/10, W/tune/bo105 `gate2/`) found two ordinary beginner inputs that still crashed and the raw
collective in cruise. Docs section 9 ("Tune pass 2") has the laws and every number; rows in `bo105KeyFlows`,
`tests/input/bo105Aids`, `bo105Derivatives`, `bo105Systems`. No physics changed.
- **Fixed: an arrow key held in the hover** (gate must 1). ArrowUp held 2 s crashed 5.3 s after the press from 16 m and
  3.5 s from 3 ft; 12 of 40 holds of 1-5 s came back. The **keyboard cyclic limit** (`keyboardLimit`: 0.12 of the axis
  from where the stick last rested below 15 kt of ground speed, open by 30 kt), its **re-centring** 2.5 s after the
  arrow keys rest (0.1 of the axis per second) and the TRC walk waiting for the keys (`translationalRate.keyRest`): 40 of
  40 come back, at most 18.6 deg, 10.6 kt, 37 m. Without the limit the 2 s hold still crashes (the contrast row).
- **Fixed: attitude taps while letting down** (gate must 2). The wings-level beginner slid 17-29 kt from 16 m and
  rolled over at the touchdown (3 of 12 landings under 5 kt); letting down (CG under 8 m, a bare F5 within 5 s) the keyed
  stick glides back at once and the walk runs whenever no arrow key is held (`recentre.landing`, `landingRestS` 0): 12
  of 12 under 5 kt (0.1-0.9 kt); the gate's A route lands calm, in 6 kt and with 6 kt from behind.
- **Open: KNOWN LEVEL-TAPPER GAP** (`bo105KeyFlows` it.fails): the same beginner holding a level hover (no F5) with 1 s
  looks never rests the keys 2.5 s; its taps toward 0 deg of roll hold the keyed stick at the limit and it slides at
  6.5-6.7 kt, past 30 m at 20.5 s (round 2: 31.6 kt, 15.3 s). With 2 s looks it holds within 19 m (round 2: lost at 18 s).
  A shorter rest at height takes the 1 s roll tap's bank (bo105Assist's 7-11 deg at 3 s) away; the hint says to let the
  keys rest a few seconds and that F5 stops a slide.
- **Fixed: the keyboard collective in cruise** (gate must 3). Above 40 KIAS the bare keys were the raw lever: F5 held 2 s
  at 100 KIAS 84 deg / 135 %, 4 s crashed; left alone afterwards every F5 hold at 60 / 100 KIAS flew into the ground;
  the climb-out at 1.5 m/s 101-111 % torque. The held-key **climb-rate command at every speed**
  (`heightHold.held.everySpeed`): attitude within 9 deg, torque at most 63 %, the climb-out at most 86.1 %, no crash.
- **By-hand accelerations** (gate should 4): 10 of 10 not lost (5 of 10), past 45 kt in 27-44 s (17-35 s: the limit
  makes the start slower).
- **Fixed: the tapper above 110 KIAS** (round 2's recorded limit, gate should 4): at 120 KIAS the 1 s tapper went through
  180 deg, at 140 it crashed at 38.9 s; now the bank and the pitch off the trim stay within 15.2 deg at 120 and 3.6 deg at
  140 for 60 s (looks every 1 / 2 / 3 s). At 140 KIAS (above the maximum continuous power) the held-F6 limit back-off
  first lowered the lever and the height-law taps flew all three into the ground at 56-59 s; the back-off now stops
  where the key found the lever (they sink 27-32 m in 60 s: no power to climb at that speed).
- **Open: KNOWN TAILWIND GAP** (gate should 4; unchanged, `bo105KeyTransitions` it.fails): the gate's wind decelerations
  7 of 10, as round 2. The three: tail10 with 1 s taps pirouettes at up to 75 deg/s and reaches no hover (12 kt at the
  end); head10gust with 1 s taps reaches no hover (17 KIAS, 4.5 kt at 60 s); tail6 with 1 s taps reaches the hover at 59
  s and is lost 16 s into the fly-on (heading 180 round, 75 deg/s, 30 m). With 2 s taps all three hover. Round 2's
  counter-pedal variant was measured and not adopted; a stronger heading hold below 10 kt in a tailwind is the next step.
- **Physics checked, not changed (for the physics owner's record).** (a) The collective coupling: at 80 KCAS L_col 0.052
  / M_col 0.063 rad/s^2 per % inside the AR-280 envelope (DLR 0.032 / 0.057, AFDD 0.058 / 0.073, P), and the frozen-stick
  -5 % step (-19.2 deg pitch, -22.8 deg roll at 5 s) inside the band of the DLR and AFDD identified models' own step
  (-20.8 / -22.4, -25.3 / -27.8): the gate's 60 KIAS -11 / -17 deg is the real Bo 105's response (new rows). (b) The raw
  hands-off divergence at 120 / 140 KIAS (crashed at 57 / 24 s): the phugoid, sigma +0.08 1/s at 80 KCAS between DLR
  +0.05 and AFDD +0.11 (P), grows to +0.20 / +0.28 at 120 / 140 KCAS (Mu 0.046 -> 0.072); the sources hold no flight data
  above 80 kt, and Helisim (S, decoupled) misses the identified phugoid frequency at 80 kt (0.08-0.18 against 0.30-0.33
  rad/s), so its weak high-speed instability is no reference: recorded, not fitted. (c) One engine out with the pilot
  pulling the collective: the survivor tops out at its 105 % N1 stop and about 810 C (gas-producer topping, TCDS P); the
  CB-4 has no torque or TOT limiter (P5 FM 7.5.4); 158-172 % on the gauge is power over a drooped NR (new row).
- **Recorded (gate nice items):** the NR HIGH tone (108 %, 2600 Hz) reaches the audio bus whenever on in an
  autorotation (battery bus 25.5 V); the beginner's Shift+F5 entry NR peaks and the 120 KIAS bunt are in item 22; a 1 s
  pedal key tap peaks at 18 deg and is dragged back to 7.6 deg, a 2 s tap goes round (`q10_pedal`; unchanged from round
  2); the hover hold engaged at the end of a by-hand acceleration to 42 kt settles at 24.7 kt calm (round 2: 34.9). The
  pedal hold's capture and the hold's speed loop are shared code (every helicopter's hold): not changed. (The fix round
  below found the cause, the speed captured along the nose in a 35 kt sideslip, and fixed it.)
- **Measured, not adopted:** a near-ground walk without rest whatever the pilot does (held the 3 ft accelerating
  beginner, cycled at 4-5 kt hands off at 1 deg/s per kt); a touchdown guard (held the deliberately moving pilot at 4 m;
  F5 with an arrow held lands at 7-8 kt, not crashed); a sink trigger for the landing re-centring (2 of 6 one-engine-out
  touchdowns crashed); limits 0.10 / 0.15.
- **Owner-facing choices (AGENT, on the owner's delegation; each one line in `bo105/input.ts`):** (e) below 15 kt an
  arrow key moves the stick at most 0.12 of the travel (about 9 deg of attitude) and, a few seconds after the keys rest,
  the stick glides back: to move, hold the key; to stop, let go (the mouse yoke and Shift+A for the raw aircraft are
  unchanged); (f) letting down with F5 the stick glides back at once; (g) held, F5 / F6 climb or descend at up to 2 m/s
  at any speed, and in cruise the lever stays where they leave it.
- **Shared files touched:** `src/sim/rotorcraft/stabilityAssist.ts` (`translationalRate.keyRest`, `landingRestS`,
  `heightHold.held.everySpeed`; a touchdown guard was added and removed again), `src/input/profile.ts` (`keyboardLimit`
  and those fields, optional), `src/input/InputSystem.ts` (one block for the limit and re-centring, set only with
  `keyboardLimit`; the flag lines), `src/core/types.ts` (`ControlInputs.cyclicWorked`, `cyclicLanding`, optional, set
  only when the profile asks for them). The AH-56A sets none of them; the legacy digests are unchanged.

#### Tune pass 2 fix round (2026-10-25, branch `tune2/bo105`; the pass-2 gate W/tune2/bo105 `gate1/`, 7/10; probes `fix1/`, logs `fix1/out`: `*.cfg.log` before, `*.head.log` after)

The gate found one beginner crash flow left (one engine out in cruise), the hover hold's speed after the by-hand
acceleration, the raw aircraft on the mouse yoke in cruise, and, in its unread caveat probes (`gate1/k1_fade`), arrow
keys held at speed and an arrow key reversal in the hover that crashed. Docs section 9 ("Tune pass 2 fix round") has the
laws and every number; rows in `bo105KeyFlows`, `bo105KeyTransitions`, `bo105Assist`, `tests/input/bo105Aids`. No physics
changed.
- **Fixed: one engine out in cruise** (gate must). The height hold and the held-key climb-rate command stopped with the
  engine (`powered` needs no engine out), so the beginner's height-law F6 / F5 taps were the raw lever against the
  survivor's topping: at 100 KIAS 111.9 % torque, NR 90.7 %, a pitch oscillation past the series authority, inverted
  (the gate's g4 oeiCruise 100; with the law at gain 1 / 0.5 crashed at 33 / 43 s, `fix1/f_oei`). `heightHold.oei`: above
  the 30-40 KIAS band the held F5 / F6 stay the climb-rate command with one engine out, F6 stopped by the survivor's OEI
  limits (95 % torque, 810 C, 105 % N1: `powerLimitExceeded` from the OEI ratings) and never backed off; at rest the lever
  stays; below the band the keys stay raw. After: at 80 / 100 KIAS none of the beginners (height law gain 1 / 0.5,
  attitude only, a 0.5 s F5 tap first, hands off) crashed in 60 s, NR at least 96.3 %; the gate's g4 oeiCruise 100 not
  crashed (100.9 %, 3.3 deg, NR 96.5 %); one engine out in the hover 8 of 8 as before. Measured, not adopted: a back-off
  over the limits at rest (0.01 / 0.02 / 0.05 per second: the attitude-only and hands-off beginners at 100 KIAS flew
  into the ground at 39-51 s); the command in the hover band too (the 16 m OEI landings crashed at 3.9-5.2 m/s; raw
  2.1-2.3: the cushion needs the over-pull).
- **Open: KNOWN OEI-CRUISE TORQUE GAP** (`bo105KeyFlows` it.fails): the beginner holding the cruise attitude at 100 KIAS
  keeps the survivor at 101.0 % (NR 96.3 %), over the 95 % rating, and sinks about 0.9 m/s: level flight at 100 KIAS
  (2200 kg) needs about 101 % of one engine (2 x 54 % before the cut). The One engine out hint: a tap of F5, slow to about
  70 KIAS, do not chase the height; the beginner who does (`hint`) holds the height within 1.5 m at 100 and 120 KIAS with
  the torque under 97 % from 20 s. At 120 KIAS (above the 100 KIAS OEI Vne, P5 FM 2-4) the beginners holding the cruise
  attitude sink 3-4 m/s into the ground at 42-45 s from 150 m: no power for that speed; the hint is the way out.
- **Fixed: the hover hold after the by-hand acceleration** (gate should). A pressed at 42 kt held 22.7 kt: the hold's
  engagement speed is `observePilot.forwardSpeed`, the ground speed along the nose, and the gate's beginner arrived
  sliding 34.6 kt sideways (the pedal at its left stop, the nose about 56 deg off the track; pre-existing: on main 23 kt
  sideways, held 33 kt). The gate's guesses (the lever, the stick at the press, the limit's slower start) do not hold:
  from steady flight the hold keeps 34.6 / 41.6 / 44.5 at 35 / 42 / 45 kt, on the branch and with main's fields
  (`gate1/k2`). `SimProfile.heliHoldGroundSpeed` (the Bo 105; `autopilot.ts` `groundSpeedTarget`, every other helicopter
  unchanged): engaged moving forward the hold keeps the speed over the ground. After: 42.0 kt held, 41.9 KIAS calm 40 s
  later (48.9 into the 6 kt wind, 34.2 with it behind: a ground-speed hold); from the 16 m hover pressed at 35 / 42 / 45
  kt: 34.9 / 41.8 / 44.8 KIAS 40 s later (30.8 / 37.2 / 40.0 before); the A route done in all three winds. Recorded (pre-existing, for
  a later pass): the by-hand acceleration of the gate's beginner (aiming at 0 deg of roll and the start heading) ends 35
  kt sideways with full left pedal.
- **Fixed: the mouse yoke in cruise** (gate should; the owner's trackpad as the yoke, Y). Above the 30-50 KIAS fade a
  hand-held stick flew the raw aircraft (13 of 17 of `f_h5`'s cases crashed: the 1 s / 2 s tapper at 60-120 KIAS, hands
  off at 120 / 140 KIAS, F5 / F6 held 2 s at 100 KIAS, a 1 s ArrowLeft knock). `cruiseHold.handHeld`: a stick the input
  module reports as hand-held keeps the cruise attitude command / attitude hold (no trim follow-up). After: 1 of 20 (the
  yoke left forward after a 1 s knock at 100 KIAS: the commanded nose-down held into a dive, 33 s). Measured, not
  adopted: control wheel steering (the datum following the flown attitude while the yoke moves and 0.25 / 0.5 / 1 / 2 s
  after): the 100-120 KIAS tappers and both speed changes crashed.
- **Fixed: an arrow key held at speed** (the gate's caveat probe k1, the same class as tune pass 2's must 1). The
  keyboard cyclic limit opened to the whole travel by 30 kt, so a key held 1.5-3 s at 20-100 KIAS took the stick 0.3-0.8
  out, past the series authority: with the beginner recovering 12 of 60 crashed, hands off 35 of 60. `keyboardLimit
  .cruise`: above 15 kt the limit opens only to 0.12 of the axis, and once the keys have rested 0.3 s the stick's
  position is the new rest (one press at most 0.12, about 9 deg of commanded attitude; taps do not add up). After: 0 of
  60 and 9 of 60, the nine ArrowUp held at 45 / 60 / 100 KIAS then hands off, the commanded 9 deg nose down held into a
  dive (17-41 s from 150 m: the attitude the pilot set). Swept travel 0.12 / 0.16 / 0.2 (0.2: the 100 KIAS recovery went
  through 180 deg) and rest 1 / 0.3 s (1 s, and the limit kept through the 15-30 kt band without the rest, added the
  beginner's taps up: the accelerations past 45 kt 10-15 s later, the keyboard circuit's approaches 1 of 8).
- **Fixed: an arrow key reversal in the hover** (k1's hover keys). ArrowUp 2 s then ArrowDown 2 s crashed from 16 m
  (30.9 s) and from 3 ft (22.0 s), 3 s each likewise: the TRC's trim walk (2 deg/s) against the attitude hold at its
  authority rang into a growing pitch / roll limit cycle (8 s a swing, `f_rev`). `translationalRate.trimMaxDegS` 1 (was
  2; round 2 left 1 for the knock past 30 m, which the keyboard limit now holds within 15 m): 10 of 10 come back. 1.5
  deg/s: 8 of 10; an anti-windup on the walk alone: 8 of 10.
- **Open: KNOWN REVERSAL-DRIFT GAP** (`bo105KeyFlows` it.fails): the 3 s reversal passes 15 kt, where the limit at speed
  holds the braking key to 0.12 too: no crash, back to a hover, but 57.0 / 58.9 m away (26.4 / 38.2 m before the limit at
  speed).
- **Open: KNOWN LEVEL-TAPPER GAP** (gate should; unchanged): with 1 s looks and no F5 past 30 m at 20.1 / 20.5 s, 7.0 /
  6.9 kt (the gate's h1: 21.1 / 21.5 s). The gate's trim mark on the attitude indicator is shared panel / UI code, not this lane's. Measured, not
  adopted: a roll-only tap shorter than 0.5 s not ending the keys' rest (`keyRestMinS`, with a pitch-key flag from the
  input module): the slide stops (41 / 49 m at most, then 0 kt) but the beginner recovering from an ArrowRight held 2 s
  at 20 KIAS rolled to 44.5-51.4 deg (30.6 without); with pitch taps exempt too the level tapper holds within 23 m but
  8-10 of the 10 by-hand accelerations never pass 45 kt (the walk holds them in the hover).
- **Open: KNOWN TAILWIND GAP** (gate nice; `bo105KeyTransitions` it.fails): the walk at 1 deg/s alone brought the 10 kt
  tailwind 1 s deceleration to the hover (50.5 s); with the limit at speed it reaches none again (6.4 kt at 60 s). The
  gate's g7: 8 of 10 reach the hover, as before (tail6 with 1 s taps now at 31.1 s, before 59 s; tail10 and head10gust
  with 1 s taps none). The stronger heading hold below 10 kt was not built.
- **Recorded: the double engine failure flown to the ground** (gate nice; item 22).
- **Recorded: the keyboard circuit** (gate nice; `g2_circuit`): 6 of 8 done (5 of 8 before). As the gate noted, its
  approach holds the altitude of the approach's start over rising ground, so a "done" approach can end on the skids
  (1.3-1.4 m AGL); a rig note: hold AGL, or fly the circuit back over the start.
- **Owner-facing choices (AGENT, on the owner's delegation; each one line in `bo105/input.ts` or `sim.ts`):** (h) with
  one engine out in cruise, held F5 / F6 still climb or descend, F6 stopped at the OEI limits; (i) A holds the speed over
  the ground it was pressed at; (j) at speed one press of an arrow key moves the stick at most about 9 deg of attitude:
  press again for more; (k) the mouse yoke holds the attitude at every speed, as the keys do; (l) the TRC walk at 1 deg/s.
- **Shared files touched:** `src/sim/rotorcraft/stabilityAssist.ts` (`heightHold.oei`: one gated call and its own method;
  `cruiseHold.handHeld`: one term in the cyclic gain), `src/input/profile.ts` (`heightHold.oei`, `cruiseHold.handHeld`,
  `keyboardLimit.cruise`, optional), `src/input/InputSystem.ts` (`keyboardLimit.cruise`: the limit's open travel and one
  line in the re-centring block), `src/sim/rotorcraft/autopilot.ts` (`groundSpeedTarget`, false unless set),
  `src/sim/SimPhysics.ts` (one line setting it from the profile), `src/aircraft/types.ts` (`SimProfile
  .heliHoldGroundSpeed`, optional). The AH-56A sets none of them; the legacy digests are unchanged.

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
