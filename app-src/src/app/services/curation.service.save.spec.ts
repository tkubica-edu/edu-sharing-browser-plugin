import { TestBed } from '@angular/core/testing';
import { CollectionServiceUnwrapped, Node } from 'ngx-edu-sharing-api';
import { Mock, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AuthFake,
  DevModeFake,
  MetadataAgentFake,
  NodeWriteFake,
  WebComponentFake,
  aNode,
  anActiveNode,
  fakeAuth,
  fakeDevMode,
  fakeHistory,
  fakeMetadataAgent,
  fakeNodeWrite,
  fakeNostrForward,
  fakeWebComponent,
} from '../../testing/fakes';
import { provideFake } from '../../testing/provide-fake';
import { AuthService } from './auth.service';
import { BrowserExtensionCustomWebComponentService } from './browser-extension-custom-web-component.service';
import { CurationService } from './curation.service';
import { DevModeService } from './dev-mode.service';
import { HistoryService } from './history.service';
import { MetadataAgentService } from './metadata-agent.service';
import { NodeWriteService } from './node-write.service';
import { NostrForwardService } from './nostr-forward.service';
import { QualityJudgeService } from './quality-judge.service';
import { RepositoryNodeService } from './repository-node.service';
import { SuggestionService } from './suggestion.service';

const NODE = '2c4d6b1a-8f3e-4c2b-9a10-7d5e6f8b0c31';

/**
 * The write half of `CurationService`: which route a save takes, what travels with it, and what the flow
 * records once it came back. The derived state it all reads is its own spec.
 */
describe('CurationService — writing the content', () => {
  let curation: CurationService;
  let auth: AuthFake;
  let agent: MetadataAgentFake;
  let devMode: DevModeFake;
  let webComponent: WebComponentFake;
  let nodeWrite: NodeWriteFake;
  let repositoryNodes: {
    create: Mock;
    update: Mock;
    get: Mock;
    writeExtendedData: Mock;
    setPreview: Mock;
    addWorkflowStatus: Mock;
    moveTo: Mock;
  };
  let suggestions: { propose: Mock };
  let collections: { addToCollection: Mock };

  beforeEach(() => {
    auth = fakeAuth();
    auth.signIn();
    agent = fakeMetadataAgent();
    devMode = fakeDevMode();
    webComponent = fakeWebComponent(true);
    nodeWrite = fakeNodeWrite();
    repositoryNodes = {
      create: vi.fn(async () => ({ nodeId: NODE, name: 'optik.html' })),
      update: vi.fn(async () => ({ nodeId: NODE, name: 'optik.html' })),
      get: vi.fn(async () => aNode({ properties: { 'cclom:title': ['Optik'] } } as Partial<Node>)),
      writeExtendedData: vi.fn(async () => [] as string[]),
      setPreview: vi.fn(async () => undefined),
      addWorkflowStatus: vi.fn(async () => undefined),
      moveTo: vi.fn(async () => undefined),
    };
    suggestions = { propose: vi.fn(async () => true) };
    collections = { addToCollection: vi.fn(() => ({ subscribe: () => undefined })) };

    TestBed.configureTestingModule({
      providers: [
        provideFake(AuthService, auth.fake),
        provideFake(MetadataAgentService, agent.fake),
        provideFake(DevModeService, devMode.fake),
        provideFake(BrowserExtensionCustomWebComponentService, webComponent.fake),
        provideFake(NodeWriteService, nodeWrite.fake),
        provideFake(RepositoryNodeService, repositoryNodes as never),
        provideFake(SuggestionService, suggestions as never),
        provideFake(QualityJudgeService, { running: vi.fn(() => false) } as never),
        provideFake(NostrForwardService, fakeNostrForward().fake),
        provideFake(HistoryService, fakeHistory().fake),
        provideFake(CollectionServiceUnwrapped, collections as never),
      ],
    });
    curation = TestBed.inject(CurationService);
  });

  /** The panel writes as a guest through the agent, which is the other of the two routes. */
  function asGuest(): void {
    auth.fake.loggedIn.set(false);
    auth.fake.authorized.set(true);
  }

  describe('which route the save takes', () => {
    it('writes the node itself for a signed-in user', async () => {
      await curation.save({ 'cclom:title': ['Optik'] });

      expect(repositoryNodes.create).toHaveBeenCalled();
      expect(nodeWrite.fake.write).not.toHaveBeenCalled();
    });

    it('goes through the agent for a session that may not create a node itself', async () => {
      asGuest();

      await curation.save({ 'cclom:title': ['Optik'] });

      expect(nodeWrite.fake.write).toHaveBeenCalled();
      expect(repositoryNodes.create).not.toHaveBeenCalled();
    });

    it('writes nothing at all where the panel is not authorized', async () => {
      auth.fake.authorized.set(false);

      await expect(curation.save({ 'cclom:title': ['Optik'] })).resolves.toBe(false);
      expect(repositoryNodes.create).not.toHaveBeenCalled();
      expect(nodeWrite.fake.write).not.toHaveBeenCalled();
    });

    it('says it is saving while it is, and stops saying so however it ends', async () => {
      const pending = curation.save({});
      expect(curation.saving()).toBe(true);
      await pending;
      expect(curation.saving()).toBe(false);

      repositoryNodes.create.mockRejectedValueOnce(new Error('kaputt'));
      await curation.save({});
      expect(curation.saving()).toBe(false);
    });

    it('reports a write that threw rather than letting it out', async () => {
      repositoryNodes.create.mockRejectedValueOnce(new Error('Repository nicht erreichbar'));

      await expect(curation.save({})).resolves.toBe(false);
      expect(curation.saveError()).toBe('Repository nicht erreichbar');
    });
  });

  describe('what goes out with it', () => {
    it('lays what a step recorded underneath what the editor reported', async () => {
      curation.recordValues({ 'ccm:taxonid': ['380'], 'cclom:title': ['Vom Schritt'] });

      await curation.save({ 'cclom:title': ['Vom Editor'] });

      expect(repositoryNodes.create).toHaveBeenCalledWith(
        { 'ccm:taxonid': ['380'], 'cclom:title': ['Vom Editor'] },
        undefined,
      );
    });

    it('states the licence on the write that describes the content, widget or no widget', async () => {
      agent.hasRead({ 'ccm:commonlicense_key': 'CC BY-SA' });

      await curation.save({ 'cclom:title': ['Optik'] }, null, { metadata: true });

      expect(repositoryNodes.create.mock.calls[0][0]).toMatchObject({
        'ccm:commonlicense_key': ['CC_BY_SA'],
      });
    });

    it('states none on a step that merely writes what it decided', async () => {
      agent.hasRead({ 'ccm:commonlicense_key': 'CC BY-SA' });

      await curation.save({ 'cclom:title': ['Optik'] });

      expect(repositoryNodes.create.mock.calls[0][0]).not.toHaveProperty('ccm:commonlicense_key');
    });

    it('creates the node in the folder the filing step picked', async () => {
      curation.setStorageParent(aNode({ ref: { id: 'folder-1', repo: 'local' } } as Partial<Node>));

      await curation.save({});

      expect(repositoryNodes.create).toHaveBeenCalledWith({}, 'folder-1');
    });

    it('updates an existing node instead, keeping its name', async () => {
      curation.activeNode.set(anActiveNode(NODE, 'optik.html'));

      await curation.save({ 'cclom:title': ['Optik'] });

      expect(repositoryNodes.update).toHaveBeenCalledWith(NODE, { 'cclom:title': ['Optik'] }, 'optik.html');
      expect(repositoryNodes.create).not.toHaveBeenCalled();
    });

    it('writes the WLO extended fields only on the step that describes the content', async () => {
      await curation.save({}, null, { metadata: true });
      expect(repositoryNodes.writeExtendedData).toHaveBeenCalled();

      repositoryNodes.writeExtendedData.mockClear();
      await curation.save({});
      expect(repositoryNodes.writeExtendedData).not.toHaveBeenCalled();
    });
  });

  describe('what the flow records once it came back', () => {
    it('takes the written node as the one in hand, and as the user\'s own', async () => {
      await curation.save({});

      expect(curation.activeNode()?.nodeId).toBe(NODE);
      expect(curation.nodeSourceOf()).toBe('chosen');
      expect(curation.metadataSaved()).toBe(true);
      expect(curation.hasUnsavedWork()).toBe(false);
    });

    it('clears what the steps recorded, since the node now carries it', async () => {
      curation.recordValues({ 'ccm:taxonid': ['380'] });

      await curation.save({});

      expect(curation.hasCollectedValues()).toBe(false);
    });

    it('reads the node back once, so the editor and the preview work on what was stored', async () => {
      await curation.save({});

      expect(repositoryNodes.get).toHaveBeenCalledWith(NODE);
      expect(curation.previewNode()).not.toBeNull();
      expect(curation.nodeMetadata()).toEqual({ 'cclom:title': ['Optik'] });
    });

    it('keeps the editor as it stands where that read fails', async () => {
      repositoryNodes.get.mockRejectedValue(new Error('may not read it'));

      await expect(curation.save({})).resolves.toBe(true);
      expect(curation.previewNode()).toBeNull();
    });

    it('counts the Erschließung as done only once the handover went through', async () => {
      await curation.save({}, null, { review: true });

      expect(curation.curationUnfinished()).toBe(false);
    });

    it('leaves it undone where the handover was refused', async () => {
      repositoryNodes.addWorkflowStatus.mockRejectedValue(new Error('no permission'));

      await curation.save({}, null, { review: true });

      expect(curation.workflowError()).not.toBeNull();
      expect(curation.curationUnfinished()).toBe(true);
    });
  });

  describe('through the agent', () => {
    beforeEach(asGuest);

    it('hands the endpoint the values, the payload and the steps in one request', async () => {
      agent.hasRead({ contextName: 'wlo', 'cclom:title': 'Optik' });
      curation.setPersonalCollections([{ id: 'c1', name: 'Physik' }]);

      await curation.save({ 'cclom:title': ['Optik'] }, null, { metadata: true, review: true });

      expect(nodeWrite.fake.write).toHaveBeenCalledWith(
        expect.objectContaining({ 'cclom:title': ['Optik'] }),
        expect.objectContaining({ contextName: 'wlo' }),
        null,
        expect.objectContaining({ collections: ['c1'], review: true, extended: true }),
      );
    });

    it('names the node it is updating on a second save', async () => {
      curation.activeNode.set(anActiveNode(NODE));

      await curation.save({});

      expect(nodeWrite.fake.write.mock.calls[0][2]).toBe(NODE);
    });

    it('reports a refusal and writes nothing', async () => {
      nodeWrite.refuses('Speichern nicht möglich');

      await expect(curation.save({})).resolves.toBe(false);
      expect(curation.saveError()).toBe('Speichern nicht möglich');
      expect(curation.metadataSaved()).toBe(false);
    });

    it('reports a refused handover without calling the write itself failed', async () => {
      nodeWrite.writes({ workflowError: 'Der Status konnte nicht gesetzt werden.' });

      await expect(curation.save({}, null, { review: true })).resolves.toBe(true);
      expect(curation.workflowError()).toBe('Der Status konnte nicht gesetzt werden.');
      expect(curation.curationUnfinished()).toBe(true);
    });

    it('reports a filing that did not happen, from the same answer', async () => {
      nodeWrite.writes({ collectionError: 'Die Sammlung nimmt den Inhalt nicht an.' });

      await curation.save({});

      expect(curation.assignError()).toBe('Die Sammlung nimmt den Inhalt nicht an.');
    });

    it('replaces the repository\'s own account of a closed editing window', async () => {
      const longAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
      curation.previewNode.set(aNode({ createdAt: longAgo } as Partial<Node>));
      nodeWrite.refuses('node 2c4d… created 2026-05-06, 3.2 hours old');

      await curation.save({});

      expect(curation.saveError()).not.toContain('hours old');
      expect(curation.saveError()).toMatch(/\S/);
    });

    it('records the collections the endpoint filed, so a second save does not file them again', async () => {
      curation.setPersonalCollections([{ id: 'c1', name: 'Physik' }]);

      await curation.save({});
      expect(nodeWrite.fake.write.mock.calls[0][3]?.collections).toEqual(['c1']);

      await curation.save({});
      expect(nodeWrite.fake.write.mock.calls[1][3]?.collections).toEqual([]);
    });
  });

  describe('createContent', () => {
    it('writes picture, title and the page the content was read off', async () => {
      agent.hasRead({ 'cclom:title': 'Optik', 'ccm:wwwurl': 'https://example.org/optik' });

      await expect(curation.createContent()).resolves.toBe(true);

      expect(repositoryNodes.create.mock.calls[0][0]).toMatchObject({
        'cclom:title': ['Optik'],
        'ccm:wwwurl': ['https://example.org/optik'],
      });
    });

    it('lays the run\'s findings down as KI-Vorschläge, since the node now exists to hang them off', async () => {
      agent.hasRead({ 'cclom:title': 'Optik', _origins: { 'cclom:title': 'ai' } });

      await curation.createContent();

      expect(suggestions.propose).toHaveBeenCalledWith(NODE, expect.objectContaining({ 'cclom:title': 'Optik' }));
    });

    it('proposes nothing on the agent\'s route — that node is not this session\'s to propose on', async () => {
      asGuest();
      agent.hasRead({ 'cclom:title': 'Optik' });

      await curation.createContent();

      expect(suggestions.propose).not.toHaveBeenCalled();
    });

    it('proposes nothing where the write did not go through', async () => {
      repositoryNodes.create.mockRejectedValue(new Error('kaputt'));

      await expect(curation.createContent()).resolves.toBe(false);
      expect(suggestions.propose).not.toHaveBeenCalled();
    });
  });

  describe('saveCollected', () => {
    it('sends no request for a step that collected nothing', async () => {
      curation.activeNode.set(anActiveNode(NODE));

      await expect(curation.saveCollected()).resolves.toBe(true);

      expect(repositoryNodes.update).not.toHaveBeenCalled();
    });

    it('writes what a step recorded', async () => {
      curation.activeNode.set(anActiveNode(NODE));
      curation.recordValues({ 'ccm:taxonid': ['380'] });

      await curation.saveCollected();

      expect(repositoryNodes.update).toHaveBeenCalled();
    });

    it('writes for a step that asks for a workflow status even with nothing else to say', async () => {
      curation.activeNode.set(anActiveNode(NODE));

      await curation.saveCollected({ quality: true });

      expect(repositoryNodes.update).toHaveBeenCalled();
    });
  });

  describe('with the writes switched off', () => {
    beforeEach(() => devMode.fake.writesSkipped.set(true));

    it('answers as if the write had gone through, without making one', async () => {
      await expect(curation.save({ 'cclom:title': ['Optik'] })).resolves.toBe(true);

      expect(repositoryNodes.create).not.toHaveBeenCalled();
      expect(nodeWrite.fake.write).not.toHaveBeenCalled();
    });

    it('invents no node, so the steps behind it keep working off the run', async () => {
      agent.hasRead({ 'cclom:title': 'Optik' });

      await curation.save({});

      expect(curation.activeNode()).toBeNull();
      expect(curation.hasCuratedResult()).toBe(true);
    });

    it('stops the panel asking about losing unsaved work', async () => {
      await curation.save({});

      expect(curation.hasUnsavedWork()).toBe(false);
      expect(curation.metadataSaved()).toBe(true);
    });

    it('counts the Erschließung as done once the handover step is walked', async () => {
      await curation.save({}, null, { review: true });

      expect(curation.curationUnfinished()).toBe(false);
    });
  });
});
