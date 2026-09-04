import { TestBed } from '@angular/core/testing';
import { Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_CONFIG } from '../config';
import { CONTENT_JUDGE_HEALTH } from '../util/dev-fixtures';
import {
  BrowserExtensionFake,
  DevModeFake,
  fakeBrowserExtension,
  fakeDevMode,
} from '../../testing/fakes';
import { provideFake } from '../../testing/provide-fake';
import { BrowserExtensionService, PageData } from './browser-extension.service';
import {
  ContentJudgeEvaluation,
  ContentJudgeService,
  judgeableText,
} from './content-judge.service';
import { DevModeService } from './dev-mode.service';

/** The two addresses the service asks, spelled out so a moved route shows up as a failure. */
const HEALTH_URL = `${APP_CONFIG.contentJudgeApiUrl}/health/`;
const EVALUATE_URL = `${APP_CONFIG.contentJudgeApiUrl}/evaluate/`;

/** An answer as the deployment makes it. */
function anEvaluation(): ContentJudgeEvaluation {
  return {
    summary: {},
    findings: null,
    results: [{ scheme_id: 'neutralitaet', value: 4 }],
    meta: {},
  } as unknown as ContentJudgeEvaluation;
}

describe('ContentJudgeService', () => {
  let judge: ContentJudgeService;
  let extension: BrowserExtensionFake;
  let devMode: DevModeFake;
  let fetchMock: Mock;

  beforeEach(() => {
    extension = fakeBrowserExtension();
    devMode = fakeDevMode();
    TestBed.configureTestingModule({
      providers: [
        provideFake(BrowserExtensionService, extension.fake),
        provideFake(DevModeService, devMode.fake),
      ],
    });
    judge = TestBed.inject(ContentJudgeService);
    // Stubbed over the guard from `no-network.setup.ts`, which runs first: this service's own `fetch`
    // is what is under test, so it needs an answer rather than a refusal.
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => vi.useRealTimers());

  /**
   * The deployment answers `body` under `status` for every request. A fresh `Response` per call: a body
   * can be read only once, so a shared one would answer the second request with nothing.
   */
  function answers(body: unknown, status = 200): void {
    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })),
    );
  }

  /** It answers the readiness check with `health` and the judgement with `evaluation`. */
  function answersBoth(health: unknown, evaluation: unknown, evaluationStatus = 200): void {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        url === HEALTH_URL
          ? new Response(JSON.stringify(health))
          : new Response(JSON.stringify(evaluation), { status: evaluationStatus }),
      ),
    );
  }

  /** What the request to `url` was made with. */
  function requestTo(url: string): RequestInit {
    return fetchMock.mock.calls.find((call) => call[0] === url)![1] as RequestInit;
  }

  describe('the credential', () => {
    it('starts at the checked-in one, and reports the judgement as out of service without one', () => {
      expect(judge.basicAuth()).toBe(APP_CONFIG.contentJudgeBasicAuth);
      expect(judge.credentialSet()).toBe(false);
    });

    it('is on hand once one is set', async () => {
      await judge.setBasicAuth('  benutzer:geheim  ');
      expect(judge.basicAuth()).toBe('benutzer:geheim');
      expect(judge.credentialSet()).toBe(true);
    });

    it('is kept, so the next session finds it', async () => {
      await judge.setBasicAuth('benutzer:geheim');
      expect(extension.fake.storageSet).toHaveBeenCalledWith(
        APP_CONFIG.storageKeys.contentJudgeBasicAuth,
        'benutzer:geheim',
      );

      const next = TestBed.inject(ContentJudgeService);
      await next.loadCredential();
      expect(next.basicAuth()).toBe('benutzer:geheim');
    });

    it('takes the judgement out of service again when it is emptied', async () => {
      await judge.setBasicAuth('benutzer:geheim');
      await judge.setBasicAuth('   ');
      expect(judge.credentialSet()).toBe(false);
    });

    it('counts as a changed setting once it has been typed at all', async () => {
      expect(judge.changedSettings()).toBe(0);
      await judge.setBasicAuth('benutzer:geheim');
      expect(judge.changedSettings()).toBe(1);
    });
  });

  describe('the Basic header', () => {
    it('encodes a user and password, over their UTF-8 bytes', async () => {
      await judge.setBasicAuth('benutzer:geheim');
      answers(CONTENT_JUDGE_HEALTH);

      await judge.health();

      expect((requestTo(HEALTH_URL).headers as Record<string, string>)['Authorization']).toBe(
        `Basic ${btoa('benutzer:geheim')}`,
      );
    });

    it('encodes a password with an umlaut instead of throwing before the request is sent', async () => {
      await judge.setBasicAuth('benutzer:grüß');
      answers(CONTENT_JUDGE_HEALTH);

      await expect(judge.health()).resolves.toBeDefined();
      expect((requestTo(HEALTH_URL).headers as Record<string, string>)['Authorization']).toMatch(
        /^Basic /,
      );
    });

    it('passes a stored token through rather than encoding it twice', async () => {
      const token = btoa('benutzer:geheim');
      await judge.setBasicAuth(token);
      answers(CONTENT_JUDGE_HEALTH);

      await judge.health();

      expect((requestTo(HEALTH_URL).headers as Record<string, string>)['Authorization']).toBe(
        `Basic ${token}`,
      );
    });

    it('takes a whole pasted header value as the token it carries', async () => {
      const token = btoa('benutzer:geheim');
      await judge.setBasicAuth(`Basic ${token}`);
      answers(CONTENT_JUDGE_HEALTH);

      await judge.health();

      expect((requestTo(HEALTH_URL).headers as Record<string, string>)['Authorization']).toBe(
        `Basic ${token}`,
      );
    });

    it('sends no header at all where there is no credential, so the guard\'s 401 is what says so', async () => {
      answers(CONTENT_JUDGE_HEALTH);
      await judge.health();
      expect(requestTo(HEALTH_URL).headers).not.toHaveProperty('Authorization');

      await judge.setBasicAuth('Basic');
      await judge.health();
      expect(requestTo(HEALTH_URL).headers).not.toHaveProperty('Authorization');
    });

    it('leaves the browser out of the exchange, so a 401 never opens its own dialog', async () => {
      answersBoth(CONTENT_JUDGE_HEALTH, anEvaluation());
      await judge.evaluate({ source: 'text', text: 'Der Artikel selbst.' }, ['neutralitaet']);

      expect(requestTo(HEALTH_URL).credentials).toBe('omit');
      expect(requestTo(EVALUATE_URL).credentials).toBe('omit');
    });
  });

  describe('requestBody', () => {
    it('lets the service crawl the page itself, by the configured method', () => {
      expect(judge.requestBody({ source: 'url', url: 'https://example.org/optik' }, ['a'])).toEqual({
        schemes: ['a'],
        source: 'url',
        url: 'https://example.org/optik',
        crawler_method: APP_CONFIG.contentJudgeCrawlerMethod,
      });
    });

    it('names the node for a content the service reads from its own repository', () => {
      expect(judge.requestBody({ source: 'nodeid', nodeId: 'n1' }, ['a'])).toEqual({
        schemes: ['a'],
        source: 'nodeid',
        node_id: 'n1',
      });
    });

    it('carries the text along for a content that is neither', () => {
      expect(judge.requestBody({ source: 'text', text: 'Der Artikel.' }, ['a'])).toEqual({
        schemes: ['a'],
        source: 'text',
        text: 'Der Artikel.',
      });
    });

    it('states only the field the chosen source needs', () => {
      const body = judge.requestBody({ source: 'text', text: 'Der Artikel.' }, ['a']);
      expect(body).not.toHaveProperty('url');
      expect(body).not.toHaveProperty('node_id');
    });
  });

  describe('health', () => {
    it('reports what the deployment says about itself, and keeps it', async () => {
      answers({ status: 'healthy', version: '0.1.0', schemes_loaded: 198 });

      await expect(judge.health()).resolves.toMatchObject({ schemes_loaded: 198 });
      expect(judge.lastHealth()).toMatchObject({ status: 'healthy' });
    });

    it('answers from the fixture while the KI answers are faked, without asking anything', async () => {
      devMode.fake.enabled.set(true);

      await expect(judge.health()).resolves.toEqual(CONTENT_JUDGE_HEALTH);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(devMode.faked).toEqual(['ContentJudge GET /health/']);
    });
  });

  describe('evaluate', () => {
    it('asks the deployment whether it is ready before it asks for a judgement', async () => {
      answersBoth(CONTENT_JUDGE_HEALTH, anEvaluation());

      await judge.evaluate({ source: 'text', text: 'Der Artikel.' }, ['neutralitaet']);

      expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([HEALTH_URL, EVALUATE_URL]);
    });

    it('sends the request body it composed, as JSON', async () => {
      answersBoth(CONTENT_JUDGE_HEALTH, anEvaluation());

      await judge.evaluate({ source: 'nodeid', nodeId: 'n1' }, ['neutralitaet']);

      expect(JSON.parse(requestTo(EVALUATE_URL).body as string)).toEqual({
        schemes: ['neutralitaet'],
        source: 'nodeid',
        node_id: 'n1',
      });
      expect(requestTo(EVALUATE_URL).method).toBe('POST');
    });

    it('answers with the verdict, and keeps it', async () => {
      answersBoth(CONTENT_JUDGE_HEALTH, anEvaluation());

      const evaluation = await judge.evaluate({ source: 'text', text: 'Der Artikel.' }, ['a']);

      expect(evaluation.results[0].scheme_id).toBe('neutralitaet');
      expect(judge.lastEvaluation()).toBe(evaluation);
      expect(judge.error()).toBeNull();
    });

    it('lets a degraded deployment through — its answer names what it lacks', async () => {
      answersBoth({ status: 'degraded', version: '0.1.0', schemes_loaded: 0 }, anEvaluation());

      await expect(judge.evaluate({ source: 'text', text: 'Der Artikel.' }, ['a'])).resolves.toBeDefined();
    });

    it('never asks for a judgement where the deployment could not be reached at all', async () => {
      fetchMock.mockRejectedValue(new Error('Failed to fetch'));

      await expect(judge.evaluate({ source: 'text', text: 'Der Artikel.' }, ['a'])).rejects.toThrow(
        'ContentJudge nicht erreichbar',
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('reports why a judgement produced no answer, and rethrows for the caller', async () => {
      answersBoth(CONTENT_JUDGE_HEALTH, { detail: 'zu lang' }, 422);

      await expect(judge.evaluate({ source: 'text', text: 'Der Artikel.' }, ['a'])).rejects.toThrow(
        'ContentJudge antwortet mit 422',
      );
      expect(judge.error()).toContain('ContentJudge antwortet mit 422');
      expect(judge.lastEvaluation()).toBeNull();
    });

    it('says it is running while it is, and stops saying so however it ends', async () => {
      answersBoth(CONTENT_JUDGE_HEALTH, anEvaluation());
      const pending = judge.evaluate({ source: 'text', text: 'Der Artikel.' }, ['a']);
      expect(judge.running()).toBe(true);
      await pending;
      expect(judge.running()).toBe(false);

      fetchMock.mockRejectedValue(new Error('Failed to fetch'));
      await judge.evaluate({ source: 'text', text: 'Der Artikel.' }, ['a']).catch(() => undefined);
      expect(judge.running()).toBe(false);
    });

    it('clears the previous failure when a new judgement starts', async () => {
      fetchMock.mockRejectedValue(new Error('Failed to fetch'));
      await judge.evaluate({ source: 'text', text: 'Der Artikel.' }, ['a']).catch(() => undefined);
      expect(judge.error()).not.toBeNull();

      answersBoth(CONTENT_JUDGE_HEALTH, anEvaluation());
      await judge.evaluate({ source: 'text', text: 'Der Artikel.' }, ['a']);
      expect(judge.error()).toBeNull();
    });

    it('fails the way the real endpoint does while the KI answers are faked, without asking anything', async () => {
      devMode.fake.enabled.set(true);

      await expect(judge.evaluate({ source: 'text', text: 'Der Artikel.' }, ['a'])).rejects.toThrow(
        'ContentJudge antwortet mit 422',
      );
      expect(fetchMock).not.toHaveBeenCalled();
      expect(devMode.faked).toEqual(['ContentJudge GET /health/', 'ContentJudge POST /evaluate/']);
    });
  });
});

describe('judgeableText', () => {
  /** A page as the content script reports it. */
  function aPage(overrides: Partial<PageData> = {}): PageData {
    return {
      url: 'https://example.org/optik',
      title: 'Optik',
      formattedText: 'Titel: Optik\n\nDer Artikel selbst.',
      mainContent: 'Der Artikel selbst.',
      ...overrides,
    } as PageData;
  }

  it('takes the formatted text, since the API is given no context of its own', () => {
    expect(judgeableText(aPage())).toBe('Titel: Optik\n\nDer Artikel selbst.');
  });

  it('falls back through what else the page reports', () => {
    expect(judgeableText(aPage({ formattedText: '' }))).toBe('Der Artikel selbst.');
    expect(
      judgeableText(aPage({ formattedText: '', mainContent: '', text: 'Nur der Rohtext.' } as PageData)),
    ).toBe('Nur der Rohtext.');
  });

  it('answers nothing for a page with too little on it to judge', () => {
    expect(judgeableText(aPage({ formattedText: 'kurz', mainContent: '', text: '' } as PageData))).toBeNull();
    expect(judgeableText(null)).toBeNull();
  });

  it('cuts a page the API would refuse outright', () => {
    const long = 'x'.repeat(50_001);
    expect(judgeableText(aPage({ formattedText: long }))).toHaveLength(50_000);
  });
});
