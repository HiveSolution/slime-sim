import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { HlmSlider } from '@spartan-ng/helm/slider';
import { Range } from '../sim';

/** One labelled slider row of the control panel, with the current value shown beside the label. */
@Component({
  selector: 'slime-setting-slider',
  imports: [HlmSlider],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="mb-2 flex items-baseline justify-between gap-2 text-sm">
      <span class="font-medium">{{ label() }}</span>
      <span class="text-muted-foreground tabular-nums">{{ display() }}</span>
    </div>
    <hlm-slider
      [aria-label]="label()"
      [value]="[value()]"
      [min]="range().min"
      [max]="range().max"
      [step]="range().step"
      (valueChange)="onChange($event)"
    />
    @if (hint()) {
      <p class="text-muted-foreground mt-2 text-xs">{{ hint() }}</p>
    }
  `,
})
export class SettingSlider {
  readonly label = input.required<string>();
  readonly value = input.required<number>();
  readonly range = input.required<Range>();
  /** Text after the value, e.g. `°` or ` px`. */
  readonly unit = input('');
  readonly hint = input('');

  readonly valueChange = output<number>();

  protected readonly display = computed(() => {
    const { step } = this.range();
    const decimals = step >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(step)));
    return this.value().toFixed(decimals) + this.unit();
  });

  protected onChange(values: number[]): void {
    const value = values[0];
    if (value !== undefined && value !== this.value()) {
      this.valueChange.emit(value);
    }
  }
}
