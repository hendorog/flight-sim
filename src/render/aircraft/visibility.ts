import { Line, Mesh, Points, Sprite, type Object3D } from 'three';

/** Hide the airframe from every camera while retaining its landing/taxi illumination. Keeping the
 * object visibility alone is not enough: three.js skips all children of an invisible group, lights too.
 * Render layers leave traversal and the aircraft's animated visibility flags intact. */
export class AirframeVisibility {
  private hidden = false;
  private readonly masks = new Map<Object3D, number>();

  setHidden(root: Object3D, hidden: boolean): void {
    if (hidden === this.hidden) return;
    this.hidden = hidden;
    if (hidden) {
      root.traverse(o => {
        if (o instanceof Mesh || o instanceof Line || o instanceof Points || o instanceof Sprite) {
          this.masks.set(o, o.layers.mask);
          o.layers.disableAll();
        }
      });
    } else {
      for (const [o, mask] of this.masks) o.layers.mask = mask;
      this.masks.clear();
    }
  }
}
