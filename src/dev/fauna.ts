// Creature gallery (Deep Time fauna art): the species on a flat ground with a 1.8 m figure for scale, a
// turntable hero and a gait strip (copies at evenly spaced phases of the gait or action), drawn with the real
// animated instanced materials (faunaMaterial.ts).
//
//   dev/fauna.html?species=all&gait=1&freeze=1
//   species=edmontosaurus|quetzalcoatlus|azhdarchidSmall|tyrannosaurus|triceratops|alamosaurus|pteranodon|inc1|all
//                  (default all: a line-up of every species, no strip; inc1 = the increment-1 line-up)
//   gait=0..2      gaitBlend (0 graze/stand, 1 walk, 2 run; azhdarchid 1..2 = launch progress, 2 = airborne)
//   action=graze|alert|walk|run|roar|face|stand|launch|flap|glide   (overrides gait; the strip spans the action)
//   alert=0..1     ground rigs' action channel aInstC.x (hadrosaur head up; theropod roar; ceratopsian facing)
//   flap=0..1      azhdarchid stroke amplitude aloft
// Every species is drawn at its real size (roster SPECIES_REFERENCE_M; the inc-2 stubs are scaled bodies).
//   lod=0|1|2      which LOD to draw                          strip=N   copies in the strip (0 = none)
//   t=seconds      animation time (phase and secondary motion; with freeze=1 it is the frozen instant)
//   turn=rad/s     hero turntable rate (yaw = 90 deg + turn * t)
//   pitch=, bank=  hero attitude, degrees (nose up +, right wing down +; checks the instance convention)
//   far=metres     move the whole exhibit this far north of the default camera (LOD2 checks: far=5000)
//   cam=, look=, tod=, freeze=1 as in every harness page.
import * as THREE from 'three';
import { AIRPORT } from '../core/world';
import { createFaunaInstances, createFaunaMaterials, createFaunaMesh, writeFaunaInstance, type FaunaInstances, type FaunaMaterials } from '../world/fauna/faunaMaterial';
import { azhdarchidLaunch, AZHDARCHID_LAUNCH_S, buildFaunaSpecies, FAUNA_SPECIES, strideM } from '../world/fauna/species/index';
import { SPECIES_REFERENCE_M } from '../world/fauna/roster';
import { FAUNA_SPECIES_IDS, type FaunaSpeciesId } from '../world/fauna/types';
import { runHarness } from './harness';

const params = new URLSearchParams(location.search);
const num = (k: string, d: number): number => {
  const v = params.get(k);
  return v === null || v === '' || Number.isNaN(Number(v)) ? d : Number(v);
};
const speciesParam = params.get('species') ?? 'all';
const INC1: FaunaSpeciesId[] = ['edmontosaurus', 'quetzalcoatlus', 'azhdarchidSmall'];
const shown: FaunaSpeciesId[] = FAUNA_SPECIES_IDS.includes(speciesParam as FaunaSpeciesId)
  ? [speciesParam as FaunaSpeciesId]
  : speciesParam === 'inc1'
    ? INC1
    : [...FAUNA_SPECIES_IDS];
const lineupAll = !shown.every((id) => INC1.includes(id));
const single = shown.length === 1;
const action = params.get('action');
const lod = Math.max(0, Math.min(2, Math.round(num('lod', 0))));
const stripN = Math.max(0, Math.round(num('strip', single ? 6 : 0)));
const turn = num('turn', 0);
const far = num('far', 0);
const heroPitch = (num('pitch', 0) * Math.PI) / 180;
const heroBank = (num('bank', 0) * Math.PI) / 180;
let t = num('t', 0);

interface Pose {
  gait: number;
  alert: number;
  flap: number;
  /** Height of the origin above its standing height, m (scale 1). */
  lift: number;
  airborne: boolean;
}

/** The pose of a species for the action at a fraction f of its cycle (strip) or time (hero). */
function poseFor(id: FaunaSpeciesId, f: number | null, time: number): Pose {
  const rig = FAUNA_SPECIES[id].rig;
  const gait = num('gait', 1);
  const base: Pose = { gait, alert: num('alert', 0), flap: num('flap', 1), lift: 0, airborne: false };
  if (rig !== 'azhdarchid') {
    if (action === 'graze') return { ...base, gait: 0, alert: 0 };
    if (action === 'alert' || action === 'roar' || action === 'face') return { ...base, gait: 0, alert: 1 };
    if (action === 'walk') return { ...base, gait: 1 };
    if (action === 'run') return { ...base, gait: 2 };
    return { ...base, gait: Math.min(2, Math.max(0, gait)) };
  }
  if (action === 'stand') return { ...base, gait: 0 };
  if (action === 'walk') return { ...base, gait: 1 };
  if (action === 'flap') return { ...base, gait: 2, flap: num('flap', 1), lift: 6, airborne: true };
  if (action === 'glide') return { ...base, gait: 2, flap: num('flap', 0), lift: 6, airborne: true };
  if (action === 'launch') {
    // The strip spans the launch; the hero repeats it every 4 s.
    const s = f !== null ? f * AZHDARCHID_LAUNCH_S : time % 4;
    const l = azhdarchidLaunch(s);
    return { ...base, gait: l.gaitBlend, flap: 1, lift: l.climbM, airborne: false };
  }
  if (gait >= 2) return { ...base, gait: 2, lift: 6, airborne: true };
  return { ...base, gait: Math.max(0, gait) };
}

interface Exhibit {
  id: FaunaSpeciesId;
  /** Real-size factor: SPECIES_REFERENCE_M / mesh lengthM. */
  unit: number;
  inst: FaunaInstances;
  mats: FaunaMaterials;
  /** Instance placements: east, north, yaw, strip fraction (null = hero). */
  slots: { east: number; north: number; yaw: number; f: number | null }[];
}

const exhibits: Exhibit[] = [];
const y0 = AIRPORT.elevation;

function writeAll(time: number): void {
  for (const ex of exhibits) {
    const info = FAUNA_SPECIES[ex.id];
    // Real size: x the mesh unit (exactly 1 for the inc-1 species, whose builders report their reference size).
    const scale = info.defaultScale * ex.unit;
    ex.slots.forEach((s, i) => {
      const p = poseFor(ex.id, s.f, time);
      let phase: number;
      if (s.f !== null && action !== 'launch') phase = s.f;
      else if (p.airborne) phase = time * (info.flapHz / Math.sqrt(scale));
      else phase = (time * (p.gait >= 1.5 ? info.speed.run : info.speed.walk) * scale) / strideM(ex.id, p.gait, scale);
      const alt = y0 + (info.groundOffsetM + p.lift) * scale;
      const flap = info.rig !== 'azhdarchid' ? p.alert : p.flap;
      const yaw = s.f === null ? s.yaw + turn * time : s.yaw;
      const hero = s.f === null;
      writeFaunaInstance(ex.inst.array, i, s.east, alt, s.north + far, yaw, hero ? heroPitch : 0, hero ? heroBank : 0, phase, p.gait, flap, 0, scale, i + 0.37 * i);
    });
    ex.inst.setCount(ex.slots.length);
    ex.mats.uniforms.uTime.value = time;
  }
}

void runHarness({
  subsystems: [
    {
      init(ctx) {
        const airborne = shown.some((id) => poseFor(id, null, 0).airborne);
        // A single big species is framed from farther (x1 up to the Edmontosaurus's 11.5 m).
        const k = single && FAUNA_SPECIES[shown[0]].rig !== 'azhdarchid' ? Math.max(1, SPECIES_REFERENCE_M[shown[0]] / 11.5) : 1;
        if (!params.has('cam')) {
          if (single && stripN > 0) {
            ctx.camera.position.set(0, y0 + (airborne ? 10 : 8) * k, 50 * k);
            ctx.camera.lookAt(0, y0 + (airborne ? 6 : 2) * k, 4 * k);
          } else if (single) {
            ctx.camera.position.set(0, y0 + (airborne ? 9 : 4.5) * k, 26 * k);
            ctx.camera.lookAt(0, y0 + (airborne ? 8 : 2.6) * k, 0);
          } else if (lineupAll) {
            // Every species: a wider, higher view (the 26 m Alamosaurus).
            ctx.camera.position.set(0, y0 + 9, 70);
            ctx.camera.lookAt(0, y0 + 4, 0);
          } else {
            ctx.camera.position.set(3, y0 + 3.4, 23);
            ctx.camera.lookAt(3, y0 + 2.4, 0);
          }
          if (far > 0) ctx.camera.lookAt(0, y0 + 3, -far);
        }
        const ground = new THREE.Mesh(new THREE.PlaneGeometry(20000, 20000).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x4a4a2c, roughness: 1 }));
        ground.position.y = y0;
        ground.receiveShadow = true;
        ctx.scene.add(ground);
        ctx.scene.traverse((o) => {
          if (o instanceof THREE.DirectionalLight) {
            o.castShadow = true;
            o.shadow.mapSize.set(2048, 2048);
            const c = o.shadow.camera;
            c.left = c.bottom = -40;
            c.right = c.top = 40;
            c.near = 1;
            c.far = 2000;
            o.position.copy(ctx.sky.sunDir).multiplyScalar(500).add(new THREE.Vector3(0, y0, -far));
            o.target.position.set(0, y0, -far);
            o.target.updateMatrixWorld();
          }
        });
        // A 1.8 m figure for scale.
        const figure = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 1.36, 4, 10), new THREE.MeshStandardMaterial({ color: new THREE.Color(0.12, 0.1, 0.09), roughness: 0.8 }));
        figure.position.set(single ? -9 : 17, y0 + 0.9, -far);
        figure.castShadow = true;
        ctx.scene.add(figure);

        const lines: string[] = [];
        // Columns: the inc-1 line-up as before; with every species, a wider one.
        const colX: Record<FaunaSpeciesId, number> = lineupAll
          ? { alamosaurus: -42, tyrannosaurus: -16, edmontosaurus: -2, triceratops: 11, quetzalcoatlus: 22, azhdarchidSmall: 31, pteranodon: 38 }
          : { edmontosaurus: -6, quetzalcoatlus: 7, azhdarchidSmall: 13, tyrannosaurus: 0, triceratops: 0, alamosaurus: 0, pteranodon: 0 };
        for (const id of shown) {
          const set = buildFaunaSpecies(id);
          const mats = createFaunaMaterials(id, set);
          const unit = SPECIES_REFERENCE_M[id] / set.lengthM;
          // Strip spacing grows with the body (x1 for the inc-1 species).
          const size = Math.max(1, (unit * set.lengthM) / 11.5);
          const slots: Exhibit['slots'] = [];
          // Hero facing east (side view from the south), at the column or the centre.
          slots.push({ east: single ? 0 : colX[id], north: 0, yaw: Math.PI / 2, f: null });
          const spacing = (FAUNA_SPECIES[id].rig === 'azhdarchid' ? 11.5 : 12.5) * FAUNA_SPECIES[id].defaultScale * (FAUNA_SPECIES[id].rig === 'azhdarchid' ? 1 : size);
          for (let i = 0; i < stripN; i++) slots.push({ east: (i - (stripN - 1) / 2) * spacing, north: -16, yaw: Math.PI / 2, f: i / stripN });
          const inst = createFaunaInstances(slots.length);
          const geo = [set.lod0, set.lod1, set.lod2][lod];
          const mesh = createFaunaMesh(geo, inst, mats);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          ctx.scene.add(mesh);
          exhibits.push({ id, unit, inst, mats, slots });
          lines.push(`${FAUNA_SPECIES[id].name}: LOD${lod} ${geo.index!.count / 3} tris (LOD0 ${set.lod0.index!.count / 3} / LOD1 ${set.lod1.index!.count / 3} / LOD2 ${set.lod2.index!.count / 3}), x${FAUNA_SPECIES[id].defaultScale}`);
        }
        // The strip runs from left to right in phase; north = -16 puts it nearer the camera than the hero row.
        const label = document.createElement('div');
        label.style.cssText = 'position:fixed;left:10px;top:8px;font:12px/1.4 system-ui,sans-serif;color:#eee;text-shadow:0 1px 2px #000;pointer-events:none';
        label.textContent = `${lines.join('  |  ')}  |  gait ${num('gait', 1)}${action ? ` action ${action}` : ''} t ${t}`;
        document.body.appendChild(label);
        writeAll(t);
      },
      update(dt) {
        t += dt;
        writeAll(t);
      },
    },
  ],
});
