// The storm cells in effect at the camera (physics/weather/stormField.ts StormField.select), selected once per frame
// and simulation context for every render consumer: the cumulus layer (render/clouds/cloudModel.ts CloudModel: the
// clearing around each cell, read by the view march and the shadow map), the storm cells (StormCellEffect) and the
// lightning overlay. The first consumer of a frame selects; the others get the same array while the simulation
// time, the camera's horizontal position and the weather inputs of the selection are unchanged.

import type { SimContext } from '../../core/context';
import type { StormCell, WeatherSettings } from '../../core/types';
import { StormField, type ActiveStorm } from '../../physics/weather/stormField';

/** Range of the drawn core radius, m (StormCellEffect cellGeometry; the cumulus clearing uses the same radius). */
export const DRAWN_RADIUS_MIN_M = 500;
export const DRAWN_RADIUS_MAX_M = 8000;

/** The core radius of `cell` as the render draws it, m. */
export const drawnCoreRadiusM = (cell: StormCell): number => Math.min(DRAWN_RADIUS_MAX_M, Math.max(DRAWN_RADIUS_MIN_M, cell.radiusM));

/** The weather fields the selection reads (besides `storms`, compared by reference). */
const KEYS = ['isaDeviation', 'qnhHpa', 'cloudCover', 'cloudBaseM', 'cloudTopM', 'timeOfDay', 'dayOfYear', 'windDirectionDeg', 'windSpeedKt'] as const;

/** One context's selection at the camera and the inputs it was made for. */
export class CameraStorms {
  /** The context's StormField (its convective() gives the derived activity of the live weather). */
  readonly field = new StormField();
  private cells: readonly ActiveStorm[] = [];
  private t = NaN;
  private north = NaN;
  private east = NaN;
  private storms: unknown = null;
  private type: unknown = null;
  private readonly key = new Float64Array(KEYS.length).fill(NaN);

  /** The cells in effect at the camera at ctx.simTime (a camera-less test context: at the NED origin). */
  at(ctx: SimContext): readonly ActiveStorm[] {
    const w = ctx.weather;
    const p = ctx.camera?.position;
    // three.js world: x east, z south.
    const north = p ? -p.z : 0;
    const east = p ? p.x : 0;
    if (ctx.simTime !== this.t || north !== this.north || east !== this.east || !this.same(w)) {
      this.t = ctx.simTime;
      this.north = north;
      this.east = east;
      this.remember(w);
      this.cells = this.field.select(w, ctx.simTime, north, east);
    }
    return this.cells;
  }

  private same(w: WeatherSettings): boolean {
    const loose = w as unknown as Record<string, unknown>;
    if (loose.storms !== this.storms || loose.cloudType !== this.type) return false;
    for (let i = 0; i < KEYS.length; i++) if (w[KEYS[i]] !== this.key[i]) return false;
    return true;
  }

  private remember(w: WeatherSettings): void {
    const loose = w as unknown as Record<string, unknown>;
    this.storms = loose.storms;
    this.type = loose.cloudType;
    for (let i = 0; i < KEYS.length; i++) this.key[i] = w[KEYS[i]];
  }
}

const SHARED = new WeakMap<object, CameraStorms>();

/** The shared selection of `ctx` (created on first use). */
export function cameraStormsOf(ctx: SimContext): CameraStorms {
  let s = SHARED.get(ctx);
  if (!s) SHARED.set(ctx, (s = new CameraStorms()));
  return s;
}

/** The cells in effect at the camera of `ctx` this frame (cameraStormsOf(ctx).at(ctx)). */
export function cameraStormsAt(ctx: SimContext): readonly ActiveStorm[] {
  return cameraStormsOf(ctx).at(ctx);
}
