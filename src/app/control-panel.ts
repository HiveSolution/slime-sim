import { ChangeDetectionStrategy, Component, input, model, output } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucidePause, lucidePlay, lucideRotateCcw, lucideStepForward } from '@ng-icons/lucide';
import { HlmButton } from '@spartan-ng/helm/button';
import { PRESETS, Preset, SimSettings, SpawnMode } from '../sim';
import { SettingSlider } from './setting-slider';

/** The simulation's controls. It only edits `settings`; the host applies them. */
@Component({
  selector: 'slime-control-panel',
  imports: [HlmButton, NgIcon, SettingSlider],
  viewProviders: [provideIcons({ lucidePause, lucidePlay, lucideRotateCcw, lucideStepForward })],
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

  protected set<K extends keyof SimSettings>(key: K, value: SimSettings[K]): void {
    this.settings.update((settings) => ({ ...settings, [key]: value }));
  }

  protected applyPreset(preset: Preset): void {
    this.settings.update((settings) => ({ ...settings, ...preset.settings }));
    this.restart.emit();
  }

  protected isActive(preset: Preset): boolean {
    const settings = this.settings();
    return Object.entries(preset.settings).every(
      ([key, value]) => settings[key as keyof SimSettings] === value,
    );
  }
}
