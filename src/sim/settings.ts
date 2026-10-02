/**
 * Simulation settings. Names in brackets are the parameter names from
 * Jones (2010), "Characteristics of Pattern Formation and Evolution in
 * Approximations of Physarum Transport Networks", Table 1.
 */
export const SPAWN_MODES = ['random', 'disc', 'ring'] as const;
export type SpawnMode = (typeof SPAWN_MODES)[number];

/** The values a numeric setting can take. */
export interface Range {
  min: number;
  max: number;
  step: number;
}

/** One trail channel per species, and the trail map has four. */
export const MAX_SPECIES = 4;

/**
 * A group of agents with its own behaviour, colour and trail. The paper has
 * a single species; several are an addition (see README).
 */
export interface SpeciesSettings {
  /** Trail colour as `#rrggbb`. */
  color: string;
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
  /** Probability per step of picking a random new direction [pCD]. */
  randomTurn: number;
  /**
   * Turn away from the species' own trail instead of towards it: the
   * paper's chemorepulsion, which gives regular spots and stripes.
   */
  repel: boolean;
}

export interface SimSettings {
  /** Grid height in cells; the width follows the canvas aspect ratio. */
  gridHeight: number;
  /** Population as a percentage of the grid area [%p], shared equally between the species. */
  population: number;
  spawnMode: SpawnMode;
  /**
   * One agent per cell, as in the paper: a move into an occupied cell fails,
   * and the agent then deposits nothing and picks a random new direction.
   */
  collisions: boolean;
  /**
   * Whether the grid wraps around at its edges (the paper's periodic
   * boundary). Otherwise the edges are walls: they block agents, and
   * nothing is sensed or diffuses back from beyond them.
   */
  wrap: boolean;
  /** Fraction of the trail lost per step after diffusion [decayT]. */
  decay: number;
  /** What every cell of a food source adds to the food map per step. */
  foodStrength: number;
  /**
   * How strongly agents are repelled by other species' trails, relative to
   * the pull of their own. 0 makes the species ignore each other's trails.
   */
  avoidance: number;
  /** Simulation steps per rendered frame. */
  stepsPerFrame: number;
  /** Display only: how bright a given trail level is drawn. */
  brightness: number;
  /** 1 to `MAX_SPECIES` entries. */
  species: readonly SpeciesSettings[];
}

/** Limits of the numeric settings: what the sliders offer and what a shared link may contain. */
export const LIMITS = {
  gridHeight: { min: 64, max: 2160, step: 1 },
  population: { min: 1, max: 100, step: 1 },
  decay: { min: 0, max: 0.5, step: 0.005 },
  avoidance: { min: 0, max: 3, step: 0.05 },
  stepsPerFrame: { min: 1, max: 20, step: 1 },
  brightness: { min: 0.05, max: 3, step: 0.05 },
  foodStrength: { min: 0, max: 50, step: 0.5 },
} as const satisfies Partial<Record<keyof SimSettings, Range>>;

export const SPECIES_LIMITS = {
  sensorAngle: { min: 0, max: 180, step: 0.5 },
  rotationAngle: { min: 0, max: 180, step: 0.5 },
  sensorOffset: { min: 1, max: 60, step: 1 },
  stepSize: { min: 0.1, max: 5, step: 0.1 },
  deposit: { min: 0, max: 20, step: 0.5 },
  randomTurn: { min: 0, max: 0.2, step: 0.001 },
} as const satisfies Partial<Record<keyof SpeciesSettings, Range>>;

/** Settings that need new buffers or textures, so changing them restarts the run. */
export const RESET_KEYS = [
  'gridHeight',
  'population',
  'spawnMode',
  'collisions',
] as const satisfies readonly (keyof SimSettings)[];

/** The dark chart series of the hive's colour system: copper, teal, gold, sage. */
export const SPECIES_COLORS: readonly string[] = ['#d08456', '#82b9d0', '#dca627', '#86bf9a'];

/** The paper's agent defaults (Table 1). */
export const DEFAULT_SPECIES: SpeciesSettings = {
  color: SPECIES_COLORS[0],
  sensorAngle: 22.5,
  rotationAngle: 45,
  sensorOffset: 9,
  stepSize: 1,
  deposit: 5,
  randomTurn: 0,
  repel: false,
};

/** The paper's defaults (Table 1), which give the dynamic, never-settling network of Figure 4. */
export const DEFAULT_SETTINGS: SimSettings = {
  gridHeight: 540,
  population: 15,
  spawnMode: 'random',
  collisions: true,
  wrap: true,
  decay: 0.1,
  foodStrength: 5,
  avoidance: 1,
  stepsPerFrame: 1,
  brightness: 0.5,
  species: [DEFAULT_SPECIES],
};

export interface Preset {
  id: string;
  name: string;
  /** Where in the paper the settings come from. */
  source: string;
  settings: Partial<Omit<SimSettings, 'species'>>;
  /** Applied to every species. */
  species: Partial<Omit<SpeciesSettings, 'color'>>;
}

export const PRESETS: readonly Preset[] = [
  {
    id: 'dynamic',
    name: 'Dynamic',
    source: 'Fig. 4',
    settings: { population: 15, wrap: true },
    species: { sensorAngle: 22.5, rotationAngle: 45, sensorOffset: 9, repel: false },
  },
  {
    id: 'minimising',
    name: 'Minimising',
    source: 'Fig. 5',
    settings: { population: 15, wrap: true },
    species: { sensorAngle: 45, rotationAngle: 45, sensorOffset: 9, repel: false },
  },
  {
    id: 'fine',
    name: 'Fine grain',
    source: 'Fig. 10',
    settings: { population: 15, wrap: true },
    species: { sensorAngle: 45, rotationAngle: 45, sensorOffset: 3, repel: false },
  },
  {
    id: 'coarse',
    name: 'Coarse grain',
    source: 'Fig. 10',
    settings: { population: 15, wrap: true },
    species: { sensorAngle: 45, rotationAngle: 45, sensorOffset: 25, repel: false },
  },
  {
    id: 'sheet',
    name: 'Sheet',
    source: 'Fig. 9',
    settings: { population: 20, wrap: false },
    species: { sensorAngle: 45, rotationAngle: 45, sensorOffset: 9, repel: false },
  },
  {
    id: 'spots',
    name: 'Spots',
    source: 'Fig. 22',
    settings: { population: 10, wrap: true },
    species: { sensorAngle: 45, rotationAngle: 45, sensorOffset: 27, repel: true },
  },
  {
    id: 'stripes',
    name: 'Stripes',
    source: 'Fig. 16',
    settings: { population: 20, wrap: true },
    species: { sensorAngle: 112.5, rotationAngle: 67.5, sensorOffset: 13, repel: true },
  },
  {
    id: 'foraging',
    name: 'Foraging',
    source: 'Fig. 18',
    settings: { population: 2, wrap: false },
    species: { sensorAngle: 45, rotationAngle: 45, sensorOffset: 9, repel: false },
  },
];
/** The settings with a preset applied; species keep their colours. */
export function applyPreset(settings: SimSettings, preset: Preset): SimSettings {
  return {
    ...settings,
    ...preset.settings,
    species: settings.species.map((species) => ({ ...species, ...preset.species })),
  };
}

/** True when the settings are what `applyPreset` would give. */
export function matchesPreset(settings: SimSettings, preset: Preset): boolean {
  const matches = <T extends object>(target: T, values: Partial<T>) =>
    (Object.keys(values) as (keyof T)[]).every((key) => target[key] === values[key]);
  return (
    matches(settings, preset.settings) &&
    settings.species.every((species) => matches(species, preset.species))
  );
}

/**
 * The settings with one more species: a copy of species `from` in the first
 * colour of `SPECIES_COLORS` that isn't in use. Unchanged at `MAX_SPECIES`.
 */
export function addSpecies(settings: SimSettings, from: number): SimSettings {
  if (settings.species.length >= MAX_SPECIES) {
    return settings;
  }
  const used = new Set(settings.species.map((species) => species.color.toLowerCase()));
  const color =
    SPECIES_COLORS.find((candidate) => !used.has(candidate)) ??
    SPECIES_COLORS[settings.species.length % SPECIES_COLORS.length];
  const template = settings.species[from] ?? DEFAULT_SPECIES;
  return { ...settings, species: [...settings.species, { ...template, color }] };
}

/** The settings without species `index`. The last species can't be removed. */
export function removeSpecies(settings: SimSettings, index: number): SimSettings {
  if (settings.species.length <= 1) {
    return settings;
  }
  return { ...settings, species: settings.species.filter((_, i) => i !== index) };
}

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
