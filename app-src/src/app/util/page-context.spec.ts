import { describe, expect, it } from 'vitest';

import {
  CONTENT_TEXT_MAX,
  PageContext,
  contentContextOf,
  contentTextRoom,
  pageContextOf,
  sameSubject,
} from './page-context';

const REPO = 'https://repo.example.org/edu-sharing';
const NODE = '2c4d6b1a-8f3e-4c2b-9a10-7d5e6f8b0c31';
const COLLECTION = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

describe('pageContextOf', () => {
  it('describes every page by its address and its host', () => {
    const context = pageContextOf('https://example.org/optik?a=1#linsen');
    expect(context?.page_url).toBe('https://example.org/optik?a=1#linsen');
    expect(context?.page_host).toBe('example.org');
  });

  it('passes the tab title on as what the page says it is about', () => {
    expect(pageContextOf('https://example.org/optik', '  Optik – Licht und Linsen  ')?.page_text).toBe(
      'Optik – Licht und Linsen',
    );
  });

  it('cuts a title long enough to take over the prompt', () => {
    expect(pageContextOf('https://example.org/x', 'a'.repeat(500))?.page_text).toHaveLength(300);
  });

  it('states no text for a tab that reports none', () => {
    expect(pageContextOf('https://example.org/optik')).not.toHaveProperty('page_text');
    expect(pageContextOf('https://example.org/optik', '   ')).not.toHaveProperty('page_text');
  });

  it('recognises the content a render page shows', () => {
    expect(pageContextOf(`${REPO}/components/render/${NODE}`)).toMatchObject({
      page_kind: 'content',
      node_id: NODE,
      detection_source: 'url:components/render',
    });
  });

  it('recognises the collection an open collection page shows, and what was searched inside it', () => {
    expect(pageContextOf(`${REPO}/components/collections?id=${COLLECTION}&q=optik`)).toMatchObject({
      page_kind: 'collection',
      collection_id: COLLECTION,
      search_query: 'optik',
      detection_source: 'url:/components/collections?id',
    });
  });

  it('recognises the collection a topic page is built on', () => {
    expect(pageContextOf(`${REPO}/components/topic-pages?collectionId=${COLLECTION}`)).toMatchObject({
      page_kind: 'topic',
      collection_id: COLLECTION,
      detection_source: 'url:/components/topic-pages',
    });
  });

  it('recognises a node named as a parameter, however the page spells the parameter', () => {
    for (const parameter of ['node', 'node_id', 'nodeId']) {
      expect(pageContextOf(`https://example.org/seite?${parameter}=${NODE}`)).toMatchObject({
        page_kind: 'content',
        node_id: NODE,
        detection_source: 'url:?node',
      });
    }
  });

  it('recognises a collection named as a parameter, however the page spells the parameter', () => {
    for (const parameter of ['collection', 'collection_id', 'collectionId']) {
      expect(pageContextOf(`https://example.org/seite?${parameter}=${COLLECTION}`)).toMatchObject({
        page_kind: 'collection',
        collection_id: COLLECTION,
        detection_source: 'url:?collection',
      });
    }
  });

  it('recognises a topic page by its slug', () => {
    expect(pageContextOf('https://wirlernenonline.de/themenseite/optik/')).toMatchObject({
      page_kind: 'topic',
      topic_page_slug: 'optik',
      detection_source: 'url:/themenseite',
    });
  });

  it('recognises a subject portal, and the topic page it carries inside it', () => {
    expect(pageContextOf('https://wirlernenonline.de/fachportal/physik')).toMatchObject({
      page_kind: 'subject',
      subject_slug: 'physik',
      detection_source: 'url:/fachportal',
    });
    expect(pageContextOf('https://wirlernenonline.de/fachportal/physik/optik')).toMatchObject({
      page_kind: 'subject',
      subject_slug: 'physik',
      topic_page_slug: 'optik',
      detection_source: 'url:/fachportal/<slug>',
    });
  });

  it('recognises the repository\'s search page, with or without a term', () => {
    expect(pageContextOf(`${REPO}/components/search?q=optik`)).toMatchObject({
      page_kind: 'search',
      search_query: 'optik',
      detection_source: 'url:/components/search',
    });
    const empty = pageContextOf(`${REPO}/components/search`);
    expect(empty?.page_kind).toBe('search');
    expect(empty).not.toHaveProperty('search_query');
  });

  it('recognises any page searching for something, however it spells the parameter', () => {
    for (const parameter of ['q', 'search', 'query']) {
      expect(pageContextOf(`https://example.org/s?${parameter}=optik`)).toMatchObject({
        page_kind: 'search',
        search_query: 'optik',
        detection_source: 'url:?q',
      });
    }
  });

  it('passes on no search term that says nothing, and no term that is not one', () => {
    expect(pageContextOf('https://example.org/s?q=a')?.page_kind).toBe('other');
    expect(pageContextOf(`https://example.org/s?q=${'a'.repeat(201)}`)?.page_kind).toBe('other');
  });

  it('takes the more precise page where two rules could match', () => {
    expect(pageContextOf(`${REPO}/components/render/${NODE}?q=optik`)?.page_kind).toBe('content');
    expect(
      pageContextOf(`${REPO}/components/collections?id=${COLLECTION}&node=${NODE}`)?.page_kind,
    ).toBe('collection');
  });

  it('describes a page no rule matches as some other page', () => {
    expect(pageContextOf('https://example.org/impressum')).toMatchObject({ page_kind: 'other' });
    expect(pageContextOf('https://example.org/impressum')).not.toHaveProperty('detection_source');
  });

  it('refuses an id that only looks like a node id', () => {
    expect(pageContextOf(`${REPO}/components/render/2c4d6b1a-8f3e-4c2b-9a10-7d5e6f8b0c3z`)?.page_kind).toBe(
      'other',
    );
    expect(pageContextOf(`${REPO}/components/collections?id=-home-`)?.page_kind).toBe('other');
  });

  it('describes no page for a tab that shows none', () => {
    expect(pageContextOf(null)).toBeNull();
    expect(pageContextOf('')).toBeNull();
    expect(pageContextOf('about:blank')).toBeNull();
    expect(pageContextOf('chrome://extensions')).toBeNull();
    expect(pageContextOf('nicht einmal eine adresse')).toBeNull();
  });
});

describe('contentTextRoom', () => {
  it('is the whole budget for a content that has no title to spend it on', () => {
    expect(contentTextRoom(null)).toBe(CONTENT_TEXT_MAX);
    expect(contentTextRoom('   ')).toBe(CONTENT_TEXT_MAX);
  });

  it('is what is left once the title and the blank line behind it have taken their share', () => {
    expect(contentTextRoom('Optik')).toBe(CONTENT_TEXT_MAX - 7);
  });

  it('never falls below nothing, however long the title', () => {
    expect(contentTextRoom('a'.repeat(CONTENT_TEXT_MAX + 100))).toBe(0);
  });
});

describe('contentContextOf', () => {
  it('names the content as the page it is, once it has a node of its own', () => {
    expect(contentContextOf({ nodeId: NODE, collectionId: COLLECTION, title: 'Optik' })).toMatchObject({
      page_kind: 'content',
      node_id: NODE,
      collection_id: COLLECTION,
      detection_source: 'panel:content',
    });
  });

  it('names no page for a content not yet saved, so the collection is not checked in its place', () => {
    const context = contentContextOf({ collectionId: COLLECTION, title: 'Optik', text: 'Der Artikel.' });
    expect(context.page_kind).toBe('other');
    expect(context).not.toHaveProperty('node_id');
    expect(context.collection_id).toBe(COLLECTION);
  });

  it('states the collection either way, because it is what the skills are looked up by', () => {
    expect(contentContextOf({ nodeId: NODE, collectionId: COLLECTION }).collection_id).toBe(COLLECTION);
    expect(contentContextOf({ collectionId: COLLECTION }).collection_id).toBe(COLLECTION);
  });

  it('reads a blank id as none stated', () => {
    const context = contentContextOf({ nodeId: '  ', collectionId: '  ' });
    expect(context.page_kind).toBe('other');
    expect(context).not.toHaveProperty('node_id');
    expect(context).not.toHaveProperty('collection_id');
  });

  it('lets the title lead the text, so it survives where the text is cut off', () => {
    expect(contentContextOf({ title: 'Optik', text: 'Der Artikel selbst.' }).page_text).toBe(
      'Optik\n\nDer Artikel selbst.',
    );
  });

  it('states whichever of the two there is', () => {
    expect(contentContextOf({ title: 'Optik' }).page_text).toBe('Optik');
    expect(contentContextOf({ text: 'Der Artikel selbst.' }).page_text).toBe('Der Artikel selbst.');
    expect(contentContextOf({})).not.toHaveProperty('page_text');
  });

  it('cuts the content\'s text at the budget the chatbot backend gives the field', () => {
    const context = contentContextOf({ title: 'Optik', text: 'x'.repeat(CONTENT_TEXT_MAX) });
    expect(context.page_text).toHaveLength(CONTENT_TEXT_MAX);
    expect(context.page_text?.startsWith('Optik\n\n')).toBe(true);
  });

  it('carries the page the content was erschlossen from, where one is known', () => {
    expect(contentContextOf({ url: 'https://example.org/optik' })).toMatchObject({
      page_url: 'https://example.org/optik',
      page_host: 'example.org',
    });
  });

  it('carries no address for a content whose source is none', () => {
    expect(contentContextOf({ url: 'about:blank' })).not.toHaveProperty('page_url');
    expect(contentContextOf({ url: 'keine adresse' })).not.toHaveProperty('page_url');
    expect(contentContextOf({ url: null })).not.toHaveProperty('page_url');
  });
});

describe('sameSubject', () => {
  const of = (context: Partial<PageContext>): PageContext => ({ page_kind: 'other', ...context });

  it('calls two contexts the same where only the address differs', () => {
    expect(
      sameSubject(
        of({ page_kind: 'content', node_id: NODE, page_url: `${REPO}/components/render/${NODE}` }),
        of({ page_kind: 'content', node_id: NODE, page_url: `${REPO}/components/render/${NODE}?v=2` }),
      ),
    ).toBe(true);
  });

  it('tells two contexts apart by any of the fields the assistant works from', () => {
    expect(sameSubject(of({ page_kind: 'content' }), of({ page_kind: 'collection' }))).toBe(false);
    expect(sameSubject(of({ node_id: NODE }), of({ node_id: COLLECTION }))).toBe(false);
    expect(sameSubject(of({ collection_id: COLLECTION }), of({}))).toBe(false);
    expect(sameSubject(of({ topic_page_slug: 'optik' }), of({ topic_page_slug: 'akustik' }))).toBe(false);
    expect(sameSubject(of({ subject_slug: 'physik' }), of({ subject_slug: 'chemie' }))).toBe(false);
    expect(sameSubject(of({ search_query: 'optik' }), of({ search_query: 'akustik' }))).toBe(false);
  });

  it('does not read the page text as part of the subject', () => {
    expect(sameSubject(of({ page_text: 'Optik' }), of({ page_text: 'Akustik' }))).toBe(true);
  });
});
