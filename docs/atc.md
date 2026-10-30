# ATC and other traffic

Design note for flying between airfields with a working radio, air traffic control at the home field and other
aircraft in the circuits. Follows docs/seeded-world.md (the generated airfields) and the seams the instructor
reserved in docs/instructor-spec.md (the radio speech channel, the tower actor, Space for push-to-talk).

## Owner's answers (2026-10-30)

- **Who controls what:** the home field (KFBL, 118.3) has a tower. The generated fields are uncontrolled: pilots
  announce their own position and intentions on the field's common frequency.
- **How the player talks:** hold Space and pick a call from a short menu of the calls that fit the moment. Voice
  recognition may come later, so the calls are data (what is said, and what it means) rather than captions only.
- **Traffic first:** a few visible AI light aircraft flying circuits at the fields and making their calls. Legs
  between fields come next.

## Phraseology

The lessons already choose FAA or EASA (`settings.authority`, default EASA, `standard=` in the URL). The radio
follows the same choice: the wording of calls and readbacks (for example "line up and wait", "QNH" against
"altimeter", registrations spoken as letters or as type plus number) comes from one phrasebook per authority, both
written from the start.

## Order

1. **A radio that works.** The COM1 frequencies leave the panel art for a sim-side store (`sim/radios.ts`) that the
   panel redraws from, the menu tunes (Tune buttons on each airfield) and the resume snapshot keeps.
2. **Calls on the radio.** Hold Space for a menu built by a pure function of where the aircraft is and what it is
   tuned to (position in the circuit from the field's runway frame, the runway in use from the wind). Calls go out
   on the speech scheduler's radio channel with captions. A tuned frequency that belongs to no field is silent.
3. **One AI aircraft in a circuit** at a generated field: the circuit as a pure function of the field (its
   direction, both runway ends), simple kinematics, its own voice, its calls heard when you are tuned to the field
   and within radio range. A plain stand-in model first, a light-aircraft exterior after.
4. **The home tower:** clearances for taxi, take-off, circuit and landing, with readbacks and sequencing against
   the AI traffic.
5. More traffic, legs between fields, the transponder.

ATC runs only where the Flight School does (the present day); the Cretaceous has no radio traffic.

## Where it stands (2026-10-30)

- **Steps 1 and 2 done.** COM1 is a live store; Space opens the call menu; the home tower, ground and ATIS answer.
  Downwind and final calls carry the intention (full stop or touch and go) and the tower clears each its own way.
  After a full-stop landing at home the tower says which way and where to vacate (the first exit the roll can
  make, `vacateVia`) and to call Ground, who taxis the aircraft to the apron via Alpha and B1 or B2.
- **The radio window (R).** The nearest stations, each tuned with one number key (the old frequency to standby);
  after the tower's handover Ground is first, marked "as instructed". S is the flip-flop, C the audio panel's MIC
  (COM1 or COM2, on panels with two COMs: a GPS navigator and a NAV/COM, or two NAV/COMs), and in a lesson 0 is the
  instructor's say again (bare R used to be say again). The MIC's COM is the one transmitted and listened on; the
  snapshot keeps COM2 and the MIC.
- **Step 3: circuit traffic** (`src/atc/circuit.ts`, `TrafficSystem.ts`, `trafficMesh.ts`). One AI aircraft at
  each generated field (C172, C152 or PA-28 by the field's code), flying touch-and-go circuits on the runway the
  wind favours: upwind to 1000 ft, 1000 m out on downwind at 90 kt, base descending at up to 700 fpm, a 4 degree
  final to an aim point 120 m in, a five-second roll, rotate at 55 kt. Kinematics only: legs tracked with a
  cross-track correction, turns at 25 degrees of bank rolled in at 15 degrees a second, the heading following the
  bank. It calls downwind abeam the field, base once turned and final once lined up, using `callsFor()` for its
  own position, so the wording is the player's. The radio hears a call when COM1 is on the field's frequency, the
  avionics are on and the two aircraft are within line of sight of each other; each aircraft has its own voice.
  When the wind swings round it changes ends after its next take-off, joining the other end's downwind. If the
  player is on its runway when it is below 400 ft on final it goes around and says so. Otherwise there is no
  separation or collision with the player yet.
- **The real flight model and exteriors near the player** (`trafficPilot.ts`, `render/aircraft/trafficExterior.ts`).
  The types are the sim's own C172S, C152, PA-38 and DA20. The nearest two aircraft within 15 km of the player
  (dropped beyond 17 km; none above 4x time acceleration) fly on their type's flight model, flown by the player's
  scripted pilot (`sim/autoflight.ts`, now given the runway as a frame, home 07 by default and bit-identical):
  its take-off, approach, flare and roll-out, with crosswind, downwind and base on its heading and altitude hold
  steered along the circuit's legs with the drift added. Flaps by the type's profile: the first stage abeam the
  threshold with a 500 fpm descent to 500 ft, the base setting on base, the final setting on final; the crosswind
  turn not below 450 ft; turns at up to 22 degrees of bank; a touch and go is two seconds on the wheels, then the
  take-off flap and full power. 240 Hz on and near the ground, 120 Hz in the air: about 2 % of a core each. They
  are drawn with the type's own exterior (no cockpit, light glows only, the livery baked with the aircraft's own
  registration) within 3 km of the camera, the box stand-in beyond; the others stay kinematic. Changing over keeps
  the leg and position.
