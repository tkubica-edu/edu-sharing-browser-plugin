import { TestBed } from '@angular/core/testing';
import { Node } from 'ngx-edu-sharing-api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DocumentContent, DocumentRequestKind, PluginEnvelope } from '../model/onlyoffice-events';
import {
  AuthFake,
  BrowserExtensionFake,
  DebugFake,
  FAKE_REPOSITORY_URL,
  aNode,
  fakeAuth,
  fakeBrowserExtension,
  fakeDebug,
} from '../../testing/fakes';
import { provideFake } from '../../testing/provide-fake';
import { AuthService } from './auth.service';
import { BrowserExtensionService } from './browser-extension.service';
import { DebugService } from './debug.service';
import { OnlyOfficeDocumentService } from './onlyoffice-document.service';
import { RepositoryNodeService } from './repository-node.service';

/** The wordings a caller shows the user, restated here so a change to one is a change to a test. */
const NO_HOST = 'Die Seite konnte nicht erreicht werden — bitte das Panel auf der OnlyOffice-Seite öffnen.';
const TIMEOUT =
  'Keine Antwort vom OnlyOffice-Plugin. Ist das edu-sharing-Plugin (Plugins im Hintergrund) aktiv?';
const UNSUPPORTED = 'Nur Textdokumente können ausgelesen werden (keine Tabellen/Präsentationen).';
const READ_FAILED = 'Das Dokument konnte nicht ausgelesen werden.';

/** The two request timeouts, as the service sets them. */
const CONTENT_TIMEOUT_MS = 15000;
const INFO_TIMEOUT_MS = 10000;

describe('OnlyOfficeDocumentService', () => {
  let documents: OnlyOfficeDocumentService;
  let extension: BrowserExtensionFake;
  let auth: AuthFake;
  let debug: DebugFake;

  /** Every node the repository holds, by id — what {@link repositoryNodes} answers out of. */
  let repository: Map<string, Node>;

  /** Which loads are to fail, by node id. */
  let refused: Set<string>;

  /** Loads that have not answered yet, so a spec can decide the order two of them come back in. */
  let inFlight: { nodeId: string; settle: (node: Node) => void; fail: () => void }[];

  /** Whether a load answers at once or waits to be settled by hand — see {@link holdLoads}. */
  let holding = false;

  const repositoryNodes = {
    get: vi.fn((nodeId: string): Promise<Node> => {
      if (holding) {
        return new Promise<Node>((resolve, reject) => {
          inFlight.push({
            nodeId,
            settle: (node) => resolve(node),
            fail: () => reject(new Error(`no such node: ${nodeId}`)),
          });
        });
      }
      if (refused.has(nodeId)) return Promise.reject(new Error(`no such node: ${nodeId}`));
      const node = repository.get(nodeId);
      return node ? Promise.resolve(node) : Promise.reject(new Error(`no such node: ${nodeId}`));
    }),
  };

  beforeEach(() => {
    vi.useFakeTimers();
    repository = new Map();
    refused = new Set();
    inFlight = [];
    holding = false;
    repositoryNodes.get.mockClear();
    extension = fakeBrowserExtension();
    auth = fakeAuth();
    debug = fakeDebug();
    TestBed.configureTestingModule({
      providers: [
        provideFake(BrowserExtensionService, extension.fake),
        provideFake(AuthService, auth.fake),
        provideFake(DebugService, debug.fake),
        provideFake(RepositoryNodeService, repositoryNodes as never),
      ],
    });
    documents = TestBed.inject(OnlyOfficeDocumentService);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** The id the last request went out under, which is what its answer has to carry back. */
  function lastRequestId(kind: DocumentRequestKind = 'content'): string {
    const spy = kind === 'info' ? extension.fake.requestDocumentInfo : extension.fake.requestDocumentContent;
    const calls = spy.mock.calls;
    return calls[calls.length - 1]?.[0] as string;
  }

  /** The plugin answers a request, the way `panel-host.js` relays it. */
  function answers(event: 'DOCUMENT_INFO' | 'DOCUMENT_CONTENT', data: DocumentContent, envelope: Partial<PluginEnvelope> = {}): boolean {
    return documents.accept({ event, data, ...envelope });
  }

  /** Let the microtasks a settled load queued run, and the effects react to what they set. */
  async function settle(): Promise<void> {
    await vi.advanceTimersByTimeAsync(0);
    TestBed.tick();
  }

  /** Loads wait to be answered by hand, so two of them can be made to come back out of order. */
  function holdLoads(): void {
    holding = true;
  }

  describe('asking the host for the open document', () => {

    it('asks for the content under an id of its own', async () => {
      const asked = documents.requestContent();

      expect(extension.fake.requestDocumentContent).toHaveBeenCalledTimes(1);
      answers('DOCUMENT_CONTENT', { requestId: lastRequestId(), markdown: '# Optik' });

      await expect(asked).resolves.toMatchObject({ markdown: '# Optik' });
    });

    it('asks for the identity alone where the content is not wanted', async () => {
      const asked = documents.requestInfo();

      expect(extension.fake.requestDocumentInfo).toHaveBeenCalledTimes(1);
      expect(extension.fake.requestDocumentContent).not.toHaveBeenCalled();
      answers('DOCUMENT_INFO', { requestId: lastRequestId('info'), document: { nodeId: 'abc' } });

      await expect(asked).resolves.toEqual({ nodeId: 'abc' });
    });

    it('answers no identity for a plugin that reports none', async () => {
      const asked = documents.requestInfo();
      answers('DOCUMENT_INFO', { requestId: lastRequestId('info') });

      await expect(asked).resolves.toBeNull();
    });

    it('keeps several requests apart, and answers each with its own', async () => {
      const first = documents.requestContent();
      const firstId = lastRequestId();
      const second = documents.requestContent();
      const secondId = lastRequestId();

      expect(firstId).not.toBe(secondId);

      answers('DOCUMENT_CONTENT', { requestId: secondId, markdown: 'zweites' });
      answers('DOCUMENT_CONTENT', { requestId: firstId, markdown: 'erstes' });

      await expect(first).resolves.toMatchObject({ markdown: 'erstes' });
      await expect(second).resolves.toMatchObject({ markdown: 'zweites' });
    });

    it('refuses an editor whose document is not text', async () => {
      const asked = documents.requestContent();
      answers('DOCUMENT_CONTENT', { requestId: lastRequestId(), unsupported: true });

      await expect(asked).rejects.toThrow(UNSUPPORTED);
    });

    it('reports a document the plugin could not read', async () => {
      const asked = documents.requestContent();
      answers('DOCUMENT_CONTENT', { requestId: lastRequestId(), error: 'ENOENT' });

      await expect(asked).rejects.toThrow(READ_FAILED);
    });

    it('gives up on a plugin that never answers, and says which plugin', async () => {
      const asked = documents.requestContent();
      const failed = asked.catch((cause: unknown) => cause);

      await vi.advanceTimersByTimeAsync(CONTENT_TIMEOUT_MS - 1);
      answers('DOCUMENT_CONTENT', { requestId: 'nobody-waits-for-this' });
      await vi.advanceTimersByTimeAsync(1);

      expect(await failed).toEqual(new Error(TIMEOUT));
    });

    it('waits less long for the identity than for the content', async () => {
      const asked = documents.requestInfo();
      const failed = asked.catch((cause: unknown) => cause);

      await vi.advanceTimersByTimeAsync(INFO_TIMEOUT_MS);

      expect(await failed).toEqual(new Error(TIMEOUT));
    });

    it('drops an answer that arrives after it gave up', async () => {
      const asked = documents.requestContent();
      const failed = asked.catch((cause: unknown) => cause);
      const requestId = lastRequestId();
      await vi.advanceTimersByTimeAsync(CONTENT_TIMEOUT_MS);
      await failed;

      expect(answers('DOCUMENT_CONTENT', { requestId, markdown: 'zu spät' })).toBe(true);
      expect(documents.currentDocument()).toBeNull();
    });

    it('clears the timeout an answer beat, so nothing fires later', async () => {
      const asked = documents.requestContent();
      answers('DOCUMENT_CONTENT', { requestId: lastRequestId(), markdown: '# Optik' });
      await asked;

      await vi.advanceTimersByTimeAsync(CONTENT_TIMEOUT_MS * 2);

      await expect(asked).resolves.toMatchObject({ markdown: '# Optik' });
    });
  });

  describe('with no host page to ask', () => {
    beforeEach(() => extension.standalone());

    it('says so at once rather than waiting out the timeout', async () => {
      await expect(documents.requestContent()).rejects.toThrow(NO_HOST);
      await expect(documents.requestInfo()).rejects.toThrow(NO_HOST);
    });

    it('keeps nothing waiting, so a late answer resolves nobody', async () => {
      const requestId = 'es-1';
      await expect(documents.requestContent()).rejects.toThrow(NO_HOST);

      expect(answers('DOCUMENT_CONTENT', { requestId })).toBe(true);
      expect(documents.currentDocument()).toBeNull();
    });
  });

  describe('with the debug simulator switched on', () => {
    /** The simulator answers its own requests, on the route the host page's answers take. */
    let simulate: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      simulate = vi.fn((kind: DocumentRequestKind, requestId: string) => {
        documents.accept({
          event: kind === 'info' ? 'DOCUMENT_INFO' : 'DOCUMENT_CONTENT',
          data: { requestId, markdown: '# simuliert', document: { nodeId: 'sim-1' } },
          document: { nodeId: 'sim-1' },
        });
        return true;
      });
      Object.assign(debug.fake, { answerDocumentRequest: simulate });
      debug.fake.enabled.set(true);
    });

    it('asks the simulator instead of the page', async () => {
      const asked = documents.requestContent();

      expect(simulate).toHaveBeenCalledWith('content', expect.any(String));
      expect(extension.fake.requestDocumentContent).not.toHaveBeenCalled();
      await expect(asked).resolves.toMatchObject({ markdown: '# simuliert' });
    });

    it('asks it for the identity too', async () => {
      await expect(documents.requestInfo()).resolves.toEqual({ nodeId: 'sim-1' });
      expect(simulate).toHaveBeenCalledWith('info', expect.any(String));
      expect(extension.fake.requestDocumentInfo).not.toHaveBeenCalled();
    });

    it('reports a simulator that refuses as no host', async () => {
      simulate.mockReturnValue(false);

      await expect(documents.requestContent()).rejects.toThrow(NO_HOST);
    });
  });

  describe('taking what the plugin sends', () => {

    it('leaves an event it does not handle to the next reader', () => {
      expect(documents.accept({ event: 'PREVIEW_NODE', document: { nodeId: 'abc' } })).toBe(false);
      expect(documents.accept({})).toBe(false);
      expect(documents.currentDocument()).toBeNull();
    });

    it('takes the document the plugin announces on startup', () => {
      expect(answers('DOCUMENT_INFO', {}, { document: { nodeId: 'abc' } })).toBe(true);

      expect(documents.currentDocument()).toEqual({ nodeId: 'abc' });
    });

    it('reads the identity out of the payload where the envelope carries none', () => {
      answers('DOCUMENT_INFO', { document: { nodeId: 'abc' } });

      expect(documents.currentDocument()).toEqual({ nodeId: 'abc' });
    });

    it('prefers the envelope identity, which every event carries', () => {
      answers('DOCUMENT_INFO', { document: { nodeId: 'aus-den-daten' } }, { document: { nodeId: 'vom-umschlag' } });

      expect(documents.currentDocument()).toEqual({ nodeId: 'vom-umschlag' });
    });

    it('keeps the last known document where a stale plugin sends none', () => {
      answers('DOCUMENT_INFO', {}, { document: { nodeId: 'abc' } });

      answers('DOCUMENT_INFO', {}, { document: null });

      expect(documents.currentDocument()).toEqual({ nodeId: 'abc' });
    });

    it('drops content nobody asked for, so a double-click does not take the user elsewhere', () => {
      answers('DOCUMENT_INFO', {}, { document: { nodeId: 'abc' } });

      expect(answers('DOCUMENT_CONTENT', { markdown: '# fremd' }, { document: { nodeId: 'fremd' } })).toBe(true);

      expect(documents.currentDocument()).toEqual({ nodeId: 'abc' });
    });

    it('takes the document of content it did ask for', async () => {
      const asked = documents.requestContent();

      answers('DOCUMENT_CONTENT', { requestId: lastRequestId(), markdown: '# Optik' }, { document: { nodeId: 'abc' } });

      await expect(asked).resolves.toEqual({
        requestId: expect.any(String),
        markdown: '# Optik',
        document: { nodeId: 'abc' },
      });
      expect(documents.currentDocument()).toEqual({ nodeId: 'abc' });
    });

    it('hands the caller the identity it resolved, not the one the payload carried', async () => {
      const asked = documents.requestContent();

      answers('DOCUMENT_CONTENT', { requestId: lastRequestId() }, { document: { nodeId: 'abc' } });

      await expect(asked).resolves.toMatchObject({ document: { nodeId: 'abc' } });
    });

    it('answers a caller even where the plugin names no document at all', async () => {
      const asked = documents.requestContent();

      answers('DOCUMENT_CONTENT', { requestId: lastRequestId(), markdown: '# Optik' });

      await expect(asked).resolves.toMatchObject({ document: null });
      expect(documents.currentDocument()).toBeNull();
    });
  });

  describe('the node behind the open document', () => {

    it('stays unknown while nobody is signed in', async () => {
      answers('DOCUMENT_INFO', {}, { document: { nodeId: 'abc' } });
      await settle();

      expect(repositoryNodes.get).not.toHaveBeenCalled();
      expect(documents.documentNode()).toBeNull();
    });

    it('is loaded as soon as a session exists', async () => {
      repository.set('abc', aNode({ ref: { id: 'abc', repo: 'local' } } as never));
      answers('DOCUMENT_INFO', {}, { document: { nodeId: 'abc' } });
      await settle();

      auth.signIn();
      TestBed.tick();
      await settle();

      expect(repositoryNodes.get).toHaveBeenCalledWith('abc');
      expect(documents.documentNode()?.ref.id).toBe('abc');
    });

    it('is loaded once for the same document', async () => {
      auth.signIn();
      repository.set('abc', aNode({ ref: { id: 'abc', repo: 'local' } } as never));

      answers('DOCUMENT_INFO', {}, { document: { nodeId: 'abc' } });
      await settle();
      answers('DOCUMENT_INFO', {}, { document: { nodeId: 'abc' } });
      await settle();

      expect(repositoryNodes.get).toHaveBeenCalledTimes(1);
    });

    it('is loaded again for a document that has changed', async () => {
      auth.signIn();
      repository.set('abc', aNode({ ref: { id: 'abc', repo: 'local' }, title: 'Optik' } as never));
      repository.set('def', aNode({ ref: { id: 'def', repo: 'local' }, title: 'Akustik' } as never));

      answers('DOCUMENT_INFO', {}, { document: { nodeId: 'abc' } });
      await settle();
      answers('DOCUMENT_INFO', {}, { document: { nodeId: 'def' } });
      await settle();

      expect(repositoryNodes.get).toHaveBeenCalledTimes(2);
      expect(documents.documentNode()?.ref.id).toBe('def');
    });

    it('lets go of the node it had while the new one is on its way', async () => {
      auth.signIn();
      repository.set('abc', aNode({ ref: { id: 'abc', repo: 'local' } } as never));
      answers('DOCUMENT_INFO', {}, { document: { nodeId: 'abc' } });
      await settle();

      holdLoads();
      answers('DOCUMENT_INFO', {}, { document: { nodeId: 'def' } });

      expect(documents.documentNode()).toBeNull();
    });

    it('keeps the newer load where an older one comes back after it', async () => {
      auth.signIn();
      holdLoads();

      answers('DOCUMENT_INFO', {}, { document: { nodeId: 'abc' } });
      answers('DOCUMENT_INFO', {}, { document: { nodeId: 'def' } });
      const [first, second] = inFlight;
      second.settle(aNode({ ref: { id: 'def', repo: 'local' } } as never));
      await settle();
      first.settle(aNode({ ref: { id: 'abc', repo: 'local' } } as never));
      await settle();

      expect(documents.documentNode()?.ref.id).toBe('def');
    });

    it('allows another attempt after a load that failed', async () => {
      auth.signIn();
      refused.add('abc');
      answers('DOCUMENT_INFO', {}, { document: { nodeId: 'abc' } });
      await settle();

      expect(documents.documentNode()).toBeNull();
      const attempts = repositoryNodes.get.mock.calls.length;

      refused.delete('abc');
      repository.set('abc', aNode({ ref: { id: 'abc', repo: 'local' } } as never));
      answers('DOCUMENT_INFO', {}, { document: { nodeId: 'abc' } });
      await settle();

      // The same node is asked for again, which the once-only guard would otherwise refuse: a load
      // that failed is not a load, and the panel is often opened before there is a session.
      expect(repositoryNodes.get.mock.calls.length).toBeGreaterThan(attempts);
      expect(documents.documentNode()?.ref.id).toBe('abc');
    });
  });

  describe('what the panel shows about the document', () => {
    beforeEach(() => auth.signIn());

    /** Put a node behind the open document and let the load finish. */
    async function opened(node: Partial<Node>, nodeId = 'abc'): Promise<void> {
      repository.set(nodeId, aNode({ ref: { id: nodeId, repo: 'local' }, ...node } as never));
      answers('DOCUMENT_INFO', {}, { document: { nodeId } });
      await settle();
    }

    it('has no title before anything is known', () => {
      expect(documents.documentTitle()).toBeNull();
      expect(documents.documentPermaLink()).toBeNull();
      expect(documents.documentWritable()).toBeNull();
    });

    it('names the document by its bare id while the node is not loaded', () => {
      auth.fake.authorized.set(false);
      answers('DOCUMENT_INFO', {}, { document: { nodeId: 'abc' } });

      expect(documents.documentTitle()).toBe('abc');
    });

    it('names it by the node title', async () => {
      await opened({ title: 'Optik', name: 'optik.docx' });

      expect(documents.documentTitle()).toBe('Optik');
    });

    it('falls back to the file name where the node has no title', async () => {
      await opened({ title: '', name: 'optik.docx' });

      expect(documents.documentTitle()).toBe('optik.docx');
    });

    it('links to the repository page while the node is not loaded', () => {
      auth.fake.authorized.set(false);
      answers('DOCUMENT_INFO', {}, { document: { nodeId: 'abc' } });

      expect(documents.documentPermaLink()).toBe(`${FAKE_REPOSITORY_URL}/components/render/abc`);
    });

    it('links to the permalink the node states', async () => {
      await opened({ properties: { 'virtual:permalink': ['https://repo.example/edu-sharing/permalink/abc'] } });

      expect(documents.documentPermaLink()).toBe('https://repo.example/edu-sharing/permalink/abc');
    });

    it('says nothing about writing while the node is unknown', () => {
      auth.fake.authorized.set(false);
      answers('DOCUMENT_INFO', {}, { document: { nodeId: 'abc' } });

      expect(documents.documentWritable()).toBeNull();
    });

    it('says whether the session may write onto it', async () => {
      await opened({ access: ['Read', 'Write'] });

      expect(documents.documentWritable()).toBe(true);
    });

    it('says so where it may only read it', async () => {
      await opened({ access: ['Read'] });

      expect(documents.documentWritable()).toBe(false);
    });
  });
});
