// Sample rounded corners once for the canvas silhouette and the matching extruded console.
// Straight runs stay straight (particularly the pedestal); no interpolating spline can bow into a dial.
export function roundedPanelOutline(points: readonly (readonly [number, number])[], radius: number): readonly (readonly [number, number])[] {
  return points.flatMap(([x, y], i) => {
    const prev = points[(i + points.length - 1) % points.length], next = points[(i + 1) % points.length];
    const a = Math.hypot(prev[0] - x, prev[1] - y), b = Math.hypot(next[0] - x, next[1] - y);
    const r = Math.min(radius, a * 0.45, b * 0.45);
    const start = [x + (prev[0] - x) * r / a, y + (prev[1] - y) * r / a];
    const end = [x + (next[0] - x) * r / b, y + (next[1] - y) * r / b];
    return Array.from({ length: 9 }, (_, j): readonly [number, number] => {
      const t = j / 8, s = 1 - t;
      return [s * s * start[0] + 2 * s * t * x + t * t * end[0], s * s * start[1] + 2 * s * t * y + t * t * end[1]];
    });
  });
}
