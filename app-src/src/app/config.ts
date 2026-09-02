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
  /**
   * The MetalookUp feature that produces the check, by the name the gateway's own configuration gives it
   * (`application.features.*`). It is what the request asks for, so a feature nobody names here does not run.
   */
  readonly feature: string;
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
   * and the answer is then the `401` of that guard. Only the fallback for what the settings hold —
   * the credential belongs to whoever runs the extension, not into the checked-in configuration.
   */
  contentJudgeBasicAuth: '',
  /**
   * How ContentJudge fetches a page it is pointed at by address (`crawler_method`): `simple` reads the
   * HTML as served, `browser` renders it first. `simple` unless a page's content only appears with its
   * JavaScript — rendering costs time on a request that already takes a minute.
   */
  contentJudgeCrawlerMethod: 'simple' as 'simple' | 'browser',
  /**
   * The nostr relay AMB records are published to — the address of a relay that serves kind 30142, the
   * kind the "Allgemeines Metadatenprofil für Bildungsressourcen" is published under (see
   * NostrForwardService and `util/amb-event.ts`). A WebSocket address, since that is the only transport
   * nostr has; the default is the edufeed network's own AMB relay.
   *
   * Only the fallback for what the settings hold — which relay a deployment publishes to belongs to
   * whoever runs the extension.
   */
  nostrRelayUrl: 'wss://amb-relay.edufeed.org',
  /**
   * Which ContentJudge scheme judges which quality criterion and how its answer is read, keyed by the criterion's id as
   * the metadata set states it; `null` marks a criterion no scheme is asked for, which is then reported as unjudged.
   * It decides both halves of the exchange, like the MetalookUp rules below: what the request asks for, and what is
   * read of the answer.
   *
   * Only the cheap schemes are named, and cheap has an exact meaning here: one LLM pass, and every pass carries the
   * whole content's text into its prompt again — so the number of passes *is* the price. One pass each is what the
   * German base rubrics and the three collective gates cost. Their `_new` counterparts cost two (the second pass only
   * summarises the reasoning), and the English `*_gate` families one pass per part scheme: 10 for a quality dimension,
   * 11 to 68 for the legal ones. The expensive alternative stands commented out beside each criterion, with its price.
   *
   * Eight criteria, one scheme each, so eight passes per judgement — `schemesForCriteria` deduplicates them and caps
   * the request at ten.
   */
  qualityCriterionSchemes: {
    // PASS/FAIL over the whole indicator catalogue of German criminal law in one pass; a gate answers 1 for
    // passed and 0 for failed, hence the threshold.
    // { scheme: 'criminal_law_gate', met: 'atLeast', threshold: 2 } — 11 passes
    'ccm:oeh_quality_criminal_law': { scheme: 'strafrecht_gate', met: 'atLeast', threshold: 1 },
    // Likewise one pass over JMStV, JuSchG and the StGB paragraphs behind them. The English family answers an
    // age rating instead, one pass per age group and aspect.
    // { scheme: 'protection_of_minors_gate', met: 'atMost', threshold: 18 } — 68 passes, the catalogue's most
    'ccm:oeh_quality_protection_of_minors': { scheme: 'jugendschutz_gate', met: 'atLeast', threshold: 1 },
    // Unjudged: the only scheme that judges privacy on its own is the English family, and the cheap gate that
    // would cover it is the personality-rights one below — whose single verdict would then answer two criteria,
    // and report a violation of either under both.
    // { scheme: 'data_privacy_gate', met: 'atLeast', threshold: 3 } — 20 passes
    'ccm:oeh_quality_data_privacy': null,
    // { scheme: 'personal_law_gate', met: 'atLeast', threshold: 3 } — 21 passes
    'ccm:oeh_quality_personal_law': { scheme: 'persoenlichkeitsrechte_gate', met: 'atLeast', threshold: 1 },
    // 0–5, where 3 reads "ideologisch eingefärbt, aber transparent" and 4 "neutrale Formulierung".
    // { scheme: 'neutrality_gate', met: 'atLeast', threshold: 3 } — 10 passes
    'ccm:oeh_quality_neutralness': { scheme: 'neutralitaet', met: 'atLeast', threshold: 3 },
    // Nothing in the catalogue judges copyright, and nothing judges the fit for the target group.
    'ccm:oeh_quality_copyright_law': null,
    'ccm:oeh_quality_relevancy_for_education': null,
    /*
     * The four editorial dimensions, each a 0–5 rubric in one pass. Where 3 sits differs between them — from
     * "stark vereinfacht" (Sachrichtigkeit) to "Medial passend" — so the threshold is the knob to turn if one of
     * them passes too readily. Their schemes name a rating property of their own in `metadata_property`
     * (`ccm:oeh_quality_correctness` and so on); keyed here is the criterion the panel actually shows.
     */
    // { scheme: 'factual_accuracy_gate', met: 'atLeast', threshold: 3 } — 10 passes
    content_valid: { scheme: 'sachrichtigkeit', met: 'atLeast', threshold: 3 },
    // { scheme: 'linguistic_appropriateness_gate', met: 'atLeast', threshold: 3 } — 10 passes
    speech_valid: { scheme: 'sprachliche_angemessenheit', met: 'atLeast', threshold: 3 },
    // { scheme: 'media_appropriate_gate', met: 'atLeast', threshold: 3 } — 10 passes
    medial_relevant: { scheme: 'medial_passend', met: 'atLeast', threshold: 3 },
    // { scheme: 'didactics_gate', met: 'atLeast', threshold: 3 } — 10 passes
    didactics_valid: { scheme: 'didaktik_methodik', met: 'atLeast', threshold: 3 },
    // Measured rather than judged — see `qualityMetalookupRules` below.
    accessible: null
  } as Record<string, CriterionScheme | null>,
  /**
   * Which of MetalookUp's checks answers which quality criterion — the counterpart of `qualityCriterionSchemes` for the
   * other judge. It decides both halves of the exchange: the features the request asks for, and what is read of the
   * answer, so an extraction under an unnamed key is discarded. Hence one entry: the AXE audit is the only judge
   * Barrierearmut has. A criterion is met only while none of its checks fails.
   */
  qualityMetalookupRules: [
    {
      propertyId: 'ccm:accessibilitySummary',
      feature: 'accessibility',
      label: 'Barrierefreiheit (AXE)',
      criterion: 'accessible',
      met: 'atLeast',
      threshold: 0.9
    }
  ] as readonly MetalookupRule[],
  defaultRepositoryUrl: 'https://repository.staging.openeduhub.net/edu-sharing',
 //defaultRepositoryUrl: 'http://repository.127.0.0.1.nip.io:8100/edu-sharing',
  /**
   * The client the SSO login signs in as — the Authorization Code flow with PKCE, run by the
   * background worker (`background/oauth.js`) and traded for a repository session afterwards (see
   * OAuthService and AuthService.loginWithOAuth).
   *
   * Not user-editable, and nothing else about the flow is configured either: which authorization
   * server to use is discovered below the repository the panel is pointed at
   * (`<Repository>/.well-known/oauth-authorization-server`), and the redirect address is the
   * browser's own. So a repository either offers this login or does not, and the panel finds out by
   * asking it.
   */
  oauth: {
    /**
     * The public client each repository registers for this extension. No secret is held: an
     * extension cannot keep one, which is what PKCE stands in for.
     */
    clientId: 'browser-plugin',
    /**
     * What the authorization request asks for. `profile` alone: the access token is traded for a
     * repository session rather than read here, so no further claim is of any use — and every extra
     * scope is one the server can refuse.
     *
     * `offline_access` is deliberately absent, although it is what would make a server issue a
     * refresh token: the deployments this panel runs against do not support it, and a scope the
     * server does not define fails the whole authorization request. Without a refresh token there is
     * nothing to ask the provider with but the stored access token, so the silent resume rests on the
     * userinfo endpoint (`silentSession` in `background/oauth.js`) and does not happen at all where a
     * server publishes none.
     *
     * Has to stay in step with `DEFAULT_SCOPES` in `background/oauth.js`, which is what a message
     * naming none falls back to.
     */
    scopes: 'profile'
  },
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
     * The `user:password` ContentJudge's guard is answered with — see ContentJudgeService. Without one
     * the judgement is not offered at all, so this is what makes the switch above operable.
     */
    contentJudgeBasicAuth: 'eduSharingContentJudgeBasicAuth',
    /**
     * The dev mode's switch (see DevModeService). Also read by the background worker, which fakes the
     * metadata agent's answers under the same flag — the literal there has to stay in step with this
     * one (`DEV_MODE_STORAGE_KEY` in background/background.js).
     */
    devMode: 'eduSharingDevMode',
    /**
     * The collection a faked run is checked against, and whether the flow's writes are made at all —
     * both only in effect while the dev mode is on (see DevModeService).
     */
    devModeCollectionId: 'eduSharingDevModeCollectionId',
    devModeSkipWrites: 'eduSharingDevModeSkipWrites',
    /**
     * The node a run stands in for while nothing is written — what gives the KI-Qualitätsprüfung a content
     * the assistant can resolve, in place of the node the skipped write never created (see DevModeService).
     */
    devModeNodeId: 'eduSharingDevModeNodeId',
    /**
     * Which faked erschlossener Inhalt a run answers with. Read by the background worker, which owns those
     * fixtures — the literal there has to stay in step with this one
     * (`DEV_MODE_GENERATE_STORAGE_KEY` in background/background.js).
     */
    devModeGenerate: 'eduSharingDevModeGenerate',
    /**
     * Whether the repository's `browserExtensionCustomWebComponent` variable counts — see
     * BrowserExtensionCustomWebComponentService. Off reads the variable as unset, whatever the repository
     * answers: the panel then shows the MDS editor rather than the WLO canvas, offers none of the WLO-only
     * steps, writes no `ccm:oeh_*` fields and asks for a login — the ordinary core flow, walkable through
     * against a repository that has the variable set.
     */
    wloEnabled: 'eduSharingWloEnabled',
    /** Whether the chat widget is corrected by our own stylesheet — see ChatStyleService. */
    chatStyleOverrides: 'eduSharingChatStyleOverrides',
    /** What the panel says about the chat's master skill — see ChatSkillService. */
    chatMasterSkill: 'eduSharingChatMasterSkill',
    /**
     * Whether the panel speaks to a nostr relay at all — see NostrForwardService. Off takes the two steps
     * that publish, the relay row of the forwarding and the standing in the Interaktionen with it, and
     * nothing about a content is sent to or asked of a relay.
     */
    nostrEnabled: 'eduSharingNostrEnabled',
    /**
     * The relay the "An Nostr Relay weiterleiten" step publishes to, where the settings name one of
     * their own; empty leaves `APP_CONFIG.nostrRelayUrl` standing (see NostrForwardService).
     */
    nostrRelayUrl: 'eduSharingNostrRelayUrl',
    /**
     * The secret key those events are signed with, as 64 hex characters. Nostr identifies a publisher by
     * their key and by nothing else, so this key *is* the panel's identity on the relay — it is generated
     * once on the first publication and then kept, and it never leaves this browser.
     */
    nostrSecretKey: 'eduSharingNostrSecretKey',
    /**
     * The panel's colours: `system`, `light` or `dark` — see ThemeService. Also read by the content script
     * that docks the panel, which paints the container the panel's iframe loads into and would otherwise
     * flash white in front of a dark panel (`content/panel-host.js`); the literal there has to stay in step
     * with this one.
     */
    theme: 'eduSharingTheme',
    /**
     * Where the background worker keeps the tokens of the running OAuth session, the refresh token
     * among them. Written and read only there (`TOKEN_STORAGE_KEY` in `background/oauth.js`, which
     * has to stay in step with this); named here so the panel's storage keys are all in one place.
     */
    oauthTokens: 'eduSharingOAuthTokens'
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
