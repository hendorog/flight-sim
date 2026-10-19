# Controls

Keyboard, mouse and joystick controls, the fixed instrument panel, and the keyboard assists. Per-type differences are in [aircraft.md](aircraft.md).

The Controls tab in the menu lists the same table. Joysticks, yokes and pedals (Gamepad API) are set up in
the menu's "Joysticks & yokes" tab. In the cockpit view the panel is clickable: switches toggle, knobs turn
with the wheel, a click on either half, or a drag (right/up increases), and holding the key at START runs the starter.

| Keys | Action |
|---|---|
| **Flight controls** | |
| ↓ / ↑ | Yoke back (nose up) / forward (nose down); stays where you leave it |
| ← / → | Yoke left / right (roll); stays where you leave it |
| Z or Q / X or E | Left / right rudder; stays where you leave it |
| Num 5, 5 | Centre aileron, elevator and rudder |
| F5 / F6 | Flaps up / down one notch (0°, 10°, 20°, 30°) |
| Home, Num 7 / End, Num 1 | Elevator trim nose down / nose up |
| Double-click flight view / Y | Toggle mouse flight control (yoke / stick / cyclic) |
| **Brakes** | |
| , / . | Left / right toe brake (hold) |
| B | Both brakes (hold) |
| Shift+B | Parking brake on/off |
| **Engine** | |
| F2, Page Down / F3, Page Up | Throttle back / forward |
| F1 / F4 | Throttle idle / full |
| Shift+F2, Shift+Page Down | Turboprops (C208; PC-12 when available): power lever to the idle gate; release and hold again to go over the gate into BETA, then REVERSE (hold) |
| Shift+F1 | Turboshaft (MD 500E when available): twist grip to CUTOFF |
| ; / Shift+; | Turboshaft: N2 governor beep DECR / INCR (hold) |
| M / Shift+M | Mixture lean / rich (hold; lean to rich takes about 3 s) |
| S | Starter (hold; on a latching start switch, PC-12, one press) |
| Shift+N | STARTER INTERRUPT (hold; PC-12) |
| 1 / 2 / 3 / 4 | Magnetos OFF / R / L / BOTH |
| **Switches** | |
| W | Master switch (BAT + ALT) |
| Shift+W | Alternator half of the master |
| I / Shift+I | Avionics master / pitot heat |
| J / Shift+J | Auxiliary fuel pump / fuel selector (BOTH, LEFT, RIGHT, OFF) |
| **Lights** | |
| L / Shift+L | Landing / taxi light |
| N | Navigation lights |
| O / Shift+O | Strobes / beacon |
| ' | Panel lights: off, dim, medium, bright |
| **Instruments** | |
| G / Shift+G | Heading bug right / left (hold to turn faster) |
| K / Shift+K | Altimeter setting up / down (1 hPa) |
| U / Shift+U | NAV1 OBS course up / down |
| D | Align the heading indicator with the compass (hold) |
| Shift+D | Stick pusher interrupt (hold; PC-12) |
| **View** | |
| C / Shift+C | Next / previous camera (cockpit, chase, orbit, flyby, tower) |
| Shift+V | Switch between the 3D cockpit and fixed instrument panel |
| ] | Fixed panel: Upper → Lower → panel hidden → Upper |
| V, Backspace, middle click | Recentre 3D view |
| = , Num + / - , Num - , mouse wheel | Zoom |
| Shift+arrows, Num 4/6/8/2 | Look around (hold) |
| Drag (either button) | Look around / orbit the aircraft |
| \` | Toggle captured mouse-look |
| **Simulation** | |
| P, Pause | Pause / resume |
| A | Autopilot on/off (airborne only), KAP 140 style: HDG mode flies the heading bug (synchronised to the present heading on engagement; G / Shift+G turn it) and ALT holds the altitude; the throttle stays yours. Moving the yoke or rudder disconnects it |
| T / Shift+T | Autopilot altitude up / down 100 ft |
| H | Cabin dome light on/off |
| Shift+R | Restart the scenario (a restart asked for while a curtain is up runs when it lifts) |
| Shift+[ / Shift+] | Simulation rate slower / faster: 0.5x, 1x, 2x, 4x, 8x, 16x |
| Escape | Menu |
| F9 / F8 | HUD on/off / frame-time readout |

## Fixed instrument panel

Press **Shift+V**, or use **Menu → Display & camera → Cockpit panel**.
The default **Upper** section shows the flight and engine instruments and every panel warning lamp;
**Lower** shows radios, switches and console controls. Use **]** or the buttons above the panel to select
Upper, Lower or **Panel hidden** for landing. Switching preserves the aircraft's state. The choice is saved
with the simulator's preferences, even with flight resume turned off. **C / Shift+C** still cycle external
cameras and return to the chosen cockpit presentation. **P** still pauses.

The outside view is forward from the aircraft's pilot eye, with the horizon centred in the area above the
panel. Airframe geometry is hidden while landing/taxi illumination remains active. Look, captured mouse-look and zoom are disabled here;
return to 3D with Shift+V to use them. The fixed canvas remains sharp independently of graphics render scale.
All existing panel hotspots use the same actions and tooltips in both views. Double-clicks anywhere on the
fixed panel cannot engage mouse flight; double-click the outside view instead. The mouse pickup ring and
travel use that outside area; changing its size re-arms pickup to avoid a control jump.

| Aircraft | Fixed sections and reason |
|---|---|
| C172S, C152, PA-38 | Upper retains the six-pack and CDIs, with engine/auxiliary gauges beside them. Lower separates the long switch row and radios, avoiding the blank yoke/passenger areas. |
| DA20 | Upper retains its four-column instrument arrangement and the engine bank; Lower exposes the electrical row, flap switch/lamps, trim indicator and radios. |
| PA-34 | Upper includes both engines' instruments and CDIs; Lower groups the two ignition sets, switches, radios and gear controls. Splitting keeps the twin's extra gauges readable. |
| R22, R44 | Upper retains each pod's two flight-instrument rows, with engine gauges and warning cells alongside/below. Lower arranges the pedestal and chin controls as adjacent canvas crops, avoiding a very tall, shrunken console. |
| DA42 | Uses the existing C172S placeholder presentation on this branch; it is **not** a completed DA42 cockpit. Its eventual PanelDef can supply its own arrangement. |

These are crops of the same live native panel canvas, not alternate gauge implementations. Layout data lives
in each type's `PanelDef.fixed`; new types can supply flight-instrument rows and control crop rectangles.
At 1366×768 and 1920×1080 the primary instruments need no scrolling or zoom. Smaller windows fit the whole
section by scaling it down. Existing limitations remain: decorative radio controls and 3D-only parts without
panel hotspots do not acquire new mouse actions (use their existing keyboard controls).
The flat display uses the readable native canvas artwork; cockpit lighting and dimmer shading are still
specific to the 3D presentation. Dimmer controls retain their shared state when switching back.

## Mouse flight control

Double-click the flight view in any camera, or press **Y**. Panel controls and HTML
UI keep their normal clicks; double-click is ignored while a demo or instructor is flying. An amber centre
ring prompts you to move the pointer into it to pick up the current control position without a jump. Pointer
right commands right yoke/cyclic; pointer up commands forward yoke/cyclic. Full travel is reached at 80% of
the view's half-width/height. R22/R44 use a gentler continuous curve near centre for hover corrections. The
blue dot shows commanded control position. Double-click or Y releases to the keyboard **holding that position**;
5 centres it. Pedals, collective and throttle keys remain available. Use right-drag to look while engaged;
moving over panel controls or HTML UI holds the last mouse command. Both engagement and release show a toast.

## Keyboard yoke and assists

The keyboard yoke and rudder **hold position**, as in FSX / MSFS: a held arrow or rudder key moves the control,
and letting go leaves it where it is (the control-position widget at the bottom of the screen shows where; it
stays up while the keyboard controls are off centre). **Num 5** or **5** glides aileron, elevator and rudder back
to centre (the trimmed position of the scenario) in at most 0.25 s. The rate is non-linear: a key starts slowly,
so a tap is a fine adjustment, and speeds up quadratically the longer it is held. The travel a key can reach, and
so its rate, shrink with airspeed (constant load factor per key in pitch, constant roll rate per key in roll), so
the same hold does about the same manoeuvre at every speed:

| Key | Rate at key-down | Full rate after | Full rate | Travel moved by a 0.1 s / 0.5 s / 1 s hold | Measured with the C172 flight model |
|---|---|---|---|---|---|
| Elevator (↑ ↓) | 0.15 | 1.5 s | 0.6 | 0.009 / 0.050 / 0.13 at 70 KIAS | a 1 s hold reaches 1.24 g within that second at 70 KIAS (1.27 g at 93, 1.33 g at 113 KIAS); a 0.6 s hold arrests a 400 fpm approach sink in about 1.6 s at 1.2 g; a 2 s hold is a ~2 g pull |
| Aileron (← →) | 0.2 | 1.2 s | 1.0 | 0.019 / 0.11 / 0.35 at 70 KIAS | the roll rate the key leaves: about 0.5 °/s after a tap, 4 °/s after 0.5 s, 11-13 °/s after 1 s, at 70, 93 and 113 KIAS alike |
| Rudder (Z X) | 0.25 | 1.0 s | 1.2 | 0.025 / 0.16 / 0.57 below 58 KIAS | about 0.5 s of X gives the right pedal a full-power take-off roll needs |

Rates are fractions of the airspeed-dependent limit per second (travel is ±1). A key moves the control back toward
centre 1.2-1.3 times faster than away from it. On the ground (either main wheel down) the elevator key runs at 60 %
of its airborne rate, because pivoting on the mains gives the nose no flight-path damping. After a rotation the
yoke stays back, so ease the nose to the climb attitude with ↑ (or press 5) once airborne. The brakes (B , .)
stay hold-to-apply, and the trim, throttle and mixture keys are unchanged. The mouse yoke and joystick axes are
absolute and unaffected. When the autopilot flies, the keyboard yoke follows it (as a hand resting on it), so
taking over or disengaging does not jump.

The keyboard assists (both off while hardware or the mouse yoke owns that axis) act only while you are not
holding that control yourself:
- **Ground steering** is an auto-rudder for the ground roll. It holds the heading while the keyboard rudder is
  centred (untouched since the start or the last 5). Your first rudder key press takes the pedals over from it
  without a bump: the rudder it was holding becomes your held rudder. Pressing 5 on the take-off or landing roll
  (above 8 m/s) hands the pedals back to it at that position, so centring does not swerve the aircraft.
- **Roll trim** holds the small steady aileron the aircraft needs (propeller torque in the climb) while the
  keyboard ailerons are centred and the wings are within 6° of level. It hands over to your first roll key press
  the same way.
- **Rotation guard**: while the nose-up key is held with a main wheel on the ground (and for as long as that same
  press lasts after lift-off), it stops the key pulling further once the nose comes up at more than about
  5 °/s or nears 11° (the tail-strike attitude is ~13-14°). It never moves a yoke you have let go of.
- A soft load-factor stop eases a held keyboard elevator back beyond 2.2 g or below 0.35 g.

Both assists can be switched off in the menu (Flight tab) or with `assist=0`. With ground steering off and the
keyboard rudder centred (no rudder axis in use), your feet are off the pedals: the rudder floats, the nosewheel
follows it through the steering bungee (held by the loaded nose tyre), and the full-power roll wanders left
with the propeller's yaw unless you hold right rudder (X or E), as in the aeroplane. Pitch trim (Home / End) is
incremental and is what holds the attitude with the yoke centred.
