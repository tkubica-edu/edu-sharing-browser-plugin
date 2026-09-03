import { describe, expect, it } from 'vitest';

import {
  DerivedField, derivedPayload, inferredFields, mergeDerived, pageTermsEnvelope, pageTermsOf,
  rejectedFields, statedFields
} from './derived-metadata';
import { PageStatements } from './page-statements';
import { mapAgentFields } from './agent-fields';

/** Statements of a page that declares its own metadata. */
function statements(overrides: Partial<PageStatements> = {}): PageStatements {
  return {
    url: 'https://beispiel.de/optik',
    canonicalUrl: 'https://beispiel.de/optik',
    host: 'beispiel.de',
    siteName: 'Beispiel Portal',
    title: { value: 'Optik', source: 'meta' },
    description: { value: 'Ein Überblick über Licht.', source: 'meta' },
    keywords: [
      { value: 'Optik', source: 'meta' },
      { value: 'Naturwissenschaften', source: 'nav' },
    ],
    language: { value: 'de', source: 'meta' },
    author: { value: 'Dr. Anna Beispiel', source: 'meta' },
    publisher: { value: 'Beispiel Verlag', source: 'jsonld' },
    published: { value: '2024-05-06', source: 'jsonld' },
    license: { key: 'CC_BY_SA', version: '4.0', source: 'link[rel=license]', declared: true },
    identifier: null,
    learningTimeMs: { value: 2_700_000, source: 'lrmi' },
    imageUrl: 'https://beispiel.de/optik.png',
    contentText: 'Licht breitet sich geradlinig aus. Die Brechung an einer Linse lenkt es ab und trifft sich im Brennpunkt.',
    headings: ['Optik'],
    terms: { learningResourceType: ['Arbeitsblatt'], educationalContext: [], intendedEndUserRole: [], discipline: [] },
    ...overrides,
  };
}

describe('statedFields', () => {
  it('states what the page declares, each with the place it was read', () => {
    const fields = statedFields(statements());
    const byProperty = Object.fromEntries(fields.map((field) => [field.property, field]));
    expect(byProperty['cclom:general_description'].values).toEqual(['Ein Überblick über Licht.']);
    expect(byProperty['cclom:general_language'].values).toEqual(['de']);
    expect(byProperty['ccm:author_freetext'].values).toEqual(['Dr. Anna Beispiel']);
    expect(byProperty['schema:datePublished'].values).toEqual(['2024-05-06']);
    expect(byProperty['ccm:wwwurl'].values).toEqual(['https://beispiel.de/optik']);
    expect(fields.every((field) => field.standing === 'stated')).toBe(true);
  });

  it('takes over only the keywords the page states for itself, not its own navigation', () => {
    const keywords = statedFields(statements()).find((field) => field.property === 'cclom:general_keyword');
    expect(keywords?.values).toEqual(['Optik']);
  });

  it('writes the licence only where the page declared it as its own', () => {
    const declared = statedFields(statements());
    expect(declared.find((field) => field.property === 'ccm:commonlicense_key')?.values).toEqual(['CC_BY_SA']);
    expect(declared.find((field) => field.property === 'ccm:commonlicense_cc_version')?.values).toEqual(['4.0']);

    const mentioned = statedFields(
      statements({ license: { key: 'CC_BY', version: null, source: 'body-text', declared: false } }),
    );
    expect(mentioned.some((field) => field.property.startsWith('ccm:commonlicense'))).toBe(false);
  });

  it('leaves the licence block complete once the field mapping has run', () => {
    const { values } = derivedPayload(statedFields(statements()));
    const mapped = mapAgentFields(values);
    expect(mapped['ccm:commonlicense_ai_allow_usage']).toEqual(['true']);
    expect(mapped['ccm:commonlicense_ai_generated']).toEqual(['false']);
  });
});

describe('inferredFields', () => {
  it('offers what was derived only for properties the page states nothing for', () => {
    const settled = statedFields(statements()).map((field) => field.property);
    const inferred = inferredFields(statements(), settled, ['Brennpunkt']);
    // The page states keywords and a description, so neither is proposed again.
    expect(inferred.some((field) => field.property === 'cclom:general_keyword')).toBe(false);
    expect(inferred.some((field) => field.property === 'cclom:general_description')).toBe(false);
    // The learning time is a reading of the page's own `timeRequired`, so it is stated, not derived.
    expect(inferred.some((field) => field.property === 'cclom:typicallearningtime')).toBe(false);
    expect(
      statedFields(statements()).find((field) => field.property === 'cclom:typicallearningtime')?.values,
    ).toEqual(['2700000']);
  });

  it('proposes keywords and a description for a page that declares neither', () => {
    const bare = statements({ keywords: [{ value: 'Naturwissenschaften', source: 'nav' }], description: null });
    const inferred = inferredFields(bare, ['cclom:title'], ['Brechung']);
    expect(inferred.find((field) => field.property === 'cclom:general_keyword')?.values).toEqual([
      'Naturwissenschaften', 'Brechung',
    ]);
    expect(inferred.find((field) => field.property === 'cclom:general_description')?.values[0]).toMatch(
      /^Licht breitet sich/,
    );
    expect(inferred.every((field) => field.standing === 'inferred')).toBe(true);
  });
});

describe('rejectedFields', () => {
  it('reports a licence that was found but is not the page’s own declaration', () => {
    const rejected = rejectedFields(
      statements({ license: { key: 'CC_BY', version: null, source: 'body-text', declared: false } }),
    );
    expect(rejected).toEqual([
      {
        property: 'ccm:commonlicense_key',
        values: ['CC_BY'],
        reason: 'nur im Seitentext belegt (body-text), nicht als Lizenz der Seite ausgezeichnet',
      },
    ]);
  });

  it('reports nothing where the page declared its licence', () => {
    expect(rejectedFields(statements())).toEqual([]);
  });
});

describe('mergeDerived', () => {
  it('keeps the first mention of a property, so the order is the precedence', () => {
    const fields: DerivedField[] = [
      { property: 'cclom:general_description', values: ['Von der Seite'], source: 'meta', standing: 'stated', evidence: '' },
      { property: 'cclom:general_description', values: ['Vom Repository'], source: 'website-info', standing: 'stated', evidence: '' },
    ];
    expect(mergeDerived(fields).map((field) => field.values[0])).toEqual(['Von der Seite']);
  });
});

describe('derivedPayload', () => {
  it('marks only the derived fields, so the stated ones read as decided', () => {
    // A page that declares neither keywords nor a description, so both are derived from its text.
    const bare = statements({ keywords: [], description: null });
    const stated = statedFields(bare);
    const inferred = inferredFields(bare, stated.map((field) => field.property), ['Brechung']);
    const { values, origins } = derivedPayload([...stated, ...inferred]);
    expect(values['cclom:general_language']).toEqual(['de']);
    expect(origins).toEqual({
      'cclom:general_keyword': 'page',
      'cclom:general_description': 'page'
    });
  });

  it('drops a proposal whose widget cannot show one, and says so', () => {
    const inferred = inferredFields(statements(), ['cclom:title'], ['Brechung']);
    const { values, report } = derivedPayload(inferred, [], (property) => property !== 'cclom:general_keyword');
    expect(values['cclom:general_keyword']).toBeUndefined();
    expect(report.rejected).toContainEqual({
      property: 'cclom:general_keyword',
      values: expect.anything(),
      reason: 'im Formular nicht als Vorschlag anzeigbar',
    });
  });

  it('never promotes a dropped proposal to a value', () => {
    const inferred = inferredFields(statements(), ['cclom:title'], ['Brechung']);
    const { values } = derivedPayload(inferred, [], () => false);
    expect(Object.keys(values)).toEqual([]);
  });
});

describe('pageTermsEnvelope', () => {
  it('carries the page’s own words under a key no widget can reach', () => {
    const envelope = pageTermsEnvelope({
      learningResourceType: ['Arbeitsblatt'],
      educationalContext: [],
      intendedEndUserRole: [],
      discipline: ['Physik'],
    });
    expect(envelope).toEqual({
      _page_terms: { learningResourceType: ['Arbeitsblatt'], discipline: ['Physik'] },
    });
    expect(Object.keys(envelope).every((key) => !key.includes(':'))).toBe(true);
    expect(pageTermsOf(envelope)).toEqual({
      learningResourceType: ['Arbeitsblatt'],
      discipline: ['Physik'],
    });
  });

  it('carries nothing where the page named no such word', () => {
    expect(
      pageTermsEnvelope({ learningResourceType: [], educationalContext: [], intendedEndUserRole: [], discipline: [] }),
    ).toEqual({});
    expect(pageTermsOf(null)).toEqual({});
  });
});
