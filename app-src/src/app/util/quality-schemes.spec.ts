import { describe, expect, it } from 'vitest';

import { APP_CONFIG } from '../config';
import type { ContentJudgeEvaluation, ContentJudgeResult } from '../services/content-judge.service';
import type { MetalookupEvaluation } from '../services/metalookup.service';
import {
  CriterionJudgement,
  configuredSchemes,
  judgementsForCriteria,
  metalookupFeatures,
  schemesForCriteria,
} from './quality-schemes';

/** Criteria the shipped map judges, and the schemes it judges them by. */
const NEUTRALITY = 'ccm:oeh_quality_neutralness';
const CRIMINAL_LAW = 'ccm:oeh_quality_criminal_law';

/** A criterion the map deliberately holds no scheme for — nobody judges it. */
const COPYRIGHT = 'ccm:oeh_quality_copyright_law';

/** The one criterion MetalookUp measures. */
const ACCESSIBLE = 'accessible';

/** One scheme's answer, as ContentJudge reports it. */
function aResult(overrides: Partial<ContentJudgeResult> = {}): ContentJudgeResult {
  return {
    scheme_id: 'neutralitaet',
    type: 'ordinal_rubric',
    dimension: 'neutrality',
    value: 4,
    label: 'neutrale Formulierung',
    reasoning: '  Der Text benennt beide Seiten.  ',
    confidence: 0.82,
    checks: [],
    ...overrides,
  } as ContentJudgeResult;
}

/** A judgement carrying the given scheme answers. */
function aJudgement(results: ContentJudgeResult[]): ContentJudgeEvaluation {
  return { summary: {}, findings: null, results, meta: {} } as unknown as ContentJudgeEvaluation;
}

/** A measurement carrying the AXE audit's result. */
function aMeasurement(value: unknown, overrides: Record<string, unknown> = {}): MetalookupEvaluation {
  return {
    timestamp: '2026-08-24T12:00:00Z',
    path: '/api/evaluation',
    status: 200,
    featureExtractions: [
      {
        propertyId: 'ccm:accessibilitySummary',
        value,
        description: '  Kontraste zu schwach.  ',
        confidence: 0.7,
        ...overrides,
      },
    ],
  } as unknown as MetalookupEvaluation;
}

describe('schemesForCriteria', () => {
  it('names the scheme the map holds for a criterion', () => {
    expect(schemesForCriteria([NEUTRALITY]).schemes).toEqual(['neutralitaet']);
    expect(schemesForCriteria([CRIMINAL_LAW]).schemes).toEqual(['strafrecht_gate']);
  });

  it('asks for a scheme once, however many criteria it covers', () => {
    expect(schemesForCriteria([NEUTRALITY, NEUTRALITY]).schemes).toEqual(['neutralitaet']);
  });

  it('keeps the order the criteria came in', () => {
    expect(schemesForCriteria([NEUTRALITY, CRIMINAL_LAW]).schemes).toEqual([
      'neutralitaet',
      'strafrecht_gate',
    ]);
  });

  it('says which criteria nobody judges rather than passing over them', () => {
    const asked = schemesForCriteria([COPYRIGHT, ACCESSIBLE, NEUTRALITY]);
    expect(asked.unmapped).toEqual([COPYRIGHT, ACCESSIBLE]);
    expect(asked.schemes).toEqual(['neutralitaet']);
  });

  it('reads a criterion the map does not name at all as one nobody judges', () => {
    expect(schemesForCriteria(['ccm:erfunden']).unmapped).toEqual(['ccm:erfunden']);
  });

  it('reports what the request\'s own limit cut off, so a partial judgement is not read as a whole one', () => {
    const many = Object.keys(APP_CONFIG.qualityCriterionSchemes).filter(
      (criterion) => APP_CONFIG.qualityCriterionSchemes[criterion],
    );
    const asked = schemesForCriteria(many);
    expect(asked.schemes.length).toBeLessThanOrEqual(10);
    expect([...asked.schemes, ...asked.dropped]).toHaveLength(many.length);
  });

  it('asks for nothing where nothing was asked about', () => {
    expect(schemesForCriteria([])).toEqual({ schemes: [], unmapped: [], dropped: [] });
  });
});

describe('configuredSchemes', () => {
  it('asks for every scheme the map holds, for a judgement that starts before the metadata set is read', () => {
    const configured = configuredSchemes();
    expect(configured.schemes).toContain('neutralitaet');
    expect(configured.schemes).toEqual(
      schemesForCriteria(Object.keys(APP_CONFIG.qualityCriterionSchemes)).schemes,
    );
  });

  it('names the criteria of the map that nobody judges as unmapped', () => {
    expect(configuredSchemes().unmapped).toContain(COPYRIGHT);
  });
});

describe('metalookupFeatures', () => {
  it('asks for the features whose checks are read, and for no others', () => {
    expect(metalookupFeatures()).toEqual(['accessibility']);
  });

  it('asks for a feature once, however many of its checks are read', () => {
    expect(new Set(metalookupFeatures()).size).toBe(metalookupFeatures().length);
  });
});

describe('judgementsForCriteria', () => {
  it('reads a scheme\'s answer as the judgement of the criterion it was asked for', () => {
    const found = judgementsForCriteria([NEUTRALITY], aJudgement([aResult()]), null);
    expect(found[NEUTRALITY]).toEqual([
      {
        criterion: NEUTRALITY,
        source: 'ContentJudge',
        scheme: 'neutralitaet',
        value: 4,
        label: 'neutrale Formulierung',
        confidence: 0.82,
        reasoning: 'Der Text benennt beide Seiten.',
        met: true,
      } satisfies CriterionJudgement,
    ]);
  });

  it('measures met against the scheme\'s own threshold and direction', () => {
    const met = (value: number) =>
      judgementsForCriteria([NEUTRALITY], aJudgement([aResult({ value })]), null)[NEUTRALITY][0].met;
    expect(met(3)).toBe(true);
    expect(met(2)).toBe(false);
  });

  it('takes the first of the categories a scheme collecting several answers with', () => {
    const found = judgementsForCriteria(
      [NEUTRALITY],
      aJudgement([aResult({ label: ['  ', 'einseitig', 'wertend'] })]),
      null,
    );
    expect(found[NEUTRALITY][0].label).toBe('einseitig');
  });

  it('says nothing about met where the scheme answered no number, which is not "not met"', () => {
    const found = judgementsForCriteria(
      [NEUTRALITY],
      aJudgement([aResult({ value: 'Befriedigend' as never, label: null, reasoning: '   ' })]),
      null,
    );
    expect(found[NEUTRALITY][0]).toMatchObject({ value: null, met: null, label: null, reasoning: null });
  });

  it('reads a number a scheme reported as a string as the number it spells', () => {
    // What `asNumber` does today. Its own comment says the opposite — that a numeric string is no
    // number here — so one of the two is wrong; the test states which way the code runs.
    const found = judgementsForCriteria([NEUTRALITY], aJudgement([aResult({ value: '4' as never })]), null);
    expect(found[NEUTRALITY][0]).toMatchObject({ value: 4, met: true });
  });

  it('reads MetalookUp\'s measurement as the judgement of the criterion the config gives it', () => {
    const found = judgementsForCriteria([ACCESSIBLE], null, aMeasurement(0.95));
    expect(found[ACCESSIBLE]).toEqual([
      {
        criterion: ACCESSIBLE,
        source: 'MetalookUp',
        scheme: 'Barrierefreiheit (AXE)',
        value: 0.95,
        label: 'Barrierefreiheit (AXE)',
        confidence: 0.7,
        reasoning: 'Kontraste zu schwach.',
        met: true,
      } satisfies CriterionJudgement,
    ]);
  });

  it('measures MetalookUp\'s number against its own threshold', () => {
    expect(judgementsForCriteria([ACCESSIBLE], null, aMeasurement(0.5))[ACCESSIBLE][0].met).toBe(false);
  });

  it('reads no measurement out of a check that reports no value', () => {
    expect(judgementsForCriteria([ACCESSIBLE], null, aMeasurement(null))[ACCESSIBLE]).toBeUndefined();
    expect(judgementsForCriteria([ACCESSIBLE], null, aMeasurement('unklar'))[ACCESSIBLE]).toBeUndefined();
  });

  it('reads only the keys the config names out of an answer carrying every check that ran', () => {
    const measurement = aMeasurement(0.95, { propertyId: 'ccm:etwasAnderes' });
    expect(judgementsForCriteria([ACCESSIBLE], null, measurement)[ACCESSIBLE]).toBeUndefined();
  });

  it('gathers both judges\' answers under the criterion they are about', () => {
    const found = judgementsForCriteria(
      [NEUTRALITY, ACCESSIBLE],
      aJudgement([aResult()]),
      aMeasurement(0.95),
    );
    expect(found[NEUTRALITY].map((one) => one.source)).toEqual(['ContentJudge']);
    expect(found[ACCESSIBLE].map((one) => one.source)).toEqual(['MetalookUp']);
  });

  it('is driven by the criteria, so a scheme nobody asked about is not reported', () => {
    const found = judgementsForCriteria(
      [NEUTRALITY],
      aJudgement([aResult(), aResult({ scheme_id: 'strafrecht_gate', value: 1 })]),
      null,
    );
    expect(Object.keys(found)).toEqual([NEUTRALITY]);
  });

  it('reports nothing for a criterion neither judge answered', () => {
    expect(judgementsForCriteria([COPYRIGHT], aJudgement([aResult()]), null)).toEqual({});
    expect(judgementsForCriteria([NEUTRALITY], null, null)).toEqual({});
  });
});
