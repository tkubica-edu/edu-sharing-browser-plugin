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

  const fake = {
    evaluation: signal<ContentJudgeEvaluation | null>(null),
    measured: signal<MetalookupEvaluation | null>(null),
    statuses,
    running: computed(() => statuses().some((status) => status.state === 'running')),
    asked: computed(() => statuses().some((status) => status.state !== 'idle')),
    metalookupEnabled: signal(true),
    contentJudgeEnabled: signal(false),
    start: vi.fn(),
    reset: vi.fn(),
    setMetalookupEnabled: vi.fn((_enabled: boolean): Promise<void> => Promise.resolve()),
    setContentJudgeEnabled: vi.fn((_enabled: boolean): Promise<void> => Promise.resolve()),
  } satisfies Partial<QualityJudgeService>;

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

  return { fake, statuses, judging, answered, unavailable };
}

export type QualityJudgeFake = ReturnType<typeof fakeQualityJudge>;
