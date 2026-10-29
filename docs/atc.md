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
