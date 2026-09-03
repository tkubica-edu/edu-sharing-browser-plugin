import { TestBed } from '@angular/core/testing';
import { ClientutilsV1Service } from 'ngx-edu-sharing-api';
import { beforeEach, describe, expect, it } from 'vitest';

import { PageData } from './browser-extension.service';
import { PageDerivationService } from './page-derivation.service';
import { ClientUtilsFake, fakeClientUtils } from '../../testing/fakes';
import { provideFake } from '../../testing/provide-fake';

/** A page that declares a description, keywords and a licence — the good case. */
function aPage(overrides: Partial<PageData> = {}): PageData {
  return {
    url: 'https://beispiel.de/optik',
    title: 'Optik – Licht, Linsen, Spiegel | Beispiel Portal',
    mainContent:
      'Die Brechung des Lichts an einer Linse ist ein Grundphänomen. ' +
      'Wer die Brechung versteht, versteht auch die Linse und ihren Brennpunkt.',
    meta: {
      description: 'Ein Überblick über Licht, Linsen und Spiegel.',
      keywords: 'Optik, Linse',
      author: 'Dr. Anna Beispiel',
      language: 'de-DE',
    },
    openGraph: { siteName: 'Beispiel Portal', image: 'https://beispiel.de/optik.png' },
    license: {
      source: 'link[rel=license]',
      url: 'https://creativecommons.org/licenses/by-sa/4.0/',
    },
    lrmi: { learningResourceType: 'Arbeitsblatt' },
    images: { ogImage: { source: 'og:image', url: 'https://beispiel.de/optik.png' } },
    ...overrides,
  };
}

describe('PageDerivationService', () => {
  let clientUtils: ClientUtilsFake;
  let service: PageDerivationService;

  beforeEach(() => {
    clientUtils = fakeClientUtils({});
    TestBed.configureTestingModule({
      providers: [provideFake(ClientutilsV1Service, clientUtils.fake)],
    });
    service = TestBed.inject(PageDerivationService);
  });

  it('describes the content from what the page states about itself', async () => {
    const derived = await service.derive(aPage());
    expect(derived?.payload).toMatchObject({
      'cclom:title': ['Optik – Licht, Linsen, Spiegel'],
      'cclom:general_description': ['Ein Überblick über Licht, Linsen und Spiegel.'],
      'cclom:general_keyword': ['Optik', 'Linse'],
      'cclom:general_language': ['de'],
      'ccm:author_freetext': ['Dr. Anna Beispiel'],
      'ccm:commonlicense_key': ['CC_BY_SA'],
      'ccm:commonlicense_cc_version': ['4.0'],
      'ccm:wwwurl': ['https://beispiel.de/optik'],
      preview_image_url: 'https://beispiel.de/optik.png',
    });
  });

  it('marks nothing the page states as a proposal — a declaration is not a guess', async () => {
    const derived = await service.derive(aPage());
    expect(derived?.payload['_origins']).toBeUndefined();
  });

  it('carries the page’s vocabulary words along for a metadata set to resolve', async () => {
    const derived = await service.derive(aPage());
    expect(derived?.payload['_page_terms']).toEqual({ learningResourceType: ['Arbeitsblatt'] });
  });

  it('proposes what it derived where the page declares nothing, and marks it', async () => {
    const bare = aPage({ meta: { language: 'de' }, license: undefined, lrmi: undefined });
    const derived = await service.derive(bare);
    expect(derived?.payload['_origins']).toEqual({
      'cclom:general_keyword': 'page',
      'cclom:general_description': 'page',
    });
    expect(derived?.payload['cclom:general_keyword']).toEqual(
      expect.arrayContaining(['Brechung', 'Linse']),
    );
  });

  it('takes over what the repository read off the same address', async () => {
    clientUtils.answers({
      title: 'Optik – Licht, Linsen, Spiegel',
      description: 'Vom Repository gelesen.',
      keywords: ['Brennpunkt'],
    });
    const bare = aPage({ meta: { language: 'de' } });
    const derived = await service.derive(bare);
    expect(derived?.payload['cclom:general_description']).toEqual(['Vom Repository gelesen.']);
    expect(derived?.payload['cclom:general_keyword']).toEqual(['Brennpunkt']);
  });

  it('leaves the page’s own statements standing before the repository’s reading', async () => {
    clientUtils.answers({ title: 'Optik', description: 'Vom Repository gelesen.' });
    const derived = await service.derive(aPage());
    expect(derived?.payload['cclom:general_description']).toEqual([
      'Ein Überblick über Licht, Linsen und Spiegel.',
    ]);
  });

  it('refuses a reading that describes another page — the login wall behind the address', async () => {
    clientUtils.answers({
      title: 'Anmeldung — Mein Konto',
      description: 'Bitte melden Sie sich an, um fortzufahren.',
    });
    const bare = aPage({ meta: { language: 'de' } });
    const derived = await service.derive(bare);
    expect(derived?.payload['cclom:general_description']).not.toEqual(['Bitte melden Sie sich an, um fortzufahren.']);
  });

  it('reports a licence found only in the text as not taken over', async () => {
    const derived = await service.derive(
      aPage({ license: { source: 'body-text', text: 'CC BY 4.0' } }),
    );
    expect(derived?.payload['ccm:commonlicense_key']).toBeUndefined();
    expect(derived?.report.rejected[0]).toMatchObject({ property: 'ccm:commonlicense_key' });
  });

  it('describes a page that declares nothing by its title and address alone', async () => {
    const derived = await service.derive({ url: 'https://beispiel.de/leer', title: 'Leer' });
    expect(derived?.payload).toEqual({
      'cclom:title': ['Leer'],
      'ccm:wwwurl': ['https://beispiel.de/leer'],
    });
  });

  it('derives nothing from a page that could not be read at all', async () => {
    await expect(service.derive(null)).resolves.toBeNull();
  });
});
