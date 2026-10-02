import { GridSize } from './settings';

/**
 * Food sources: the paper's pre-pattern stimuli. One byte per grid cell,
 * `FOOD` where there is a source and 0 elsewhere.
 */
export type FoodMap = Uint8Array<ArrayBuffer>;

export const FOOD = 255;

export interface Point {
  x: number;
  y: number;
}

/** A block of cells, e.g. the part of the food map a brush stroke touched. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function createFoodMap(grid: GridSize): FoodMap {
  return new Uint8Array(grid.width * grid.height);
}

/**
 * Sets every cell within `radius` cells of the line from `from` to `to`
 * (grid coordinates) to food, or clears it with `erase`. Returns the block of
 * cells that may have changed, or null when the stroke misses the grid.
 */
export function paintStroke(
  map: FoodMap,
  grid: GridSize,
  from: Point,
  to: Point,
  radius: number,
  erase = false,
): Rect | null {
  const r = Math.max(radius, 0.5);
  const x0 = Math.max(0, Math.floor(Math.min(from.x, to.x) - r));
  const y0 = Math.max(0, Math.floor(Math.min(from.y, to.y) - r));
  const x1 = Math.min(grid.width - 1, Math.floor(Math.max(from.x, to.x) + r));
  const y1 = Math.min(grid.height - 1, Math.floor(Math.max(from.y, to.y) + r));
  if (x1 < x0 || y1 < y0) {
    return null;
  }

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  const value = erase ? 0 : FOOD;

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      // Distance from the cell centre to the nearest point of the segment.
      const px = x + 0.5 - from.x;
      const py = y + 0.5 - from.y;
      const t = lengthSquared ? Math.min(1, Math.max(0, (px * dx + py * dy) / lengthSquared)) : 0;
      const ex = px - t * dx;
      const ey = py - t * dy;
      if (ex * ex + ey * ey <= r * r) {
        map[y * grid.width + x] = value;
      }
    }
  }
  return { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

/** The food map stretched onto a grid of another size, so sources keep their place on screen. */
export function resizeFoodMap(map: FoodMap, from: GridSize, to: GridSize): FoodMap {
  const resized = createFoodMap(to);
  for (let y = 0; y < to.height; y++) {
    const sourceY = Math.min(from.height - 1, Math.floor(((y + 0.5) * from.height) / to.height));
    for (let x = 0; x < to.width; x++) {
      const sourceX = Math.min(from.width - 1, Math.floor(((x + 0.5) * from.width) / to.width));
      resized[y * to.width + x] = map[sourceY * from.width + sourceX];
    }
  }
  return resized;
}
