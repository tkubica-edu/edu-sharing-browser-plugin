import { TestBed } from '@angular/core/testing';
import { Connector, Node } from 'ngx-edu-sharing-api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AuthFake,
  BrowserExtensionFake,
  CurationFake,
  DebugFake,
  NavigationFake,
  SessionResumeFake,
  aNode,
  anActiveNode,
  fakeAuth,
  fakeBrowserExtension,
  fakeCuration,
  fakeDebug,
  fakeNavigation,
  fakeNostrForward,
  fakeSessionResume,
  fakeWebComponent,
} from '../../testing/fakes';
import { provideFake } from '../../testing/provide-fake';
import { AuthService } from './auth.service';
import { BrowserExtensionCustomWebComponentService } from './browser-extension-custom-web-component.service';
import { BrowserExtensionService } from './browser-extension.service';
import { ConditionsService } from './conditions.service';
import { ContentFlowService } from './content-flow.service';
import { CurationService } from './curation.service';
import { DebugService } from './debug.service';
import { NavigationService } from './navigation.service';
import { NodeConnectorService } from './node-connector.service';
import { NostrForwardService } from './nostr-forward.service';
import { OnlyOfficeDocumentService } from './onlyoffice-document.service';
import { SessionResumeService } from './session-resume.service';

describe('ContentFlowService', () => {
  let flow: ContentFlowService;
  let navigation: NavigationFake;
  let curation: CurationFake;
  let extension: BrowserExtensionFake;
  let resume: SessionResumeFake;
  let auth: AuthFake;
  let debug: DebugFake;
  let conditions: ConditionsService;

  /** The document the OnlyOffice plugin reports as open, or null while it reports none. */
  let openDocument: ReturnType<typeof import('@angular/core').signal<{ nodeId?: string } | null>>;

  /** The connector the repository offers for the node, or null where it opens in none. */
  let connector: Connector | null;

  const nodeConnector = {
    connectorFor: vi.fn((_node: Node): Promise<Connector | null> => Promise.resolve(connector)),
    getConnectorUrl: vi.fn(
      (node: Node, offered: Connector) =>
        `https://repo.example/edu-sharing/eduservlet/connector?connectorId=${offered.id}&nodeId=${node.ref.id}`,
    ),
  };

  beforeEach(async () => {
    const { signal } = await import('@angular/core');
    connector = null;
    nodeConnector.connectorFor.mockClear();
    nodeConnector.getConnectorUrl.mockClear();
    openDocument = signal<{ nodeId?: string } | null>(null);
    navigation = fakeNavigation();
    curation = fakeCuration();
    extension = fakeBrowserExtension();
    resume = fakeSessionResume();
    auth = fakeAuth();
    debug = fakeDebug();
    TestBed.configureTestingModule({
      providers: [
        provideFake(CurationService, curation.fake),
        provideFake(NavigationService, navigation.fake),
        provideFake(NodeConnectorService, nodeConnector as never),
        provideFake(BrowserExtensionService, extension.fake),
        provideFake(SessionResumeService, resume.fake),
        provideFake(OnlyOfficeDocumentService, { currentDocument: openDocument } as never),
        provideFake(AuthService, auth.fake),
        provideFake(DebugService, debug.fake),
        provideFake(BrowserExtensionCustomWebComponentService, fakeWebComponent().fake),
        provideFake(NostrForwardService, fakeNostrForward().fake),
      ],
    });
    flow = TestBed.inject(ContentFlowService);
    conditions = TestBed.inject(ConditionsService);
  });

  /** The content in hand, as a node that is loaded and one the panel can name a page for. */
  function inHand(nodeId = 'node-1', node: Partial<Node> = {}): void {
    curation.fake.activeNode.set(anActiveNode(nodeId));
    curation.hydrated(aNode({ ref: { id: nodeId, repo: 'local' }, ...node } as never));
  }

  /** The repository opens this content in a connector — the branch that leads to the editing mode. */
  function opensInConnector(id = 'ONLYOFFICE'): void {
    connector = { id } as Connector;
  }

  describe('entering the editing mode', () => {
    it('goes to the Qualitätsprüfung for a result that is not a node yet', async () => {
      curation.fake.activeNode.set(anActiveNode());

      await flow.edit();

      expect(navigation.fake.go).toHaveBeenCalledWith('quality');
      expect(nodeConnector.connectorFor).not.toHaveBeenCalled();
    });

    it('goes there too for a node that opens in no connector', async () => {
      inHand();

      await flow.edit();

      expect(nodeConnector.connectorFor).toHaveBeenCalled();
      expect(navigation.fake.go).toHaveBeenCalledWith('quality');
      expect(extension.fake.navigateTab).not.toHaveBeenCalled();
    });

    it('opens the content in its connector, and switches the panel first', async () => {
      inHand('node-7');
      opensInConnector();
      conditions.activeUrl.set('https://example.org/irgendwo');

      await flow.edit();

      expect(navigation.fake.go).toHaveBeenCalledWith('editing');
      expect(extension.fake.navigateTab).toHaveBeenCalledWith(
        'https://repo.example/edu-sharing/eduservlet/connector?connectorId=ONLYOFFICE&nodeId=node-7',
      );
    });

    it('falls back to the node own page where the connector names no address', async () => {
      inHand('node-7');
      opensInConnector();
      nodeConnector.getConnectorUrl.mockReturnValueOnce('');
      conditions.activeUrl.set('https://example.org/irgendwo');

      await flow.edit();

      expect(extension.fake.navigateTab).toHaveBeenCalledWith(
        'https://repo.example/components/render/node-7',
      );
    });

    it('says it is deciding while the connector is being asked for', async () => {
      inHand();
      let deciding: boolean | null = null;
      nodeConnector.connectorFor.mockImplementationOnce(() => {
        deciding = flow.deciding();
        return Promise.resolve(null);
      });

      await flow.edit();

      expect(deciding).toBe(true);
      expect(flow.deciding()).toBe(false);
    });

    it('stops saying so even where the page could not be opened', async () => {
      inHand();
      opensInConnector();
      conditions.activeUrl.set('https://example.org/irgendwo');
      extension.fake.navigateTab.mockRejectedValue(new Error('WORKER_UNREACHABLE'));

      await expect(flow.edit()).rejects.toThrow('WORKER_UNREACHABLE');

      expect(flow.deciding()).toBe(false);
    });

    it('never decides at all for a result without a node', async () => {
      await flow.edit();

      expect(flow.deciding()).toBe(false);
      expect(navigation.fake.go).toHaveBeenCalledWith('quality');
    });
  });

  describe('taking the tab to where the content is edited', () => {
    beforeEach(() => {
      inHand('node-7');
      opensInConnector();
      conditions.activeUrl.set('https://example.org/irgendwo');
    });

    it('saves what the panel is doing before the load tears it down', async () => {
      const order: string[] = [];
      resume.fake.save.mockImplementation(() => {
        order.push('save');
        return Promise.resolve();
      });
      extension.fake.navigateTab.mockImplementation(() => {
        order.push('navigate');
        return Promise.resolve();
      });

      await flow.edit();

      expect(order).toEqual(['save', 'navigate']);
    });

    it('saves the page it is about to open as the page the panel belongs to', async () => {
      await flow.edit();

      expect(resume.fake.save).toHaveBeenCalledWith(
        'https://repo.example/edu-sharing/eduservlet/connector?connectorId=ONLYOFFICE&nodeId=node-7',
      );
    });

    it('takes the state tracking back up where the load never happened', async () => {
      const cause = new Error('WORKER_UNREACHABLE');
      extension.fake.navigateTab.mockRejectedValue(cause);

      await expect(flow.edit()).rejects.toBe(cause);

      expect(resume.fake.track).toHaveBeenCalled();
    });

    it('leaves the tracking off where the load is on its way', async () => {
      await flow.edit();

      expect(resume.fake.track).not.toHaveBeenCalled();
    });

    it('does nothing where the content has no node to open', async () => {
      curation.fake.activeNode.set(null);

      await flow.edit();

      expect(navigation.fake.go).toHaveBeenCalledWith('editing');
      expect(resume.fake.save).not.toHaveBeenCalled();
      expect(extension.fake.navigateTab).not.toHaveBeenCalled();
    });

    it('stays on the page that is already showing the content', async () => {
      conditions.activeUrl.set(
        'https://repo.example/edu-sharing/eduservlet/connector?connectorId=ONLYOFFICE&nodeId=node-7',
      );

      await flow.edit();

      expect(navigation.fake.go).toHaveBeenCalledWith('editing');
      expect(extension.fake.navigateTab).not.toHaveBeenCalled();
      expect(resume.fake.save).not.toHaveBeenCalled();
    });
  });

  describe('with an OnlyOffice editor already on screen', () => {
    beforeEach(() => {
      inHand('node-7');
      opensInConnector();
      // An insert host by its path, which is what marks the editor — see ConditionsService.
      conditions.activeUrl.set('https://office.example/src/tools/onlyoffice/editor.html?doc=7');
    });

    it('only switches the panel where the open document is this content', async () => {
      openDocument.set({ nodeId: 'node-7' });

      await flow.edit();

      expect(navigation.fake.go).toHaveBeenCalledWith('editing');
      expect(extension.fake.navigateTab).not.toHaveBeenCalled();
    });

    it('does the same where the editor does not say which document it has', async () => {
      openDocument.set(null);

      await flow.edit();

      expect(extension.fake.navigateTab).not.toHaveBeenCalled();
    });

    it('and where it reports a document without an id', async () => {
      openDocument.set({});

      await flow.edit();

      expect(extension.fake.navigateTab).not.toHaveBeenCalled();
    });

    it('replaces the page where another content is open in it', async () => {
      openDocument.set({ nodeId: 'ein-anderer' });

      await flow.edit();

      expect(extension.fake.navigateTab).toHaveBeenCalledWith(
        'https://repo.example/edu-sharing/eduservlet/connector?connectorId=ONLYOFFICE&nodeId=node-7',
      );
    });
  });

  describe('the steps that are entered in the panel', () => {
    /** Each step, and the section — and where there is one, the tab — it goes to. */
    const steps: readonly [string, () => void, string, { tab: string } | undefined][] = [
      ['Inhaltsoptionen', () => flow.showContentOptions(), 'content-options', undefined],
      ['die Vorschau der Erschließung', () => flow.showCurationPreview(), 'curation-preview', undefined],
      ['die Qualitätsprüfung', () => flow.showQuality(), 'quality', { tab: 'quality-check' }],
      ['die Metadaten', () => flow.showMetadata(), 'quality', { tab: 'metadata' }],
      ['die Weiterleitung an Redaktionen', () => flow.showEditorialForward(), 'editorial-forward', undefined],
      ['die persönliche Ablage', () => flow.showPersonalStorage(), 'personal-storage', undefined],
      ['die Inhaltsübersicht', () => flow.showOverview(), 'overview', { tab: 'preview' }],
      ['die Nutzung', () => flow.showUsages(), 'overview', { tab: 'usages' }],
      ['die Freigabe', () => flow.showShare(), 'overview', { tab: 'share' }],
      ['die Interaktionen', () => flow.showInteractions(), 'overview', { tab: 'interactions' }],
      ['das Nostr-Relay', () => flow.showNostrForward(), 'nostr-forward', undefined],
    ];

    for (const [name, enter, section, options] of steps) {
      it(`enters ${name} without touching the page that is open`, () => {
        enter();

        if (options) expect(navigation.fake.go).toHaveBeenCalledWith(section, options);
        else expect(navigation.fake.go).toHaveBeenCalledWith(section);
        expect(extension.fake.navigateTab).not.toHaveBeenCalled();
        expect(resume.fake.save).not.toHaveBeenCalled();
      });
    }
  });
});
