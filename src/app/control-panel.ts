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
  matchesPreset,
  MAX_SPECIES,
  PRESETS,
  Preset,
  removeSpecies,
  SimSettings,
  SpawnMode,
  SpeciesSettings,
} from '../sim';
import { SettingSlider } from './setting-slider';

/** The simulation's controls. It only edits `settings`; the host applies them. */
@Component({
  selector: 'slime-control-panel',
  imports: [HlmButton, NgIcon, SettingSlider],
  viewProviders: [
    provideIcons({
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
  /** e.g. `960 × 540 · 77,760 agents`; empty until the simulation is up. */
  readonly summary = input('');

  readonly step = output<void>();
  readonly restart = output<void>();

  protected readonly presets = PRESETS;
  protected readonly maxSpecies = MAX_SPECIES;
  protected readonly gridHeights = [270, 540, 720, 1080];
  protected readonly collisionOptions = [
    { value: true, label: 'One' },
    { value: false, label: 'Unlimited' },
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
