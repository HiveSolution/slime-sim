import { GridSize, SpawnMode } from './settings';

/** Floats per agent in the agent buffer: x, y, heading (radians), moved-last-step flag. */
export const AGENT_STRIDE = 4;

const TAU = Math.PI * 2;
/** How often a start shape is resampled to find a free cell before any free cell is taken. */
const PLACEMENT_TRIES = 8;

export interface InitialState {
  agents: Float32Array<ArrayBuffer>;
  /** One entry per grid cell, 1 where an agent sits. All zero when `exclusive` is off. */
  occupancy: Uint32Array<ArrayBuffer>;
}

/**
 * Initial agent states. The paper starts every run from random positions and
 * headings; `disc` and `ring` are extra starting shapes.
 *
 * With `exclusive`, every agent gets a cell of its own, as in the paper. An
 * agent that finds no free cell in its start shape goes to a free cell
 * anywhere on the grid. `count` must not exceed the number of cells then.
 */
export function createAgents(
  count: number,
  grid: GridSize,
  mode: SpawnMode,
  exclusive: boolean,
  random: () => number = Math.random,
): InitialState {
  const cells = grid.width * grid.height;
  if (exclusive && count > cells) {
    throw new RangeError(`${count} agents don't fit in ${cells} cells.`);
  }
  const agents = new Float32Array(count * AGENT_STRIDE);
  const occupancy = new Uint32Array(cells);
  const cx = grid.width / 2;
  const cy = grid.height / 2;
  const extent = Math.min(grid.width, grid.height);
  // Just below the edge, so a position never rounds up to it as a float32.
  const maxX = grid.width - 0.01;
  const maxY = grid.height - 0.01;

  const sample = (): [number, number, number] => {
    const heading = random() * TAU;
    if (mode === 'disc') {
      // sqrt keeps the density uniform over the disc.
      const r = extent * 0.15 * Math.sqrt(random());
      const a = random() * TAU;
      return [cx + Math.cos(a) * r, cy + Math.sin(a) * r, heading];
    }
    if (mode === 'ring') {
      const r = extent * (0.4 + 0.05 * random());
      const a = random() * TAU;
      return [cx + Math.cos(a) * r, cy + Math.sin(a) * r, a + Math.PI]; // facing the centre
    }
    return [random() * grid.width, random() * grid.height, heading];
  };

  for (let i = 0; i < count; i++) {
    let [x, y, heading] = sample();
    x = Math.min(Math.max(x, 0), maxX);
    y = Math.min(Math.max(y, 0), maxY);

    if (exclusive) {
      let cell = Math.floor(y) * grid.width + Math.floor(x);
      for (let tries = 1; occupancy[cell] && tries < PLACEMENT_TRIES; tries++) {
        [x, y, heading] = sample();
        x = Math.min(Math.max(x, 0), maxX);
        y = Math.min(Math.max(y, 0), maxY);
        cell = Math.floor(y) * grid.width + Math.floor(x);
      }
      if (occupancy[cell]) {
        cell = Math.min(cells - 1, Math.floor(random() * cells));
        while (occupancy[cell]) {
          cell = (cell + 1) % cells;
        }
        x = (cell % grid.width) + 0.5;
        y = Math.floor(cell / grid.width) + 0.5;
      }
      occupancy[cell] = 1;
    }

    const o = i * AGENT_STRIDE;
    agents[o] = x;
    agents[o + 1] = y;
    agents[o + 2] = heading;
  }
  return { agents, occupancy };
}
