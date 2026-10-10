# R44 Raven II sources and groundwork

Retrieved 9 October 2026 from [Robinson publications](https://www.robinsonheli.com/publications) and the [R44 Raven II product page](https://www.robinsonheli.com/helicopters/r44-raven-ii-clipper-ii). These are R44 **II** sources, not Raven I or R22 performance data. PDFs contain mixed page revisions; cite the printed section/page and that page's revision when deriving a value. The Section 1 dimensions page is dated 26 January 2024; the Section 7 panel figure is dated 5 March 2015.

The actual PDFs, photographs, `pdftotext -layout` extracts and selected rendered figures are in ignored `work/r44-sources/`. `manifest.json` records each asset's exact URL, byte count and SHA-256. `publications.html` and `raven-ii.html` preserve the discovery pages. This cache is **not carried by git**: copy it into successor worktrees or download the links below. Do not commit source PDFs, photographs or scratch notes.

## Source inventory

| Document (link downloads the cached edition) | Sections/figures and use |
| --- | --- |
| [R44 II complete POH](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r44ii_poh_full_book_0586eefd22.pdf) | Complete handbook including supplements; use the separately cached sections for convenient page references. |
| [R44 II POH section 1](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r44ii_poh_1_b4fce9d9be.pdf) | General: 1-3 three-view; 1-4 rotor diameter/chord/twist, drivetrain and engine; 1-5 weight/fuel; 1-6 RPM references. |
| [R44 II POH section 2](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r44ii_poh_2_4c17ab4577.pdf) | Limitations: 2-1/2-2 Vne, rotor/engine RPM and power; 2-3/2-4 weight/CG; 2-6 fuel; 2-7/2-8 instrument markings; 2-9 MAP/Vne placards. |
| [R44 II POH section 3](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r44ii_poh_3_d503a5c639.pdf) | Emergency procedures, warning indications, hydraulic/governor/engine failures and autorotation; 3-9 low-fuel indication. |
| [R44 II POH section 4](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r44ii_poh_4_13dccff3ed.pdf) | Normal procedures: fuel-injection starting/priming, clutch engagement, 75% magneto check (7% drop maximum in 2 s), hydraulic and 97% low-RPM checks. |
| [R44 II POH section 5](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r44ii_poh_5_51ab31a1ff.pdf) | Performance: 5-1 conditions; 5-2 ASI calibration; 5-3 density altitude; 5-4 IGE and 5-5 OGE hover ceilings; 5-6 height/velocity; 5-7 noise. |
| [R44 II POH section 6](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r44ii_poh_6_1082c5edde.pdf) | Weight/balance: 6-4 longitudinal/lateral arms and loading limits; 6-6 sample empty weight/CG; sample calculations and records. |
| [R44 II POH section 7](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r44ii_poh_7_e5154ae439.pdf) | Systems: rotor/drive/fuel-injected engine; 7-6 controls/governor; 7-7 hydraulics; 7-13 electrical; 7-21 instrument-panel figure; 7-23/7-25 tachometer and low-RPM warning. |
| [R44 II POH section 8](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r44ii_poh_8_fb35fd368d.pdf) | Handling/maintenance: ground handling, storage, servicing and inspection context; no aerodynamic calibration tables. |
| [R44 MM chapter 4](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r44_mm_4_8117b796b6.pdf) | Airframe: tailcone, empennage, cowling, firewall and attachment/component figures; useful external construction references. |
| [R44 MM chapter 5](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r44_mm_5_a1682e91bc.pdf) | Landing gear: skid/cross-tube assemblies, attachment and inspection figures; impact limits must not be inferred from illustrations. |
| [R44 MM chapter 6](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r44_mm_6_4d61be8443.pdf) | Powerplant: IO-540-AE1A5 installation and engine accessories/fuel-injection components; section 6.002 distinguishes engine capability from installed limits. |
| [R44 MM chapter 7](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r44_mm_7_2571b46119.pdf) | Drive system: belts, clutch actuator, sheaves, main/tail gearboxes and drive shaft assemblies. |
| [R44 MM chapter 8](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/R44_MM_Chapter_8_Flight_Controls_75870dc7b8.pdf) | Flight controls: cyclic/collective/pedal linkages, hydraulic servos and installation figures. Use this legacy chapter for detail, not the reserved chapter 25. |
| [R44 MM chapter 9](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r44_mm_9_c2f56fa757.pdf) | Redirect only: main rotor moved to chapter 28, tail rotor to chapter 30. No usable rotor figures here. |
| [R44 MM chapter 10](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/R44_MM_Chapter_10_Rigging_Track_and_Balance_f4bf5cacf1.pdf) | Rigging/track/balance: 10.122 collective travel; 10.140 tail pitch; 10.150 throttle correlation; 10.250 and Figure 10-17 autorotation RPM versus atmosphere/loading/CG. |
| [R44 MM chapter 13](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r44_mm_13_7c751909f4.pdf) | Instruments: installation, tachometer/warning circuitry, sensor/switch references and equipment variants. |
| [R44 MM chapter 15](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/R44_MM_Chapter_15_Furnishings_c26aa4c969.pdf) | Furnishings: front/rear seats, cushions, restraints, interior equipment and installation figures. |
| [R44 MM chapter 16](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r44_mm_16_98b54d8fd7.pdf) | Dimensions/access: section 16-40, Figure 16-1 standard skid three-view (page 16.3); later figures include other configurations. Figure 16-5 antenna locations. |
| [R44 MM chapter 18](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r44_mm_18_bddea714d6.pdf) | Weight/balance: weighing/levelling and equipment/component weights. No complete airframe or rotor inertia tensor found. |
| [R44 MM chapter 25](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r44_mm_25_3e7c396451.pdf) | Hydraulics: RESERVED, no substantive figures or specifications. Use POH 7-7 and MM chapter 8. |
| [R44 MM chapter 26](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r44_mm_26_6c39b291c6.pdf) | Lighting: lighting assemblies/locations. This is NOT the R22 main-rotor chapter. |
| [R44 MM chapter 27](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r44_mm_27_4f43bd8976.pdf) | Windows/doors: door and transparency construction/installation figures. |
| [R44 MM chapter 28](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r44_mm_28_7c9d5c00bb.pdf) | Main rotor: head, hub, spindle, bearing and blade assemblies; Figure 28-19 blade painting reference. |
| [R44 MM chapter 29](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r44_mm_29_1d9a2dc53e.pdf) | Main rotor drive: RESERVED. Use legacy chapter 7. |
| [R44 MM chapter 30](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r44_mm_30_ffba390286.pdf) | Tail rotor: blade/hub/pitch mechanism assemblies; Figure 30-6 blade painting reference. |
| [R44 MM chapter 31](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r44_mm_31_dc9f8ab312.pdf) | Tail rotor drive: RESERVED. Use legacy chapter 7. |
| [R44 MM chapter 32](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r44_mm_32_372a888a2c.pdf) | Engine controls: RESERVED. Use legacy chapters 6/8/10 and POH 7. |
| [R44 illustrated parts catalogue chapter 6](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r44_ipc_6_ae3b6d8665.pdf) | Dimensions/access reference figures; cross-check configuration against POH/MM. |
| [R44 illustrated parts catalogue chapter 95](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r44_ipc_95_1f11c46dc0.pdf) | Instrument-panel installation and component arrangements; several equipment configurations, not a single universal layout. |

## Manufacturer photographs

- [R44_Raven2_Clipper2_console1_13bba6cd21.jpg](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/R44_Raven2_Clipper2_console1_13bba6cd21.jpg): Manufacturer cabin/centre instrument console photograph.
- [R44_Raven2_Clipper2_console2_8b7f39d1c2.jpg](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/R44_Raven2_Clipper2_console2_8b7f39d1c2.jpg): Alternate cabin/console photograph.
- [OE_Eight_Hole_Instrument_Panel_9a88860f3d.jpg](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/OE_Eight_Hole_Instrument_Panel_9a88860f3d.jpg): Manufacturer eight-hole panel photograph: four instruments across, engine shelf below, narrow centre pedestal.
- [R44_R2_C2_Gallery_Mobile1_201acf8638.jpg](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/R44_R2_C2_Gallery_Mobile1_201acf8638.jpg): Manufacturer exterior reference photograph.
- [R44_R2_C2_Gallery_Mobile2_06e2811bc8.jpg](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/R44_R2_C2_Gallery_Mobile2_06e2811bc8.jpg): Manufacturer exterior reference photograph.
- [RAVEN_II_LEFT_v2_new1_06c267b7a0.png](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/RAVEN_II_LEFT_v2_new1_06c267b7a0.png): Manufacturer left-side exterior image.
- [lycoming_io_540_engine_a79088c377.png](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/lycoming_io_540_engine_a79088c377.png): Manufacturer IO-540 engine image.

## Published references transcribed for the scaffold

| Quantity | Published value | Source / interpretation |
| --- | --- | --- |
| Main rotor | Diameter 33 ft (10.0584 m); chord 10.0 in inboard / 10.6 in outboard; twist −6° | POH 1-4. Shared renderer accepts chord stations; placeholder physics uses their mean. |
| Tail rotor | Diameter 58 in (1.4732 m); chord 5.1 in; zero twist; 1° precone | POH 1-4. Rotor sits left of the boom in the three-view. |
| Overall length / height | 459 in (11.6586 m) / 129 in (3.2766 m) | POH 1-3 and MM 16-40 standard-skid drawing. Rotor head top, not teeter-centre height. |
| Horizontal stabiliser span | 66 in (1.6764 m) | MM 16-40 Figure 16-1, February 2024, F004-2 empennage. Chord and location remain estimates. |
| Skid tread / cabin width | 86 in (2.1844 m) / 50.5 in (1.2827 m) | Same drawings. |
| Cabin height / longitudinal envelope | 72 in (1.8288 m) / 353 in (8.9662 m) | Same drawings. The 353 in dimension includes the aft tail-rotor tip: `FUSELAGE_LENGTH` is the nose-to-tail assembly envelope, not shell length. |
| Tachometer references | Engine 100% = 2665 RPM; rotor 100% = 400 RPM | POH 1-6. Do not use the R22's 2550/510 references. |
| Rotor operating limits | Power on 101–102% (404–408 RPM); power off 90–108% (360–432 RPM) | POH 2-2. Rotor instrument green arc is 90–108%; engine green arc 101–102%, POH 2-7. |
| Governor / low-RPM warning | Governor above 80% engine RPM; low-RPM warning at 97% | POH 7-6, 7-25; raised-collective check in section 4. Switch deadband/gains/timing are not published calibration. |
| Engine / installed power | Lycoming IO-540-AE1A5, six cylinders, fuel injection, 541.5 cu in; 205 hp MCP / 245 hp five-minute takeoff | POH 1-4, 2-2. MM 6.002 engine capability is not the installed helicopter power limit. |
| Drive ratios | Belt reduction .778; main gearbox 11:57; tail gearbox 31:27 | POH 1-4. Scaffold uses 2665/400 engine-to-main ratio (rounded tach references) and (57/11)×(31/27) tail-to-main ratio. |
| Controls | Three irreversible hydraulic servos for main cyclic/collective; mechanical tail-rotor pedals | POH 7-6/7-7; pump on main gearbox, 450–500 psi. Servo isolation removes normal rotor feedback forces; hydraulic-off/failure modelling remains future work. |
| Electrical | 28 V system | POH 7-13. Battery capacity, loads, starter/alternator and threshold calibration remain scaffold estimates. |
| Fuel with bladders | Main usable 29.5 US gal; auxiliary usable 17.0 US gal; total usable 46.5 US gal | POH 2-6. Non-bladder tanks should no longer be in service per that page. Loading uses POH 6 lb/US gal. |
| Weights | Maximum 2500 lb; minimum 1600 lb; seat plus baggage limit 300 lb, baggage compartment limit 50 lb | POH 2-3, 6-4. The 1510 lb empty weight / station 106.5 in / lateral +0.2 in used here are a **sample aircraft** from 6-6. |
| Occupant arms | Front longitudinal 49.5 in; rear 79.5 in. Right front +12.2 in, left front −10.4 in; rear ±12.2 in lateral | POH 6-4, datum 100 in ahead of mast. FRD conversion: x = (100 − station)×0.0254; y = lateral×0.0254. Vertical occupant/eye coordinates remain estimates. |
| Fuel arms | Main longitudinal 106 in / lateral −13.5 in; auxiliary 102 in / +13.0 in | POH 6-4. Tank vertical arms estimated. |
| MAP placard | MCP grid at 2000 ft / 10°C intervals; takeoff increment 2.8 inHg | POH 2-9. `r44/limits.ts` transcribes the printed cells; null means full throttle. Shared interpolation handles consecutive null rows. |
| Vne | 130 KIAS at ≤2200 lb TOGW; 120 above 2200 lb; autorotation 100; 100 above MCP or with doors removed | POH 2-1/2-9. Altitude/OAT grid in `limits.ts`; weight/power-off/doors-off corrections **not yet applied** by scaffold physics. |
| Collective rigging | Down 1–2°; full-up travel 12.5–13.5° above down setting before autorotation adjustment | MM 10.122, page 10.11. Fixture at 49.5 in from tip (75% radius). **These are fixture-referenced rigging angles**, not automatically solver section incidence. Scaffold retains R22 rigging pending conversion/validation. |
| Autorotation target | Figure 10-17 gives atmosphere/loading target and +0.75% rotor RPM per inch CG forward of station 100 | MM 10.250. Use to validate low-collective behaviour alongside POH landing limits; no R44 autorotation acceptance claim yet. |

## Geometry contract and panel interpretation

`src/aircraft/r44/dimensions.ts` is the sole FRD metre reference, with x forward, y right, z down and origin on the main-mast axis. `SKID_Z = 1.10` is an **estimated origin convention**, not a measured CG. Published external dimensions are converted without tuning. Nose and tail hub longitudinal coordinates are derived from the three-view envelopes with blades fore/aft. Main hub vertical offset, tail hub side/height, skid endpoints/contact points, fin/stinger outlines and stabiliser chord/location, pilot eye and all panel coordinates are explicitly marked **ESTIMATE**. There is no surveyed cockpit or production CAD available in this cache.

The brief describes a full-width panel above a pedestal. POH 7-21 and Robinson's eight-hole panel photograph instead show a broad **four-instrument-wide central pod**, above a narrow centre pedestal; it does not span the 50.5 in cabin width. That evidenced arrangement is the scaffold contract, wider than the R22's three-column pod. Nominal 3-1/8 in gauge cases provide the photograph scale. The optional right-side accessory/avionics console is omitted. `PANEL_CANVAS` is 1152×1872 at 2400 px/m (0.48×0.78 m face); outline, 15° rake, location, support and enclosure depth are estimates. A single planar UV face approximates the real changes in rake between upper instruments, engine shelf and pedestal. Exterior and panel agents must agree through the supervisor before changing this shared contract.

## Shared-code audit and boundaries

- Rotorcraft IDs and save validation accept R44, while its catalogue row remains unavailable. `RotorcraftState` and the clutch/governor/horn state meanings are unchanged.
- Governor acquisition, low-RPM/power-check thresholds, collective horn switch and input collective slew rate are aircraft data. R22 receives its original values. Position inputs already imply no simulated feedback force; hydraulic actuation metadata identifies the R44 installation without claiming a hydraulic-system simulation.
- Optional payload point distributions support the four seat locations and right-seat solo loading. Legacy loadings still use their original two-point distribution. Distribution fractions sum to one and fraction-weighted offsets sum to zero about `payloadPosition`.
- Shared visuals accept panel support dimensions independent of face width, enclosure depth, voltage thresholds, cyclic stem/grip coordinates, pedal height, seat-back height, skid tube/attachment geometry, rotor paint and coning parameters. The R44 cowling hides the R22-specific exposed four-cylinder detail. Existing defaults retain R22 rendering behaviour.
- Instrument dynamics already accept per-type tach references, markings and lamp predicates. R44 supplies 2665/400 references, a 28 V profile and its own placeholder panel/HUD. Development pages now support R44 rotor fixtures. Sound supports six cylinders and per-type rotor gearing; the R44 sound profile is synthetic and uncalibrated.
- The observation/scenario helpers can receive rotor definition data. `R22Flight`, its tuned control gains and the existing `demo=` scripts remain explicitly R22-only; they are not enabled for R44.
- The teetering-rotor renderer still has R22-derived hub hardware proportions. A future exterior implementation may need additional data or a separate R44 builder; no R44 head fidelity is claimed. No fully articulated 269 rotor is implemented by this work.

## Work remaining before release

All files under `r44/` are a development scaffold, hidden from the chooser. Published dimensions, engine identity and limits do **not** validate the inherited R22 aerodynamics. Rotor/airframe inertias, airfoil data, collective/pedal/cyclic rigging, ground contact, stabiliser/fins, governor/clutch response, engine thermals/induction and performance require independent R44 work. Validate against hover charts, installed power, fuel flow and MM autorotation targets without tuning merely to tests. Section 5 has no complete drag polar or inertia tensor; these were not found in the downloaded manuals.

Fuel-injection priming, clutch-switched auxiliary pump logic, interconnected tank flow and fuel-pressure warnings are unfinished. Hydraulic switch/failure/feedback behaviour is absent. The panel still needs proper dial graduations, engine red lines, the 100 KIAS cross-hatch, complete engine limits/annunciators/placards and verified controls. Exterior/cockpit details, rotor paint/head and sounds are temporary. No R44 flight lessons, demonstrations or approved checklists are provided. The three-worker ownership handoff is in ignored `work/r44-plan.md`.
