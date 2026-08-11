import { Injectable, signal } from '@angular/core';

import { APP_CONFIG } from '../config';
import { PageData } from './browser-extension.service';
import { errorMessage } from '../util/errors';

/**
 * How long to wait for a judgement. Every scheme is its own LLM pass, and a `derived` scheme
 * orchestrates the passes of all its parts — a request of master gates is a multiple of the work a
 * single-pass one is. So: generous rather than tight.
 */
const JUDGE_TIMEOUT_MS = 300_000;

/**
 * How long to wait for the readiness answer. Short next to {@link JUDGE_TIMEOUT_MS}, and deliberately
 * so: the endpoint reads a count out of memory, so a readiness answer that hangs *is* the answer.
 */
const HEALTH_TIMEOUT_MS = 10_000;

/** The text bounds the API enforces (`EvaluationRequest.text`, min_length/max_length). */
const TEXT_MIN_LENGTH = 10;
const TEXT_MAX_LENGTH = 50_000;

/** Log prefix, as everywhere else in the extension (`[edu-sharing][<station>]`). */
const LOG = '[edu-sharing][contentjudge]';

/**
 * What ContentJudge should judge, and how it gets at it — the API's three input sources
 * (`EvaluationRequest.source`), each with the one field it requires:
 *
 * - `url` — the service crawls the page itself. For a content that *is* a web page: it then sees the
 *   whole page rather than the extract this extension could read off it.
 * - `nodeid` — the service reads metadata and text from the repository. For a content the repository
 *   holds as a file. Resolved against **ContentJudge's own** configured repository, not the panel's.
 * - `text` — the text travels with the request. The fallback for a content that is neither reachable by
 *   address nor stored as a node.
 */
export type ContentJudgeInput =
  | { source: 'url'; url: string }
  | { source: 'nodeid'; nodeId: string }
  | { source: 'text'; text: string };

/** One scheme's verdict on the content. */
export interface ContentJudgeResult {
  scheme_id: string;
  /** The scheme's kind — `ordinal_rubric`, `binary_gate`, `nominal_categorical`, `derived`, … */
  type?: string;
  /** A number, a string, a boolean or a list of them, depending on {@link ContentJudgeResult.type}. */
  value?: unknown;
  /** The value in words; a list where the scheme classifies into several categories at once. */
  label?: string | string[];
  confidence?: number;
  /** The judgement in prose, as the model justified it. Markdown, and long. */
  reasoning?: string;
}

/** ContentJudge's answer: one result per requested scheme, plus what produced them. */
export interface ContentJudgeEvaluation {
  results?: ContentJudgeResult[];
  meta?: {
    execution_time_ms?: number;
    model_used?: string;
    llm_provider?: string;
    timestamp?: string;
    text_length?: number;
    source?: string;
  };
}

/**
 * What the service says about its own readiness (`GET /health/`).
 *
 * Optional throughout, like {@link ContentJudgeEvaluation}: what the API declares is not what a client
 * may rely on having received.
 */
export interface ContentJudgeHealth {
  /** `healthy`, `degraded` or `unhealthy` — the last two when the scheme engine did not come up. */
  status?: string;
  version?: string;
  /** How many evaluation schemes the deployment has loaded, and can therefore be asked for. */
  schemes_loaded?: number;
}

/**
 * The page's text as ContentJudge should judge it, or `null` when the page has too little to judge.
 *
 * `formattedText` first, because the API takes no context of its own: `EvaluationRequest` carries a
 * text, a url or a node id and nothing besides, so whatever the judge should know has to be *in* the
 * text. That is exactly what the content script builds there (`buildFormattedText`): address, title,
 * canonical url, meta description and keywords, Open Graph, Dublin Core, LRMI, licence, publication
 * date, author, breadcrumbs, JSON-LD — and then the main content under `=== HAUPTINHALT ===`.
 *
 * Not noise in front of the prose, as long as the criteria are these: Urheberrecht is answered by the
 * licence block, Datenschutz and Aktualität by the meta data, Medial passend by the images — the
 * judgements that came back complained about missing source transparency and unclear authorship, which
 * is precisely what those blocks state. The plainer texts stay as the fallback for a page that offers
 * no such block at all.
 *
 * Cut to the length the API accepts: it rejects anything longer outright, and a judgement of the first
 * 50000 characters says more than no judgement at all.
 */
export function judgeableText(page: PageData | null): string | null {
  const text = (page?.formattedText || page?.mainContent || page?.text || '').trim();
  if (text.length < TEXT_MIN_LENGTH) return null;
  return text.length > TEXT_MAX_LENGTH ? text.slice(0, TEXT_MAX_LENGTH) : text;
}

/**
 * ContentJudge's evaluation of a content: an LLM's verdict on it per evaluation scheme
 * (`POST /evaluate/` — with the trailing slash, which is the route; without it the answer is a
 * redirect). Nothing is written anywhere; the sibling endpoint `/evaluate/suggest` would be the one
 * that does, and it is not used.
 *
 * Every judgement is preceded by `GET /health/`, for the reason given at {@link ContentJudgeService.health}.
 *
 * The request goes out from the panel document, like the metadata agent's and MetalookUp's: the
 * extension's `host_permissions` are what let this document reach a foreign origin.
 *
 * The deployment sits behind a Basic auth that guards the whole host, its own docs included, while the
 * API itself asks for nothing — so without a configured credential every call here answers `401`.
 */
@Injectable({ providedIn: 'root' })
export class ContentJudgeService {
  /** True while a judgement is in flight. */
  readonly running = signal(false);
  /** The last answer; null until one arrived. */
  readonly lastEvaluation = signal<ContentJudgeEvaluation | null>(null);
  /**
   * What the service last said about its readiness; null until it said anything. The first thing worth
   * looking at when a judgement failed — it separates "the deployment is not reachable" from "the
   * deployment answered, and rejected this request".
   */
  readonly lastHealth = signal<ContentJudgeHealth | null>(null);
  /** Why the last judgement produced no answer; null when it did. */
  readonly error = signal<string | null>(null);

  /**
   * The request as it goes out — the API's own field names, and only the ones the chosen source needs
   * (see {@link ContentJudgeInput}). Also what the caller logs.
   */
  requestBody(input: ContentJudgeInput, schemes: readonly string[]): Record<string, unknown> {
    const source = { schemes, source: input.source };
    if (input.source === 'url') {
      return { ...source, url: input.url, crawler_method: APP_CONFIG.contentJudgeCrawlerMethod };
    }
    if (input.source === 'nodeid') return { ...source, node_id: input.nodeId };
    return { ...source, text: input.text };
  }

  /**
   * Judge a content against the given schemes — what is judged and which schemes those are is the
   * caller's decision (in the panel: the content's kind and the quality criteria, see
   * QualityJudgeService and `schemesForCriteria`).
   *
   * Rejects when the service cannot be reached, answers with a status the request cannot be served
   * under, or sends something that is not a JSON object; {@link error} carries that for the view
   * either way. A service that is not there at all is found by {@link health} before the judgement
   * goes out, so it is answered in seconds instead of after the judgement's own timeout.
   */
  async evaluate(
    input: ContentJudgeInput,
    schemes: readonly string[]
  ): Promise<ContentJudgeEvaluation> {
    this.running.set(true);
    this.error.set(null);
    try {
      await this.checkReady();
      const evaluation = await this.postEvaluation(this.requestBody(input, schemes));
      this.lastEvaluation.set(evaluation);
      return evaluation;
    } catch (cause: unknown) {
      this.error.set(errorMessage(cause));
      throw cause;
    } finally {
      this.running.set(false);
    }
  }

  /**
   * Whether the service is there and ready (`GET /health/`) — its status, its version and how many
   * evaluation schemes it has loaded.
   *
   * Worth asking before a judgement because of what a judgement costs: it may be out for five minutes
   * (see {@link JUDGE_TIMEOUT_MS}), so without this every misconfiguration — a wrong
   * `contentJudgeApiUrl`, a missing `contentJudgeBasicAuth`, a deployment that is down — would surface
   * as a five-minute wait, and where the user expects a verdict on the content rather than a technical
   * fault. This answers in milliseconds and names the cause.
   *
   * Rejects for the same three reasons {@link evaluate} does — unreachable, a status the answer cannot
   * be read under, no JSON object.
   */
  async health(): Promise<ContentJudgeHealth> {
    const url = `${APP_CONFIG.contentJudgeApiUrl}/health/`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          ...(APP_CONFIG.contentJudgeBasicAuth
            ? { Authorization: `Basic ${btoa(APP_CONFIG.contentJudgeBasicAuth)}` }
            : {}),
        },
        signal: controller.signal,
      });
    } catch (cause: unknown) {
      // Naming the address: what fails here is usually the configured base, and the message is all the
      // view gets to show.
      throw new Error(`ContentJudge nicht erreichbar (${url}): ${errorMessage(cause)}`);
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      // The whole body, for the reason the evaluation's own error path states: the answer to expect
      // here is the guard's `401` page, which says *in* the body what is missing.
      const detail = await response.text().catch(() => '');
      throw new Error(`ContentJudge nicht bereit: ${response.status} - ${detail}`);
    }
    const health = (await response.json().catch(() => null)) as ContentJudgeHealth | null;
    if (!health || typeof health !== 'object') {
      throw new Error('health: invalid API response');
    }
    this.lastHealth.set(health);
    return health;
  }

  /**
   * The readiness check as a judgement's preflight: it stops one that has nowhere to go, and lets one
   * through that merely might not fully succeed.
   *
   * A `degraded` deployment, or one with no schemes loaded, is logged and nothing more. It can still
   * hold the schemes this request asks for, and where it does not, the answer is a `400 Unknown
   * schemes: […]` naming them — which says more than a refusal decided here would.
   */
  private async checkReady(): Promise<void> {
    const health = await this.health();
    const loaded = health.schemes_loaded ?? 0;
    if (health.status !== 'healthy' || !loaded) {
      console.warn(`${LOG} health`, health.status, `— ${loaded} Schemata geladen`);
      return;
    }
    console.log(`${LOG} health`, health.status, health.version, `— ${loaded} Schemata geladen`);
  }

  private async postEvaluation(body: Record<string, unknown>): Promise<ContentJudgeEvaluation> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), JUDGE_TIMEOUT_MS);
    try {
      const response = await fetch(`${APP_CONFIG.contentJudgeApiUrl}/evaluate/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(APP_CONFIG.contentJudgeBasicAuth
            ? { Authorization: `Basic ${btoa(APP_CONFIG.contentJudgeBasicAuth)}` }
            : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        // The whole body, not a prefix of it: the two answers to expect here say what is wrong *in*
        // it — the guard's `401` page, and `400 Unknown schemes: […]` naming the schemes the
        // deployment does not have.
        const detail = await response.text().catch(() => '');
        throw new Error(`evaluation failed: ${response.status} - ${detail}`);
      }
      const evaluation = (await response.json().catch(() => null)) as ContentJudgeEvaluation | null;
      if (!evaluation || typeof evaluation !== 'object') {
        throw new Error('evaluation: invalid API response');
      }
      return evaluation;
    } finally {
      clearTimeout(timer);
    }
  }
}
