// scripts/shot-era.mjs plugin: the pteranodon shots (owner: WP4, Deep Time increment 2).
//   ptera-gallery  the creature gallery: Pteranodon beside a small azhdarchid and a Quetzalcoatlus, the gait strip in flight
//   ptera-kettle   45 m from a Pteranodon circling in kettle 0 (mixed with the azhdarchids: crest and colours must separate them)
//   ptera-G5       the default Cretaceous boot (safari cockpit) at first-minute frame G5
// Run just these: node scripts/shot-era.mjs --plugins pteranodon --out <dir>

// Kettle 0, close: the camera 45 m off the first Pteranodon circling, looking at it (paused, so it stays framed).
const ptera_kettle = (R) => `
  let i = -1;
  const R0 = await import('/src/world/fauna/roster.ts');
  const species = (k) => R0.ROSTERS.cretaceous.entries[F.entry[k]].species;
  await until(() => sim.summary().time > 3, 20000);
  const ok = await until(() => { for (let k = 0; k < F.capacity; k++) if (F.active[k] && f.kettleOf[k] === 0 && F.mode[k] === 4 && species(k) === 'pteranodon') { i = k; return true; } return false; }, 30000);
  if (i < 0) return { kettle: false };
  sim.pause(true);
  await sleep(100);
  const R = ${R}, n = F.n[i], e = F.e[i], a = F.alt[i], hd = F.heading[i];
  // Abeam (to the bird's right) and a little below, so the crest and the pale belly face the lens.
  sim.setFixedCamera([n - R * Math.sin(hd), e + R * Math.cos(hd), a - R * 0.15], [n, e, a]);
  await sleep(400);
  const kinds = {};
  for (let k = 0; k < F.capacity; k++) if (F.active[k] && f.kettleOf[k] === 0) { const s = species(k); kinds[s] = (kinds[s] || 0) + 1; }
  return { kettle: true, bird: i, kinds };`;

export default function shots(h) {
  return [
    {
      name: 'ptera-gallery',
      label: 'Pteranodon gallery: hero and a five-phase wingbeat strip',
      page: 'dev/fauna.html?species=pteranodon&action=flap&strip=5&freeze=1&tod=10',
      wait: 2500,
    },
    { name: 'ptera-kettle', label: 'Pteranodon in kettle 0, 45 m', page: `${h.CRET}&tod=18.6&ui=0`, evalJs: h.timed(ptera_kettle(45)), wait: 0 },
    { name: 'ptera-kettle-near', label: 'Pteranodon in kettle 0, 18 m abeam', page: `${h.CRET}&tod=18.6&ui=0`, evalJs: h.timed(ptera_kettle(18)), wait: 0 },
    { name: 'ptera-G5', label: 'Default boot, cockpit, G5', page: h.DEFAULT_BOOT, evalJs: h.timed(h.AT_FRAME('G5')), wait: 0 },
  ];
}
