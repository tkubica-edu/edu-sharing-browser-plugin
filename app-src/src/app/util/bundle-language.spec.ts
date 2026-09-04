import { Mock, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { installBundleLanguage } from './bundle-language';

const REPO = 'https://repo.example.org/edu-sharing/rest';
const PREFERENCES = `${REPO}/iam/v1/people/-home-/admin/preferences`;

/** What the stand-in transport answers each request with, before the patch has a say. */
const replies = new WeakMap<XMLHttpRequest, string>();

/** The bundle's own key for the language, in the profile and in local storage alike. */
const LANGUAGE_KEY = 'language';

describe('installBundleLanguage', () => {
  /** Stands in for the browser's own transport, so nothing dials out and every reply is the test's. */
  let nativeOpen: Mock;

  /** The prototype as the patch leaves it, so it can be put back over the network guard per test. */
  let patched: typeof XMLHttpRequest.prototype.open;

  beforeAll(() => {
    nativeOpen = vi.fn();
    XMLHttpRequest.prototype.open = nativeOpen as unknown as typeof XMLHttpRequest.prototype.open;
    // The patch wraps the prototype's own `response`/`responseText` getters, so the reply has to come
    // from there: these stand in for the ones jsdom defines, which answer '' for a request never sent.
    for (const property of ['response', 'responseText']) {
      Object.defineProperty(XMLHttpRequest.prototype, property, {
        configurable: true,
        get(this: XMLHttpRequest) {
          const body = replies.get(this) ?? '';
          return property === 'response' && this.responseType === 'json' ? JSON.parse(body || 'null') : body;
        },
      });
    }
    installBundleLanguage();
    patched = XMLHttpRequest.prototype.open;
  });

  beforeEach(() => {
    // `no-network.setup.ts` puts its own guard on the prototype for every test; the patch under test
    // goes back over it here, which is also the order the panel installs it in a browser. The stand-in
    // above is what it calls through to, so nothing reaches jsdom's own transport.
    XMLHttpRequest.prototype.open = patched;
    localStorage.clear();
    nativeOpen.mockClear();
  });

  afterEach(() => localStorage.clear());

  /** A request the bundle opened on `url`, which the repository answers with `body`. */
  function answered(url: string, body: unknown, responseType: XMLHttpRequestResponseType = ''): XMLHttpRequest {
    const xhr = new XMLHttpRequest();
    xhr.responseType = responseType;
    replies.set(xhr, typeof body === 'string' ? body : JSON.stringify(body));
    xhr.open('GET', url);
    return xhr;
  }

  /** The preferences document out of a reply, parsed. */
  function preferencesOf(xhr: XMLHttpRequest): Record<string, unknown> {
    return JSON.parse(JSON.parse(xhr.responseText).preferences);
  }

  it('states the language in local storage, which is what the bundle falls back to for a guest', () => {
    installBundleLanguage();
    expect(localStorage.getItem(LANGUAGE_KEY)).toBe('"de"');
  });

  it('opens the request either way — the reply is rewritten, not withheld', () => {
    answered(PREFERENCES, { preferences: '{}' });
    expect(nativeOpen).toHaveBeenCalledWith('GET', PREFERENCES);
  });

  it('answers the preferences with the language set', () => {
    expect(preferencesOf(answered(PREFERENCES, { preferences: '{}' }))[LANGUAGE_KEY]).toBe('de');
  });

  it('overrides a language the profile states itself, which is what turns the form English', () => {
    const xhr = answered(PREFERENCES, { preferences: JSON.stringify({ language: 'en' }) });
    expect(preferencesOf(xhr)[LANGUAGE_KEY]).toBe('de');
  });

  it('leaves every other preference of the profile alone', () => {
    const xhr = answered(PREFERENCES, {
      preferences: JSON.stringify({ language: 'en', notifications: 'off' }),
    });
    expect(preferencesOf(xhr)).toEqual({ language: 'de', notifications: 'off' });
  });

  it('keeps the rest of the reply\'s envelope', () => {
    const xhr = answered(PREFERENCES, { preferences: '{}', authorityName: 'admin' });
    expect(JSON.parse(xhr.responseText).authorityName).toBe('admin');
  });

  it('states the language even where the profile document cannot be read', () => {
    const xhr = answered(PREFERENCES, { preferences: 'kein JSON' });
    expect(preferencesOf(xhr)).toEqual({ language: 'de' });
  });

  it('answers in the shape the caller asked for', () => {
    const xhr = answered(PREFERENCES, { preferences: '{}' }, 'json');
    expect(JSON.parse((xhr.response as { preferences: string }).preferences)[LANGUAGE_KEY]).toBe('de');
  });

  it('passes a reply that does not look like the preferences through untouched', () => {
    expect(answered(PREFERENCES, { etwas: 'anderes' }).responseText).toBe('{"etwas":"anderes"}');
    expect(answered(PREFERENCES, 'kein JSON').responseText).toBe('kein JSON');
    expect(answered(PREFERENCES, '').responseText).toBe('');
  });

  it('touches no request that is not about the preferences', () => {
    const url = `${REPO}/node/v1/nodes/-home-/2c4d6b1a-8f3e-4c2b-9a10-7d5e6f8b0c31/metadata`;
    const xhr = answered(url, { preferences: JSON.stringify({ language: 'en' }) });
    expect(preferencesOf(xhr)[LANGUAGE_KEY]).toBe('en');
  });

  it('reads the path only, so a query naming the preferences does not make the request one', () => {
    const xhr = answered(`${REPO}/node/v1/nodes?from=/iam/v1/people/-home-/admin/preferences`, {
      preferences: JSON.stringify({ language: 'en' }),
    });
    expect(preferencesOf(xhr)[LANGUAGE_KEY]).toBe('en');
  });

  it('patches the transport once, however often it is installed', () => {
    const patched = XMLHttpRequest.prototype.open;
    installBundleLanguage();
    expect(XMLHttpRequest.prototype.open).toBe(patched);
  });
});
