import { GridSize } from './settings';

/**
 * Painting food sources: the paper's pre-pattern stimuli. The sources live in
 * a GPU texture and the brush is drawn there (PAINT_SHADER); this file works
 * out where a stroke lands and packs the brush for the shader.
 */

export interface Point {
  x: number;
  y: number;
}

/** A block of grid cells. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The smallest brush: it always covers the cell under the pointer. */
const MIN_RADIUS = 0.5;

/**
 * The block of cells a stroke from `from` to `to` (grid coordinates) with
 * the given radius can touch, or null when the stroke misses the grid.
 */
export function strokeBounds(grid: GridSize, from: Point, to: Point, radius: number): Rect | null {
  const r = Math.max(radius, MIN_RADIUS);
  const x0 = Math.max(0, Math.floor(Math.min(from.x, to.x) - r));
  const y0 = Math.max(0, Math.floor(Math.min(from.y, to.y) - r));
  const x1 = Math.min(grid.width - 1, Math.floor(Math.max(from.x, to.x) + r));
  const y1 = Math.min(grid.height - 1, Math.floor(Math.max(from.y, to.y) + r));
  if (x1 < x0 || y1 < y0) {
    return null;
  }
  return { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

/** Size in bytes of the `Brush` uniform in shaders.ts. */
export const BRUSH_SIZE = 24;

/** Fills `data` (`BRUSH_SIZE` bytes) with the brush for PAINT_SHADER. Painting sets a cell to full, erasing to empty. */
export function packBrush(
  data: ArrayBuffer,
  from: Point,
  to: Point,
  radius: number,
  erase: boolean,
): void {
  new Float32Array(data).set([
    from.x,
    from.y,
    to.x,
    to.y,
    Math.max(radius, MIN_RADIUS),
    erase ? 0 : 1,
  ]);
}
