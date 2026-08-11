import { Injectable, computed } from '@angular/core';

import { APP_CONFIG, toAgentProxyUrl } from '../config';

/**
 * Where the metadata agent is: the **default** repository's own
 * `…/rest/bapi/api/v1/proxy/metadata-agent-canvas`, for every call and whatever else is configured.
 *
 * Two earlier answers are deliberately not used here. `additionalWebComponent` decided it until
 * recently, which tied the agent's *address* to which editor the metadata screen embeds — a
 * different question. And the repository URL from *Einstellungen* is not asked either, although it
 * is what the rest of the panel talks to: pinning the agent keeps it reachable while that URL is
 * pointed somewhere without a B-API of its own (a local repository, say).
 *
 * Pinned for the moment, not for good — hence still a signal, and hence
 * {@link APP_CONFIG.defaultRepositoryUrl} rather than a second copy of the address. Following the
 * configured repository again is this one expression. Note that the two then have to agree: the
 * proxy authorizes by repository session, so a pinned agent only answers while the panel's session
 * is one *this* repository issued.
 */
@Injectable({ providedIn: 'root' })
export class MetadataAgentApiService {
  /** The agent's base URL, without a trailing slash — every endpoint is appended to it. */
  readonly baseUrl = computed(() => toAgentProxyUrl(APP_CONFIG.defaultRepositoryUrl));
}
