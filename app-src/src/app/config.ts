/**
 * Which way a scheme's number has to go for the criterion it judges to count as met: `atLeast` where the higher
 * value is the better one (the 0–5 rubrics and the legal gates), `atMost` where the lower one is — the minors gate
 * answers an age rating, so its scale runs the other way.
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
   * How the check is recognised in the answer: the key it reports its result under, which each of MetalookUp's
   * sidecars carries as a deployment variable of its own. A key this list does not name is not read at all.
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
   * Which ContentJudge scheme judges which quality criterion and how its answer is read, keyed by the criterion's id as
   * the metadata set states it; `null` marks a criterion the deployment has no scheme for, which is then reported as
   * unjudged. Every scheme here is a master gate — thorough but many LLM passes, so a single-pass one is named beside it.
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
   * Which of MetalookUp's checks answers which quality criterion — the counterpart of `qualityCriterionSchemes` for the
   * other judge, and also what is read of the answer, so an extraction under an unnamed key is discarded. Hence one
   * entry: the AXE audit is the only judge Barrierearmut has. A criterion is met only while none of its checks fails.
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
  /**
   * The WLO metadata set: the panel's forms are built from it wherever the panel is a WLO one, and from the
   * repository's default set elsewhere. The quality criteria are the exception — no other set defines them, so their
   * view reads this one directly. Named rather than resolved, because a repository's default is not its WLO set.
   */
  metadataSet: 'mds_oeh',
  storageKeys: {
    repositoryUrl: 'eduSharingRepoUrl',
    history: 'eduSharingHistory',
    pendingPreview: 'eduSharingPendingPreview',
    resumeState: 'eduSharingResumeState',
    debugMode: 'eduSharingDebugMode',
    debugDocumentNodeId: 'eduSharingDebugDocumentNodeId',
    /** How many keywords a collection proposal is read from — see CollectionRecommendationService. */
    recommendationKeywords: 'eduSharingRecommendationKeywords',
    /** The score a keyword has to reach to be one of them. */
    recommendationMinScore: 'eduSharingRecommendationMinScore',
    /** Whether MetalookUp measures the content's quality — see QualityJudgeService. */
    qualityMetalookup: 'eduSharingQualityMetalookup',
    /** Whether ContentJudge judges it. */
    qualityContentJudge: 'eduSharingQualityContentJudge',
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

/** Where a repository proxies the kidra topic assistant, relative to its base. */
const TOPIC_ASSISTANT_PROXY_PATH = '/rest/bapi/api/v1/proxy/kidra/topic-assistant-keywords';

/**
 * The metadata agent behind a repository's own proxy. Unlike the agent's own deployment this
 * endpoint authorizes by repository session (401/403 without one), so it is only usable from a
 * context that carries the session cookie — see MetadataAgentApiService for when it is chosen.
 */
export function toAgentProxyUrl(repositoryBase: string): string {
  return toApiRootUrl(repositoryBase).replace(/\/rest$/, '') + AGENT_PROXY_PATH;
}

/**
 * The topic assistant behind a repository's own B-API proxy: it answers a text with the topics of the
 * topic tree that text belongs to, each named by a URI whose last segment is the id of the collection
 * node the topic is kept as. Like the agent's proxy it authorizes by repository session.
 */
export function toTopicAssistantUrl(repositoryBase: string): string {
  return toApiRootUrl(repositoryBase).replace(/\/rest$/, '') + TOPIC_ASSISTANT_PROXY_PATH;
}

/**
 * Where the metadata agent is — the base every one of its endpoints is appended to, for the panel as much as for
 * the background worker it hands the address to. The default is the repository's own proxy, which authorizes by
 * repository session; the commented line is a local agent, which authorizes nothing.
 */
export const METADATA_AGENT_API_URL = toAgentProxyUrl(APP_CONFIG.defaultRepositoryUrl);
// export const METADATA_AGENT_API_URL = 'http://localhost:8010';
