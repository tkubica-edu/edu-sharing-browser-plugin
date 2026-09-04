import { TestBed } from '@angular/core/testing';
import { CollectionServiceUnwrapped, HOME_REPOSITORY, Node } from 'ngx-edu-sharing-api';
import { Observable, of, throwError } from 'rxjs';
import { Mock, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AuthFake,
  HistoryFake,
  MetadataAgentFake,
  WebComponentFake,
  aHistoryEntry,
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
import { HistoryEntry, HistoryService } from './history.service';
import { MetadataAgentService } from './metadata-agent.service';
import { NodeWriteService } from './node-write.service';
import { NostrForwardService } from './nostr-forward.service';
import { QualityJudgeService } from './quality-judge.service';
import { RepositoryNodeService } from './repository-node.service';
import { SuggestionService } from './suggestion.service';
import { aParsedRun } from '../../testing/fakes/metadata-agent.fake';

const NODE = '2c4d6b1a-8f3e-4c2b-9a10-7d5e6f8b0c31';
const OTHER = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

/** An entry as a save left it, carrying everything a content is taken back up from. */
function anEntry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return aHistoryEntry({
    nodeId: NODE,
    url: 'https://example.org/optik',
    title: 'Optik',
    parsed: aParsedRun({ 'cclom:title': 'Optik' }),
    ...overrides,
  });
}

/**
 * Taking a content back up: from the Verlauf, from a node the page announced, and across a page change.
 * The state these produce and the write that follows them are the other two `curation.service` specs.
 */
describe('CurationService — taking a content back up', () => {
  let curation: CurationService;
  let auth: AuthFake;
  let agent: MetadataAgentFake;
  let history: HistoryFake;
  let webComponent: WebComponentFake;
  let qualityJudge: { start: Mock; reset: Mock; running: Mock };
  let repositoryNodes: {
    get: Mock;
    create: Mock;
    update: Mock;
    writeExtendedData: Mock;
    addWorkflowStatus: Mock;
    setPreview: Mock;
    moveTo: Mock;
  };
  let collections: { addToCollection: Mock };

  /** Which collections the repository refuses to take the content into. */
  let refusedCollections: Set<string>;

  beforeEach(() => {
    auth = fakeAuth();
    auth.signIn();
    agent = fakeMetadataAgent();
    history = fakeHistory();
    webComponent = fakeWebComponent(true);
    qualityJudge = { start: vi.fn(), reset: vi.fn(), running: vi.fn(() => false) };
    repositoryNodes = {
      get: vi.fn(async () => aNode({ properties: { 'cclom:title': ['Vom Knoten'] } } as Partial<Node>)),
      create: vi.fn(async () => ({ nodeId: NODE, name: 'optik.html' })),
      update: vi.fn(async () => ({ nodeId: NODE, name: 'optik.html' })),
      writeExtendedData: vi.fn(async () => [] as string[]),
      addWorkflowStatus: vi.fn(async () => undefined),
      setPreview: vi.fn(async () => undefined),
      moveTo: vi.fn(async () => undefined),
    };
    refusedCollections = new Set();
    collections = {
      addToCollection: vi.fn(
        (request: { collection: string }): Observable<unknown> =>
          refusedCollections.has(request.collection)
            ? throwError(() => new Error(`refused ${request.collection}`))
            : of({}),
      ),
    };

    TestBed.configureTestingModule({
      providers: [
        provideFake(AuthService, auth.fake),
        provideFake(MetadataAgentService, agent.fake),
        provideFake(DevModeService, fakeDevMode().fake),
        provideFake(BrowserExtensionCustomWebComponentService, webComponent.fake),
        provideFake(NodeWriteService, fakeNodeWrite().fake),
        provideFake(RepositoryNodeService, repositoryNodes as never),
        provideFake(SuggestionService, { propose: vi.fn(async () => true) } as never),
        provideFake(QualityJudgeService, qualityJudge as never),
        provideFake(NostrForwardService, fakeNostrForward().fake),
        provideFake(HistoryService, history.fake),
        provideFake(CollectionServiceUnwrapped, collections as never),
      ],
    });
    curation = TestBed.inject(CurationService);
  });

  /** The panel is a guest session — the one that may not read the nodes the agent wrote. */
  function asGuest(): void {
    auth.fake.loggedIn.set(false);
    auth.fake.authorized.set(true);
  }

  /** The repository will not hand this node back. */
  function unreadable(): void {
    repositoryNodes.get.mockRejectedValue(new Error('may not read it'));
  }

  describe('openFromHistory', () => {
    it('works on the live node where this session may read it', async () => {
      await curation.openFromHistory(anEntry());

      expect(repositoryNodes.get).toHaveBeenCalledWith(NODE);
      expect(curation.activeNode()?.nodeId).toBe(NODE);
      expect(curation.nodeMetadata()).toEqual({ 'cclom:title': ['Vom Knoten'] });
    });

    it('never asks for a node a guest session would only be refused', async () => {
      asGuest();

      await curation.openFromHistory(anEntry());

      expect(repositoryNodes.get).not.toHaveBeenCalled();
      expect(curation.activeNode()?.nodeId).toBe(NODE);
    });

    it('stands the entry in where the repository will not hand the node back', async () => {
      unreadable();

      await curation.openFromHistory(anEntry());

      expect(curation.activeNode()?.nodeId).toBe(NODE);
      expect(curation.contentTitle()).toBe('Optik');
    });

    it('dates the stand-in by the save that wrote it, so a reopened content is not always editable', async () => {
      asGuest();
      const longAgo = Date.now() - 3 * 60 * 60 * 1000;

      await curation.openFromHistory(anEntry({ timestamp: longAgo }));

      expect(curation.agentEditWindowClosed()).toBe(true);
    });

    it('lets a saved creation date outrank the entry\'s own timestamp', async () => {
      asGuest();

      await curation.openFromHistory(
        anEntry({
          timestamp: Date.now() - 3 * 60 * 60 * 1000,
          parsed: aParsedRun({ 'cm:created': String(Date.now()) }),
        }),
      );

      expect(curation.agentEditWindowClosed()).toBe(false);
    });

    it('puts the Erschließung back, so no step asks to be done a second time', async () => {
      const run = aParsedRun({ 'cclom:general_keyword': 'Linsen' });

      await curation.openFromHistory(anEntry({ run }));

      expect(agent.fake.restore).toHaveBeenCalledWith(
        expect.objectContaining({ ok: true, parsed: run, source: expect.objectContaining({ url: 'https://example.org/optik' }) }),
      );
      expect(curation.hasCuratedResult()).toBe(true);
    });

    it('stands the node\'s own fields in for an entry written before runs were kept', async () => {
      const parsed = aParsedRun({ 'cclom:title': 'Optik' });

      await curation.openFromHistory(anEntry({ run: undefined, parsed }));

      expect(agent.fake.restore).toHaveBeenCalledWith(expect.objectContaining({ parsed }));
    });

    it('puts back how far the Qualitätsprüfung had got', async () => {
      await curation.openFromHistory(anEntry({ quality: { criteriaMet: true, confirmed: true } }));

      expect(curation.qualityCriteriaMet()).toBe(true);
      expect(curation.qualityConfirmed()).toBe(true);
    });

    it('leaves an unknown Erschließung unknown rather than reading it as unfinished', async () => {
      await curation.openFromHistory(anEntry({ finished: undefined }));
      expect(curation.curationUnfinished()).toBe(false);

      await curation.openFromHistory(anEntry({ finished: false }));
      expect(curation.curationUnfinished()).toBe(true);
    });

    it('puts back the step it was left on, and the teams it stands proposed to', async () => {
      const step = { section: 'quality' as const, tab: null };
      const forwardings = [{ group: { id: 'g1', name: 'Redaktion A' } }];

      await curation.openFromHistory(anEntry({ step, forwardings }));

      expect(curation.leftAtStep()).toEqual(step);
      expect(curation.savedForwardings()).toEqual(forwardings);
      expect(curation.contentForwardings()).toEqual(forwardings);
    });

    it('marks the page to be erschlossen again for an entry that carries no run', async () => {
      await curation.openFromHistory(anEntry({ run: undefined }));

      expect(curation.pendingExtraction()).toBe('https://example.org/optik');
    });

    it('marks none where the entry carries one already', async () => {
      await curation.openFromHistory(anEntry({ run: aParsedRun({ 'cclom:title': 'Optik' }) }));

      expect(curation.pendingExtraction()).toBeNull();
    });

    it('marks none where the agent cannot run at all', async () => {
      webComponent.fake.offeredByRepository.set(false);

      await curation.openFromHistory(anEntry({ run: undefined }));

      expect(curation.pendingExtraction()).toBeNull();
    });

    it('takes the content up as picked unless the caller says it was recognised', async () => {
      await curation.openFromHistory(anEntry());
      expect(curation.hasDetectedNode()).toBe(false);

      await curation.openFromHistory(anEntry(), 'detected');
      expect(curation.hasDetectedNode()).toBe(true);
    });
  });

  describe('runPendingExtraction', () => {
    it('erschließt the page the taken-up content names, and judges it behind that', async () => {
      agent.reads({ 'cclom:general_keyword': 'Linsen' });

      await curation.resumePendingExtraction('https://example.org/optik');

      expect(agent.fake.runForUrl.mock.calls[0][0]).toBe('https://example.org/optik');
      expect(curation.pendingExtraction()).toBeNull();
      expect(qualityJudge.start).toHaveBeenCalled();
    });

    it('keeps the mark where the run did not answer, so the next page picks it up', async () => {
      agent.fails();

      await curation.resumePendingExtraction('https://example.org/optik');

      expect(curation.pendingExtraction()).toBe('https://example.org/optik');
    });

    it('drops the mark unrun where the agent is not a function of this repository', async () => {
      webComponent.fake.offeredByRepository.set(false);

      await curation.resumePendingExtraction('https://example.org/optik');

      expect(agent.fake.runForUrl).not.toHaveBeenCalled();
      expect(curation.pendingExtraction()).toBeNull();
    });

    it('runs nothing while the panel is not authorized, or while a run is already out', async () => {
      auth.fake.authorized.set(false);
      await curation.resumePendingExtraction('https://example.org/optik');
      expect(agent.fake.runForUrl).not.toHaveBeenCalled();

      auth.signIn();
      agent.fake.running.set(true);
      await curation.runPendingExtraction();
      expect(agent.fake.runForUrl).not.toHaveBeenCalled();
    });
  });

  describe('adoptRememberedNode', () => {
    it('takes the content the history holds for the open page, and erschließt its page at once', async () => {
      await expect(curation.adoptRememberedNode(anEntry({ run: undefined }))).resolves.toBe(true);

      expect(curation.hasDetectedNode()).toBe(true);
      expect(agent.fake.runForUrl).toHaveBeenCalled();
    });

    it('takes none where the panel already has a content in hand', async () => {
      curation.activeNode.set(anActiveNode(OTHER));

      await expect(curation.adoptRememberedNode(anEntry())).resolves.toBe(false);
    });

    it('takes none over unsaved work', async () => {
      agent.hasRead({ 'cclom:title': 'Optik' });
      await curation.analyze();

      await expect(curation.adoptRememberedNode(anEntry())).resolves.toBe(false);
      expect(curation.hasUnsavedWork()).toBe(true);
    });
  });

  describe('adoptDetectedNode', () => {
    it('takes a node that turned up on its own, without writing it to the history', () => {
      curation.adoptDetectedNode(aNode({ name: 'optik.html' } as Partial<Node>));

      expect(curation.hasDetectedNode()).toBe(true);
      expect(curation.activeNode()?.name).toBe('optik.html');
      expect(history.fake.add).not.toHaveBeenCalled();
    });

    it('never names it by its node id where the name is unknown', () => {
      curation.adoptDetectedNode(aNode({ name: undefined } as Partial<Node>));

      expect(curation.activeNode()?.name).toBeNull();
    });

    it('is ignored once anything else is in hand, so a late arrival never clobbers the work', () => {
      curation.activeNode.set(anActiveNode(OTHER));

      curation.adoptDetectedNode(aNode());

      expect(curation.activeNode()?.nodeId).toBe(OTHER);
    });

    it('takes the stored entry for a node that arrived without its properties', () => {
      history.fake.entries.set([anEntry({ title: 'Aus dem Verlauf' })]);

      curation.adoptDetectedNode({ ref: { id: NODE } } as Node);

      expect(curation.activeNode()?.name).toBe('Aus dem Verlauf');
      expect(repositoryNodes.get).not.toHaveBeenCalled();
    });

    it('loads such a node once where nothing is remembered about it', async () => {
      curation.adoptDetectedNode({ ref: { id: NODE } } as Node);

      // The load is started and not awaited, so the metadata arriving is what says it happened.
      await vi.waitFor(() => expect(curation.nodeMetadata()).toEqual({ 'cclom:title': ['Vom Knoten'] }));
      expect(repositoryNodes.get).toHaveBeenCalledWith(NODE);
    });

    it('loads none for a guest session, which may not read it anyway', () => {
      asGuest();

      curation.adoptDetectedNode({ ref: { id: NODE } } as Node);

      expect(repositoryNodes.get).not.toHaveBeenCalled();
    });
  });

  describe('adoptDetectedNodeId', () => {
    it('loads the node and takes it up', async () => {
      await expect(curation.adoptDetectedNodeId(NODE)).resolves.toBe(true);

      expect(curation.hasDetectedNode()).toBe(true);
    });

    it('costs no request where the panel has moved on', async () => {
      curation.activeNode.set(anActiveNode(OTHER));

      await expect(curation.adoptDetectedNodeId(NODE)).resolves.toBe(false);
      expect(repositoryNodes.get).not.toHaveBeenCalled();
    });

    it('takes up none it cannot read', async () => {
      unreadable();

      await expect(curation.adoptDetectedNodeId(NODE)).resolves.toBe(false);
      expect(curation.activeNode()).toBeNull();
    });

    it('goes through the stored entry for a guest, whose node the agent wrote', async () => {
      asGuest();
      history.fake.entries.set([anEntry({ title: 'Aus dem Verlauf' })]);

      await expect(curation.adoptDetectedNodeId(NODE)).resolves.toBe(true);

      expect(repositoryNodes.get).not.toHaveBeenCalled();
      expect(curation.activeNode()?.name).toBe('Aus dem Verlauf');
    });

    it('works a signed-in session on the live node even where an entry exists', async () => {
      history.fake.entries.set([anEntry({ title: 'Aus dem Verlauf' })]);

      await curation.adoptDetectedNodeId(NODE);

      expect(repositoryNodes.get).toHaveBeenCalledWith(NODE);
    });
  });

  describe('openNode', () => {
    it('opens a node received from outside and records it, since no Erschließung is behind it', async () => {
      await curation.openNode(NODE);

      expect(curation.activeNode()?.nodeId).toBe(NODE);
      expect(agent.fake.reset).toHaveBeenCalled();
      expect(history.fake.add).toHaveBeenCalledWith(
        expect.objectContaining({ nodeId: NODE, title: 'optik.html' }),
      );
    });

    it('derives what to show from the node\'s own properties', async () => {
      await curation.openNode(NODE);

      expect(agent.fake.parse).toHaveBeenCalledWith({ 'cclom:title': ['Vom Knoten'] });
    });
  });

  describe('resumeNode', () => {
    it('takes the node back up without writing anything to the history', async () => {
      await curation.resumeNode(NODE, 'chosen');

      expect(curation.activeNode()?.nodeId).toBe(NODE);
      expect(history.fake.add).not.toHaveBeenCalled();
    });

    it('puts the flow back with it where the history holds this content', async () => {
      history.fake.entries.set([anEntry({ quality: { criteriaMet: true, confirmed: false } })]);

      await curation.resumeNode(NODE, 'chosen');

      expect(curation.qualityCriteriaMet()).toBe(true);
    });

    it('brings a content the history does not hold back as a bare node', async () => {
      await curation.resumeNode(NODE, 'chosen');

      expect(agent.fake.reset).toHaveBeenCalled();
      expect(curation.hasCuratedResult()).toBe(false);
    });

    it('never asks for a node a guest session would be refused, where an entry stands in', async () => {
      asGuest();
      history.fake.entries.set([anEntry()]);

      await curation.resumeNode(NODE, 'detected');

      expect(repositoryNodes.get).not.toHaveBeenCalled();
      expect(curation.hasDetectedNode()).toBe(true);
    });

    it('stands the entry in where the node itself is out of reach', async () => {
      unreadable();
      history.fake.entries.set([anEntry({ title: 'Aus dem Verlauf' })]);

      await curation.resumeNode(NODE, 'chosen');

      expect(curation.activeNode()?.name).toBe('Aus dem Verlauf');
    });

    it('takes nothing up where neither the node nor an entry can be had', async () => {
      unreadable();

      await curation.resumeNode(NODE, 'chosen');

      expect(curation.activeNode()).toBeNull();
    });
  });

  describe('what taking a content up clears', () => {
    it('drops what the previous content had recorded and reached', async () => {
      curation.recordValues({ 'ccm:taxonid': ['380'] });
      curation.reportQualityCriteria(true);
      curation.reportQualityJudged();
      curation.reportMetadataEnriched();
      curation.reportMetadataProposed();

      await curation.openNode(NODE);

      expect(curation.qualityCriteriaMet()).toBe(false);
      expect(curation.qualityCriteriaJudged()).toBe(false);
      expect(curation.qualityMetadataEnriched()).toBe(false);
      expect(curation.qualityMetadataProposed()).toBe(false);
      expect(curation.qualityConfirmed()).toBe(false);
    });

    it('drops the previous content\'s judgement rather than letting the next inherit it', async () => {
      await curation.openNode(NODE);

      expect(qualityJudge.reset).toHaveBeenCalled();
    });
  });

  describe('releasing a content', () => {
    it('lets a content the user picked go once its steps are left', () => {
      curation.activeNode.set(anActiveNode(NODE));

      curation.releaseChosenContent();

      expect(curation.activeNode()).toBeNull();
    });

    it('keeps one that was found on the page — it describes the page that is still open', () => {
      curation.adoptDetectedNode(aNode());

      curation.releaseChosenContent();

      expect(curation.activeNode()).not.toBeNull();
    });

    it('lets a found content go once the page it described is left', () => {
      curation.adoptDetectedNode(aNode());

      curation.releaseDetectedContent();

      expect(curation.activeNode()).toBeNull();
    });

    it('never throws unsaved work away for a page change', async () => {
      agent.hasRead({ 'cclom:title': 'Optik' });
      await curation.analyze();
      curation.adoptDetectedNode(aNode());

      curation.releaseDetectedContent();

      expect(curation.hasUnsavedWork()).toBe(true);
    });
  });

  describe('analyze', () => {
    it('runs the agent where the WLO functions are on, and reads the page where they are not', async () => {
      agent.reads({ 'cclom:title': 'Optik' });

      await expect(curation.analyze()).resolves.toBe(true);
      expect(agent.fake.run).toHaveBeenCalled();
    });

    it('marks the run as unsaved work, and the Erschließung as under way', async () => {
      agent.reads({ 'cclom:title': 'Optik' });

      await curation.analyze();

      expect(curation.hasUnsavedWork()).toBe(true);
      expect(curation.curationUnfinished()).toBe(true);
    });

    it('has the content judged behind the run', async () => {
      agent.reads({ 'cclom:title': 'Optik' });

      await curation.analyze();

      expect(qualityJudge.start).toHaveBeenCalledWith({
        url: 'https://example.org/optik',
        nodeId: null,
      });
    });

    it('drops the content in hand before it starts', async () => {
      curation.activeNode.set(anActiveNode(OTHER));
      agent.reads({ 'cclom:title': 'Optik' });

      await curation.analyze();

      expect(curation.activeNode()).toBeNull();
    });

    it('reports a run that answered nothing, and judges nothing for it', async () => {
      agent.fails();

      await expect(curation.analyze()).resolves.toBe(false);
      expect(curation.hasUnsavedWork()).toBe(false);
      expect(qualityJudge.start).not.toHaveBeenCalled();
    });

    it('runs nothing at all while the panel is not authorized', async () => {
      auth.fake.authorized.set(false);

      await expect(curation.analyze()).resolves.toBe(false);
      expect(agent.fake.run).not.toHaveBeenCalled();
    });
  });

  describe('assignToCollections', () => {
    const physik = { id: 'c1', name: 'Physik' };
    const chemie = { id: 'c2', name: 'Chemie' };

    beforeEach(() => curation.activeNode.set(anActiveNode(NODE)));

    it('files the content into each collection, and records that it did', async () => {
      await curation.assignToCollections([physik, chemie]);

      expect(collections.addToCollection).toHaveBeenCalledWith(
        expect.objectContaining({ repository: HOME_REPOSITORY, collection: 'c1', node: NODE }),
      );
      expect(curation.assignedCollections()).toEqual([physik, chemie]);
      expect(curation.assignError()).toBeNull();
    });

    it('records a collection once, however often it is filed into', async () => {
      await curation.assignToCollections([physik]);
      await curation.assignToCollections([physik]);

      expect(curation.assignedCollections()).toEqual([physik]);
    });

    it('reports a collection that would not take the content', async () => {
      refusedCollections.add('c1');

      await curation.assignToCollections([physik]);

      expect(curation.assignError()).not.toBeNull();
    });

    it('files nothing without a content, without a collection, or unauthorized', async () => {
      curation.activeNode.set(null);
      await curation.assignToCollections([physik]);

      curation.activeNode.set(anActiveNode(NODE));
      await curation.assignToCollections([]);

      auth.fake.authorized.set(false);
      await curation.assignToCollections([physik]);

      expect(collections.addToCollection).not.toHaveBeenCalled();
    });

    it('says it is filing while it is', async () => {
      const pending = curation.assignToCollections([physik]);
      expect(curation.assigning()).toBe(true);
      await pending;
      expect(curation.assigning()).toBe(false);
    });
  });

  describe('confirmQuality', () => {
    beforeEach(() => curation.activeNode.set(anActiveNode(NODE)));

    it('confirms the quality where the write got through', async () => {
      await curation.confirmQuality();

      expect(curation.qualityConfirmed()).toBe(true);
      expect(curation.qualityError()).toBeNull();
    });

    it('leaves it unconfirmed and says why where the write was refused', async () => {
      asGuest();
      const write = TestBed.inject(NodeWriteService) as unknown as { write: Mock };
      write.write.mockResolvedValue({ ok: false, error: 'Speichern nicht möglich' });

      await curation.confirmQuality();

      expect(curation.qualityConfirmed()).toBe(false);
      expect(curation.qualityError()).toContain('Die Qualität konnte nicht bestätigt werden');
    });

    it('reports a closed editing window as what it is, not as a failed confirmation', async () => {
      asGuest();
      curation.previewNode.set(
        aNode({ createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString() } as Partial<Node>),
      );
      const write = TestBed.inject(NodeWriteService) as unknown as { write: Mock };
      write.write.mockResolvedValue({ ok: false, error: 'node too old' });

      await curation.confirmQuality();

      expect(curation.qualityError()).not.toContain('Die Qualität konnte nicht bestätigt werden');
    });
  });

  describe('applyDraftValues', () => {
    it('takes the preview step\'s values into the run, so the steps after it work on them', async () => {
      agent.hasRead({ 'cclom:title': 'Optik' });
      curation.reportDraftValues({ 'cclom:title': ['Vom Vorschau-Schritt'] });

      await curation.applyDraftValues();

      expect(agent.fake.parse).toHaveBeenCalledWith(
        expect.objectContaining({ 'cclom:title': ['Vom Vorschau-Schritt'] }),
      );
      expect(agent.fake.restore).toHaveBeenCalled();
    });

    it('takes them once, so a second pass does not re-apply what was already taken', async () => {
      agent.hasRead({ 'cclom:title': 'Optik' });
      curation.reportDraftValues({ 'cclom:title': ['Vom Vorschau-Schritt'] });

      await curation.applyDraftValues();
      agent.fake.restore.mockClear();
      await curation.applyDraftValues();

      expect(agent.fake.restore).not.toHaveBeenCalled();
    });

    it('takes the picture the open editor shows, even where no widget was touched', async () => {
      agent.hasRead({});
      curation.registerDraftPreviewSource(() => 'data:image/png;base64,AAAA');

      await curation.applyDraftValues();

      expect(curation.contentPreview()).toEqual({ url: 'data:image/png;base64,AAAA', isIcon: false });
    });

    it('reads the node\'s full picture rather than the widget\'s scaled rendering of it', async () => {
      agent.hasRead({ preview_image_url: 'https://example.org/optik.png' });
      curation.registerDraftPreviewSource(() => 'https://example.org/optik.png?width=100&crop=1');

      await curation.applyDraftValues();

      expect(curation.contentPreview()).toEqual({
        url: 'https://example.org/optik.png',
        isIcon: false,
      });
    });

    it('stops reading from a source the step took back', async () => {
      agent.hasRead({});
      const source = () => 'data:image/png;base64,AAAA';
      curation.registerDraftPreviewSource(source);
      curation.clearDraftPreviewSource(source);

      await curation.applyDraftValues();

      expect(curation.contentPreview()).toBeNull();
    });
  });
});
