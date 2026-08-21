import { Injectable, computed, inject, signal } from '@angular/core';

import { APP_CONFIG } from '../config';
import { BrowserExtensionService, PageData } from './browser-extension.service';
import { DevModeService } from './dev-mode.service';
import { CONTENT_JUDGE_HEALTH, contentJudgeEvaluateRejection } from '../util/dev-fixtures';
import { errorMessage } from '../util/errors';
import { fetchJson } from '../util/json-api';

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
 * What ContentJudge should judge, and how it gets at it — the API's three input sources, each with the
 * one field it requires: `url` lets the service crawl the page itself, `nodeid` has it read the node from
 * *its own* configured repository, and `text` carries the text along for a content that is neither.
 */
export type ContentJudgeInput =
  | { source: 'url'; url: string }
  | { source: 'nodeid'; nodeId: string }
  | { source: 'text'; text: string };

/**
 * The kinds of evaluation scheme, by the `type` a result reports (`ScaleType` in the API's schemas).
 * Widened by `string`, because the set is the deployment's and not this client's: an unknown kind is a
 * scheme this version has not heard of, which is nothing to break over.
 */
export type ContentJudgeScaleType =
  | 'ordinal_rubric'
  | 'checklist_additive'
  | 'binary_gate'
  | 'nominal_categorical'
  | 'derived'
  | (string & {});

/**
 * What a scheme answers with. Which of these it is follows from its kind: a rubric answers a number, a
 * gate 0 or 1, a categorical one the name of a category — and a `derived` scheme that collects (its
 * `method: collect`) answers with the *list* of what its parts found, which is why the lists are here.
 */
export type ContentJudgeValue =
  | number
  | string
  | boolean
  | readonly (number | string | boolean)[]
  | null;

/** One part check of a scheme, as the result carries it (`checks`). */
export interface ContentJudgeCheck {
  /** The rule's own id, or the key it sits under where it has none. */
  id: string;
  /** The rule in words. Empty where the scheme states none. */
  title: string;
  /** `WARN` only from a `checklist_additive` scheme, whose checks score rather than pass or fail. */
  status: 'PASS' | 'FAIL' | 'WARN';
  reasoning: string;
  /** The check's normalised score, on the schemes that score their checks. */
  score?: number;
}

/** One scheme a `derived` scheme aggregated, as its result carries it (`dependencies`). */
export interface ContentJudgeDependency {
  scheme_id: string;
  value: ContentJudgeValue;
  label: string | string[] | null;
  passed: boolean;
}

/**
 * One scheme's verdict on the content. The fields after `checks` are each written by one kind of scheme
 * only — the shape follows `type`, and asking for the wrong one yields `undefined`.
 */
export interface ContentJudgeResult {
  scheme_id: string;
  /** The scheme's kind, as its definition declares it; `unknown` for one the deployment cannot place. */
  type: ContentJudgeScaleType;
  /** The quality dimension the scheme belongs to (`neutrality`, `legal`, …); `unknown` where it has none. */
  dimension: string;
  value: ContentJudgeValue;
  /** The value in words; a list where the scheme collects several categories at once. */
  label: string | string[] | null;
  /** The judgement in prose, as the model justified it. Markdown, and long. */
  reasoning: string | null;
  confidence: number | null;
  /** The scheme's part checks; empty for the kinds that have none (a rubric, a categorical one). */
  checks: ContentJudgeCheck[];
  /**
   * Why this scheme answered nothing. Present only where that happened — and where it begins with
   * `LLM_ERROR`, the model call itself failed, which is a judgement missing rather than a content
   * judged. {@link ContentJudgeMeta.llm_errors} counts those.
   */
  na_reason?: string;
  /** The scale the value is on ("0-5"), from a `checklist_additive` scheme. */
  scale_range?: string;
  /** The rubric's levels, from an `ordinal_rubric` scheme. */
  levels?: unknown[];
  /** The categories to choose from, from a `nominal_categorical` scheme. */
  categories?: unknown[];
  /** The schemes aggregated, from a `derived` scheme. */
  dependencies?: ContentJudgeDependency[];
}

/**
 * One failed check worth naming, across all schemes — sorted by severity, and deduplicated by rule.
 * `null` where there is nothing to report, and also for a request of nothing but `derived` schemes,
 * whose results carry their parts already.
 */
export interface ContentJudgeFinding {
  rule_id: string;
  /** The area the rule belongs to — its gate, or the dimension of the scheme that holds it. */
  category: string;
  /** The scheme the rule came from, by id. */
  scheme: string;
  /** The rule in words. */
  title: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | (string & {});
  /** The paragraph the rule rests on, where it rests on one. */
  legal_basis: string | null;
}

/**
 * The answer in one line, shaped by what was asked: `compliance` for a request involving gates,
 * `score` for a single scoring scheme, `mixed` for anything else — and for a single classifying scheme,
 * the scheme's own kind. Which fields are set follows from that, so all but `type` are optional.
 */
export interface ContentJudgeSummary {
  type: 'compliance' | 'score' | 'mixed' | ContentJudgeScaleType;
  /** The compliance verdict: rejected on a critical violation, review on a serious one. */
  status?: 'PASS' | 'FAIL' | 'REVIEW' | 'REJECTED';
  /** The verdict in words, German — ready to show. */
  label?: string | string[] | null;
  /** A classifying scheme's answer: its label, or its value where it has no label. */
  result?: ContentJudgeValue;
  /** A scoring scheme's number. */
  value?: ContentJudgeValue;
  dimension?: string;
  confidence?: number | null;
  /** How many checks passed, already written out as `"7/9"`; `null` where nothing was checked. */
  checks?: string | null;
  schemes_count?: number;
  /** How many findings there are, on a verdict of `REVIEW` or `REJECTED`. */
  violations?: number;
}

/** What produced the answer. */
export interface ContentJudgeMeta {
  /** The schemes the request named — all of them, including any that answered nothing. */
  schemes_evaluated: string[];
  execution_time_ms: number;
  model_used?: string;
  llm_provider?: string;
  /** When the evaluation started, ISO 8601. */
  timestamp?: string;
  text_length?: number;
  source?: 'text' | 'url' | 'nodeid';
  /**
   * How many schemes failed in their model call rather than answering. Present only when at least one
   * did — its absence is the normal case, and its presence means the answer is incomplete even though
   * the request succeeded.
   */
  llm_errors?: number;
  /** The node the content was read from, where it was read from one. */
  node_id?: string;
  /** The address the content was fetched from, where it was fetched. */
  url?: string;
  /** The metadata the repository holds on the content, for a judgement by node id. */
  content_metadata?: Record<string, unknown>;
}

/**
 * ContentJudge's answer — the flat, view-facing shape its engine builds. Typed after that builder rather
 * than after the declared `EvaluationResponse`: the endpoint is annotated `Dict[str, Any]` and returns the
 * builder's dict, so the declared model names fields no answer carries and omits ones every answer does.
 */
export interface ContentJudgeEvaluation {
  summary: ContentJudgeSummary;
  findings: ContentJudgeFinding[] | null;
  /** One result per scheme that could be evaluated, in the order the request named them. */
  results: ContentJudgeResult[];
  meta: ContentJudgeMeta;
}

/** What the service says about its own readiness (`GET /health/`, `HealthResponse`). */
export interface ContentJudgeHealth {
  /** `degraded` where the scheme engine did not come up; the endpoint reports no other failure itself. */
  status: 'healthy' | 'degraded' | 'unhealthy' | (string & {});
  version: string;
  /** How many evaluation schemes the deployment has loaded, and can therefore be asked for. */
  schemes_loaded: number;
}

/**
 * The page's text as ContentJudge should judge it, or null when the page has too little to judge. The
 * formatted text comes first, since the API takes no context of its own: whatever the judge should know has
 * to be in the text. Cut to the length the API accepts, which rejects anything longer outright.
 */
export function judgeableText(page: PageData | null): string | null {
  const text = (page?.formattedText || page?.mainContent || page?.text || '').trim();
  if (text.length < TEXT_MIN_LENGTH) return null;
  return text.length > TEXT_MAX_LENGTH ? text.slice(0, TEXT_MAX_LENGTH) : text;
}

/**
 * A stored credential as the `Basic` scheme carries it: the base64 of `user:password`. What is stored may
 * already be that token — that is what one copies out of a working request — and is then passed through
 * rather than encoded twice; a `Basic ` in front of it is a paste of the whole header value. Empty for a
 * credential that is not one, so no header is sent at all.
 *
 * Encoded over the credential's UTF-8 bytes, since `btoa` alone rejects every character outside Latin-1 —
 * a password with an umlaut would otherwise not fail the request but throw before it is even sent.
 */
function basicCredential(stored: string): string {
  const credential = stored.trim().replace(/^Basic\s+/i, '').trim();
  // Nothing, or nothing but the scheme's own name, is no credential.
  if (!credential || /^Basic$/i.test(credential)) return '';
  // Only `user:password` holds a colon — the base64 alphabet has none, so this tells the two apart.
  if (!credential.includes(':')) return credential;
  const bytes = new TextEncoder().encode(credential);
  return btoa(String.fromCharCode(...bytes));
}

/**
 * ContentJudge's evaluation of a content: an LLM's verdict per evaluation scheme (`POST /evaluate/` — the
 * trailing slash is the route). Nothing is written anywhere, every judgement is preceded by `GET /health/`,
 * and the deployment's Basic auth guards the whole host.
 */
@Injectable({ providedIn: 'root' })
export class ContentJudgeService {
  private readonly devMode = inject(DevModeService);
  private readonly browserExtension = inject(BrowserExtensionService);

  private readonly basicAuthState = signal(APP_CONFIG.contentJudgeBasicAuth);

  /** The `user:password` the guard is answered with, as the settings hold it. Persisted. */
  readonly basicAuth = this.basicAuthState.asReadonly();

  /**
   * Whether a credential is on hand at all. The judgement is not offered without one: the guard sits in
   * front of the whole host, so an unauthenticated request cannot reach the service to begin with.
   */
  readonly credentialSet = computed(() => !!basicCredential(this.basicAuth()));

  /**
   * Whether the credential stands away from the checked-in one — see ChatStyleService.changedSettings for
   * what the settings do with it. A credential is the one setting here that is typed rather than switched,
   * so what counts is that it was typed at all, not what it says.
   */
  readonly changedSettings = computed(() =>
    this.basicAuth() === APP_CONFIG.contentJudgeBasicAuth ? 0 : 1,
  );

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
   * Load the stored credential. Awaited before anything is judged (see QualityJudgeService.load), since
   * whether one exists decides whether the judgement runs at all.
   */
  async loadCredential(): Promise<void> {
    this.basicAuthState.set(
      await this.browserExtension.storageGet(
        APP_CONFIG.storageKeys.contentJudgeBasicAuth,
        APP_CONFIG.contentJudgeBasicAuth
      )
    );
  }

  /** Keep the credential, as `user:password`. Emptying it takes the judgement out of service again. */
  async setBasicAuth(credential: string): Promise<void> {
    const trimmed = credential.trim();
    this.basicAuthState.set(trimmed);
    await this.browserExtension.storageSet(APP_CONFIG.storageKeys.contentJudgeBasicAuth, trimmed);
  }

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
   * Judge a content against the given schemes; what is judged and which those are is the caller's decision.
   * Rejects when the service cannot be reached, answers with an unusable status or sends no JSON object;
   * {@link error} carries that for the view.
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
   * Whether the service is there and ready: status, version and how many schemes are loaded. Asked before
   * every judgement, because one may be out for minutes — a misconfiguration would otherwise surface as a
   * long wait where the user expects a verdict.
   */
  async health(): Promise<ContentJudgeHealth> {
    const health = this.devMode.enabled()
      ? await this.devMode.answer('ContentJudge GET /health/', CONTENT_JUDGE_HEALTH)
      : await fetchJson<ContentJudgeHealth>({
          service: 'ContentJudge',
          url: `${APP_CONFIG.contentJudgeApiUrl}/health/`,
          headers: this.authHeader(),
          // The header is the whole of this request's authentication — see postEvaluation.
          credentials: 'omit',
          timeoutMs: HEALTH_TIMEOUT_MS,
        });
    this.lastHealth.set(health);
    return health;
  }

  /**
   * The readiness check as a judgement's preflight: it stops one that has nowhere to go and lets through
   * one that merely might not fully succeed. A `degraded` deployment is logged and no more — where it
   * lacks the schemes asked for, the answer names them, which says more than a refusal decided here.
   */
  private async checkReady(): Promise<void> {
    const health = await this.health();
    const loaded = health.schemes_loaded ?? 0;
    const log = health.status === 'healthy' && loaded ? console.log : console.warn;
    log(`${LOG} health`, health.status, health.version, `— ${loaded} Schemata geladen`);
  }

  /**
   * The Basic auth the deployment's guard demands, from the credential the settings hold. Left off
   * altogether where there is none: an absent header is what makes the demand visible, as the guard's `401`.
   */
  private authHeader(): Record<string, string> {
    const credential = basicCredential(this.basicAuth());
    if (!credential) return {};
    return { Authorization: `Basic ${credential}` };
  }

  private postEvaluation(body: Record<string, unknown>): Promise<ContentJudgeEvaluation> {
    if (this.devMode.enabled()) {
      return this.devMode.fail('ContentJudge POST /evaluate/', contentJudgeEvaluateRejection());
    }
    return fetchJson<ContentJudgeEvaluation>({
      service: 'ContentJudge',
      url: `${APP_CONFIG.contentJudgeApiUrl}/evaluate/`,
      method: 'POST',
      headers: this.authHeader(),
      /*
       * The configured credential is the only one this request carries, and deliberately: with any other
       * credentials mode the browser answers the guard's `401` itself, by asking the user for a user and
       * password in a dialog of its own — over a panel where that question makes no sense, and with the
       * rejection never reaching the code that could report it. `omit` leaves the whole exchange to the
       * header above, so a wrong credential comes back as this service's own error message.
       */
      credentials: 'omit',
      body,
      timeoutMs: JUDGE_TIMEOUT_MS,
    });
  }
}
