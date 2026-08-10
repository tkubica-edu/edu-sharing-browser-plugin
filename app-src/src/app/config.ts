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
   * How the check is recognised in the answer: a distinctive part of the `description` it reports.
   *
   * Its `propertyId` would be the obvious key and cannot be used: MetalookUp's sidecars each carry it
   * as a deployment variable (`DYNACONF_PROPERTY_ID` in every sidecar's `score.yml`, and in
   * `k8s/manifests.yml`), and staging has nearly all of them set to the same copy-pasted
   * `ccm:oeh_text_reading_time`. Until those are set per service, the description is the only thing that
   * tells one check from another. It is a constant in each sidecar's source, not free text.
   */
  readonly match: string;
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
   * The metadata agent's own deployment — the base used for every repository that does not bring
   * the agent itself. Needs no session, which is why it is also the background worker's fallback
   * (see config.js).
   */
  agentApiUrl: 'https://metadata-agent-api.vercel.app',
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
   * ContentJudgeService).
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
   * MetalookUp measures the resource rather than reading it, so it answers where an LLM cannot: it is
   * the only judge for Barrierearmut (an AXE audit of the rendered page) and for Urheberrecht (the
   * licence stated in the content) — for both of those ContentJudge has no scheme at all.
   *
   * Several checks may answer the same criterion; each is then shown and counted on its own, and the
   * criterion is only met while none of them fails. A check the answer does not carry is simply absent,
   * and one that reports no value ("No files to extract") does not count either way.
   *
   * Left out on purpose, for want of a criterion they would honestly answer: the JavaScript check, the
   * blacklist for paywalls and pop-ups, the file extraction and the malicious-extension check.
   */
  qualityMetalookupRules: [
    {
      match: 'Accessibility audit',
      label: 'Barrierefreiheit (AXE)',
      criterion: 'accessible',
      met: 'atLeast',
      threshold: 0.9
    },
    {
      match: 'GDPR safety standards',
      label: 'DSGVO-Indikatoren',
      criterion: 'ccm:oeh_quality_data_privacy',
      met: 'atLeast',
      threshold: 1
    },
    {
      match: 'Indicators for insufficient security',
      label: 'Sicherheits-Header',
      criterion: 'ccm:oeh_quality_data_privacy',
      met: 'atLeast',
      threshold: 1
    },
    {
      match: 'iframe embedding',
      label: 'iframe-Absicherung',
      criterion: 'ccm:oeh_quality_data_privacy',
      met: 'atLeast',
      threshold: 1
    },
    {
      match: 'potentially malicious links',
      label: 'Verdächtige Links',
      criterion: 'ccm:oeh_quality_data_privacy',
      met: 'atLeast',
      threshold: 1
    },
    {
      match: 'content for license information',
      label: 'Lizenzangabe',
      criterion: 'ccm:oeh_quality_copyright_law',
      met: 'atLeast',
      threshold: 0.5
    }
  ] as readonly MetalookupRule[],
  defaultRepositoryUrl: 'https://repository.staging.openeduhub.net/edu-sharing',
 //defaultRepositoryUrl: 'http://repository.127.0.0.1.nip.io:8100/edu-sharing',
  // Which repository the metadata agent writes to on POST /upload — the agent knows its targets by
  // name, so this is its key, not a URL (see MetadataUploadService).
  uploadRepository: 'staging',
  /**
   * The metadata set the quality criteria are defined in (QualityCriteriaComponent).
   *
   * Named rather than taken from the repository's default set, because the two are not the same
   * thing here: staging's default is "Contentbuffet", which knows neither `virtual:unmetLegalCriteria`
   * nor `ccm:oeh_buffet_criteria` — the criteria belong to the WLO set. A repository whose default
   * set does define them can be pointed at `-default-` instead.
   */
  qualityMetadataSet: 'mds_oeh',
  storageKeys: {
    repositoryUrl: 'eduSharingRepoUrl',
    history: 'eduSharingHistory',
    pendingPreview: 'eduSharingPendingPreview',
    resumeState: 'eduSharingResumeState',
    debugMode: 'eduSharingDebugMode',
    debugDocumentNodeId: 'eduSharingDebugDocumentNodeId'
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
