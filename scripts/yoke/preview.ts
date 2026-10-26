// Dev preview of the yoke and stick builders (src/render/aircraft/yoke.ts): each style in rows, from the pilot's side,
// from the right, from above and from the left seat's eye, with an 83 mm square (a 3-1/8 in instrument bezel) for
// scale and its triangle count. Open /scripts/yoke/preview.html?styles=cessnaSingle,pilatus&stick=1 on a vite server
// started at the repository root (scripts/yoke/shoot.mjs screenshots it).
import * as THREE from 'three';
import { YOKE_STYLES, DIAMOND_STICK, yokeGeometry, stickGeometry, yokeMaterial } from '../../src/render/aircraft/yoke';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { cleanAttributes } from '../../src/render/aircraft/geometry';

const q = new URLSearchParams(location.search);
const names = (q.get('styles') ?? Object.keys(YOKE_STYLES).join(',')).split(',').filter(Boolean) as (keyof typeof YOKE_STYLES)[];
const withStick = q.get('stick') === '1';
const W = 1600, cell = 300;
const rows = names.length + (withStick ? 1 : 0);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(W, rows * cell);
renderer.setScissorTest(true);
document.body.appendChild(renderer.domElement);
const label = document.getElementById('l')!;
const plasticMat = yokeMaterial();
const metal = new THREE.MeshStandardMaterial({ color: 0x8a8d92, metalness: 1, roughness: 0.3 });
const env = new THREE.PMREMGenerator(renderer).fromScene(new (await import('three/examples/jsm/environments/RoomEnvironment.js')).RoomEnvironment()).texture;

function scene(plastic: THREE.BufferGeometry[], tube: THREE.BufferGeometry): { s: THREE.Scene; tris: number } {
  const s = new THREE.Scene();
  s.environment = env;
  s.background = new THREE.Color(0x9aa3ad);
  const g = mergeGeometries(plastic.map((p) => cleanAttributes(p)), false)!;
  s.add(new THREE.Mesh(g, plasticMat), new THREE.Mesh(tube, metal));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(0.5, 1, 0.8);
  s.add(sun);
  // An 83 mm square: a 3-1/8 in instrument bezel, beside the part.
  const sq = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(0.083, 0.083)), new THREE.LineBasicMaterial({ color: 0xff3300 }));
  sq.position.set(0.215, 0.0, 0);
  s.add(sq);
  const tris = (g.index!.count + (tube.index ? tube.index.count : tube.getAttribute('position').count)) / 3;
  return { s, tris };
}

const views: { name: string; pos: [number, number, number]; target: [number, number, number]; fov: number }[] = [
  { name: 'front (pilot side)', pos: [0, 0.03, 0.9], target: [0, 0.01, 0], fov: 26 },
  { name: 'right side', pos: [0.9, 0.03, 0], target: [0, 0.01, 0], fov: 26 },
  { name: 'top', pos: [0, 0.9, 0.001], target: [0, 0, 0], fov: 26 },
  { name: 'pilot eye', pos: [0.02, 0.3, 0.45], target: [0, 0.01, 0], fov: 40 },
  { name: '3/4 low', pos: [-0.45, -0.05, 0.6], target: [0, 0.01, 0], fov: 28 },
];
const vw = W / views.length;
const items: { name: string; plastic: THREE.BufferGeometry[]; tube: THREE.BufferGeometry; yOff: number }[] = names.map((n) => ({ name: n, ...yokeGeometry(YOKE_STYLES[n], -1), yOff: 0 }));
if (withStick) items.push({ name: 'diamond stick', ...stickGeometry(DIAMOND_STICK, 0.35), yOff: 0.29 });
items.forEach((it, r) => {
  const { s, tris } = scene(it.plastic, it.tube);
  views.forEach((v, c) => {
    const cam = new THREE.PerspectiveCamera(v.fov, vw / cell, 0.01, 10);
    cam.position.set(v.pos[0], v.pos[1] + it.yOff, v.pos[2]);
    cam.lookAt(v.target[0], v.target[1] + it.yOff, v.target[2]);
    const y = (rows - 1 - r) * cell;
    renderer.setViewport(c * vw, y, vw, cell);
    renderer.setScissor(c * vw, y, vw, cell);
    renderer.render(s, cam);
    const d = document.createElement('div');
    d.style.left = `${c * vw + 4}px`;
    d.style.top = `${r * cell + 4}px`;
    d.textContent = c === 0 ? `${it.name} ${Math.round(tris)} tris` : v.name;
    label.appendChild(d);
  });
});
(window as unknown as { __done: boolean }).__done = true;
