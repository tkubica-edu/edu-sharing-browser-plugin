import { Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchJson } from './json-api';

const URL_UNDER_TEST = 'https://judge.example.org/api/check';

describe('fetchJson', () => {
  let fetchMock: Mock;

  beforeEach(() => {
    // Stubbed over the guard from `no-network.setup.ts`, which runs first: the `fetch` of this module
    // is the subject here, so it needs an answer rather than a refusal.
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** The service answers with `body` under `status`. */
  function answers(body: unknown, status = 200): void {
    fetchMock.mockResolvedValue(
      new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }),
    );
  }

  /** What the one call was made with. */
  function request(): RequestInit {
    return fetchMock.mock.calls[0][1] as RequestInit;
  }

  it('returns what the service answered', async () => {
    answers({ verdict: 'in Ordnung' });
    await expect(fetchJson({ service: 'ContentJudge', url: URL_UNDER_TEST, timeoutMs: 1000 })).resolves.toEqual({
      verdict: 'in Ordnung',
    });
  });

  it('asks for JSON, and asks with GET where no method is given', async () => {
    answers({});
    await fetchJson({ service: 'ContentJudge', url: URL_UNDER_TEST, timeoutMs: 1000 });

    expect(fetchMock).toHaveBeenCalledWith(URL_UNDER_TEST, expect.any(Object));
    expect(request().method).toBe('GET');
    expect(request().headers).toMatchObject({ Accept: 'application/json' });
  });

  it('sends a body as JSON, and says so', async () => {
    answers({});
    await fetchJson({
      service: 'ContentJudge',
      url: URL_UNDER_TEST,
      method: 'POST',
      body: { text: 'Der Artikel selbst.' },
      timeoutMs: 1000,
    });

    expect(request().method).toBe('POST');
    expect(request().body).toBe('{"text":"Der Artikel selbst."}');
    expect(request().headers).toMatchObject({ 'Content-Type': 'application/json' });
  });

  it('sends no body and claims no content type for a request that has none', async () => {
    answers({});
    await fetchJson({ service: 'ContentJudge', url: URL_UNDER_TEST, timeoutMs: 1000 });

    expect(request()).not.toHaveProperty('body');
    expect(request().headers).not.toHaveProperty('Content-Type');
  });

  it('sends the headers the caller adds, which may be the ones it would have sent itself', async () => {
    answers({});
    await fetchJson({
      service: 'ContentJudge',
      url: URL_UNDER_TEST,
      headers: { 'X-Api-Key': 'geheim', Accept: 'application/ld+json' },
      timeoutMs: 1000,
    });

    expect(request().headers).toMatchObject({ 'X-Api-Key': 'geheim', Accept: 'application/ld+json' });
  });

  it('carries the browser\'s cookies only where the caller asks for them', async () => {
    answers({});
    await fetchJson({ service: 'ContentJudge', url: URL_UNDER_TEST, credentials: 'include', timeoutMs: 1000 });
    expect(request().credentials).toBe('include');

    fetchMock.mockClear();
    answers({});
    await fetchJson({ service: 'ContentJudge', url: URL_UNDER_TEST, timeoutMs: 1000 });
    expect(request()).not.toHaveProperty('credentials');
  });

  it('names the service and the address where there is no answer at all', async () => {
    fetchMock.mockRejectedValue(new Error('Failed to fetch'));
    await expect(
      fetchJson({ service: 'MetalookUp', url: URL_UNDER_TEST, timeoutMs: 1000 }),
    ).rejects.toThrow(`MetalookUp nicht erreichbar (${URL_UNDER_TEST}): Failed to fetch`);
  });

  it('names the service and the status where the answer cannot be read under it', async () => {
    answers('kein Zugriff', 403);
    await expect(
      fetchJson({ service: 'MetalookUp', url: URL_UNDER_TEST, timeoutMs: 1000 }),
    ).rejects.toThrow('MetalookUp antwortet mit 403: kein Zugriff');
  });

  it('carries the whole body of such an answer, so nothing about the cause is cut off', async () => {
    const detail = 'x'.repeat(5000);
    answers(detail, 500);
    await expect(
      fetchJson({ service: 'MetalookUp', url: URL_UNDER_TEST, timeoutMs: 1000 }),
    ).rejects.toThrow(`MetalookUp antwortet mit 500: ${detail}`);
  });

  it('still reports the status where the body cannot be read', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      text: () => Promise.reject(new Error('stream verloren')),
    } as unknown as Response);
    await expect(
      fetchJson({ service: 'MetalookUp', url: URL_UNDER_TEST, timeoutMs: 1000 }),
    ).rejects.toThrow('MetalookUp antwortet mit 502: ');
  });

  it('names the service where what arrived is not JSON', async () => {
    answers('<html>Wartungsarbeiten</html>');
    await expect(
      fetchJson({ service: 'ContentJudge', url: URL_UNDER_TEST, timeoutMs: 1000 }),
    ).rejects.toThrow(`ContentJudge antwortet nicht mit JSON (${URL_UNDER_TEST})`);
  });

  it('reads JSON that is no object as no answer either — a contract states a shape', async () => {
    answers('null');
    await expect(
      fetchJson({ service: 'ContentJudge', url: URL_UNDER_TEST, timeoutMs: 1000 }),
    ).rejects.toThrow('antwortet nicht mit JSON');

    answers('42');
    await expect(
      fetchJson({ service: 'ContentJudge', url: URL_UNDER_TEST, timeoutMs: 1000 }),
    ).rejects.toThrow('antwortet nicht mit JSON');
  });

  it('gives up on a service that does not answer within the time it was given', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('The operation was aborted.')));
        }),
    );

    const pending = fetchJson({ service: 'ContentJudge', url: URL_UNDER_TEST, timeoutMs: 5000 });
    const settled = expect(pending).rejects.toThrow('ContentJudge nicht erreichbar');
    await vi.advanceTimersByTimeAsync(5000);

    await settled;
  });

  it('bounds the whole exchange, so a body that never arrives is given up on too', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            new Promise((_resolve, reject) => {
              init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
            }),
        } as unknown as Response),
    );

    const pending = fetchJson({ service: 'ContentJudge', url: URL_UNDER_TEST, timeoutMs: 5000 });
    const settled = expect(pending).rejects.toThrow('antwortet nicht mit JSON');
    await vi.advanceTimersByTimeAsync(5000);

    await settled;
  });

  it('leaves no timer behind once the service has answered', async () => {
    vi.useFakeTimers();
    answers({ verdict: 'in Ordnung' });

    await fetchJson({ service: 'ContentJudge', url: URL_UNDER_TEST, timeoutMs: 5000 });

    expect(vi.getTimerCount()).toBe(0);
  });
});
