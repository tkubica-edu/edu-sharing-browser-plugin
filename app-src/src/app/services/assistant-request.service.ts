import { Injectable, computed, inject, signal } from '@angular/core';

import { APP_CONFIG } from '../config';
import { DEFAULT_TASK_MAX, boundedTaskMax } from '../util/quality-check-request';
import { BrowserExtensionService } from './browser-extension.service';

/**
 * How long a request to the KI assistant may be, in characters.
 *
 * A setting rather than a constant because it is the one knob over how much of a content the assistant
 * actually reads: the content is quoted inside the request and cut to fit it, and a long content judged by
 * its first few thousand characters comes back with criteria answered "unclear" for a reason nobody can see
 * in the answer. Raising it buys a longer excerpt at the price of the run's token budget, and it is the price
 * that makes it a decision — so it is made where the other tuning is made, in the settings.
 *
 * Read as a task is built, so a change reaches the next check rather than a running one. The range and what
 * the bound protects are in `util/quality-check-request.ts`, which is also where it is spent.
 */
@Injectable({ providedIn: 'root' })
export class AssistantRequestService {
  private readonly browserExtension = inject(BrowserExtensionService);

  private readonly maxCharactersState = signal(DEFAULT_TASK_MAX);

  /** How long a request may be — see {@link boundedTaskMax}. Persisted, so it survives a reload. */
  readonly maxCharacters = this.maxCharactersState.asReadonly();

  /**
   * Whether the length stands away from what the panel ships with — see
   * ChatStyleService.changedSettings, which the settings count alongside it.
   */
  readonly changedSettings = computed(() =>
    this.maxCharactersState() === DEFAULT_TASK_MAX ? 0 : 1,
  );

  /**
   * Load the persisted setting. Before anything reports against it: a resumed session may start an
   * Erschließung on this boot, and the run says how the page's length stands against this number.
   */
  async load(): Promise<void> {
    this.maxCharactersState.set(
      boundedTaskMax(
        await this.browserExtension.storageGet(APP_CONFIG.storageKeys.assistantRequestMax, DEFAULT_TASK_MAX),
      ),
    );
  }

  /** Take over how long a request may be; the value is brought into range first. */
  async setMaxCharacters(characters: number): Promise<void> {
    const value = boundedTaskMax(characters);
    this.maxCharactersState.set(value);
    await this.browserExtension.storageSet(APP_CONFIG.storageKeys.assistantRequestMax, value);
  }

  /** Put it back to what it is without anybody setting it — the checked-in configuration. */
  async resetToDefault(): Promise<void> {
    await this.setMaxCharacters(DEFAULT_TASK_MAX);
  }
}
