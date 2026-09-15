import { computed, signal } from '@angular/core';
import { vi } from 'vitest';

import type { ContentJudgeEvaluation } from '../../app/services/content-judge.service';
import type { MetalookupEvaluation } from '../../app/services/metalookup.service';
import { JudgeStatus, QualityJudgeService } from '../../app/services/quality-judge.service';

/**
 * `QualityJudgeService` as its readers see it: what the two judges answered, and how far each got. The
 * run itself is a spy — nothing here starts one, and the states are set directly, since what a reader
 * branches on is the state and not the route to it.
 *
 * Both judges start `idle`, which is `asked() === false`: the panel says nothing about a content nobody
 * asked about, and that is the state every view opens in.
 */
export function fakeQualityJudge() {
  const statuses = signal<readonly JudgeStatus[]>([
    { judge: 'MetalookUp', state: 'idle', detail: null },
    { judge: 'ContentJudge', state: 'idle', detail: null },
  ]);

  // Independent of the enabled signals below, as `changedSettings` is in every settings fake — which
  // value counts as untouched is the real service's business, not this fake's. See
  // `blacklistMetalookup`/`blacklistContentJudge` and `APP_CONFIG.featureBlacklist`.
  const metalookupBlacklistedState = signal(false);
  const contentJudgeBlacklistedState = signal(false);
  const metalookupEnabledState = signal(true);
  const contentJudgeEnabledState = signal(false);

  const fake = {
    evaluation: signal<ContentJudgeEvaluation | null>(null),
    measured: signal<MetalookupEvaluation | null>(null),
    statuses,
    running: computed(() => statuses().some((status) => status.state === 'running')),
    asked: computed(() => statuses().some((status) => status.state !== 'idle')),
    metalookupBlacklisted: metalookupBlacklistedState,
    metalookupEnabled: computed(() => !metalookupBlacklistedState() && metalookupEnabledState()),
    contentJudgeBlacklisted: contentJudgeBlacklistedState,
    contentJudgeEnabled: computed(() => !contentJudgeBlacklistedState() && contentJudgeEnabledState()),
    start: vi.fn(),
    reset: vi.fn(),
    changedSettings: signal(0),
    setMetalookupEnabled: vi.fn((enabled: boolean): Promise<void> => {
      metalookupEnabledState.set(enabled);
      return Promise.resolve();
    }),
    setContentJudgeEnabled: vi.fn((enabled: boolean): Promise<void> => {
      contentJudgeEnabledState.set(enabled);
      return Promise.resolve();
    }),
  } satisfies Partial<QualityJudgeService>;

  /** The deployment turned `metalookup` off outright — see `FeatureKey`. */
  function blacklistMetalookup(): void {
    metalookupBlacklistedState.set(true);
  }

  /** The deployment turned `contentJudge` off outright — see `FeatureKey`. */
  function blacklistContentJudge(): void {
    contentJudgeBlacklistedState.set(true);
  }

  /** Both judges are out — the wait a view shows a spinner for. */
  function judging(): void {
    statuses.set([
      { judge: 'MetalookUp', state: 'running', detail: null },
      { judge: 'ContentJudge', state: 'running', detail: null },
    ]);
  }

  /**
   * Both are back, with what they found. Either may be left out: one answer is enough for a result, and
   * a judge that answered nothing is what {@link unavailable} is for.
   */
  function answered(
    judgement: ContentJudgeEvaluation | null = null,
    measurement: MetalookupEvaluation | null = null,
  ): void {
    statuses.set([
      { judge: 'MetalookUp', state: measurement ? 'done' : 'skipped', detail: null },
      { judge: 'ContentJudge', state: judgement ? 'done' : 'skipped', detail: null },
    ]);
    fake.evaluation.set(judgement);
    fake.measured.set(measurement);
  }

  /** Asked, and not one judge got through — so nothing is claimed about the content either way. */
  function unavailable(detail = 'Der Dienst war nicht erreichbar.'): void {
    statuses.set([
      { judge: 'MetalookUp', state: 'failed', detail },
      { judge: 'ContentJudge', state: 'skipped', detail },
    ]);
  }

  return { fake, statuses, judging, answered, unavailable, blacklistMetalookup, blacklistContentJudge };
}

export type QualityJudgeFake = ReturnType<typeof fakeQualityJudge>;
