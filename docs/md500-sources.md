# MD 500E (Hughes 369E) source and setup record

The selected aircraft is the **MD 500E, Model 369E, with the Rolls-Royce (Allison) 250-C20B**. Owner decision
(2026-10-16): a 5-blade fully articulated main rotor, a conventional 2-blade tail rotor and the pointed "E" nose. The following are agent choices: LH command (pilot
in the left seat, as in the RFM's standard configuration), standard skid gear (not the +0.87 ft extended gear), standard
non-self-sealing fuel cells, the analogue "late generic" panel of RFM Fig 4-2, and no optional kits (no particle separator, floats, cargo hook or
4-blade "scissors" tail rotor). The 250-C20R/2 alternate engine, the G500H glass cockpit and the 2023 crash-resistant fuel
configuration are recorded only to stop them being mixed in by mistake.

## Source hierarchy and cache

Retrieved 16 October 2026. The FAA-approved **RFM CSP-E-1** is the controlling document for limitations, procedures and performance.
Two operator reprints were obtained: a Rev 16 (21 March 2007) copy, used throughout, and a Rev 18 (28 July 2011) copy. They agree on Section II
limits and Section I capacities apart from the Rev 17 rewording of the N2 avoid range. Cite the **printed page and that page's revision
mark**, not the PDF page. The FAA **TCDS H3WE** copy is **Rev 21 (10 May 2003)**. The current revision (Rev 27, 2018, cited by the NZ CAA) could
not be fetched because FAA DRS was unreachable. Rev 21 Section IV agrees with the RFM limits word for word. Engine ratings come from **EASA TCDS IM.E.052** Issue 02.
MD's 2023 product specification and brochure are marketing documents. They supply cabin and panel sizes and cruise/climb/range figures that
are not in the RFM, and they contradict each other in places.

Downloads, `pdftotext -layout` extracts (`*.txt`, `*.paged.txt` with PDF page prefixes), rendered figures (`*/img/`) and
`manifest.json` (URL, bytes, SHA-256) live in ignored `work/pcmd/sources/md500/`. Git does not carry them, so copy that directory to worker
worktrees. Do not commit PDFs or photographs.

| Cached file | Primary document / use | Download |
| --- | --- | --- |
| `rfm/500e-rfm.pdf` | MD 500E RFM CSP-E-1 Rev 16 (2007): limitations, procedures, performance, W&B, Fig 1-1 three-view, Fig 4-2 panel, Fig 6-3 station diagram | [PDF](https://www.pilote-virtuel.com/img/members/12818/500e.pdf) |
| `rfm-heliczech/POH-MD500E.pdf` | Same RFM, Rev 18 (2011); revision cross-check only | [PDF](https://www.heliczech.cz/wp-content/uploads/2024/07/POH-MD500E.pdf) |
| `tcds-h3we-rev21/h3we-rev21.pdf` | FAA TCDS H3WE Rev 21, Section IV 369D/369E (pp12–15): engine ratings in ft·lb and psi, N1/N2 rpm, rotor limits, CG, seats, fuel/oil, MR/TR rigging, stabiliser incidence | [govdocs1 zip, member 097/097083.pdf](https://digitalcorpora.s3.amazonaws.com/corpora/files/govdocs1/zipfiles/097.zip) |
| `easa-engine-tcds/easa-tcds-ime052.pdf` | EASA IM.E.052 Iss 02: 250-C20B 313 kW, 100 % N1 50,970 / N2 6016 rpm, MGT and torque limits, accessory drives | [PDF](https://www.easa.europa.eu/sites/default/files/dfu/TCDS%20IME.052_Issue%2002.pdf) |
| `product-spec-2023/MD_500E_Product_Spec.pdf` | MD product specification 2023: cruise, climb, range, empty weight, cabin and panel dimensions, ~27 gal/h | [PDF](https://www.mdhelicopters.com/wp-content/uploads/2023/04/MD_500E_Product_Spec.pdf) |
| `brochure-2023/500E-Brochure.pdf` | 2023 brochure; extended-gear dimension drawing; conflicting performance footnotes | [PDF](https://www.mdhelicopters.com/wp-content/uploads/2023/04/500E-Brochure.pdf) |
| `nasa-cr-166256/nasa-cr-166256.pdf` | Hughes **500C** rotor (4-blade): NACA 0015, 9° washout, flap hinge 0.458 ft, R 13.133 ft, chord 6.75 in (via its +30 % case) | [PDF](https://ntrs.nasa.gov/api/citations/19820009247/downloads/19820009247.pdf) |
| `nasa-cr-3144/nasa-cr-3144.pdf` | Heffley et al. 1979, **OH-6A** data: chord, twist −8°, shaft tilt 3°, blade flap inertia, TR ratio 6.447, inertias, stick travels, derivatives | [PDF](https://ntrs.nasa.gov/api/citations/19800002851/downloads/19800002851.pdf) |
| `commons-photos/` | Wikimedia Commons reference photos (licences in research-md500.md §15); cockpit CC BY 2.5 Alan Radecki; G-SSCL public domain | [Commons](https://commons.wikimedia.org/wiki/File:Md500e-cockpit-aradecki-070316-01.jpg) |

## Resolved installation facts

- **Rotation**: the main rotor turns **counter-clockwise viewed from above**. The RFM states it directly through its consequences: left yaw on power loss (3-3), "nose turns right with power
  application, left with power reduction" (3-18), right pedal after a hover engine failure (3-5). TCDS p14 gives the large TR pitch (+27°) as "thrust to
  right", the anti-torque direction. The tail rotor is on the **left** side of the boom (photos; RFM Fig 1-1 top view).
- **Seats and controls**: LH command is standard (RFM 1-9, 2-1); an RH-command military layout exists. Seats at STA 71.5 (centre front), 73.5 (×2), 105
  (×2) (TCDS p13). Controls are mechanical with no hydraulic boost. Electric cyclic trim; a hydraulic one-way lock in the longitudinal cyclic; friction on the cyclic,
  collective and twist grip (RFM 1-10, 3-19). The twist grip goes CUTOFF / GROUND IDLE / FULL OPEN with an idle ring; the start button and N2 governor INC/DEC
  switch are on the collective head (Fig 4-4).
- **Engine and limits**: 250-C20B, 420 shp engine rating, derated in the installation to **375 shp T/O (5 min) and 350 shp MCP** (RFM 1-9; TCDS p12).
  Gauge torque: **87.2 psi = 318 ft·lb (T/O)**, **81.3 psi = 297 ft·lb (MCP)**, 74.3 psi MCP when TOT > 738 °C; transients 93.0 psi for 15 s and 97.6 psi for 3 s
  (RFM 2-5). TOT: T/O 810 °C, MCP 755/738 °C, start transient 927 °C for 1 s (above 810 °C for ≤ 10 s), light-off residual ≤ 150 °C. N1 105 % continuous
  (53,519 rpm), 106 % for 15 s, ground idle 64 %. N2 normal 102–103 %, avoid 75–88 %. Do not import the Robinson/Lycoming 5-minute MAP logic or the C208's
  PT6 ITT limits.
- **Drivetrain**: engine output (100 % = 6016 rpm) → overrunning clutch (automatic, no pilot control, no engagement step) → main transmission
  **12.59:1** (derived: 6196 rpm ÷ 492) → static mast with an inner drive shaft. A one-piece tail shaft runs to the TR gearbox. The TR ratio is unresolved (OH-6A 6.447 vs a secondary
  2933 rpm figure for the 500E). The S269/R22 clutch/belt fields must not be reused for this freewheel.
- **Governor**: the power-turbine governor holds N2. Beep range is ≤ 98 % to 104–105 %. N2 rises ½–1 % when take-off power is applied (RFM 4-22). On governor failure the
  pilot flies the twist grip manually at 102–103 % (RFM 3-14/3-15). Droop-compensator gain and governor dynamics were **not obtained**.
- **Gear**: skids attached at 12 points, **nitrogen-charged dampers** acting as springs and shock absorbers for ground-resonance stability (RFM 1-9). There are no
  charge pressures or stroke data. Track 6.45 ft.

## Geometry contract

Stations are in inches from the RFM datum (100 in forward of the rotor ℄, so the **hub is at STA 100.0**). WL 0 is the fuselage bottom. On the ground the deck is 4.7° nose up with full fuel. Imperial
source values take precedence. A future `src/aircraft/md500/dimensions.ts` should cite each group.

| Quantity | Source value | Source / treatment |
| --- | --- | --- |
| Main rotor | 26.4 ft diameter; 5 blades; hub STA 100.0, WL 83.0 (fairing top WL 89.5); shaft 3° forward | RFM Fig 1-1, Fig 6-3; tilt from OH-6A (Heffley) and the 3° cant lines, **3V/F** |
| MR blade | chord 6.75 in, NACA 0015, twist −8° (OH-6A) / −9° (500C) | **ESTIMATE** (4-blade family blade; no 369D21100 data) |
| MR flap hinge | 0.458 ft from the shaft | **ESTIMATE** (500C, CR-166256) |
| Tail rotor | 4.58 ft diameter, 2 blades, teetering ("semi-rigid"), hub STA 284.0, left side; lowest tip 2.0 ft above the ground | RFM 1-8, Fig 1-1, Fig 6-3 |
| TR blade | chord ~0.12 m, twist −8° | **ESTIMATE** (OH-6A) |
| Envelope | 30.81 ft overall turning; fuselage 23.88 ft; nose STA 15.0; nose to TR ℄ 22.42 ft | RFM Fig 1-1 |
| Cabin/gear | 4.57 ft wide; skid track 6.45 ft; belly 1.27 ft above ground; cabin roof 6.77 ft; hub top 8.72 ft | RFM Fig 1-1 (2023 spec gives a 1.77 ft belly, unresolved) |
| Skids | about 8.3 ft tube, about STA 28–128; struts about STA 78.5 / 124 | **3V** from Fig 1-1 / Fig 6-2 |
| Tail | boom root cant STA 197.78 at WL 55.34; upper fin top 8.4 ft above ground; T-stab span 5.43 ft at about WL 97 (top WL 102.17); lower fin/skid WL 25.5 | RFM Fig 1-1, Fig 6-3 |
| Stabiliser incidence | 8.92°–9.42° relative to a line perpendicular to the mast | TCDS p14; sign/airfoil/chord unknown |
| Occupants | pilot STA 73.5, BL −13.0; RH fwd +15.5; aft ±12.2 at STA 105 | RFM Fig 6-2 |
| Panel | 17.3 × 13.7 in panel; 16.3 × 10.1 in slant console; seat to panel 18.5 in | MD spec 2023 (**M**); layout per RFM Fig 4-2 |
| Inertia | OH-6A Ixx 446 / Iyy 1219 / Izz 979 / Ixz 128 kg·m² at 2550 lb | **F**; the 500E 3000 lb values (≈550/1500/1200/150) are **ESTIMATES** |

Nose shape, glazing frames, door outlines, gear fairings, tail-cone/exhaust, endplate toe and any upper-fin cant are **3V/photo estimates**
(Commons G-SSCL, D-HHRM series, Radecki cockpit).

## Performance and procedure evidence for the next worker

RFM 2-2 and Fig 2-6 give **Vne 152 KIAS**, reduced with PA/OAT and three weight bands (≤ 2000, 2001–2500, 2501–3000 lb). There is no-flight shading at
high/hot, and the autorotation Vne is the chart value −22 kt (85/90/95 kt minimum) capped at 130. Transcribe from the rendered images (`rfm/img/p-061.png`,
`p-062.png`), because the text extract loses merged cells. Vne is 130 KIAS with doors off or < 35 lb fuel.

Rotor 487–492 rpm power-on (102–103 % N2) and 410–523 rpm power-off (RFM 2-4). ENGINE OUT/low-rotor horn below 468 rpm or 55 % N1.
**Autorotation calibration target (RFM 4-25)**: collective full down gives 485 ± 5 rpm at 2250 lb, SL, 60 kt, −10 rpm per 100 lb lighter, +6.5 rpm per 1000 ft
DA. Minimum descent rate at 60 KIAS / 410 Nr; best glide at 80 KIAS / 410 Nr (RFM 3-3, 4-24).

Vy: 62 KIAS to ~5500 ft DA, then decreasing to ~53 KIAS at 16,000 ft (Fig 5-3). The IGE (3.5 ft skid, Fig 5-4) and OGE (Fig 8-1) hover charts have been
digitised by OAT and weight in research-md500.md §9 (for example, IGE ISA 8,450 ft and OGE ISA ≈ 5,900 ft at 3000 lb). The MD marketing hover headlines do not
match the charts at a single weight; do not tune to them. The H-V diagram knee is at ~49 KIAS and ~140 ft; the recommended take-off profile is to accelerate to ~36 kt at 5 ft
and reach 60 kt by 70 ft (Fig 5-15). Climb rate (1770 fpm), cruise (135 kt), range and fuel flow (~27 gal/h) come **only** from MD marketing.

Engine checks give the turboshaft model concrete targets. Light-off at 12–15 % N1; MR rotating by 25 % N1; starter released at 58–60 % N1; idle 64–65 % N1.
Snap deceleration from 103 % N2 must take ≥ 2 s to reach 65 % N1. Power check: 87.2 psi at 1000 ft / 20 °C gives 790 °C TOT. Shaft hp ≈ 4.30 × torque psi.

## Scaffold boundaries

Nothing in this record implies a calibrated 369E rotor. The blade aerodynamic data, hinge offset, lag damping, inertias, TR ratio and the governor/droop
compensator are estimates or gaps (research-md500.md §17). The T-tail stabiliser has a published incidence but no area or airfoil. The freewheel,
twist-grip fuel control and N2 governor are new turboshaft-stage behaviour (owner-notes item 4). Do not express them through the piston/clutch
fields used by the R22, R44 and S269.

## Readings made for the flight model (T2, 16 October 2026)

- **OH-6A derivatives** (Heffley CR-3144 Table II-3, printed pp 27–28, SI, per cm of control): cases 4 (hover) and 8
  (60 kt), 1157 kg, mid CG, read from the rendered pages (the text extract's OCR is unreliable). Transcribed in
  `tests/rotorcraft/oh6a.ts` with the full-travel controller table (Fig II-2: collective 22.9, longitudinal 31.8,
  lateral 29.2, pedal 9.3 cm). Units checked against the US-unit tables (L'δA 0.4956 /cm = 1.2588 /in). The hover
  trim of case 4 (θ 1.66°, φ −3.05°) is the family evidence for the hover-attitude row. **F**.
- **Control-system flexibility** (Heffley CR-3144 Fig II-2, printed p 22): a factor after each linkage gain, from
  full-scale wind-tunnel tests: collective 0.88, longitudinal 0.75, lateral 0.75, pedal 0.67. The linkage gains equal
  the 369A TCDS ranges, so the Table II-3 derivatives include the factor. Used as `controlFlex` in
  `src/aircraft/md500/rotorcraft.ts` (cyclic and pedal; the collective 0.88 is not applied, see KNOWN_ISSUES). The
  pivots (zero-cyclic swashplate; tail pitch range centre +6.5°) are **ESTIMATE**; the factors are **F**.
- **Hinge offset**: the 500C's 0.458 ft plus the inch by which the 500D hub is wider (heli-archive, **S**): 0.165 m.
- **Tail-rotor hub height**: Fig 1-1's 2.0 ft tip clearance is in the 4.7° nose-up ground attitude, which lowers
  STA 284 by 15.1 in; in level axes the hub is at WL 51.4 (**D**; the OH-6A's is WL 54.3).
- **Stabiliser**: TCDS p14's 8.92–9.42° to the mast normal read leading edge UP (+6.17° to the waterline) with an
  inverted cambered section (zero-lift +6°, ESTIMATE): a download at every forward speed, as heli-archive (**S**)
  says; the leading-edge-down reading puts the nose 0.9° up at 120 KIAS (docs/md500-flight-model.md).
- **"Design gross weight"** in the 2023 specification's performance table (p7) is not defined; its weights row gives
  the normal capacity, 3000 lb, which the climb row uses (**M**).
- **ENGINE OUT horn**: late-generic harness (S/N 509E on): the audio is enabled by the generator switch (RFM 1-11,
  3-25 note); auto-reignition armed by transmission oil pressure, the igniter firing until RE-IGN P RST is pressed
  (RFM 1-13).
