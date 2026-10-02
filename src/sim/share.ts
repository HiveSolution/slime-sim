import {
  DEFAULT_SETTINGS,
  DEFAULT_SPECIES,
  LIMITS,
  MAX_SPECIES,
  Range,
  SimSettings,
  SPAWN_MODES,
  SPECIES_COLORS,
  SPECIES_LIMITS,
  SpeciesSettings,
} from './settings';

/**
 * Settings as a short text for a link, in URL query syntax:
 * `v=1&g=540&p=15&...&s=d08456_22.5_45_9_1_5_0_0&s=...`, one `s` per species.
 * Painted food is not part of it.
 */

const VERSION = '1';

/** Order of the numbers in a species' `s` value, after the colour and before the repel flag. */
const SPECIES_NUMBERS = [
  'sensorAngle',
  'rotationAngle',
  'sensorOffset',
  'stepSize',
  'deposit',
  'randomTurn',
] as const satisfies readonly (keyof SpeciesSettings)[];

/** Short enough for a link, and without float noise such as 0.30000000000000004. */
function compact(value: number): string {
  return String(+value.toFixed(4));
}

export function encodeSettings(settings: SimSettings): string {
  const params = new URLSearchParams();
  params.set('v', VERSION);
  params.set('g', compact(settings.gridHeight));
  params.set('p', compact(settings.population));
  params.set('m', settings.spawnMode);
  params.set('c', settings.collisions ? '1' : '0');
  params.set('w', settings.wrap ? '1' : '0');
  params.set('d', compact(settings.decay));
  params.set('a', compact(settings.avoidance));
  params.set('n', compact(settings.stepsPerFrame));
  params.set('b', compact(settings.brightness));
  params.set('f', compact(settings.foodStrength));
  for (const species of settings.species) {
    params.append(
      's',
      [
        species.color.replace(/^#/, '').toLowerCase(),
        ...SPECIES_NUMBERS.map((key) => compact(species[key])),
        species.repel ? '1' : '0',
      ].join('_'),
    );
  }
  return params.toString();
}

function readNumber(raw: string | null | undefined, range: Range, fallback: number): number {
  if (raw === null || raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(range.max, Math.max(range.min, value));
}

function readFlag(raw: string | null | undefined, fallback: boolean): boolean {
  return raw === '1' ? true : raw === '0' ? false : fallback;
}

function readSpecies(raw: string, index: number): SpeciesSettings {
  const parts = raw.split('_');
  const species: SpeciesSettings = {
    ...DEFAULT_SPECIES,
    color: /^[0-9a-f]{6}$/i.test(parts[0] ?? '')
      ? `#${parts[0].toLowerCase()}`
      : SPECIES_COLORS[index % SPECIES_COLORS.length],
    repel: readFlag(parts[SPECIES_NUMBERS.length + 1], DEFAULT_SPECIES.repel),
  };
  SPECIES_NUMBERS.forEach((key, i) => {
    species[key] = readNumber(parts[i + 1], SPECIES_LIMITS[key], DEFAULT_SPECIES[key]);
  });
  return species;
}

/**
 * The settings in `text`, as written by `encodeSettings` (a leading `#` or
 * `?` is fine). The text comes from a link, so nothing in it is trusted:
 * numbers are clamped to their limits, and whatever is missing or malformed
 * is taken from `base`.
 */
export function decodeSettings(text: string, base: SimSettings = DEFAULT_SETTINGS): SimSettings {
  const params = new URLSearchParams(text.replace(/^[#?]/, ''));
  const mode = params.get('m');
  const species = params.getAll('s').slice(0, MAX_SPECIES).map(readSpecies);

  return {
    gridHeight: Math.round(readNumber(params.get('g'), LIMITS.gridHeight, base.gridHeight)),
    population: readNumber(params.get('p'), LIMITS.population, base.population),
    spawnMode: SPAWN_MODES.find((candidate) => candidate === mode) ?? base.spawnMode,
    collisions: readFlag(params.get('c'), base.collisions),
    wrap: readFlag(params.get('w'), base.wrap),
    decay: readNumber(params.get('d'), LIMITS.decay, base.decay),
    avoidance: readNumber(params.get('a'), LIMITS.avoidance, base.avoidance),
    stepsPerFrame: Math.round(
      readNumber(params.get('n'), LIMITS.stepsPerFrame, base.stepsPerFrame),
    ),
    brightness: readNumber(params.get('b'), LIMITS.brightness, base.brightness),
    foodStrength: readNumber(params.get('f'), LIMITS.foodStrength, base.foodStrength),
    species: species.length ? species : base.species,
  };
}
