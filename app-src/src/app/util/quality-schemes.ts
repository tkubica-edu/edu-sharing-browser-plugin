// The way between the quality criteria and the two judges: which ContentJudge schemes a set of criteria
// is judged by, and what either judge's answer says about each of them. The maps themselves are
// configuration (APP_CONFIG.qualityCriterionSchemes / .qualityMetalookupRules) — what is here is the
// reading of them, so the rule has one place and the view that asks stays free of it.

import type { MdsValue } from 'ngx-edu-sharing-api';

import { APP_CONFIG, CriterionScheme, MetalookupRule, SchemeDirection } from '../config';
// Type-only, so this leaf utility does not pull the services (and Angular with them) into the bundle.
import type { ContentJudgeEvaluation, ContentJudgeResult } from '../services/content-judge.service';
import type { MetalookupEvaluation } from '../services/metalookup.service';

/**
 * How many schemes one request may name (`EvaluationRequest.schemes`, max_length 10). Every scheme is
 * an LLM pass of its own, so the limit is the service's own protection rather than a formality.
 */
const MAX_SCHEMES = 10;

/** What a set of criteria amounts to as a ContentJudge request — see {@link schemesForCriteria}. */
/** One criterion the checks objected to, as the alert above the criteria lists shows it — one at a time. */
export interface CriterionViolation {
  /** The criterion the objection is about, as the metadata set lists it. */
  criterion: MdsValue;
  /** What the checks found; more than one where several of them bear on this criterion. */
  findings: readonly CriterionJudgement[];
}

export interface CriteriaSchemes {
  /** The schemes to ask for: deduplicated, in the order the criteria came in. */
  schemes: string[];
  /** Criteria the map holds no scheme for. They are judged by nobody, which is worth saying. */
  unmapped: string[];
  /** Schemes the limit cut off; empty while everything fits. */
  dropped: string[];
}

/** Which judge an answer came from — they measure different things and are told apart in the view. */
export type JudgementSource = 'ContentJudge' | 'MetalookUp';

/** What a judge answered about one criterion — see {@link judgementsForCriteria}. */
export interface CriterionJudgement {
  /** The criterion, by the id the metadata set gives it. */
  criterion: string;
  /** Which of the two judges said it. */
  source: JudgementSource;
  /** What answered: ContentJudge's scheme id, or the name the config gives MetalookUp's check. */
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
 * The schemes that judge these criteria, deduplicated: a gate covering both areas is asked once. Cut to
 * {@link MAX_SCHEMES}, and what was cut is reported rather than dropped silently — a request that quietly
 * judges less than it was asked to looks like a complete answer.
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
 * Every scheme the map holds, for a judgement that has to start before the metadata set has been read: which
 * criteria the set defines is not known then, and the map is written for exactly those criteria anyway. A
 * scheme too many costs one LLM pass, waiting for the set the whole head start.
 */
export function configuredSchemes(): CriteriaSchemes {
  return schemesForCriteria(Object.keys(APP_CONFIG.qualityCriterionSchemes));
}

/**
 * What both judges said about each criterion, keyed by criterion id — several answers where several checks bear
 * on one. Driven by the criteria rather than by the answers, because that is the direction the view reads in:
 * the maps decide what a result is about.
 */
export function judgementsForCriteria(
  criterionIds: readonly string[],
  judgement: ContentJudgeEvaluation | null,
  measurement: MetalookupEvaluation | null
): Record<string, CriterionJudgement[]> {
  const results = new Map((judgement?.results ?? []).map((result) => [result.scheme_id, result]));
  const judgements: Record<string, CriterionJudgement[]> = {};
  const add = (found: CriterionJudgement) => {
    (judgements[found.criterion] ??= []).push(found);
  };
  for (const criterion of criterionIds) {
    const mapped = APP_CONFIG.qualityCriterionSchemes[criterion];
    const result = mapped ? results.get(mapped.scheme) : undefined;
    if (mapped && result) add(toJudgement(criterion, mapped, result));
    for (const rule of rulesFor(criterion)) {
      const measured = measurementOf(rule, measurement);
      if (measured) add(measured);
    }
  }
  return judgements;
}

/** MetalookUp's checks that bear on this criterion, in the order the config lists them. */
function rulesFor(criterion: string): readonly MetalookupRule[] {
  return APP_CONFIG.qualityMetalookupRules.filter((rule) => rule.criterion === criterion);
}

/**
 * What MetalookUp's answer holds for one of its checks; null where the check is absent or reports no value. Only
 * the configured keys are read out of an answer that carries every check the deployment ran, and the check's whole
 * description travels on as the reasoning.
 */
function measurementOf(
  rule: MetalookupRule,
  measurement: MetalookupEvaluation | null
): CriterionJudgement | null {
  const found = (measurement?.featureExtractions ?? []).find(
    (extraction) => extraction.propertyId === rule.propertyId
  );
  const value = asNumber(found?.value);
  if (!found || value === null) return null;
  return {
    criterion: rule.criterion,
    source: 'MetalookUp',
    scheme: rule.label,
    value,
    label: rule.label,
    confidence: asNumber(found.confidence),
    reasoning: found.description?.trim() || null,
    met: meets(value, rule)
  };
}

function toJudgement(
  criterion: string,
  mapped: CriterionScheme,
  result: ContentJudgeResult
): CriterionJudgement {
  const value = asNumber(result.value);
  return {
    criterion,
    source: 'ContentJudge',
    scheme: mapped.scheme,
    value,
    label: asLabel(result.label),
    confidence: asNumber(result.confidence),
    reasoning: result.reasoning?.trim() || null,
    met: value === null ? null : meets(value, mapped)
  };
}

/** Whether a number answers its criterion — which way round that is, is the check's own scale. */
function meets(value: number, mapped: { met: SchemeDirection; threshold: number }): boolean {
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

/** A scheme's label; the ones that collect several categories at once answer with a list. */
function asLabel(label: string | string[] | null | undefined): string | null {
  const labels = Array.isArray(label) ? label : [label];
  const first = labels.find((entry) => !!entry?.trim());
  return first?.trim() ?? null;
}
