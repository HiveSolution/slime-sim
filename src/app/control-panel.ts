import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  model,
  output,
  signal,
} from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideBrush,
  lucideCheck,
  lucideDownload,
  lucideEraser,
  lucideLink,
  lucidePause,
  lucidePlay,
  lucidePlus,
  lucideRotateCcw,
  lucideStepForward,
  lucideTrash2,
} from '@ng-icons/lucide';
import { HlmButton } from '@spartan-ng/helm/button';
import {
  addSpecies,
  applyPreset,
  LIMITS,
  matchesPreset,
  MAX_SPECIES,
  PRESETS,
  Preset,
  Range,
  removeSpecies,
  SimSettings,
  SpawnMode,
  SPECIES_LIMITS,
  SpeciesSettings,
} from '../sim';
import { SettingSlider } from './setting-slider';

/** How dragging on the canvas changes the food sources. */
export interface Brush {
  mode: 'paint' | 'erase';
  /** Radius in grid cells. */
  size: number;
}

/** What became of the last "Copy link": copied, or only shown in the address bar. */
export type LinkStatus = 'idle' | 'copied' | 'shown';

/** The simulation's controls. It only edits `settings`; the host applies them. */
@Component({
  selector: 'slime-control-panel',
  imports: [HlmButton, NgIcon, SettingSlider],
  viewProviders: [
    provideIcons({
      lucideBrush,
      lucideCheck,
      lucideDownload,
      lucideEraser,
      lucideLink,
      lucidePause,
      lucidePlay,
      lucidePlus,
      lucideRotateCcw,
      lucideStepForward,
      lucideTrash2,
    }),
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  templateUrl: './control-panel.html',
})
export class ControlPanel {
  readonly settings = model.required<SimSettings>();
  readonly running = model.required<boolean>();
  readonly brush = model.required<Brush>();
  /** e.g. `960 × 540 · 77,760 agents`; empty until the simulation is up. */
  readonly summary = input('');
  readonly linkStatus = input<LinkStatus>('idle');

  readonly step = output<void>();
  readonly restart = output<void>();
  readonly clearFood = output<void>();
  readonly copyLink = output<void>();
  readonly saveImage = output<void>();

  protected readonly presets = PRESETS;
  protected readonly maxSpecies = MAX_SPECIES;
  protected readonly limits = LIMITS;
  protected readonly speciesLimits = SPECIES_LIMITS;
  protected readonly brushSizes: Range = { min: 1, max: 40, step: 1 };
  protected readonly linkLabel = computed(() =>
    this.linkStatus() === 'copied' ? 'Link copied' : 'Copy link',
  );
  protected readonly gridHeights = [270, 540, 720, 1080];
  protected readonly collisionOptions = [
    { value: true, label: 'One' },
    { value: false, label: 'Unlimited' },
  ];
  protected readonly wrapOptions = [
    { value: true, label: 'Wrap around' },
    { value: false, label: 'Walls' },
  ];
  protected readonly repelOptions = [
    { value: false, label: 'Follow' },
    { value: true, label: 'Avoid' },
  ];
  protected readonly brushModes: { value: Brush['mode']; label: string; icon: string }[] = [
    { value: 'paint', label: 'Paint', icon: 'lucideBrush' },
    { value: 'erase', label: 'Erase', icon: 'lucideEraser' },
  ];
  protected readonly spawnModes: { value: SpawnMode; label: string }[] = [
    { value: 'random', label: 'Random' },
    { value: 'disc', label: 'Disc' },
    { value: 'ring', label: 'Ring' },
  ];

  /** The species whose settings are shown. */
  protected readonly selected = signal(0);
  /** `selected`, kept in range when species are removed. */
  protected readonly selectedIndex = computed(() =>
    Math.min(this.selected(), this.settings().species.length - 1),
  );
  protected readonly species = computed(() => this.settings().species[this.selectedIndex()]);

  protected set<K extends keyof SimSettings>(key: K, value: SimSettings[K]): void {
    this.settings.update((settings) => ({ ...settings, [key]: value }));
  }

  protected setSpecies<K extends keyof SpeciesSettings>(key: K, value: SpeciesSettings[K]): void {
    const index = this.selectedIndex();
    this.settings.update((settings) => ({
      ...settings,
      species: settings.species.map((species, i) =>
        i === index ? { ...species, [key]: value } : species,
      ),
    }));
  }

  protected setBrush<K extends keyof Brush>(key: K, value: Brush[K]): void {
    this.brush.update((brush) => ({ ...brush, [key]: value }));
  }

  protected setColor(event: Event): void {
    this.setSpecies('color', (event.target as HTMLInputElement).value);
  }

  protected addSpecies(): void {
    this.settings.update((settings) => addSpecies(settings, this.selectedIndex()));
    this.selected.set(this.settings().species.length - 1);
  }

  protected removeSpecies(): void {
    const index = this.selectedIndex();
    this.settings.update((settings) => removeSpecies(settings, index));
  }

  protected usePreset(preset: Preset): void {
    this.settings.update((settings) => applyPreset(settings, preset));
    this.restart.emit();
  }

  protected isActive(preset: Preset): boolean {
    return matchesPreset(this.settings(), preset);
  }
}
