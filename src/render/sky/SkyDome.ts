// The visible sky, drawn first in the scene as a camera-centred box without depth, so sky pixels keep
// the cleared depth (isSky in DEPTH_GLSL) and everything else draws over it. A second material renders
// the same sky without sun, moon and stars for the environment map.

import * as THREE from 'three';
import { MOON_TINT, type Atmosphere } from './Atmosphere';
import { CLOUD_CELL_ASPECT, type CloudSky } from './cloudSky';
import { SKY_DOME_FRAG, SKY_DOME_VERT } from './glsl/skyDome';
import { MOON_ANGULAR_RADIUS, MOON_FULL_ILLUMINANCE_TOA, SUN_ANGULAR_RADIUS, SUN_ILLUMINANCE_TOA } from './params';

const MOON_SOLID_ANGLE = Math.PI * MOON_ANGULAR_RADIUS * MOON_ANGULAR_RADIUS;
const SUN_SOLID_ANGLE = Math.PI * SUN_ANGULAR_RADIUS * SUN_ANGULAR_RADIUS;

function skyMaterial(uniforms: Record<string, THREE.IUniform>, env: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: SKY_DOME_VERT,
    fragmentShader: SKY_DOME_FRAG,
    uniforms,
    defines: env ? { ENV_MAP: '' } : {},
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
}

export class SkyDome {
  /** Add to the main scene; renders before all other geometry. */
  readonly mesh: THREE.Mesh;
  /** Sky without celestial bodies, for the environment probe's own scene. */
  readonly envMesh: THREE.Mesh;

  readonly uniforms: Record<string, THREE.IUniform>;
  private readonly geometry = new THREE.BoxGeometry(2, 2, 2);
  private readonly material: THREE.ShaderMaterial;
  private readonly envMaterial: THREE.ShaderMaterial;
  private readonly worldToEquatorial = new THREE.Matrix3();

  constructor(private readonly atmosphere: Atmosphere) {
    this.uniforms = {
      ...atmosphere.uniforms,
      uGroundRadiance: { value: new THREE.Vector3() },
      uSunDiscRadiance: { value: new THREE.Vector3().setScalar(SUN_ILLUMINANCE_TOA / SUN_SOLID_ANGLE) },
      // Full-moon disc radiance; the shader's Lommel-Seeliger shading produces the phase.
      uMoonRadiance: { value: MOON_TINT.clone().multiplyScalar(MOON_FULL_ILLUMINANCE_TOA / MOON_SOLID_ANGLE) },
      uCelestialPole: { value: new THREE.Vector3(0, 1, 0) },
      uWorldToEquatorial: { value: this.worldToEquatorial },
      uPixelAngle: { value: 0.001 },
      uNight: { value: 0 },
      uTime: { value: 0 },
      // Cloud layer (environment map only; the visible clouds are the clouds module's), see cloudSky.ts.
      uCloudA: { value: new THREE.Vector4() },
      uCloudB: { value: new THREE.Vector2() },
      uCloudBase: { value: new THREE.Vector3() },
      uCloudSideToward: { value: new THREE.Vector3() },
      uCloudSideAway: { value: new THREE.Vector3() },
      uCloudTop: { value: new THREE.Vector3() },
      uCloudLight: { value: new THREE.Vector2(1, 0) },
      // Ground under the aircraft (environment map only): rgb radiance, w = patch radius / height.
      uLocalGround: { value: new THREE.Vector4(0, 0, 0, 0) },
    };
    this.material = skyMaterial(this.uniforms, false);
    this.envMaterial = skyMaterial(this.uniforms, true);
    this.mesh = this.makeMesh(this.material, 'sky');
    this.envMesh = this.makeMesh(this.envMaterial, 'skyEnvironment');
  }

  private makeMesh(material: THREE.Material, name: string): THREE.Mesh {
    const mesh = new THREE.Mesh(this.geometry, material);
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.renderOrder = -1e9;
    mesh.matrixAutoUpdate = false;
    return mesh;
  }

  /**
   * @param pixelAngle     angular size of one pixel, rad (keeps stars and disc edges one pixel soft)
   * @param groundRadiance radiance of the ground seen below the horizon, linear RGB scene units
   */
  update(time: number, pixelAngle: number, groundRadiance: THREE.Vector3): void {
    const c = this.atmosphere.celestial;
    const u = this.uniforms;
    u.uGroundRadiance.value.copy(groundRadiance);
    u.uPixelAngle.value = pixelAngle;
    u.uTime.value = time;
    // Stars and Milky Way are far below the daylight sky: skip them while the sun is above ~6 deg.
    u.uNight.value = THREE.MathUtils.smoothstep(-c.sunDir.y, -0.1, 0.05);
    this.worldToEquatorial.copy(c.equatorialToWorld).transpose();
    u.uCelestialPole.value.set(0, 0, 1).applyMatrix3(c.equatorialToWorld);
  }

  /** Cloud-layer lighting for the environment map; keyDir is the key light's direction. */
  setClouds(clouds: CloudSky, keyDir: THREE.Vector3): void {
    const u = this.uniforms;
    u.uCloudA.value.set(clouds.cover, clouds.above, clouds.hazeAtCamera, CLOUD_CELL_ASPECT);
    u.uCloudB.value.set(clouds.distBase, clouds.distTop);
    u.uCloudBase.value.fromArray(clouds.base);
    u.uCloudSideToward.value.fromArray(clouds.sideToward);
    u.uCloudSideAway.value.fromArray(clouds.sideAway);
    u.uCloudTop.value.fromArray(clouds.top);
    const h = Math.hypot(keyDir.x, keyDir.z);
    if (h > 1e-6) u.uCloudLight.value.set(keyDir.x / h, keyDir.z / h);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.envMaterial.dispose();
  }
}
