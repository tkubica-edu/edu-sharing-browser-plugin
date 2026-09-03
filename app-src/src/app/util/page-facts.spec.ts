import { describe, expect, it } from 'vitest';

import { PageData } from '../services/browser-extension.service';
import { firstPageImage, pageFactsOf, pageMetadata } from './page-facts';

/** A page that states everything a content is described by. */
function aPage(overrides: Partial<PageData> = {}): PageData {
  return {
    url: 'https://example.org/optik',
    title: 'Optik – Licht, Linsen, Spiegel',
    mainContent: 'Der Artikel selbst.',
    formattedText: 'Titel: Optik\n\nDer Artikel selbst.',
    images: { ogImage: { source: 'og:image', url: 'https://example.org/optik.png' } },
    ...overrides,
  };
}

describe('firstPageImage', () => {
  it('takes the declared picture before the one found in the content', () => {
    expect(
      firstPageImage({
        heroImage: { source: 'largest-content-image', url: 'https://example.org/hero.png' },
        twitterImage: { source: 'twitter:image', url: 'https://example.org/card.png' },
        ogImage: { source: 'og:image', url: 'https://example.org/share.png' },
      }),
    ).toBe('https://example.org/share.png');
  });

  it('takes the largest picture of the content before the card picture', () => {
    expect(
      firstPageImage({
        twitterImage: { source: 'twitter:image', url: 'https://example.org/card.png' },
        heroImage: { source: 'largest-content-image', url: 'https://example.org/hero.png' },
      }),
    ).toBe('https://example.org/hero.png');
  });

  it('takes the site icon for no picture — it stands for the site, not for the page', () => {
    expect(
      firstPageImage({ favicon: { source: 'link[rel=icon]', url: 'https://example.org/favicon.ico' } }),
    ).toBeNull();
    expect(firstPageImage(null)).toBeNull();
  });
});

describe('pageFactsOf', () => {
  it('reads the page as its title, its picture and its text', () => {
    expect(pageFactsOf(aPage())).toEqual({
      url: 'https://example.org/optik',
      title: 'Optik – Licht, Linsen, Spiegel',
      imageUrl: 'https://example.org/optik.png',
      text: 'Titel: Optik\n\nDer Artikel selbst.',
    });
  });

  it('states no title and no picture for a page that names neither', () => {
    const facts = pageFactsOf(aPage({ title: '   ', images: undefined }));
    expect(facts?.title).toBeNull();
    expect(facts?.imageUrl).toBeNull();
  });

  it('falls back through the texts the content script offers', () => {
    expect(pageFactsOf(aPage({ formattedText: undefined }))?.text).toBe('Der Artikel selbst.');
    expect(
      pageFactsOf(aPage({ formattedText: undefined, mainContent: undefined, text: 'Alles.' }))?.text,
    ).toBe('Alles.');
    expect(
      pageFactsOf(aPage({ formattedText: undefined, mainContent: undefined }))?.text,
    ).toBe('');
  });

  it('reads nothing off a page that could not be read at all', () => {
    expect(pageFactsOf(null)).toBeNull();
  });
});

describe('pageMetadata', () => {
  it('states the page as title, picture and the text it was read from', () => {
    expect(pageMetadata(pageFactsOf(aPage())!)).toEqual({
      'cclom:title': 'Optik – Licht, Linsen, Spiegel',
      preview_image_url: 'https://example.org/optik.png',
      _source_text: 'Titel: Optik\n\nDer Artikel selbst.',
    });
  });

  it('marks nothing as generated — nothing here is', () => {
    expect(pageMetadata(pageFactsOf(aPage())!)['_origins']).toBeUndefined();
  });

  it('leaves out what the page does not state', () => {
    expect(
      pageMetadata(pageFactsOf(aPage({ title: '', images: undefined, formattedText: '', mainContent: '' }))!),
    ).toEqual({});
  });
});
