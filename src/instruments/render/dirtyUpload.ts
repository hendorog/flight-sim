// Partial re-upload of a CanvasTexture: only the canvas rectangles that were redrawn this frame go to the
// GPU (texSubImage2D from the canvas with UNPACK_SKIP_*), instead of three.js re-uploading the whole canvas
// on needsUpdate. The instrument panel is 2080 x 800 and some needle moves almost every frame, so a full
// upload (plus its emissive twin) cost about 0.3-0.8 ms of GPU per cockpit frame; a typical frame now
// uploads a few instrument faces.
//
// three.js keeps its own texture bindings and pixel-store cache, so every GL call here goes through
// renderer.state where it has a cached equivalent. Until three.js has uploaded the texture once (and
// whenever a full update is pending), this falls back to texture.needsUpdate.

import * as THREE from 'three';
import type { Rect } from './component';

/**
 * Mipmaps are rebuilt at most every this many flushes while the panel keeps changing, and always on the
 * first flush after it stops, so the final image is exact. A full-panel mip rebuild is about 0.07 ms of
 * GPU per texture; the lower levels, which only the minified far part of the panel samples, lag the top
 * level by at most one frame.
 */
const MIP_INTERVAL = 2;

/** Rectangle union area above this fraction of the canvas: one full upload is cheaper than many pieces. */
const FULL_UPLOAD_FRACTION = 0.6;

interface TextureProps {
  __webglTexture?: WebGLTexture;
  __version?: number;
}

export class DirtyRectUploader {
  private readonly rects: Rect[] = [];
  private count = 0;
  private area = 0;
  /** Statistics for profiling: bytes sent by the last flush (0: nothing, or a full upload via three.js). */
  lastBytes = 0;
  /** Full uploads handed to three.js (needsUpdate) since creation. */
  fullUploads = 0;
  /** Partial flushes done here since creation. */
  partialFlushes = 0;

  /** Mip levels behind level 0 (a rebuild is due). */
  private mipsStale = false;
  private sinceMips = 0;

  constructor(readonly texture: THREE.CanvasTexture) {}

  /** Mark a canvas rectangle (pixels, origin top-left) as redrawn. */
  add(r: Rect): void {
    let slot = this.rects[this.count];
    if (!slot) {
      slot = { x: 0, y: 0, w: 0, h: 0 };
      this.rects.push(slot);
    }
    slot.x = r.x;
    slot.y = r.y;
    slot.w = r.w;
    slot.h = r.h;
    this.count++;
    this.area += r.w * r.h;
  }

  get pending(): number {
    return this.count;
  }

  /** Send the marked rectangles to the GPU now (or schedule a full upload). */
  flush(renderer: THREE.WebGLRenderer | null | undefined): void {
    this.sinceMips++;
    if (this.count === 0) {
      if (this.mipsStale) this.rebuildMips(renderer);
      return;
    }
    const tex = this.texture;
    const image = tex.image as HTMLCanvasElement | OffscreenCanvas;
    const W = image.width;
    const H = image.height;
    const props = renderer?.properties?.get ? (renderer.properties.get(tex) as TextureProps) : null;
    const ready =
      !!props?.__webglTexture &&
      props.__version === tex.version &&
      typeof WebGL2RenderingContext !== 'undefined' &&
      renderer!.getContext() instanceof WebGL2RenderingContext;
    if (!ready || this.area > FULL_UPLOAD_FRACTION * W * H) {
      tex.needsUpdate = true;
      this.mipsStale = false;
      this.fullUploads++;
      this.lastBytes = 0;
      this.count = 0;
      this.area = 0;
      return;
    }
    const gl = renderer!.getContext() as WebGL2RenderingContext;
    const state = renderer!.state;
    state.bindTexture(gl.TEXTURE_2D, props!.__webglTexture!);
    state.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, tex.flipY);
    state.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, tex.premultiplyAlpha);
    // sRGB canvas into an sRGB texture with the working primaries: no browser colour conversion (as three.js).
    state.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    state.pixelStorei(gl.UNPACK_ALIGNMENT, tex.unpackAlignment);
    state.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
    let bytes = 0;
    for (let i = 0; i < this.count; i++) {
      const r = this.rects[i];
      const x = Math.max(0, Math.floor(r.x));
      const y = Math.max(0, Math.floor(r.y));
      const w = Math.min(W, Math.ceil(r.x + r.w)) - x;
      const h = Math.min(H, Math.ceil(r.y + r.h)) - y;
      if (w <= 0 || h <= 0) continue;
      // With UNPACK_FLIP_Y the skip is counted in the flipped image, i.e. from the canvas bottom
      // (checked in Chrome/ANGLE): canvas row y lands in texture row H - 1 - y.
      const ty = tex.flipY ? H - (y + h) : y;
      state.pixelStorei(gl.UNPACK_SKIP_PIXELS, x);
      state.pixelStorei(gl.UNPACK_SKIP_ROWS, ty);
      state.texSubImage2D(gl.TEXTURE_2D, 0, x, ty, w, h, gl.RGBA, gl.UNSIGNED_BYTE, image as TexImageSource);
      bytes += w * h * 4;
    }
    state.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
    state.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
    if (this.mipmapped) {
      if (this.sinceMips >= MIP_INTERVAL) {
        gl.generateMipmap(gl.TEXTURE_2D);
        this.sinceMips = 0;
        this.mipsStale = false;
      } else this.mipsStale = true;
    }
    this.partialFlushes++;
    this.lastBytes = bytes;
    this.count = 0;
    this.area = 0;
  }

  private get mipmapped(): boolean {
    const t = this.texture;
    return t.generateMipmaps && t.minFilter !== THREE.NearestFilter && t.minFilter !== THREE.LinearFilter;
  }

  private rebuildMips(renderer: THREE.WebGLRenderer | null | undefined): void {
    this.mipsStale = false;
    const props = renderer?.properties?.get ? (renderer.properties.get(this.texture) as TextureProps) : null;
    if (!props?.__webglTexture || props.__version !== this.texture.version || !this.mipmapped) return;
    const gl = renderer!.getContext();
    renderer!.state.bindTexture(gl.TEXTURE_2D, props.__webglTexture);
    gl.generateMipmap(gl.TEXTURE_2D);
    this.sinceMips = 0;
  }
}
