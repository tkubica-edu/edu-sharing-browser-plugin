import { TestBed } from '@angular/core/testing';
import { ClientutilsV1Service } from 'ngx-edu-sharing-api';
import { describe, expect, it } from 'vitest';

import { PageDerivationService } from './page-derivation.service';
import { PageData } from './browser-extension.service';
import { fakeClientUtils } from '../../testing/fakes';
import { provideFake } from '../../testing/provide-fake';

/**
 * A page exactly as `content/content.js` returned it for a real DOM — the shapes and the `null`s are the
 * extraction's own, not a hand-made ideal. It is here so a change to either side has to meet the other:
 * the extraction and the reading of it are two files that only ever meet at run time otherwise.
 */
const EXTRACTED: PageData = {
  url: 'https://beispiel.de/optik?utm_source=x',
  title: 'Optik – Licht, Linsen, Spiegel | Beispiel Portal',
  meta: {
    description: 'Ein Überblick über Licht, Linsen und Spiegel.',
    keywords: 'Optik, Linse, Brechung',
    author: 'von Dr. Anna Beispiel · 3 Min. Lesezeit',
    language: 'de-DE',
    copyright: null,
    publishedTime: '2024-05-06T11:22:33Z',
  },
  openGraph: {
    title: null,
    description: null,
    image: 'https://beispiel.de/optik.png',
    type: null,
    locale: null,
    siteName: 'Beispiel Portal',
  },
  twitter: { card: null, title: null, description: null, image: null },
  dublinCore: {
    title: null, creator: null, subject: null, description: null, date: null, type: null,
    format: null, language: null, rights: 'CC BY-SA 4.0',
  },
  lrmi: {
    educationalUse: null,
    educationalLevel: null,
    learningResourceType: 'Arbeitsblatt',
    timeRequired: 'PT45M',
  },
  license: {
    source: 'link[rel=license]',
    url: 'https://creativecommons.org/licenses/by-sa/4.0/',
    text: '',
  },
  canonical: { source: 'link[rel=canonical]', url: 'https://beispiel.de/optik' },
  tags: { source: 'rel=tag, meta, .tags', items: ['Sekundarstufe I'] },
  breadcrumbs: {
    source: 'nav[breadcrumb]',
    items: [
      { text: 'Startseite', href: 'https://beispiel.de/' },
      { text: 'Naturwissenschaften', href: 'https://beispiel.de/nawi' },
    ],
  },
  headings: [{ level: 1, text: 'Optik' }, { level: 2, text: 'Brechung an der Linse' }],
  wordCount: 29,
  structuredData: [
    {
      '@graph': [
        { '@type': 'Organization', name: 'Beispiel Verlag' },
        {
          '@type': 'Article',
          url: 'https://beispiel.de/optik',
          datePublished: '2024-05-06',
          publisher: { name: 'Beispiel Verlag' },
          educationalAlignment: [{ alignmentType: 'educationalSubject', targetName: 'Physik' }],
        },
      ],
    },
  ],
  images: { ogImage: { source: 'og:image', url: 'https://beispiel.de/optik.png' } },
  mainContent:
    'Optik\nBrechung an der Linse\nDie Brechung des Lichts an einer Linse ist ein Grundphaenomen der Optik.\n' +
    'Wer die Brechung versteht, versteht auch die Linse und ihren Brennpunkt.\nSekundarstufe I',
};

describe('the KI-free way, end to end', () => {
  it('describes the extraction of a well-marked-up page', async () => {
    TestBed.configureTestingModule({
      providers: [provideFake(ClientutilsV1Service, fakeClientUtils({}).fake)],
    });
    const derived = await TestBed.inject(PageDerivationService).derive(EXTRACTED);

    expect(derived?.payload).toEqual({
      // The page's own three facts, as the Erschließung always states them.
      'cclom:title': ['Optik – Licht, Linsen, Spiegel'],
      preview_image_url: 'https://beispiel.de/optik.png',
      _source_text: EXTRACTED.mainContent,
      // What the page declares about itself — values, because it declared them.
      'ccm:wwwurl': ['https://beispiel.de/optik?utm_source=x'],
      'cclom:general_description': ['Ein Überblick über Licht, Linsen und Spiegel.'],
      'cclom:general_keyword': ['Optik', 'Linse', 'Brechung', 'Sekundarstufe I'],
      'cclom:general_language': ['de'],
      'ccm:author_freetext': ['Dr. Anna Beispiel'],
      'ccm:oeh_publisher_combined': ['Beispiel Verlag'],
      'schema:datePublished': ['2024-05-06'],
      'ccm:general_identifier': ['https://beispiel.de/optik'],
      'ccm:commonlicense_key': ['CC_BY_SA'],
      'ccm:commonlicense_cc_version': ['4.0'],
      // Derived, so proposed rather than stated.
      'cclom:typicallearningtime': ['2700000'],
      _origins: { 'cclom:typicallearningtime': 'page' },
      // The page's own words for the vocabulary fields, for the metadata set to resolve.
      _page_terms: { learningResourceType: ['Arbeitsblatt', 'article'], discipline: ['Physik'] },
    });
  });
});
