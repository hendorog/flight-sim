import { expect, it } from 'vitest';
import { Group, Layers, Line, Mesh, Points, SpotLight, Sprite } from 'three';
import { AirframeVisibility } from '../../src/render/aircraft/visibility';

it('hides geometry while keeping runway lighting, then restores layers without overwriting animated visibility', () => {
  const root = new Group(), wing = new Mesh(), glass = new Mesh(), glow = new Points(), line = new Line(), sprite = new Sprite();
  const lamp = new SpotLight();
  root.add(wing, glass, glow, line, sprite);
  wing.add(lamp, lamp.target); // Even a light mounted under geometry must remain traversable.
  glass.layers.enable(3);
  const masks = [wing, glass, glow, line, sprite].map(o => o.layers.mask);
  const visibility = new AirframeVisibility(), cameraLayers = new Layers();
  visibility.setHidden(root, true);
  for (const o of [wing, glass, glow, line, sprite]) expect(cameraLayers.test(o.layers)).toBe(false);
  expect(cameraLayers.test(lamp.layers)).toBe(true);
  const visible: unknown[] = []; root.traverseVisible(o => visible.push(o));
  expect(visible).toContain(lamp);
  wing.visible = false; // Normal per-frame aircraft animation/LOD still owns this flag.
  visibility.setHidden(root, true);
  visibility.setHidden(root, false);
  expect([wing, glass, glow, line, sprite].map(o => o.layers.mask)).toEqual(masks);
  expect(wing.visible).toBe(false);
  expect(lamp.visible).toBe(true);
});
