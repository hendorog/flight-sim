// Cascade selection must work in both depth conventions. Under reversed-Z (the simulator's default) an
// orthographic shadow camera maps its far plane to z = 0, so ground far below a small cascade's slab has
// z < 0; a forward-Z-only range test (z <= 1) let such fragments take that cascade's shadow and compare
// against the map's cleared depth (0), painting huge straight-edged false shadows on the ground.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SunShadows } from '../../src/render/sky/SunShadows';

/** GLSL cascade test from the patched chunk, evaluated on the CPU. */
function selectsCascade(z: number, xy: THREE.Vector2): boolean {
  return xy.x >= 0 && xy.x <= 1 && xy.y >= 0 && xy.y <= 1 && z >= 0 && z <= 1;
}

function shadowCoord(light: THREE.DirectionalLight, reversed: boolean, p: THREE.Vector3): THREE.Vector3 {
  // Exactly what WebGLShadowMap does before rendering a map: set the depth convention, then let the
  // light build its shadow camera and shadow matrix (the matrix the shaders use as vDirectionalShadowCoord).
  (light.shadow.camera as unknown as { _reversedDepth: boolean })._reversedDepth = reversed;
  light.shadow.camera.updateProjectionMatrix();
  light.shadow.updateMatrices(light);
  const v = new THREE.Vector4(p.x, p.y, p.z, 1).applyMatrix4(light.shadow.matrix);
  return new THREE.Vector3(v.x / v.w, v.y / v.w, v.z / v.w);
}

describe('SunShadows cascade selection', () => {
  it('the installed chunk bounds the cascade depth on both sides and flips the PCF bias for reversed-Z', () => {
    const chunk = THREE.ShaderChunk.lights_fragment_begin;
    expect(chunk).toContain('csmCoord.z >= 0.0 && csmCoord.z <= 1.0');
    expect(chunk).toMatch(/USE_REVERSED_DEPTH_BUFFER[\s\S]*csmBiasSign = -1\.0/);
  });

  it('ground far below the aircraft falls outside the fine cascades in both depth modes', () => {
    const s = new SunShadows();
    s.setQuality('high');
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 200_000);
    camera.position.set(0, 1370, 0);
    camera.lookAt(0, 1300, -1000); // chase view, looking slightly down
    camera.updateMatrixWorld();
    const sunDir = new THREE.Vector3(-0.6, 0.35, 0.3).normalize(); // low evening sun
    s.update(camera, sunDir, new THREE.Color(1, 1, 1));
    const lights = s.group.children.filter((o): o is THREE.DirectionalLight => (o as THREE.DirectionalLight).isDirectionalLight);
    // For each fine cascade, the ground point that lies in the sun's line of sight behind the cascade's
    // centre: inside its map footprint, but 1.3+ km beyond its slab along the light.
    let footprintHits = 0;
    for (let i = 0; i < 3; i++) {
      const centre = lights[i].target.position;
      const ground = centre.clone().addScaledVector(sunDir, -centre.y / sunDir.y);
      for (const reversed of [false, true]) {
        const c = shadowCoord(lights[i], reversed, ground);
        const inXY = c.x >= 0 && c.x <= 1 && c.y >= 0 && c.y <= 1;
        if (!inXY) continue;
        footprintHits++;
        // In the map's footprint but beyond its far plane: z > 1 forward, z < 0 reversed.
        expect(reversed ? c.z < 0 : c.z > 1).toBe(true);
        expect(selectsCascade(c.z, new THREE.Vector2(c.x, c.y))).toBe(false);
      }
    }
    // The case that failed: the point lies inside some fine cascade's map footprint.
    expect(footprintHits).toBe(6);
    // The aircraft itself (at the camera's focus) is inside the first cascade in both modes.
    for (const reversed of [false, true]) {
      const near = camera.position.clone().addScaledVector(new THREE.Vector3(0, -0.07, -1).normalize(), 4);
      const c = shadowCoord(lights[0], reversed, near);
      expect(selectsCascade(c.z, new THREE.Vector2(c.x, c.y))).toBe(true);
    }
  });
});
