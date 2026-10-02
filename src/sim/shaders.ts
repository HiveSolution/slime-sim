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
 *
 * Food is the paper's pre-pattern stimulus. The paper projects it onto the
 * trail map; here it has a map of its own that diffuses and decays the same
 * way and that every species is drawn to. With one species the two are the
 * same thing, because diffusion is linear.
 *
 * Eating food is not in the paper. A food source cell holds an amount from 0
 * to 1 and gives off attractant in proportion to it. An agent that moves
 * onto the cell takes a fixed bite out of it.
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
  // 1 when drawn to its own trail, -1 when repelled by it.
  ownTrail: f32,
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
  // 1 when the edges wrap around, 0 when they are walls.
  wrap: u32,
  foodStrength: f32,
  // How much of a food cell one agent eats per step on it.
  foodConsumption: f32,
  colorBackground: vec4f,
  colorPeak: vec4f,
  species: array<Species, ${MAX_SPECIES}>,
}

// Agents are dealt out to the species in turn, so each has an equal share.
fn speciesOf(agentIndex: u32) -> u32 {
  return agentIndex % params.speciesCount;
}

fn insideGrid(cell: vec2i) -> bool {
  let size = vec2i(params.size);
  return cell.x >= 0 && cell.y >= 0 && cell.x < size.x && cell.y < size.y;
}

// The cell on the other side when the edges wrap. Good for up to one grid size outside.
fn wrapCell(cell: vec2i) -> vec2i {
  let size = vec2i(params.size);
  return ((cell % size) + size) % size;
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
@group(0) @binding(4) var food: texture_2d<f32>;
@group(0) @binding(5) var foodSources: texture_2d<f32>;

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
// channels, weighted, plus the food. Beyond a wall there is nothing.
fn sense(position: vec2f, heading: f32, distance: f32, weights: vec4f) -> f32 {
  let sensor = position + vec2f(cos(heading), sin(heading)) * distance;
  var cell = vec2i(floor(sensor));
  if (params.wrap == 1u) {
    cell = wrapCell(cell);
  } else if (!insideGrid(cell)) {
    return 0.0;
  }
  return dot(textureLoad(trail, cell, 0), weights) + textureLoad(food, cell, 0).r;
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
  // Drawn to (or repelled by) its own trail, repelled by the others.
  var weights = vec4f(-params.avoidance);
  weights[speciesIndex] = species.ownTrail;

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
  var moved = true;
  if (params.wrap == 1u) {
    destination -= floor(destination / params.size) * params.size;
    // A float just below the edge can round up to it.
    destination = min(destination, params.size - 0.01);
  } else if (!insideGrid(vec2i(floor(destination)))) {
    // A wall blocks the move like an occupied cell does.
    moved = false;
  }

  if (moved && params.collisions == 1u) {
    let oldCell = cellIndex(position);
    let newCell = cellIndex(destination);
    if (newCell != oldCell) {
      moved = claim(newCell);
      if (moved) {
        atomicStore(&occupancy[oldCell], 0u);
      }
    }
  }

  // What the deposit pass does for this agent: 0 nothing, 1 deposit trail, 2 also eat.
  var action = 0.0;
  if (moved) {
    position = destination;
    action = 1.0;
    if (textureLoad(foodSources, vec2i(position), 0).r > 0.0) {
      action = 2.0;
    }
  } else {
    // A blocked agent stays put, deposits nothing and picks a new heading.
    random = pcg(random);
    heading = unitFloat(random) * TAU;
  }

  agents[index] = vec4f(position, heading, action);
}
`;

/**
 * 3x3 mean filter, then decay, for the trail map and the food map. The food
 * sources then add to the food map.
 */
export const DIFFUSE_SHADER = /* wgsl */ `
${PARAMS}
${FULLSCREEN_VERTEX}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var trail: texture_2d<f32>;
@group(0) @binding(2) var food: texture_2d<f32>;
@group(0) @binding(3) var foodSources: texture_2d<f32>;

struct DiffuseOut {
  @location(0) trail: vec4f,
  @location(1) food: vec4f,
}

@fragment
fn main(@builtin(position) position: vec4f) -> DiffuseOut {
  let cell = vec2i(position.xy);
  var trailSum = vec4f(0.0);
  var foodSum = 0.0;
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      var neighbour = cell + vec2i(dx, dy);
      if (params.wrap == 1u) {
        neighbour = wrapCell(neighbour);
      } else if (!insideGrid(neighbour)) {
        // Nothing beyond a wall, so what diffuses into it is lost.
        continue;
      }
      trailSum += textureLoad(trail, neighbour, 0);
      foodSum += textureLoad(food, neighbour, 0).r;
    }
  }
  let keep = (1.0 - params.decay) / 9.0;
  // The last bite can take a source slightly below zero.
  let source = clamp(textureLoad(foodSources, cell, 0).r, 0.0, 1.0);

  var out: DiffuseOut;
  out.trail = trailSum * keep;
  out.food = vec4f(foodSum * keep + source * params.foodStrength, 0.0, 0.0, 1.0);
  return out;
}
`;

/**
 * Draws every agent that moved as one point on its cell. The point adds to
 * the trail map in its species' channel, and takes a bite out of the food
 * source if the agent is on one.
 */
export const DEPOSIT_SHADER = /* wgsl */ `
${PARAMS}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> agents: array<vec4f>;

struct DepositOut {
  @builtin(position) position: vec4f,
  @location(0) @interpolate(flat) amount: vec4f,
  @location(1) @interpolate(flat) eaten: f32,
}

struct DepositTargets {
  @location(0) trail: vec4f,
  // Blended as "what is there minus this".
  @location(1) eaten: vec4f,
}

@vertex
fn vertex(@builtin(vertex_index) index: u32) -> DepositOut {
  let agent = agents[index];
  let speciesIndex = speciesOf(index);
  var out: DepositOut;
  out.amount = vec4f(0.0);
  out.amount[speciesIndex] = params.species[speciesIndex].deposit;
  out.eaten = select(0.0, params.foodConsumption, agent.w > 1.5);
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
fn fragment(in: DepositOut) -> DepositTargets {
  var out: DepositTargets;
  out.trail = in.amount;
  out.eaten = vec4f(in.eaten, 0.0, 0.0, 0.0);
  return out;
}
`;

/** Maps the trail map to colours on the canvas and marks the food sources. */
export const DISPLAY_SHADER = /* wgsl */ `
${PARAMS}
${FULLSCREEN_VERTEX}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var trail: texture_2d<f32>;
@group(0) @binding(2) var trailSampler: sampler;
@group(0) @binding(3) var foodSources: texture_2d<f32>;

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
  color = clamp(color, vec3f(0.0), vec3f(1.0));

  // Food fades as it is eaten.
  let source = clamp(textureSampleLevel(foodSources, trailSampler, uv, 0.0).r, 0.0, 1.0);
  color = mix(color, params.colorPeak.rgb, smoothstep(0.0, 1.0, source));
  return vec4f(color, 1.0);
}
`;

/**
 * Sets the food sources within the brush's radius of the stroke, in both the
 * painted food and what remains of it. Keep `Brush` in sync with
 * `packBrush` in food.ts.
 */
export const PAINT_SHADER = /* wgsl */ `
${FULLSCREEN_VERTEX}

struct Brush {
  // The stroke runs from pointA to pointB, in grid coordinates.
  pointA: vec2f,
  pointB: vec2f,
  radius: f32,
  // What a covered cell is set to: 1 to paint, 0 to erase.
  amount: f32,
}

@group(0) @binding(0) var<uniform> brush: Brush;

struct PaintOut {
  @location(0) painted: vec4f,
  @location(1) remaining: vec4f,
}

@fragment
fn main(@builtin(position) position: vec4f) -> PaintOut {
  // Distance from the cell centre to the nearest point of the stroke.
  let cell = position.xy - brush.pointA;
  let stroke = brush.pointB - brush.pointA;
  let lengthSquared = dot(stroke, stroke);
  var along = 0.0;
  if (lengthSquared > 0.0) {
    along = clamp(dot(cell, stroke) / lengthSquared, 0.0, 1.0);
  }
  let away = cell - along * stroke;
  if (dot(away, away) > brush.radius * brush.radius) {
    discard;
  }

  var out: PaintOut;
  out.painted = vec4f(brush.amount, 0.0, 0.0, 1.0);
  out.remaining = out.painted;
  return out;
}
`;

/** Stretches the painted food onto a grid of another size. */
export const RESIZE_SHADER = /* wgsl */ `
${FULLSCREEN_VERTEX}

@group(0) @binding(0) var painted: texture_2d<f32>;
@group(0) @binding(1) var paintedSampler: sampler;

@fragment
fn main(in: FullscreenOut) -> @location(0) vec4f {
  return textureSampleLevel(painted, paintedSampler, in.uv, 0.0);
}
`;
