import { TestBed } from '@angular/core/testing';
import { HOME_REPOSITORY } from 'ngx-edu-sharing-api';
import { Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_CONFIG } from '../config';
import { MetalookupEvaluation, MetalookupService } from './metalookup.service';

/** The address the service asks, spelled out here so a moved route shows up as a failure. */
const EVALUATION_URL = `${APP_CONFIG.metalookupApiUrl}/api/evaluation`;

/** An answer as the gateway makes it. */
function anEvaluation(overrides: Partial<MetalookupEvaluation> = {}): MetalookupEvaluation {
  return {
    timestamp: '2026-08-24T12:00:00Z',
    path: '/api/evaluation',
    status: 200,
    featureExtractions: [
      { propertyId: 'ccm:oeh_quality_language', value: 0.9, description: 'sauber', confidence: 0.8 },
    ],
    ...overrides,
  };
}

describe('MetalookupService', () => {
  let metalookup: MetalookupService;
  let fetchMock: Mock;

  beforeEach(() => {
    metalookup = TestBed.inject(MetalookupService);
    // Stubbed over the guard from `no-network.setup.ts`, which runs first: this is the one service in
    // the round whose own `fetch` is under test, so it needs an answer rather than a refusal.
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** The gateway answers with `body` under `status`. */
  function answers(body: unknown, status = 200): void {
    fetchMock.mockResolvedValue(
      new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  }

  /** The request as it went out. */
  function sentRequest(): { url: string; init: RequestInit } {
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    return { url, init };
  }

  function sentBody(): Record<string, unknown> {
    return JSON.parse(String(sentRequest().init.body)) as Record<string, unknown>;
  }

  describe('requestBody', () => {
    it('refuses a resource that identifies nothing, rather than sending a certain 400', () => {
      expect(() => metalookup.requestBody({}, [])).toThrow(/url or a node id/);
      expect(() => metalookup.requestBody({ url: '  ', nodeId: null }, [])).toThrow(/url or a node id/);
    });

    it('names the type and the repository, which the API requires', () => {
      expect(metalookup.requestBody({ url: 'https://example.org/a' }, [])).toMatchObject({
        type: 'webpage',
        repository: HOME_REPOSITORY,
      });
    });

    it('sends the url as `url` and the node as `node`, trimmed', () => {
      expect(metalookup.requestBody({ url: '  https://example.org/a  ' }, [])).toMatchObject({
        url: 'https://example.org/a',
      });
      expect(metalookup.requestBody({ nodeId: '  node-7  ' }, [])).toMatchObject({ node: 'node-7' });
    });

    it('carries only the identifier it was given', () => {
      expect(metalookup.requestBody({ url: 'https://example.org/a' }, [])).not.toHaveProperty('node');
      expect(metalookup.requestBody({ nodeId: 'node-7' }, [])).not.toHaveProperty('url');
    });

    it('leaves `features` off when the caller names none, so every feature runs', () => {
      expect(metalookup.requestBody({ url: 'https://example.org/a' }, [])).not.toHaveProperty(
        'features',
      );
      expect(metalookup.requestBody({ url: 'https://example.org/a' }, ['licence'])).toMatchObject({
        features: ['licence'],
      });
    });

    it('copies the feature list instead of holding the caller array', () => {
      const features = ['licence'];
      const body = metalookup.requestBody({ url: 'https://example.org/a' }, features);
      features.push('accessibility');

      expect(body['features']).toEqual(['licence']);
    });
  });

  describe('evaluate', () => {
    it('asks the configured route as JSON, and leaves the key header off while none is set', async () => {
      answers(anEvaluation());

      await metalookup.evaluate({ url: 'https://example.org/a' }, ['licence']);

      const { url, init } = sentRequest();
      expect(url).toBe(EVALUATION_URL);
      expect(init.method).toBe('POST');
      expect(init.headers).toMatchObject({
        Accept: 'application/json',
        'Content-Type': 'application/json',
      });
      // The header's mere presence is what an unauthenticated deployment would reject.
      expect(APP_CONFIG.metalookupApiKey).toBe('');
      expect(init.headers).not.toHaveProperty('X-API-KEY');
      expect(sentBody()).toMatchObject({ url: 'https://example.org/a', features: ['licence'] });
    });

    it('keeps the answer and reports nothing wrong', async () => {
      const evaluation = anEvaluation();
      answers(evaluation);

      const received = await metalookup.evaluate({ url: 'https://example.org/a' }, []);

      expect(received).toEqual(evaluation);
      expect(metalookup.lastEvaluation()).toEqual(evaluation);
      expect(metalookup.error()).toBeNull();
      expect(metalookup.running()).toBe(false);
    });

    it('reports being under way for as long as the request is', async () => {
      let answer: (response: Response) => void = () => undefined;
      fetchMock.mockReturnValue(new Promise<Response>((resolve) => (answer = resolve)));

      const evaluation = metalookup.evaluate({ url: 'https://example.org/a' }, []);
      expect(metalookup.running()).toBe(true);

      answer(new Response(JSON.stringify(anEvaluation()), { status: 200 }));
      await evaluation;

      expect(metalookup.running()).toBe(false);
    });

    it('names the service and the address when it cannot be reached', async () => {
      fetchMock.mockRejectedValue(new Error('Failed to fetch'));

      await expect(metalookup.evaluate({ url: 'https://example.org/a' }, [])).rejects.toThrow(
        `MetalookUp nicht erreichbar (${EVALUATION_URL}): Failed to fetch`,
      );
      expect(metalookup.error()).toContain('nicht erreichbar');
      expect(metalookup.running()).toBe(false);
    });

    it('carries the whole body of a status the answer cannot be read under', async () => {
      answers('{"detail":"feature unknown"}', 422);

      await expect(metalookup.evaluate({ url: 'https://example.org/a' }, [])).rejects.toThrow(
        'MetalookUp antwortet mit 422: {"detail":"feature unknown"}',
      );
      expect(metalookup.error()).toContain('422');
    });

    it('refuses an answer that is not a JSON object', async () => {
      answers('7');

      await expect(metalookup.evaluate({ url: 'https://example.org/a' }, [])).rejects.toThrow(
        `MetalookUp antwortet nicht mit JSON (${EVALUATION_URL})`,
      );
    });

    it('keeps the previous answer when a later evaluation fails', async () => {
      const evaluation = anEvaluation();
      answers(evaluation);
      await metalookup.evaluate({ url: 'https://example.org/a' }, []);

      fetchMock.mockRejectedValue(new Error('Failed to fetch'));
      await expect(metalookup.evaluate({ url: 'https://example.org/b' }, [])).rejects.toThrow();

      expect(metalookup.lastEvaluation()).toEqual(evaluation);
    });

    it('clears the previous failure before starting the next evaluation', async () => {
      fetchMock.mockRejectedValue(new Error('Failed to fetch'));
      await expect(metalookup.evaluate({ url: 'https://example.org/a' }, [])).rejects.toThrow();
      expect(metalookup.error()).not.toBeNull();

      let answer: (response: Response) => void = () => undefined;
      fetchMock.mockReturnValue(new Promise<Response>((resolve) => (answer = resolve)));
      const evaluation = metalookup.evaluate({ url: 'https://example.org/a' }, []);

      expect(metalookup.error()).toBeNull();

      answer(new Response(JSON.stringify(anEvaluation()), { status: 200 }));
      await evaluation;
    });

    it('reports the refusal rather than sending a request for a resource naming nothing', async () => {
      await expect(metalookup.evaluate({}, [])).rejects.toThrow(/url or a node id/);

      expect(fetchMock).not.toHaveBeenCalled();
      // Thrown before the in-flight state was entered, so nothing has to be cleared.
      expect(metalookup.running()).toBe(false);
    });

    it('gives up on an evaluation that never answers', async () => {
      vi.useFakeTimers();
      // What `fetchJson` bounds with its AbortController: a request the gateway never answers.
      fetchMock.mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(new Error('The operation was aborted.')));
          }),
      );

      const evaluation = metalookup.evaluate({ url: 'https://example.org/a' }, []);
      const settled = expect(evaluation).rejects.toThrow('MetalookUp nicht erreichbar');

      await vi.advanceTimersByTimeAsync(120_000);
      await settled;

      expect(metalookup.running()).toBe(false);
    });
  });
});
