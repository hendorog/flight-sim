// Airport dev page: AirportSystem on a stand-in terrain, lit by the real SkySystem and rendered through the real
// PostPipeline (aerial perspective, auto exposure, bloom), so lights on the photometric scale can be judged. Extra URL parameters (besides the harness ones):
//   terrain=flat|hills   hills (default) = synthetic valley with a lake, flat inside the airport zone; the same
//                        function is passed to AirportSystem as heightAt
//   wind=dir,kt          wind direction (from, deg true) and speed; default 250,12
//   ev=0                 exposure compensation, EV (the real sky, auto exposure and post chain are used)
//   q=high               quality level
//   lcam=u,v,h           camera in airport-local coordinates (along, across, height above the field); overrides cam
//   llook=u,v,h          look-at point in airport-local coordinates

import * as THREE from 'three';
import type { QualityLevel } from '../core/context';
import { nedToThree } from '../core/frames';
import { KT, smoothstep } from '../core/math';
import { AIRPORT, runwayCoords } from '../core/world';
import { PostPipeline } from '../render/post';
import { SkySystem } from '../render/sky';
import { AirportSystem, localToNed } from '../world/airport';
import { runHarness } from './harness';

const params = new URLSearchParams(location.search);
const terrainMode = params.get('terrain') ?? 'hills';
const [windDir, windKt] = (params.get('wind') ?? '250,12').split(',').map(Number);

/** Synthetic valley: rolling hills rising away from the airport, a lake to the north-east, flat airfield zone. */
function hillsHeight(north: number, east: number): number {
  const { along, across } = runwayCoords(north, east);
  const dx = Math.max(0, Math.abs(along) - AIRPORT.runway.length / 2);
  const dy = Math.max(0, Math.abs(across) - AIRPORT.runway.width / 2);
  const d = Math.hypot(dx, dy);
  const blend = smoothstep(AIRPORT.flatMargin, AIRPORT.flatMargin + AIRPORT.blendDistance, d);
  const hills =
    40 * Math.sin(north / 1900) * Math.cos(east / 2300) +
    25 * Math.sin(north / 830 + 1.3) * Math.sin(east / 970) +
    9 * Math.sin(north / 310) * Math.cos(east / 270 + 0.7) +
    Math.max(0, Math.hypot(north, east) - 6000) * 0.12;
  const lake = -140 * Math.exp(-(((north - 5200) / 1400) ** 2) - (((east - 3800) / 1900) ** 2));
  return AIRPORT.elevation + blend * (hills + lake);
}
const heightAt = terrainMode === 'hills' ? hillsHeight : undefined;

function terrainMesh(): THREE.Object3D {
  const group = new THREE.Group();
  const size = 24000, seg = terrainMode === 'hills' ? 480 : 1;
  const g = new THREE.PlaneGeometry(size, size, seg, seg).rotateX(-Math.PI / 2);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, heightAt ? heightAt(-pos.getZ(i), pos.getX(i)) : AIRPORT.elevation);
  }
  g.computeVertexNormals();
  const ground = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x3f5f2c, roughness: 1 }));
  ground.receiveShadow = true;
  group.add(ground);
  if (heightAt) {
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x0c1c24, roughness: 0.08, metalness: 0.1 }),
    );
    water.position.y = 0;
    group.add(water);
  }
  return group;
}

const airport = new AirportSystem({ heightAt });
let post: PostPipeline;

void runHarness({
  basicLighting: false,
  subsystems: [new SkySystem(), airport],
  setup(ctx) {
    ctx.scene.add(terrainMesh());
    const local = (key: string): THREE.Vector3 | null => {
      const p = params.get(key)?.split(',').map(Number);
      if (!p || p.length !== 3) return null;
      const n = localToNed(p[0], p[1]);
      return nedToThree({ x: n.north, y: n.east, z: -(AIRPORT.elevation + p[2]) });
    };
    const lcam = local('lcam'), llook = local('llook');
    if (lcam) ctx.camera.position.copy(lcam);
    if (llook) ctx.camera.lookAt(llook);
    ctx.weather.windDirectionDeg = windDir;
    ctx.weather.windSpeedKt = windKt;
    // The mock environment has no wind; derive it from the weather settings with a gentle gust.
    ctx.env.wind = (_p, t) => {
      const from = (ctx.weather.windDirectionDeg * Math.PI) / 180;
      const s = ctx.weather.windSpeedKt * KT * (1 + 0.15 * Math.sin(t * 0.7) * Math.sin(t * 1.9));
      return { x: -Math.cos(from) * s, y: -Math.sin(from) * s, z: 0 };
    };

    if (params.has('q')) ctx.quality = params.get('q') as QualityLevel;
    post = new PostPipeline(ctx.renderer, ctx.scene, ctx.camera);
    post.exposureBias = Number(params.get('ev') ?? 0);
  },
  render(dt, ctx) {
    post.render(ctx, dt);
  },
});
