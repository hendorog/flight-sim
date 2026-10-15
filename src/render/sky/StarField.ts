// Catalogue stars and the Milky Way's data (package P2 of the night-sky plan owns this file, glsl/stars.ts and
// glsl/milkyWay.ts).
//
// Interface (frozen by the scaffold; see the plan):
//   uniforms   dome-side uniforms (the Milky Way map and the two ready flags), spread into the sky dome's uniforms.
//   object     added to the main scene by SkySystem right after the dome; the catalogue's THREE.Points joins it
//              once loaded. Never added to the environment map's scene.
//   build()    called once by SkyDome with the dome's merged uniforms, so the Points material shares the same
//              uniform objects (uMoonDir, uMoonAngularRadius, uStarGain, uNight, uPixelAngle, transmittance LUT...).
//   update()   once per frame from SkyDome.update, after the Celestial has moved.
//
// Data (browser only, fetched asynchronously, never awaited; provenance in public/sky/stars/SOURCE.md):
//   sky/stars/bsc5.bin          Yale Bright Star Catalogue, 9096 stars to ~6.5 mag (starCatalog.ts)
//   sky/stars/milkyway_4k.webp  NASA SVS Milky Way background map (glsl/milkyWay.ts)
// Until each arrives (and in node, and if a fetch fails) the dome's procedural stars / analytic Milky Way stay.
//
// The catalogue layer: one point per star at infinity (rotation only, like the dome), drawn right after the dome in
// the opaque list (renderOrder just above it, transparent: false) with additive blending and no depth, so every
// opaque object drawn after it covers it. Each star is a box-integrated Gaussian (sigma 0.6 px): the weights of the
// pixels it touches sum to 1 at any sub-pixel position, so stars carry their exact flux, neither shimmer as the
// view turns nor change brightness with zoom. Radiance = E * w / (pixel solid angle) with
// E = STAR_E0 * 10^(-0.4 m) * colour(B-V) * transmittance * twinkle * uStarGain * uNight.

import * as THREE from 'three';
import type { SimContext } from '../../core/context';
import type { Celestial } from './celestial';
import { ATMOSPHERE_GLSL } from './glsl/atmosphere';
import { STAR_E0 } from './glsl/stars';
import { decodeStarCatalog, equatorialVector, starColour, type StarCatalog } from './starCatalog';
import { EXPOSURE_GLSL } from '../post/AutoExposure';

/** Sprite side, px: the Gaussian's tails beyond +-2.5 px (4 sigma) carry < 0.1 % of the flux. */
const POINT_SIZE = 5;
/** Gaussian sigma, px (as the dome's procedural stars). */
const STAR_SIGMA_PX = 0.6;
/** Points whose brightest pixel would display below this (display-linear, 0.18 = middle grey) are skipped. */
const NEGLIGIBLE_DISPLAY = 1 / 2048;

const STAR_VERT = /* glsl */ `
${ATMOSPHERE_GLSL}
uniform mat3 uWorldToEquatorial;
uniform vec3 uMoonDir;
uniform float uMoonAngularRadius;
uniform float uStarGain;
uniform float uNight;
uniform float uTime;
uniform float uPixelAngle;
uniform float uCamR;
uniform float uExposureValid;
${EXPOSURE_GLSL}
attribute vec3 aFlux;
attribute vec2 aTwinkle;
varying vec3 vRadiance;

const float PEAK_WEIGHT = ${peakWeight().toFixed(6)};

void cull() {
  // Outside the clip volume (z > w): nothing is rasterised.
  gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
  gl_PointSize = 0.0;
  vRadiance = vec3(0.0);
}

void main() {
  // position: the star's J2000 equatorial unit vector; v * M = transpose(M) v = equatorialToWorld v.
  vec3 dir = position * uWorldToEquatorial;
  if (uNight <= 0.0 || rayHitsGround(uCamR, dir.y) || dot(dir, uMoonDir) > cos(1.05 * uMoonAngularRadius)) {
    cull();
    return;
  }
  float airmass = 1.0 / max(dir.y, 0.05);
  float twinkle = 1.0 + 0.3 * min(airmass - 1.0, 3.0) * sin(uTime * (7.0 + 9.0 * aTwinkle.x) + 6.2831853 * aTwinkle.y);
  vRadiance = aFlux * transmittanceToTop(uCamR, dir.y) * (twinkle * uStarGain * uNight / (uPixelAngle * uPixelAngle));
  if (uExposureValid > 0.5 && PEAK_WEIGHT * dot(vRadiance, vec3(0.2126, 0.7152, 0.0722)) * sceneExposure() < ${NEGLIGIBLE_DISPLAY.toExponential(4)}) {
    cull();
    return;
  }
  // Rotation only, at a radius well inside the camera's near/far range; depth is neither tested nor written.
  gl_Position = projectionMatrix * vec4(mat3(viewMatrix) * dir * 10.0, 1.0);
  gl_PointSize = ${POINT_SIZE.toFixed(1)};
}
`;

const STAR_FRAG = /* glsl */ `
varying vec3 vRadiance;

// erf, Abramowitz & Stegun 7.1.26 (|error| < 1.5e-7).
float erfApprox(float x) {
  float t = 1.0 / (1.0 + 0.3275911 * abs(x));
  float y = 1.0 - t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * exp(-x * x);
  return sign(x) * y;
}
// Share of a unit Gaussian (sigma in px) that falls in the pixel [c - 0.5, c + 0.5].
float pixelShare(float c) {
  const float k = ${(1 / (STAR_SIGMA_PX * Math.SQRT2)).toFixed(6)};
  return 0.5 * (erfApprox((c + 0.5) * k) - erfApprox((c - 0.5) * k));
}

void main() {
  // gl_PointCoord is measured from the star's exact (sub-pixel) position to this pixel's centre.
  vec2 o = (gl_PointCoord - 0.5) * ${POINT_SIZE.toFixed(1)};
  gl_FragColor = vec4(vRadiance * (pixelShare(o.x) * pixelShare(o.y)), 1.0);
}
`;

/** Share of a centred star's flux in its central pixel (for the negligible-star cut). */
function peakWeight(): number {
  const erf = (x: number): number => {
    const t = 1 / (1 + 0.3275911 * Math.abs(x));
    const y = 1 - t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * Math.exp(-x * x);
    return Math.sign(x) * y;
  };
  const s = erf(0.5 / (STAR_SIGMA_PX * Math.SQRT2));
  return s * s;
}

/** Vertex data of the catalogue layer (exported for tests): positions, flux (rgb), twinkle hash. */
export function starAttributes(cat: StarCatalog): { position: Float32Array; flux: Float32Array; twinkle: Float32Array } {
  const position = new Float32Array(cat.count * 3);
  const flux = new Float32Array(cat.count * 3);
  const twinkle = new Float32Array(cat.count * 2);
  const c = [0, 0, 0];
  for (let i = 0; i < cat.count; i++) {
    equatorialVector(cat.ra[i], cat.dec[i], position, 3 * i);
    starColour(cat.bv[i], c);
    const e = STAR_E0 * Math.pow(10, -0.4 * cat.vmag[i]);
    flux[3 * i] = e * c[0];
    flux[3 * i + 1] = e * c[1];
    flux[3 * i + 2] = e * c[2];
    // Deterministic per-star hash (golden-ratio sequences of the HR number).
    twinkle[2 * i] = (cat.hr[i] * 0.6180339887) % 1;
    twinkle[2 * i + 1] = (cat.hr[i] * 0.7548776662) % 1;
  }
  return { position, flux, twinkle };
}

const assetUrl = (name: string): string => `${import.meta.env.BASE_URL}sky/stars/${name}`;

export class StarField {
  readonly uniforms: Record<string, THREE.IUniform> = {
    /** NASA SVS Milky Way map (sRGB-encoded, GPU-decoded); a 1x1 black stand-in until it loads. */
    tMilkyWay: { value: placeholderTexture() },
    /** 1 once the map is in: milkyWay() samples it instead of the analytic band. */
    uMilkyWayReady: { value: 0 },
    /** 1 once the catalogue layer is drawing: the dome's hashed stars become 6.5..8 mag filler. */
    uCatalogReady: { value: 0 },
  };
  readonly object = new THREE.Group();

  private material: THREE.ShaderMaterial | null = null;
  private geometry: THREE.BufferGeometry | null = null;
  private points: THREE.Points | null = null;
  private catalog: StarCatalog | null = null;
  private milkyWayMap: THREE.Texture | null = null;
  private disposed = false;

  constructor() {
    this.object.name = 'starField';
    this.object.frustumCulled = false;
    if (typeof document !== 'undefined') this.load();
  }

  build(shared: Record<string, THREE.IUniform>): void {
    this.material = new THREE.ShaderMaterial({
      name: 'catalogueStars',
      vertexShader: STAR_VERT,
      fragmentShader: STAR_FRAG,
      // The same uniform objects as the dome: every per-frame update is shared.
      uniforms: { ...shared },
      // Add rgb, keep the target's alpha.
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
      transparent: false,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.addPoints();
  }

  update(_ctx: SimContext, _celestial: Celestial, _pixelAngle: number): void {
    // Everything the layer needs per frame (sidereal rotation, Moon, gains, pixel angle) arrives through the
    // shared dome uniforms, which SkyDome.update has already set.
  }

  dispose(): void {
    this.disposed = true;
    this.points?.removeFromParent();
    this.geometry?.dispose();
    this.material?.dispose();
    this.milkyWayMap?.dispose();
    (this.uniforms.tMilkyWay.value as THREE.Texture).dispose();
  }

  private load(): void {
    fetch(assetUrl('bsc5.bin'))
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.arrayBuffer();
      })
      .then((buf) => {
        if (this.disposed) return;
        this.catalog = decodeStarCatalog(buf);
        this.addPoints();
      })
      .catch((err: unknown) => console.warn('StarField: star catalogue not loaded; procedural stars stay.', err));

    new THREE.TextureLoader().load(
      assetUrl('milkyway_4k.webp'),
      (tex) => {
        if (this.disposed) {
          tex.dispose();
          return;
        }
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = true;
        tex.anisotropy = 4;
        tex.needsUpdate = true;
        this.milkyWayMap = tex;
        const placeholder = this.uniforms.tMilkyWay.value as THREE.Texture;
        this.uniforms.tMilkyWay.value = tex;
        this.uniforms.uMilkyWayReady.value = 1;
        placeholder.dispose();
      },
      undefined,
      (err) => console.warn('StarField: Milky Way map not loaded; the analytic band stays.', err),
    );
  }

  /** Build the Points once both the material and the catalogue exist. */
  private addPoints(): void {
    if (!this.material || !this.catalog || this.points) return;
    const a = starAttributes(this.catalog);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(a.position, 3));
    g.setAttribute('aFlux', new THREE.BufferAttribute(a.flux, 3));
    g.setAttribute('aTwinkle', new THREE.BufferAttribute(a.twinkle, 2));
    this.geometry = g;
    const points = new THREE.Points(g, this.material);
    points.name = 'catalogueStars';
    // Right after the dome (renderOrder -1e9) in the opaque list, before everything else.
    points.renderOrder = -1e9 + 1;
    points.frustumCulled = false;
    points.matrixAutoUpdate = false;
    this.points = points;
    this.object.add(points);
    this.uniforms.uCatalogReady.value = 1;
  }
}

function placeholderTexture(): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat);
  t.needsUpdate = true;
  return t;
}
