import { Injectable, computed, inject } from '@angular/core';

import { APP_CONFIG, toAgentProxyUrl } from '../config';
import { AdditionalWebComponentService } from './additional-web-component.service';
import { AuthService } from './auth.service';

/**
 * Where the metadata agent is, for the repository the panel is configured against.
 *
 * The agent exists twice over: as its own public deployment, and behind a repository's
 * `…/rest/bapi/api/v1/proxy/metadata-agent-canvas`. Which one applies is not a setting of its own
 * but a property of the repository — a repository that hosts the agent is the one that should answer
 * for its own contents, with its own schemas and its own targets.
 *
 * `additionalWebComponent` is the answer to that question the repository already gives: it is set by
 * exactly the repositories that ship the WLO metadata editor, which is the agent's own canvas (see
 * AdditionalWebComponentService). So instead of matching a repository URL against a list, the
 * proxied agent is used wherever that flag is set, relative to the configured repository — and every
 * other repository is served by the public deployment.
 *
 * The proxy authorizes by repository session, which the panel document carries (its requests go out
 * with the session cookie) — and which the background worker does not, hence the fallback in
 * config.js for a call that reaches the worker without a base.
 */
@Injectable({ providedIn: 'root' })
export class MetadataAgentApiService {
  private readonly auth = inject(AuthService);
  private readonly additionalWebComponent = inject(AdditionalWebComponentService);

  /** The agent's base URL, without a trailing slash — every endpoint is appended to it. */
  readonly baseUrl = computed(() =>
    this.additionalWebComponent.enabled()
      ? toAgentProxyUrl(this.auth.repositoryUrl())
      : APP_CONFIG.agentApiUrl,
  );
}
