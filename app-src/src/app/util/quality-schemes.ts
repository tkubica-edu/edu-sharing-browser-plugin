// The way between the quality criteria and ContentJudge, in both directions: which schemes a set of
// criteria is judged by, and what the schemes' answers say about each of them. The map itself is
// configuration (APP_CONFIG.qualityCriterionSchemes) — what is here is the reading of it, so the rule
// has one place and the view that asks stays free of it.

import { APP_CONFIG, CriterionScheme } from '../config';
// Type-only, so this leaf utility does not pull the service (and Angular with it) into the bundle.
import type { ContentJudgeEvaluation, ContentJudgeResult } from '../services/content-judge.service';

/**
 * How many schemes one request may name (`EvaluationRequest.schemes`, max_length 10). Every scheme is
 * an LLM pass of its own, so the limit is the service's own protection rather than a formality.
 */
const MAX_SCHEMES = 10;

/** What a set of criteria amounts to as a ContentJudge request — see {@link schemesForCriteria}. */
export interface CriteriaSchemes {
  /** The schemes to ask for: deduplicated, in the order the criteria came in. */
  schemes: string[];
  /** Criteria the map holds no scheme for. They are judged by nobody, which is worth saying. */
  unmapped: string[];
  /** Schemes the limit cut off; empty while everything fits. */
  dropped: string[];
}

/** What a scheme answered about one criterion — see {@link judgementsForCriteria}. */
export interface CriterionJudgement {
  /** The criterion, by the id the metadata set gives it. */
  criterion: string;
  /** The scheme that judged it. */
  scheme: string;
  /** The scheme's number, `null` when it answered nothing that can be read as one. */
  value: number | null;
  /** The number in the scheme's own words ("FSK 0 …", "Befriedigend"); `null` when it gave none. */
  label: string | null;
  /** How sure the scheme is of its answer, as it reports it. */
  confidence: number | null;
  /**
   * Why the scheme answered that way, in its own words. Long, and Markdown — a derived scheme
   * summarises every part check it aggregated. `null` when it gave no reasoning.
   */
  reasoning: string | null;
  /**
   * Whether the criterion counts as met by that number — `null` while there is no number to compare,
   * which is not the same as "not met".
   */
  met: boolean | null;
}

/**
 * The schemes that judge these criteria.
 *
 * Deduplicated, because two criteria can point at the same scheme — a gate that covers both areas is
 * asked once, not twice. Cut to {@link MAX_SCHEMES}, and what was cut is reported rather than dropped
 * silently: a request that quietly judges less than it was asked to looks like a complete answer.
 */
export function schemesForCriteria(criterionIds: readonly string[]): CriteriaSchemes {
  const schemes: string[] = [];
  const unmapped: string[] = [];
  for (const criterion of criterionIds) {
    const mapped = APP_CONFIG.qualityCriterionSchemes[criterion];
    if (!mapped) {
      unmapped.push(criterion);
      continue;
    }
    if (!schemes.includes(mapped.scheme)) schemes.push(mapped.scheme);
  }
  return {
    schemes: schemes.slice(0, MAX_SCHEMES),
    unmapped,
    dropped: schemes.slice(MAX_SCHEMES)
  };
}

/**
 * What the evaluation says about each criterion, keyed by criterion id.
 *
 * Driven by the criteria rather than by the answer, because that is the direction the view reads in:
 * every criterion that has a scheme *and* an answer for it gets a judgement, the rest get none. A
 * scheme answering for two criteria judges both — the map, not the answer, decides what a result is
 * about.
 */
export function judgementsForCriteria(
  criterionIds: readonly string[],
  evaluation: ContentJudgeEvaluation | null
): Record<string, CriterionJudgement> {
  const results = new Map((evaluation?.results ?? []).map((result) => [result.scheme_id, result]));
  const judgements: Record<string, CriterionJudgement> = {};
  for (const criterion of criterionIds) {
    const mapped = APP_CONFIG.qualityCriterionSchemes[criterion];
    const result = mapped ? results.get(mapped.scheme) : undefined;
    if (!mapped || !result) continue;
    judgements[criterion] = toJudgement(criterion, mapped, result);
  }
  return judgements;
}

function toJudgement(
  criterion: string,
  mapped: CriterionScheme,
  result: ContentJudgeResult
): CriterionJudgement {
  const value = asNumber(result.value);
  return {
    criterion,
    scheme: mapped.scheme,
    value,
    label: asLabel(result.label),
    confidence: asNumber(result.confidence),
    reasoning: result.reasoning?.trim() || null,
    met: value === null ? null : meets(value, mapped)
  };
}

/** Whether a number answers its criterion — which way round that is, is the scheme's own scale. */
function meets(value: number, mapped: CriterionScheme): boolean {
  return mapped.met === 'atMost' ? value <= mapped.threshold : value >= mapped.threshold;
}

/**
 * A scheme's value as a number. Typed as `unknown` on purpose (a scheme's value follows its scale, and
 * a `nominal_categorical` one answers with names), so anything that is not a finite number is no
 * number here — including the numeric *strings* a scheme may report.
 */
function asNumber(value: unknown): number | null {
  const number = typeof value === 'string' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) ? number : null;
}

/** A scheme's label; the ones that classify into several categories answer with a list. */
function asLabel(label: string | string[] | undefined): string | null {
  const labels = Array.isArray(label) ? label : [label];
  const first = labels.find((entry) => !!entry?.trim());
  return first?.trim() ?? null;
}
