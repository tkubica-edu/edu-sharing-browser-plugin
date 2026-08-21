import { Injectable, computed, inject, signal } from '@angular/core';

import { APP_CONFIG } from '../config';
import { BrowserExtensionService } from './browser-extension.service';

/**
 * On unless it was switched off: the corrections are what the panel's steps are written for — a welcome
 * message and quick replies that lead out of the check are things the check does not account for. The
 * switch is there to see the widget as it ships, which is what a report about it has to be made against.
 */
const DEFAULT_ENABLED = true;

/**
 * Whether the chat widget is corrected by our own stylesheet — see `installChatOverrides` in
 * util/chat-overrides.ts, which holds the rules and puts them into the widget's shadow root.
 *
 * Read as the chat element is created, so a change to the switch reaches the next conversation rather than
 * the running one. That is not a compromise: the settings are a screen of their own, and reaching them
 * closes the assistant screen, which unmounts the element and mounts a new one on the way back.
 */
@Injectable({ providedIn: 'root' })
export class ChatStyleService {
  private readonly browserExtension = inject(BrowserExtensionService);

  private readonly overridesState = signal(DEFAULT_ENABLED);

  /** True while the corrections are applied. Persisted, so it survives a reload. */
  readonly overridesEnabled = this.overridesState.asReadonly();

  /** Load the persisted switch. Before the assistant screen can mount its chat element. */
  async load(): Promise<void> {
    this.overridesState.set(
      await this.browserExtension.storageGet(APP_CONFIG.storageKeys.chatStyleOverrides, DEFAULT_ENABLED)
    );
  }

  /**
   * Whether the switch stands away from what the panel ships with — counted where the settings say per
   * section how much was changed in it, which is why it is answered here rather than there: the default
   * is this service's own.
   */
  readonly changedSettings = computed(() => (this.overridesState() === DEFAULT_ENABLED ? 0 : 1));

  async setOverridesEnabled(enabled: boolean): Promise<void> {
    this.overridesState.set(enabled);
    await this.browserExtension.storageSet(APP_CONFIG.storageKeys.chatStyleOverrides, enabled);
  }

  /** Put the switch back to what it is without anybody setting it — the checked-in configuration. */
  async resetToDefault(): Promise<void> {
    await this.setOverridesEnabled(DEFAULT_ENABLED);
  }
}
