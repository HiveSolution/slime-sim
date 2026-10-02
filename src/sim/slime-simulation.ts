import { AGENT_STRIDE, createAgents } from './agents';
import { createFoodMap, FoodMap, paintStroke, Rect, resizeFoodMap } from './food';
import { canvasToGrid, packParams, PARAMS_SIZE, SimColors } from './params';
import { agentCount, GridSize, gridSize, needsReset, SimSettings } from './settings';
import {
  AGENT_WORKGROUP_SIZE,
  AGENTS_SHADER,
  DEPOSIT_SHADER,
  DIFFUSE_SHADER,
  DISPLAY_SHADER,
} from './shaders';

/** Thrown by `SlimeSimulation.create` when the browser or GPU can't run it. */
export class WebGpuUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebGpuUnavailableError';
  }
}

const TRAIL_FORMAT: GPUTextureFormat = 'rgba16float';
const FOOD_FORMAT: GPUTextureFormat = 'r16float';
const FOOD_SOURCES_FORMAT: GPUTextureFormat = 'r8unorm';
const MAX_WORKGROUPS = 65535;

/** What `reset` builds: everything sized by the grid or the population. */
interface Run {
  grid: GridSize;
  agentCount: number;
  agents: GPUBuffer;
  occupancy: GPUBuffer;
  trails: [GPUTexture, GPUTexture];
  trailViews: [GPUTextureView, GPUTextureView];
  /** The food map; swaps together with the trail map. */
  foods: [GPUTexture, GPUTexture];
  foodViews: [GPUTextureView, GPUTextureView];
  foodSources: GPUTexture;
  /** Indexed by the trail and food textures being read. */
  agentBindGroups: [GPUBindGroup, GPUBindGroup];
  diffuseBindGroups: [GPUBindGroup, GPUBindGroup];
  displayBindGroups: [GPUBindGroup, GPUBindGroup];
  depositBindGroup: GPUBindGroup;
  /** Index of the trail and food textures holding the current state. */
  current: 0 | 1;
}

/**
 * The slime mould simulation on WebGPU. Framework-free: it only needs a
 * canvas, and the caller drives it with `frame()` from its own loop.
 */
export class SlimeSimulation {
  /** Called when the GPU device is lost for any reason other than `destroy()`. */
  onDeviceLost: ((message: string) => void) | null = null;

  private readonly context: GPUCanvasContext;
  private readonly paramsBuffer: GPUBuffer;
  private readonly paramsData = new ArrayBuffer(PARAMS_SIZE);
  private readonly sampler: GPUSampler;
  private readonly agentsPipeline: GPUComputePipeline;
  private readonly diffusePipeline: GPURenderPipeline;
  private readonly depositPipeline: GPURenderPipeline;
  private readonly displayPipeline: GPURenderPipeline;

  private run!: Run;
  /** The painted food sources. Kept across restarts, unlike the rest of a run. */
  private foodMap: FoodMap | null = null;
  private stepIndex = 0;
  private destroyed = false;

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly device: GPUDevice,
    private settings: SimSettings,
    private colors: SimColors,
  ) {
    const context = canvas.getContext('webgpu');
    if (!context) {
      throw new WebGpuUnavailableError('Could not get a WebGPU context for the canvas.');
    }
    this.context = context;
    const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format: canvasFormat, alphaMode: 'opaque' });

    this.paramsBuffer = device.createBuffer({
      label: 'params',
      size: PARAMS_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.sampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'repeat',
      addressModeV: 'repeat',
    });

    this.agentsPipeline = device.createComputePipeline({
      label: 'agents',
      layout: 'auto',
      compute: { module: device.createShaderModule({ label: 'agents', code: AGENTS_SHADER }) },
    });

    const diffuseModule = device.createShaderModule({ label: 'diffuse', code: DIFFUSE_SHADER });
    this.diffusePipeline = device.createRenderPipeline({
      label: 'diffuse',
      layout: 'auto',
      vertex: { module: diffuseModule },
      fragment: {
        module: diffuseModule,
        targets: [{ format: TRAIL_FORMAT }, { format: FOOD_FORMAT }],
      },
    });

    const depositModule = device.createShaderModule({ label: 'deposit', code: DEPOSIT_SHADER });
    const additive: GPUBlendComponent = { operation: 'add', srcFactor: 'one', dstFactor: 'one' };
    this.depositPipeline = device.createRenderPipeline({
      label: 'deposit',
      layout: 'auto',
      vertex: { module: depositModule },
      fragment: {
        module: depositModule,
        targets: [
          { format: TRAIL_FORMAT, blend: { color: additive, alpha: additive } },
          // Shares the render pass with the diffuse step, but leaves the food map alone.
          { format: FOOD_FORMAT, writeMask: 0 },
        ],
      },
      primitive: { topology: 'point-list' },
    });

    const displayModule = device.createShaderModule({ label: 'display', code: DISPLAY_SHADER });
    this.displayPipeline = device.createRenderPipeline({
      label: 'display',
      layout: 'auto',
      vertex: { module: displayModule },
      fragment: { module: displayModule, targets: [{ format: canvasFormat }] },
    });

    device.lost.then((info) => {
      if (!this.destroyed) {
        this.onDeviceLost?.(info.message || 'The GPU device was lost.');
      }
    });
  }

  /**
   * Sets up WebGPU on the canvas and starts a run. The canvas must already
   * have its pixel size, because the grid takes its aspect ratio from it.
   */
  static async create(
    canvas: HTMLCanvasElement,
    settings: SimSettings,
    colors: SimColors,
  ): Promise<SlimeSimulation> {
    if (!('gpu' in navigator) || !navigator.gpu) {
      throw new WebGpuUnavailableError('This browser does not support WebGPU.');
    }
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) {
      throw new WebGpuUnavailableError('No suitable GPU adapter was found.');
    }
    const device = await adapter.requestDevice();

    device.pushErrorScope('validation');
    const simulation = new SlimeSimulation(canvas, device, { ...settings }, colors);
    simulation.reset();
    simulation.render();
    const error = await device.popErrorScope();
    if (error) {
      simulation.destroy();
      throw new Error(`WebGPU setup failed: ${error.message}`);
    }
    return simulation;
  }

  get grid(): GridSize {
    return this.run.grid;
  }

  get agentCount(): number {
    return this.run.agentCount;
  }

  /** Applies new settings; restarts the run if one of RESET_KEYS changed. */
  setSettings(settings: SimSettings): void {
    const reset = needsReset(this.settings, settings);
    this.settings = { ...settings };
    if (reset) {
      this.reset();
    }
  }

  setColors(colors: SimColors): void {
    this.colors = colors;
  }

  /** Starts a fresh run: new agents and an empty trail map, sized to the canvas. */
  reset(): void {
    const { device, settings } = this;
    const previousGrid = this.run?.grid;
    this.destroyRun();

    const limits = device.limits;
    const grid = gridSize(
      settings.gridHeight,
      this.canvas.width / this.canvas.height,
      limits.maxTextureDimension2D,
    );
    const bytesPerAgent = AGENT_STRIDE * Float32Array.BYTES_PER_ELEMENT;
    const count = Math.min(
      agentCount(grid, settings.population),
      Math.floor(
        Math.min(limits.maxStorageBufferBindingSize, limits.maxBufferSize) / bytesPerAgent,
      ),
      MAX_WORKGROUPS * AGENT_WORKGROUP_SIZE,
    );

    const agents = device.createBuffer({
      label: 'agents',
      size: count * bytesPerAgent,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const occupancy = device.createBuffer({
      label: 'occupancy',
      size: grid.width * grid.height * Uint32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const initial = createAgents(count, grid, settings.spawnMode, settings.collisions);
    device.queue.writeBuffer(agents, 0, initial.agents);
    device.queue.writeBuffer(occupancy, 0, initial.occupancy);

    const createMap = (label: string, format: GPUTextureFormat) =>
      device.createTexture({
        label,
        size: [grid.width, grid.height],
        format,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
    const trails: Run['trails'] = [
      createMap('trail 0', TRAIL_FORMAT),
      createMap('trail 1', TRAIL_FORMAT),
    ];
    const trailViews: Run['trailViews'] = [trails[0].createView(), trails[1].createView()];
    const foods: Run['foods'] = [
      createMap('food 0', FOOD_FORMAT),
      createMap('food 1', FOOD_FORMAT),
    ];
    const foodViews: Run['foodViews'] = [foods[0].createView(), foods[1].createView()];

    if (!this.foodMap || !previousGrid) {
      this.foodMap = createFoodMap(grid);
    } else if (previousGrid.width !== grid.width || previousGrid.height !== grid.height) {
      this.foodMap = resizeFoodMap(this.foodMap, previousGrid, grid);
    }
    const foodSources = device.createTexture({
      label: 'food sources',
      size: [grid.width, grid.height],
      format: FOOD_SOURCES_FORMAT,
      usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
    });
    const foodSourcesView = foodSources.createView();
    const params = { buffer: this.paramsBuffer };

    const perSource = (create: (index: 0 | 1) => GPUBindGroup): [GPUBindGroup, GPUBindGroup] => [
      create(0),
      create(1),
    ];

    this.run = {
      grid,
      agentCount: count,
      agents,
      occupancy,
      trails,
      trailViews,
      foods,
      foodViews,
      foodSources,
      agentBindGroups: perSource((source) =>
        device.createBindGroup({
          layout: this.agentsPipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: params },
            { binding: 1, resource: { buffer: agents } },
            { binding: 2, resource: trailViews[source] },
            { binding: 3, resource: { buffer: occupancy } },
            { binding: 4, resource: foodViews[source] },
          ],
        }),
      ),
      diffuseBindGroups: perSource((source) =>
        device.createBindGroup({
          layout: this.diffusePipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: params },
            { binding: 1, resource: trailViews[source] },
            { binding: 2, resource: foodViews[source] },
            { binding: 3, resource: foodSourcesView },
          ],
        }),
      ),
      displayBindGroups: perSource((source) =>
        device.createBindGroup({
          layout: this.displayPipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: params },
            { binding: 1, resource: trailViews[source] },
            { binding: 2, resource: this.sampler },
            { binding: 3, resource: foodSourcesView },
          ],
        }),
      ),
      depositBindGroup: device.createBindGroup({
        layout: this.depositPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: params },
          { binding: 1, resource: { buffer: agents } },
        ],
      }),
      current: 0,
    };
    this.stepIndex = 0;
    this.uploadFoodSources();
  }

  /**
   * Paints food sources (or erases them) along a line across the canvas.
   * The points are 0..1 from the canvas' top left; the radius is in cells.
   */
  paintFood(
    from: { u: number; v: number },
    to: { u: number; v: number },
    radius: number,
    erase = false,
  ): void {
    const { grid } = this.run;
    const aspect = this.canvas.width / this.canvas.height;
    const changed = paintStroke(
      this.foodMap!,
      grid,
      canvasToGrid(from.u, from.v, grid, aspect),
      canvasToGrid(to.u, to.v, grid, aspect),
      radius,
      erase,
    );
    if (changed) {
      this.uploadFoodSources(changed);
    }
  }

  /** Takes away every food source. What they left in the food map decays on its own. */
  clearFood(): void {
    this.foodMap!.fill(0);
    this.uploadFoodSources();
  }

  /** Copies the food sources, or one block of them, to the GPU. */
  private uploadFoodSources(block?: Rect): void {
    const { grid, foodSources } = this.run;
    const { x, y, width, height } = block ?? { x: 0, y: 0, ...grid };
    this.device.queue.writeTexture(
      { texture: foodSources, origin: [x, y] },
      this.foodMap!,
      { offset: y * grid.width + x, bytesPerRow: grid.width },
      [width, height],
    );
  }

  /** Advances the simulation by `count` scheduler steps. */
  step(count = 1): void {
    const { device, run } = this;
    for (let i = 0; i < count; i++) {
      // Each step is its own submit, so it sees its own random seed.
      this.writeParams();
      const source = run.current;
      const target = source === 0 ? 1 : 0;
      const encoder = device.createCommandEncoder();

      const agentsPass = encoder.beginComputePass();
      agentsPass.setPipeline(this.agentsPipeline);
      agentsPass.setBindGroup(0, run.agentBindGroups[source]);
      agentsPass.dispatchWorkgroups(Math.ceil(run.agentCount / AGENT_WORKGROUP_SIZE));
      agentsPass.end();

      const trailPass = encoder.beginRenderPass({
        colorAttachments: [
          { view: run.trailViews[target], loadOp: 'clear', storeOp: 'store' },
          { view: run.foodViews[target], loadOp: 'clear', storeOp: 'store' },
        ],
      });
      trailPass.setPipeline(this.diffusePipeline);
      trailPass.setBindGroup(0, run.diffuseBindGroups[source]);
      trailPass.draw(3);
      trailPass.setPipeline(this.depositPipeline);
      trailPass.setBindGroup(0, run.depositBindGroup);
      trailPass.draw(run.agentCount);
      trailPass.end();

      device.queue.submit([encoder.finish()]);
      run.current = target;
      this.stepIndex++;
    }
  }

  /** Draws the current trail map to the canvas. */
  render(): void {
    this.writeParams();
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        { view: this.context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store' },
      ],
    });
    pass.setPipeline(this.displayPipeline);
    pass.setBindGroup(0, this.run.displayBindGroups[this.run.current]);
    pass.draw(3);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  /** One animation frame: `stepsPerFrame` steps when running, then a render. */
  frame(running: boolean): void {
    if (running) {
      this.step(this.settings.stepsPerFrame);
    }
    this.render();
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.destroyRun();
    this.paramsBuffer.destroy();
    this.context.unconfigure();
    this.device.destroy();
  }

  private destroyRun(): void {
    if (!this.run) {
      return;
    }
    this.run.agents.destroy();
    this.run.occupancy.destroy();
    this.run.trails[0].destroy();
    this.run.trails[1].destroy();
    this.run.foods[0].destroy();
    this.run.foods[1].destroy();
    this.run.foodSources.destroy();
  }

  private writeParams(): void {
    packParams(this.paramsData, {
      settings: this.settings,
      colors: this.colors,
      grid: this.run.grid,
      canvasAspect: this.canvas.width / this.canvas.height,
      agentCount: this.run.agentCount,
      seed: this.stepIndex,
    });
    this.device.queue.writeBuffer(this.paramsBuffer, 0, this.paramsData);
  }
}
