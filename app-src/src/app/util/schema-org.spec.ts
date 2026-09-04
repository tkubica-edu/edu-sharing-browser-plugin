import { describe, expect, it } from 'vitest';

import { SchemaEntity, primaryEntity, schemaClaimsOf, schemaEntitiesOf } from './schema-org';

const PAGE = 'https://example.org/optik';

describe('schemaEntitiesOf', () => {
  it('reads the entity a block states', () => {
    expect(schemaEntitiesOf([{ '@type': 'Article', headline: 'Optik' }])).toEqual([
      { '@type': 'Article', headline: 'Optik' },
    ]);
  });

  it('reads every entity of a block\'s graph, in the order the page wrote them', () => {
    const entities = schemaEntitiesOf([
      { '@context': 'https://schema.org', '@graph': [{ '@type': 'Organization' }, { '@type': 'Article' }] },
    ]);
    expect(entities.map((entity) => entity['@type'])).toEqual(['Organization', 'Article']);
  });

  it('reads a block that is itself a list of entities', () => {
    const entities = schemaEntitiesOf([[{ '@type': 'WebSite' }, { '@type': 'Course' }]]);
    expect(entities.map((entity) => entity['@type'])).toEqual(['WebSite', 'Course']);
  });

  it('reads the thing a page names as what it is about', () => {
    const entities = schemaEntitiesOf([
      { '@type': 'WebPage', mainEntity: { '@type': 'LearningResource', name: 'Optik' } },
    ]);
    expect(entities.map((entity) => entity['@type'])).toEqual(['WebPage', 'LearningResource']);
  });

  it('reads several blocks as the entities of one page', () => {
    expect(schemaEntitiesOf([{ '@type': 'Organization' }, { '@type': 'Article' }])).toHaveLength(2);
  });

  it('leaves out a block that states no kind, because nothing can be told about it', () => {
    expect(schemaEntitiesOf([{ headline: 'Optik' }, { '@type': 'Article' }])).toEqual([
      { '@type': 'Article' },
    ]);
  });

  it('reads a page that carries no JSON-LD as carrying no entities', () => {
    expect(schemaEntitiesOf(null)).toEqual([]);
    expect(schemaEntitiesOf(undefined)).toEqual([]);
    expect(schemaEntitiesOf([])).toEqual([]);
    expect(schemaEntitiesOf(['nicht einmal ein objekt', 7, null])).toEqual([]);
  });

  it('stops descending before a nesting deep enough to be a loop', () => {
    let nested: unknown = { '@type': 'Article' };
    for (let level = 0; level < 10; level += 1) nested = { '@type': 'WebPage', mainEntity: nested };
    expect(schemaEntitiesOf([nested]).length).toBeLessThan(10);
  });
});

describe('primaryEntity', () => {
  it('takes the entity whose own address is the page\'s', () => {
    const entities: SchemaEntity[] = [
      { '@type': 'Course', name: 'Ein anderer Kurs', url: 'https://example.org/akustik' },
      { '@type': 'Article', name: 'Optik', url: PAGE },
    ];
    expect(primaryEntity(entities, PAGE)?.['name']).toBe('Optik');
  });

  it('recognises that address however the page spells its trailing slash or fragment', () => {
    const entities: SchemaEntity[] = [
      { '@type': 'Course', name: 'Ein anderer Kurs' },
      { '@type': 'Article', name: 'Optik', '@id': `${PAGE}/#article` },
    ];
    expect(primaryEntity(entities, `${PAGE}#linsen`)?.['name']).toBe('Optik');
  });

  it('takes the first entity describing a resource where none states the page\'s address', () => {
    const entities: SchemaEntity[] = [
      { '@type': 'Organization', name: 'Der Verlag' },
      { '@type': 'BreadcrumbList' },
      { '@type': 'Article', name: 'Optik' },
      { '@type': 'Course', name: 'Ein Kurs' },
    ];
    expect(primaryEntity(entities, PAGE)?.['name']).toBe('Optik');
  });

  it('never takes the site around the content for the content', () => {
    const entities: SchemaEntity[] = [
      { '@type': 'Organization', name: 'Der Verlag', url: PAGE },
      { '@type': 'WebSite', name: 'Die Seite' },
    ];
    expect(primaryEntity(entities, PAGE)).toBeNull();
  });

  it('takes an entity that is a resource as well as its surroundings', () => {
    const entities: SchemaEntity[] = [{ '@type': ['WebPage', 'LearningResource'], name: 'Optik' }];
    expect(primaryEntity(entities, PAGE)?.['name']).toBe('Optik');
  });

  it('reads a namespaced kind as the kind it is', () => {
    const entities: SchemaEntity[] = [{ '@type': 'https://schema.org/Organization', name: 'Der Verlag' }];
    expect(primaryEntity(entities, PAGE)).toBeNull();
  });

  it('takes the first resource where the page has no address to compare against', () => {
    const entities: SchemaEntity[] = [{ '@type': 'Article', name: 'Optik', url: PAGE }];
    expect(primaryEntity(entities, null)?.['name']).toBe('Optik');
  });

  it('takes nothing out of a page that carries no JSON-LD', () => {
    expect(primaryEntity([], PAGE)).toBeNull();
  });
});

describe('schemaClaimsOf', () => {
  it('reads what the entity says about the resource', () => {
    expect(
      schemaClaimsOf({
        '@type': 'LearningResource',
        description: 'Eine Einführung in die Optik.',
        inLanguage: 'de',
        datePublished: '2024-05-06T08:00:00Z',
        isAccessibleForFree: true,
      }),
    ).toMatchObject({
      description: 'Eine Einführung in die Optik.',
      language: 'de',
      published: '2024-05-06',
      freeToAccess: true,
      types: ['learningresource'],
    });
  });

  it('falls back through the dates a page states its publication in', () => {
    expect(schemaClaimsOf({ dateCreated: '2024-05-06' }).published).toBe('2024-05-06');
    expect(schemaClaimsOf({ uploadDate: '06.05.2024' }).published).toBe('2024-05-06');
    expect(
      schemaClaimsOf({ datePublished: '2024-05-06', dateCreated: '2020-01-01' }).published,
    ).toBe('2024-05-06');
  });

  it('collects the keywords out of every field that names a subject', () => {
    expect(
      schemaClaimsOf({
        keywords: ['Optik', 'Licht'],
        about: [{ '@type': 'Thing', name: 'Brechung' }, 'Linsen'],
        teaches: 'Strahlengang',
      }).keywords,
    ).toEqual(['Optik', 'Licht', 'Brechung', 'Linsen', 'Strahlengang']);
  });

  it('reads a keyword list the page wrote as one string as the one keyword it is', () => {
    expect(schemaClaimsOf({ keywords: 'Optik, Licht' }).keywords).toEqual(['Optik, Licht']);
  });

  it('reads an author however the page states it', () => {
    expect(schemaClaimsOf({ author: 'Ada Lovelace' }).author).toBe('Ada Lovelace');
    expect(schemaClaimsOf({ author: { '@type': 'Person', name: 'Ada Lovelace' } }).author).toBe(
      'Ada Lovelace',
    );
    expect(schemaClaimsOf({ author: [{ name: 'Ada Lovelace' }, 'Charles Babbage'] }).author).toBe(
      'Ada Lovelace, Charles Babbage',
    );
    expect(schemaClaimsOf({}).author).toBeNull();
  });

  it('falls back through the fields a page names its publisher in', () => {
    expect(schemaClaimsOf({ provider: { name: 'Der Verlag' } }).publisher).toBe('Der Verlag');
    expect(schemaClaimsOf({ sourceOrganization: 'Der Verlag' }).publisher).toBe('Der Verlag');
    expect(
      schemaClaimsOf({ publisher: { name: 'Der Verlag' }, provider: { name: 'Ein anderer' } }).publisher,
    ).toBe('Der Verlag');
  });

  it('never reads the publisher as the author', () => {
    expect(schemaClaimsOf({ publisher: { name: 'Der Verlag' } }).author).toBeNull();
  });

  it('reads the licence as the address it is stated under', () => {
    expect(schemaClaimsOf({ license: 'https://creativecommons.org/licenses/by/4.0/' }).licenseUrl).toBe(
      'https://creativecommons.org/licenses/by/4.0/',
    );
    expect(
      schemaClaimsOf({ license: { '@id': 'https://creativecommons.org/licenses/by-sa/4.0/' } }).licenseUrl,
    ).toBe('https://creativecommons.org/licenses/by-sa/4.0/');
    expect(schemaClaimsOf({ usageInfo: 'https://example.org/nutzung' }).licenseUrl).toBe(
      'https://example.org/nutzung',
    );
  });

  it('reads no licence out of a label that names no address', () => {
    expect(schemaClaimsOf({ license: 'CC BY 4.0' }).licenseUrl).toBeNull();
  });

  it('reads the identifier that names the work rather than the page', () => {
    expect(schemaClaimsOf({ doi: '10.1000/182' }).identifier).toBe('doi:10.1000/182');
    expect(schemaClaimsOf({ doi: 'https://doi.org/10.1000/182' }).identifier).toBe(
      'https://doi.org/10.1000/182',
    );
    expect(schemaClaimsOf({ isbn: '978-3-16-148410-0' }).identifier).toBe('isbn:978-3-16-148410-0');
    expect(schemaClaimsOf({ identifier: 'X-42' }).identifier).toBe('X-42');
    expect(schemaClaimsOf({ identifier: { '@type': 'PropertyValue', value: 'X-42' } }).identifier).toBe('X-42');
    expect(schemaClaimsOf({}).identifier).toBeNull();
  });

  it('reads the learning time out of whichever duration the page states', () => {
    expect(schemaClaimsOf({ timeRequired: 'PT45M' }).learningTimeMs).toBe(45 * 60 * 1000);
    expect(schemaClaimsOf({ totalTime: 'PT1H' }).learningTimeMs).toBe(60 * 60 * 1000);
    expect(schemaClaimsOf({ duration: 'PT90S' }).learningTimeMs).toBe(90 * 1000);
    expect(schemaClaimsOf({}).learningTimeMs).toBeNull();
  });

  it('states nothing about the price where the page states nothing', () => {
    expect(schemaClaimsOf({}).freeToAccess).toBeNull();
    expect(schemaClaimsOf({ isAccessibleForFree: 'true' }).freeToAccess).toBeNull();
    expect(schemaClaimsOf({ isAccessibleForFree: false }).freeToAccess).toBe(false);
  });

  it('reads the audience whichever way the page nests it', () => {
    const claims = schemaClaimsOf({
      audience: [{ '@type': 'EducationalAudience', educationalRole: 'Lehrkraft', educationalLevel: 'Sekundarstufe I' }],
      educationalLevel: { name: 'Klasse 7' },
    });
    expect(claims.educationalRoles).toEqual(['Lehrkraft']);
    expect(claims.educationalLevels).toEqual(['Klasse 7', 'Sekundarstufe I']);
  });

  it('reads the subject out of an alignment, and only out of one that names a subject', () => {
    expect(
      schemaClaimsOf({
        educationalAlignment: [
          { '@type': 'AlignmentObject', alignmentType: 'educationalSubject', targetName: 'Physik' },
          { '@type': 'AlignmentObject', alignmentType: 'teaches', targetName: 'Strahlengang' },
          { alignmentType: 'subject', targetName: 'Optik' },
        ],
      }).subjects,
    ).toEqual(['Physik', 'Optik']);
  });

  it('takes the LRMI tags beside the entity, which state the same kinds of thing', () => {
    const claims = schemaClaimsOf(
      { learningResourceType: 'Arbeitsblatt' },
      { learningResourceType: 'worksheet', educationalLevel: 'Sekundarstufe I', educationalUse: 'instruction' },
    );
    expect(claims.learningResourceTypes).toEqual(['Arbeitsblatt', 'worksheet']);
    expect(claims.educationalLevels).toEqual(['Sekundarstufe I']);
    expect(claims.educationalRoles).toEqual(['instruction']);
  });

  it('does not read the LRMI duration as a claim of the entity', () => {
    expect(schemaClaimsOf({}, { timeRequired: 'PT45M' }).learningTimeMs).toBeNull();
  });

  it('describes a page whose JSON-LD says nothing about its content as claiming nothing', () => {
    expect(schemaClaimsOf(null)).toEqual({
      description: null,
      keywords: [],
      author: null,
      publisher: null,
      published: null,
      language: null,
      licenseUrl: null,
      identifier: null,
      learningTimeMs: null,
      freeToAccess: null,
      types: [],
      learningResourceTypes: [],
      educationalLevels: [],
      educationalRoles: [],
      subjects: [],
    });
  });
});
