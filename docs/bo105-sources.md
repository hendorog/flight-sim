# MBB Bo 105 CB-4 source and setup record

The selected aircraft is the **Bo 105 CB-4**: type BO105, model BO105 C, variant CB-4, with **two Allison (Rolls-Royce)
250-C20B** engines, the **ZF FS 72B** main transmission, a 2500 kg maximum mass, the standard (unstretched) cabin and the
Type 1 rectangular main-rotor blades. The variant is an agent choice (owner-notes.md), not an owner decision. Further
agent choices: the pilot in the **right** seat (the certificated minimum crew position), the analogue VFR panel of the
flight manual's "typical" figure plus an attitude indicator and DG, and no optional kits (no SAS/IFR kit FMS 11-2,
no Category A kit FMS 11-4, no rotor brake, floats, hoist, cargo hook or low-temperature kit). The CBS (stretched
cabin), the CB-5/CBS-5 (Type 2 blades, FS 72E Cat A ratings) and the LS (250-C28C) are recorded only to stop their
data being mixed in by mistake.

## Source hierarchy and cache

Retrieved 21 October 2026. **EASA TCDS EASA.R.011 Issue 3** (4 July 2017), Section 2 "BO105 C [C23, CB, CB-4, CB-5]",
is the controlling document for certification, weights, CG, speeds, rotor and engine limits. The only flight manual
obtained is the **Flight Manual BO 105 CB-5/CBS-5** (Eurocopter, LBA approved, Rev 0 with Rev 1-4 pages), read through
a third-party online viewer. Its Section 2 power table is for the 250-C20B with the FS 72B and matches the CB-4 TCDS
entries exactly (2 x 86 % AEO, 95 % OEI, 2500 kg, Model C rotor limits), so Sections 2, 3, 4 and 7 are used for the
CB-4 with the TCDS as the citation where both give a value. Its **Section 5 and 9 performance is family data**: the
CB-5 flies the high-performance Type 2 blades (tapered tip, 0.30 m chord), so its hover and climb charts are expected
to be optimistic for a CB-4. Section 11 Category A ratings need the FS 72E and do not apply. A CB/CBS-4 flight manual
(Airbus "Flight Manual 105 CBS", separate SRD) was not found. The dynamics data come from the DLR BO 105 S-123 research
aircraft via **AGARD AR-280** (1991).

Downloads, text extracts (`*.txt`), the flight-manual transcriptions (`rfm-cb5-manualslib/extracts.txt`), page images
(`*/img/`) and `manifest.json` (path, bytes, SHA-256, URL) live in the ignored `work/rigid/sources/bo105/`. Git does
not carry them, so copy that directory to worker worktrees. Do not commit PDFs, page images or photographs. The flight,
training and maintenance manuals are Eurocopter/Airbus Helicopters copyright third-party uploads: cite the printed page
and its revision mark, never redistribute them or trace them into repository assets. The CC BY-SA 2.0/2.5/3.0 and GFDL
photographs are not GPLv3-compatible, so use them only as modelling references.

| Cached file | Primary document / use | Download |
| --- | --- | --- |
| `tcds-easa-r011/easa-r011.pdf` | EASA TCDS R.011 Issue 3, Section 2 pp 7-12: dimensions, engine ratings in kW and % torque, N1/N2/TOT, Vne 145/130 KIAS, NR 98-102 % (416-433 rpm) and 85-110 % power off, 2500 kg, CG envelope, datum, fuel 580/570 l, crew in the right seat | [PDF](https://www.easa.europa.eu/sites/default/files/dfu/TCDS_EASA_R011_AHD_BO105_Issue_03.pdf) |
| `rfm-cb5-manualslib/` | Flight Manual BO 105 CB-5/CBS-5: Fig 1-1 three-view; 2-2..2-21 limits and markings (Vne table, power table, rpm, slopes, hover turns, mast moment); 3-1..3-45 warning lights and emergencies; 4-8..4-18 start, checks, pre-take-off, shutdown, deceleration check; 5-14..5-27 H-V, hover ceilings, take-off, climb (F); 7-4..7-31 cockpit, panel, switch panels, power plant, fuel, power train, rotors, controls, electrical; 9-3..9-11 fuel flow, range, cruise speed (F) | [viewer](https://www.manualslib.com/manual/2023501/Eads-Eurocopter-Bo-105-Cb-5.html) |
| `training-manual-pdfcoffee/page.txt` | BO 105 Training Manual, General (Oct 2005 draft): variants, hingeless rotor, doors, tandem hydraulics, instrument panel and warning-light descriptions, warning-box tones (650 Hz, 2.6 kHz), overhead power levers OFF-IDLE-FLIGHT, operator panel | [page](https://pdfcoffee.com/bo105-section-00-general-description-pdf-free.html) |
| `mm-ch01-pdfcoffee/page.txt` | Maintenance Manual BO 105 Rev 25, text layer only: ch 01 dimensions (MR 9.84 m, 0.27 m chord, 76.0 m2; TR 1.90-1.915 m, 0.180 m), ch 06 tank table, ch 11 transmission, ch 12 rotor brake, ch 13 hub, ch 14 blade types | [page](https://pdfcoffee.com/01-mm-bo105-maintenance-manual-aeronavespdf-2-pdf-free.html) |
| `agard-ar280/DTIC_ADA244250.pdf` | AGARD AR-280: Table 6.2.1 physical data (Ixx/Iyy/Izz/Ixz 1433/4973/4099/660 kg m2 at 2200 kg; twist -6.2 deg; shaft -3 deg; stabiliser 2.0 x 0.4 m, 0.8 m2, 0 deg); Tables 6.2.8-6.2.13 identified 80 kt derivatives, time delays and modes | [archive.org](https://archive.org/details/DTIC_ADA244250) |
| `agard-ar280/DTIC_ADA244248.pdf` | AGARD LS-178 paper 14 (Tischler): roll/flap mode 13.7 rad/s, zeta 0.51; lag mode zeta 0.042 | [archive.org](https://archive.org/details/DTIC_ADA244248) |
| `metu-12613643/metu.pdf` | METU thesis Table 9 (Theodore model): TR 233 rad/s, R 3.18 ft, shaft -4.2 deg; CG 3.15 ft below hub (F/S) | [PDF](https://etd.lib.metu.edu.tr/upload/12613643/index.pdf) |
| `erf-kerler/kerler.pdf` | Kerler et al. ERF 2012: Simulink Bo 105 tail-surface and skid modelling choices; Fig 1 power required over speed at 1500 / 2000 / 2300 kg SL after Kessler's TUM lecture (S; digitised at the pilot review: 2300 kg hover 426 kW, 232 kW at 60 KIAS, 508 kW at 130 KTAS) | [PDF](https://dspace-erf.nlr.nl/bitstreams/3c4157b6-9b2f-41c4-95dd-479b168ea48b/download) |
| `erf-1989-66/erf-1989-66.pdf` | Kaletka, von Grünhagen, Tischler, Fletcher, "Time and frequency-domain identification and verification of BO 105 dynamic models", ERF 1989 paper 66 (P): the DLR/AFDD identification behind AR-280; 80 kt at about 3000 ft only (p 2), no hover derivatives. Fetched 2026-10-21 (DTIC ADA216828 refuses scripted downloads) | [PDF](https://dspace-erf.nlr.nl/bitstreams/938ea20b-994b-4820-b216-62e74e1e6663/download) |
| `erf-1995-vii07/erf1995-vii7.pdf` | Kaletka, J., Gimonet, B., "Identification of extended models from BO 105 flight test data for hover flight condition", 21st ERF, St Petersburg 1995, paper VII-7 (P): the DLR / CERT flight-identified Bo 105 HOVER 6 DOF and 9 DOF models. Table 1 (major derivatives, text lines 536-566 of the extract), Figure 13 (poles; read off the plot, `fig13zoom-18.png` 72 px per rad/s), the hover flight description pp 2-3 ("highly unstable", 45 deg of roll in about 14 s, "all hover flight tests were flown with additional stabilizing pilot inputs"). Read at the flyability pass, 2026-10-22 | ERF repository (dspace-erf.nlr.nl), paper VII-7 |
| `heffley-cr3144/cr3144.pdf` | Heffley, R. K. et al., "A Compilation and Analysis of Helicopter Handling Qualities Data", NASA CR-3144 (1979), section III "BO-105C" (F: the Boeing Vertol Y-92 analytical model of the same Type 1 hingeless rotor, 2096 kg; not flight data). Pages read: Fig III-2 pp 70-71 (control system and travels: collective 14 deg, longitudinal 10 deg, pedal 16 deg; lateral printed ".28 deg/%", probably .08), Fig III-3 p 72 (inertias), Table III-3 pp 74-81 (derivatives and trims; case 29 hover, case 34 80 kt), Table III-5 p 95 (hover denominator: doubling 31 s) | [NTRS 19800002851](https://ntrs.nasa.gov/api/citations/19800002851/downloads/19800002851.pdf) |
| `pfc-gavilan-helisim/` | Gavilán Jiménez, Seville PFC (student project): Bo-105 stability derivatives from a Helisim-type model (Padfield's structure with the 3-state Pitt-Peters inflow), hover to 140 kt, plots (S/ESTIMATE: used only for the pattern of the hover coupling derivatives Lu +0.35, Mv +0.08, read by eye) | Universidad de Sevilla repository |
| `../ads33/ads33e.pdf` | ADS-33E-PRF (2000), 3.3.2.3 and Figure 7 "Limits on pitch (roll) oscillations, hover and low speed" (P specification, not Bo 105 data): Level 2 / 3 boundary at sigma 0.139 rad/s (doubling 5.0 s); 3.3.2.3 makes an attitude-hold response type the compliance route | US Army AMCOM |
| `commons-photos/` | Wikimedia Commons photographs (licences in research-bo105.md section 16): D-HILF left side, Christoph 7 and Policía CB cockpits, rotor head, CB in flight | [Commons](https://commons.wikimedia.org/wiki/Category:Bo_105) |

## Resolved installation facts

- **Rotation:** the main rotor turns **counter-clockwise viewed from above**. The flight manual gives it through its
  consequences: a double engine failure gives a **left** yaw and calls for right pedal (3-34, 3-35); a tail-rotor drive
  failure gives a rapid **right** yaw with right roll and nose-down pitch (3-40, 3-41). The two-blade **teetering**
  (delta-hinged) tail rotor sits on the **left** of the fin top (Fig 1-1, Fig 7-1, photo of D-HILF) and pushes the tail
  to the right (pusher).
- **Seats and controls:** the pilot flies from the **right** seat (TCDS p11, FM 2-2); the copilot's cyclic and collective
  are removable. Controls are mechanical to a **tandem hydraulic boost** (system 1 active, system 2 standby with
  automatic cross-over on a system 1 pressure loss or servo jam, HY BLOCK). Electric cyclic trim with lateral and
  longitudinal feel springs. **No stability augmentation on the VFR CB-4**; the TCDS ties IFR to the optional FMS 11-2 kit.
- **Engine controls:** **two overhead power levers**, OFF - IDLE - FLIGHT with a separate IDLE lock each, Teleflex to the
  N1 fuel controls; no twist grip. Both sit at FLIGHT in flight. A **4-way ENGINE TRIM switch** on each collective head:
  fore/aft beeps both N2 governors (NR), left/right trades torque between the engines for load sharing ("N2 trim to
  98 %", "torque synchronise", FM 4-16). Droop compensation is a mechanical collective-to-governor link through a
  hydraulic actuator. Two freewheels at the transmission inputs; no pilot clutch.
- **Engine limits:** per engine 86 % torque AEO (257 kW, take-off and MCP), 95 % OEI emergency (283 kW) with the FS 72B;
  TOT 810 C take-off (779-810 C for 5 min), 779 C continuous, 843 C transient (6 s above 810 C), 927 C start (10 s above
  810 C); N1 105 % (106 % for 15 s); N2 102 % continuous, 105 % for 15 s. 100 % torque is about 298 kW (D). Do not import
  the MD 500's psi torque gauge, its single-engine twist grip or the FS 72E Cat A 105/110 % ratings.
- **Rotor speed:** 100 % NR = 424.5 rpm (D from TCDS 433 rpm = 102 %); power on 98-102 % (100 % recommended), 95 % minimum
  transient, 105 % for 15 s; power off 85-110 %. Main transmission ratio about 14.17:1 (D). RPM warning: N1 split
  >= 12 % or NR <= 95 % flashing light with beeping tone; NR >= 103 % light; steady tone at >= 108 % (two-stage unit).
- **Gear:** two skids on two bending cross tubes, track 2.53 m unloaded; tail skid under the fin.

## Geometry contract

Stations are from the datum **3000 mm forward of the levelling point at frame 7** (TCDS, FM 2-3).
`src/aircraft/bo105/dimensions.ts` cites each group.

| Quantity | Source value | Source / treatment |
| --- | --- | --- |
| Main rotor | 9.84 m diameter, 4 blades, 0.27 m chord, NACA 23012, solidity 0.07, precone 2.5 deg, shaft 3 deg forward | TCDS p8; MM ch 01; AR-280 p145; NASA TM-85990; FM Fig 1-1 |
| MR twist | -6.2 deg (AR-280 flight-test model) vs -8 deg (NASA hardware) | conflict; model choice to record |
| Tail rotor | 1.90 m diameter, 2 blades, 0.179-0.180 m chord, NACA 0012, twist 0, teetering, left side at the fin top | TCDS; MM; AR-280; FM 7-21; **3V** position |
| TR speed | 233 rad/s (ratio 5.25 to the main rotor) | **F** Theodore via METU |
| Envelope | 11.86 m overall, 8.56 m fuselage with boom, 4.30 m hull, 1.58 m hull width, 3.00 m height | FM Fig 1-1; TCDS p8 (AR-280: 11.84 / 8.45 / 3.03 m) |
| Horizontal stabiliser | span 2.0 m, chord 0.4 m, area 0.8 m2, "NACA 0010/C020", incidence 0 deg, endplates | AR-280 p145; endplate size **3V** |
| CG | 3038-3395 mm aft of datum (envelope in TCDS p11); about 0.96 m below the hub | TCDS; **F** METU |
| Inertia (2200 kg) | Ixx 1433, Iyy 4973, Izz 4099, Ixz 660 kg m2 | AR-280 Table 6.2.1 |
| Fuel | supply tank 95.5 l (74 kg usable), main tank 484.5 l (382 kg usable), 456 kg usable in all | MM ch 06; FM 9-6 |
| Panel | narrow centre pedestal (FM Fig 7-3), centre switch console (Fig 7-4), overhead console (Fig 7-5), power levers on the ceiling | FM 7-4..7-7 |

Hub station, skid length, ground clearances, endplate and fin size, cabin interior dimensions and the
sense of the "1.5 deg" skid dimension in Fig 1-1 are **3V/photo estimates** (Commons D-HILF series, Fig 1-1, Fig 7-1).

## Performance and procedure evidence for the next worker

Vne 145 KIAS up to 2400 kg and 130 KIAS above (TCDS); the FM's PA/OAT table (2-4, Fig 2-2) drops to 80-100 KIAS high and
hot. Autorotation and OEI Vne 100 KIAS. Sideward 25 kt, rearward 20 kt, hover turns 90 deg/s up to 2400 kg.

VY is 60 KIAS AEO and OEI. Take-off: 3 ft hover, 50 ft at 50 KIAS, 550 ft distance. **Autorotation (FM 3-37):**
collective full down, 75 KIAS recommended, minimum descent at 60 KIAS / 100 % NR, maximum range at 100 KIAS / 85 % NR,
flare 15-25 deg at about 100 ft and level to about 5 deg at 6-10 ft. No descent rate is published. **OEI landing:**
60 KIAS shallow approach, 40 KIAS and 300 fpm on final.

Family (CB-5) performance read from the charts (research-bo105.md section 10, D +/- one grid line): HIGE at take-off
power reaches 2500 kg up to about 7,900 ft ISA and HOGE up to about 5,550 ft ISA; AEO climb about 1,400 fpm at 2500 kg
and 3,250 fpm at 1400 kg at sea level (the FM example gives 1330 fpm at 12,500 ft, 20 C, 1850 kg); OEI climb at
emergency power about +250 fpm at 2500 kg; maximum cruise at MCP about 131 KTAS at sea level and 135 KTAS at 4,500 ft
at 2500 kg; 286 NM range at 90 KCAS with 456 kg (about 143 kg/h).

Engine checks for the turboshaft model (FM 4-12..4-18): light-off by moving the power lever from OFF at 12-15 % N1;
main rotor turning by 25 % N1; starter released at 58 % N1; idle 59-65 % N1, about 60 % NR ground idle; generator on
above 40 % N2/NR; snap deceleration from 100 % N2 to 65 % N1 in at least 2 s without falling below 59 % N1. Recommended
cruise maxima 82 % torque and 738 C TOT. Engine anti-ice adds about 15 C TOT.

## Readings made for the flight model

- **AGARD AR-280 80 kt derivatives** (DLR S-123, 2100-2250 kg, 80 kt, about 3000 ft density altitude; Tables 6.2.8-6.2.13,
  printed pp 150-154): Lp -8.50, Lq 3.04, Mq -3.50, Mw 0.053 rad/(s m), Nr -0.86 1/s; Zw -1.00 1/s; control derivatives per %
  (assumed % of full travel) L_lat 0.185, M_lon 0.093, N_ped 0.049, Z_col -0.349 m/(s2 %); time delays col 0.04, lon 0.10,
  lat 0.06, ped 0.04 s; phugoid zeta -0.15 at 0.33 rad/s (divergent), Dutch roll zeta 0.14 at 2.50 rad/s, roll
  subsidence 1/T 8.49 1/s. The AFDD column is listed beside it in research-bo105.md section 9.2; use the spread between
  the two as the tolerance band. These belong in a `tests/rotorcraft/bo105.ts` harness on the oh6a.ts pattern.
- **Hover derivatives** (flyability pass, 2026-10-22): ERF 1995 VII-7 Table 1 (P; above) gives the flight-identified
  hover set, DLR / CERT 6 DOF: Lp -8.54 / -10.89, Lq +2.42 / +2.38, Mu +0.0431 / +0.0583, Mw +0.051 / +0.059, Mp -1.105 /
  -1.9, Mq -2.32 / -1.79, Nv +0.096 / +0.066, Nr -0.974 / -1.10, Zw -0.295 / -0.251; per %: Z_col -0.238 / -0.23, M_lon
  +0.0719 / +0.0724, L_lat +0.171 / +0.196, N_ped +0.0477 / +0.0474. Xu / Yv (-0.345 / -0.131) carry the paper's caveat on
  the hover velocity reconstruction and are not used. Figure 13: the hover phugoid unstable, sigma about +0.1..+0.4,
  omega_d 0.4..0.7 rad/s (read). Padfield App 4B and Fu & Kaletka (JAHS 1993) were still not obtained; they may print
  the hover eigenvalues as numbers. The Padfield centre-spring Kbeta about 113,000 N m/rad (lambda_beta^2 1.248, gamma
  5.087) is a recollection that is self-consistent with the AR-280 geometry but **unverified**.

## Scaffold boundaries

Nothing here amounts to a calibrated CB-4 rotor. The flap spring, hover derivatives, control rigging, tail-rotor speed,
delta-3 and rotation direction, the stabiliser airfoil and endplates, the beep range and droop-compensation gain, the
mast-moment limit in N m and the autorotation descent rate are estimates or gaps (research-bo105.md section 18). The
hingeless hub, twin-engine combining gearbox with two freewheels, the overhead power levers, the 4-way engine trim and the
mast-moment indicator are new behaviour for this sim. Do not express them through the MD 500 twist grip or the
piston/clutch fields of the R22, R44 and S269.

## Readings and decisions of the flight model (package BO)

The flight model's calibration record is `docs/bo105-flight-model.md`; every number there carries its tag. The readings
it added to the records above:

- **Hub** (RC's set, adopted): equivalent hinge 0.12 R (BK117-ERF7, P: "an effective flap hinge offset of 12 percent
  (zero spring), and a corresponding flap frequency ratio of 1.10"); rotating flap frequency 1.10/rev (NASA TM-85990
  Table 1, calculated at 425 rpm, P) and 1.12/rev (NASA TM-103867, P), 1.11 chosen; no non-rotating flap frequency in
  TM-85990. Root cut-out 1.10 m (METU Table 9: 3.61 ft, F/S).
- **CG height conflict**: METU's "CG 3.15 ft below hub" (F, the Theodore model) is the body reference point; it cannot be
  the CG with the AR-280 inertia and the underfloor tanks (the fuel alone would carry two thirds of Ixx). The mass model's
  CG comes from an ESTIMATE component breakdown (FS 72B 152 kg, P MM ch 11 p5; the rest ESTIMATE): 1.53 m below the hub
  at 2200 kg. Empty mass 1276 kg (S Jane's).
- **Control travels**: fitted to AR-280 per % of full travel (an assumption: AR-280 does not define "%"; the MM rigging
  chapter 103 was not obtained).
- **Mast-moment marks, ground attitude, power-lever stops, fuel-transfer approximation, keyboard axes**: AGENT/ESTIMATE,
  derivations in the flight-model record.
- **Tail-rotor hub height** 2.80 m: the MM's "about 3.80 m with a tail-rotor blade vertical" (OCR, UNVERIFIED) less the
  0.95 m radius, and the D-HADO near-profile (3V).
