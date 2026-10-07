// Bakes the aircraft's precomputed data off the main thread: the fuselage textures (livery.ts, ~1 s of
// CPU) and the cabin interior occlusion (cabinLight.ts). The simulator builds the aircraft with
// placeholders and swaps the results in when this worker answers.
//
// The request names the airframe by id; the worker loads its definition itself through
// aircraft/visualLoader.ts (plain data) and rebuilds the shapes and the window outlines from it. It imports
// nothing else of the aircraft: not the registry, which would carry the flight model.

import { loadAirframeVisual } from '../../aircraft/visualLoader';
import { cabinVisibility, type CabinVisData } from './cabinLight';
import { createFuselageShapes } from './fuselage';
import { bakeFuselageData, type FuselageTextureData } from './livery';

export interface AircraftBakeRequest {
  /** AirframeVisualDef.id of the airframe to bake. */
  airframeId: string;
  cabin: { positions: Float32Array; normals: Float32Array; doubleSided: Uint8Array };
}

export interface AircraftBakeResult {
  textures: FuselageTextureData;
  cabinVis: CabinVisData;
  /** Set instead of the two when the bake could not be done (an unknown airframe id): the sender bakes itself. */
  error?: string;
}

/** The bake itself: what the worker answers a request with, and the buffers to hand over. */
export async function bakeAircraft(request: AircraftBakeRequest): Promise<{ result: AircraftBakeResult; transfer: ArrayBuffer[] }> {
  const def = await loadAirframeVisual(request.airframeId);
  const { positions, normals, doubleSided } = request.cabin;
  const cabinVis = cabinVisibility(positions, normals, doubleSided, def);
  const shapes = createFuselageShapes(def);
  const d = bakeFuselageData(shapes.outer, shapes.glass, shapes.lining, def);
  const result: AircraftBakeResult = { textures: d, cabinVis };
  const transfer = [d.colour.data.buffer, d.detail.data.buffer, d.glass.data.buffer, d.lining.data.buffer, cabinVis.vis.buffer, cabinVis.cube.buffer] as ArrayBuffer[];
  return { result, transfer };
}

self.onmessage = (e: MessageEvent<AircraftBakeRequest>) => {
  bakeAircraft(e.data).then(
    ({ result, transfer }) => (self as unknown as Worker).postMessage(result, transfer),
    (why: unknown) => (self as unknown as Worker).postMessage({ error: String(why) }),
  );
};
