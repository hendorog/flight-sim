// Dev page for the sky, lighting and post-processing module.
//
// Extra URL parameters (see harness.ts for cam/look/tod/agl/freeze):
//   vis=60000    visibility, m
//   doy=172      day of year
//   q=high       quality level
//   ev=0         exposure compensation, EV
import type { QualityLevel } from '../core/context';
import { PostPipeline } from '../render/post';
import { SkySystem } from '../render/sky';
import { runHarness } from './harness';
import { buildSkyTestScene } from './skyScene';

const params = new URLSearchParams(location.search);
let post: PostPipeline;

void runHarness({
  basicLighting: false,
  setup(ctx) {
    if (params.has('vis')) ctx.weather.visibilityM = Number(params.get('vis'));
    if (params.has('doy')) ctx.weather.dayOfYear = Number(params.get('doy'));
    if (params.has('q')) ctx.quality = params.get('q') as QualityLevel;
    buildSkyTestScene(ctx.scene, ctx.aircraftRoot);
    post = new PostPipeline(ctx.renderer, ctx.scene, ctx.camera);
    post.exposureBias = Number(params.get('ev') ?? 0);
  },
  subsystems: [new SkySystem()],
  render(dt, ctx) {
    post.render(ctx, dt);
  },
});
