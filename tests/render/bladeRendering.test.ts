import * as THREE from 'three';
import { expect, it } from 'vitest';
import { loadAirframeVisual } from '../../src/aircraft/visualLoader';
import { Propeller } from '../../src/render/aircraft/propeller';
import { SYNTHETIC_TWIN } from '../../src/render/aircraft/airframe/testbed';
import { TeeteringRotor } from '../../src/render/aircraft/rotorcraft/rotor';
import { fakeMaterials } from '../aircraft/meshChecks';
import { bladeConing } from '../../src/physics/rotorcraft/coning';

const instances = (root: THREE.Object3D): THREE.InstancedMesh[] => {
  const meshes: THREE.InstancedMesh[] = [];
  root.traverse(o => { if (o instanceof THREE.InstancedMesh) meshes.push(o); });
  return meshes;
};
const releaseGeometry = (root: THREE.Object3D): void => {
  root.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
};

it.each(['c172s', 'c152', 'pa38', 'da20', 'pa34', 'da42', 'syn-twin'])('renders real slow blades and independent discs on %s', async id => {
  // DA42 is still a C172 visual placeholder on main; the synthetic twin exercises three-blade feathering.
  const def = id === 'syn-twin' ? SYNTHETIC_TWIN : await loadAirframeVisual(id), materials = fakeMaterials();
  const props = def.props.map((p, i) => new Propeller(materials, p, i > 0));
  props.forEach((prop, i) => {
    const p = def.props[i], blades = instances(prop.group);
    const trail = prop.group.getObjectByName('bladeTrail')!;
    for (const rpm of [0, 30, 60, 100, 180, 300, 650, 2400, 180, 60, 0]) {
      prop.update(p.rotation * 0.7, rpm, p.referencePitch);
      expect(prop.group.rotation.z).toBe(-p.rotation * 0.7);
      for (const blade of blades) {
        // Fixed-pitch geometry contains all blades; variable-pitch instances contain one each.
        expect(blade.count).toBe(p.variablePitch ? p.blades : 1);
        if (rpm <= 100) {
          expect((blade.material as THREE.Material).opacity).toBe(1);
          expect((blade.material as THREE.Material).depthWrite).toBe(true);
          expect(blade.parent!.visible).toBe(true);
          expect(trail.visible).toBe(false);
        }
        if (rpm === 2400) {
          expect(blade.parent!.visible).toBe(false);
          expect(blade.castShadow).toBe(false);
          expect(trail.visible).toBe(false);
        }
      }
      if (rpm === 180) expect(trail.visible).toBe(true);
    }
    if (p.variablePitch) {
      const fine = new THREE.Matrix4(), feather = new THREE.Matrix4();
      blades[0].getMatrixAt(0, fine);
      prop.update(0.7 * p.rotation, 60, 84 * Math.PI / 180);
      blades[0].getMatrixAt(0, feather);
      expect(feather.elements).not.toEqual(fine.elements);
      expect((blades[0].material as THREE.Material).opacity).toBe(1);
    }
  });
  if (props.length > 1) {
    props[0].update(0.4, 2400);
    props[1].update(-0.4, 60);
    expect(instances(props[0].group)[0].parent!.visible).toBe(false);
    expect((instances(props[1].group)[0].material as THREE.Material).opacity).toBe(1);
  }
  props.forEach(p => { releaseGeometry(p.group); p.dispose(); });
});

it.each(['r22', 'r44'])('uses real blade geometry at low main AND tail shaft RPM on %s', async id => {
  const v = (await loadAirframeVisual(id)).rotorcraftVisual!;
  for (const tail of [false, true]) {
    const rotor = new TeeteringRotor(tail ? { ...v.tail, chord: [v.tail.chord, v.tail.chord], twist: 0, tail: true } : v.main, fakeMaterials());
    for (const rpm of [0, 30, 60, 100, 120, 180, 250, 406, 530, 3400, 100, 0]) {
      rotor.update(0.4, rpm, 0.1, 0.03);
      expect(rotor.blades.count).toBe(2);
      if (rpm <= 100) {
        expect((rotor.blades.material as THREE.Material).opacity).toBe(1);
        expect(rotor.blades.visible).toBe(true);
        expect(rotor.trail.mesh.visible).toBe(false);
        expect(rotor.blur.visible).toBe(false);
      }
      if (rpm >= 406) {
        expect(rotor.blades.visible).toBe(false);
        expect(rotor.trail.mesh.visible).toBe(false);
        expect((rotor.blur.material as THREE.Material).opacity).toBe(1);
      }
    }
    releaseGeometry(rotor.group); rotor.dispose();
  }
});

it.each(['r22', 'r44'])('keeps %s curved blades, trail and disc on the same hinge through spool-up', async id => {
  const d = (await loadAirframeVisual(id)).rotorcraftVisual!.main;
  const rotor = new TeeteringRotor(d, fakeMaterials()), matrix = new THREE.Matrix4();
  const hinge = d.coning.hingeRadius;
  rotor.update(0, 0, 0, 0, 0);
  const base = rotor.blades.geometry.getAttribute('position').clone();
  const tip = Array.from({ length: base.count }, (_, i) => i).reduce((a, b) => base.getX(a) > base.getX(b) ? a : b);
  // Inspect the uniforms actually attached by the material hook, as well as compiling this path in
  // the dev-page screenshots. This catches a missing update argument on the intermediate-RPM trail.
  const shader = { uniforms: {}, vertexShader: '#include <beginnormal_vertex>\n#include <begin_vertex>',
    fragmentShader: '#include <color_fragment>' } as unknown as THREE.WebGLProgramParametersWithUniforms;
  (rotor.trail.mesh.material as THREE.Material).onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  for (const rpm of [0, 30, 60, 120, 180, 530, 120, 0]) {
    const { angle, tipBend } = bladeConing(d.coning, rpm * Math.PI / 30, 0);
    const pitch = 0.15;
    rotor.update(0, rpm, pitch, angle, tipBend);
    rotor.blades.getMatrixAt(0, matrix);
    const actual = new THREE.Vector3().fromBufferAttribute(rotor.blades.geometry.getAttribute('position'), tip).applyMatrix4(matrix);
    const expected = new THREE.Vector3().fromBufferAttribute(base, tip).applyAxisAngle(new THREE.Vector3(1, 0, 0), pitch);
    expected.y += tipBend;
    expected.x -= hinge;
    expected.applyAxisAngle(new THREE.Vector3(0, 0, 1), angle); expected.x += hinge;
    expect(actual.distanceTo(expected)).toBeLessThan(1e-6);
    // The coning pin stays fixed; feathering and sag do not translate it.
    expect(new THREE.Vector3(hinge, 0, 0).applyMatrix4(matrix).distanceTo(new THREE.Vector3(hinge, 0, 0))).toBeLessThan(1e-7);
    const disc = rotor.blur.geometry.getAttribute('position');
    const discTip = (9 - 1) * 73;
    expect(disc.getY(discTip)).toBeCloseTo((d.radius - hinge) * Math.sin(angle) + tipBend * Math.cos(angle), 6);
    expect(Math.hypot(disc.getX(discTip), disc.getZ(discTip)))
      .toBeCloseTo(hinge + (d.radius - hinge) * Math.cos(angle) - tipBend * Math.sin(angle), 6);
    expect(shader.uniforms.trailCone.value).toBe(angle);
    expect(shader.uniforms.trailBend.value).toBe(tipBend);
    expect(shader.uniforms.trailHinge.value).toBe(hinge);
    expect(shader.uniforms.trailBendRoot.value).toBe(d.coning.bending!.rootRadius);
    expect(rotor.blades.customDepthMaterial).toBeDefined();
  }
  releaseGeometry(rotor.group); rotor.dispose();
});
