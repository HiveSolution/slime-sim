/**
 * Simulation settings. Names in brackets are the parameter names from
 * Jones (2010), "Characteristics of Pattern Formation and Evolution in
 * Approximations of Physarum Transport Networks", Table 1.
 */
export type SpawnMode = 'random' | 'disc' | 'ring';

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
  /** Fraction of the trail lost per step after diffusion [decayT]. */
  decay: number;
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
};

/** The paper's defaults (Table 1), which give the dynamic, never-settling network of Figure 4. */
export const DEFAULT_SETTINGS: SimSettings = {
  gridHeight: 540,
  population: 15,
  spawnMode: 'random',
  collisions: true,
  decay: 0.1,
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
    settings: { population: 15 },
    species: { sensorAngle: 22.5, rotationAngle: 45, sensorOffset: 9 },
  },
  {
    id: 'minimising',
    name: 'Minimising',
    source: 'Fig. 5',
    settings: { population: 15 },
    species: { sensorAngle: 45, rotationAngle: 45, sensorOffset: 9 },
  },
  {
    id: 'fine',
    name: 'Fine grain',
    source: 'Fig. 10',
    settings: { population: 15 },
    species: { sensorAngle: 45, rotationAngle: 45, sensorOffset: 3 },
  },
  {
    id: 'coarse',
    name: 'Coarse grain',
    source: 'Fig. 10',
    settings: { population: 15 },
    species: { sensorAngle: 45, rotationAngle: 45, sensorOffset: 25 },
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
