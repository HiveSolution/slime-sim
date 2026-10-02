import { AGENT_STRIDE, createAgents } from './agents';
import { parseHexColor } from './colors';
import { agentCount, DEFAULT_SETTINGS, gridSize, needsReset } from './settings';

/** Deterministic stand-in for Math.random. */
function sequence(): () => number {
  let state = 1;
  return () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  };
}

describe('gridSize', () => {
  it('follows the aspect ratio', () => {
    expect(gridSize(540, 16 / 9)).toEqual({ width: 960, height: 540 });
  });

  it('stays within the texture limit and survives a zero-sized canvas', () => {
    expect(gridSize(1080, 20, 4096)).toEqual({ width: 4096, height: 1080 });
    expect(gridSize(540, NaN)).toEqual({ width: 540, height: 540 });
  });
});

describe('agentCount', () => {
  it('is a percentage of the grid area', () => {
    expect(agentCount({ width: 200, height: 200 }, 15)).toBe(6000);
    expect(agentCount({ width: 200, height: 200 }, 150)).toBe(40000);
  });
});

describe('needsReset', () => {
  it('is true only for settings that size the run', () => {
    expect(needsReset(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, sensorAngle: 45 })).toBe(false);
    expect(needsReset(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, population: 30 })).toBe(true);
    expect(needsReset(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, spawnMode: 'disc' })).toBe(true);
  });
});

describe('createAgents', () => {
  const grid = { width: 300, height: 200 };

  it.each(['random', 'disc', 'ring'] as const)('keeps %s agents inside the grid', (mode) => {
    const { agents } = createAgents(2000, grid, mode, false, sequence());
    expect(agents.length).toBe(2000 * AGENT_STRIDE);
    for (let i = 0; i < agents.length; i += AGENT_STRIDE) {
      expect(agents[i]).toBeGreaterThanOrEqual(0);
      expect(agents[i]).toBeLessThan(grid.width);
      expect(agents[i + 1]).toBeGreaterThanOrEqual(0);
      expect(agents[i + 1]).toBeLessThan(grid.height);
    }
  });

  it.each(['random', 'disc', 'ring'] as const)('gives every %s agent its own cell', (mode) => {
    const count = 30000; // half the grid, far more than the disc or ring hold
    const { agents, occupancy } = createAgents(count, grid, mode, true, sequence());
    const seen = new Set<number>();
    for (let i = 0; i < agents.length; i += AGENT_STRIDE) {
      const cell = Math.floor(agents[i + 1]) * grid.width + Math.floor(agents[i]);
      expect(occupancy[cell]).toBe(1);
      seen.add(cell);
    }
    expect(seen.size).toBe(count);
    expect(occupancy.reduce((sum, value) => sum + value, 0)).toBe(count);
  });

  it('fills the grid completely at 100 % and refuses more', () => {
    const cells = grid.width * grid.height;
    const { occupancy } = createAgents(cells, grid, 'random', true, sequence());
    expect(occupancy.every((value) => value === 1)).toBe(true);
    expect(() => createAgents(cells + 1, grid, 'random', true, sequence())).toThrow(RangeError);
  });

  it('leaves the occupancy map empty without collisions', () => {
    const { occupancy } = createAgents(500, grid, 'random', false, sequence());
    expect(occupancy.some((value) => value !== 0)).toBe(false);
  });

  it('starts ring agents facing the centre', () => {
    const { agents } = createAgents(100, grid, 'ring', false, sequence());
    for (let i = 0; i < agents.length; i += AGENT_STRIDE) {
      const toCentre = [grid.width / 2 - agents[i], grid.height / 2 - agents[i + 1]];
      const facing = [Math.cos(agents[i + 2]), Math.sin(agents[i + 2])];
      expect(toCentre[0] * facing[0] + toCentre[1] * facing[1]).toBeGreaterThan(0);
    }
  });
});

describe('parseHexColor', () => {
  it('parses long and short hex', () => {
    expect(parseHexColor(' #FF0080 ', [0, 0, 0])).toEqual([1, 0, 128 / 255]);
    expect(parseHexColor('#f00', [0, 0, 0])).toEqual([1, 0, 0]);
  });

  it('falls back for anything else', () => {
    expect(parseHexColor('', [0.1, 0.2, 0.3])).toEqual([0.1, 0.2, 0.3]);
    expect(parseHexColor('rgb(1 2 3)', [0.1, 0.2, 0.3])).toEqual([0.1, 0.2, 0.3]);
  });
});
