import { TestBed } from '@angular/core/testing';
import { HOME_REPOSITORY, Node, NodeService, NodeServiceUnwrapped, UserService } from 'ngx-edu-sharing-api';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  NodeApiFake,
  NodeApiUnwrappedFake,
  UserApiFake,
  aNode,
  fakeNodeApi,
  fakeNodeApiUnwrapped,
  fakeUserApi,
} from '../../testing/fakes';
import { provideFake } from '../../testing/provide-fake';
import { RepositoryNodeService } from './repository-node.service';

const NODE = '2c4d6b1a-8f3e-4c2b-9a10-7d5e6f8b0c31';
const FOLDER = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

describe('RepositoryNodeService', () => {
  let repository: RepositoryNodeService;
  let nodes: NodeApiFake;
  let unwrapped: NodeApiUnwrappedFake;
  let users: UserApiFake;

  beforeEach(() => {
    localStorage.clear();
    nodes = fakeNodeApi();
    unwrapped = fakeNodeApiUnwrapped();
    users = fakeUserApi();
    TestBed.configureTestingModule({
      providers: [
        provideFake(NodeService, nodes.fake),
        provideFake(NodeServiceUnwrapped, unwrapped.fake),
        provideFake(UserService, users.fake),
      ],
    });
    repository = TestBed.inject(RepositoryNodeService);
  });

  afterEach(() => localStorage.clear());

  /** What a `createChild` was asked for. */
  function created(): { node: string; body: Record<string, string[]> } {
    return unwrapped.fake.createChild.mock.calls[0][0] as never;
  }

  describe('defaultParent', () => {
    it('takes the folder the profile names as the default', async () => {
      users.prefers({ defaultInboxFolder: FOLDER });

      await repository.defaultParent();

      expect(nodes.fake.getNode).toHaveBeenCalledWith(FOLDER);
    });

    it('takes the browser\'s copy for a session with no profile to read', async () => {
      users.hasNoPreferences();
      localStorage.setItem('defaultInboxFolder', JSON.stringify(FOLDER));

      await repository.defaultParent();

      expect(nodes.fake.getNode).toHaveBeenCalledWith(FOLDER);
    });

    it('prefers the profile over the browser\'s copy', async () => {
      users.prefers({ defaultInboxFolder: FOLDER });
      localStorage.setItem('defaultInboxFolder', JSON.stringify('ein-anderer'));

      await repository.defaultParent();

      expect(nodes.fake.getNode).toHaveBeenCalledWith(FOLDER);
    });

    it('files into the inbox where nobody set a default', async () => {
      await repository.defaultParent();

      expect(nodes.fake.getNode).toHaveBeenCalledWith('-inbox-');
    });

    it('ignores a stored setting that is not a node id', async () => {
      users.prefers({ defaultInboxFolder: '   ' });
      localStorage.setItem('defaultInboxFolder', 'kein JSON');

      await repository.defaultParent();

      expect(nodes.fake.getNode).toHaveBeenCalledWith('-inbox-');
    });

    it('falls back to the inbox where the default cannot be loaded — an unseen place is worse', async () => {
      users.prefers({ defaultInboxFolder: FOLDER });
      nodes.fake.getNode.mockImplementationOnce(() => {
        throw new Error('gone');
      });

      await repository.defaultParent();

      expect(nodes.fake.getNode).toHaveBeenLastCalledWith('-inbox-');
    });
  });

  describe('create', () => {
    it('creates a ccm:io in the given folder, obeying the metadata set', async () => {
      await repository.create({ 'cclom:title': ['Optik'] }, FOLDER);

      expect(unwrapped.fake.createChild).toHaveBeenCalledWith(
        expect.objectContaining({
          repository: HOME_REPOSITORY,
          node: FOLDER,
          type: 'ccm:io',
          renameIfExists: true,
          obeyMds: true,
        }),
      );
    });

    it('files into the inbox where no folder was picked', async () => {
      await repository.create({});

      expect(created().node).toBe('-inbox-');
    });

    it('names the node after its title, since a node cannot be created without a name', async () => {
      await repository.create({ 'cclom:title': ['Optik'] });

      expect(created().body['cm:name']).toEqual(['Optik']);
    });

    it('keeps a name the values carry', async () => {
      await repository.create({ 'cclom:title': ['Optik'], 'cm:name': ['optik.html'] });

      expect(created().body['cm:name']).toEqual(['optik.html']);
    });

    it('invents one where the metadata carries no title either', async () => {
      await repository.create({});

      expect(created().body['cm:name']).toEqual(['Neue Ressource']);
    });

    it('answers with what the repository made of it', async () => {
      await expect(repository.create({})).resolves.toEqual({ nodeId: NODE, name: 'optik.html' });
    });
  });

  describe('writeExtendedData', () => {
    it('writes the fields the metadata set does not define, in one call that does not obey it', async () => {
      const failed = await repository.writeExtendedData(NODE, { 'ccm:oeh_lrt': ['a'] });

      expect(failed).toEqual([]);
      expect(nodes.fake.editNodeMetadata).toHaveBeenCalledWith(
        NODE,
        { 'ccm:oeh_lrt': ['a'] },
        expect.objectContaining({ obeyMds: false }),
      );
    });

    it('asks nothing where there is nothing to write', async () => {
      await expect(repository.writeExtendedData(NODE, {})).resolves.toEqual([]);
      expect(nodes.fake.editNodeMetadata).not.toHaveBeenCalled();
    });

    it('retries field by field, since one refused property fails the whole request', async () => {
      nodes.refusesProperty('ccm:oeh_extendedType');

      const failed = await repository.writeExtendedData(NODE, {
        'ccm:oeh_extendedType': ['x'],
        'ccm:oeh_lrt': ['a'],
      });

      expect(failed).toEqual(['ccm:oeh_extendedType']);
      // The bulk write, then one per field.
      expect(nodes.fake.editNodeMetadata).toHaveBeenCalledTimes(3);
    });

    it('names every field that did not get through', async () => {
      nodes.refuses('editNodeMetadata');

      await expect(
        repository.writeExtendedData(NODE, { 'ccm:oeh_lrt': ['a'], 'ccm:oeh_extendedData': ['{}'] }),
      ).resolves.toEqual(['ccm:oeh_lrt', 'ccm:oeh_extendedData']);
    });
  });

  describe('update', () => {
    it('writes the values as the shape the repository expects', async () => {
      await repository.update(NODE, { 'cclom:title': ['Optik'] } as never);

      expect(nodes.fake.editNodeMetadata).toHaveBeenCalledWith(
        NODE,
        expect.objectContaining({ 'cclom:title': ['Optik'] }),
        expect.objectContaining({ versionComment: 'METADATA_UPDATE' }),
      );
    });

    it('keeps the node\'s name where the values carry none, so a document keeps its extension', async () => {
      await repository.update(NODE, {}, 'optik.html');

      expect(nodes.fake.editNodeMetadata.mock.calls[0][1]['cm:name']).toEqual(['optik.html']);
    });

    it('never renames a node from its title', async () => {
      await repository.update(NODE, { 'cclom:title': ['Ein neuer Titel'] }, 'optik.html');

      expect(nodes.fake.editNodeMetadata.mock.calls[0][1]['cm:name']).toEqual(['optik.html']);
    });

    it('sends no name at all where none is known, letting the repository re-derive it', async () => {
      await repository.update(NODE, {});

      expect(nodes.fake.editNodeMetadata.mock.calls[0][1]).not.toHaveProperty('cm:name');
    });

    it('lets a name the values carry stand', async () => {
      await repository.update(NODE, { 'cm:name': ['neu.html'] }, 'optik.html');

      expect(nodes.fake.editNodeMetadata.mock.calls[0][1]['cm:name']).toEqual(['neu.html']);
    });
  });

  describe('setPreview', () => {
    it('replaces the picture, without creating a version for it', async () => {
      await repository.setPreview(NODE, new Blob(['bild'], { type: 'image/jpeg' }));

      expect(unwrapped.fake.changePreview).toHaveBeenCalledWith(
        expect.objectContaining({ node: NODE, mimetype: 'image/jpeg', createVersion: false }),
      );
    });

    it('types a picture the browser did not', async () => {
      await repository.setPreview(NODE, new Blob(['bild']));

      expect(unwrapped.fake.changePreview.mock.calls[0][0]).toMatchObject({ mimetype: 'image/png' });
    });
  });

  describe('addWorkflowStatus', () => {
    it('adds a step rather than overwriting the one before', async () => {
      await repository.addWorkflowStatus(NODE, 'ccm:workflow_checked', 'geprüft', ['GROUP_Redaktion']);

      expect(unwrapped.fake.addWorkflowHistory).toHaveBeenCalledWith(
        expect.objectContaining({
          node: NODE,
          body: {
            status: 'ccm:workflow_checked',
            comment: 'geprüft',
            receiver: [{ authorityName: 'GROUP_Redaktion' }],
          },
        }),
      );
    });

    it('addresses nobody for a state that merely records an outcome', async () => {
      await repository.addWorkflowStatus(NODE, 'ccm:workflow_done');

      expect(unwrapped.fake.addWorkflowHistory.mock.calls[0][0]).toMatchObject({
        body: { comment: '', receiver: [] },
      });
    });
  });

  describe('moveTo', () => {
    it('moves the node into the folder the filing step decided on', async () => {
      await repository.moveTo(NODE, FOLDER);

      expect(unwrapped.fake.createChildByMoving).toHaveBeenCalledWith(
        expect.objectContaining({ node: FOLDER, source: NODE }),
      );
    });
  });

  describe('get and ancestors', () => {
    it('loads the whole node', async () => {
      await expect(repository.get(NODE)).resolves.toMatchObject({ name: 'optik.html' });
    });

    it('answers where a node sits, closest first', async () => {
      const folder = aNode({ name: 'Sammlung' } as Partial<Node>);
      nodes.sitsIn([folder]);

      await expect(repository.ancestors(NODE)).resolves.toEqual([folder]);
    });

    it('answers with nothing for a node the repository names no place for', async () => {
      await expect(repository.ancestors(NODE)).resolves.toEqual([]);
    });
  });
});
