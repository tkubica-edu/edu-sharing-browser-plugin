import { describe, expect, it } from 'vitest';

import { fieldOrigins } from './curation-node';

describe('fieldOrigins', () => {
  const values = {
    'cclom:title': ['Optik'],
    'cclom:general_description': ['Eine Einführung.'],
    'cclom:general_keyword': ['Brechung'],
    'ccm:taxonid': ['http://w3id.org/openeduhub/vocabs/discipline/460'],
    preview_image_url: 'https://beispiel.de/optik.png',
  };

  it('keeps both kinds of proposal apart — a model’s and one derived from the page', () => {
    expect(
      fieldOrigins(values, { 'cclom:general_description': 'ai', 'cclom:general_keyword': 'page' }, {}),
    ).toEqual({
      'cclom:title': 'user',
      'cclom:general_description': 'ai',
      'cclom:general_keyword': 'page',
      'ccm:taxonid': 'user',
    });
  });

  it('states a value a step settled as decided, whatever proposed it before', () => {
    expect(
      fieldOrigins(values, { 'cclom:general_keyword': 'page', 'ccm:taxonid': 'ai' }, {
        'cclom:general_keyword': ['Optik'],
      })['cclom:general_keyword'],
    ).toBe('user');
  });

  it('reads an origin it does not know as a decided value', () => {
    expect(fieldOrigins(values, { 'cclom:title': 'irgendwas' }, {})['cclom:title']).toBe('user');
    expect(fieldOrigins(values, null, {})['cclom:title']).toBe('user');
  });

  it('states an origin only for the fields, not for the envelope', () => {
    expect(Object.keys(fieldOrigins(values, {}, {}))).not.toContain('preview_image_url');
  });
});
