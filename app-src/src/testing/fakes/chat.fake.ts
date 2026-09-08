import { signal } from '@angular/core';
import { vi } from 'vitest';

import { ChatSkillService, MasterSkillSetting } from '../../app/services/chat-skill.service';
import { ChatStyleService } from '../../app/services/chat-style.service';

/**
 * `ChatStyleService` — whether the panel corrects the chat widget's own presentation. On by default, as
 * the panel ships it.
 *
 * `changedSettings` is stated rather than derived, here as in the other settings fakes: which value counts
 * as untouched is the real service's knowledge, and recomputing it in the fake would move that knowledge
 * into the specs that read the count.
 */
export function fakeChatStyle() {
  const fake = {
    overridesEnabled: signal(true),
    // Typed as the real one answers: the card holds a single switch, so it is at its default or not.
    changedSettings: signal<0 | 1>(0),
    setOverridesEnabled: vi.fn((enabled: boolean): Promise<void> => {
      fake.overridesEnabled.set(enabled);
      return Promise.resolve();
    }),
    resetToDefault: vi.fn((): Promise<void> => {
      fake.overridesEnabled.set(true);
      return Promise.resolve();
    }),
  } satisfies Partial<ChatStyleService>;

  return { fake };
}

export type ChatStyleFake = ReturnType<typeof fakeChatStyle>;

/**
 * `ChatSkillService` — what the panel says about the chat's master skill. Says nothing by default, which
 * leaves it to whatever the operator configured.
 */
export function fakeChatSkill() {
  const fake = {
    masterSkill: signal<MasterSkillSetting>('operator'),
    changedSettings: signal<0 | 1>(0),
    setMasterSkill: vi.fn((setting: MasterSkillSetting): Promise<void> => {
      fake.masterSkill.set(setting);
      return Promise.resolve();
    }),
    resetToDefault: vi.fn((): Promise<void> => {
      fake.masterSkill.set('operator');
      return Promise.resolve();
    }),
    masterSkillAttribute: vi.fn((): string | null =>
      fake.masterSkill() === 'operator' ? null : fake.masterSkill(),
    ),
  } satisfies Partial<ChatSkillService>;

  return { fake };
}

export type ChatSkillFake = ReturnType<typeof fakeChatSkill>;
