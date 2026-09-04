import { afterEach, describe, expect, it, vi } from 'vitest';

import { Node } from 'ngx-edu-sharing-api';

import { DRAFT_NODE_ID } from './mds-node';
import type { SavedNode } from '../services/browser-extension.service';
import {
  createdAtOf,
  fieldOrigins,
  isPickedPicture,
  previewImageOf,
  previewSrcOfNode,
  toDataUrl,
  toDraftNode,
  toDraftPreview,
  toEditorNode,
  toPartialNode,
  toSavedMetadata,
  toWrittenNode,
  withCanvasScalars,
  withReadablePreview,
} from './curation-node';

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

const NODE_ID = '2c4d6b1a-8f3e-4c2b-9a10-7d5e6f8b0c31';
const MDS = 'mds_oeh';

/** What a save reported back about the content it wrote. */
function aSavedNode(overrides: Partial<SavedNode> = {}): SavedNode {
  return { title: 'Optik', description: 'Eine Einführung.', ...overrides } as SavedNode;
}

describe('previewImageOf', () => {
  it('reads the picture the agent\'s payload names', () => {
    expect(previewImageOf({ preview_image_url: 'https://example.org/optik.png' })).toBe(
      'https://example.org/optik.png',
    );
  });

  it('reads the one a node\'s properties name', () => {
    expect(previewImageOf({ 'preview:url': ['https://example.org/optik.png'] })).toBe(
      'https://example.org/optik.png',
    );
  });

  it('prefers the agent\'s, which belongs to the run rather than to the stored node', () => {
    expect(
      previewImageOf({
        preview_image_url: 'https://example.org/frisch.png',
        'preview:url': 'https://example.org/gespeichert.png',
      }),
    ).toBe('https://example.org/frisch.png');
  });

  it('answers nothing for metadata that names no picture', () => {
    expect(previewImageOf({ 'preview:url': [] })).toBeNull();
    expect(previewImageOf({})).toBeNull();
    expect(previewImageOf(null)).toBeNull();
  });
});

describe('createdAtOf', () => {
  it('reads the creation date the API states', () => {
    expect(createdAtOf({ createdAt: '2026-05-06T11:22:33Z' } as Node)).toBe(
      Date.parse('2026-05-06T11:22:33Z'),
    );
  });

  it('reads the one a node built from stored properties carries instead', () => {
    expect(
      createdAtOf({ properties: { 'cm:created': ['2026-05-06T11:22:33Z'] } } as unknown as Node),
    ).toBe(Date.parse('2026-05-06T11:22:33Z'));
  });

  it('reads epoch milliseconds as the moment they are, not as a year', () => {
    expect(createdAtOf({ properties: { 'cm:created': ['1778066553000'] } } as unknown as Node)).toBe(
      1778066553000,
    );
  });

  it('answers nothing for a node that states no creation date', () => {
    expect(createdAtOf({} as Node)).toBeNull();
    expect(createdAtOf(null)).toBeNull();
    expect(createdAtOf({ createdAt: 'irgendwann' } as unknown as Node)).toBeNull();
  });
});

describe('toPartialNode', () => {
  it('states the handful of fields the elements fed from it read', () => {
    const node = toPartialNode(NODE_ID, aSavedNode(), { 'cclom:title': ['Optik'] }, MDS);
    expect(node.ref.id).toBe(NODE_ID);
    expect(node.name).toBe('Optik');
    expect(node.title).toBe('Optik');
    expect((node as unknown as { description: string }).description).toBe('Eine Einführung.');
    expect(node.metadataset).toBe(MDS);
    expect(node.properties).toEqual({ 'cclom:title': ['Optik'] });
  });

  it('names a content the save reported no title for by its node id', () => {
    const node = toPartialNode(NODE_ID, aSavedNode({ title: null }), {}, MDS);
    expect(node.name).toBe(NODE_ID);
    expect(node.title).toBeUndefined();
  });
});

describe('toWrittenNode', () => {
  it('takes the whole node the endpoint answered with', () => {
    const full = { ref: { id: NODE_ID }, name: 'optik.html', metadataset: 'mds_andere' };
    const node = toWrittenNode(NODE_ID, aSavedNode(), full, {}, MDS);
    expect(node.name).toBe('optik.html');
    expect(node.metadataset).toBe('mds_andere');
  });

  it('states the panel\'s own set where the answered node names none', () => {
    const node = toWrittenNode(NODE_ID, aSavedNode(), { ref: { id: NODE_ID } }, {}, MDS);
    expect(node.metadataset).toBe(MDS);
  });

  it('falls back to the stand-in for an answer that carries no node', () => {
    for (const answer of [null, undefined, {}, { name: 'ohne ref' }]) {
      const node = toWrittenNode(NODE_ID, aSavedNode(), answer, { 'cclom:title': ['Optik'] }, MDS);
      expect(node.ref.id).toBe(NODE_ID);
      expect(node.properties).toEqual({ 'cclom:title': ['Optik'] });
    }
  });
});

describe('withReadablePreview', () => {
  it('gives the node a picture this session can actually show', () => {
    const node = withReadablePreview({ ref: { id: NODE_ID } } as Node, 'https://example.org/optik.png');
    expect(node.preview).toMatchObject({ url: 'https://example.org/optik.png?', isIcon: false });
  });

  it('drops the preview rather than showing the repository\'s placeholder', () => {
    expect(withReadablePreview({ ref: { id: NODE_ID } } as Node, null).preview).toBeUndefined();
  });
});

describe('toSavedMetadata', () => {
  it('lays the committed values over the payload the save started from', () => {
    expect(
      toSavedMetadata({ contextName: 'wlo', 'cclom:title': 'Alt' }, { 'cclom:title': ['Neu'] }),
    ).toEqual({ contextName: 'wlo', 'cclom:title': 'Neu' });
  });

  it('keeps a field the payload states as a scalar a scalar, so a canvas does not render it blank', () => {
    expect(toSavedMetadata({ 'cclom:title': 'Alt' }, { 'cclom:title': [] })['cclom:title']).toBe('');
  });

  it('states a field of several values as the list it is, whatever the payload had', () => {
    expect(
      toSavedMetadata({ 'ccm:taxonid': '380' }, { 'ccm:taxonid': ['380', '460'] })['ccm:taxonid'],
    ).toEqual(['380', '460']);
  });

  it('adds a value the payload never carried', () => {
    expect(toSavedMetadata(null, { 'cclom:title': ['Optik'] })).toEqual({ 'cclom:title': ['Optik'] });
  });
});

describe('withCanvasScalars', () => {
  it('unwraps the fields a canvas can only read as a scalar', () => {
    expect(
      withCanvasScalars({
        'cclom:title': ['Optik'],
        'cclom:general_description': ['Eine Einführung.'],
        'ccm:wwwurl': ['https://example.org/optik'],
        'preview:url': ['https://example.org/optik.png'],
        'cclom:general_language': ['de'],
      }),
    ).toEqual({
      'cclom:title': 'Optik',
      'cclom:general_description': 'Eine Einführung.',
      'ccm:wwwurl': 'https://example.org/optik',
      'preview:url': 'https://example.org/optik.png',
      'cclom:general_language': 'de',
    });
  });

  it('unwraps an empty one to the empty string rather than leaving a list behind', () => {
    expect(withCanvasScalars({ 'cclom:title': [] })['cclom:title']).toBe('');
  });

  it('leaves every other field as the list it is', () => {
    expect(withCanvasScalars({ 'ccm:taxonid': ['380', '460'] })['ccm:taxonid']).toEqual(['380', '460']);
  });

  it('leaves a field that is already a scalar alone', () => {
    expect(withCanvasScalars({ 'cclom:title': 'Optik' })['cclom:title']).toBe('Optik');
  });
});

describe('isPickedPicture', () => {
  it('recognises a picture that exists nowhere but in this browser', () => {
    expect(isPickedPicture('blob:https://example.org/1234')).toBe(true);
    expect(isPickedPicture('data:image/png;base64,AAAA')).toBe(true);
  });

  it('does not take a picture that already has a home for one', () => {
    expect(isPickedPicture('https://example.org/optik.png')).toBe(false);
    expect(isPickedPicture('')).toBe(false);
  });
});

describe('toDraftPreview', () => {
  it('states a picture that has an address by that address', () => {
    expect(toDraftPreview('https://example.org/optik.png')).toEqual({
      url: 'https://example.org/optik.png?',
      isIcon: false,
      width: 0,
      height: 0,
    });
  });

  it('gives the widget\'s own query parameters something to attach to', () => {
    expect(toDraftPreview('https://example.org/optik.png?v=2')).toMatchObject({
      url: 'https://example.org/optik.png?v=2',
    });
  });

  it('states a picture that exists only in this browser inline', () => {
    expect(toDraftPreview('data:image/png;base64,AAAA')).toEqual({
      mimetype: 'image/png',
      data: 'AAAA',
      isIcon: false,
      width: 0,
      height: 0,
    });
  });

  it('never states an icon, which the widget would render from a node the repository knows', () => {
    expect(toDraftPreview('https://example.org/optik.png')).toMatchObject({ isIcon: false });
    expect(toDraftPreview('data:image/png;base64,AAAA')).toMatchObject({ isIcon: false });
  });

  it('states no preview for a content with no picture', () => {
    expect(toDraftPreview(null)).toBeUndefined();
    expect(toDraftPreview('')).toBeUndefined();
  });
});

describe('previewSrcOfNode', () => {
  it('reads a picture stated by its address', () => {
    expect(previewSrcOfNode({ url: 'https://example.org/optik.png' } as Node['preview'])).toBe(
      'https://example.org/optik.png',
    );
  });

  it('reads one stated inline as the picture itself', () => {
    expect(
      previewSrcOfNode({ mimetype: 'image/png', data: 'AAAA' } as unknown as Node['preview']),
    ).toBe('data:image/png;base64,AAAA');
  });

  it('reads a mere type icon as no picture of this content', () => {
    expect(
      previewSrcOfNode({ url: 'https://example.org/icon.svg', isIcon: true } as Node['preview']),
    ).toBeNull();
  });

  it('reads a preview that states no picture as none', () => {
    expect(previewSrcOfNode(undefined)).toBeNull();
    expect(previewSrcOfNode({} as Node['preview'])).toBeNull();
  });
});

describe('toDraftNode', () => {
  it('stands in for a content the repository was never asked about', () => {
    const node = toDraftNode({ 'ccm:taxonid': ['380'] }, 'Optik', null, MDS);
    expect(node.ref.id).toBe(DRAFT_NODE_ID);
    expect(node.name).toBe('Optik');
    expect(node.metadataset).toBe(MDS);
  });

  it('reports the rights the editor asks for before it offers a widget', () => {
    expect(toDraftNode({}, null, null, MDS).access).toEqual(['Read', 'Write', 'Change', 'Delete']);
  });

  it('names a draft whose metadata carries no title yet', () => {
    const node = toDraftNode({}, null, null, MDS);
    expect(node.name).toBe('Neuer Inhalt');
    expect(node.title).toBeUndefined();
  });

  it('fills both properties a title widget can be bound to', () => {
    const properties = toDraftNode({}, 'Optik', null, MDS).properties;
    expect(properties?.['cclom:title']).toEqual(['Optik']);
    expect(properties?.['cm:name']).toEqual(['Optik']);
  });

  it('never overwrites a title the metadata already carries', () => {
    const properties = toDraftNode({ 'cclom:title': ['Aus den Metadaten'] }, 'Optik', null, MDS)
      .properties;
    expect(properties?.['cclom:title']).toEqual(['Aus den Metadaten']);
    expect(properties?.['cm:name']).toEqual(['Optik']);
  });

  it('carries the picture in whichever shape the widget can build a source from', () => {
    expect(toDraftNode({}, null, 'data:image/png;base64,AAAA', MDS).preview).toMatchObject({
      mimetype: 'image/png',
    });
    expect(toDraftNode({}, null, null, MDS).preview).toBeUndefined();
  });
});

describe('toDataUrl', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reads an object URL out into the picture itself, so a picked one survives as a value', async () => {
    // Stubbed over the guard from `no-network.setup.ts`: an object URL is read through `fetch`, and
    // this one names nothing outside the browser.
    // The blob is handed back as it is: jsdom's own `Response` re-encodes one it is constructed with,
    // and what this is about is the reading, not the transport.
    const picture = new Blob(['bild'], { type: 'image/png' });
    vi.stubGlobal('fetch', vi.fn(async () => ({ blob: async () => picture }) as unknown as Response));

    await expect(toDataUrl('blob:https://example.org/1234')).resolves.toMatch(/^data:image\/png;base64,/);
  });

  it('leaves the caller its object URL where the picture cannot be read', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('gone'); }));

    await expect(toDataUrl('blob:https://example.org/1234')).resolves.toBeNull();
  });
});
