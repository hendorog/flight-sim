# Schweizer 269C-1 / 300CB source and setup record

The selected aircraft is the **carburetted, two-seat 300CB**, specifically the S/N 0106–0138 configuration: Lycoming HO-360-C1A, standard right-hand PIC, one 33 US gal main tank (32.5 usable), no optional STAR kit. This avoids combining early tank sizes with the later injected 300CBi. It remains a hidden, explicitly unfinished scaffold (`?aircraft=s269`). No handling, performance or training acceptance is claimed.

There is no compelling reason to substitute the three-seat 269C / 300C. The 300CB already provides the intended two-seat training role, manual throttle and a fully articulated rotor; changing to the 300C would introduce different engine, weight, loading and performance data without resolving the missing rotor dynamics data.

## Source hierarchy and cache

Retrieved 11 October 2026. The manufacturer's current [flight manual page](https://schweizerrsg.com/pages/flight-manuals), [publications page](https://schweizerrsg.com/pages/technical-publications) and [bulletin archive](https://schweizerrsg.com/pages/service-bulletins-letters) supplied the Shopify links below. Use the **printed revision of each PDF**, not the page title or URL query timestamp. The full RFM obtained is CSP-C1-1, reissued 16 January 2019; its manufacturer and ETL copies have identical SHA-256 hashes. This is source evidence, not a claim that the cache is a current operational publication set.

The correct FAA type certificate is **4H12**, not H3EA (which belongs to Boeing 114A). FAA DRS exposed its application shell; the actual FAA revision 32 sheet dated 30 March 2018 was obtained from EASA's public consultation attachment. EASA's own IM.R.136 issue 6 is dated 19 March 2025. Do not silently prefer the newer European summary when it conflicts with the selected FAA/RFM installation.

Downloads, extracted text, figure images and `manifest.json` (URL, bytes, SHA-256) live in ignored `work/s269-sources/`. Copy that directory to worker worktrees; git will not transfer it. The full Basic HMI CSP-C1-2 was not freely obtained. The manufacturer's index identifies it, but the publications service routes to Veryon. Public bulletins and an NTSB-hosted excerpt provide a limited set of maintenance figures.

| Cached file | Primary document / use | Download |
| --- | --- | --- |
| `rfm-2019.pdf` | ETL mirror of CSP-C1-1, 2019; corroborating identical copy | [PDF](https://www.etlaviation.com/wp-content/uploads/_resources/Schweizer-300-POH-Flight-Manual-269C-1-300CB-300CBi.pdf) |
| `CSP-C1-1G.pdf` | Optional LEFT-hand PIC installation supplement; not selected | [PDF](https://cdn.shopify.com/s/files/1/1008/9286/8689/files/CSP-C1-1G.pdf?v=1788234452) |
| `CSP-C1-1I.pdf` | Optional STAR startup RPM limiter, automatic clutch engagement and low-RPM warning; not selected | [PDF](https://cdn.shopify.com/s/files/1/1008/9286/8689/files/CSP-C1-1I.pdf?v=1772537197) |
| `Flight-Manual-269C-1-300CB-CBi-CSP-C1-1.pdf` | Manufacturer CSP-C1-1; selected limits, systems, geometry, performance, W&B | [PDF](https://cdn.shopify.com/s/files/1/1008/9286/8689/files/Flight-Manual-269C-1-300CB-CBi-CSP-C1-1.pdf?v=1772539456) |
| `C1B-007.pdf` | Main rotor hub/shaft inspection notes, S/N001–082 and specified spare hubs; no drawing or hinge dimensions | [PDF](https://cdn.shopify.com/s/files/1/1008/9286/8689/files/C1B-007.pdf?v=1788235857) |
| `C1B-017-1.pdf` | Electric lateral trim spring/housing figure; S/N169–191 applicability is later than selected CB | [PDF](https://cdn.shopify.com/s/files/1/1008/9286/8689/files/C1B-017-1.pdf?v=1788235857) |
| `C1B-040_6-30-15.pdf` | Upper pulley/belt drive exploded figure; all269C-1 S/N S0001 onward | [PDF](https://cdn.shopify.com/s/files/1/1008/9286/8689/files/C1B-040_6-30-15.pdf?v=1788235982) |
| `Reissued-CSP-P1-1-Publication-Index-1.pdf` | Publication index locating CSP-C1-2 HMI, section 8 and Appendix C | [PDF](https://cdn.shopify.com/s/files/1/1008/9286/8689/files/Reissued-CSP-P1-1-Publication-Index-1.pdf?v=1790864267) |
| `L-120.pdf` | Hughes letter 31 July 1981; 269-series PN269A1290-1 elastomeric lead-lag damper, handling loads | [PDF](https://cdn.shopify.com/s/files/1/1008/9286/8689/files/L-120.pdf) |
| `L-139.pdf` | 269-series elastomeric-damper cleaning letter; construction context, not CB calibration | [PDF](https://cdn.shopify.com/s/files/1/1008/9286/8689/files/L-139.pdf) |
| `L-31.pdf` | 1967 family oleo maintenance figures; historical geometry only, not current CB servicing values | [PDF](https://cdn.shopify.com/s/files/1/1008/9286/8689/files/L-31.pdf) |
| `easa-tcds-269.pdf` | EASA IM.R.136 issue 6; cross-check engine/serial applicability; seating conflict below | [PDF](https://www.easa.europa.eu/en/downloads/18679/en) |
| `faa-saib-sw-17-29.pdf` | FAA SAIB SW-17-29, 10 October 2017, archived by APSA; ground resonance and damper inspection | [PDF](https://publicsafetyaviation.org/wp-content/uploads/apsa-images/Press_Release_A/SW-17-29_FAA_Bulletin_Schweizer_Aircraft.pdf) |
| `faa-4h12-rev32.pdf` | FAA 4H12 rev 32, pp12–15 and notes: engine, seating, RPM, fuel, rigging, oleo charge | [PDF](https://hub.easa.europa.eu/crt/docs/viewcrdattachment/cid_147701/aid_3224/fmd_d77d76be8ddb66b64737b8fcbd491bdf) |
| `hmi-throttle-rigging.pdf` | NTSB docket HMI section 4 excerpt, reissued 13 Dec 2004, pp4-2/4-3, Fig4-1 sheet1 throttle/control drawing; public docket copy has highlighted/obscured labels | [PDF](https://data.ntsb.gov/Docket/Document/docBLOB?FileExtension=.PDF&FileName=Maintenance+Records+Throttle+Control+Rigging+Procedure-Master.PDF&ID=40467451) |

## Dynamics references (not Schweizer calibration)

Also cached with hashes: [NASA TM-100023, Chen (1987)](https://ntrs.nasa.gov/api/citations/19880003113/downloads/19880003113.pdf), `nasa-tm-100023.pdf`, derives coupled flap/lag equations for three hinge sequences, including inertia, aerodynamic, spring and damper generalized forces. The actual 269 hinge sequence must be identified before applying those equations. [NASA TM-86669, Johnson (1985)](https://ntrs.nasa.gov/api/citations/19850016009/downloads/19850016009.pdf), `nasa-tm-86669.pdf`, discusses rotorcraft aeroelastic stability, lead-lag/body coupling and ground resonance. Neither supplies the missing 300CB inertias, hinge offsets or damper coefficients. The implementation proposal uses these as theory references and explicitly identifies its own simplified equations/decisions.

## Resolved installation facts

- **Rotor head:** RFM 1-7 explicitly describes three blades with separate flapping and lead-lag hinges. This is a mechanically articulated hub; elastomeric **lag dampers** do not make it an elastomeric hingeless rotor. L-120 applies to 269-series installations with PN269A1290-1 and identifies excessive lead-lag handling loads as damaging to the elastomeric element. FAA 4H12 rev 32 Note 9(b), p19, explicitly lists **elastomeric damper 269A1290-3 for 269C-1 S/N 0001 onward**, confirming the CB installation. L-120 describes the older -1 family part; it is supporting construction context, not the selected part or a damping law. Exact hinge offsets and damper characteristics still need CSP-C1-2/IPC data. Older family friction-damper configurations must not be substituted silently.
- **Rotation:** CCW viewed from above is inferred from the RFM 1-11 rightward tail thrust with left pedal and 3-2 left yaw after power loss. Tail disc is on the left in Fig 1-1; the single canted horizontal stabilizer is on the right. Tail rotor spin about its own local axis is still an ESTIMATE pending an explicit HMI arrow/drive drawing.
- **Seats and controls:** RFM 1-5 identifies standard RIGHT PIC. FAA 4H12 p13 lists two seats/right PIC, and a separate three-seat/left-PIC arrangement. Optional CSP-C1-1G covers left-PIC conversion. EASA's generic 269C-1 table says left PIC and two passengers; that is not the selected standard two-seat RFM configuration. Both seats have individual cyclic sticks and pedals; each collective is to the pilot's left. RFM 1-5 and 4-15 describe mechanical controls and electrically operated longitudinal/lateral spring trim, with adjustable friction. There are no hydraulic flight-control servos. The NTSB HMI figure shows the right collective throttle cable/override linkage.
- **Engine:** RFM 1-6/2-6 and FAA 4H12: HO-360-C1A carburettor through S/N 0138; HIO-360-G1A injection from S/N 0139. The selected HO engine supplies 180 hp at 2700 RPM for takeoff **and** continuous operation. Do not import the 300C's rating/weight, the CBi fuel system, a Robinson five-minute power split, or a Robinson governor.
- **Drivetrain:** RFM 1-7: lower engine pulley, multiple belts and pilot-controlled idler tensioner, upper pulley with overrunning clutch, shaft and main transmission. Freewheel lets the rotor drive the transmission/tail without driving the engine or belts during autorotation. RFM 4-15/16 requires ENGAGE/HOLD/RELEASE during staged engagement at 1500 engine RPM. STAR is optional automation for starting; it is not a normal flight governor. Exact pulley/tooth ratios and drive-shaft torsional damping have not been obtained.
- **Gear/resonance:** RFM 7-13 specifies four nitrogen-charged hydraulic poppet oleos and warns of destructive ground resonance if they do not function correctly. FAA 4H12 p14 specifies front PN269A3150-19 at 350 psi and aft -21 at 725 psi. These pressures are NOT spring/damping coefficients. The RFM main-tank-only empty-aircraft/full-fuel inspection minima are aft right/left 8.4/8.0 in and front right/left 9.1/8.7 in between specified cap shoulders (with an HMI recheck caveat for aft readings below 8.0). These are inspection dimensions, not mounting distances or dynamic strokes. FAA SAIB SW-17-29 points to C1B-041 and HMI load/stroke inspection; charge, oil loss and degraded dampers matter. Full damper force/stroke/velocity data remain missing.

## Geometry contract

`src/aircraft/s269/dimensions.ts` is the sole shared reference: FRD metres, mast x=0, vertical origin by convention, compressed standard skids. Every numerical group identifies publication or estimate. Imperial source dimensions control over rounded metric entries.

| Quantity | Source value | Source / treatment |
| --- | --- | --- |
| Main rotor | 26.83 ft diameter; 6.75 in chord; three NACA0015 blades; −8°39′ twist | RFM 1-8 |
| Tail rotor | 4.25 ft diameter; 4.81 in chord; two modified NACA0014 blades; −8° twist | RFM 1-9 |
| Envelopes | 30.83 ft turning; 24 ft stopped with one blade trailing; 22.19 ft skid front to tail skid | RFM 1-9/10, Fig 1-1; 24 ft is not fuselage length |
| Cabin/gear/hubs | 4.25 ft cabin width; 6.54 ft compressed tread; 8.25 ft skid; 8.72 ft top of hub; 15.29 ft hub separation | RFM 1-9/10, Fig 1-1 |
| Tail clearance | 2.63 ft minimum tip-to-ground | RFM 1-10; tail hub height derived using radius |
| Horizontal stabilizer | one right-hand surface, 2.50 ft span, 12.7 in chord, 35° dihedral, 9.8° incidence, 2.65 ft² stated area | RFM 1-9; span interpreted along surface, location/sign of aerodynamic incidence unverified |
| Vertical fin | triangular, 1.25 ft span, 23.6 in root chord, zero tip, 1 ft² stated area | RFM 1-9; metric root chord misprints 60 mm instead of ~600 mm |
| Occupant arms | FS83.2; left −13.8 in, right +12.8 in; datum 100 in ahead of mast | FAA p13, RFM 6-9/10; eye is a separate estimated posture |
| Main flap/lag offsets | 0.18 / 0.22 m | **ESTIMATES**, not measured or aerodynamic calibration |
| Console | 1152×1440 px at 2400 px/m, 0.48×0.60 m flat face, 12° rake | **ESTIMATES/design choices** from RFM Fig 4-2A broad rectangular face; no cockpit survey |

Nose, cabin height, hub hinge-plane offset below hub top, tail lateral displacement, skid longitudinal placement/contact stations, oleo mounts/radii, fin sweep, stinger tube/shape, seat vertical locations, eye and panel position/depth/support are estimates from the three-view/panel drawing. Initial panel outline was corrected after viewing Fig 4-2A: it has a full rectangular lower face, not a Robinson narrowed console. No R22/R44 geometry values were changed. Renderer-only decorative details remain temporary R22 parts.

## Performance and rigging evidence for the next worker

RFM 2-3 gives 94 KIAS sea-level Vne and 90 with doors off. Table 2-1 on 2-2 provides pressure-altitude/OAT Vne; `limits.ts` transcribes the actual 0/4/6/8/10/12 kft columns and adds an interpolated 2 kft row solely for the existing uniform-grid representation. Blank hot/high cells are treated as outside the published envelope (zero), not invented speeds. This table needs proper placard presentation.

RFM 1-8/2-6: powered rotor 442–471 RPM, unpowered 390–504. RFM engine minimum is 2530 RPM; FAA rev 32 says 2534. Preserve that conflict until a current applicable limit is confirmed. `reference.ts` uses 2700/471 only as temporary instrument scaling; these are upper operating limits, not a claimed 100% or governor setpoint. The ratio 2700/471 and tail 3094/471 are estimates from rounded limits.

RFM 1-10 lists collective down 2.5±1.5° at 0.75R, travel 12±1°. Forward cyclic 8.5–9.5°, aft/left 6.5–7.5°, right 4.5–6.5°; FAA's forward upper value is 9.75°. Tail pitch −12±1° to +26±1°. Rigging angles require proper blade-section/fixture and control phase interpretation; they are not automatically the averaged solver's command angles.

RFM 5-1 gives Vy 41 KIAS, with carburetted/injected distinctions on performance pages. Carburetted **Figures 5-3 and 5-4 (printed pages 5-4 and 5-4.1)** specify 2 ft skid height,2700 RPM, full throttle, carb heat OFF, upstack exhaust and no main-blade abrasion tape. Figure 5-3 is **full rich**; Figure 5-4 is **leaned**. They are not doors-on/off charts. Injected Figure 5-4A is on page 5-5; page 5-4.2 is blank. Do not use that CBi chart or 300C charts as CB targets. Cache the chart images before digitising and retain atmosphere/weight/wind conditions. No suitable CB OGE, transient control-response, inertia, flapping-phase or lag-damping dataset was obtained. The headline hover ceiling is not a universal mass-independent target.

RFM 3-1 power-failure guidance supplies approximately 52 KIAS autorotation, flare near 50 ft and level near 10 ft. These are procedural references, not a measured sink-rate/energy or touchdown envelope. Rotor 390–504 RPM remains the hard published auto band. Validate decay, glide and flare against actual evidence; do not calibrate to make an inherited landing test pass.

RFM 2-5/FAA:1750 lb maximum, longitudinal 95–101 in and lateral −2.5/+4 in CG. RFM 6-6 sample empty 1105 lb at FS100.7/lateral +0.6 is one aircraft, not guaranteed factory mass. The example contains inconsistent printed longitudinal moments; use its explicitly stated arm with the selected sample mass, rather than propagating the arithmetic typo. Engine/body/blade inertias remain estimates. Single-tank fuel arm FS108.5/lateral −17 in and 6 lb/USgal come from 6-6/6-10.

## Scaffold boundaries and shared changes

The `s269/` folder supplies identity, mass/power/limits/reference, inputs, audio, panel/UI/training, visual and import assemblies. R22 engine/polars/inflow/rigid-body/skid coefficients remain inherited estimates. The three-blade count, published sizes, manual-governor gate, separate sticks and four oleo meshes do not constitute an articulated or oleo simulation. Panel artwork, percent tach, simple clutch toggle, gear cross-tubes and R22 cabin/details are unfinished. No lessons or demos are enabled.

Shared changes are optional definition metadata for hub type/offsets, governor installation, trim, tail spin and skid suspension; renderer blade count/direction/blur, placeholder articulated hub, individual cyclics and optional damper geometry; governor-key gating; CW pedal sign; catalogue/ID/visual-loader registration and catalogue expectations. Existing absent-field defaults retain R22/R44 paths. Seat/eye placement and arbitrary panel outline were already data-driven; no unnecessary seat/panel enum was added. Audio already supported three-blade passage frequency and needs only new aircraft data.

`RotorcraftState` is unchanged. `clutchEngagement` remains belt engagement; `clutchLight` remains actuator indication; `governorActive` remains actual governor acquisition; `lowRpmHorn` remains the existing collective-dependent warning. The real CB disengaged lamp must receive a separately specified signal. Its clutch HOLD, trim force system and optional STAR warning must not be hidden behind redefined Robinson fields. R22 mast-bump detection is disabled for the articulated scaffold because it has no centre teeter hinge; correct blade/stop/airframe strike limits remain future work.

Ignored handoffs: `work/s269-rotor-design.md`, `work/s269-plan.md`. Verification evidence and screenshots: `work/s269-verification.md`.

## Physical coning and droop-stop pose (s269/coning)

The additional primary maintenance evidence is the [Schweizer 269C-1 Appendix B, Section 2,
100-hour inspection guide, NTSB docket copy, item 81](https://data.ntsb.gov/Docket/Document/docBLOB?FileExtension=.PDF&FileName=Schweizer+100-Hour+Airframe+Inspection+Guide+Provided+by+the+Mechanic+who+Performed+the+Last+Annual+and+100-Hour+Inspections.-Master.PDF&ID=40332040).
It identifies the hub's droop-stop assembly, stop arms and support nut, and refers to Basic HMI
Section 8. This establishes **the presence of stops**, not their angle, spring rate or blade stiffness.
The copy is cached as `work/coning/hmi-stops.pdf` with extracted text alongside it. The RFM's
separate flap and lag hinges are on printed page 1-7; blade radius/chord/section/twist are on 1-8.

`src/aircraft/s269/coning.ts` shares the following data between the physical published blade pose
and its visual fallback. These are **engineering estimates**, except for the published blade span.
They are not maintenance limits or a measured hover-coning calibration.

| Per-blade quantity | Value | Basis |
| --- | ---: | --- |
| Mass | 15 kg | Existing `S269_ARTICULATED` uniform-blade estimate; no weighing survey |
| Mass-bearing span | 0.65–4.088892 m from shaft | Estimated root, RFM 26.83 ft rotor diameter |
| CG shaft radius | 2.369446 m | Midpoint of that uniform span |
| Shaft polar inertia | 98.996588 kg m² | Existing integral; three blades give 296.989764 kg m² total |
| Flap-hinge offset | 0.18 m | Existing `dimensions.ts` estimate, same pin as the mesh |
| Flap-hinge inertia | 86.687580 kg m² | Parallel-axis integral, **not** shaft inertia divided again |
| Centrifugal inertia coefficient | 92.599084 kg m² | `Ishaft − m e rcg = Iflap + e Sflap` |
| Fallback thrust radius | 3.066669 m (0.75R) | Approximate r² loading; actual simulation supplies BEM hinge moment |
| Flap spring / rest angle | 0 Nm/rad / 0° | Free mechanical flap pin; no verified flap spring or fixed precone |
| Droop stop | −2° | Estimated rigid-blade support angle; numerical setting not established by HMI excerpt |
| Upper stop | Unspecified | Shared geometric bound only; no claimed 269 maintenance value |
| Flapwise EI / elastic sag | Unspecified / not modelled | Rigid span on the droop stop; no Robinson EI imported |

The elastomeric **lead–lag** damper is not used as a flap spring. With the estimated −2° stop,
the rigid tip is 13.64 cm below its flap pin when stopped. The shared elastic-bending option remains
available to aircraft with an EI estimate; this change does not claim an elastic 269 blade model.
The small-angle balance does not simulate transient blade sailing, stop-impact loads or ground
resonance. See [rotor-coning.md](rotor-coning.md#schweizer-269-integration) for diagnosis, implementation,
flight-model preservation and before/after evidence.
