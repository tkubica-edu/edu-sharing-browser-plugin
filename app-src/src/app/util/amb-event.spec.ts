import { describe, expect, it } from 'vitest';

import { AmbSource, ambToNostrTags, toAmbEvent, toAmbResource } from './amb-event';

/** A content described as fully as the WLO metadata set describes one, in the shapes the panel holds. */
function aSource(overrides: Partial<AmbSource> = {}): AmbSource {
  return {
    metadata: {
      'cclom:title': ['Optik – Licht, Linsen, Spiegel'],
      'cclom:general_description': ['Eine Einführung in die geometrische Optik.'],
      'cclom:general_keyword': ['Optik', 'Linsen'],
      'cclom:general_language': ['de'],
      'ccm:wwwurl': ['https://mediawiki.openeduhub.de/index.php/Optik'],
      'ccm:author_freetext': ['Ada Lovelace'],
      'ccm:oeh_publisher_combined': ['Wikimedia Foundation, Inc.'],
      'ccm:commonlicense_key': ['CC_BY_SA'],
      'ccm:commonlicense_cc_version': ['4.0'],
      'ccm:taxonid': ['http://w3id.org/openeduhub/vocabs/discipline/380'],
      'ccm:educationalcontext': ['http://w3id.org/openeduhub/vocabs/educationalContext/schule'],
      'ccm:oeh_lrt': ['http://w3id.org/openeduhub/vocabs/new_lrt/d8c3ef03'],
      'schema:datePublished': ['2024-05-06'],
    },
    url: 'https://mediawiki.openeduhub.de/index.php/Optik',
    title: 'Optik',
    imageUrl: 'https://example.org/optik.png',
    nodeLink: 'https://repo.example/edu-sharing/components/render/node-1',
    repositoryUrl: 'https://repo.example/edu-sharing',
    ...overrides,
  };
}

/** The values a tag key carries, in the order the event lists them. */
function valuesOf(tags: string[][], key: string): string[] {
  return tags.filter((tag) => tag[0] === key).map((tag) => tag[1]);
}

describe('toAmbResource', () => {
  it('describes the content by the address it lives at, not by the node that holds it', () => {
    const resource = toAmbResource(aSource());

    // The address is the identity of an AMB record — see the `d` tag it becomes.
    expect(resource?.id).toBe('https://mediawiki.openeduhub.de/index.php/Optik');
    expect(resource?.name).toBe('Optik – Licht, Linsen, Spiegel');
    expect(resource?.type).toEqual(['LearningResource']);
  });

  it('answers with nothing where the content has no address to be identified by', () => {
    expect(toAmbResource(aSource({ metadata: { 'cclom:title': ['Optik'] }, url: null, nodeLink: null })))
      .toBeNull();
  });

  it('answers with nothing where the content has no title', () => {
    expect(toAmbResource(aSource({ metadata: { 'ccm:wwwurl': ['https://example.org'] }, title: null })))
      .toBeNull();
  });

  it('turns the licence key and its version into the licence`s own address', () => {
    expect(toAmbResource(aSource())?.license).toEqual({
      id: 'https://creativecommons.org/licenses/by-sa/4.0/',
    });
  });

  it('names the two public-domain dedications, which are not licence families', () => {
    const source = aSource();
    const metadata = { ...source.metadata, 'ccm:commonlicense_key': ['CC_0'] };

    expect(toAmbResource({ ...source, metadata })?.license).toEqual({
      id: 'https://creativecommons.org/publicdomain/zero/1.0/',
    });
  });

  it('states no licence for a key it cannot name as an address, rather than a wrong one', () => {
    const source = aSource();
    const metadata = { ...source.metadata, 'ccm:commonlicense_key': ['CUSTOM'] };
    const resource = toAmbResource({ ...source, metadata });

    expect(resource?.license).toBeUndefined();
    // And with it the claim that rests on the licence.
    expect(resource?.isAccessibleForFree).toBeUndefined();
  });

  it('keeps a vocabulary value as a term where it is a URI and as a label where it is not', () => {
    const source = aSource();
    const metadata = { ...source.metadata, 'ccm:taxonid': ['Physik'] };

    expect(toAmbResource(source)?.about).toEqual([
      { id: 'http://w3id.org/openeduhub/vocabs/discipline/380', type: 'Concept' },
    ]);
    expect(toAmbResource({ ...source, metadata })?.about).toEqual([
      { prefLabel: { de: 'Physik' }, type: 'Concept' },
    ]);
  });

  it('reads the resource type from either of the two properties the set has carried it under', () => {
    const source = aSource();
    const metadata = { ...source.metadata };
    delete metadata['ccm:oeh_lrt'];
    metadata['oeh:new_lrt'] = ['http://w3id.org/openeduhub/vocabs/new_lrt/older'];

    expect(toAmbResource({ ...source, metadata })?.learningResourceType).toEqual([
      { id: 'http://w3id.org/openeduhub/vocabs/new_lrt/older', type: 'Concept' },
    ]);
  });

  it('states the node the record was read off as where the record lives', () => {
    expect(toAmbResource(aSource())?.mainEntityOfPage).toEqual([
      {
        id: 'https://repo.example/edu-sharing/components/render/node-1',
        type: 'WebPage',
        provider: { id: 'https://repo.example/edu-sharing', name: 'edu-sharing', type: 'Organization' },
      },
    ]);
  });

  it('takes a date from a timestamp and leaves the field off what is no date at all', () => {
    const source = aSource();

    expect(
      toAmbResource({
        ...source,
        metadata: { ...source.metadata, 'schema:datePublished': ['2024-05-06T11:22:33Z'] },
      })?.datePublished,
    ).toBe('2024-05-06');
    expect(
      toAmbResource({ ...source, metadata: { ...source.metadata, 'schema:datePublished': ['bald'] } })
        ?.datePublished,
    ).toBeUndefined();
  });
});

describe('ambToNostrTags', () => {
  it('opens with the three tags the relay identifies the record by', () => {
    const tags = ambToNostrTags(toAmbResource(aSource())!);

    expect(tags[0]).toEqual(['d', 'https://mediawiki.openeduhub.de/index.php/Optik']);
    expect(tags[1]).toEqual(['type', 'LearningResource']);
    expect(tags[2]).toEqual(['name', 'Optik – Licht, Linsen, Spiegel']);
  });

  it('writes keywords as the nostr-native hashtag, with their case kept', () => {
    expect(valuesOf(ambToNostrTags(toAmbResource(aSource())!), 't')).toEqual(['Optik', 'Linsen']);
  });

  it('flattens a nested field into colon-delimited keys, the label carrying its language', () => {
    const source = aSource();
    const metadata = { ...source.metadata, 'ccm:taxonid': ['Physik'] };
    const tags = ambToNostrTags(toAmbResource({ ...source, metadata })!);

    expect(tags).toContainEqual(['about:prefLabel:de', 'Physik']);
    expect(tags).toContainEqual(['about:type', 'Concept']);
    expect(tags).toContainEqual(['learningResourceType:id', 'http://w3id.org/openeduhub/vocabs/new_lrt/d8c3ef03']);
    expect(tags).toContainEqual(['creator:name', 'Ada Lovelace']);
    expect(tags).toContainEqual(['creator:type', 'Person']);
    expect(tags).toContainEqual(['publisher:type', 'Organization']);
  });

  it('repeats the record`s own address as the nostr-native reference tag', () => {
    expect(ambToNostrTags(toAmbResource(aSource())!)).toContainEqual([
      'r',
      'https://repo.example/edu-sharing/components/render/node-1',
    ]);
  });

  it('leaves out every field the content does not state', () => {
    const tags = ambToNostrTags(
      toAmbResource({
        ...aSource(),
        metadata: { 'cclom:title': ['Optik'], 'ccm:wwwurl': ['https://example.org/optik'] },
        imageUrl: null,
        nodeLink: null,
      })!,
    );

    expect(tags.map((tag) => tag[0])).toEqual(['d', 'type', 'name']);
  });
});

describe('toAmbEvent', () => {
  it('publishes under the kind the AMB relay serves, with the description as its text', () => {
    const event = toAmbEvent(toAmbResource(aSource())!, 1_750_000_000);

    expect(event.kind).toBe(30142);
    expect(event.created_at).toBe(1_750_000_000);
    // AMB asks for the description in `content` too, for the clients that render nothing else.
    expect(event.content).toBe('Eine Einführung in die geometrische Optik.');
  });

  it('carries an empty text for a content that describes itself nowhere', () => {
    const event = toAmbEvent(
      toAmbResource({
        ...aSource(),
        metadata: { 'cclom:title': ['Optik'], 'ccm:wwwurl': ['https://example.org/optik'] },
      })!,
      1,
    );

    expect(event.content).toBe('');
  });
});
