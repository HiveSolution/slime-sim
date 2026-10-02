import { AGENT_STRIDE, createAgents } from './agents';
import { parseHexColor } from './colors';
import { packParams, PARAMS_SIZE } from './params';
import {
  addSpecies,
  agentCount,
  applyPreset,
  DEFAULT_SETTINGS,
  DEFAULT_SPECIES,
  gridSize,
  matchesPreset,
  MAX_SPECIES,
  needsReset,
  PRESETS,
  removeSpecies,
  SimSettings,
  SPECIES_COLORS,
} from './settings';

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
    expect(needsReset(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, decay: 0.2 })).toBe(false);
    expect(needsReset(DEFAULT_SETTINGS, addSpecies(DEFAULT_SETTINGS, 0))).toBe(false);
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

describe('species', () => {
  it('adds a copy of the chosen species in the next free colour', () => {
    const tuned = { ...DEFAULT_SPECIES, sensorOffset: 20 };
    const two = addSpecies({ ...DEFAULT_SETTINGS, species: [tuned] }, 0);
    expect(two.species).toEqual([tuned, { ...tuned, color: SPECIES_COLORS[1] }]);

    const recoloured: SimSettings = {
      ...two,
      species: [two.species[0], { ...two.species[1], color: SPECIES_COLORS[0].toUpperCase() }],
    };
    expect(addSpecies(recoloured, 1).species[2].color).toBe(SPECIES_COLORS[1]);
  });

  it('stops at the maximum and never removes the last one', () => {
    let settings = DEFAULT_SETTINGS;
    for (let i = 0; i < MAX_SPECIES + 2; i++) {
      settings = addSpecies(settings, 0);
    }
    expect(settings.species.length).toBe(MAX_SPECIES);
    expect(new Set(settings.species.map((species) => species.color)).size).toBe(MAX_SPECIES);

    expect(removeSpecies(settings, 1).species).toEqual([
      settings.species[0],
      settings.species[2],
      settings.species[3],
    ]);
    expect(removeSpecies(DEFAULT_SETTINGS, 0)).toBe(DEFAULT_SETTINGS);
  });
});

describe('presets', () => {
  it('apply to every species and keep their colours', () => {
    const two = addSpecies(DEFAULT_SETTINGS, 0);
    const coarse = PRESETS.find((preset) => preset.id === 'coarse')!;
    const applied = applyPreset(two, coarse);
    expect(applied.species.map((species) => species.sensorOffset)).toEqual([25, 25]);
    expect(applied.species.map((species) => species.color)).toEqual(
      two.species.map((species) => species.color),
    );
    expect(matchesPreset(applied, coarse)).toBe(true);
  });

  it('match only when every species matches', () => {
    const dynamic = PRESETS.find((preset) => preset.id === 'dynamic')!;
    expect(matchesPreset(DEFAULT_SETTINGS, dynamic)).toBe(true);
    const two = addSpecies(DEFAULT_SETTINGS, 0);
    const changed = {
      ...two,
      species: [two.species[0], { ...two.species[1], sensorAngle: 90 }],
    };
    expect(matchesPreset(changed, dynamic)).toBe(false);
    expect(matchesPreset({ ...DEFAULT_SETTINGS, population: 40 }, dynamic)).toBe(false);
  });
});

describe('packParams', () => {
  const pack = (settings: SimSettings, canvasAspect = 2) => {
    const data = new ArrayBuffer(PARAMS_SIZE);
    packParams(data, {
      settings,
      colors: { background: [0.1, 0.2, 0.3], peak: [0.7, 0.8, 0.9] },
      grid: { width: 400, height: 200 },
      canvasAspect,
      agentCount: 1234,
      seed: 77,
    });
    return { f: new Float32Array(data), u: new Uint32Array(data) };
  };

  it('is as large as the WGSL struct: 80 bytes plus four 48-byte species', () => {
    expect(PARAMS_SIZE).toBe(80 + 4 * 48);
  });

  it('writes the globals at their WGSL offsets', () => {
    const { f, u } = pack({ ...DEFAULT_SETTINGS, decay: 0.25, avoidance: 1.5, collisions: true });
    expect([f[0], f[1]]).toEqual([400, 200]);
    expect([f[2], f[3]]).toEqual([1, 1]);
    expect(f[4]).toBeCloseTo(0.25);
    expect(f[5]).toBeCloseTo(1.5);
    expect([u[6], u[7], u[8], u[9]]).toEqual([1234, 77, 1, 1]);
    expect(f[12]).toBeCloseTo(0.1); // background at byte 48
    expect(f[16]).toBeCloseTo(0.7); // peak at byte 64
  });

  it('writes each species at byte 80 + 48 * index', () => {
    const settings = addSpecies(
      { ...DEFAULT_SETTINGS, brightness: 2, species: [{ ...DEFAULT_SPECIES, deposit: 4 }] },
      0,
    );
    const { f, u } = pack(settings);
    expect(u[9]).toBe(2);
    for (const base of [20, 32]) {
      expect(f[base]).toBeCloseTo((22.5 * Math.PI) / 180);
      expect(f[base + 1]).toBeCloseTo(Math.PI / 4);
      expect(f[base + 2]).toBe(9);
      expect(f[base + 3]).toBe(1);
      expect(f[base + 4]).toBe(4);
      expect(f[base + 5]).toBe(0);
      expect(f[base + 6]).toBeCloseTo(0.5); // brightness / deposit
    }
    expect(f[20 + 8]).toBeCloseTo(0xd0 / 255); // copper, at the species' byte 32
    expect(f[32 + 8]).toBeCloseTo(0x82 / 255); // teal
  });

  it('crops the grid to cover a canvas of another shape', () => {
    expect(Array.from(pack(DEFAULT_SETTINGS, 4).f.slice(2, 4))).toEqual([1, 0.5]);
    expect(Array.from(pack(DEFAULT_SETTINGS, 1).f.slice(2, 4))).toEqual([0.5, 1]);
    expect(Array.from(pack(DEFAULT_SETTINGS, NaN).f.slice(2, 4))).toEqual([0.5, 1]);
  });
});
