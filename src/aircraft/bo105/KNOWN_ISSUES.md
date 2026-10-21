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
   AR-280 bands. **No Bo 105 hover derivatives exist in the sources**: every hover handling number is unvalidated.
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
   KIAS and 4.8 kN m (yellow) at 145 KIAS. The plan's estimate (LIMIT at about 16-17 deg of TPP tilt, about 40 kN m)
   assumed a disc held level on a 15 deg slope, which the fitted lateral travel cannot do. The real indicator's
   calibration is not published.
7. **OEI droop and torque** (`bo105Systems` KNOWN OEI-DROOP GAP, `bo105Performance` KNOWN OEI-TORQUE GAP): from 2 x 55 %
   in the hover with the collective held the survivor at its N1 stop holds NR about 96.5 %, half a percent above the plan's
   93-96 %, so the RPM light and the 650 Hz tone stay out; its torque peaks at about 103 % (inside 105 %). In a 3 ft IGE
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
15. **Stabiliser and fuselage aerodynamics are ESTIMATES**: the stabiliser's effective lift slope (3.0 per rad, the Mw
   knob: Mw +0.040 at 80 KCAS, phugoid time to double 8.7 s) and the fuselage moment derivatives (a Munk estimate x 0.6)
   carry no measured data; AR-280's "NACA 0010/C020" profile is read as symmetric.
16. **Airspeed limits**: the OEI 100 KIAS Vne (P5 FM 2-4) is not read by the limit reader (it knows power-off only).

## Owner-facing AGENT choices in this package (not owner decisions)

- The hub set: e 0.12 R, nu 1.11, polar inertia 850 kg m^2 (inside the fitting rule's band; 900 put Lp and the roll mode
  outside their AR-280 bands on this airframe), control phase 28 deg (least squares to AR-280's off-axis ratios).
- The control-travel rigging offsets (item 1), the ground attitude 1.25 deg nose-up (P5 FM Fig 1-1's 1.5 deg dimension
  read as nose-up), the keyboard aileron key (baseRate 0.07, maxRate 0.35, accelTime 1.5: a 1 s tap at 80 KIAS gives
  about 11 deg of bank 2 s after the release).
