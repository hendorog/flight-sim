# MD 500E (369E, 250-C20B): known issues

See also the [cross-aircraft issues](../../../docs/known-issues.md#cross-aircraft-issues). Entries are ordered by pilot
impact. Numbers are from [md500Performance](../../../tests/rotorcraft/md500Performance.test.ts) and
[md500Systems](../../../tests/rotorcraft/md500Systems.test.ts); the model is described in
[md500-flight-model.md](../../../docs/md500-flight-model.md) and [turboshaft-model.md](../../../docs/turboshaft-model.md).

## Pedal (yaw) response stronger than the OH-6A's — **unvalidated**

A step of 0.1 of pedal travel in the hover at 2550 lb gives an initial yaw acceleration of 148 °/s² and 65 °/s after
1 s; the OH-6A's derivatives (Heffley CR-3144 case 4, F) give 54 °/s² and 37 °/s. At 60 KIAS the weathercock brings
both back to a few °/s after 1 s (3.8 against 5.7). The 500E has the D-model's larger tail rotor (55 against 51 in)
on a +27/−14° range, and Heffley's derivatives fold in the OH-6A's control-system flexibility, so part of the gap is
real; how much is not known. The pedal-step yaw subsidence in the hover is also slower: 1.39 s to half rate after
release against the OH-6A's 0.91 s (weaker yaw damping; not a plan row). Not tuned.
Evidence: `KNOWN CONTROL-POWER GAP` [expected failures, one per row: yaw acceleration hover and 60 kt, yaw rate at 1 s hover](../../../tests/rotorcraft/md500Performance.test.ts) and the
table in [md500-flight-model.md §7](../../../docs/md500-flight-model.md).
Close with: a 500D/E pedal-step or yaw-derivative record (or the OH-6A's tail-rotor pitch range per pedal travel).

## Roll rate per stick about 35-50 % above the OH-6A's — **unvalidated**

Roll acceleration per 0.1 of lateral travel matches the OH-6A (82 °/s² against 84), but the rate at 0.5 s is 20 °/s
against 15 (hover, +35 %) and 14 (60 kt, +51 %): the modelled roll response settles at a higher steady rate per degree
of cyclic. The hover roll subsidence is inside the band (0.154 s to half rate after release against 0.129 s, +19 %) and the
initial acceleration matches, so the gap is not explained by the roll damping alone (cause not identified). Pitch is inside 30 % at both speeds (subsidence
0.354 against 0.352 s).
Evidence: `KNOWN CONTROL-POWER GAP` expected failures (roll rate at 0.5 s, hover and 60 kt); [md500-flight-model.md §7](../../../docs/md500-flight-model.md).
Close with: the 500E's lateral cyclic rigging under load or a 500D/E roll response record.

## Hover roll attitude 3.7° left at 3000 lb — **estimate**

The plan's ESTIMATE band is 1-3° left skid low; the model hangs 3.7° left IGE and 4.1° OGE at 3000 lb SL. The OH-6A
trims at 3.05° left at 2550 lb (Heffley case 4, F), and the tail-rotor thrust grows with weight, so the model is close
to the family evidence; the band is not met.
Evidence: `KNOWN ROLL GAP` [expected failure](../../../tests/rotorcraft/md500Performance.test.ts).
Close with: a measured 500E hover attitude (or the lateral CG and tail-rotor height of a weighed aircraft).

## Power-turbine loss of 20 kW stands in for the idle runaway speed — **estimate**

The turbine core's power-turbine law has a fixed stall-torque ratio, so the unloaded runaway speed at idle gas power
is set only by the friction. To get both a ground-idle N2 of 59 % and an unloaded idle N2 below the governor's set
point, the 250's friction is 20 kW at 100 % N2 (about 4 kW is the gear train). It costs fuel (the running line is
fitted with it), not torque.
Evidence: [turboshaft-model.md §5](../../../docs/turboshaft-model.md#5-unloaded-power-turbine-why-the-loss-is-20-kw-not-48-kw).
Close with: a power-dependent power-turbine characteristic in `TurbineDef.powerTurbine` (turbine-core contract
request), then the friction back to the gear train's.

## Engine running line fitted, not an engine deck — **estimate**

Fuel flow, TOT and gas power against N1 are fitted to the 313 kW / 810 °C rating, the six hover-ceiling points of RFM
Fig 5-4 and Fig 8-1 (all within 170 ft), ground idle and the snap-deceleration check. The RFM 5-24 specification point
(87.2 psi at 1000 ft, 20 °C reads 790 °C) gives 770 °C. Cruise fuel flow (193 lb/h at 120 KIAS) rests on a
marketing figure.
Evidence: [powerplant.ts](powerplant.ts); [md500-flight-model.md §4](../../../docs/md500-flight-model.md).
Close with: a 250-C20B installed power and fuel-flow chart (the full RFM Fig 5-17 family, or the Rolls-Royce O&M).

## Main-rotor blades, tail-rotor speed and the stabiliser section — **estimate**

No 369D21100 blade data exist: the blade is a uniform 11.5 kg blade fitted to the OH-6A's flap inertia; chord, twist
and NACA 0015 are the OH-6A's; the flap/lag hinge is the 500C's plus the inch of the 500D hub (S). The tail rotor turns
2933 rpm (S; the OH-6A's ratio would give 3172). The T-stab is read as +6.17° geometric with an inverted cambered
section (zero-lift +6°, ESTIMATE) because only that reading flies the cruise attitude (−3.4° at 120 KIAS).
Evidence: [articulated.ts](articulated.ts), [rotorcraft.ts](rotorcraft.ts), [md500-flight-model.md §3](../../../docs/md500-flight-model.md#stabiliser-sign).
Close with: a 369D21100 blade weight and CG, the 500E tail-rotor gear ratio, the stabiliser's section.

## Autorotation at 410 rpm and 80 KIAS — **unvalidated**

The RFM's best glide is at 80 KIAS and 410 rpm. The modelled rotor at that speed and rotor speed is at the
retreating-blade stall boundary (the collective a pilot needs to hold 410 rpm makes Nr unsteady), so the glide row is
asserted at 480 rpm (80 KIAS ratio 1.28 x the 60 KIAS one at 2700 lb) and the 410 rpm sink is reported at 60 KIAS
only (1500 ft/min). No autorotative landing (flare, touchdown) has been flown.
Evidence: [md500Performance](../../../tests/rotorcraft/md500Performance.test.ts) glide test.
Close with: a validated section stall model for the 0015 at low Mach; an autorotation landing demonstration.

## Governor dynamics and the ENGINE OUT arming — **estimate**

The droop (5 % N2 per unit N1), the compensator (0.65 N1 per unit collective, datum at the flat-pitch N1) and the
gains are calibrated to the RFM 4-18/4-22 statements and the plan's transient rows; the Bendix governor's real
dynamics were not obtained. The low-rotor half of ENGINE OUT arms once Nr reaches 468 rpm and disarms below 70 % Nr
on the ground only (skids loaded), so the warnings are out at ground idle (RFM 4-16) and stay on in any in-flight
underspeed; the real unit's logic is not documented. The auto-reignition arms
at 5 psi transmission oil pressure (ESTIMATE).
Evidence: [turboshaft.ts](../../physics/rotorcraft/turboshaft.ts), [turboshaft-model.md §3, §7](../../../docs/turboshaft-model.md).
Close with: the 250-C20B / Bendix governor data (droop, compensator rigging) and the 500E engine-out unit's schematic.

## No rotor overspeed damage — **missing feature**

Nr above the 523 rpm power-off limit is reported by the panel (M3) but never damages anything; a dive with the
collective fully down can drive the rotor far past it.
Evidence: [rotorcraft.ts](../../physics/rotorcraft/rotorcraft.ts) has no Nr limit check.
Close with: an overspeed record and crash/inspection criteria shared with the other helicopters.

## Not modelled — **missing feature**

Optional kits (particle separator, floats, cargo hook, the 4-blade tail rotor, the 250-C20R/2, extended gear); cabin
heat and engine anti-ice bleed (the RFM 4-19 TOT rise and the Fig 5-4 hover penalties); the hydraulic one-way lock in
the longitudinal cyclic (control forces are not fed back); per-blade flap/lag transients and ground resonance; the
FUEL VALVE as anything but the fuel selector; the "MAX Vne 130 kt below 35 lb of fuel" placard line (the limit
reader does not see the fuel).
Evidence: [index.ts](index.ts) `notModelled`.
Close with: each item's data and an owner decision to add it.

## Skid dampers and ground attitude — **estimate**

The nitrogen dampers have no published stroke or charge: 0.14 m of stroke on a 0.155 m gas column, sized so the
3000 lb aircraft survives the FAR 27.725 limit drop (about 2.55 m/s; measured: 2.78 m/s survives, 3.52 m/s crashes)
and a 30 kt run-on. The 4.7° nose-up ground attitude comes from the front contacts sitting 0.061 m lower in body
axes (`skids.frontZ`), calibrated with the pilot alone and full fuel; at 3000 lb the stance is 3.9-4.1°.
Evidence: [dimensions.ts](dimensions.ts) `SKID_FRONT_Z`, [rotorcraft.ts](rotorcraft.ts) `skids.oleo`; the
ground-attitude test and "skid gear touchdowns" in md500Systems; docs/md500-flight-model.md "Skid gear".
Close with: 500E damper charge, stroke and the skid-tube geometry.

## Exterior and head drawing — **estimate**

The head hardware proportions (strap pack, pitch housings, dampers, swashplate) are photographic ESTIMATES: no
369D/E hub drawing was found, and the strap flexure is drawn as fixed plates with discrete hinges at 0.140 m. The
blade droop at rest uses the provisional S269 coning data (`MD500_BLADE_CONING`). The shared occupant figure's head sits
0.11 m aft of `PILOT_EYE` (it leans on the seat back). The paint is generic (white, a blue / red stripe, orange blade
tips), not a factory scheme. The stabiliser is drawn leading edge down 6.17 deg to the waterline while the aerodynamic
model reads it leading edge up with an inverted cambered section (T2, the only reading that flies the cruise attitude
row; docs/md500-flight-model.md): the drawing and the aerodynamics disagree on the sign.
Evidence: [exterior.ts](exterior.ts), [docs/md500-exterior.md](../../../docs/md500-exterior.md).
Close with: a 369E head drawing and the stabiliser's rigging from a primary source.

## Panel — **simplified**

The painted dots (torque 74.3 psi blue, TOT 738 blue / 843 red, the 35 lb fuel dot) are 1-2 deg arcs (no dot
primitive). Dial spacing is artwork from RFM Fig 2-5 and a photograph; the ASI map (0-160 kt over 330 deg) is an
ESTIMATE and the inner mph ring is not drawn. The START button is on the collective head in the real aircraft; the
console twin comes with the shared ignition group, which also draws an IGNITION switch (continuous ignition) the 500E
does not have. The ammeter reads generator output (0-150 A), so the RFM's start-abort cue (battery discharge) cannot be
seen. The tach generators are self-powered (ESTIMATE). Circuit breakers are painted (no ENG OUT breaker caution), the
attitude indicator and DG are an optional electric fit (AGENT), and there is no RE-IGN TEST switch. The checklists have
no N2-beep, grip or torque-psi signal, so the grip items are judged from N1 only.
Evidence: [docs/md500-panel.md](../../../docs/md500-panel.md) "Compromises", [panel.ts](panel.ts).
Close with: a dot primitive, a start-button ignition kind (panelDef.ts), checklist signals for the grip and torque.

## Sound — **estimate**

The first turbine helicopter voice: the whine orders, roar, transmission mesh (1.36 kHz at 492 rpm), commutator bars
(24), igniter rate (4/s), ENGINE OUT horn pitch (700 Hz), tail-rotor hover thrust (880 N, DERIVED from an ESTIMATE of
hover power) and slap are ESTIMATES; there is no recording. Not voiced: main-rotor blade-vortex slap in descents, the N2
power-turbine whine and the freewheel, the igniters in auto-reignition and on the RE-IGN test. Tail-rotor rpm is an
ESTIMATE (2933 rpm at ratio 5.96, against 6.447 on the OH-6A).
Evidence: [audio.ts](audio.ts) header.
Close with: a 500E cockpit and exterior recording for a spectral calibration.
