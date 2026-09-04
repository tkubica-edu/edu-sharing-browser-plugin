import { Mock, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { DRAFT_NODE_ID } from './mds-node';
import { installDraftRequestGuard, isDraftNodeUrl } from './bundle-requests';

const REPO = 'https://repo.example.org/edu-sharing/rest';
const NODE = '2c4d6b1a-8f3e-4c2b-9a10-7d5e6f8b0c31';

describe('isDraftNodeUrl', () => {
  it('recognises the stand-in node as a segment of the path', () => {
    expect(isDraftNodeUrl(`${REPO}/node/v1/nodes/-home-/${DRAFT_NODE_ID}/metadata`)).toBe(true);
    expect(isDraftNodeUrl(`/rest/node/v1/nodes/-home-/${DRAFT_NODE_ID}`)).toBe(true);
  });

  it('does not catch an id that merely contains the word', () => {
    expect(isDraftNodeUrl(`${REPO}/node/v1/nodes/-home-/x-draft-y/metadata`)).toBe(false);
    expect(isDraftNodeUrl(`${REPO}/node/v1/nodes/-home-/${NODE}`)).toBe(false);
  });

  it('reads the path only, so a query naming the stand-in does not make the request one', () => {
    expect(isDraftNodeUrl(`${REPO}/node/v1/nodes?parent=${DRAFT_NODE_ID}`)).toBe(false);
  });

  it('reads something that is no address as the text it is', () => {
    expect(isDraftNodeUrl(DRAFT_NODE_ID)).toBe(true);
    expect(isDraftNodeUrl('')).toBe(false);
  });
});

describe('installDraftRequestGuard', () => {
  /** Stands in for the browser's own transport, so what is let through is visible and nothing dials out. */
  let nativeOpen: Mock;
  let nativeSend: Mock;

  /** The prototype as the guard leaves it, so it can be put back over the network guard per test. */
  let patched: Pick<XMLHttpRequest, 'open' | 'send'>;

  beforeAll(() => {
    nativeOpen = vi.fn();
    nativeSend = vi.fn();
    XMLHttpRequest.prototype.open = nativeOpen as unknown as typeof XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.send = nativeSend as unknown as typeof XMLHttpRequest.prototype.send;
    installDraftRequestGuard();
    patched = { open: XMLHttpRequest.prototype.open, send: XMLHttpRequest.prototype.send };
  });

  beforeEach(() => {
    // `no-network.setup.ts` puts its own guard on the prototype for every test; the patch under test
    // goes back over it here, which is also the order the panel installs it in a browser. The stand-ins
    // above are what it calls through to, so nothing reaches jsdom's own transport either way.
    Object.assign(XMLHttpRequest.prototype, patched);
    vi.useFakeTimers();
    nativeOpen.mockClear();
    nativeSend.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** A request the bundle opened on the stand-in node, answered and with its events delivered. */
  function guarded(responseType: XMLHttpRequestResponseType = ''): XMLHttpRequest {
    const xhr = new XMLHttpRequest();
    xhr.responseType = responseType;
    xhr.open('GET', `${REPO}/node/v1/nodes/-home-/${DRAFT_NODE_ID}/metadata`);
    xhr.send();
    vi.runAllTimers();
    return xhr;
  }

  it('lets every request that is not about the stand-in node go out', () => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', `${REPO}/node/v1/nodes/-home-/${NODE}/metadata`);
    xhr.send();

    expect(nativeSend).toHaveBeenCalledTimes(1);
  });

  it('opens the request either way, so a caller reading the instance sees what it asked for', () => {
    const url = `${REPO}/node/v1/nodes/-home-/${DRAFT_NODE_ID}/metadata`;
    new XMLHttpRequest().open('GET', url);
    expect(nativeOpen).toHaveBeenCalledWith('GET', url);
  });

  it('never sends a request built from the stand-in node', () => {
    guarded();
    expect(nativeSend).not.toHaveBeenCalled();
  });

  it('answers it locally as a request that succeeded', () => {
    const xhr = guarded();
    expect(xhr.readyState).toBe(XMLHttpRequest.DONE);
    expect(xhr.status).toBe(200);
    expect(xhr.statusText).toBe('OK');
  });

  it('answers with the empty node listing, which is the truth for a node that does not exist', () => {
    expect(JSON.parse(guarded().responseText)).toEqual({
      nodes: [],
      pagination: { total: 0, from: 0, count: 0 },
    });
  });

  it('answers in the shape the caller asked for, exactly as a real reply would', () => {
    expect(guarded('json').response).toEqual({
      nodes: [],
      pagination: { total: 0, from: 0, count: 0 },
    });
    expect(typeof guarded('text').response).toBe('string');
    expect(typeof guarded().response).toBe('string');
  });

  it('reports the content type, which is what the caller reads the body under', () => {
    const xhr = guarded();
    expect(xhr.getResponseHeader('Content-Type')).toBe('application/json');
    expect(xhr.getResponseHeader('X-Anderes')).toBeNull();
    expect(xhr.getAllResponseHeaders()).toContain('content-type: application/json');
  });

  it('answers after send has returned, as a real request does', () => {
    const events: string[] = [];
    const xhr = new XMLHttpRequest();
    xhr.addEventListener('load', () => events.push('load'));
    xhr.addEventListener('loadend', () => events.push('loadend'));
    xhr.addEventListener('readystatechange', () => events.push('readystatechange'));
    xhr.open('GET', `${REPO}/node/v1/nodes/-home-/${DRAFT_NODE_ID}/metadata`);

    xhr.send();
    expect(events).toEqual([]);

    vi.runAllTimers();
    expect(events).toEqual(['readystatechange', 'load', 'loadend']);
  });

  it('forgets a request the bundle opened on the stand-in and then reopened elsewhere', () => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', `${REPO}/node/v1/nodes/-home-/${DRAFT_NODE_ID}/metadata`);
    xhr.open('GET', `${REPO}/node/v1/nodes/-home-/${NODE}/metadata`);
    xhr.send();

    expect(nativeSend).toHaveBeenCalledTimes(1);
  });

  it('says in the console what it held back, so a missing reply is not a silent one', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    guarded();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('not sent, answered empty (draft node)'),
      expect.stringContaining(DRAFT_NODE_ID),
    );
    warn.mockRestore();
  });

  it('patches the transport once, however often it is installed', () => {
    const patched = XMLHttpRequest.prototype.send;
    installDraftRequestGuard();
    expect(XMLHttpRequest.prototype.send).toBe(patched);
  });
});
