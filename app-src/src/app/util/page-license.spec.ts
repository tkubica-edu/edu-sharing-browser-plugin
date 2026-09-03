import { describe, expect, it } from 'vitest';

import { ccLicenseOf, ccLicenseOfText, ccLicenseOfUrl } from './page-license';
import { toAmbResource } from './amb-event';

describe('ccLicenseOfUrl', () => {
  it('reads every Creative Commons family out of its address', () => {
    expect(ccLicenseOfUrl('https://creativecommons.org/licenses/by/4.0/')).toEqual({ key: 'CC_BY', version: '4.0' });
    expect(ccLicenseOfUrl('https://creativecommons.org/licenses/by-sa/4.0/deed.de')).toEqual({
      key: 'CC_BY_SA',
      version: '4.0',
    });
    expect(ccLicenseOfUrl('http://creativecommons.org/licenses/by-nc-nd/3.0/')).toEqual({
      key: 'CC_BY_NC_ND',
      version: '3.0',
    });
  });

  it('reads the two public-domain dedications, which are no licence path', () => {
    expect(ccLicenseOfUrl('https://creativecommons.org/publicdomain/zero/1.0/')).toEqual({
      key: 'CC_0',
      version: '1.0',
    });
    expect(ccLicenseOfUrl('https://creativecommons.org/publicdomain/mark/1.0/')).toEqual({
      key: 'PDM',
      version: '1.0',
    });
  });

  it('reads no licence out of an address that is none', () => {
    expect(ccLicenseOfUrl('https://beispiel.de/nutzungsbedingungen')).toBeNull();
    expect(ccLicenseOfUrl('https://creativecommons.org/about/')).toBeNull();
    expect(ccLicenseOfUrl(null)).toBeNull();
  });

  it('is the mirror of the mapping that writes such an address', () => {
    for (const key of ['CC_BY', 'CC_BY_SA', 'CC_BY_NC', 'CC_BY_ND', 'CC_BY_NC_SA', 'CC_BY_NC_ND']) {
      const written = toAmbResource({
        metadata: { 'ccm:commonlicense_key': [key], 'ccm:commonlicense_cc_version': ['4.0'] },
        url: 'https://beispiel.de/optik',
        title: 'Optik',
        imageUrl: null,
        nodeLink: null,
        repositoryUrl: null,
      })?.license?.id;
      expect(ccLicenseOfUrl(written)).toEqual({ key, version: '4.0' });
    }
  });
});

describe('ccLicenseOfText', () => {
  it('reads the spellings a licence notice uses', () => {
    expect(ccLicenseOfText('CC BY-SA 4.0')).toEqual({ key: 'CC_BY_SA', version: '4.0' });
    expect(ccLicenseOfText('Lizenz: CC BY 3.0 DE')).toEqual({ key: 'CC_BY', version: '3.0' });
    expect(ccLicenseOfText('cc by-nc-sa 4.0')).toEqual({ key: 'CC_BY_NC_SA', version: '4.0' });
    expect(ccLicenseOfText('CC0 1.0')).toEqual({ key: 'CC_0', version: '1.0' });
  });

  it('states no version where the notice names none, rather than assuming the current one', () => {
    expect(ccLicenseOfText('Dieses Material steht unter CC BY-SA.')).toEqual({
      key: 'CC_BY_SA',
      version: null,
    });
  });

  it('reads no licence out of a copyright notice', () => {
    expect(ccLicenseOfText('© 2024 Beispiel Verlag. Alle Rechte vorbehalten.')).toBeNull();
    expect(ccLicenseOfText('')).toBeNull();
  });
});

describe('ccLicenseOf', () => {
  it('counts a licence link and DC.rights as the page declaring its own licence', () => {
    expect(
      ccLicenseOf({ source: 'link[rel=license]', url: 'https://creativecommons.org/licenses/by/4.0/' }),
    ).toEqual({ key: 'CC_BY', version: '4.0', source: 'link[rel=license]', declared: true });
    expect(ccLicenseOf({ source: 'meta[DC.rights]', text: 'CC BY-SA 4.0' })).toEqual({
      key: 'CC_BY_SA',
      version: '4.0',
      source: 'meta[DC.rights]',
      declared: true,
    });
  });

  it('does not count a mention in the running text as a declaration', () => {
    expect(ccLicenseOf({ source: 'body-text', text: 'CC BY 4.0' })?.declared).toBe(false);
  });

  it('prefers the address over the text beside it', () => {
    expect(
      ccLicenseOf({
        source: 'link[rel=license]',
        url: 'https://creativecommons.org/licenses/by-nc/4.0/',
        text: 'CC BY 4.0',
      })?.key,
    ).toBe('CC_BY_NC');
  });
});
