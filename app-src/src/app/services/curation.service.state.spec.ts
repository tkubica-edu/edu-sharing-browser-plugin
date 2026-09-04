import { TestBed } from '@angular/core/testing';
import { CollectionServiceUnwrapped, Node } from 'ngx-edu-sharing-api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AuthFake,
  DevModeFake,
  MetadataAgentFake,
  WebComponentFake,
  aNode,
  anActiveNode,
  fakeAuth,
  fakeDevMode,
  fakeHistory,
  fakeMetadataAgent,
  fakeNostrForward,
  fakeWebComponent,
} from '../../testing/fakes';
import { provideFake } from '../../testing/provide-fake';
import { AuthService } from './auth.service';
import { BrowserExtensionCustomWebComponentService } from './browser-extension-custom-web-component.service';
import { Collection, CurationService } from './curation.service';
import { DevModeService } from './dev-mode.service';
import { HistoryService } from './history.service';
import { MetadataAgentService } from './metadata-agent.service';
import { NostrForwardService } from './nostr-forward.service';
import { QualityJudgeService } from './quality-judge.service';
import { RepositoryNodeService } from './repository-node.service';
import { SuggestionService } from './suggestion.service';
import { NodeWriteService } from './node-write.service';

const NODE = '2c4d6b1a-8f3e-4c2b-9a10-7d5e6f8b0c31';

/**
 * The state half of `CurationService`: the derived signals the whole panel reads it through, and the
 * setters the flow's steps write into it. The write path — `createContent`, `save`, `saveCollected`,
 * `assignToCollections` — is its own spec; nothing here sends a request.
 */
describe('CurationService — the state the panel reads', () => {
  let curation: CurationService;
  let auth: AuthFake;
  let agent: MetadataAgentFake;
  let devMode: DevModeFake;
  let webComponent: WebComponentFake;

  beforeEach(() => {
    auth = fakeAuth();
    agent = fakeMetadataAgent();
    devMode = fakeDevMode();
    webComponent = fakeWebComponent(true);
    TestBed.configureTestingModule({
      providers: [
        provideFake(AuthService, auth.fake),
        provideFake(MetadataAgentService, agent.fake),
        provideFake(DevModeService, devMode.fake),
        provideFake(BrowserExtensionCustomWebComponentService, webComponent.fake),
        provideFake(NostrForwardService, fakeNostrForward().fake),
        provideFake(HistoryService, fakeHistory().fake),
        provideFake(NodeWriteService, {} as never),
        provideFake(RepositoryNodeService, {} as never),
        provideFake(SuggestionService, {} as never),
        provideFake(QualityJudgeService, { running: vi.fn(() => false) } as never),
        provideFake(CollectionServiceUnwrapped, {} as never),
      ],
    });
    curation = TestBed.inject(CurationService);
  });

  /** A collection as the filing steps name one. */
  const collection = (id: string, name = id): Collection => ({ id, name });

  describe('the content in hand', () => {
    it('has none before anything was taken up', () => {
      expect(curation.activeNode()).toBeNull();
      expect(curation.hasDetectedNode()).toBe(false);
      expect(curation.hasEditableMetadata()).toBe(false);
      expect(curation.hasCuratedResult()).toBe(false);
    });

    it('has editable metadata for a run that answered, before any node exists', () => {
      agent.hasRead({ 'cclom:title': 'Optik' });

      expect(curation.hasCuratedResult()).toBe(true);
      expect(curation.hasEditableMetadata()).toBe(true);
      expect(curation.activeNode()).toBeNull();
    });

    it('has editable metadata for a node with no run behind it', () => {
      curation.activeNode.set(anActiveNode(NODE));

      expect(curation.hasCuratedResult()).toBe(false);
      expect(curation.hasEditableMetadata()).toBe(true);
    });

    it('reads a failed run as no content at all', () => {
      agent.fails();
      void agent.fake.run();

      expect(curation.hasCuratedResult()).toBe(false);
    });
  });

  describe('editorMetadata', () => {
    it('is the run\'s findings where nothing has been stored yet', () => {
      agent.hasRead({ 'cclom:title': 'Optik', 'cclom:general_keyword': ['Linsen'] });

      expect(curation.editorMetadata()).toMatchObject({
        'cclom:title': 'Optik',
        'cclom:general_keyword': ['Linsen'],
      });
    });

    it('lets what the node stores outrank a finding about the same property', () => {
      agent.hasRead({ 'cclom:title': 'Aus dem Lauf' });
      curation.nodeMetadata.set({ 'cclom:title': 'Vom Knoten' });

      expect(curation.editorMetadata()?.['cclom:title']).toBe('Vom Knoten');
    });

    it('keeps the findings the node does not carry, so the first save does not discard them', () => {
      agent.hasRead({ 'cclom:title': 'Optik', 'cclom:general_keyword': ['Linsen'] });
      curation.nodeMetadata.set({ 'cclom:title': 'Optik' });

      expect(curation.editorMetadata()?.['cclom:general_keyword']).toEqual(['Linsen']);
    });

    it('lets a value a step recorded outrank both', () => {
      agent.hasRead({ 'cclom:title': 'Aus dem Lauf' });
      curation.nodeMetadata.set({ 'cclom:title': 'Vom Knoten' });

      curation.recordValues({ 'cclom:title': ['Vom Schritt'] });

      // Unwrapped on the way out, as every canvas-scalar field is — see `withCanvasScalars`.
      expect(curation.editorMetadata()?.['cclom:title']).toBe('Vom Schritt');
    });

    it('reads the node\'s properties alone for a content this session did not erschließen', () => {
      curation.nodeMetadata.set({ 'cclom:title': 'Vom Knoten' });

      expect(curation.editorMetadata()).toMatchObject({ 'cclom:title': 'Vom Knoten' });
    });

    it('states every field\'s provenance, so a form knows what to offer for acceptance', () => {
      agent.hasRead({
        'cclom:title': 'Optik',
        'cclom:general_keyword': ['Linsen'],
        _origins: { 'cclom:title': 'ai', 'cclom:general_keyword': 'page' },
      });

      expect(curation.editorMetadata()?.['_origins']).toEqual({
        'cclom:title': 'ai',
        'cclom:general_keyword': 'page',
      });
    });

    it('states a recorded value as decided, whatever proposed it before', () => {
      agent.hasRead({ 'cclom:title': 'Optik', _origins: { 'cclom:title': 'ai' } });

      curation.recordValues({ 'cclom:title': ['Von Hand'] });

      expect((curation.editorMetadata()?.['_origins'] as Record<string, string>)['cclom:title']).toBe(
        'user',
      );
    });

    it('unwraps the fields a canvas can only read as a scalar', () => {
      curation.nodeMetadata.set({ 'cclom:title': ['Optik'], 'ccm:taxonid': ['380', '460'] });

      expect(curation.editorMetadata()?.['cclom:title']).toBe('Optik');
      expect(curation.editorMetadata()?.['ccm:taxonid']).toEqual(['380', '460']);
    });

    it('is nothing at all for a panel with no content in hand', () => {
      expect(curation.editorMetadata()).toBeNull();
    });

    it('merges what two steps recorded rather than letting the later overwrite the earlier', () => {
      curation.nodeMetadata.set({});

      curation.recordValues({ 'ccm:taxonid': ['380'] });
      curation.recordValues({ 'ccm:educationalcontext': ['schule'] });

      expect(curation.editorMetadata()).toMatchObject({
        'ccm:taxonid': ['380'],
        'ccm:educationalcontext': ['schule'],
      });
    });
  });

  describe('what the content is called and says', () => {
    it('takes the title its metadata carries', () => {
      agent.hasRead({ 'cclom:title': 'Optik' });

      expect(curation.contentTitle()).toBe('Optik');
    });

    it('falls back to the node\'s own title, then to its file name', () => {
      curation.previewNode.set(aNode({ title: 'Vom Knoten' } as Partial<Node>));
      expect(curation.contentTitle()).toBe('Vom Knoten');

      curation.previewNode.set(null);
      curation.activeNode.set(anActiveNode(NODE, 'optik.html'));
      expect(curation.contentTitle()).toBe('optik.html');
    });

    it('never names a content by its node id — an id is not a title', () => {
      curation.activeNode.set(anActiveNode(NODE));

      expect(curation.contentTitle()).toBeNull();
    });

    it('reads the keywords one per entry', () => {
      agent.hasRead({ 'cclom:general_keyword': ['Optik', 'Linsen'] });

      expect(curation.contentKeywords()).toEqual(['Optik', 'Linsen']);
    });

    it('reads the text the metadata was read from, and nothing for a content nobody read', () => {
      agent.hasRead({ _source_text: 'Der Artikel selbst.' });
      expect(curation.contentText()).toBe('Der Artikel selbst.');

      agent.fake.reset();
      expect(curation.contentText()).toBe('');
    });
  });

  describe('contentPreview', () => {
    it('ranks the node\'s own picture above the run\'s', () => {
      agent.hasRead({ preview_image_url: 'https://example.org/aus-dem-lauf.png' });
      curation.previewNode.set(
        aNode({ preview: { url: 'https://example.org/vom-knoten.png' } } as Partial<Node>),
      );

      expect(curation.contentPreview()).toEqual({
        url: 'https://example.org/vom-knoten.png',
        isIcon: false,
      });
    });

    it('takes the run\'s picture where the node states none', () => {
      agent.hasRead({ preview_image_url: 'https://example.org/aus-dem-lauf.png' });

      expect(curation.contentPreview()).toEqual({
        url: 'https://example.org/aus-dem-lauf.png',
        isIcon: false,
      });
    });

    it('falls back to the page screenshot before the node\'s type icon', () => {
      agent.hasRead({}, { url: 'https://example.org/optik', title: 'Optik', screenshot: 'data:x' });
      curation.previewNode.set(
        aNode({ preview: { url: 'https://example.org/icon.svg', isIcon: true } } as Partial<Node>),
      );

      expect(curation.contentPreview()).toEqual({ url: 'data:x', isIcon: false });
    });

    it('reports the type icon as one, since it is true of the kind and not of this content', () => {
      curation.previewNode.set(
        aNode({ preview: { url: 'https://example.org/icon.svg', isIcon: true } } as Partial<Node>),
      );

      expect(curation.contentPreview()).toEqual({ url: 'https://example.org/icon.svg', isIcon: true });
    });

    it('reports nothing for a content nothing states a picture of', () => {
      expect(curation.contentPreview()).toBeNull();
    });
  });

  describe('the filing the steps pick', () => {
    it('files into the folder each forwarding names, else into the group itself', () => {
      curation.setEditorialTargets([
        { group: collection('g1', 'Redaktion A'), folder: collection('f1', 'Physik') },
        { group: collection('g2', 'Redaktion B') },
      ]);

      expect(curation.editorialCollections()).toEqual([
        collection('f1', 'Physik'),
        collection('g2', 'Redaktion B'),
      ]);
    });

    it('files a content into a collection once, however many steps reached it', () => {
      curation.setEditorialTargets([{ group: collection('c1') }]);
      curation.setPersonalCollections([collection('c1'), collection('c2')]);

      expect(curation.filedCollections()).toEqual([collection('c1'), collection('c2')]);
    });

    it('counts the dev mode\'s collection as one the content is filed in', () => {
      devMode.fake.fakedCollectionId.set('test-1');

      expect(curation.filedCollections()).toEqual([{ id: 'test-1', name: 'Test-Sammlung test-1' }]);
    });
  });

  describe('contentForwardings', () => {
    it('holds a picked forwarding apart from one a save already recorded', () => {
      curation.setEditorialTargets([{ group: collection('g1') }]);

      expect(curation.editorialTargets()).toHaveLength(1);
      expect(curation.savedForwardings()).toHaveLength(0);
    });

    it('names every team the content stands proposed to, each one once', () => {
      curation.setEditorialTargets([{ group: collection('g2'), folder: collection('f2') }]);

      expect(curation.contentForwardings().map((target) => target.group.id)).toEqual(['g2']);
    });
  });

  describe('the route a save takes', () => {
    it('goes through the agent for a session that is not the user\'s own', () => {
      expect(curation.savesThroughAgent()).toBe(true);
    });

    it('writes the node itself once somebody is signed in', () => {
      auth.signIn();

      expect(curation.savesThroughAgent()).toBe(false);
    });

    it('writes it itself where the repository offers no web component either', () => {
      webComponent.fake.offeredByRepository.set(false);

      expect(curation.savesThroughAgent()).toBe(false);
    });
  });

  describe('agentEditWindowClosed', () => {
    it('is open for a content this session may still write', () => {
      curation.previewNode.set(aNode({ createdAt: new Date().toISOString() } as Partial<Node>));

      expect(curation.agentEditWindowClosed()).toBe(false);
    });

    it('is closed for one the agent\'s route stopped taking', () => {
      const longAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
      curation.previewNode.set(aNode({ createdAt: longAgo } as Partial<Node>));

      expect(curation.agentEditWindowClosed()).toBe(true);
    });

    it('is never closed for a session that writes the node itself', () => {
      auth.signIn();
      const longAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
      curation.previewNode.set(aNode({ createdAt: longAgo } as Partial<Node>));

      expect(curation.agentEditWindowClosed()).toBe(false);
    });

    it('is open for a node whose creation date is unknown — the repository then says so instead', () => {
      curation.previewNode.set(aNode());

      expect(curation.agentEditWindowClosed()).toBe(false);
    });
  });

  describe('subjectNodeId', () => {
    it('is the node the run wrote', () => {
      curation.activeNode.set(anActiveNode(NODE));

      expect(curation.subjectNodeId()).toBe(NODE);
    });

    it('is the dev mode\'s node while it writes nothing, so a check has a subject at all', () => {
      devMode.standsInForNode('test-node');

      expect(curation.subjectNodeId()).toBe('test-node');
    });

    it('is nothing where there is neither', () => {
      expect(curation.subjectNodeId()).toBeNull();
    });
  });

  describe('the marks the steps leave', () => {
    it('remembers which checking process the junction marked', () => {
      expect(curation.checkProcess()).toBeNull();

      curation.setCheckProcess('ai-quality');

      expect(curation.checkProcess()).toBe('ai-quality');
    });

    it('records the quality criteria being answered, and the steps that follow', () => {
      expect(curation.qualityCriteriaMet()).toBe(false);

      curation.reportQualityCriteria(true);
      curation.reportQualityJudged();
      curation.reportMetadataEnriched();
      curation.reportMetadataProposed();

      expect(curation.qualityCriteriaMet()).toBe(true);
      expect(curation.qualityCriteriaJudged()).toBe(true);
      expect(curation.qualityMetadataEnriched()).toBe(true);
      expect(curation.qualityMetadataProposed()).toBe(true);
    });

    it('takes the criteria back where a later answer says they are no longer met', () => {
      curation.reportQualityCriteria(true);
      curation.reportQualityCriteria(false);

      expect(curation.qualityCriteriaMet()).toBe(false);
    });

    it('takes the source page over once, so re-entering the step does not run the agent again', () => {
      curation.extractionUrl.set('https://example.org/optik');

      expect(curation.takeExtractionUrl()).toBe('https://example.org/optik');
      expect(curation.takeExtractionUrl()).toBe('');
      expect(curation.extractionUrl()).toBeNull();
    });
  });

  describe('the nodes the editors are built on', () => {
    it('builds a stand-in for a content with no node yet', () => {
      agent.hasRead({ 'cclom:title': 'Optik' });

      const draft = curation.draftNode();

      expect(draft?.ref.id).toBe('-draft-');
      expect(draft?.name).toBe('Optik');
      expect(draft?.properties?.['cclom:title']).toEqual(['Optik']);
    });

    it('builds none without a run behind it', () => {
      expect(curation.draftNode()).toBeNull();
    });

    it('gives the stand-in the picture the content states', () => {
      agent.hasRead({ preview_image_url: 'https://example.org/optik.png' });

      expect(curation.draftNode()?.preview).toMatchObject({ url: 'https://example.org/optik.png?' });
    });

    it('gives it no picture where all that is known is a type icon', () => {
      agent.hasRead({});
      curation.previewNode.set(
        aNode({ preview: { url: 'https://example.org/icon.svg', isIcon: true } } as Partial<Node>),
      );

      expect(curation.editorNode()?.ref.id).toBe(NODE);
    });

    it('works the editor on the content\'s own node once it has one', () => {
      agent.hasRead({ 'cclom:general_keyword': ['Linsen'] });
      curation.previewNode.set(aNode({ properties: { 'cclom:title': ['Optik'] } } as Partial<Node>));

      const node = curation.editorNode();

      expect(node?.ref.id).toBe(NODE);
      expect(node?.properties?.['cclom:title']).toEqual(['Optik']);
      expect(node?.properties?.['cclom:general_keyword']).toEqual(['Linsen']);
    });

    it('falls back to the stand-in where the content has no node', () => {
      agent.hasRead({ 'cclom:title': 'Optik' });

      expect(curation.editorNode()?.ref.id).toBe('-draft-');
    });
  });

  describe('hasCollectedValues', () => {
    it('says there is something to do while no node exists', () => {
      expect(curation.hasCollectedValues()).toBe(true);
    });

    it('says there is nothing for a node with nothing recorded and nothing to file', () => {
      curation.activeNode.set(anActiveNode(NODE));

      expect(curation.hasCollectedValues()).toBe(false);
    });

    it('says there is once a step recorded a property', () => {
      curation.activeNode.set(anActiveNode(NODE));

      curation.recordValues({ 'ccm:taxonid': ['380'] });

      expect(curation.hasCollectedValues()).toBe(true);
    });

    it('says there is once a filing step picked a collection the content is not in', () => {
      curation.activeNode.set(anActiveNode(NODE));

      curation.setPersonalCollections([collection('c1')]);

      expect(curation.hasCollectedValues()).toBe(true);
    });
  });

  describe('metadataLocked', () => {
    it('holds the editor while a save is in flight, so the values cannot diverge from it', () => {
      expect(curation.metadataLocked()).toBe(false);

      curation.saving.set(true);

      expect(curation.metadataLocked()).toBe(true);
    });
  });
});
