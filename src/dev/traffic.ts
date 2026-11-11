// Dev page for the AI traffic's models (render/aircraft/trafficModel.ts): a type's full exterior (the near AI
// aircraft's, trafficExterior.ts), its merged parked model and its far model, side by side on the runway, 18 m
// apart across it (left to right in the order of show=). On top of the harness parameters:
//   type=c172s             the type (c172s, c152, pa38, da20, ...)
//   show=ext,near,far      which models, and their order across (east) from east=-18
//   cam= look= fov=        the harness camera (NED metres; the models stand at north 0 on the field elevation)

import * as THREE from 'three';
import type { SimContext } from '../core/context';
import { AIRPORT } from '../core/world';
import { nedToThree } from '../core/frames';
import { loadAirframeVisual } from '../aircraft/visualLoader';
import { TrafficExterior } from '../render/aircraft/trafficExterior';
import { trafficModel, type ModelPart } from '../render/aircraft/trafficModel';
import { runHarness } from './harness';

const params = new URLSearchParams(location.search);
const type = params.get('type') ?? 'c172s';
const show = (params.get('show') ?? 'ext,near,far').split(',');

const group = (parts: readonly ModelPart[]): THREE.Group => {
  const g = new THREE.Group();
  for (const p of parts) {
    const m = new THREE.Mesh(p.geometry, p.material);
    m.castShadow = m.receiveShadow = true;
    g.add(m);
  }
  return g;
};

void runHarness({
  subsystems: [
    {
      async init(ctx: SimContext) {
        const def = await loadAirframeVisual(type);
        const model = await trafficModel(def);
        const info: string[] = [];
        show.forEach((kind, i) => {
          let root: THREE.Object3D;
          if (kind === 'ext') {
            const e = new TrafficExterior(def, def.livery.registration);
            root = e.root;
          } else root = group(kind === 'near' ? model.near : model.far);
          nedToThree({ x: 0, y: -18 + i * 18, z: -(AIRPORT.elevation + model.restHeight) }, root.position);
          ctx.scene.add(root);
          info.push(kind);
        });
        (window as unknown as { __traffic: unknown }).__traffic = { triangles: model.triangles, parts: { near: model.near.length, far: model.far.length }, info };
      },
      update() {},
      dispose() {},
    },
  ],
});
