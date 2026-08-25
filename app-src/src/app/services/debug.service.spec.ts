import { TestBed } from '@angular/core/testing';
import { MockInstance, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_CONFIG } from '../config';
import { PLUGIN_SOURCE, PluginEnvelope } from '../model/onlyoffice-events';
import { BrowserExtensionService } from './browser-extension.service';
import { DebugService } from './debug.service';
import { provideFake } from '../../testing/provide-fake';
import { BrowserExtensionFake, fakeBrowserExtension } from '../../testing/fakes';

/** The node id the simulated document reports while nobody configured one. */
const DEFAULT_NODE_ID = 'debug-document-node';

/** How long a simulated answer takes, so the caller sees the in-flight state as with the real plugin. */
const LATENCY_MS = 250;

/** The envelope as it goes to the window: the plugin's own marker, plus what the event carries. */
type PostedMessage = PluginEnvelope & { source: string };

describe('DebugService', () => {
  let debug: DebugService;
  let extension: BrowserExtensionFake;
  /**
   * `window.postMessage` is the seam: the service hands the envelope to our own window, where the shell's
   * one message listener picks it up. Spied rather than listened for, so the assertion is on what the
   * service sends and not on jsdom's delivery of it.
   */
  let posted: MockInstance<typeof window.postMessage>;

  beforeEach(() => {
    extension = fakeBrowserExtension();
    TestBed.configureTestingModule({
      providers: [provideFake(BrowserExtensionService, extension.fake)],
    });
    debug = TestBed.inject(DebugService);
    posted = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    posted.mockRestore();
  });

  const keys = APP_CONFIG.storageKeys;

  /** The events the service posted, in the order it posted them. */
  function events(): PostedMessage[] {
    return posted.mock.calls.map(([message]) => message as PostedMessage);
  }

  /** Let a simulated answer arrive. */
  async function untilAnswered(): Promise<void> {
    await vi.advanceTimersByTimeAsync(LATENCY_MS);
  }

  it('simulates nothing until it is switched on', () => {
    expect(debug.enabled()).toBe(false);
    expect(debug.documentNodeId()).toBe(DEFAULT_NODE_ID);
    expect(debug.changedSettings()).toBe(0);
  });

  describe('load', () => {
    it('takes over both persisted settings', async () => {
      extension.storage.set(keys.debugMode, true);
      extension.storage.set(keys.debugDocumentNodeId, 'node-7');

      await debug.load();

      expect(debug.enabled()).toBe(true);
      expect(debug.documentNodeId()).toBe('node-7');
    });

    it('stays off with the fake node id where nothing was stored', async () => {
      await debug.load();

      // A fake id makes the repository load fail silently, which is the state an install gets.
      expect(debug.enabled()).toBe(false);
      expect(debug.documentNodeId()).toBe(DEFAULT_NODE_ID);
    });
  });

  describe('the node id the simulated document reports', () => {
    it('is trimmed, so a pasted id works as typed', async () => {
      await debug.setDocumentNodeId('  node-7  ');

      expect(debug.documentNodeId()).toBe('node-7');
      expect(extension.storage.get(keys.debugDocumentNodeId)).toBe('node-7');
    });

    it('falls back to the default where the field was emptied', async () => {
      await debug.setDocumentNodeId('node-7');

      await debug.setDocumentNodeId('   ');

      // The field can never be left unusable.
      expect(debug.documentNodeId()).toBe(DEFAULT_NODE_ID);
      expect(extension.storage.get(keys.debugDocumentNodeId)).toBe(DEFAULT_NODE_ID);
    });

    it('is what both simulated events report', async () => {
      await debug.setDocumentNodeId('node-7');

      debug.answerDocumentRequest('info', 'request-1');
      debug.emitPreviewNode();
      await untilAnswered();

      expect(events()[0].document?.nodeId).toBe('node-7');
      expect(events()[0].data?.document?.nodeId).toBe('node-7');
      expect(events()[1].data?.id).toBe('node-7');
    });
  });

  describe('changedSettings', () => {
    it('counts nothing while the mode is off, whatever id is stored', async () => {
      await debug.setDocumentNodeId('node-7');

      // With the mode off nothing reports that node, and the settings do not show the field.
      expect(debug.changedSettings()).toBe(0);
    });

    it('counts the mode itself once it is on', async () => {
      await debug.setEnabled(true);

      expect(debug.changedSettings()).toBe(1);
    });

    it('counts an id of the user`s own beside it', async () => {
      await debug.setEnabled(true);
      await debug.setDocumentNodeId('node-7');

      expect(debug.changedSettings()).toBe(2);
    });

    it('stops counting the id that was emptied back to the default', async () => {
      await debug.setEnabled(true);
      await debug.setDocumentNodeId('node-7');

      await debug.setDocumentNodeId('');

      expect(debug.changedSettings()).toBe(1);
    });
  });

  describe('answering a document request', () => {
    it('answers like the real send, so the caller`s „no host page" branch stays untouched', () => {
      expect(debug.answerDocumentRequest('info', 'request-1')).toBe(true);
    });

    it('waits before answering, so a caller registers its pending request first', async () => {
      debug.answerDocumentRequest('info', 'request-1');

      await vi.advanceTimersByTimeAsync(LATENCY_MS - 1);
      expect(posted).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(posted).toHaveBeenCalledOnce();
    });

    it('answers an info request with the identity alone', async () => {
      debug.answerDocumentRequest('info', 'request-1');
      await untilAnswered();

      const [message] = events();
      expect(message).toMatchObject({
        source: PLUGIN_SOURCE,
        event: 'DOCUMENT_INFO',
        data: { trigger: 'request', requestId: 'request-1', editorType: 'word' },
      });
      // The identity is all an info request asks for; the text belongs to the other kind.
      expect(message.data?.text).toBeUndefined();
      expect(message.data?.markdown).toBeUndefined();
      expect(message.data?.title).toBeUndefined();
    });

    it('answers a content request with the document itself', async () => {
      debug.answerDocumentRequest('content', 'request-2');
      await untilAnswered();

      const [message] = events();
      expect(message).toMatchObject({
        event: 'DOCUMENT_CONTENT',
        data: { trigger: 'request', requestId: 'request-2', title: 'Debug-Testdokument.docx' },
      });
      expect(message.data?.markdown).toContain('# Photosynthese im Biologieunterricht');
    });

    it('carries the requestId back, which is what correlates the answer', async () => {
      debug.answerDocumentRequest('content', 'request-abc');
      await untilAnswered();

      expect(events()[0].data?.requestId).toBe('request-abc');
    });

    it('delivers the text as text, with the headings unmarked', async () => {
      debug.answerDocumentRequest('content', 'request-3');
      await untilAnswered();

      const text = events()[0].data?.text ?? '';
      expect(text).toContain('Photosynthese im Biologieunterricht');
      expect(text).not.toMatch(/^#/m);
    });

    it('delivers enough text for the metadata agent to work on', async () => {
      debug.answerDocumentRequest('content', 'request-4');
      await untilAnswered();

      // The agent refuses anything under 50 characters, and reads meaningful fields only out of
      // something that looks like teaching material.
      expect((events()[0].data?.text ?? '').length).toBeGreaterThan(50);
    });

    it('posts to our own window, where the shell listens', async () => {
      debug.answerDocumentRequest('info', 'request-5');
      await untilAnswered();

      expect(posted).toHaveBeenCalledWith(expect.objectContaining({ source: PLUGIN_SOURCE }), '*');
    });
  });

  describe('the preview node nothing requests', () => {
    it('announces the configured node the way the host page would', async () => {
      debug.emitPreviewNode();
      await untilAnswered();

      const [message] = events();
      expect(message).toMatchObject({
        source: PLUGIN_SOURCE,
        event: 'PREVIEW_NODE',
        data: { id: DEFAULT_NODE_ID, nodeTitle: 'Debug-Testdokument.docx' },
        document: { nodeId: DEFAULT_NODE_ID },
      });
      expect(message.data?.nodeMimeType).toContain('wordprocessingml');
    });

    it('waits as long as an answered request does', async () => {
      debug.emitPreviewNode();

      await vi.advanceTimersByTimeAsync(LATENCY_MS - 1);
      expect(posted).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(posted).toHaveBeenCalledOnce();
    });
  });

  describe('persistence', () => {
    it('writes the mode through to its own key', async () => {
      await debug.setEnabled(true);
      expect(extension.storage.get(keys.debugMode)).toBe(true);

      await debug.setEnabled(false);
      expect(extension.storage.get(keys.debugMode)).toBe(false);
    });
  });
});
