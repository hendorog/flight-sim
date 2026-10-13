// scripts/shot-era.mjs plugin: the first-minute shots (owner: WP7, Deep Time increment 2). THE LOOK GATE.
// Contract (see shot-era.mjs's header): export default (h) => [{ name, label, page, evalJs?, wait? }, ...], names
// unique across all plugins; h.CRET, h.DEFAULT_BOOT, h.timed(body), h.AT_FRAME('G3'), h.SAFARI_AT(ms), ... .
// Run just these: node scripts/shot-era.mjs --plugins first-minute --only <name,...> --out <dir>
//
// fm-g1 .. fm-g7: the DEFAULT boot (index.html?era=cretaceous&ui=0: the safari at SAFARI.tod, cockpit, the clock
// running), each shot at its FIRST_MINUTE_FRAMES time. The times and expected groups are read IN THE PAGE (a dynamic
// import of cretaceousAnchors.ts through h.AT_FRAME), so WP8's retuning of the frames needs no edit here; only the
// ids G1-G7 are listed below. Each label gets the measured sim time and tod and, per expected group, its
// bearing off the nose / depression / distance (deg, deg, m) from the aircraft as flown.
//
// Supporting frames (shot, not scored):
//   fm-chase-g3       the chase camera at G3 (the aircraft over the stampede)
//   fm-night-2200     the default boot at tod 22, cockpit at G1 (the lava lobes and underglow ahead)
//   fm-plume-1000     tod 10 from the Flats line-up 25 (the plume against a blue sky)
//   fm-palette-1000   the default boot at tod 10, cockpit at G3: the ground and tree palette in daylight (the
//                     before/after pair for the palette pass with fm-g3 at SAFARI.tod)

const FRAMES = ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7'];

export default function shots(h) {
  const frames = FRAMES.map((id) => ({
    name: `fm-${id.toLowerCase()}`,
    label: `${id} (default boot, cockpit)`,
    page: h.DEFAULT_BOOT,
    evalJs: h.timed(h.AT_FRAME(id)),
    // The frame is grabbed as soon as the eval returns: the aircraft covers ~57 m a second.
    wait: 0,
  }));
  return [
    ...frames,
    {
      name: 'fm-chase-g3',
      label: 'G3, chase camera (aircraft over the stampede)',
      page: h.DEFAULT_BOOT,
      evalJs: h.timed(`sim.setCamera('chase');\n${h.AT_FRAME('G3')}`),
      wait: 0,
    },
    {
      name: 'fm-night-2200',
      label: 'Night: default boot at tod 22, cockpit, G1',
      page: `${h.DEFAULT_BOOT}&tod=22`,
      evalJs: h.timed(h.AT_FRAME('G1')),
      wait: 0,
    },
    {
      name: 'fm-plume-1000',
      label: 'Plume against blue: Flats line-up 25, tod 10, chase',
      page: `${h.CRET}&scenario=runway&tod=10&cam=chase&ui=0`,
      evalJs: h.timed(h.LINEUP_25),
      wait: 1500,
    },
    {
      name: 'fm-palette-1000',
      label: 'Palette in daylight: default boot at tod 10, cockpit, G3',
      page: `${h.DEFAULT_BOOT}&tod=10`,
      evalJs: h.timed(h.AT_FRAME('G3')),
      wait: 0,
    },
  ];
}
