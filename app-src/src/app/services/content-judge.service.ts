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
 * The plainest text wins, opposite to what the background worker prefers for the metadata agent
 * (`buildGenerateBody`): the agent wants `formattedText`, because the metadata blocks it prepends (Open
 * Graph, JSON-LD, breadcrumbs) are what it extracts metadata *from*. A judgement about factual accuracy
 * or neutrality is about the prose instead, and those blocks would only be noise in front of it.
 *
 * Cut to the length the API accepts: it rejects anything longer outright, and a judgement of the first
 * 50000 characters says more than no judgement at all.
 */
export function judgeableText(page: PageData | null): string | null {
  const text = (page?.mainContent || page?.formattedText || page?.text || '').trim();
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

  /** The request as it goes out, for the caller to log — see {@link evaluate}. */
  requestBody(text: string, schemes: readonly string[]): Record<string, unknown> {
    return { source: 'text', text, schemes };
  }

  /**
   * Judge a text against the given schemes — which they are is the caller's decision (in the panel
   * they follow from the quality criteria, see `schemesForCriteria`).
   *
   * Rejects when the service cannot be reached, answers with a status the request cannot be served
   * under, or sends something that is not a JSON object; {@link error} carries that for the view
   * either way.
   */
  async evaluate(text: string, schemes: readonly string[]): Promise<ContentJudgeEvaluation> {
    this.running.set(true);
    this.error.set(null);
    try {
      const evaluation = await this.postEvaluation(this.requestBody(text, schemes));
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
