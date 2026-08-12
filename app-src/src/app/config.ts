/**
 * Which way a scheme's number has to go for the criterion it judges to count as met:
 *
 * - `atLeast` — the higher the better. The 0–5 rubrics, and the legal gates whose top value is the
 *   compliant one (`criminal_law_gate` 2 = LEGAL, `data_privacy_gate` 3 = COMPLIANT).
 * - `atMost` — the lower the better. `protection_of_minors_gate` answers an age rating (0, 6, 12, 16,
 *   18, and 100 for jugendgefährdend), so its scale runs the other way.
 */
export type SchemeDirection = 'atLeast' | 'atMost';

/** What judges one quality criterion — see `APP_CONFIG.qualityCriterionSchemes`. */
export interface CriterionScheme {
  /** The deployment's own scheme id (`GET /schemes/`). */
  readonly scheme: string;
  readonly met: SchemeDirection;
  /** The value the answer has to reach (`atLeast`) or stay under (`atMost`) to count as met. */
  readonly threshold: number;
}

/** One of MetalookUp's checks, and the criterion it answers — see `APP_CONFIG.qualityMetalookupRules`. */
export interface MetalookupRule {
  /**
   * How the check is recognised in the answer: the key it reports its result under
   * (`featureExtractions[].propertyId`), which each of MetalookUp's sidecars carries as a deployment
   * variable of its own (`PROPERTY_ID` / `DYNACONF_PROPERTY_ID`).
   *
   * A key this list does not name is not read at all — see `measurementOf` in `util/quality-schemes.ts`.
   */
  readonly propertyId: string;
  /** What the check is called where its result is shown; MetalookUp reports no name of its own. */
  readonly label: string;
  /** The criterion it answers, by the id the metadata set gives it. */
  readonly criterion: string;
  readonly met: SchemeDirection;
  /** MetalookUp rates from 0 to 1, and higher is better (its DTO's "0 to 5" is out of date). */
  readonly threshold: number;
}

// Sidebar defaults. The repository URL is a user-editable default; where the metadata agent is
// follows from it (see MetadataAgentApiService), so it is not configured as a URL of its own.
export const APP_CONFIG = {
  /**
   * MetalookUp, which evaluates a resource and answers with the metadata it could extract from it
   * (`POST /api/evaluation`, see MetalookupService). The host root — the base its own OpenAPI
   * declares (`…/sw`) does not route.
   */
  metalookupApiUrl: 'https://metalookup-2.staging.openeduhub.net',
  /**
   * Sent as `X-API-KEY` where the MetalookUp deployment demands one. Empty leaves the header off
   * altogether, which is how an unauthenticated deployment is reached — and how the demand becomes
   * visible in the first place, as the answer's status.
   */
  metalookupApiKey: '',
  /**
   * ContentJudge, which judges a content against evaluation schemes by LLM (`POST /evaluate/`, see
   * ContentJudgeService). Its `GET /health/` is asked before every judgement, so a base that is wrong
   * or unreachable is answered in seconds rather than after the judgement's own long timeout.
   */
  contentJudgeApiUrl: 'https://llm-contentjudge.staging.openeduhub.net',
  /**
   * `user:password` for the Basic auth that guards the ContentJudge deployment. It guards the whole
   * host, the API's own docs included; the API itself asks for nothing. Empty leaves the header off,
   * and the answer is then the `401` of that guard.
   */
  contentJudgeBasicAuth: '',
  /**
   * How ContentJudge fetches a page it is pointed at by address (`crawler_method`): `simple` reads the
   * HTML as served, `browser` renders it first. `simple` unless a page's content only appears with its
   * JavaScript — rendering costs time on a request that already takes a minute.
   */
  contentJudgeCrawlerMethod: 'simple' as 'simple' | 'browser',
  /**
   * Which ContentJudge scheme judges which quality criterion, and how its answer is read — the map
   * that both turns the criteria of the Qualitätsprüfung into what the service is asked for and turns
   * what it answers back into a verdict per criterion (see `schemesForCriteria`,
   * `judgementsForCriteria`).
   *
   * Keyed by the criterion's id as the metadata set states it: a node property for the knock-out
   * criteria (`virtual:unmetLegalCriteria`, where every value *is* a property), a bare value id for
   * the editorial ones (`ccm:oeh_buffet_criteria`, values of that one property).
   *
   * `null` says the deployment has no scheme for that criterion; it is then reported as unjudged
   * rather than answered by a scheme that means something else. Listed all the same, so the map shows
   * every criterion that was considered.
   *
   * Every scheme here is a MASTER GATE, which aggregates all part checks of its area — thorough, but
   * many LLM passes each. Where that takes too long, the single-pass scheme of the same area is named
   * beside it; its scale is the same 0–5 one, so only the id changes.
   *
   * The thresholds follow each scheme's own scale (`output_range` of its definition): the rubrics run
   * 0–5, where 3 is "Befriedigend" — the point at which the criterion is taken as answered rather
   * than merely not failed.
   */
  qualityCriterionSchemes: {
    // single pass: strafrecht_gate. 0–2, 2 = LEGAL, 1 = Prüfung erforderlich.
    'ccm:oeh_quality_criminal_law': { scheme: 'criminal_law_gate', met: 'atLeast', threshold: 2 },
    // single pass: jugendschutz_gate. An age rating: 0/6/12/16/18, and 100 for jugendgefährdend —
    // which is the one the criterion is about, so anything up to 18 passes it.
    'ccm:oeh_quality_protection_of_minors': {
      scheme: 'protection_of_minors_gate',
      met: 'atMost',
      threshold: 18
    },
    // 0–3, 3 = COMPLIANT; 1 and 2 each fail one of the two halves (DSGVO, Transparenz).
    'ccm:oeh_quality_data_privacy': { scheme: 'data_privacy_gate', met: 'atLeast', threshold: 3 },
    // single pass: persoenlichkeitsrechte_gate. 0–3, 3 = COMPLIANT.
    'ccm:oeh_quality_personal_law': { scheme: 'personal_law_gate', met: 'atLeast', threshold: 3 },
    // single pass: neutralitaet
    'ccm:oeh_quality_neutralness': { scheme: 'neutrality_gate', met: 'atLeast', threshold: 3 },
    'ccm:oeh_quality_copyright_law': null,
    'ccm:oeh_quality_relevancy_for_education': null,
    // single pass: sachrichtigkeit
    content_valid: { scheme: 'factual_accuracy_gate', met: 'atLeast', threshold: 3 },
    // single pass: sprachliche_angemessenheit
    speech_valid: { scheme: 'linguistic_appropriateness_gate', met: 'atLeast', threshold: 3 },
    // single pass: medial_passend
    medial_relevant: { scheme: 'media_appropriate_gate', met: 'atLeast', threshold: 3 },
    // single pass: didaktik_methodik
    didactics_valid: { scheme: 'didactics_gate', met: 'atLeast', threshold: 3 },
    accessible: null
  } as Record<string, CriterionScheme | null>,
  /**
   * Which of MetalookUp's checks answers which quality criterion — the counterpart of
   * `qualityCriterionSchemes` for the other judge (see `judgementsForCriteria`).
   *
   * The list is what is read of the answer: an extraction under a key it does not name is discarded,
   * however much the answer carries. So one entry, for the one check whose key the deployment states
   * distinctly — the AXE audit of the rendered page under `ccm:accessibilitySummary`. It is also the
   * criterion an LLM cannot answer at all: ContentJudge has no scheme for Barrierearmut, so
   * MetalookUp is its only judge.
   *
   * Several checks may answer the same criterion; each is then shown and counted on its own, and the
   * criterion is only met while none of them fails. A check the answer does not carry is simply absent,
   * and one that reports no value ("No files to extract") does not count either way.
   */
  qualityMetalookupRules: [
    {
      propertyId: 'ccm:accessibilitySummary',
      label: 'Barrierefreiheit (AXE)',
      criterion: 'accessible',
      met: 'atLeast',
      threshold: 0.9
    }
  ] as readonly MetalookupRule[],
  defaultRepositoryUrl: 'https://repository.staging.openeduhub.net/edu-sharing',
 //defaultRepositoryUrl: 'http://repository.127.0.0.1.nip.io:8100/edu-sharing',
  // Which repository the metadata agent writes to on POST /upload — the agent knows its targets by
  // name, so this is its key, not a URL (see MetadataUploadService).
  uploadRepository: 'staging',
  /**
   * The WLO metadata set.
   *
   * The panel's forms are built from it wherever the panel is a WLO one, and from the repository's own
   * default set everywhere else — which of the two applies is not this constant's to say, see
   * `BrowserExtensionCustomWebComponentService.metadataSet`. The quality criteria are the exception:
   * they are WLO criteria (`virtual:unmetLegalCriteria`, `ccm:oeh_buffet_criteria`) and no other set
   * defines them, so their view reads this one directly.
   *
   * Named rather than resolved from the repository, because a repository's default is not its WLO set:
   * staging's default is "Contentbuffet", which knows neither those criteria nor the fields the panel
   * curates.
   */
  metadataSet: 'mds_oeh',
  storageKeys: {
    repositoryUrl: 'eduSharingRepoUrl',
    history: 'eduSharingHistory',
    pendingPreview: 'eduSharingPendingPreview',
    resumeState: 'eduSharingResumeState',
    debugMode: 'eduSharingDebugMode',
    debugDocumentNodeId: 'eduSharingDebugDocumentNodeId',
    /**
     * The dev mode's switch (see DevModeService). Also read by the background worker, which fakes the
     * metadata agent's answers under the same flag — the literal there has to stay in step with this
     * one (`DEV_MODE_STORAGE_KEY` in background/background.js).
     */
    devMode: 'eduSharingDevMode'
  },
  maxHistory: 200
};

// Normalize a repository base to the library's rootUrl (`<host>/edu-sharing/rest`).
export function toApiRootUrl(repositoryBase: string): string {
  let base = (repositoryBase || '').trim().replace(/\/+$/, '');
  if (/\/rest$/.test(base)) return base;
  return base + '/rest';
}

/** Where a repository that hosts the metadata agent itself proxies it, relative to its base. */
const AGENT_PROXY_PATH = '/rest/bapi/api/v1/proxy/metadata-agent-canvas';

/**
 * The metadata agent behind a repository's own proxy. Unlike the agent's own deployment this
 * endpoint authorizes by repository session (401/403 without one), so it is only usable from a
 * context that carries the session cookie — see MetadataAgentApiService for when it is chosen.
 */
export function toAgentProxyUrl(repositoryBase: string): string {
  return toApiRootUrl(repositoryBase).replace(/\/rest$/, '') + AGENT_PROXY_PATH;
}
