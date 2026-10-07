// Camera system: drives ctx.camera from ctx.state according to ctx.cameraMode.
//
// Each mode is a CameraRig that computes a target pose. Mode changes blend from the previous camera pose
// to the new rig's (moving) pose over a short eased transition. Afterwards the pose is kept above the
// terrain and applied to the camera; the projection matrix is only rebuilt when the FOV actually changes,
// and near/far are left at the contract values.
//
// Must run after the aircraft pose is final for the frame (the audio system reads the camera afterwards).

import * as THREE from 'three';
import { CAMERA_FAR, CAMERA_NEAR, type CameraMode, type SimContext, type Subsystem } from '../../core/context';
import { nedToThree, quatToThree } from '../../core/frames';
import type { Vec3 } from '../../core/math';
import type { ViewControl } from '../../input/InputSystem';
import { C172S_CAMERA, type CameraAircraft } from './aircraft';
import { ChaseRig } from './chaseRig';
import { CockpitRig } from './cockpitRig';
import { FlybyRig } from './flybyRig';
import { OrbitRig } from './orbitRig';
import { copyPose, makePose, type AircraftPose, type CameraPose } from './pose';
import type { CameraRig } from './rig';
import { TowerRig } from './towerRig';

export interface CameraSystemOptions {
  /** Tower camera position, NED metres. Default: 25 m above the field near the apron. */
  towerPositionNED?: Vec3;
  /** Element that receives mouse-look / orbit drags and wheel zoom. Default: the renderer's canvas. */
  domElement?: HTMLElement;
}

/** Terrain clearance kept below the sight line from an external camera to the aircraft, m. */
const SIGHT_CLEARANCE = 1.5;

/** Duration of the eased blend between camera modes, s. */
const TRANSITION_TIME = 0.9;

const smootherstep = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);

export class CameraSystem implements Subsystem, ViewControl {
  private readonly rigs: Record<CameraMode, CameraRig>;
  private readonly cockpit = new CockpitRig();
  private readonly tower: TowerRig;
  private mode: CameraMode | null = null;
  private ctx!: SimContext;
  private el: HTMLElement | null;
  private readonly aircraft: AircraftPose = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
  private readonly target = makePose();
  private readonly from = makePose();
  private readonly current = makePose();
  /**
   * Radius around the aircraft's origin that a blended camera move must not enter, m (C172S: 6.5; span 11 m,
   * length 8.3 m). A switch whose straight path would pass through it (any switch to or from the cockpit, chase
   * to a view on the far side of the aircraft) cuts instead, as X-Plane and MSFS do, rather than flying the
   * camera through the cabin, the tailplane or the wing.
   */
  private airframeRadius = C172S_CAMERA.radius;
  private blend = 1;
  /** A mode switch started this frame: decide on its first frame whether it blends or cuts. */
  private checkPath = false;
  private pendingCut = false;
  /** Camera cuts so far (mode switches that cut, and scenario resets). See onCut. */
  cuts = 0;
  /**
   * Called on every camera cut, so the shell can drop temporal history (TAA) and the like: a cut moves the
   * camera much less than a teleport (cockpit <-> chase is ~15 m), so history-based effects would otherwise
   * blend the old view in for a few frames.
   */
  onCut: (() => void) | null = null;
  /** When it returns true, a left-button drag is left to something else (the mouse yoke) instead of looking. */
  suppressLeftDrag: (() => boolean) | null = null;
  private dragging = false;
  /** A left button is down and may become a look-drag once the pointer has moved a few pixels. */
  private leftPending = false;
  private leftMoved = 0;
  private lastWall = -1;
  private readonly unsubscribe: (() => void)[] = [];
  /** Current line-of-sight lift of an external camera, m (decays smoothly). */
  private sightLift = 0;
  private sightFrame = 0;
  private readonly dirBefore = new THREE.Vector3();
  private readonly dirAfter = new THREE.Vector3();
  private readonly qLift = new THREE.Quaternion();

  constructor(opts: CameraSystemOptions = {}) {
    this.tower = new TowerRig(opts.towerPositionNED);
    this.rigs = { cockpit: this.cockpit, chase: new ChaseRig(), orbit: new OrbitRig(), flyby: new FlybyRig(), tower: this.tower };
    this.el = opts.domElement ?? null;
  }

  init(ctx: SimContext): void {
    this.ctx = ctx;
    this.el ??= ctx.renderer.domElement;
    const el = this.el;
    el.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('mousemove', this.onMouseMove);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('contextmenu', this.onContextMenu);
    this.unsubscribe.push(
      ctx.events.on('touchdown', (e) => this.cockpit.touchdown(e.sinkRate)),
      ctx.events.on('reset', () => (this.pendingCut = true)),
    );
    ctx.camera.near = CAMERA_NEAR;
    ctx.camera.far = CAMERA_FAR;
    ctx.camera.updateProjectionMatrix();
  }

  dispose(): void {
    const el = this.el;
    el?.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    el?.removeEventListener('wheel', this.onWheel);
    el?.removeEventListener('contextmenu', this.onContextMenu);
    this.unsubscribe.forEach((u) => u());
    if (document.pointerLockElement === el) document.exitPointerLock();
  }

  /**
   * The aircraft flown: its pilot's eye point, its size and its default cockpit view. A member left out is the
   * Cessna 172S's, which is also what the cameras show until this is called.
   */
  setAircraft(aircraft: Partial<CameraAircraft> = {}): void {
    const a: CameraAircraft = {
      pilotEye: aircraft.pilotEye ?? C172S_CAMERA.pilotEye,
      radius: aircraft.radius ?? C172S_CAMERA.radius,
      fitSize: aircraft.fitSize ?? C172S_CAMERA.fitSize,
      defaultPitchDeg: aircraft.defaultPitchDeg ?? C172S_CAMERA.defaultPitchDeg,
    };
    this.airframeRadius = a.radius;
    for (const rig of Object.values(this.rigs)) rig.setAircraft?.(a);
  }

  /** Move the tower camera (NED metres). */
  setTowerPosition(ned: Vec3): void {
    this.tower.setPosition(ned);
  }

  /** The mode currently being rendered (follows ctx.cameraMode). */
  getMode(): CameraMode {
    return this.mode ?? this.ctx.cameraMode;
  }

  // ------------------------------------------------------------------ ViewControl

  recentre(): void {
    this.rigs[this.getMode()].recentre();
  }

  zoom(steps: number): void {
    this.rigs[this.getMode()].zoom(steps);
  }

  /** Keyboard look-around: the same as a mouse drag of (dx, dy) pixels in the current view. */
  lookBy(dx: number, dy: number): void {
    this.rigs[this.getMode()].look(dx, dy);
  }

  togglePointerLock(): void {
    if (!this.el) return;
    if (document.pointerLockElement === this.el) document.exitPointerLock();
    else void this.el.requestPointerLock();
  }

  // ------------------------------------------------------------------ mouse

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (e.button === 1) {
      e.preventDefault();
      this.recentre();
      return;
    }
    if (e.button === 2) {
      this.dragging = true;
      return;
    }
    if (e.button !== 0 || this.suppressLeftDrag?.()) return;
    // Left-drag looks too, but only once the pointer has actually moved, so a click on a panel control
    // (which handles pointerdown and calls preventDefault) or a plain click never nudges the view. The
    // panel handler may run after this one, so check defaultPrevented once every listener has run.
    queueMicrotask(() => {
      if (e.defaultPrevented) return;
      this.leftPending = true;
      this.leftMoved = 0;
    });
  };

  private readonly onPointerUp = (): void => {
    this.dragging = false;
    this.leftPending = false;
  };

  private readonly onMouseMove = (e: MouseEvent): void => {
    if (this.leftPending && !this.dragging) {
      this.leftMoved += Math.abs(e.movementX) + Math.abs(e.movementY);
      if (this.leftMoved > 3) this.dragging = true;
    }
    if (this.dragging || document.pointerLockElement === this.el) this.rigs[this.getMode()].look(e.movementX, e.movementY);
  };

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    if (e.deltaY === 0) return;
    const steps = e.deltaY < 0 ? 1 : -1;
    const rig = this.rigs[this.getMode()];
    const el = this.el;
    if (rig.zoomAt && el) {
      const r = el.getBoundingClientRect();
      const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
      const ny = 1 - ((e.clientY - r.top) / r.height) * 2;
      rig.zoomAt(steps, nx, ny, r.width / r.height);
    } else rig.zoom(steps);
  };

  private readonly onContextMenu = (e: Event): void => e.preventDefault();

  // ------------------------------------------------------------------ per frame

  update(dt: number, ctx: SimContext): void {
    const now = performance.now();
    const realDt = this.lastWall < 0 ? 0 : Math.min(0.1, (now - this.lastWall) / 1000);
    this.lastWall = now;

    nedToThree(ctx.state.position, this.aircraft.position);
    quatToThree(ctx.state.orientation, this.aircraft.quaternion);

    if (ctx.cameraMode !== this.mode) this.switchTo(ctx.cameraMode);
    if (this.pendingCut) {
      // After a scenario reset the aircraft jumps; the camera cuts with it instead of flying across.
      this.pendingCut = false;
      this.checkPath = false;
      this.blend = 1;
      this.sightLift = 0;
      this.rigs[ctx.cameraMode].activate(ctx, this.aircraft, this.current);
      this.cut();
    }
    const rig = this.rigs[ctx.cameraMode];
    rig.update(dt, realDt, ctx, this.aircraft, this.target);
    if (this.checkPath) {
      this.checkPath = false;
      if (this.blend < 1 && segmentNearPoint(this.from.position, this.target.position, this.aircraft.position, this.airframeRadius)) {
        this.blend = 1;
        this.cut();
      }
    }

    const cur = this.current;
    if (this.blend < 1) {
      this.blend = Math.min(1, this.blend + realDt / TRANSITION_TIME);
      const e = smootherstep(this.blend);
      cur.position.lerpVectors(this.from.position, this.target.position, e);
      cur.quaternion.slerpQuaternions(this.from.quaternion, this.target.quaternion, e);
      cur.fov = this.from.fov + (this.target.fov - this.from.fov) * e;
    } else copyPose(this.target, cur);

    this.keepClear(cur, rig, ctx, dt);

    const cam = ctx.camera;
    cam.position.copy(cur.position);
    cam.quaternion.copy(cur.quaternion);
    if (Math.abs(cam.fov - cur.fov) > 1e-4) {
      cam.fov = cur.fov;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();
  }

  /**
   * Never below the terrain, and (external cameras) never with a ridge between the camera and the aircraft:
   * the camera is raised as far as needed. The occlusion lift rises at once but relaxes over ~1.5 s, so the
   * camera does not bob over every bump in the terrain; a raised camera turns to keep the aircraft where it
   * was on screen.
   */
  private keepClear(cur: CameraPose, rig: CameraRig, ctx: SimContext, dt: number): void {
    const env = ctx.env;
    const p = cur.position;
    const a = this.aircraft.position;
    // three: x = east, y = up, z = -north.
    const groundLift = env.groundElevation(-p.z, p.x) + rig.groundClearance - p.y;
    let sight = 0;
    // The sight line is sampled every third frame (terrain queries are not free); the lift is held between.
    if (rig.lineOfSight && ++this.sightFrame % 3 === 0) {
      const d = p.distanceTo(a);
      // Sample the terrain along the sight line (skip the part next to the aircraft, which may be on the ground).
      const n = d > 400 ? 8 : 5;
      for (let k = 1; k <= n; k++) {
        const f = 0.15 + (0.85 * k) / (n + 1);
        const x = a.x + (p.x - a.x) * f;
        const z = a.z + (p.z - a.z) * f;
        const y = a.y + (p.y - a.y) * f;
        // Clearance grows toward the camera end: near the aircraft the line may legitimately skim the ground.
        const clear = env.groundElevation(-z, x) + SIGHT_CLEARANCE * f;
        if (y < clear) sight = Math.max(sight, a.y + (clear - a.y) / f - p.y);
      }
    }
    this.sightLift = Math.max(sight, this.sightLift * Math.exp(-Math.max(dt, 0) / 1.5));
    if (!rig.lineOfSight) this.sightLift = 0;
    const lift = Math.max(groundLift, this.sightLift);
    if (lift <= 0) return;
    if (rig.watchesAircraft) {
      this.dirBefore.subVectors(a, p).normalize();
      p.y += lift;
      this.dirAfter.subVectors(a, p).normalize();
      cur.quaternion.premultiply(this.qLift.setFromUnitVectors(this.dirBefore, this.dirAfter));
    } else p.y += lift;
  }

  private switchTo(mode: CameraMode): void {
    const first = this.mode === null;
    this.mode = mode;
    const cam = this.ctx.camera;
    this.from.position.copy(cam.position);
    this.from.quaternion.copy(cam.quaternion);
    this.from.fov = cam.fov;
    this.rigs[mode].activate(this.ctx, this.aircraft, this.from);
    if (document.pointerLockElement === this.el && mode !== 'cockpit' && mode !== 'chase') document.exitPointerLock();
    // The very first frame starts in place rather than flying in from wherever the camera was created.
    this.blend = first ? 1 : 0;
    this.checkPath = !first;
  }

  private cut(): void {
    this.cuts++;
    this.onCut?.();
  }
}

/** Does the segment a-b pass within `radius` of p (either end inside counts)? */
export function segmentNearPoint(a: THREE.Vector3, b: THREE.Vector3, p: THREE.Vector3, radius: number): boolean {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const len2 = abx * abx + aby * aby + abz * abz;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / len2)) : 0;
  const dx = a.x + abx * t - p.x, dy = a.y + aby * t - p.y, dz = a.z + abz * t - p.z;
  return dx * dx + dy * dy + dz * dz < radius * radius;
}
