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
   * Which schemes a content is judged against. Every one of them is a separate LLM pass, so few — the
   * API takes at most ten, and `GET /schemes/` lists what a deployment actually has.
   */
  contentJudgeSchemes: ['sachrichtigkeit', 'neutralitaet'],
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
