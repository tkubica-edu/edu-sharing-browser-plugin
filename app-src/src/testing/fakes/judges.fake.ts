import { signal } from '@angular/core';
import { Node } from 'ngx-edu-sharing-api';
import { vi } from 'vitest';

import {
  ContentJudgeEvaluation,
  ContentJudgeInput,
  ContentJudgeService,
} from '../../app/services/content-judge.service';
import {
  CollectionRecommendationService,
  DEFAULT_MAX_KEYWORDS,
  DEFAULT_MIN_SCORE,
  RecommendedCollection,
} from '../../app/services/collection-recommendation.service';
import {
  MetalookupEvaluation,
  MetalookupResource,
  MetalookupService,
} from '../../app/services/metalookup.service';

/** An evaluation as ContentJudge makes one. */
export function aJudgement(
  results: ContentJudgeEvaluation['results'] = [],
): ContentJudgeEvaluation {
  return { summary: {}, findings: null, results, meta: {} } as unknown as ContentJudgeEvaluation;
}

/** A measurement as MetalookUp makes one. */
export function aMeasurement(
  featureExtractions: MetalookupEvaluation['featureExtractions'] = [],
): MetalookupEvaluation {
  return {
    timestamp: '2026-08-24T12:00:00Z',
    path: '/api/evaluation',
    status: 200,
    featureExtractions,
  } as MetalookupEvaluation;
}

/**
 * `ContentJudgeService` as the quality run uses it: whether it can be reached at all, and what it
 * answers. Answers a verdict by default and reports a credential as set, since the interesting cases
 * are the ones that turn either round.
 */
export function fakeContentJudge() {
  let evaluation: () => Promise<ContentJudgeEvaluation> = () => Promise.resolve(aJudgement());

  const fake = {
    credentialSet: signal(true),
    // The credential as the settings hold it, `user:password` — set, since the interesting cases are the
    // ones where it is taken back out.
    basicAuth: signal('judge:secret'),
    // Typed as the real one answers: what counts is that a credential was typed at all, not what it says.
    changedSettings: signal<0 | 1>(0),
    setBasicAuth: vi.fn((credential: string): Promise<void> => {
      fake.basicAuth.set(credential);
      fake.credentialSet.set(credential.includes(':'));
      return Promise.resolve();
    }),
    requestBody: vi.fn((input: ContentJudgeInput, schemes: readonly string[]) => ({
      schemes,
      source: input.source,
    })),
    evaluate: vi.fn((_input: ContentJudgeInput, _schemes: readonly string[]) => evaluation()),
    loadCredential: vi.fn((): Promise<void> => Promise.resolve()),
  } satisfies Partial<ContentJudgeService>;

  /** It answers with this verdict. */
  function answers(next: ContentJudgeEvaluation): void {
    evaluation = () => Promise.resolve(next);
  }

  /** It does not answer: the deployment is down, or refuses. */
  function fails(cause: unknown): void {
    evaluation = () => Promise.reject(cause);
  }

  return { fake, answers, fails };
}

export type ContentJudgeFake = ReturnType<typeof fakeContentJudge>;

/** `MetalookupService` as the quality run uses it: the measurement, and the body it would send. */
export function fakeMetalookup() {
  let evaluation: () => Promise<MetalookupEvaluation> = () => Promise.resolve(aMeasurement());

  const fake = {
    requestBody: vi.fn((resource: MetalookupResource, features: readonly string[]) => ({
      url: resource.url,
      features,
    })),
    evaluate: vi.fn((_resource: MetalookupResource, _features: readonly string[]) => evaluation()),
  } satisfies Partial<MetalookupService>;

  function answers(next: MetalookupEvaluation): void {
    evaluation = () => Promise.resolve(next);
  }

  function fails(cause: unknown): void {
    evaluation = () => Promise.reject(cause);
  }

  return { fake, answers, fails };
}

export type MetalookupFake = ReturnType<typeof fakeMetalookup>;

/**
 * `CollectionRecommendationService` — the topic assistant's proposal. Proposes nothing by default,
 * which is the ordinary case: keywords the topic tree holds no collection for.
 */
export function fakeRecommendations() {
  let recommendation: () => Promise<RecommendedCollection | null> = () => Promise.resolve(null);

  const fake = {
    recommend: vi.fn((_keywords: readonly string[], _text?: string) => recommendation()),
    // The two numbers the proposal is derived with, as the settings show and take them over.
    maxKeywords: signal(DEFAULT_MAX_KEYWORDS),
    minScore: signal(DEFAULT_MIN_SCORE),
    changedSettings: signal(0),
    setMaxKeywords: vi.fn((count: number): Promise<void> => {
      fake.maxKeywords.set(count);
      return Promise.resolve();
    }),
    setMinScore: vi.fn((score: number): Promise<void> => {
      fake.minScore.set(score);
      return Promise.resolve();
    }),
    resetToDefaults: vi.fn((): Promise<void> => {
      fake.maxKeywords.set(DEFAULT_MAX_KEYWORDS);
      fake.minScore.set(DEFAULT_MIN_SCORE);
      return Promise.resolve();
    }),
  } satisfies Partial<CollectionRecommendationService>;

  /** The assistant proposes this collection, sitting inside these collections (closest first). */
  function proposes(node: Node, ancestry: readonly string[] = [node.ref.id]): void {
    recommendation = () => Promise.resolve({ node, ancestry });
  }

  /** It could not be asked at all — which changes nothing about the step it belongs to. */
  function fails(cause: unknown = new Error('topic assistant unreachable')): void {
    recommendation = () => Promise.reject(cause);
  }

  return { fake, proposes, fails };
}

export type RecommendationsFake = ReturnType<typeof fakeRecommendations>;
