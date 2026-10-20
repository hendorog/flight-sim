// The weather at the aircraft each frame, for the modules that act at the airframe rather than at the camera: the
// precipitation (physics/weather/stormPrecip.ts localPrecipAt, the stratiform fields and the storm cells in effect at
// the aircraft) and the hail on the airframe (hailExposure.ts), published as SimContext.weatherFx.precip and .hail
// for the airframe sound (audio/mapping.ts SoundTracker) and the hail warning (ui/uiSystem.ts). Read-only for the
// flight model. Without storm cells at the aircraft the precipitation is the stratiform one and there is no hail.

import type { SimContext, Subsystem } from '../../core/context';
import { StormField } from '../../physics/weather/stormField';
import { emptyLocalPrecip, localPrecipAt, type LocalPrecip } from '../../physics/weather/stormPrecip';
import { HailExposure } from './hailExposure';

export class AircraftWeather implements Subsystem {
  /** The cells in effect at the aircraft (its own selection, cached within 10 km like every StormField). */
  private readonly field = new StormField();
  readonly precip: LocalPrecip = emptyLocalPrecip();
  readonly exposure = new HailExposure();
  private lastTime = Number.NaN;

  init(): void {}

  update(dt: number, ctx: SimContext): void {
    const s = ctx.state;
    const w = ctx.weather;
    const north = s.position.x, east = s.position.y;
    const cells = this.field.select(w, ctx.simTime, north, east);
    const cape = cells.length > 0 ? this.field.convective(w).capeJkg : 0;
    localPrecipAt(w, cells, ctx.simTime, cape, north, east, s.altitudeMSL, this.precip);
    // A scenario reset restarts the clock: a new flight, no hail dose.
    if (ctx.simTime < this.lastTime) this.exposure.reset();
    this.lastTime = ctx.simTime;
    this.exposure.update(this.precip, s.tas, dt);
    const fx = ctx.weatherFx;
    if (fx) {
      fx.precip = this.precip;
      fx.hail = this.exposure.state;
    }
  }
}
