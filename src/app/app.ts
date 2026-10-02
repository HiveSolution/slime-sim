import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideSlidersHorizontal, lucideTriangleAlert, lucideX } from '@ng-icons/lucide';
import { HlmButton } from '@spartan-ng/helm/button';
import {
  DEFAULT_SETTINGS,
  parseHexColor,
  SimColors,
  SimSettings,
  SlimeSimulation,
  WebGpuUnavailableError,
} from '../sim';
import { Brush, ControlPanel } from './control-panel';

/** A point of the canvas, 0..1 from its top left. */
interface CanvasPoint {
  u: number;
  v: number;
}

type Status = 'loading' | 'ready' | 'unsupported' | 'error';

@Component({
  selector: 'slime-root',
  imports: [ControlPanel, HlmButton, NgIcon],
  viewProviders: [provideIcons({ lucideSlidersHorizontal, lucideTriangleAlert, lucideX })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app.html',
})
export class App {
  protected readonly settings = signal<SimSettings>(DEFAULT_SETTINGS);
  protected readonly running = signal(true);
  protected readonly brush = signal<Brush>({ mode: 'paint', size: 4 });
  protected readonly panelOpen = signal(true);
  protected readonly status = signal<Status>('loading');
  protected readonly errorMessage = signal('');
  /** Bumped whenever a run starts, so `summary` re-reads the grid and agent count. */
  private readonly runVersion = signal(0);

  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly simulation = signal<SlimeSimulation | null>(null);
  private frameHandle = 0;
  /** Where the pointer was last while painting; null when it isn't down. */
  private lastPoint: CanvasPoint | null = null;
  private resizeObserver: ResizeObserver | null = null;

  protected readonly summary = computed(() => {
    const simulation = this.simulation();
    this.runVersion();
    if (!simulation) {
      return '';
    }
    const { width, height } = simulation.grid;
    return `${width} × ${height} cells · ${simulation.agentCount.toLocaleString('en-US')} agents`;
  });

  constructor() {
    afterNextRender(() => void this.start());

    effect(() => {
      const settings = this.settings();
      const simulation = this.simulation();
      if (simulation) {
        simulation.setSettings(settings);
        this.runVersion.update((version) => version + 1);
      }
    });

    inject(DestroyRef).onDestroy(() => {
      cancelAnimationFrame(this.frameHandle);
      this.resizeObserver?.disconnect();
      this.simulation()?.destroy();
    });
  }

  protected step(): void {
    this.simulation()?.step();
  }

  protected restart(): void {
    this.simulation()?.reset();
    this.runVersion.update((version) => version + 1);
  }

  protected clearFood(): void {
    this.simulation()?.clearFood();
  }

  protected onPointerDown(event: PointerEvent): void {
    if (event.button !== 0 || !this.simulation()) {
      return;
    }
    const canvas = this.canvas().nativeElement;
    canvas.setPointerCapture(event.pointerId);
    this.lastPoint = canvasPoint(canvas, event);
    this.paint(this.lastPoint, this.lastPoint);
  }

  protected onPointerMove(event: PointerEvent): void {
    if (!this.lastPoint) {
      return;
    }
    const point = canvasPoint(this.canvas().nativeElement, event);
    this.paint(this.lastPoint, point);
    this.lastPoint = point;
  }

  protected onPointerUp(): void {
    this.lastPoint = null;
  }

  private paint(from: CanvasPoint, to: CanvasPoint): void {
    const { mode, size } = this.brush();
    this.simulation()?.paintFood(from, to, size, mode === 'erase');
  }

  private async start(): Promise<void> {
    const canvas = this.canvas().nativeElement;
    this.fitCanvas(canvas);

    let simulation: SlimeSimulation;
    try {
      simulation = await SlimeSimulation.create(canvas, this.settings(), readColors());
    } catch (error) {
      this.status.set(error instanceof WebGpuUnavailableError ? 'unsupported' : 'error');
      this.errorMessage.set(error instanceof Error ? error.message : String(error));
      return;
    }

    simulation.onDeviceLost = (message) => {
      cancelAnimationFrame(this.frameHandle);
      this.status.set('error');
      this.errorMessage.set(message);
    };
    this.simulation.set(simulation);
    this.status.set('ready');

    this.resizeObserver = new ResizeObserver(() => this.fitCanvas(canvas));
    this.resizeObserver.observe(canvas);

    const loop = () => {
      simulation.frame(this.running());
      this.frameHandle = requestAnimationFrame(loop);
    };
    this.frameHandle = requestAnimationFrame(loop);
  }

  /** Matches the canvas' pixel size to its displayed size. */
  private fitCanvas(canvas: HTMLCanvasElement): void {
    const scale = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(canvas.clientWidth * scale));
    const height = Math.max(1, Math.round(canvas.clientHeight * scale));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }
}

function canvasPoint(canvas: HTMLCanvasElement, event: PointerEvent): CanvasPoint {
  const bounds = canvas.getBoundingClientRect();
  return {
    u: (event.clientX - bounds.left) / bounds.width,
    v: (event.clientY - bounds.top) / bounds.height,
  };
}

/** Background and peak colour come from the design tokens in styles.css; species bring their own. */
function readColors(): SimColors {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string) => style.getPropertyValue(name);
  return {
    background: parseHexColor(token('--background'), [0.07, 0.05, 0.04]),
    peak: parseHexColor(token('--foreground'), [1, 0.98, 0.96]),
  };
}
