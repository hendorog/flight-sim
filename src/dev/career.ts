// Career UI dev page: every Career page over the mock scene, from fixture careers played through the pure core
// (src/career/ui/fixtures.ts) on the real seed-0 airfields, for screenshots at 1280x720 and 1600x900
// (scripts/career-shots.mjs, or scripts/shot.mjs for one page).
//
// URL parameters:
//   screen=locked | create | seed | hub | hub-job | hub-first | board | reposition | dispatch | dispatch-switch | fleet
//          | market | pilot | logbook | stop | bankrupt | debrief | debrief-crash | strip | strip-heli     (default hub)
//   tod=22                      the harness's time of day (night shots)
// window.__career is the CareerUi, window.__ui the UISystem; Career commands are logged to the console and collected
// in window.__commands. The page answers no command (the fixture stays as it is), except the UI's own navigation.

import * as THREE from 'three';
import { careerFixture, FIXTURE_SCREENS, type FixtureScreen } from '../career/ui/fixtures';
import { CareerUi } from '../career/ui/careerUi';
import { KEY_BINDINGS } from '../input';
import { UISystem } from '../ui';
import { airfields } from '../world/airfields';
import '../world/terrain/heightfield';
import { runHarness } from './harness';

const params = new URLSearchParams(location.search);
const asked = params.get('screen') ?? 'hub';
const screen: FixtureScreen = (FIXTURE_SCREENS as readonly string[]).includes(asked) ? (asked as FixtureScreen) : 'hub';

const BINDINGS = [...KEY_BINDINGS, { keys: 'Escape', action: 'Menu', category: 'Simulation' }];
const ui = new UISystem({ bindings: BINDINGS, hints: 'never' });
const career = new CareerUi(ui.schoolLayer);
const commands: unknown[] = [];
career.onCommand = (cmd) => {
  commands.push(cmd);
  console.log('[career] command', JSON.stringify(cmd));
};
career.toastSink = (t) => ui.showToast(t);
Object.assign(window as object, { __career: career, __ui: ui, __commands: commands });

void runHarness({
  setup(ctx) {
    ctx.cameraMode = 'chase';
  },
  subsystems: [
    {
      init(ctx) {
        const ground = new THREE.Mesh(new THREE.PlaneGeometry(40000, 40000).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x5d7f45, roughness: 1 }));
        ground.position.y = 120;
        ctx.scene.add(ground);
        const white = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.5 });
        const aircraft = new THREE.Group();
        aircraft.add(new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.2, 7.5), white));
        const wing = new THREE.Mesh(new THREE.BoxGeometry(11, 0.14, 1.5), white);
        wing.position.set(0, 0.7, -0.3);
        aircraft.add(wing);
        ctx.aircraftRoot.add(aircraft);
      },
      update(_dt, ctx) {
        const back = new THREE.Vector3(0, 0, 1).applyQuaternion(ctx.aircraftRoot.quaternion).setY(0).normalize();
        ctx.camera.position.copy(ctx.aircraftRoot.position).addScaledVector(back, 25).add(new THREE.Vector3(0, 6, 0));
        ctx.camera.lookAt(ctx.aircraftRoot.position);
      },
    },
    ui,
  ],
}).then(() => {
  ui.hideLoading();
  const fx = careerFixture(screen, airfields());
  career.setModel(fx.model);
  if (fx.dispatchOfferId) career.setDispatchOffer(fx.dispatchOfferId);
  if (fx.memo) career.presetMemo(fx.memo);
  if (fx.strip) career.setStrip(fx.strip.model, { canAbandon: fx.strip.canAbandon });
  if (fx.page) career.open(fx.page);
});
