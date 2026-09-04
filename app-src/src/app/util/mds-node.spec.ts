import { describe, expect, it } from 'vitest';

import { Node } from 'ngx-edu-sharing-api';

import { LICENSE_KEY } from './agent-fields';
import { DRAFT_NODE_ID, EDITOR_MODE_FOR_DRAFT, forMdsEditor, isDraftNode, previewSrcOf } from './mds-node';

/** A node as the repository hands it over, with whatever the test is about written into it. */
function aNode(overrides: Partial<Node> = {}): Node {
  return {
    ref: { id: '2c4d6b1a-8f3e-4c2b-9a10-7d5e6f8b0c31', repo: 'local' },
    name: 'optik.html',
    properties: { 'cclom:title': ['Optik'] },
    ...overrides,
  } as unknown as Node;
}

/** An element holding the markup the mounted editor renders. */
function anElement(html: string): Element {
  const host = document.createElement('div');
  host.innerHTML = html;
  return host;
}

describe('isDraftNode', () => {
  it('recognises the stand-in the curation assembles, which identifies nothing in the repository', () => {
    expect(isDraftNode({ ref: { id: DRAFT_NODE_ID } } as unknown as Node)).toBe(true);
  });

  it('does not take a node the repository holds for one', () => {
    expect(isDraftNode(aNode())).toBe(false);
  });

  it('does not take the absence of a node for one', () => {
    expect(isDraftNode(null)).toBe(false);
    expect(isDraftNode(undefined)).toBe(false);
    expect(isDraftNode({} as Node)).toBe(false);
  });

  it('names the mode a form on a stand-in is built in — the one that asks the repository nothing', () => {
    expect(EDITOR_MODE_FOR_DRAFT).toBe('form');
  });
});

describe('forMdsEditor', () => {
  it('states every property as a list, which is what every widget reduces over', () => {
    const node = forMdsEditor(aNode({ properties: { 'cclom:title': 'Optik' } as never }));
    expect(node.properties).toEqual({ 'cclom:title': ['Optik'] });
  });

  it('keeps only the namespaced properties, so the payload\'s envelope never reaches a widget', () => {
    const node = forMdsEditor(
      aNode({ properties: { 'cclom:title': ['Optik'], contextName: 'wlo' } as never }),
    );
    expect(node.properties).toEqual({ 'cclom:title': ['Optik'] });
  });

  it('maps the agent\'s field names on the way in, because the form is built from these values', () => {
    const node = forMdsEditor(
      aNode({ properties: { 'ccm:oeh_publisher_combined': ['Landesbildungsserver'] } as never }),
    );
    expect(node.properties?.['ccm:author_freetext']).toEqual(['Landesbildungsserver']);
  });

  it('adds the aspects a licence is carried under, without which the node renders as unlicensed', () => {
    const node = forMdsEditor(aNode({ properties: { [LICENSE_KEY]: ['CC_BY'] } as never, aspects: [] }));
    expect(node.aspects).toEqual(['ccm:licenses', 'ccm:commonlicenses']);
  });

  it('states each aspect once, however many the node brought already', () => {
    const node = forMdsEditor(
      aNode({ properties: { [LICENSE_KEY]: ['CC_BY'] } as never, aspects: ['ccm:licenses', 'ccm:iometadata'] }),
    );
    expect(node.aspects).toEqual(['ccm:licenses', 'ccm:iometadata', 'ccm:commonlicenses']);
  });

  it('adds no licence aspects to a node that carries no licence', () => {
    expect(forMdsEditor(aNode({ aspects: ['ccm:iometadata'] })).aspects).toEqual(['ccm:iometadata']);
  });

  it('reduces over the lists the machinery calls .filter() on, so neither may be missing', () => {
    const node = forMdsEditor(aNode({ aspects: undefined, access: undefined }));
    expect(node.aspects).toEqual([]);
    expect(node.access).toEqual([]);
  });

  it('leaves everything else about the node as it was', () => {
    const node = forMdsEditor(aNode());
    expect(node.ref).toEqual({ id: '2c4d6b1a-8f3e-4c2b-9a10-7d5e6f8b0c31', repo: 'local' });
    expect(node.name).toBe('optik.html');
  });

  it('never writes into the node it was handed', () => {
    const original = aNode({ properties: { 'cclom:title': 'Optik' } as never });
    forMdsEditor(original);
    expect(original.properties).toEqual({ 'cclom:title': 'Optik' });
  });
});

describe('previewSrcOf', () => {
  it('reads the picture the preview widget shows', () => {
    const element = anElement(
      '<es-mds-editor-widget-preview><img src="https://example.org/optik.png"></es-mds-editor-widget-preview>',
    );
    expect(previewSrcOf(element)).toBe('https://example.org/optik.png');
  });

  it('reads the widget\'s picture rather than another one on the form', () => {
    const element = anElement(
      '<img src="https://example.org/logo.png">' +
        '<es-mds-editor-widget-preview><img src="https://example.org/optik.png"></es-mds-editor-widget-preview>',
    );
    expect(previewSrcOf(element)).toBe('https://example.org/optik.png');
  });

  it('answers nothing while the widget shows no picture — a deleted one included', () => {
    expect(previewSrcOf(anElement('<es-mds-editor-widget-preview></es-mds-editor-widget-preview>'))).toBeNull();
    expect(previewSrcOf(anElement('<es-mds-editor-widget-preview><img alt=""></es-mds-editor-widget-preview>'))).toBeNull();
  });

  it('reads the form\'s own picture where the widget is not mounted yet', () => {
    expect(previewSrcOf(anElement('<img src="https://example.org/optik.png">'))).toBe(
      'https://example.org/optik.png',
    );
  });

  it('answers nothing for a form that is not mounted at all', () => {
    expect(previewSrcOf(null)).toBeNull();
    expect(previewSrcOf(anElement('<div></div>'))).toBeNull();
  });
});
