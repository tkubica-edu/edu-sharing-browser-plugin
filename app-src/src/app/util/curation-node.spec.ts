import { describe, expect, it } from 'vitest';

import { Node } from 'ngx-edu-sharing-api';

import { fieldOrigins, toEditorNode } from './curation-node';

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

describe('toEditorNode', () => {
  // A node as the first save reports it back: the two properties `createContent` writes and no more.
  const saved = {
    ref: { id: 'abc', repo: '-home-' },
    name: 'Oliver',
    properties: { 'cm:name': ['Oliver'], 'ccm:wwwurl': ['https://beispiel.de/oliver/'] },
  } as unknown as Node;

  // What reading the page produced for it — the fields no save has written yet.
  const found = {
    'cclom:title': ['Oliver'],
    'ccm:wwwurl': ['https://beispiel.de/oliver/'],
    'cclom:general_description': ['Oliver zeigt eine barrierefreie Vorlesung.'],
    'cclom:general_keyword': ['Barrierefreiheit', 'ADHS'],
  };

  it('shows the findings the node does not carry yet', () => {
    expect(toEditorNode(saved, found, {}).properties).toEqual({
      'cm:name': ['Oliver'],
      'ccm:wwwurl': ['https://beispiel.de/oliver/'],
      'cclom:title': ['Oliver'],
      'cclom:general_description': ['Oliver zeigt eine barrierefreie Vorlesung.'],
      'cclom:general_keyword': ['Barrierefreiheit', 'ADHS'],
    });
  });

  it('lets what the repository stores outrank a finding about the same property', () => {
    const stored = {
      ...saved,
      properties: { ...saved.properties, 'cclom:general_description': ['Von Hand geschrieben.'] },
    } as Node;
    expect(toEditorNode(stored, found, {}).properties?.['cclom:general_description']).toEqual([
      'Von Hand geschrieben.'
    ]);
  });

  it('lets a value a step settled outrank both', () => {
    const node = toEditorNode(saved, found, { 'cclom:general_keyword': ['Inklusion'] });
    expect(node.properties?.['cclom:general_keyword']).toEqual(['Inklusion']);
  });

  it('leaves the node itself untouched', () => {
    toEditorNode(saved, found, {});
    expect(Object.keys(saved.properties ?? {})).toEqual(['cm:name', 'ccm:wwwurl']);
  });
});
