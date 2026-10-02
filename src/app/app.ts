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
  decodeSettings,
  DEFAULT_SETTINGS,
  encodeSettings,
  parseHexColor,
  SimColors,
  SimSettings,
  SlimeSimulation,
  WebGpuUnavailableError,
} from '../sim';
import { Brush, ControlPanel, LinkStatus } from './control-panel';

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
  /** Starts from the settings in the link, if the page was opened through a shared one. */
  protected readonly settings = signal<SimSettings>(sharedSettings() ?? DEFAULT_SETTINGS);
  protected readonly running = signal(true);
  protected readonly brush = signal<Brush>({ mode: 'paint', size: 4 });
  protected readonly panelOpen = signal(true);
  protected readonly status = signal<Status>('loading');
  protected readonly errorMessage = signal('');
  protected readonly linkStatus = signal<LinkStatus>('idle');
  /** Rendered frames per second, measured twice a second. */
  private readonly fps = signal(0);
  /** Bumped whenever a run starts, so `summary` re-reads the grid and agent count. */
  private readonly runVersion = signal(0);

  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly simulation = signal<SlimeSimulation | null>(null);
  private frameHandle = 0;
  private linkStatusTimer = 0;
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
    const agents = simulation.agentCount.toLocaleString('en-US');
    return `${width} × ${height} cells · ${agents} agents · ${this.fps()} fps`;
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

    // A shared link pasted into this tab only changes the hash, which doesn't reload the page.
    const onHashChange = () => {
      const shared = sharedSettings();
      if (shared) {
        this.settings.set(shared);
        this.restart();
      }
    };
    window.addEventListener('hashchange', onHashChange);

    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('hashchange', onHashChange);
      clearTimeout(this.linkStatusTimer);
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

  /** Puts a link to the current settings in the address bar and on the clipboard. */
  protected async copyLink(): Promise<void> {
    const hash = `#${encodeSettings(this.settings())}`;
    history.replaceState(null, '', hash);
    let status: LinkStatus = 'copied';
    try {
      await navigator.clipboard.writeText(location.href);
    } catch {
      status = 'shown';
    }
    this.linkStatus.set(status);
    clearTimeout(this.linkStatusTimer);
    this.linkStatusTimer = window.setTimeout(() => this.linkStatus.set('idle'), 4000);
  }

  protected async saveImage(): Promise<void> {
    const simulation = this.simulation();
    if (!simulation) {
      return;
    }
    const url = URL.createObjectURL(await simulation.capture());
    const link = document.createElement('a');
    link.href = url;
    link.download = `slime-sim-${timestamp()}.png`;
    link.click();
    URL.revokeObjectURL(url);
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

    let frames = 0;
    let measuredFrom = performance.now();
    const loop = (now: number) => {
      simulation.frame(this.running());
      frames++;
      if (now - measuredFrom >= 500) {
        this.fps.set(Math.round((frames * 1000) / (now - measuredFrom)));
        frames = 0;
        measuredFrom = now;
      }
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

/** The settings from the address bar, or null when it holds none. */
function sharedSettings(): SimSettings | null {
  const hash = location.hash;
  return new URLSearchParams(hash.slice(1)).has('v') ? decodeSettings(hash) : null;
}

/** Local date and time as `20261002-213045`, for file names. */
function timestamp(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  );
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
