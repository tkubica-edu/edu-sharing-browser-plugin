import { Injectable, computed } from '@angular/core';

import { METADATA_AGENT_API_URL } from '../config';

/**
 * Where the metadata agent is, for every call: the address {@link METADATA_AGENT_API_URL} names —
 * the **default** repository's own `…/rest/bapi/api/v1/proxy/metadata-agent-canvas`, or a locally
 * running agent. Which of the two is configured there, not decided here.
 *
 * Two other answers are deliberately not used. `browserExtensionCustomWebComponent` decided the
 * address until recently, which tied it to which editor the metadata screen embeds — a different
 * question. And the repository URL from *Einstellungen* is not asked either, although it is what the
 * rest of the panel talks to: pinning the agent keeps it reachable while that URL is pointed
 * somewhere without a B-API of its own (a local repository, say).
 *
 * Note that a pinned agent behind the proxy and the panel's session then have to agree: the proxy
 * authorizes by repository session, so it only answers while that session is one *this* repository
 * issued.
 *
 * Pinned for the moment, not for good — hence still a signal.
 */
@Injectable({ providedIn: 'root' })
export class MetadataAgentApiService {
  /** The agent's base URL, without a trailing slash — every endpoint is appended to it. */
  readonly baseUrl = computed(() => METADATA_AGENT_API_URL);
}
