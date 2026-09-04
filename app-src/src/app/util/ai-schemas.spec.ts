import { describe, expect, it } from 'vitest';

import {
  OUTCOMES,
  VOCABULARY_FIELD_NAMES,
  enrichmentSchemaOf,
  originSchemaOf,
  proofreadSchemaOf,
  resultSchemaOf,
  schemaFits,
} from './ai-schemas';
import type { QualityCriterion } from './quality-check-request';

const CRITERIA: QualityCriterion[] = [
  { key: 'ccm:oeh_quality_neutralness', caption: 'Neutralität' },
  { key: 'content_valid', caption: 'Sachrichtigkeit' },
] as QualityCriterion[];

/** A schema's property block, for reading one level down without casting at every step. */
function propertiesOf(schema: Record<string, unknown>, path: readonly string[] = []): Record<string, any> {
  let node = schema as Record<string, any>;
  for (const step of path) node = node['properties'][step];
  return node['properties'];
}

describe('OUTCOMES', () => {
  it('offers the absence of a judgement as a verdict of its own', () => {
    expect(OUTCOMES).toEqual({ met: true, violated: false, unclear: null });
  });
});

describe('schemaFits', () => {
  it('accepts every schema the check actually sends', () => {
    expect(schemaFits(resultSchemaOf(CRITERIA))).toBe(true);
    expect(schemaFits(originSchemaOf())).toBe(true);
    expect(schemaFits(proofreadSchemaOf())).toBe(true);
    expect(schemaFits(enrichmentSchemaOf())).toBe(true);
  });

  it('refuses one past what the backend accepts, rather than letting the request be refused outright', () => {
    expect(schemaFits({ description: 'x'.repeat(10_000) })).toBe(false);
  });

  it('reports an unexpectedly long list of criteria as a schema that no longer fits', () => {
    const many = Array.from({ length: 400 }, (_, index) => ({
      key: `criterion_${index}`,
      caption: `Ein Kriterium mit einem längeren Namen, Nummer ${index}`,
    })) as QualityCriterion[];
    expect(schemaFits(resultSchemaOf(many))).toBe(false);
  });
});

describe('resultSchemaOf', () => {
  it('asks for one entry per criterion, each a verdict with its reasoning', () => {
    const criteria = propertiesOf(resultSchemaOf(CRITERIA), ['criteria']);
    expect(Object.keys(criteria)).toEqual(['ccm:oeh_quality_neutralness', 'content_valid']);
    expect(Object.keys(criteria['content_valid'].properties)).toEqual(['outcome', 'reason']);
    expect(criteria['content_valid'].required).toEqual(['outcome', 'reason']);
  });

  it('names each criterion by its caption, which is what the model reads it as', () => {
    expect(propertiesOf(resultSchemaOf(CRITERIA), ['criteria'])['content_valid'].description).toBe(
      'Sachrichtigkeit',
    );
  });

  it('requires every criterion, so a check that skipped half does not read as a complete one', () => {
    const criteria = (resultSchemaOf(CRITERIA) as any).properties.criteria;
    expect(criteria.required).toEqual(['ccm:oeh_quality_neutralness', 'content_valid']);
    expect(criteria.type).toBe('object');
  });

  it('offers the three verdicts and no others', () => {
    const outcome = propertiesOf(resultSchemaOf(CRITERIA), ['criteria', 'ccm:oeh_quality_neutralness'])[
      'outcome'
    ];
    expect(outcome.enum).toEqual(['met', 'violated', 'unclear']);
    expect(outcome.enum).toEqual(Object.keys(OUTCOMES));
  });

  it('asks for the overall verdict and for the confirmation, and requires both', () => {
    const schema = resultSchemaOf(CRITERIA) as any;
    expect(Object.keys(schema.properties)).toEqual(['criteria', 'suitable', 'summary', 'confirmed']);
    expect(schema.required).toEqual(['criteria', 'suitable', 'confirmed']);
  });

  it('asks for a shape even where nothing is to be judged', () => {
    const schema = resultSchemaOf([]) as any;
    expect(schema.properties.criteria.properties).toEqual({});
    expect(schema.properties.criteria.required).toEqual([]);
  });
});

describe('originSchemaOf', () => {
  it('asks whose the content is as one of two words, and requires only the person\'s answer', () => {
    const schema = originSchemaOf() as any;
    expect(schema.properties.origin.enum).toEqual(['own', 'external']);
    expect(schema.properties.guess.enum).toEqual(['own', 'external']);
    expect(schema.required).toEqual(['origin']);
  });

  it('tells the model in the field itself not to work the answer out for itself', () => {
    expect((originSchemaOf() as any).properties.origin.description).toContain('rate nicht');
  });
});

describe('proofreadSchemaOf', () => {
  it('asks for each passage quoted, with what it is to say instead', () => {
    const finding = (proofreadSchemaOf() as any).properties.findings.items;
    expect(Object.keys(finding.properties)).toEqual(['passage', 'correction', 'kind']);
    expect(finding.required).toEqual(['passage', 'correction', 'kind']);
  });

  it('closes the kinds to what this pass looks at', () => {
    expect((proofreadSchemaOf() as any).properties.findings.items.properties.kind.enum).toEqual([
      'spelling',
      'grammar',
      'punctuation',
    ]);
  });

  it('says that an empty list is a result, not a step that failed to answer', () => {
    expect((proofreadSchemaOf() as any).properties.findings.description).toContain('Leere Liste');
  });

  it('asks what the person decided, and requires it — an unanswered step is open', () => {
    const schema = proofreadSchemaOf() as any;
    expect(schema.properties.decision.enum).toEqual(['open', 'accepted', 'skipped']);
    expect(schema.required).toEqual(['findings', 'decision']);
  });
});

describe('enrichmentSchemaOf', () => {
  it('names the vocabulary-valued fields after the vocabularies they are looked up in', () => {
    expect(VOCABULARY_FIELD_NAMES).toEqual([
      'discipline',
      'educationalContext',
      'lrt',
      'intendedEndUserRole',
    ]);
    expect(Object.keys(propertiesOf(enrichmentSchemaOf()))).toEqual([
      ...VOCABULARY_FIELD_NAMES,
      'keywords',
      'confirmed',
    ]);
  });

  it('asks for every vocabulary field as a list, because every property it is written to holds one', () => {
    for (const field of VOCABULARY_FIELD_NAMES) {
      expect(propertiesOf(enrichmentSchemaOf())[field].type).toBe('array');
    }
  });

  it('asks each entry for the label and the URI the lookup returned', () => {
    const entry = propertiesOf(enrichmentSchemaOf())['discipline'].items;
    expect(Object.keys(entry.properties)).toEqual(['label', 'uri']);
    expect(entry.required).toEqual(['label', 'uri']);
    expect(entry.properties.uri.description).toContain('lookup_wlo_vocabulary');
  });

  it('names the vocabulary in the field\'s own description, which is what a value is looked up for', () => {
    expect(propertiesOf(enrichmentSchemaOf())['lrt'].description).toContain('lrt');
    expect(propertiesOf(enrichmentSchemaOf())['lrt'].description).toContain('Leere Liste');
  });

  it('requires every field, so one the content does not give is answered empty rather than left out', () => {
    expect((enrichmentSchemaOf() as any).required).toEqual([
      ...VOCABULARY_FIELD_NAMES,
      'keywords',
      'confirmed',
    ]);
  });
});
