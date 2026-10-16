# Pilatus PC-12/47 sources and groundwork

The selected aircraft is the **PC-12/47, MSN 684–888**: a Pratt & Whitney Canada PT6A-67B flat-rated at 1200 shp for take-off, a Hartzell four-blade reversing propeller, MTOW 4740 kg, and the legacy (pre-NG) cockpit with EFIS/round flight instruments, a centre EIS engine display and a CAWS annunciator panel. No handling, performance or training acceptance is claimed.

Retrieved 16 October 2026. Page numbers below are **PDF page numbers** of the cached files. research-pc12.md pairs them with the printed section/page. Two documents are authoritative for this variant:
- **EASA TCDS EASA.A.089 Issue 11** (7 July 2025), Section C "PC-12/47".
- **EASA TCDS IM.E.008 Issue 06** (18 February 2022), PT6A-67 series.

The /47's own flight manual was not obtained. It is Pilatus Report 02211 with AFMS No. 33. The flight manual that *was* obtained is the **PC-12/47E POH/AFM, Report 02277, Revision 20**. That aircraft has a PT6A-67P, dual 300 A generators and Primus Apex avionics. It has been published as a vendor sample watermarked "for general and familiarization purposes only". Its airframe, propeller, gear, flap, fuel, pressurisation and stick-pusher data are used as the **47E proxy**. Its engine limits, electrical system, avionics, and ITT-limited climb and cruise data do **not** apply to the /47.

PDFs, rendered figures, Commons photographs and `manifest.json` (URL, byte count, SHA-256) are in the ignored `work/pcmd/sources/pc12/`. **Git does not carry this cache.** Copy it into worker worktrees or download it again from the links below. Do not commit source PDFs, photographs or scratch notes. The Pilatus POH is Pilatus copyright and must not be redistributed or traced into repository assets. The CC BY-SA 2.0 and 3.0 photographs are not GPLv3-compatible, so use them only as modelling references.

## Source inventory

| Cached file | Document and use | Download |
| --- | --- | --- |
| `easa-tcds/easa-a089-i11.pdf` | EASA.A.089 Issue 11. §C (pp. 16–21): /47 dimensions, PT6A-67B installed limits (take-off 1200 shp / 44.34 psi / 800 °C; MCP and climb 1000 shp / 36.95 psi / 760 °C; Ng 104 %; Np 1700), propeller blade angles and limits, fuel/oil capacities, KCAS speeds, weights, CG envelope, datum, tyres. §B: /45 for comparison. | [PDF](https://www.easa.europa.eu/en/downloads/7348/en) |
| `easa-engine-tcds/easa-im-e008.pdf` | IM.E.008 Issue 06. pp. 6–11: engine construction, 895 kW rating, ITT limits (-67B 800/800/1000 °C), Ng 39 000 rpm, PT 29 894 rpm = 1700 prop rpm, torque 5028 N·m (TO/MCP) and 6915 N·m (20 s), 8 % bleed, oil pressure 90–135 psi, dry weight 234.5 kg. | [PDF](https://www.easa.europa.eu/en/downloads/7787/en) |
| `poh47e/pc12-47e-poh-02277-rev20.pdf` | **47E proxy.** §1 p. 70 three-view (track 4.53 m, wheelbase 3.48 m, horizontal tail 5.20 m) and pp. 73–77 descriptive data. §2 pp. 96–117 limits, markings, flap cycles, pressurisation 5.75 psid. §3 p. 158 glide speeds. §4 pp. 286–311 speeds, start, beta taxi, take-off, landing, reverse. §5 pp. 329–416 performance charts: stall, take-off, climb, cruise tables, glide, landing with and without reverse. §6 pp. 553–586 weighing gear arms, occupant/fuel/baggage arms. §7 pp. 637–789 airframe, controls, trim, Fowler flaps, gear, engine controls (PCL/MOR/condition lever), torque limiter, start, propeller/beta/governors, fuel, electrical, pressurisation, stick pusher. §8 p. 1006 tyres. | [PDF](https://www.antennahouse.com/hubfs/PDFS/PDF%20Samples/aircraftmanual-SVG-CGM.pdf?hsLang=en) |
| `faa-n8900-428/N_8900.428.pdf` | FAA Notice N 8900.428 (effective 4 Aug 2017). Legacy PC-12/45/47 (MSN 101–888) electrical: GEN 1 300 A, GEN 2 115 A; GEN 2 cannot carry the ice-protection load. | [PDF](https://www.faa.gov/documentLibrary/media/Notice/N_8900.428.pdf) |
| `selig/aircraft.html` | UIUC airfoil-usage guide (secondary): root NASA LS(1)-0417 MOD, tip NASA LS(1)-0313 | [HTML](https://m-selig.ae.illinois.edu/ads/aircraft.html) |
| `commons/*.jpg` | Wikimedia Commons photographs (licences below) | see table |

### Photographs

| Commons file | Licence | What it shows |
| --- | --- | --- |
| [Cockpit PC-12 linke Seite](https://commons.wikimedia.org/wiki/File:Cockpit_PC-12_linke_Seite.JPG) (EDVK) | CC BY-SA 3.0 | /47 D-FHGN pilot side: flap gauge, ASI / EADI / altimeter, EIS 3×3, CAWS grid, gear handle, KIAS placards |
| [Cockpit PC-12 rechte Seite](https://commons.wikimedia.org/wiki/File:Cockpit_PC-12_rechte_Seite.JPG) (EDVK) | CC BY-SA 3.0 | Same aircraft, copilot T and the cabin-pressure panel |
| [PC12 Panel (3917481263)](https://commons.wikimedia.org/wiki/File:PC12_Panel_(3917481263).jpg) | CC BY-SA 2.0 | Legacy panel with the EIS lit: TQ, ITT, NG, FUEL, FUEL QTY, BAT, GEN, ENG OIL |
| [PilatusPC-12Cockpit](https://commons.wikimedia.org/wiki/File:PilatusPC-12Cockpit.JPG) | CC BY-SA 3.0 | /45 copilot side with EADI/EHSI lit, RMI, VSI, pressurisation controls |
| [2007 PC-12 panel (Don Ramey Logan)](https://commons.wikimedia.org/wiki/File:2007_Pilatus_PC-12_panel_photo_Don_Ramey_Logan.jpg) | CC BY 4.0 | Garmin retrofit. Use for the EIS and quadrant only. |
| [N814WA cn 814](https://commons.wikimedia.org/wiki/File:Pilatus_PC-12-47_(N814WA,_cn_814)_(1-17-2023).jpg) | CC BY-SA 4.0 | /47 left-side exterior |
| [HB-FPT](https://commons.wikimedia.org/wiki/File:Pilatus_PC-12_47_-HB-FPT-_(52645125454).jpg) | CC BY-SA 2.0 | /47 right side: ventral strakes, exhaust stubs, trailing-link gear, T-tail fairing, winglet |
| [ZS-JDD](https://commons.wikimedia.org/wiki/File:Pilatus_PC-12-47_ZS-JDD_(14992435622).jpg) | CC BY-SA 2.0 | /47 exterior |
| [Propeller and nose](https://commons.wikimedia.org/wiki/File:Pilatus_PC-12_propeller_and_nose.jpg) | CC BY-SA 3.0 | Spinner, four blades, chin inlet |

## Published references transcribed for the scaffold

| Quantity | Published value | Source / interpretation |
| --- | --- | --- |
| Span / length / height / wing area | 16.28 m / 14.408 m / 4.26 m / 25.81 m² | TCDS C.III.3. The POH three-view gives span 16.26 m "fully fuelled". Aspect ratio 10.27 (derived). |
| Track / wheelbase / horizontal-tail span | 4.53 m / 3.48 m / 5.20 m | POH Fig 1-1 three-view (47E, same airframe). W&B gear arms give a wheelbase of 3.45–3.66 m depending on strut extension, because the trailing-link main wheel moves aft as it compresses. |
| Engine installed limits | Take-off 1200 shp, 44.34 psi, 800 °C, 104 % Ng, 1700 Np (5 min). MCP / max climb / max cruise 1000 shp, 36.95 psi, 760 °C. Start 1000 °C for 5 s. Transient 61.00 psi, 870 °C, 1870 Np for 20 s. | TCDS C.III.4.3. **The 47E's 850/820 °C and 1200 shp MCP do not apply.** |
| Torque units | 44.34 psi = 3708 lbf·ft = 5028 N·m, so 83.63 lbf·ft/psi | TCDS and ETCDS. Check: 3708 × 1700 / 5252 = 1200 shp. |
| Speed references | Ng 100 % = 37 468 rpm. Prop 1700 rpm = PT 29 894 rpm, so the gear ratio is 17.585. | TCDS note; POH 2-6 note 8; ETCDS IV.2 |
| Propeller | HC-E4A-3D/E10477K(S); 2.67 m (104–105 in); clockwise from behind; at the 42 in station: fine 19°, ground minimum 17°, flight minimum 6°, reverse −17.5°, feather 79.6° | TCDS C.III.6. Stabilised ground operation between 350 and 950 rpm is prohibited. |
| Governors | CSU 1700 (1670–1730); overspeed governor 1802 (106 %); Nf governor 1853 (109 %); reverse maximum 1650; ground-idle Np about 1060 | 47E proxy §2-6, §7-11 |
| Levers | **PCL** (flight range forward of a lift-over idle detent; beta and reverse aft), **condition lever** (CUT-OFF/FEATHER – GROUND IDLE – FLIGHT IDLE), **MOR** emergency fuel lever. **No propeller lever.** | 47E proxy §7-10 pp. 677–681. This conflicts with owner-notes item 1; see research-pc12.md. |
| Speeds (KCAS) | Vmo 240 / Mmo 0.48; Vo 166 at 4740 kg; Vfe 165 (≤15°) and 130 (>15°); Vlo 180 / Vle 240 | TCDS C.III.9. Panel placards read in KIAS: Vmo 236, Vo 163, Vfe 163/130, Vlo 177, Vle 236. |
| Normal-procedure speeds (KIAS) | Vr 82 (flaps 15) / 76 (flaps 30); Vx 120; Vy 130 (SL) to 120 (FL200+); approach at MLW: flaps 40 85, flaps 0 120; best glide 119 at MTOW | 47E proxy §4.2, §3.2 |
| Stall (pusher) speeds at MTOW | Flaps 0 ≈95 · 15 ≈78 · 30 ≈70 · 40 ≈67 KIAS (flaps 40 = 65.4 at 9920 lb, from Vref/1.3) | 47E proxy Fig 5-2-1, chart-read ±2 kt and cross-checked against the 1.1/1.3 Vs1 speed schedules |
| Weights | Ramp 4760 / MTOW 4740 / MLW 4500 / MZFW 4100 kg; typical empty 2800 kg | TCDS C.III.12; 47E proxy §1 |
| CG and datum | 5.898–6.107 m at 4740 kg … 5.607–5.728 m at 2600 kg; datum 3.000 m ahead of the firewall | TCDS C.III.13–14. FRD conversion needs a chosen origin. Pilot arm 160.27 in (4.071 m). |
| Fuel | 1540 L total / 1522 L usable (201 US gal per wing); unusable 14.9 kg; imbalance limit 178 lb; low-fuel warning at 20 gal per side | TCDS C.III.8; 47E proxy §2, §7-12 |
| Pressurisation | 5.75 psid maximum; 10 000 ft cabin at FL300; land below 0.7 psid | 47E proxy §2-21, §7-17. Legacy placard confirms 5.75 psid. |
| Electrical (/47) | 28 V DC; GEN 1 300 A; GEN 2 115 A | FAA N 8900.428. Battery capacity and starter assignment are unconfirmed. |
| Flaps / trim | Fowler flaps 0/15/30/40°; moving-stabiliser pitch trim; electric aileron-tab and rudder-tab trim; aileron–rudder interconnect | 47E proxy §7-3 |
| Gear | Hydraulic; trailing-link mains retract inward; nose retracts aft; tyres 17.5×6.25-6 and 8.50×10 at 60 psi; pedal steering ±12°, castor ±60° | 47E proxy §7-4, §8; TCDS C.III.19 |
| Load factors | +3.4 / −1.36 g with flaps up; +2.0 / 0 g with flaps down | TCDS C.III.5 |
| Maximum altitude | 30 000 ft | TCDS C.III.10 |
| Glide | 65 NM from 25 000 ft (POH example), L/D ≈ 15.8 | 47E proxy Fig 5-2-46 |

## Geometry contract and panel interpretation

A future `src/aircraft/pc12/dimensions.ts` should take the TCDS external dimensions without tuning. Several values are **ESTIMATE** pending AFM 02211 or a measured survey:
- dihedral, about 5°, read from the three-view;
- incidence, twist and tail areas (measure from the three-view);
- gear transit time;
- control deflections;
- all panel and eye coordinates.

The legacy /47 panel is a hybrid:
- **Round mechanical gauges:** ASI, altimeter, VSI, RMI, flap gauge, cabin gauges.
- **EFIS:** an EADI and an EHSI on each side.
- **Engine data:** a centre EIS of small digital windows, with a CAWS grid beneath.

How to render the EFIS and EIS in an "analogue-style" panel is an agent design choice to confirm. The CAWS legend list comes from secondary training material and must be treated as provisional.
