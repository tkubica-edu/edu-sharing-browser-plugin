import { TestBed } from '@angular/core/testing';
import { ClientutilsV1Service, Node } from 'ngx-edu-sharing-api';
import { Subject } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';

import { AuthService } from './auth.service';
import { BrowserExtensionCustomWebComponentService } from './browser-extension-custom-web-component.service';
import { ConditionsService } from './conditions.service';
import { CurationService } from './curation.service';
import { DebugService } from './debug.service';
import { DevModeService } from './dev-mode.service';
import { HistoryEntry, HistoryService } from './history.service';
import { NostrForwardService } from './nostr-forward.service';
import { PageRecognitionService } from './page-recognition.service';
import { provideFake } from '../../testing/provide-fake';
import {
  AuthFake,
  ClientUtilsFake,
  CurationFake,
  DebugFake,
  DevModeFake,
  FAKE_REPOSITORY_URL,
  HistoryFake,
  aHistoryEntry,
  fakeAuth,
  fakeClientUtils,
  fakeCuration,
  fakeDebug,
  fakeDevMode,
  fakeHistory,
  fakeNostrForward,
  fakeWebComponent,
} from '../../testing/fakes';

/** A node id in the shape the repository writes into its URLs. */
const NODE_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

/** A node as the duplicate list of `getWebsiteInformation` carries it: a ref, no properties. */
function aDuplicate(nodeId = NODE_ID): Node {
  return { ref: { id: nodeId } } as Node;
}

describe('PageRecognitionService', () => {
  let recognition: PageRecognitionService;
  let conditions: ConditionsService;
  let auth: AuthFake;
  let curation: CurationFake;
  let devMode: DevModeFake;
  let debug: DebugFake;
  let history: HistoryFake;
  let clientUtils: ClientUtilsFake;

  /**
   * The real `ConditionsService` is used rather than a fake of it: its own four dependencies are faked
   * already, so what it computes about the open page is the real predicate — which is most of what
   * `recognize()` branches on.
   */
  beforeEach(() => {
    auth = fakeAuth();
    curation = fakeCuration();
    devMode = fakeDevMode();
    debug = fakeDebug();
    history = fakeHistory();
    clientUtils = fakeClientUtils();
    TestBed.configureTestingModule({
      providers: [
        provideFake(AuthService, auth.fake),
        provideFake(CurationService, curation.fake),
        provideFake(DevModeService, devMode.fake),
        provideFake(DebugService, debug.fake),
        provideFake(HistoryService, history.fake),
        provideFake(ClientutilsV1Service, clientUtils.fake),
        provideFake(BrowserExtensionCustomWebComponentService, fakeWebComponent().fake),
        // Reached through the real ConditionsService, which asks it whether the panel speaks to a relay.
        provideFake(NostrForwardService, fakeNostrForward().fake),
      ],
    });
    conditions = TestBed.inject(ConditionsService);
    recognition = TestBed.inject(PageRecognitionService);
    auth.signIn();
  });

  /** Put the panel on `url` as the page it is recognising. */
  function onPage(url: string): void {
    conditions.activeUrl.set(url);
  }

  /** What the panel erschlossen before, as the history holds it. */
  function remembered(...entries: HistoryEntry[]): void {
    history.fake.entries.set(entries);
  }

  describe('the questions it answers without asking anything', () => {
    it('leaves the question open while there is nothing to ask under', async () => {
      auth.fake.authorized.set(false);
      onPage('https://example.org/article');

      expect(await recognition.recognize()).toBe(false);
      expect(clientUtils.fake.getWebsiteInformation).not.toHaveBeenCalled();
      // Not answered with "no content": the login runs this again, so the flag stays as it was.
      expect(conditions.recognizingContent()).toBe(true);
    });

    it('says nothing on an insert host, where the plugin speaks for the page', async () => {
      onPage('https://office.example/eduservlet/connector?id=7');

      expect(await recognition.recognize()).toBe(false);
      expect(clientUtils.fake.getWebsiteInformation).not.toHaveBeenCalled();
      expect(conditions.recognizingContent()).toBe(true);
    });

    it('stops while the panel already works on a content, and stops checking', async () => {
      curation.detect('node-in-hand');
      onPage('https://example.org/article');

      expect(await recognition.recognize()).toBe(false);
      expect(clientUtils.fake.getWebsiteInformation).not.toHaveBeenCalled();
      // Cleared, or the panel would report it is still looking for ever.
      expect(conditions.recognizingContent()).toBe(false);
    });

    it('stops for unsaved work just as for an active node', async () => {
      curation.fake.hasUnsavedWork.set(true);
      onPage('https://example.org/article');

      expect(await recognition.recognize()).toBe(false);
      expect(clientUtils.fake.getWebsiteInformation).not.toHaveBeenCalled();
      expect(conditions.recognizingContent()).toBe(false);
    });
  });

  describe('a repository page that names its node', () => {
    it('adopts the node the URL names, without any lookup', async () => {
      onPage(`${FAKE_REPOSITORY_URL}/components/render/${NODE_ID}`);

      expect(await recognition.recognize()).toBe(true);
      expect(curation.fake.adoptDetectedNodeId).toHaveBeenCalledWith(NODE_ID);
      expect(clientUtils.fake.getWebsiteInformation).not.toHaveBeenCalled();
    });

    it('reads the node out of the `id` parameter of a collection or folder view', async () => {
      onPage(`${FAKE_REPOSITORY_URL}/components/collections?id=${NODE_ID}`);

      expect(await recognition.recognize()).toBe(true);
      expect(curation.fake.adoptDetectedNodeId).toHaveBeenCalledWith(NODE_ID);
    });

    it('answers with whatever the adoption answered — a node it may not read is not adopted', async () => {
      curation.fake.adoptDetectedNodeId.mockResolvedValue(false);
      onPage(`${FAKE_REPOSITORY_URL}/components/render/${NODE_ID}`);

      expect(await recognition.recognize()).toBe(false);
    });

    it('never mistakes a node id outside `/components/` for the repository showing it', async () => {
      onPage(`https://example.org/wiki/${NODE_ID}`);

      expect(await recognition.recognize()).toBe(false);
      expect(curation.fake.adoptDetectedNodeId).not.toHaveBeenCalled();
      // A page like any other, so the lookup is what decides it.
      expect(clientUtils.fake.getWebsiteInformation).toHaveBeenCalled();
    });

    it('has nothing to look up for a repository page that shows no single content', async () => {
      onPage(`${FAKE_REPOSITORY_URL}/components/search?query=optik`);

      expect(await recognition.recognize()).toBe(false);
      expect(curation.fake.adoptDetectedNodeId).not.toHaveBeenCalled();
      expect(clientUtils.fake.getWebsiteInformation).not.toHaveBeenCalled();
    });
  });

  it('has nothing to ask the repository about a page that is not on the web', async () => {
    onPage('chrome://extensions');

    expect(await recognition.recognize()).toBe(false);
    expect(clientUtils.fake.getWebsiteInformation).not.toHaveBeenCalled();
  });

  it('lets no page count as erschlossen while the answers are faked', async () => {
    remembered(aHistoryEntry({ url: 'https://example.org/article' }));
    devMode.fake.enabled.set(true);
    onPage('https://example.org/article');

    expect(await recognition.recognize()).toBe(false);
    // Neither the history nor the repository decides it, so *Inhalt erschließen* stays offered for a
    // page a test run already put into the repository.
    expect(curation.fake.adoptRememberedNode).not.toHaveBeenCalled();
    expect(clientUtils.fake.getWebsiteInformation).not.toHaveBeenCalled();
  });

  describe('what this panel erschlossen itself', () => {
    it('takes the node from the history before the repository is asked', async () => {
      const entry = aHistoryEntry({ url: 'https://example.org/article', nodeId: 'node-remembered' });
      remembered(entry);
      onPage('https://example.org/article');

      expect(await recognition.recognize()).toBe(true);
      expect(curation.fake.adoptRememberedNode).toHaveBeenCalledWith(entry);
      expect(clientUtils.fake.getWebsiteInformation).not.toHaveBeenCalled();
    });

    it('matches on the address alone — a fragment and a trailing slash tell no pages apart', async () => {
      remembered(aHistoryEntry({ url: 'https://example.org/article/' }));
      onPage('https://example.org/article#chapter-2');

      expect(await recognition.recognize()).toBe(true);
      expect(curation.fake.adoptRememberedNode).toHaveBeenCalled();
    });

    it('falls through to the repository when the remembered node is not taken up', async () => {
      remembered(aHistoryEntry({ url: 'https://example.org/article' }));
      curation.fake.adoptRememberedNode.mockResolvedValue(false);
      clientUtils.answers({ duplicateNodes: [aDuplicate()] });
      onPage('https://example.org/article');

      expect(await recognition.recognize()).toBe(true);
      expect(clientUtils.fake.getWebsiteInformation).toHaveBeenCalled();
      expect(curation.fake.adoptDetectedNode).toHaveBeenCalled();
    });

    it('asks the repository for a page no entry holds', async () => {
      remembered(aHistoryEntry({ url: 'https://example.org/something-else' }));
      onPage('https://example.org/article');

      await recognition.recognize();

      expect(curation.fake.adoptRememberedNode).not.toHaveBeenCalled();
      expect(clientUtils.fake.getWebsiteInformation).toHaveBeenCalledWith({
        url: 'https://example.org/article',
      });
    });
  });

  describe('what the repository holds for the page', () => {
    it('adopts the first duplicate — they are versions of the same finding', async () => {
      const first = aDuplicate('node-first');
      clientUtils.answers({ duplicateNodes: [first, aDuplicate('node-second')] });
      onPage('https://example.org/article');

      expect(await recognition.recognize()).toBe(true);
      expect(curation.fake.adoptDetectedNode).toHaveBeenCalledWith(first);
    });

    it('reports no content for a page the repository does not hold', async () => {
      clientUtils.answers({});
      onPage('https://example.org/article');

      expect(await recognition.recognize()).toBe(false);
      expect(curation.fake.adoptDetectedNode).not.toHaveBeenCalled();
    });

    it('reports no content for an empty duplicate list', async () => {
      clientUtils.answers({ duplicateNodes: [] });
      onPage('https://example.org/article');

      expect(await recognition.recognize()).toBe(false);
    });

    it('stays silent about a failed lookup, and stops checking either way', async () => {
      clientUtils.fails(new Error('502 Bad Gateway'));
      onPage('https://example.org/article');

      expect(await recognition.recognize()).toBe(false);
      expect(conditions.recognizingContent()).toBe(false);
    });

    it('reports being under way for as long as the lookup is', async () => {
      const answer = new Subject<{ duplicateNodes?: Node[] }>();
      clientUtils.fake.getWebsiteInformation.mockReturnValue(answer);
      conditions.recognizingContent.set(false);
      onPage('https://example.org/article');

      const recognized = recognition.recognize();
      expect(conditions.recognizingContent()).toBe(true);

      answer.next({ duplicateNodes: [aDuplicate()] });
      answer.complete();
      await recognized;

      expect(conditions.recognizingContent()).toBe(false);
    });
  });

  describe('recognizeIfStale', () => {
    it('costs nothing while the last answer still describes the page', async () => {
      onPage('https://example.org/article');

      expect(await recognition.recognizeIfStale()).toBe(false);
      expect(clientUtils.fake.getWebsiteInformation).not.toHaveBeenCalled();
    });

    it('recognises again once something invalidated the answer', async () => {
      clientUtils.answers({ duplicateNodes: [aDuplicate()] });
      onPage('https://example.org/article');

      recognition.invalidate();

      expect(await recognition.recognizeIfStale()).toBe(true);
      expect(clientUtils.fake.getWebsiteInformation).toHaveBeenCalledTimes(1);
    });

    it('consumes the invalidation, so a second call asks nothing', async () => {
      clientUtils.answers({ duplicateNodes: [aDuplicate()] });
      onPage('https://example.org/article');
      recognition.invalidate();
      await recognition.recognizeIfStale();

      expect(await recognition.recognizeIfStale()).toBe(false);
      expect(clientUtils.fake.getWebsiteInformation).toHaveBeenCalledTimes(1);
    });
  });

  describe('switching the dev mode on', () => {
    it('lets go of a content that was recognised before the mode was switched on', () => {
      curation.detect();
      TestBed.tick();
      expect(curation.fake.releaseDetectedContent).not.toHaveBeenCalled();

      devMode.fake.enabled.set(true);
      TestBed.tick();

      expect(curation.fake.releaseDetectedContent).toHaveBeenCalled();
    });

    it('holds on to a content the user picked themselves', () => {
      curation.fake.activeNode.set({ nodeId: 'chosen', name: null, link: 'https://repo/x' });
      devMode.fake.enabled.set(true);
      TestBed.tick();

      // Only a content that arrived on its own is let go of.
      expect(curation.fake.releaseDetectedContent).not.toHaveBeenCalled();
    });

    it('leaves the announced document alone on an insert host', () => {
      curation.detect();
      onPage('https://office.example/eduservlet/connector?id=7');
      devMode.fake.enabled.set(true);
      TestBed.tick();

      expect(curation.fake.releaseDetectedContent).not.toHaveBeenCalled();
    });

    it('does nothing while the mode is off', () => {
      curation.detect();
      TestBed.tick();

      expect(curation.fake.releaseDetectedContent).not.toHaveBeenCalled();
    });
  });
});
