import { describe, expect, it } from 'vitest';

import { PageData } from '../services/browser-extension.service';
import { pageStatementsOf } from './page-statements';

/** A page that declares about itself everything a page can. */
function aPage(overrides: Partial<PageData> = {}): PageData {
  return {
    url: 'https://beispiel.de/optik?utm_source=newsletter',
    title: 'Optik – Licht, Linsen, Spiegel | Beispiel Portal',
    mainContent:
      'Licht breitet sich geradlinig aus. Die Brechung an einer Linse lenkt es ab. ' +
      'Der Brennpunkt einer Linse liegt dort, wo sich die Strahlen treffen.',
    meta: {
      description: 'Ein Überblick über  Licht, Linsen und Spiegel.',
      keywords: 'Optik, Linse, Brechung',
      author: 'von Dr. Anna Beispiel · 3 Min. Lesezeit',
      language: 'de-DE',
      copyright: '© Beispiel Verlag',
    },
    openGraph: {
      title: null,
      description: null,
      image: 'https://beispiel.de/optik.png',
      type: 'article',
      locale: 'de_DE',
      siteName: 'Beispiel Portal',
    },
    dublinCore: { subject: 'Physik; Optik', date: '06.05.2024', rights: 'CC BY-SA 4.0' },
    lrmi: { timeRequired: 'PT45M', learningResourceType: 'Arbeitsblatt', educationalLevel: 'Sekundarstufe I' },
    license: {
      source: 'link[rel=license]',
      url: 'https://creativecommons.org/licenses/by-sa/4.0/',
      text: 'CC BY-SA 4.0',
    },
    structuredData: [
      {
        '@graph': [
          { '@type': 'Organization', name: 'Beispiel Verlag' },
          { '@type': 'BreadcrumbList', itemListElement: [] },
          {
            '@type': 'VideoObject',
            url: 'https://beispiel.de/optik',
            datePublished: '2024-05-06T11:22:33Z',
            publisher: { name: 'Beispiel Verlag' },
            keywords: ['Brennpunkt'],
            educationalAlignment: [
              { alignmentType: 'educationalSubject', targetName: 'Physik' },
              { alignmentType: 'teaches', targetName: 'Modellieren' },
            ],
            audience: { '@type': 'EducationalAudience', educationalRole: 'student' },
          },
        ],
      },
    ],
    breadcrumbs: {
      source: 'nav[breadcrumb]',
      items: [
        { text: 'Startseite', href: 'https://beispiel.de/' },
        { text: 'Naturwissenschaften', href: 'https://beispiel.de/nawi' },
      ],
    },
    tags: { source: 'rel=tag', items: ['Optik', 'Sekundarstufe I'] },
    canonical: { source: 'link[rel=canonical]', url: 'https://beispiel.de/optik' },
    alternateLanguages: { source: 'link[rel=alternate]', items: [{ language: 'en', url: 'https://beispiel.de/en/optics' }] },
    images: { ogImage: { source: 'og:image', url: 'https://beispiel.de/optik.png' } },
    headings: [{ level: 1, text: 'Optik' }, { level: 2, text: 'Brechung' }],
    ...overrides,
  };
}

describe('pageStatementsOf', () => {
  it('reads nothing off a page that could not be read at all', () => {
    expect(pageStatementsOf(null)).toBeNull();
  });

  it('cuts the site name off the title only where the tail is exactly that name', () => {
    expect(pageStatementsOf(aPage())?.title).toEqual({ value: 'Optik – Licht, Linsen, Spiegel', source: 'meta' });
    // The same separator inside a title is part of it.
    expect(pageStatementsOf(aPage({ title: 'Optik – Licht' }))?.title?.value).toBe('Optik – Licht');
    // A tail that is not the site's name stays, whatever it is.
    expect(
      pageStatementsOf(aPage({ title: 'Optik | Physik' }))?.title?.value,
    ).toBe('Optik | Physik');
  });

  it('prefers the vocabularies a page writes for a reader elsewhere over the browser tab title', () => {
    const statements = pageStatementsOf(
      aPage({ dublinCore: { title: 'Optik in der Sekundarstufe' } }),
    );
    expect(statements?.title).toEqual({ value: 'Optik in der Sekundarstufe', source: 'dc' });
  });

  it('takes the description the page states, whitespace collapsed', () => {
    expect(pageStatementsOf(aPage())?.description).toEqual({
      value: 'Ein Überblick über Licht, Linsen und Spiegel.',
      source: 'meta',
    });
  });

  it('falls through the description vocabularies in order', () => {
    const page = aPage({ meta: { description: null }, openGraph: { description: 'Aus Open Graph.' } });
    expect(pageStatementsOf(page)?.description?.source).toBe('og');
  });

  it('collects the keywords of every place the page states them, in that order', () => {
    const keywords = pageStatementsOf(aPage())?.keywords ?? [];
    expect(keywords.map((keyword) => keyword.value)).toEqual([
      'Optik', 'Linse', 'Brechung', 'Sekundarstufe I', 'Physik', 'Brennpunkt', 'Naturwissenschaften',
    ]);
    expect(keywords.find((keyword) => keyword.value === 'Naturwissenschaften')?.source).toBe('nav');
  });

  it('drops the keywords that say nothing about this content', () => {
    const page = aPage({
      meta: { keywords: 'Beispiel Portal, beispiel, 2024, Optik, Ein sehr langer Satz über die Optik und mehr' },
      tags: undefined,
      dublinCore: undefined,
      structuredData: undefined,
      breadcrumbs: { source: 'nav', items: [{ text: 'Startseite', href: '/' }] },
      title: 'Optik',
    });
    // Site name, host label, a bare number, the title itself and a five-word phrase are all refused.
    expect((pageStatementsOf(page)?.keywords ?? []).map((keyword) => keyword.value)).toEqual([]);
  });

  it('states the language as its primary subtag alone', () => {
    expect(pageStatementsOf(aPage())?.language).toEqual({ value: 'de', source: 'meta' });
    expect(pageStatementsOf(aPage({ meta: { language: 'zxx' } }))?.language?.value).toBe('de');
    expect(
      pageStatementsOf(aPage({ meta: { language: 'zxx' }, openGraph: { locale: null }, dublinCore: {} }))
        ?.language,
    ).toBeNull();
  });

  it('reads an author line as the name in it', () => {
    expect(pageStatementsOf(aPage())?.author).toEqual({ value: 'Dr. Anna Beispiel', source: 'meta' });
    // A line that is only a dateline leaves no name behind, and no other place states one.
    expect(pageStatementsOf(aPage({ meta: { author: 'von 12.03.2024' } }))?.author).toBeNull();
  });

  it('takes the publisher the page names and never its host', () => {
    expect(pageStatementsOf(aPage())?.publisher).toEqual({ value: 'Beispiel Verlag', source: 'jsonld' });
    expect(
      pageStatementsOf(aPage({ structuredData: undefined, openGraph: { siteName: null } }))?.publisher,
    ).toBeNull();
  });

  it('normalizes the publication date whichever way the page spells it', () => {
    expect(pageStatementsOf(aPage())?.published).toEqual({ value: '2024-05-06', source: 'jsonld' });
    expect(
      pageStatementsOf(aPage({ structuredData: undefined, meta: {}, semantic: undefined }))?.published,
    ).toEqual({ value: '2024-05-06', source: 'dc' });
  });

  it('reads the licence the page declares, and says that it declared it', () => {
    expect(pageStatementsOf(aPage())?.license).toEqual({
      key: 'CC_BY_SA',
      version: '4.0',
      source: 'link[rel=license]',
      declared: true,
    });
  });

  it('marks a licence found only in the running text as not declared', () => {
    const page = aPage({
      license: { source: 'body-text', text: 'CC BY 3.0' },
      dublinCore: { date: '06.05.2024' },
    });
    expect(pageStatementsOf(page)?.license).toEqual({
      key: 'CC_BY',
      version: '3.0',
      source: 'body-text',
      declared: false,
    });
  });

  it('takes the canonical address as the identifier where it differs from the page', () => {
    const page = aPage({ structuredData: undefined });
    expect(pageStatementsOf(page)?.identifier).toEqual({
      value: 'https://beispiel.de/optik',
      source: 'url',
    });
  });

  it('reads the learning time as milliseconds', () => {
    const page = aPage({ structuredData: undefined });
    expect(pageStatementsOf(page)?.learningTimeMs).toEqual({ value: 45 * 60 * 1000, source: 'lrmi' });
  });

  it('collects the page words for the vocabulary-bound fields without resolving them', () => {
    expect(pageStatementsOf(aPage())?.terms).toEqual({
      learningResourceType: ['Arbeitsblatt', 'videoobject'],
      educationalContext: ['Sekundarstufe I'],
      intendedEndUserRole: ['student'],
      discipline: ['Physik'],
    });
  });

  it('states nothing for a page that declares nothing', () => {
    const bare: PageData = { url: 'https://beispiel.de/leer', title: '' };
    const statements = pageStatementsOf(bare);
    expect(statements?.title).toBeNull();
    expect(statements?.description).toBeNull();
    expect(statements?.keywords).toEqual([]);
    expect(statements?.license).toBeNull();
    expect(statements?.published).toBeNull();
    expect(statements?.terms).toEqual({
      learningResourceType: [],
      educationalContext: [],
      intendedEndUserRole: [],
      discipline: [],
    });
  });

  it('does not throw over structured data that is not what it should be', () => {
    const page = aPage({ structuredData: ['nonsense', 42, null, { '@type': ['Article', 'LearningResource'] }] });
    expect(() => pageStatementsOf(page)).not.toThrow();
  });

  it('cuts a description at the last sentence that fits', () => {
    const sentence = 'Licht breitet sich geradlinig aus und wird an einer Linse gebrochen. ';
    const long = sentence.repeat(40);
    // Well past the 2000 the description is allowed, so the cut is the point of the test.
    expect(long.length).toBeGreaterThan(2000);

    const described = pageStatementsOf(aPage({ meta: { description: long } }))?.description?.value ?? '';

    expect(described.length).toBeLessThanOrEqual(2000);
    expect(described.endsWith('gebrochen.')).toBe(true);
    expect(described.endsWith('…')).toBe(false);
  });

  it('cuts one that has no sentence end in it with an ellipsis instead', () => {
    const long = 'Optik '.repeat(400);

    const described = pageStatementsOf(aPage({ meta: { description: long } }))?.description?.value ?? '';

    expect(described.length).toBeLessThanOrEqual(2001);
    expect(described.endsWith('…')).toBe(true);
  });

  it('has no host for a page whose address is none', () => {
    // The canonical address goes too: it is what the host is read off where the page names one.
    const nowhere = aPage({ url: 'nicht mal eine Adresse', canonical: undefined });

    expect(pageStatementsOf(nowhere)?.host).toBeNull();
  });
});
