import { describe, expect, it } from 'vitest';

import { normalizeAddress, sameAddress } from './page-address';

describe('normalizeAddress', () => {
  it('drops the fragment, which names a position within the page rather than a page', () => {
    expect(normalizeAddress('https://example.org/optik#linsen')).toBe('https://example.org/optik');
  });

  it('drops a trailing slash, which is the same path written twice', () => {
    expect(normalizeAddress('https://example.org/optik/')).toBe('https://example.org/optik');
    expect(normalizeAddress('https://example.org/optik///')).toBe('https://example.org/optik');
  });

  it('keeps the query, which is part of what a page shows', () => {
    expect(normalizeAddress('https://example.org/suche?q=optik')).toBe(
      'https://example.org/suche?q=optik',
    );
  });

  it('keeps the root path of a host, which has no trailing slash to drop', () => {
    expect(normalizeAddress('https://example.org/')).toBe('https://example.org/');
  });

  it('folds the spellings the URL parser itself calls equal', () => {
    expect(normalizeAddress('HTTPS://Example.ORG/optik')).toBe('https://example.org/optik');
  });

  it('compares text that is no address as the text it is, minus the same two parts', () => {
    expect(normalizeAddress('  nicht/ganz/eine/adresse/#hier ')).toBe('nicht/ganz/eine/adresse');
  });
});

describe('sameAddress', () => {
  it('calls two addresses the same page where only the fragment or the trailing slash differ', () => {
    expect(sameAddress('https://example.org/optik', 'https://example.org/optik/')).toBe(true);
    expect(sameAddress('https://example.org/optik', 'https://example.org/optik#linsen')).toBe(true);
    expect(sameAddress('https://example.org/optik/#linsen', 'https://example.org/optik')).toBe(true);
  });

  it('tells two pages of the same site apart', () => {
    expect(sameAddress('https://example.org/optik', 'https://example.org/akustik')).toBe(false);
  });

  it('tells two searches apart, because the query is what they show', () => {
    expect(sameAddress('https://example.org/s?q=optik', 'https://example.org/s?q=akustik')).toBe(false);
  });

  it('tells the same path on two hosts apart', () => {
    expect(sameAddress('https://example.org/optik', 'https://example.com/optik')).toBe(false);
  });

  it('answers no for an address that is missing — nothing is the same page as nothing', () => {
    expect(sameAddress(null, null)).toBe(false);
    expect(sameAddress('https://example.org/optik', undefined)).toBe(false);
    expect(sameAddress('', '')).toBe(false);
  });
});
