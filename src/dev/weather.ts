// Weather effects dev page: the sim's post pipeline with the sky, the clouds and the weather registry
// (render/weather: storm cells before the clouds, fog after them, precipitation and lightning after the temporal pass) over
// the sky test scene. Extra URL parameters on top of the harness ones (cam, look, tod, freeze, ...):
//   wx=thunderstorm                 a free-flight weather preset (sim/weatherPresets.ts), applied before the
//                                   parameters below (tod= given on the URL is applied again after it)
//   temp=0 day=172 ctype=towering   ISA deviation, K; day of the year; low layer type
//   cover=0.35 base=1500 top=2600   cumulus cover 0..1 and layer altitudes, m MSL
//   vis=60000                       visibility, m
//   wind=270,15                     wind from degrees, knots (also the steady wind env.wind returns)
//   fly=100                         move the camera along its view direction at this speed, knots
//   q=high                          quality level
//   ev=0                            exposure compensation, EV
//   cb=north,east[,top[,intensity[,radius[,motionDeg,motionKt]]]]
//                                   a storm cell: centre km NED, top km MSL (11), intensity 0..1 (0.8), core radius
//                                   km (3), motion from degrees and knots (0, 0); repeatable, at most 6 (MAX_STORMS). Without
//                                   cb= the cells are derived from the conditions (physics/weather/stormField.ts)
//   fog=top[,vis]                   ground fog depth above the field, m, and its visibility, m
//   precip=rain|drizzle|snow,rate   precipitation and its rate, mm/h
//   flash=1 | flash=ic              hold a lightning strike at t = FLASH_AT_S in the first cell (1: cloud-to-ground,
//                                   ic: intracloud), its light held FLASH_HOLD_S after the first stroke, for
//                                   screenshots; the simulation clock stays at that instant
//   flasht=0.004                    the hold, s after the first stroke (0.06 and 0.12: the later strokes)
//   flashid=0                       added to the held strike's id (its channel's shape)
//   mode=cockpit                    the camera mode in the context (the storm march's near clip, the overlays' cabin test)
// Example: dev/weather.html?cb=22,4&cam=0,0,400&look=22000,4000,5000&tod=19.2&flash=1
// window.__weatherDev.strike(kind) starts a strike in the first cell at the current time; exposure() reads the eye
// adaptation (log2 scene units: adapted, target) and the lightning overlay's ambient illuminance (scene units);
// cells() lists the cells in effect at the camera ({north, east, distance, top, core, anvil, rain, flash}, m) and
// activity() the derived convective state; post is the page's PostPipeline. setCamera(n, e, alt, ln, le, lalt) moves
// the camera (NED m, MSL) to look at a point; info() gives the precipitation at the camera (PrecipOverlay.local) and
// the frames rendered.

import * as THREE from 'three';
import type { QualityLevel } from '../core/context';
import { KT } from '../core/math';
import type { CloudType, PrecipType, StormCell } from '../core/types';
import { MAX_STORMS, stormCentreAt } from '../core/weatherFields';
import { cameraStormsOf } from '../render/weather/stormSelection';
import { applyWeatherPreset, weatherPresetById } from '../sim/weatherPresets';
import { CloudsEffect } from '../render/clouds';
import { PostPipeline } from '../render/post';
import { SkySystem } from '../render/sky';
import { createWeatherEffects, createWeatherOverlays } from '../render/weather';
import type { LightningOverlay } from '../render/weather/LightningOverlay';
import type { PrecipOverlay } from '../render/weather/PrecipOverlay';
import type { CameraMode } from '../core/context';
import { makeStrike, type StrikeKind } from '../sim/weather/lightning';
import { runHarness } from './harness';
import { buildSkyTestScene } from './skyScene';

const params = new URLSearchParams(location.search);
const num = (k: string, d: number): number => (params.has(k) && !Number.isNaN(Number(params.get(k))) ? Number(params.get(k)) : d);
const list = (v: string | null): number[] => (v ?? '').split(',').filter((s) => s !== '').map(Number);

/** Simulation time of the held strike, s, and how long after its first stroke the clock is held, s. */
const FLASH_AT_S = 1;
const FLASH_HOLD_S = num('flasht', 0.004);
const FLASH = params.get('flash');

/** A cell from a cb= value, or null when malformed. */
function parseCell(v: string): StormCell | null {
  const p = list(v);
  if (p.length < 2 || p.some((x) => !Number.isFinite(x))) return null;
  return {
    northM: p[0] * 1000,
    eastM: p[1] * 1000,
    topM: (p[2] ?? 11) * 1000,
    intensity: p[3] ?? 0.8,
    radiusM: (p[4] ?? 3) * 1000,
    motionDeg: p[5] ?? 0,
    motionKt: p[6] ?? 0,
  };
}

/** Camera speed along its view direction (fly=), m/s. */
const FLY_MS = num('fly', 0) * KT;
const flyDir = new THREE.Vector3();

let post: PostPipeline;
let lightning: LightningOverlay | null = null;
let precipOverlay: PrecipOverlay | null = null;
let frames = 0;
let strikes = 0;

void runHarness({
  basicLighting: false,
  async setup(ctx) {
    const w = ctx.weather;
    const preset = weatherPresetById(params.get('wx'));
    if (preset) {
      applyWeatherPreset(w, preset);
      w.timeOfDay = num('tod', w.timeOfDay);
      ctx.events.emit('weatherChanged', {});
    }
    w.isaDeviation = num('temp', w.isaDeviation);
    w.dayOfYear = num('day', w.dayOfYear);
    if (params.has('ctype')) w.cloudType = params.get('ctype') as CloudType;
    w.cloudCover = num('cover', w.cloudCover);
    w.cloudBaseM = num('base', w.cloudBaseM);
    w.cloudTopM = num('top', w.cloudTopM);
    w.visibilityM = num('vis', w.visibilityM);
    const wind = list(params.get('wind'));
    if (wind.length >= 2 && wind.every(Number.isFinite)) {
      [w.windDirectionDeg, w.windSpeedKt] = wind;
      // The mock environment has no wind: a steady wind from windDirectionDeg, NED m/s (the air moves toward
      // windDirectionDeg + 180).
      const from = (wind[0] * Math.PI) / 180;
      const steady = { x: -Math.cos(from) * wind[1] * KT, y: -Math.sin(from) * wind[1] * KT, z: 0 };
      ctx.env.wind = () => ({ ...steady });
    }
    const cells = params.getAll('cb').map(parseCell).filter((c): c is StormCell => c !== null).slice(0, MAX_STORMS);
    if (cells.length) w.storms = cells;
    const fog = list(params.get('fog'));
    if (fog.length >= 1) {
      w.fogTopM = fog[0];
      if (fog.length >= 2) w.fogVisibilityM = fog[1];
    }
    const precip = (params.get('precip') ?? '').split(',');
    if (precip[0]) {
      w.precipType = precip[0] as PrecipType;
      w.precipRateMmH = Number(precip[1] ?? 2);
    }
    if (params.has('q')) ctx.quality = params.get('q') as QualityLevel;
    if (params.has('mode')) ctx.cameraMode = params.get('mode') as CameraMode;
    if (FLASH) ctx.simTime = FLASH_AT_S + FLASH_HOLD_S;

    buildSkyTestScene(ctx.scene, ctx.aircraftRoot);
    const r = ctx.renderer;
    post = new PostPipeline(r, ctx.scene, ctx.camera);
    post.exposureBias = num('ev', 0);
    const clouds = new CloudsEffect(r);
    await clouds.ready;
    const wx = { ctx, renderer: r, clouds, post, weather: w };
    const weatherEffects = createWeatherEffects(wx);
    for (const e of weatherEffects.beforeClouds) post.addEffect(e);
    post.addEffect(clouds);
    for (const e of weatherEffects.afterClouds) post.addEffect(e);
    for (const o of createWeatherOverlays(wx)) {
      post.addOverlay(o);
      if (o.name === 'lightning') lightning = o as LightningOverlay;
      if (o.name === 'precipitation') precipOverlay = o as PrecipOverlay;
    }
    ctx.events.on('lightning', (e) => {
      strikes++;
      console.info(`[weather] lightning ${e.kind} id ${e.id} at ${(e.north / 1000).toFixed(1)}, ${(e.east / 1000).toFixed(1)} km, ${Math.round(e.altM)} m, ${e.strokes} strokes`);
    });
    const shared = cameraStormsOf(ctx);
    const inEffect = () => shared.at(ctx);
    const strike = (kind: StrikeKind, t: number): void => {
      const cell = inEffect()[0];
      if (!cell || !lightning) return;
      const s = makeStrike();
      const at = stormCentreAt(cell, t, { north: 0, east: 0 });
      Object.assign(s, { id: 9_000_000 + num('flashid', 0) + strikes, cell: 0, kind, tStart: t, north: at.north + 0.3 * cell.radiusM, east: at.east, heightFrac: kind === 'cg' ? 0.05 : 0.6, strokes: 3, energy: 1 });
      lightning.inject(s);
    };
    if (FLASH) strike(FLASH === 'ic' ? 'ic' : 'cg', FLASH_AT_S);
    (window as unknown as { __weatherDev: object }).__weatherDev = {
      post,
      strike: (kind: StrikeKind = 'cg') => strike(kind, ctx.simTime),
      strikes: () => strikes,
      cells: () =>
        inEffect().map((c) => {
          const p = stormCentreAt(c, ctx.simTime, { north: 0, east: 0 });
          const distance = Math.hypot(p.north + ctx.camera.position.z, p.east - ctx.camera.position.x);
          return { north: p.north, east: p.east, distance, top: c.topM, core: c.core, anvil: c.anvil, rain: c.rain, flash: c.flash };
        }),
      activity: () => ({ ...shared.field.convective(w) }),
      setCamera: (n: number, e: number, alt: number, ln: number, le: number, lalt: number) => {
        ctx.camera.position.set(e, alt, -n);
        ctx.camera.lookAt(le, lalt, -ln);
        ctx.camera.updateMatrixWorld();
      },
      info: () => ({ frames, simTime: ctx.simTime, precip: precipOverlay ? { ...precipOverlay.local } : null }),
      exposure: () => {
        const rt = (post as unknown as { exposure: { adapted: THREE.WebGLRenderTarget[] } }).exposure.adapted[0];
        const px = new Float32Array(4);
        r.readRenderTargetPixels(rt, 0, 0, 1, 1, px);
        return [px[0], px[1], (lightning?.material.uniforms.uAmbient.value as number | undefined) ?? -1];
      },
    };
  },
  subsystems: [new SkySystem()],
  beforeUpdate(dt, ctx) {
    // Hold the clock at the strike for the screenshot.
    if (FLASH) ctx.simTime = FLASH_AT_S + FLASH_HOLD_S;
    if (FLY_MS > 0) {
      ctx.camera.getWorldDirection(flyDir);
      ctx.camera.position.addScaledVector(flyDir, FLY_MS * dt);
      ctx.camera.updateMatrixWorld();
    }
  },
  render(dt, ctx) {
    frames++;
    post.render(ctx, dt);
  },
});
