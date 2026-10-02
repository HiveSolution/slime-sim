import { MAX_SPECIES } from './settings';

/**
 * WGSL for the simulation, written from the algorithm in Jones (2010).
 *
 * One step of the paper's scheduler is: motor stage (move, deposit), sensory
 * stage (sample, rotate), then diffusion of the trail map. Moving does not
 * read the trail and diffusion does not read the agents, so the same cycle
 * runs here as three passes: agents (sense, rotate, move), diffuse, deposit.
 *
 * The paper moves agents one at a time in random order, and a move into an
 * occupied cell fails. Here all agents move at once and claim their target
 * cell atomically, so which of two competing agents wins is up to the GPU.
 *
 * Species are not in the paper. Each one deposits into its own channel of
 * the trail map, and an agent senses its own channel minus the others.
 */

/** Uniforms shared by every pass. Keep in sync with `packParams` in params.ts. */
const PARAMS = /* wgsl */ `
struct Species {
  sensorAngle: f32,
  rotationAngle: f32,
  sensorOffset: f32,
  stepSize: f32,
  deposit: f32,
  randomTurn: f32,
  gain: f32,
  color: vec4f,
}

struct Params {
  size: vec2f,
  viewScale: vec2f,
  decay: f32,
  avoidance: f32,
  agentCount: u32,
  seed: u32,
  collisions: u32,
  speciesCount: u32,
  colorBackground: vec4f,
  colorPeak: vec4f,
  species: array<Species, ${MAX_SPECIES}>,
}

// Agents are dealt out to the species in turn, so each has an equal share.
fn speciesOf(agentIndex: u32) -> u32 {
  return agentIndex % params.speciesCount;
}
`;

/** Covers the target with one triangle; `uv` runs 0..1 with v pointing down. */
const FULLSCREEN_VERTEX = /* wgsl */ `
struct FullscreenOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn fullscreen(@builtin(vertex_index) index: u32) -> FullscreenOut {
  let corner = vec2f(f32((index << 1u) & 2u), f32(index & 2u));
  var out: FullscreenOut;
  out.position = vec4f(corner * 2.0 - 1.0, 0.0, 1.0);
  out.uv = vec2f(corner.x, 1.0 - corner.y);
  return out;
}
`;

export const AGENT_WORKGROUP_SIZE = 64;

/** Sensory stage followed by the move of the next motor stage. */
export const AGENTS_SHADER = /* wgsl */ `
${PARAMS}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read_write> agents: array<vec4f>;
@group(0) @binding(2) var trail: texture_2d<f32>;
@group(0) @binding(3) var<storage, read_write> occupancy: array<atomic<u32>>;

const TAU = 6.283185307179586;

// PCG hash, https://www.pcg-random.org
fn pcg(value: u32) -> u32 {
  let state = value * 747796405u + 2891336453u;
  let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}

fn unitFloat(value: u32) -> f32 {
  return f32(value >> 8u) / 16777216.0;
}

// What the sensor at the given distance and direction reads: the trail
// channels, weighted. The boundary is periodic.
fn sense(position: vec2f, heading: f32, distance: f32, weights: vec4f) -> f32 {
  let size = vec2i(params.size);
  let sensor = position + vec2f(cos(heading), sin(heading)) * distance;
  let cell = ((vec2i(floor(sensor)) % size) + size) % size;
  return dot(textureLoad(trail, cell, 0), weights);
}

fn cellIndex(position: vec2f) -> u32 {
  let cell = vec2u(position);
  return cell.y * u32(params.size.x) + cell.x;
}

// Takes the cell if it is free. The weak exchange can fail for no reason, hence the retries.
fn claim(cell: u32) -> bool {
  for (var attempt = 0; attempt < 4; attempt++) {
    let result = atomicCompareExchangeWeak(&occupancy[cell], 0u, 1u);
    if (result.exchanged) {
      return true;
    }
    if (result.old_value != 0u) {
      return false;
    }
  }
  return false;
}

@compute @workgroup_size(${AGENT_WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) id: vec3u) {
  let index = id.x;
  if (index >= params.agentCount) {
    return;
  }

  let agent = agents[index];
  var position = agent.xy;
  var heading = agent.z;

  let speciesIndex = speciesOf(index);
  let species = params.species[speciesIndex];
  // Attracted to its own trail, repelled by the others.
  var weights = vec4f(-params.avoidance);
  weights[speciesIndex] = 1.0;

  var random = pcg(index ^ pcg(params.seed));

  let front = sense(position, heading, species.sensorOffset, weights);
  let left = sense(position, heading + species.sensorAngle, species.sensorOffset, weights);
  let right = sense(position, heading - species.sensorAngle, species.sensorOffset, weights);

  if (front > left && front > right) {
    // Strongest ahead: keep the heading.
  } else if (front < left && front < right) {
    // Stronger on both sides: rotate left or right at random.
    random = pcg(random);
    heading += select(-species.rotationAngle, species.rotationAngle, unitFloat(random) < 0.5);
  } else if (left < right) {
    heading -= species.rotationAngle;
  } else if (right < left) {
    heading += species.rotationAngle;
  }

  random = pcg(random);
  if (unitFloat(random) < species.randomTurn) {
    random = pcg(random);
    heading = unitFloat(random) * TAU;
  }
  heading -= floor(heading / TAU) * TAU;

  var destination = position + vec2f(cos(heading), sin(heading)) * species.stepSize;
  destination -= floor(destination / params.size) * params.size;
  // A float just below the edge can round up to it.
  destination = min(destination, params.size - 0.01);

  var moved = true;
  if (params.collisions == 1u) {
    let oldCell = cellIndex(position);
    let newCell = cellIndex(destination);
    if (newCell != oldCell) {
      moved = claim(newCell);
      if (moved) {
        atomicStore(&occupancy[oldCell], 0u);
      }
    }
  }

  if (moved) {
    position = destination;
  } else {
    // A blocked agent stays put, deposits nothing and picks a new heading.
    random = pcg(random);
    heading = unitFloat(random) * TAU;
  }

  agents[index] = vec4f(position, heading, f32(moved));
}
`;

/** 3x3 mean filter, then decay. */
export const DIFFUSE_SHADER = /* wgsl */ `
${PARAMS}
${FULLSCREEN_VERTEX}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var trail: texture_2d<f32>;

@fragment
fn main(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let size = vec2i(params.size);
  let cell = vec2i(position.xy);
  var sum = vec4f(0.0);
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      sum += textureLoad(trail, (cell + vec2i(dx, dy) + size) % size, 0);
    }
  }
  return sum / 9.0 * (1.0 - params.decay);
}
`;

/** Draws every agent that moved as one additive point on its cell, in its species' channel. */
export const DEPOSIT_SHADER = /* wgsl */ `
${PARAMS}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> agents: array<vec4f>;

struct DepositOut {
  @builtin(position) position: vec4f,
  @location(0) @interpolate(flat) amount: vec4f,
}

@vertex
fn vertex(@builtin(vertex_index) index: u32) -> DepositOut {
  let agent = agents[index];
  let speciesIndex = speciesOf(index);
  var out: DepositOut;
  out.amount = vec4f(0.0);
  out.amount[speciesIndex] = params.species[speciesIndex].deposit;
  if (agent.w < 0.5) {
    // Outside the clip volume, so nothing is drawn.
    out.position = vec4f(2.0, 2.0, 0.0, 1.0);
    return out;
  }
  let cell = floor(agent.xy) + 0.5;
  let clip = cell / params.size * 2.0 - 1.0;
  out.position = vec4f(clip.x, -clip.y, 0.0, 1.0);
  return out;
}

@fragment
fn fragment(in: DepositOut) -> @location(0) vec4f {
  return in.amount;
}
`;

/** Maps the trail map to colours on the canvas. */
export const DISPLAY_SHADER = /* wgsl */ `
${PARAMS}
${FULLSCREEN_VERTEX}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var trail: texture_2d<f32>;
@group(0) @binding(2) var trailSampler: sampler;

@fragment
fn main(in: FullscreenOut) -> @location(0) vec4f {
  // The grid keeps its aspect ratio and covers the canvas.
  let uv = (in.uv - 0.5) * params.viewScale + 0.5;
  let levels = textureSampleLevel(trail, trailSampler, uv, 0.0);
  let background = params.colorBackground.rgb;

  // Each species adds its own ramp: background, its colour, then the peak colour.
  var color = background;
  for (var i = 0u; i < params.speciesCount; i++) {
    let species = params.species[i];
    let t = 1.0 - exp(-levels[i] * species.gain);
    let low = mix(background, species.color.rgb, smoothstep(0.0, 0.6, t));
    color += mix(low, params.colorPeak.rgb, smoothstep(0.6, 1.0, t)) - background;
  }
  return vec4f(clamp(color, vec3f(0.0), vec3f(1.0)), 1.0);
}
`;
