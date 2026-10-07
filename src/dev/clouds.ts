// Cloud dev page. Drives CloudsEffect directly (scene -> haze -> clouds -> tone map) over a stand-in sky
// and terrain. Extra URL parameters on top of the harness ones:
//   cover=0.5          cloud cover 0..1
//   base=1500 top=2600 layer altitudes, m MSL
//   q=high             quality level
//   wind=100,6         wind from degrees, knots
//   vis=60000          visibility, m
//   cirrus=0.1         cirrus cover 0..1 (independent of the cumulus cover)
//   exp=1              exposure multiplier before tone mapping
//   time=0             simulation time to start from, s (sets the evolution phase; wind drift integrates dt)
//   fly=60             move the camera forward at this speed, m/s (tests temporal reprojection)
//   yaw=10             turn the camera at this rate, deg/s
//   timing=1           measure the GPU time of the cloud pass (EXT_disjoint_timer_query_webgl2) and print
//                      the average as a console warning every 300 frames
//   slice=x,z,dx,dz,len[,mode]  show a vertical density slice (red: full density, green: coarse shape, blue: mask)
//   coverCal=1         print the measured fraction of the ground under cloud for each coverage control value
//                      of render/clouds/coverage.ts COVER_CALIBRATION (re-measure it after changing the
//                      density model), and for a few requested covers (should come out as c (0.88 + 0.12 c),
//                      see COVER_CALIBRATION)
import * as THREE from 'three';
import { runHarness } from './harness';
import { CloudsEffect } from '../render/clouds';
import { COVER_CALIBRATION } from '../render/clouds/coverage';
import { createDevScene, DevPipeline } from './cloudsDevScene';
import type { QualityLevel } from '../core/context';

const params = new URLSearchParams(location.search);
const num = (k: string, d: number): number => (params.has(k) && !Number.isNaN(Number(params.get(k))) ? Number(params.get(k)) : d);

const UP = new THREE.Vector3(0, 1, 0);
// slice=x,z,dx,dz,length[,mode]: draw a vertical density slice instead of the view (see renderDensitySlice).
const SLICE = params.has('slice') ? (params.get('slice') ?? '').split(',').map(Number) : null;
const FLY_SPEED = num('fly', 0);
const YAW_RATE = THREE.MathUtils.degToRad(num('yaw', 0));

let pipeline: DevPipeline;
let clouds: CloudsEffect;
let dev: { update(): void };
let timer: GpuTimer | null = null;

/** Averages GPU time spans with EXT_disjoint_timer_query_webgl2 (results arrive a few frames late). */
class GpuTimer {
  private readonly pending: WebGLQuery[] = [];
  private total = 0;
  private count = 0;
  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number },
  ) {}
  begin(): void {
    const q = this.gl.createQuery()!;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this.pending.push(q);
  }
  end(): void {
    const gl = this.gl;
    gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    while (this.pending.length && gl.getQueryParameter(this.pending[0], gl.QUERY_RESULT_AVAILABLE)) {
      const q = this.pending.shift()!;
      if (!gl.getParameter(this.ext.GPU_DISJOINT_EXT)) {
        this.total += gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
        this.count++;
      }
      gl.deleteQuery(q);
    }
    if (this.count >= 300) {
      console.warn(`[clouds] GPU ${(this.total / this.count).toFixed(2)} ms per frame (avg of ${this.count})`);
      this.total = this.count = 0;
    }
  }
}

void runHarness({
  subsystems: [],
  basicLighting: false,
  async setup(ctx) {
    const w = ctx.weather;
    w.cloudCover = num('cover', 0.5);
    w.cloudBaseM = num('base', w.cloudBaseM);
    w.cloudTopM = num('top', w.cloudTopM);
    w.visibilityM = num('vis', w.visibilityM);
    // Cirrus cover (optional weather field read by CloudsEffect; absent = DEFAULT_CIRRUS_COVER).
    if (params.has('cirrus')) (w as typeof w & { cirrusCover?: number }).cirrusCover = num('cirrus', 0);
    const wind = (params.get('wind') ?? '').split(',').map(Number);
    if (wind.length === 2 && wind.every((v) => !Number.isNaN(v))) [w.windDirectionDeg, w.windSpeedKt] = wind;
    ctx.quality = (params.get('q') as QualityLevel) ?? 'high';
    ctx.simTime = num('time', 0);

    const r = ctx.renderer;
    const t0 = performance.now();
    clouds = new CloudsEffect(r, { atmosphere: false });
    const tSync = performance.now() - t0;
    await clouds.ready;
    // Readable from scripts/shot.mjs with --eval "__cloudsInit".
    (window as unknown as { __cloudsInit: object }).__cloudsInit = { blockingMs: Math.round(tSync), readyMs: Math.round(performance.now() - t0) };
    const width = r.domElement.width;
    const height = r.domElement.height;
    pipeline = new DevPipeline(width, height, num('exp', 1));
    clouds.setSize(width, height);
    dev = createDevScene(ctx);
    if (params.get('timing') === '1') {
      const gl = r.getContext() as WebGL2RenderingContext;
      const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
      if (ext) timer = new GpuTimer(gl, ext);
      else console.warn('[clouds] EXT_disjoint_timer_query_webgl2 not available');
    }
    if (params.get('coverCal') === '1') {
      // The shadow pass needs the layer uniforms of a first update.
      clouds.render(r, pipeline.hazedRT.texture, pipeline.sceneRT.depthTexture!, pipeline.effectRT, ctx, 0);
      const xs = COVER_CALIBRATION.map(([x]) => x);
      const raw = clouds.measureCover(r, xs, true, COVER_CALIBRATION.map(([, f]) => f));
      console.warn(`[clouds] coverage control -> ground fraction: ${JSON.stringify(xs.map((x, i) => [x, +raw[i].toFixed(3)]))}`);
      const covers = [0.1, 0.25, 0.35, 0.5, 0.75, 0.9];
      const got = clouds.measureCover(r, covers);
      console.warn(`[clouds] requested cover -> ground fraction (expected): ${JSON.stringify(covers.map((c, i) => [c, +got[i].toFixed(3), +(c * (0.88 + 0.12 * c)).toFixed(3)]))}`);
    }
    window.addEventListener('resize', () => {
      pipeline.setSize(r.domElement.width, r.domElement.height);
      clouds.setSize(r.domElement.width, r.domElement.height);
    });
  },
  beforeUpdate(dt, ctx) {
    const cam = ctx.camera;
    cam.translateZ(-FLY_SPEED * dt);
    cam.rotateOnWorldAxis(UP, -YAW_RATE * dt);
  },
  render(dt, ctx) {
    dev.update();
    pipeline.renderScene(ctx);
    timer?.begin();
    clouds.render(ctx.renderer, pipeline.hazedRT.texture, pipeline.sceneRT.depthTexture!, pipeline.effectRT, ctx, dt);
    timer?.end();
    pipeline.toneMap(ctx.renderer, pipeline.effectRT.texture);
    if (SLICE) {
      // Vertical density slice (CloudsEffect.renderDensitySlice) over the whole canvas.
      const [x, z, dx, dz, len, mode] = SLICE;
      clouds.renderDensitySlice(ctx.renderer, null as unknown as THREE.WebGLRenderTarget, x, z, dx, dz, len, mode ?? 0);
    }
  },
});
