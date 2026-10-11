import * as THREE from 'three';
import { expect, it } from 'vitest';
import { loadAirframeVisual } from '../../src/aircraft/visualLoader';
import { Propeller } from '../../src/render/aircraft/propeller';
import { SYNTHETIC_TWIN } from '../../src/render/aircraft/airframe/testbed';
import { TeeteringRotor } from '../../src/render/aircraft/rotorcraft/rotor';
import { fakeMaterials } from '../aircraft/meshChecks';

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
