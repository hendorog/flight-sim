// Fable Regional airport and the man-made scenery around it, as one render subsystem.
//
// Scene structure (all under `root`, added to ctx.scene in init):
//   local   airport-local frame: x = across (v), y = up from the field elevation, z = -along (-u).
//           Pavement, buildings, fence, props, signs, fixtures and the segmented circle are authored here.
//   lights  every airfield / valley light as one instanced HDR point-sprite draw (world space)
//   socks   windsocks, oriented by ctx.env.wind every frame (world space)
//   valley  town, farms and roads placed with options.heightAt (world space; only if heightAt is given)
//
// Lights and lit windows follow ctx.sky.dayFactor: runway/taxiway/PAPI lights are dim by day and full at night;
// beacon, floodlights, street lights and windows are night only.

import * as THREE from 'three';
import { SCENE_UNITS_PER_LUX, type SimContext, type Subsystem } from '../../core/context';
import { smoothstep } from '../../core/math';
import { AIRPORT } from '../../core/world';
import { buildStructures } from './buildings';
import { BatchSet, boxGeo, cylGeo, GeometryBatch, placement } from './geom';
import { PAPIS } from './layout';
import { createLandside } from './landside';
import { airportLights, createLightPoints, dayBrightnessStep, PAPI_HOUSING, type AirportLights, type LightSpec, type LightsUniforms } from './lights';
import { createMaterials, updateMaterials, type MaterialKey, type MaterialSet } from './materials';
import { createPavement, createRoadMaterial, TAXIWAY_HEIGHT, type PavementTextures } from './pavement';
import { createProps } from './props';
import { createSharedUniforms, FLOOD_COLOR, FLOOD_INTENSITY, floodIlluminance, STREET_COLOR, STREET_ILLUMINANCE, type SharedUniforms } from './shared';
import { createSigns } from './signs';
import { makeAsphaltTexture, makeBuildingTextures, makeConcreteTexture, makeCrackTexture, makeNoiseTexture } from './textures';
import { buildValley } from './valley';
import { buildSegmentedCircle, Windsocks } from './windsock';

export interface AirportSystemOptions {
  /** Terrain elevation MSL at a horizontal NED position (the terrain module's terrainHeight). Enables the valley scenery. */
  heightAt?: (north: number, east: number) => number;
  /**
   * Multiplier on every airfield / valley light's luminous intensity (default 1 = physical candela values on the
   * project's photometric scale, see core/context.ts).
   */
  lightIntensity?: number;
}

/** Night factor from the sky's day factor: lights come on through dusk, fully on at night. */
export function nightFromDayFactor(dayFactor: number): number {
  return 1 - smoothstep(0.25, 0.7, dayFactor);
}

export class AirportSystem implements Subsystem {
  readonly root = new THREE.Group();
  /** Airport-local frame; see the header comment. */
  readonly local = new THREE.Group();
  /**
   * Uniforms shared by the airport materials (night factor, apron floodlight pools, street lighting). Other modules
   * may patch their own MeshStandardMaterials with injectFloodlight(shader, airport.shared) (shared.ts) so the apron
   * floodlights also light them (e.g. the player aircraft or the terrain grass).
   */
  readonly shared: SharedUniforms = createSharedUniforms();
  private readonly disposables: { dispose(): void }[] = [];
  private materials!: MaterialSet;
  private signMaterial!: THREE.MeshStandardMaterial;
  private lightUniforms!: LightsUniforms;
  private windsocks!: Windsocks;
  private readonly drawSize = new THREE.Vector2();
  private floodPower = 0;

  constructor(private readonly options: AirportSystemOptions = {}) {
    this.root.name = 'airport';
    this.local.name = 'airport-local';
    this.local.position.y = AIRPORT.elevation;
    this.local.rotation.y = -AIRPORT.runway.heading;
    this.root.add(this.local);
  }

  init(ctx: SimContext): void {
    const aniso = ctx.renderer.capabilities.getMaxAnisotropy();
    const pave: PavementTextures = {
      asphalt: makeAsphaltTexture(aniso),
      concrete: makeConcreteTexture(aniso),
      crack: makeCrackTexture(aniso),
      noise: makeNoiseTexture(aniso),
    };
    const btex = makeBuildingTextures(aniso);
    this.disposables.push(...Object.values(pave), ...Object.values(btex));

    this.materials = createMaterials(btex, this.shared);
    this.local.add(...createPavement(pave, this.shared));

    // Buildings, segmented circle and light fixtures, batched per material.
    const batches = new BatchSet<MaterialKey>();
    const lights: LightSpec[] = buildStructures(batches);
    buildSegmentedCircle(batches);
    const airfield = airportLights();
    lights.push(...airfield.specs);
    addFixtures(batches, airfield);
    this.local.add(...batches.meshes(this.materials));

    const roadMat = createRoadMaterial('road', pave, this.shared, { width: 7 });
    const carParkMat = createRoadMaterial('carpark', pave, this.shared);
    const landside = createLandside(this.materials, aniso, carParkMat, roadMat);
    this.disposables.push(landside);
    this.local.add(...landside.meshes);
    this.local.add(...createProps(this.materials).meshes);
    const signs = createSigns(aniso);
    this.signMaterial = signs.material;
    this.disposables.push(signs.material.map!);
    this.local.add(signs.mesh);

    this.windsocks = new Windsocks();
    this.disposables.push(this.windsocks);
    lights.push(...this.windsocks.lights);
    this.root.add(this.windsocks.group);

    if (this.options.heightAt) {
      const valleyRoad = createRoadMaterial('road', pave, this.shared, { width: 7, depthBias: 0.0015, streetLights: true });
      const track = createRoadMaterial('road', pave, this.shared, { width: 4, depthBias: 0.0015, markings: false });
      const valley = buildValley(this.options.heightAt, this.shared, valleyRoad, track);
      this.disposables.push(valleyRoad, track, ...valley.materials, ...valley.textures);
      lights.push(...valley.lights);
      this.root.add(valley.group);
    }

    const pts = createLightPoints(lights, this.shared);
    this.lightUniforms = pts.uniforms;
    this.lightUniforms.uIntensity.value = this.options.lightIntensity ?? 1;
    this.root.add(pts.points);

    this.root.updateMatrixWorld(true);
    ctx.scene.add(this.root);
  }

  update(dt: number, ctx: SimContext): void {
    const night = nightFromDayFactor(ctx.sky.dayFactor);
    this.shared.uNight.value = night;
    this.shared.uTime.value = ctx.simTime;
    this.shared.uFloodColor.value.copy(FLOOD_COLOR).multiplyScalar(FLOOD_INTENSITY * smoothstep(0.5, 0.9, night));
    this.shared.uStreetColor.value.copy(STREET_COLOR).multiplyScalar(STREET_ILLUMINANCE * smoothstep(0.5, 0.9, night));
    updateMaterials(this.materials, night);
    // Internally lit signs: white legend ~30 cd/m^2 (AC 150/5345-44), scene units.
    this.signMaterial.emissiveIntensity = 3.0 * night;
    this.floodPower = smoothstep(0.5, 0.9, night);
    this.lightUniforms.uExposure.value = estimateExposure(ctx, this.artificialIlluminance(ctx.camera.position) * SCENE_UNITS_PER_LUX);
    this.lightUniforms.uDayStep.value = dayBrightnessStep(ctx.weather.visibilityM);
    this.lightUniforms.uHaze.value.set(ctx.sky.hazeExtinction ?? 0, ctx.sky.hazeScaleHeight ?? 1200);
    ctx.renderer.getDrawingBufferSize(this.drawSize);
    this.lightUniforms.uViewportH.value = this.drawSize.y;
    this.lightUniforms.uMinPx.value = 2.5 * (this.drawSize.y / 1080) + 0.5;
    this.windsocks.update(dt, ctx, night);
  }

  /**
   * Illuminance from the airport's own lighting (the apron floodlights, as currently switched) that a viewer at a
   * world position is adapted to, lux: the mean illuminance of the ground around and below the viewer (5 samples
   * over a 40 m cross), fading out as the viewer climbs from 20 m to 80 m above the field, where the lit apron
   * becomes a small part of the view. A viewer on a floodlit apron adapts to it, so the post chain's exposure
   * reference (a grey card under the ambient light) should include it, or a floodlit apron is exposed for
   * moonlight and clips to a uniform white.
   */
  artificialIlluminance(position: THREE.Vector3): number {
    if (!(this.floodPower > 0)) return 0;
    const fade = 1 - smoothstep(20, 80, position.y - AIRPORT.elevation);
    if (fade <= 0) return 0;
    let e = 0;
    for (const [dx, dz] of CROSS) {
      _ground.set(position.x + dx, AIRPORT.elevation, position.z + dz);
      e += floodIlluminance(this.shared, _ground);
    }
    return (fade * this.floodPower * e) / CROSS.length;
  }

  /** Change the global light radiance multiplier at run time (see AirportSystemOptions.lightIntensity). */
  setLightIntensity(k: number): void {
    this.lightUniforms.uIntensity.value = k;
  }

  dispose(): void {
    this.root.removeFromParent();
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Points) {
        o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) m.dispose();
      }
    });
    for (const d of this.disposables) d.dispose();
  }
}

const CROSS: readonly [number, number][] = [[0, 0], [20, 0], [-20, 0], [0, 20], [0, -20]];
const _ground = new THREE.Vector3();

const lum = (c: THREE.Color): number => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

/**
 * Approximate display exposure of the post chain (render/post: grey-card reference, key lowered in the dark),
 * from the sky state plus any artificial illuminance at the viewer (scene units). Used to size glare halos and to
 * clamp signal-light cores, so metering differences do not matter much.
 */
export function estimateExposure(ctx: SimContext, artificial = 0): number {
  const { sunColor, moonColor, skyColor, sunDir, moonDir } = ctx.sky;
  const direct = lum(sunColor) * Math.max(sunDir.y, 0) + lum(moonColor) * Math.max(moonDir.y, 0) + artificial;
  const grey = Math.max(0.18 * ((direct + 1e-3 * SCENE_UNITS_PER_LUX) / Math.PI + lum(skyColor)), 1e-9);
  const ev = Math.log2(grey / SCENE_UNITS_PER_LUX);
  const keyBias = Math.max(-0.2 * Math.max(0, 11 - ev), -4.5);
  return (0.18 * Math.pow(2, keyBias)) / grey;
}

/** Elevated light fixtures (frangible stalk + coloured lens) and PAPI housings. */
function addFixtures(b: BatchSet<MaterialKey>, airfield: AirportLights): void {
  const stalk = new GeometryBatch().add(cylGeo(0.025, 0.035, 0.3, 6), placement(0, 0.15, 0)).build();
  for (const f of airfield.fixtures) {
    b.get('steel').add(stalk.clone(), placement(f.v, TAXIWAY_HEIGHT, -f.u), 0xb8a040);
    b.get('glass').add(cylGeo(0.07, 0.07, 0.12, 10), placement(f.v, TAXIWAY_HEIGHT + 0.36, -f.u), f.color.clone().lerp(new THREE.Color(1, 1, 1), 0.5));
  }
  stalk.dispose();
  // Approach light bars: frangible stanchion, crossbar and PAR-56 lamp housings aimed at the approach.
  for (const bar of airfield.approachBars) {
    const vs = bar.lamps;
    const v0 = Math.min(...vs), v1 = Math.max(...vs);
    b.get('steel').add(cylGeo(0.05, 0.06, bar.height, 8), placement(0, bar.height / 2, -bar.u), 0xd8d8d0);
    if (v1 - v0 > 6) for (const v of [v0 + 1, v1 - 1]) b.get('steel').add(cylGeo(0.04, 0.05, bar.height, 8), placement(v, bar.height / 2, -bar.u), 0xd8d8d0);
    b.get('steel').add(boxGeo(v1 - v0 + 0.3, 0.08, 0.08), placement((v0 + v1) / 2, bar.height, -bar.u), 0xd8d8d0);
    for (const v of vs) {
      b.get('trim').add(cylGeo(0.1, 0.1, 0.16, 10), placement(v, bar.height + 0.12, -bar.u, 0, Math.PI / 2 - 0.06), 0x2a2a2a);
      b.get('glass').add(cylGeo(0.085, 0.085, 0.02, 10), placement(v, bar.height + 0.12, -(bar.u - 0.09), 0, Math.PI / 2 - 0.06), 0xffffff);
    }
  }
  // REIL units: a strobe head on a short post beside each threshold.
  for (const r of airfield.reil) {
    b.get('steel').add(cylGeo(0.04, 0.05, 0.6, 8), placement(r.v, 0.3, -r.u), 0xd8d8d0);
    b.get('trim').add(boxGeo(0.3, 0.25, 0.35), placement(r.v, 0.7, -r.u), 0x2a2a2a);
    b.get('glass').add(boxGeo(0.2, 0.15, 0.02), placement(r.v, 0.7, -(r.u + r.facing * 0.18)), 0xffffff);
  }
  // PAPI light units: a painted two-lamp projector box on four frangible legs, the two lenses (sunk in short hoods)
  // on the face toward the approach. The lamp sprites (lights.ts) sit just in front of these lenses.
  const H = PAPI_HOUSING;
  for (const papi of PAPIS) {
    for (const u of papi.units) {
      const face = papi.facingU; // housings face the approach (-u for 07, +u for 25)
      b.get('paint').add(boxGeo(H.width, H.height, H.depth), placement(u.v, u.height, -u.u), 0xc89a2c);
      b.get('trim').add(boxGeo(H.width + 0.04, 0.03, H.depth + 0.04), placement(u.v, u.height + H.height / 2 + 0.015, -u.u), 0x9c7a24);
      for (const dv of [-H.lampSpacing / 2, H.lampSpacing / 2]) {
        const zFace = -(u.u + face * H.depth / 2);
        b.get('trim').add(cylGeo(H.lensRadius + 0.025, H.lensRadius + 0.025, 0.06, 16), placement(u.v + dv, u.height, zFace - face * 0.03, 0, Math.PI / 2), 0x202020);
        b.get('glass').add(cylGeo(H.lensRadius, H.lensRadius, 0.02, 16), placement(u.v + dv, u.height, zFace - face * 0.05, 0, Math.PI / 2), 0xffffff);
      }
      const legH = u.height - H.height / 2;
      for (const dv of [-0.28, 0.28]) {
        for (const du of [-0.3, 0.3]) b.get('steel').add(cylGeo(0.025, 0.03, legH, 6), placement(u.v + dv, legH / 2, -(u.u + du)), 0x808080);
      }
    }
  }
}
