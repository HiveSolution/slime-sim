import { AGENT_STRIDE, createAgents } from './agents';
import { agentCount, GridSize, gridSize, needsReset, SimSettings } from './settings';
import {
  AGENT_WORKGROUP_SIZE,
  AGENTS_SHADER,
  DEPOSIT_SHADER,
  DIFFUSE_SHADER,
  DISPLAY_SHADER,
  PARAMS_SIZE,
} from './shaders';

export type Rgb = readonly [number, number, number];

/** Colours of the rendered trail map, as 0..1 sRGB components. */
export interface SimColors {
  background: Rgb;
  trail: Rgb;
  peak: Rgb;
}

/** Thrown by `SlimeSimulation.create` when the browser or GPU can't run it. */
export class WebGpuUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebGpuUnavailableError';
  }
}

const TRAIL_FORMAT: GPUTextureFormat = 'rgba16float';
const DEG_TO_RAD = Math.PI / 180;
const MAX_WORKGROUPS = 65535;

/** What `reset` builds: everything sized by the grid or the population. */
interface Run {
  grid: GridSize;
  agentCount: number;
  agents: GPUBuffer;
  occupancy: GPUBuffer;
  trails: [GPUTexture, GPUTexture];
  trailViews: [GPUTextureView, GPUTextureView];
  /** Indexed by the trail texture being read. */
  agentBindGroups: [GPUBindGroup, GPUBindGroup];
  diffuseBindGroups: [GPUBindGroup, GPUBindGroup];
  displayBindGroups: [GPUBindGroup, GPUBindGroup];
  depositBindGroup: GPUBindGroup;
  /** Index of the trail texture holding the current state. */
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
  private readonly paramsFloats = new Float32Array(this.paramsData);
  private readonly paramsUints = new Uint32Array(this.paramsData);
  private readonly sampler: GPUSampler;
  private readonly agentsPipeline: GPUComputePipeline;
  private readonly diffusePipeline: GPURenderPipeline;
  private readonly depositPipeline: GPURenderPipeline;
  private readonly displayPipeline: GPURenderPipeline;

  private run!: Run;
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
      fragment: { module: diffuseModule, targets: [{ format: TRAIL_FORMAT }] },
    });

    const depositModule = device.createShaderModule({ label: 'deposit', code: DEPOSIT_SHADER });
    const additive: GPUBlendComponent = { operation: 'add', srcFactor: 'one', dstFactor: 'one' };
    this.depositPipeline = device.createRenderPipeline({
      label: 'deposit',
      layout: 'auto',
      vertex: { module: depositModule },
      fragment: {
        module: depositModule,
        targets: [{ format: TRAIL_FORMAT, blend: { color: additive, alpha: additive } }],
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

    const createTrail = (label: string) =>
      device.createTexture({
        label,
        size: [grid.width, grid.height],
        format: TRAIL_FORMAT,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
    const trails: Run['trails'] = [createTrail('trail 0'), createTrail('trail 1')];
    const trailViews: Run['trailViews'] = [trails[0].createView(), trails[1].createView()];
    const params = { buffer: this.paramsBuffer };

    const perTrail = (
      create: (view: GPUTextureView) => GPUBindGroup,
    ): [GPUBindGroup, GPUBindGroup] => [create(trailViews[0]), create(trailViews[1])];

    this.run = {
      grid,
      agentCount: count,
      agents,
      occupancy,
      trails,
      trailViews,
      agentBindGroups: perTrail((view) =>
        device.createBindGroup({
          layout: this.agentsPipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: params },
            { binding: 1, resource: { buffer: agents } },
            { binding: 2, resource: view },
            { binding: 3, resource: { buffer: occupancy } },
          ],
        }),
      ),
      diffuseBindGroups: perTrail((view) =>
        device.createBindGroup({
          layout: this.diffusePipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: params },
            { binding: 1, resource: view },
          ],
        }),
      ),
      displayBindGroups: perTrail((view) =>
        device.createBindGroup({
          layout: this.displayPipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: params },
            { binding: 1, resource: view },
            { binding: 2, resource: this.sampler },
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
        colorAttachments: [{ view: run.trailViews[target], loadOp: 'clear', storeOp: 'store' }],
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
  }

  /** Layout must match the `Params` struct in shaders.ts. */
  private writeParams(): void {
    const { settings, colors, run } = this;
    const f = this.paramsFloats;
    const u = this.paramsUints;

    // The grid keeps its aspect ratio and covers the canvas.
    const canvasAspect = this.canvas.width / this.canvas.height || 1;
    const gridAspect = run.grid.width / run.grid.height;

    f[0] = run.grid.width;
    f[1] = run.grid.height;
    f[2] = canvasAspect > gridAspect ? 1 : canvasAspect / gridAspect;
    f[3] = canvasAspect > gridAspect ? gridAspect / canvasAspect : 1;
    f[4] = settings.sensorAngle * DEG_TO_RAD;
    f[5] = settings.rotationAngle * DEG_TO_RAD;
    f[6] = settings.sensorOffset;
    f[7] = settings.stepSize;
    f[8] = settings.deposit;
    f[9] = settings.decay;
    f[10] = settings.randomTurn;
    // Relative to the deposit, so changing it doesn't change the exposure.
    f[11] = settings.brightness / Math.max(settings.deposit, 1e-6);
    u[12] = run.agentCount;
    u[13] = this.stepIndex;
    u[14] = settings.collisions ? 1 : 0;
    f.set(colors.background, 16);
    f.set(colors.trail, 20);
    f.set(colors.peak, 24);

    this.device.queue.writeBuffer(this.paramsBuffer, 0, this.paramsData);
  }
}
