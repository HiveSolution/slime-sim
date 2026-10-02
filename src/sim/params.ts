import { parseHexColor, Rgb } from './colors';
import { GridSize, MAX_SPECIES, SimSettings } from './settings';

/** Colours of the rendered trail map that don't belong to a species, as 0..1 sRGB components. */
export interface SimColors {
  background: Rgb;
  /** What the densest trails fade to. */
  peak: Rgb;
}

/** Everything the shaders' `Params` uniform is built from. */
export interface ParamsInput {
  settings: SimSettings;
  colors: SimColors;
  grid: GridSize;
  /** Canvas width / height. */
  canvasAspect: number;
  agentCount: number;
  /** Changes every step; seeds the agents' random numbers. */
  seed: number;
}

/**
 * Layout of the `Params` struct in shaders.ts, in 4-byte units. WGSL aligns
 * `vec4f` and structs holding one to 16 bytes, hence the gaps.
 */
const SIZE = 0;
const VIEW_SCALE = 2;
const DECAY = 4;
const AVOIDANCE = 5;
const AGENT_COUNT = 6;
const SEED = 7;
const COLLISIONS = 8;
const SPECIES_COUNT = 9;
const COLOR_BACKGROUND = 12;
const COLOR_PEAK = 16;
const SPECIES = 20;
/** Size of one `Species` struct. */
const SPECIES_STRIDE = 12;
const SPECIES_COLOR = 8;

export const PARAMS_SIZE = (SPECIES + MAX_SPECIES * SPECIES_STRIDE) * 4;

const DEG_TO_RAD = Math.PI / 180;
const FALLBACK_COLOR: Rgb = [1, 1, 1];

/** Fills `data` (`PARAMS_SIZE` bytes) with the uniform values for the shaders. */
export function packParams(data: ArrayBuffer, input: ParamsInput): void {
  const { settings, colors, grid } = input;
  const f = new Float32Array(data);
  const u = new Uint32Array(data);
  const species = settings.species.slice(0, MAX_SPECIES);

  // The grid keeps its aspect ratio and covers the canvas.
  const canvasAspect = input.canvasAspect > 0 ? input.canvasAspect : 1;
  const gridAspect = grid.width / grid.height;

  f[SIZE] = grid.width;
  f[SIZE + 1] = grid.height;
  f[VIEW_SCALE] = canvasAspect > gridAspect ? 1 : canvasAspect / gridAspect;
  f[VIEW_SCALE + 1] = canvasAspect > gridAspect ? gridAspect / canvasAspect : 1;
  f[DECAY] = settings.decay;
  f[AVOIDANCE] = settings.avoidance;
  u[AGENT_COUNT] = input.agentCount;
  u[SEED] = input.seed;
  u[COLLISIONS] = settings.collisions ? 1 : 0;
  u[SPECIES_COUNT] = Math.max(1, species.length);
  f.set(colors.background, COLOR_BACKGROUND);
  f.set(colors.peak, COLOR_PEAK);

  species.forEach((s, i) => {
    const o = SPECIES + i * SPECIES_STRIDE;
    f[o] = s.sensorAngle * DEG_TO_RAD;
    f[o + 1] = s.rotationAngle * DEG_TO_RAD;
    f[o + 2] = s.sensorOffset;
    f[o + 3] = s.stepSize;
    f[o + 4] = s.deposit;
    f[o + 5] = s.randomTurn;
    // Display gain, relative to the deposit so changing that doesn't change the exposure.
    f[o + 6] = settings.brightness / Math.max(s.deposit, 1e-6);
    f.set(parseHexColor(s.color, FALLBACK_COLOR), o + SPECIES_COLOR);
  });
}
