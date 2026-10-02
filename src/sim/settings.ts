/**
 * Simulation settings. Names in brackets are the parameter names from
 * Jones (2010), "Characteristics of Pattern Formation and Evolution in
 * Approximations of Physarum Transport Networks", Table 1.
 */
export type SpawnMode = 'random' | 'disc' | 'ring';

export interface SimSettings {
  /** Grid height in cells; the width follows the canvas aspect ratio. */
  gridHeight: number;
  /** Population as a percentage of the grid area [%p]. */
  population: number;
  spawnMode: SpawnMode;
  /** Angle of the left and right sensors from the forward one, in degrees [SA]. */
  sensorAngle: number;
  /** How far an agent rotates per step, in degrees [RA]. */
  rotationAngle: number;
  /** Distance from the agent to its sensors, in cells [SO]. */
  sensorOffset: number;
  /** Distance an agent moves per step, in cells [SS]. */
  stepSize: number;
  /** Trail deposited per step [depT]. */
  deposit: number;
  /** Fraction of the trail lost per step after diffusion [decayT]. */
  decay: number;
  /**
   * One agent per cell, as in the paper: a move into an occupied cell fails,
   * and the agent then deposits nothing and picks a random new direction.
   */
  collisions: boolean;
  /** Probability per step of picking a random new direction [pCD]. */
  randomTurn: number;
  /** Simulation steps per rendered frame. */
  stepsPerFrame: number;
  /** Display only: how bright a given trail level is drawn. */
  brightness: number;
}

/** Settings that need new buffers or textures, so changing them restarts the run. */
export const RESET_KEYS = [
  'gridHeight',
  'population',
  'spawnMode',
  'collisions',
] as const satisfies readonly (keyof SimSettings)[];

/** The paper's defaults (Table 1), which give the dynamic, never-settling network of Figure 4. */
export const DEFAULT_SETTINGS: SimSettings = {
  gridHeight: 540,
  population: 15,
  spawnMode: 'random',
  sensorAngle: 22.5,
  rotationAngle: 45,
  sensorOffset: 9,
  stepSize: 1,
  deposit: 5,
  decay: 0.1,
  collisions: true,
  randomTurn: 0,
  stepsPerFrame: 1,
  brightness: 0.5,
};

export interface Preset {
  id: string;
  name: string;
  /** Where in the paper the settings come from. */
  source: string;
  settings: Partial<SimSettings>;
}

export const PRESETS: readonly Preset[] = [
  {
    id: 'dynamic',
    name: 'Dynamic',
    source: 'Fig. 4',
    settings: { sensorAngle: 22.5, rotationAngle: 45, sensorOffset: 9, population: 15 },
  },
  {
    id: 'minimising',
    name: 'Minimising',
    source: 'Fig. 5',
    settings: { sensorAngle: 45, rotationAngle: 45, sensorOffset: 9, population: 15 },
  },
  {
    id: 'fine',
    name: 'Fine grain',
    source: 'Fig. 10',
    settings: { sensorAngle: 45, rotationAngle: 45, sensorOffset: 3, population: 15 },
  },
  {
    id: 'coarse',
    name: 'Coarse grain',
    source: 'Fig. 10',
    settings: { sensorAngle: 45, rotationAngle: 45, sensorOffset: 25, population: 15 },
  },
];

/** True when going from `a` to `b` needs the simulation to be rebuilt. */
export function needsReset(a: SimSettings, b: SimSettings): boolean {
  return RESET_KEYS.some((key) => a[key] !== b[key]);
}

export interface GridSize {
  width: number;
  height: number;
}

/** Grid dimensions for a grid `gridHeight` cells tall with the given width / height ratio. */
export function gridSize(gridHeight: number, aspect: number, maxDimension = 8192): GridSize {
  const height = Math.max(1, Math.min(maxDimension, Math.round(gridHeight)));
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const width = Math.max(1, Math.min(maxDimension, Math.round(height * safeAspect)));
  return { width, height };
}

/** Number of agents for a population given as a percentage of the grid area, at most one per cell. */
export function agentCount(grid: GridSize, population: number): number {
  const cells = grid.width * grid.height;
  return Math.min(cells, Math.max(1, Math.round((cells * population) / 100)));
}
