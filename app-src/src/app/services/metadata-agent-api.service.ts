import { Injectable, computed } from '@angular/core';

import { METADATA_AGENT_API_URL } from '../config';

/**
 * Where the metadata agent is, for every call: the address {@link METADATA_AGENT_API_URL} names. The repository URL
 * from *Einstellungen* is deliberately not asked, so the agent stays reachable while that URL points somewhere
 * without a B-API — but an agent behind the proxy only answers while the session is this repository's.
 */
@Injectable({ providedIn: 'root' })
export class MetadataAgentApiService {
  /** The agent's base URL, without a trailing slash — every endpoint is appended to it. */
  readonly baseUrl = computed(() => METADATA_AGENT_API_URL);
}
