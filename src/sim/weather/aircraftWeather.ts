// The weather at the aircraft each frame, for the modules that act at the airframe rather than at the camera: the
// precipitation (physics/weather/stormPrecip.ts localPrecipAt, the stratiform fields and the storm cells in effect at
// the aircraft) and the hail on the airframe (hailExposure.ts), published as SimContext.weatherFx.precip and .hail
// for the airframe sound (audio/mapping.ts SoundTracker) and the hail warning (ui/uiSystem.ts). Read-only for the
// flight model. Without storm cells at the aircraft the precipitation is the stratiform one and there is no hail.
// The cells come from the wind field's StormField (ctx.env.windField, the selection the convective wind at the
// aircraft reads), or from this module's own one when the environment has no wind field (tests, mock environments).

import type { SimContext, Subsystem } from '../../core/context';
import type { SimEnvironment } from '../../physics/environment';
import { StormField } from '../../physics/weather/stormField';
import { emptyLocalPrecip, localPrecipAt, type LocalPrecip } from '../../physics/weather/stormPrecip';
import { HailExposure } from './hailExposure';

export class AircraftWeather implements Subsystem {
  /** The cells in effect at the aircraft when the environment has no wind field. */
  private readonly ownField = new StormField();
  readonly precip: LocalPrecip = emptyLocalPrecip();
  readonly exposure = new HailExposure();
  private lastTime = Number.NaN;

  init(): void {}

  update(dt: number, ctx: SimContext): void {
    const s = ctx.state;
    const w = ctx.weather;
    const north = s.position.x, east = s.position.y;
    const field = (ctx.env as Partial<SimEnvironment> | undefined)?.windField?.stormField ?? this.ownField;
    const cells = field.select(w, ctx.simTime, north, east);
    const cape = cells.length > 0 ? field.convective(w).capeJkg : 0;
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
