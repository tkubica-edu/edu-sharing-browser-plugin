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

/** The text bounds the API enforces (`EvaluationRequest.text`, min_length/max_length). */
const TEXT_MIN_LENGTH = 10;
const TEXT_MAX_LENGTH = 50_000;

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
   * either way.
   */
  async evaluate(
    input: ContentJudgeInput,
    schemes: readonly string[]
  ): Promise<ContentJudgeEvaluation> {
    this.running.set(true);
    this.error.set(null);
    try {
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
