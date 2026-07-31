import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { CommonModule } from '@angular/common';

import { AppOption, OPTIONS, OptionId } from '../model/options';
import { UiStateService } from '../services/ui-state.service';
import { CustomRenderingContext } from './extension.model';
import { ExtElementComponent } from './ext-element.component';
import { ExtensionService } from './extension.service';

/**
 * Renders the screen for an option whose view is provided by an extension — either a
 * custom option (added) or an overridden built-in one (replaced). Resolves the registered
 * `screen` rendering and renders its template or its custom element; renders nothing when
 * no rendering applies.
 */
@Component({
  selector: 'es-ext-screen',
  standalone: true,
  imports: [CommonModule, ExtElementComponent],
  templateUrl: './ext-screen.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExtScreenComponent {
  readonly view = input.required<OptionId>();

  private readonly extensionService = inject(ExtensionService);
  private readonly uiState = inject(UiStateService);

  readonly rendering = computed(() =>
    this.extensionService.getRendering('screen', this.view(), this.uiState.conditions()),
  );

  readonly context = computed<CustomRenderingContext>(() => ({
    option: this.extensionService.applyOptions(OPTIONS).find((option) => option.id === this.view())
      ?? this.fallbackOption(),
    conditions: this.uiState.conditions(),
    slot: 'screen',
  }));

  private fallbackOption(): AppOption {
    return { id: this.view(), label: '', description: '', icon: '', visible: () => true };
  }
}
