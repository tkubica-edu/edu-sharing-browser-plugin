import { TestBed } from '@angular/core/testing';
import { HOME_REPOSITORY, NodeService } from 'ngx-edu-sharing-api';
import { beforeEach, describe, expect, it } from 'vitest';

import { of } from 'rxjs';

import { NodeApiFake, aNode, fakeNodeApi } from '../../testing/fakes';
import { provideFake } from '../../testing/provide-fake';
import { AddMaterialResult, MaterialUploadService, withScheme } from './material-upload.service';

const FOLDER = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

describe('withScheme', () => {
  it('leaves a link that names its scheme alone', () => {
    expect(withScheme('https://example.org/optik')).toBe('https://example.org/optik');
    expect(withScheme('ftp://example.org/optik')).toBe('ftp://example.org/optik');
  });

  it('gives a bare host one, since the repository stores links absolute', () => {
    expect(withScheme('example.org/optik')).toBe('http://example.org/optik');
    expect(withScheme('  example.org  ')).toBe('http://example.org');
  });
});

describe('MaterialUploadService', () => {
  let upload: MaterialUploadService;
  let nodes: NodeApiFake;

  beforeEach(() => {
    nodes = fakeNodeApi();
    TestBed.configureTestingModule({ providers: [provideFake(NodeService, nodes.fake)] });
    upload = TestBed.inject(MaterialUploadService);
  });

  /** What the nth `createChild` was asked for. */
  function createdAt(index = 0): Record<string, unknown> {
    return nodes.fake.createChild.mock.calls[index][0] as Record<string, unknown>;
  }

  /** The properties of that create. */
  function bodyAt(index = 0): Record<string, string[]> {
    return createdAt(index)['body'] as Record<string, string[]>;
  }

  describe('a link', () => {
    const aLink = (overrides: Partial<Extract<AddMaterialResult, { kind: 'link' }>> = {}) =>
      ({ kind: 'link', link: 'https://example.org/optik', ...overrides }) as AddMaterialResult;

    it('becomes a node carrying the URL, marked as user generated', async () => {
      await upload.create(aLink());

      expect(bodyAt()).toEqual({
        'cm:name': ['https://example.org/optik'],
        'ccm:wwwurl': ['https://example.org/optik'],
        'ccm:linktype': ['USER_GENERATED'],
      });
      expect(createdAt()).toMatchObject({ repository: HOME_REPOSITORY, type: 'ccm:io', node: '-inbox-' });
    });

    it('stores the link absolute', async () => {
      await upload.create(aLink({ link: 'example.org/optik' }));

      expect(bodyAt()['ccm:wwwurl']).toEqual(['http://example.org/optik']);
    });

    it('goes into the folder the dialog picked', async () => {
      await upload.create(aLink({ parent: { ref: { id: FOLDER } } }));

      expect(createdAt()['node']).toBe(FOLDER);
    });

    it('carries the LTI credentials, under the aspect that holds them', async () => {
      await upload.create(aLink({ lti: { consumerKey: 'schluessel', sharedSecret: 'geheim' } }));

      expect(createdAt()['aspects']).toEqual(['ccm:tool_instance_link']);
      expect(bodyAt()).toMatchObject({
        'ccm:tool_instance_key': ['schluessel'],
        'ccm:tool_instance_secret': ['geheim'],
      });
    });

    it('carries no aspect for a plain link', async () => {
      await upload.create(aLink());

      expect(createdAt()['aspects']).toEqual([]);
    });

    it('writes no content for it — a link node has none', async () => {
      await upload.create(aLink());

      expect(nodes.fake.changeContent).not.toHaveBeenCalled();
    });
  });

  describe('a file', () => {
    const aFile = (name = 'optik.pdf', type = 'application/pdf') =>
      new File(['inhalt'], name, { type });

    it('is created by name and then written as the node\'s content', async () => {
      await upload.create({ kind: 'file', files: [aFile()] });

      expect(bodyAt()).toEqual({ 'cm:name': ['optik.pdf'], 'cclom:title': ['optik.pdf'] });
      expect(nodes.fake.changeContent).toHaveBeenCalledWith(
        HOME_REPOSITORY,
        '2c4d6b1a-8f3e-4c2b-9a10-7d5e6f8b0c31',
        'application/pdf',
        'MAIN_FILE_UPLOAD',
        expect.objectContaining({ file: expect.any(File) }),
      );
    });

    it('types a file the browser did not', async () => {
      await upload.create({ kind: 'file', files: [aFile('optik.xyz', '')] });

      expect(nodes.fake.changeContent.mock.calls[0][2]).toBe('application/octet-stream');
    });

    it('creates several one after another, so the repository\'s renaming can do its work', async () => {
      const order: string[] = [];
      nodes.fake.createChild.mockImplementation((request: unknown) => {
        order.push(((request as { body: Record<string, string[]> }).body['cm:name'] ?? [])[0]);
        return nodes.fake.getNode('x');
      });

      await upload.create({ kind: 'file', files: [aFile('eins.pdf'), aFile('zwei.pdf')] });

      expect(order).toEqual(['eins.pdf', 'zwei.pdf']);
    });

    it('answers with one summary per file, the first being the one to continue with', async () => {
      const created = await upload.create({ kind: 'file', files: [aFile('eins.pdf'), aFile('zwei.pdf')] });

      expect(created).toHaveLength(2);
      expect(created[0]).toEqual({
        nodeId: '2c4d6b1a-8f3e-4c2b-9a10-7d5e6f8b0c31',
        name: 'optik.html',
      });
    });

    it('takes the name of the node the create made where the content write reports none', async () => {
      nodes.fake.changeContent.mockReturnValue(of(aNode({ name: undefined as never })));

      const [created] = await upload.create({ kind: 'file', files: [aFile()] });

      expect(created.name).toBe('optik.html');
    });

    it('takes a FileList as readily as an array', async () => {
      const list = { 0: aFile(), length: 1 } as unknown as FileList;

      await expect(upload.create({ kind: 'file', files: list })).resolves.toHaveLength(1);
    });
  });
});
