import { Injectable, computed, inject, signal } from '@angular/core';

import { APP_CONFIG } from '../config';
import { BrowserExtensionService } from './browser-extension.service';

/**
 * What the panel says about the chat's master skill — the widget knows three states, so this is not a
 * switch with two:
 *
 * - `operator` — nothing is said, and the chat runs on what the operator configured (`MASTER_SKILL_ENABLED`)
 * - `on` / `off` — said for this embedding, whatever the operator configured
 */
export type MasterSkillSetting = 'operator' | 'on' | 'off';

/** Following the operator unless the panel was told otherwise: their configuration is the intended state. */
const DEFAULT_SETTING: MasterSkillSetting = 'operator';

/** The values the widget's `master-skill` attribute takes, for the two states that state something. */
const ATTRIBUTE_VALUES: Record<Exclude<MasterSkillSetting, 'operator'>, string> = {
  on: 'on',
  off: 'off'
};

/**
 * Whether the chat widget runs its master skill, for the conversations the panel embeds.
 *
 * Read as the chat element is created, so a change reaches the next conversation rather than the running
 * one — the settings are a screen of their own, and reaching them closes the assistant screen.
 */
@Injectable({ providedIn: 'root' })
export class ChatSkillService {
  private readonly browserExtension = inject(BrowserExtensionService);

  private readonly settingState = signal<MasterSkillSetting>(DEFAULT_SETTING);

  /** What the panel says about the master skill. Persisted, so it survives a reload. */
  readonly masterSkill = this.settingState.asReadonly();

  /** Load the persisted setting. Before the assistant screen can mount its chat element. */
  async load(): Promise<void> {
    const stored = await this.browserExtension.storageGet<string>(
      APP_CONFIG.storageKeys.chatMasterSkill,
      DEFAULT_SETTING
    );
    this.settingState.set(isSetting(stored) ? stored : DEFAULT_SETTING);
  }

  /**
   * Whether the setting stands away from what the panel ships with — see
   * ChatStyleService.changedSettings, which the settings count alongside it.
   */
  readonly changedSettings = computed(() => (this.settingState() === DEFAULT_SETTING ? 0 : 1));

  async setMasterSkill(setting: MasterSkillSetting): Promise<void> {
    this.settingState.set(setting);
    await this.browserExtension.storageSet(APP_CONFIG.storageKeys.chatMasterSkill, setting);
  }

  /** Put the setting back to what it is without anybody setting it — the operator's configuration. */
  async resetToDefault(): Promise<void> {
    await this.setMasterSkill(DEFAULT_SETTING);
  }

  /**
   * The value the `master-skill` attribute is to carry, or `null` where it is to be left off the element
   * altogether — a missing attribute is what leaves the state to the operator, and an empty one is read
   * the same way only by this version of the widget.
   */
  masterSkillAttribute(): string | null {
    const setting = this.settingState();
    return setting === 'operator' ? null : ATTRIBUTE_VALUES[setting];
  }
}

/** Whether what came out of storage is one of the three states — anything else is a key from another version. */
function isSetting(value: unknown): value is MasterSkillSetting {
  return value === 'operator' || value === 'on' || value === 'off';
}
