// `node scripts/safari-geometry.mjs solve`: the node half of the safari geometry tool (see safari-geometry.mjs).
// `load` is vite's ssrLoadModule. Prints tables; nothing is written into the sources.
//
//   --tracks 20,27,35   track candidates (deg right of the 25 direction)
//   --lateral 125       wanted cross-track distance of the river herd's centre, m, LEFT of the track
//   --along 4870        start along the runway frame, m
//   --agls 350,400,450,550
//   --tods 17.8,18.3,18.6,19.0,19.4

export async function solve(load, flags) {
  const num = (k, d) => (flags[k] === undefined ? d : Number(flags[k]));
  const list = (k, d) => (flags[k] === undefined ? d : String(flags[k]).split(',').map(Number));
  const { setEra } = await load('/src/world/era/eraState.ts');
  setEra('cretaceous');
  const { riverHerdSite } = await load('/src/world/fauna/showcase.ts');
  const { countingTerrain } = await load('/src/world/fauna/habitat.ts');
  const { terrainHeight, makeSample, sampleTerrain } = await load('/src/world/terrain/heightfield.ts');
  const { sunDirectionNED, AIRPORT } = await load('/src/core/world.ts');
  const { buildTreeCell, TREE_STRIDE } = await load('/src/world/terrain/vegetation/placement.ts');
  const { CRETACEOUS } = await load('/src/world/era/cretaceous.ts');
  const D = Math.PI / 180;
  const rwy = AIRPORT.runway.heading;
  const along = num('along', 4870);
  const lateral = num('lateral', 125);
  const tracks = list('tracks', [20, 27, 35]);
  const agls = list('agls', [350, 400, 450, 550]);
  const tods = list('tods', [17.8, 18.3, 18.6, 19.0, 19.4]);

  const herd = riverHerdSite(countingTerrain());
  console.log(`river herd site: north ${herd.north.toFixed(1)} east ${herd.east.toFixed(1)} ground ${herd.ground.toFixed(1)} (seed u 3500 v 3000)`);
  const toNed = (u, v) => ({ n: AIRPORT.runway.center.north + u * Math.cos(rwy) - v * Math.sin(rwy), e: AIRPORT.runway.center.east + u * Math.sin(rwy) + v * Math.cos(rwy) });

  // The track frame: forward (fn, fe), right (-fe, fn). Cross-track of the herd (positive right) is linear in
  // `across` (the start's runway-frame v): solve it in closed form.
  const sol = {};
  for (const tr of tracks) {
    const hdg = rwy + Math.PI + tr * D;
    const fn = Math.cos(hdg), fe = Math.sin(hdg);
    const cross = (v) => {
      const s = toNed(along, v);
      const dn = herd.north - s.n, de = herd.east - s.e;
      return { right: -dn * fe + de * fn, ahead: dn * fn + de * fe };
    };
    const c0 = cross(0).right, c1 = cross(1000).right;
    const slope = (c1 - c0) / 1000;
    const across = flags.across !== undefined ? Number(flags.across) : (-lateral - c0) / slope;
    const at = cross(across);
    sol[tr] = { hdgDeg: ((hdg / D) % 360 + 360) % 360, across, start: toNed(along, across), herdAhead: at.ahead, herdRight: at.right };
    console.log(`track ${tr}: heading ${sol[tr].hdgDeg.toFixed(1)}  across ${across.toFixed(0)} (d cross / d across ${slope.toFixed(3)})  start n ${sol[tr].start.n.toFixed(0)} e ${sol[tr].start.e.toFixed(0)}  herd ${at.ahead.toFixed(0)} m ahead, ${(-at.right).toFixed(0)} m left`);
  }

  // Clearance: the highest ground or tree top (the era's real trees, high preset spacing) within 500 m of the
  // first 6 km of each track.
  const S = makeSample();
  const treeTops = (n0, e0, n1, e1) => {
    const out = [];
    for (let cz = Math.floor(Math.min(n0, n1) / 256); cz <= Math.floor(Math.max(n0, n1) / 256); cz++)
      for (let cx = Math.floor(Math.min(e0, e1) / 256); cx <= Math.floor(Math.max(e0, e1) / 256); cx++) {
        const c = buildTreeCell({ cx, cz, size: 256, spacing: 5.5 });
        for (let i = 0; i < c.count; i++) {
          const o = i * TREE_STRIDE;
          out.push({ e: c.instances[o], g: c.instances[o + 1], n: c.instances[o + 2], h: c.instances[o + 3], sp: Math.floor(c.instances[o + 5]) });
        }
      }
    return out;
  };
  console.log('\nclearance (ft above the highest ground or tree top within 500 m of the first 6 km):');
  for (const tr of tracks) {
    const { start } = sol[tr];
    const hdg = sol[tr].hdgDeg * D;
    const fn = Math.cos(hdg), fe = Math.sin(hdg);
    const g0 = terrainHeight(start.n, start.e);
    let hi = -Infinity, hiAt = '';
    for (let s = 0; s <= 6000; s += 25)
      for (let c = -500; c <= 500; c += 25) {
        const n = start.n + s * fn - c * fe, e = start.e + s * fe + c * fn;
        sampleTerrain(n, e, S);
        const h = Math.max(S.ground, S.standing, S.river);
        if (h > hi) [hi, hiAt] = [h, `ground at ${s} along ${c} right`];
      }
    const end = { n: start.n + 6000 * fn, e: start.e + 6000 * fe };
    for (const t of treeTops(Math.min(start.n, end.n) - 600, Math.min(start.e, end.e) - 600, Math.max(start.n, end.n) + 600, Math.max(start.e, end.e) + 600)) {
      const dn = t.n - start.n, de = t.e - start.e, s = dn * fn + de * fe, c = -dn * fe + de * fn;
      if (s < 0 || s > 6000 || Math.abs(c) > 500) continue;
      if (t.g + t.h > hi) [hi, hiAt] = [t.g + t.h, `tree (species ${t.sp}, ${t.h.toFixed(0)} m) at ${s.toFixed(0)} along ${c.toFixed(0)} right`];
    }
    sol[tr].highest = hi;
    const row = agls.map((a) => `${a} ft: ${((g0 + a * 0.3048 - hi) / 0.3048).toFixed(0)} ft`);
    console.log(`track ${tr}: start ground ${g0.toFixed(1)} m, highest ${hi.toFixed(1)} m (${hiAt});  ${row.join(';  ')}`);
  }

  // Sun, volcano and dayFactor over the tod x track grid (horizontal FOV at 1600x900, f = 779.4 px: +-45.8 deg;
  // the central 60 % of the width is +-25.6 deg off the nose, the central 40 % +-17.8 deg).
  const V = CRETACEOUS.terrain.volcano;
  console.log('\nsun / volcano (relative bearing, + right of the nose; elevation; dayFactor):');
  for (const tr of tracks) {
    const { start } = sol[tr];
    const hdg = sol[tr].hdgDeg;
    const volc = Math.atan2(V.east - start.e, V.north - start.n) / D;
    const rel = (b) => ((b - hdg + 540) % 360) - 180;
    const vd = Math.hypot(V.east - start.e, V.north - start.n);
    const cells = tods.map((t) => {
      const s = sunDirectionNED(t, 172);
      const el = Math.asin(-s.z) / D;
      const az = Math.atan2(s.y, s.x) / D;
      const y = -s.z;
      const sm = (e0, e1, x) => { const k = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return k * k * (3 - 2 * k); };
      const r = rel(az);
      const px = 800 + 779.4 * Math.tan(r * D);
      return `${t}: sun ${r.toFixed(1)} / ${el.toFixed(1)} (x ${px.toFixed(0)}) day ${sm(-0.12, 0.1, y).toFixed(2)}`;
    });
    console.log(`track ${tr} (hdg ${hdg.toFixed(1)}): volcano ${rel(volc).toFixed(1)} deg at ${(vd / 1000).toFixed(1)} km;  ${cells.join(' | ')}`);
  }

  // Araucaria stands near pathToNed(2400, +150) for each track: trees of species 0 within 400 m (high preset
  // spacing 5.5 m, 256 m cells), clustered at 60 m.
  console.log('\naraucaria near pathToNed(2400, +150):');
  for (const tr of tracks) {
    const { start } = sol[tr];
    const hdg = sol[tr].hdgDeg * D;
    const fn = Math.cos(hdg), fe = Math.sin(hdg);
    const p = { n: start.n + 2400 * fn - 150 * fe, e: start.e + 2400 * fe + 150 * fn };
    const R = num('radius', 1500);
    const trees = [];
    for (let cz = Math.floor((p.n - R) / 256); cz <= Math.floor((p.n + R) / 256); cz++)
      for (let cx = Math.floor((p.e - R) / 256); cx <= Math.floor((p.e + R) / 256); cx++) {
        const c = buildTreeCell({ cx, cz, size: 256, spacing: 5.5 });
        for (let i = 0; i < c.count; i++) {
          const o = i * TREE_STRIDE;
          const sp = Math.floor(c.instances[o + 5]);
          if (sp !== 0) continue;
          trees.push({ e: c.instances[o], n: c.instances[o + 2], h: c.instances[o + 3], g: c.instances[o + 1] });
        }
      }
    // Stands: an araucaria with at least 3 more within 40 m.
    const stands = trees.map((t) => ({ ...t, k: trees.filter((u) => Math.hypot(u.n - t.n, u.e - t.e) < 40).length - 1, d: Math.hypot(t.n - p.n, t.e - p.e) })).filter((t) => t.k >= 3).sort((a, b) => a.d - b.d);
    const s = stands[0];
    console.log(`track ${tr}: target n ${p.n.toFixed(0)} e ${p.e.toFixed(0)} (ground ${terrainHeight(p.n, p.e).toFixed(0)});  ${trees.length} araucaria within ${R} m;  nearest stand ${s ? `${s.d.toFixed(0)} m away at n ${s.n.toFixed(0)} e ${s.e.toFixed(0)}, ground ${s.g.toFixed(0)}, ${s.k + 1} trees, h ${s.h.toFixed(1)}` : 'none'}`);
    if (s) {
      const dn = s.n - start.n, de = s.e - start.e;
      console.log(`         stand in the track frame: ${(dn * fn + de * fe).toFixed(0)} m along, ${(-dn * fe + de * fn).toFixed(0)} m right`);
    }
  }
  setEra('present');
  return sol;
}

/**
 * `solve --timeline`: the river herd's visibility from the cockpit over the first minute for a range of lateral
 * offsets (its centre LEFT of the flown path at closest approach), at one track and AGL (the hold model).
 */
export async function timeline(load, flags) {
  const num = (k, d) => (flags[k] === undefined ? d : Number(flags[k]));
  const { setEra } = await load('/src/world/era/eraState.ts');
  setEra('cretaceous');
  const A = await load('/src/world/era/cretaceousAnchors.ts');
  const { riverHerdSite } = await load('/src/world/fauna/showcase.ts');
  const { countingTerrain } = await load('/src/world/fauna/habitat.ts');
  const { terrainHeight } = await load('/src/world/terrain/heightfield.ts');
  const herd = riverHerdSite(countingTerrain());
  const track = num('track', A.SAFARI.trackDeg);
  const agl = num('agl', A.SAFARI.aglFt);
  const laterals = String(flags.laterals ?? '125,200,250,300,350,400').split(',').map(Number);
  const F = A.SAFARI_FLIGHT;
  const P = A.makeProjection();
  for (const L of laterals) {
    // Solve `across` (linear) so the herd centre is L left of the drifted path at closest approach.
    const startFor = (across) => ({ ...A.SAFARI, trackDeg: track, across, aglFt: agl });
    const lateralAt = (across) => {
      const st = startFor(across);
      const q = A.nedToPath(herd.north, herd.east, { s: 0, c: 0 }, st);
      const tca = q.s / F.groundSpeed;
      return { lat: F.driftRight * tca - q.c, tca };
    };
    const a0 = 3000, a1 = 4000, l0 = lateralAt(a0).lat, l1 = lateralAt(a1).lat;
    const across = a0 + ((L - l0) * (a1 - a0)) / (l1 - l0);
    const st = startFor(across);
    const s0 = A.safariStartNed(st);
    const ground = terrainHeight(s0.north, s0.east);
    const flight = { ...F, startGround: ground, altitudeMSL: ground + agl * 0.3048 };
    let door = 0, wind = 0, first = null, last = null;
    const sizes = [];
    const rows = [];
    for (let t = 0; t <= 60; t += 0.5) {
      A.projectFromCockpit(t, herd.north, herd.east, herd.ground + 1.5, P, st, flight);
      const inDoor = P.visible && A.inDoorWindow(P.bodyBearingDeg);
      if (P.visible) {
        if (inDoor) door += 0.5;
        else wind += 0.5;
        first ??= t;
        last = t;
        sizes.push([t, 9 * P.pxPerM]);
      }
      if (t % 2 === 0) rows.push(`${t}:${P.visible ? (inDoor ? 'D' : 'W') : '-'}${P.bodyBearingDeg.toFixed(0)}/${(-P.bodyElevationDeg).toFixed(0)}/${(9 * P.pxPerM).toFixed(0)}px`);
    }
    const dSizes = sizes.filter(([t]) => t >= 0).map(([, s]) => s);
    console.log(`L ${L}: across ${across.toFixed(0)}, start ground ${ground.toFixed(0)}; door window ${door} s, windscreen ${wind} s, 9 m body ${Math.min(...dSizes).toFixed(0)}-${Math.max(...dSizes).toFixed(0)} px`);
    if (flags.verbose) console.log('   ', rows.join(' '));
  }
  setEra('present');
}

/**
 * `solve --place`: the anchors for the current SAFARI (cretaceousAnchors.ts) and each group's visibility over the
 * first minute (centre point; D = left door window, W = windscreen, - = hidden), with body sizes in px.
 */
export async function place(load, flags) {
  const { setEra } = await load('/src/world/era/eraState.ts');
  setEra('cretaceous');
  const A = await load('/src/world/era/cretaceousAnchors.ts');
  const { riverHerdSite } = await load('/src/world/fauna/showcase.ts');
  const { countingTerrain, herdGround } = await load('/src/world/fauna/habitat.ts');
  const { terrainHeight } = await load('/src/world/terrain/heightfield.ts');
  const { buildTreeCell, TREE_STRIDE } = await load('/src/world/terrain/vegetation/placement.ts');
  const T = countingTerrain();
  const herd = riverHerdSite(T);
  const P = A.makeProjection();
  const q = A.nedToPath(herd.north, herd.east);
  console.log(`SAFARI ${JSON.stringify(A.SAFARI)}; start ground ${terrainHeight(A.safariStartNed().north, A.safariStartNed().east).toFixed(1)}`);
  console.log(`herd: n ${herd.north.toFixed(1)} e ${herd.east.toFixed(1)} g ${herd.ground.toFixed(1)}; track frame s ${q.s.toFixed(0)} c ${q.c.toFixed(0)}; at closest approach ${(A.SAFARI_FLIGHT.driftRight * q.s / A.SAFARI_FLIGHT.groundSpeed - q.c).toFixed(0)} m left of the flown path`);
  const report = (name, n, e, g, size, hAbove = 1.5) => {
    const cells = [];
    let first = null, last = null, best = 0;
    for (let t = 0; t <= 60; t += 1) {
      A.projectFromCockpit(t, n, e, g + hAbove, P);
      const where = P.visible ? (A.inDoorWindow(P.bodyBearingDeg) ? 'D' : 'W') : '-';
      if (P.visible) { first ??= t; last = t; best = Math.max(best, size * P.pxPerM); }
      if (t % 2 === 0) cells.push(`${t}${where}${P.bodyBearingDeg.toFixed(0)}/${(-P.bodyElevationDeg).toFixed(0)}/${P.visible ? (size * P.pxPerM).toFixed(0) : '.'}`);
    }
    const pp = A.nedToPath(n, e);
    console.log(`${name}: n ${n.toFixed(1)} e ${e.toFixed(1)} g ${g.toFixed(1)} (s ${pp.s.toFixed(0)} c ${pp.c.toFixed(0)}); visible ${first}-${last} s, up to ${best.toFixed(0)} px (${size} m)`);
    console.log('   ', cells.join(' '));
  };
  report('river herd (9 m)', herd.north, herd.east, herd.ground, 9);
  // Herd ends along the river (the formation is ~1.5 x 62 m along its heading, 250 deg).
  const hh = herd.heading;
  report('  herd end +90 m', herd.north + 90 * Math.cos(hh), herd.east + 90 * Math.sin(hh), herd.ground, 9);
  report('  herd end -90 m', herd.north - 90 * Math.cos(hh), herd.east - 90 * Math.sin(hh), herd.ground, 9);
  // Triceratops: the herd site + 120 m toward the track + 100 m along it.
  const tri = A.pathToNed(q.s + 100, q.c + 120);
  report('triceratops (8.5 m)', tri.north, tri.east, terrainHeight(tri.north, tri.east), 8.5);
  console.log(`   herdGround verdict there: '${herdGround(tri.north, tri.east, T)}'`);
  // T. rex lair: beyond the herd so its charge drives the herd 45 deg from the track direction toward the track.
  const fleeDeg = Number(flags.flee ?? 45), lairDist = Number(flags.lair ?? 260);
  const hd = A.safariHeading() + (fleeDeg * Math.PI) / 180 * (q.c < 0 ? 1 : -1);
  const lair = { north: herd.north - lairDist * Math.cos(hd), east: herd.east - lairDist * Math.sin(hd) };
  report(`trex lair (12.3 m; flee ${fleeDeg} deg)`, lair.north, lair.east, terrainHeight(lair.north, lair.east), 12.3);
  console.log(`   herdGround verdict there: '${herdGround(lair.north, lair.east, T)}'; flee heading ${(((hd * 180) / Math.PI) % 360 + 360) % 360}`);
  // Alamosaurus: nearest stand of tall trees (>= 4 trees >= 15 m within 40 m) to the left-side target.
  const tgtS = Number(flags.alamoS ?? 2600), tgtC = Number(flags.alamoC ?? -320);
  const tg = A.pathToNed(tgtS, tgtC);
  const trees = [];
  const R = 500;
  for (let cz = Math.floor((tg.north - R) / 256); cz <= Math.floor((tg.north + R) / 256); cz++)
    for (let cx = Math.floor((tg.east - R) / 256); cx <= Math.floor((tg.east + R) / 256); cx++) {
      const c = buildTreeCell({ cx, cz, size: 256, spacing: 5.5 });
      for (let i = 0; i < c.count; i++) {
        const o = i * TREE_STRIDE;
        if (c.instances[o + 3] >= 15) trees.push({ e: c.instances[o], g: c.instances[o + 1], n: c.instances[o + 2], h: c.instances[o + 3], sp: Math.floor(c.instances[o + 5]) });
      }
    }
  const stands = trees.map((t) => ({ ...t, k: trees.filter((u) => Math.hypot(u.n - t.n, u.e - t.e) < 40).length, d: Math.hypot(t.n - tg.north, t.e - tg.east) })).filter((t) => t.k >= 4 && t.d <= 400).sort((a, b) => a.d - b.d);
  console.log(`alamosaurus target s ${tgtS} c ${tgtC}: ${trees.length} trees >= 15 m within ${R} m; stands within 400 m: ${stands.length}`);
  for (const s of stands.slice(0, 5)) {
    const pp = A.nedToPath(s.n, s.e);
    console.log(`   stand ${s.d.toFixed(0)} m away: n ${s.n.toFixed(0)} e ${s.e.toFixed(0)} (s ${pp.s.toFixed(0)} c ${pp.c.toFixed(0)}), ${s.k} trees, species ${s.sp}, h ${s.h.toFixed(1)}`);
  }
  // The trio: the open point (herd ground, or merely 'dry' / 'forest'-edge free) nearest the target with a tall
  // tree within 25-90 m (the scale cue), on a 20 m grid within 300 m of the target, at least 280 m left.
  let bestP = null;
  for (let ds = -300; ds <= 300; ds += 20)
    for (let dc = -150; dc <= 150; dc += 20) {
      const cs = tgtS + ds, cc = tgtC + dc;
      if (cc > -280) continue;
      const p = A.pathToNed(cs, cc);
      const v = herdGround(p.north, p.east, T);
      if (v !== '' && v !== 'dry') continue;
      let near = Infinity;
      for (const t of trees) near = Math.min(near, Math.hypot(t.n - p.north, t.e - p.east));
      if (near < 25 || near > 90) continue;
      const d = Math.hypot(ds, dc);
      if (!bestP || d < bestP.d) bestP = { d, s: cs, c: cc, p, v, near };
    }
  if (bestP) {
    console.log(`alamosaurus site: s ${bestP.s} c ${bestP.c} [${bestP.v || 'herd ground'}], nearest tree >= 15 m ${bestP.near.toFixed(0)} m`);
    report('alamosaurus (26 m)', bestP.p.north, bestP.p.east, terrainHeight(bestP.p.north, bestP.p.east), 26, 4);
  } else console.log('alamosaurus: no open site near tall trees');
  // Kettle 0's evening core: ahead right, eye level 20-30 s in.
  const ks = Number(flags.kettleS ?? 1993), kc = Number(flags.kettleC ?? 200);
  const k = A.pathToNed(ks, kc);
  report('kettle 0 core (10 m span, at the aircraft altitude)', k.north, k.east, A.SAFARI_FLIGHT.altitudeMSL, 10, 0);
  console.log(`   ground ${terrainHeight(k.north, k.east).toFixed(1)}`);
  const V = { north: 2000, east: -17500 };
  report('volcano summit (2600 m)', V.north, V.east, 2600 - 1.5, 5500 * 2);
  setEra('present');
}
