import { Injectable, computed, inject } from '@angular/core';

import { AuthService } from './auth.service';
import { CurationService } from './curation.service';
import { UiStateService } from './ui-state.service';
import { toApiRootUrl } from '../config';
import { PluginContext } from '../plugin/plugin-api';

// Assembles the host PluginContext handed to contributed views (element props / iframe
// base64 `data` param) from the existing signal-backed services. Kept as its own service
// so both ExtensionViewHostComponent and AdditionalWebComponentService can read it without
// duplicating the wiring. Signal-driven, so it stays live in the zoneless app.
@Injectable({ providedIn: 'root' })
export class PluginContextService {
  private readonly auth = inject(AuthService);
  private readonly curation = inject(CurationService);
  private readonly ui = inject(UiStateService);

  readonly context = computed<PluginContext>(() => {
    const s = this.auth.state();
    const node = this.curation.createdNode();
    return {
      activeUrl: this.ui.activeUrl(),
      repositoryUrl: toApiRootUrl(s.repositoryUrl),
      node: node ? { nodeId: node.nodeId, name: node.name, link: node.link } : null,
      metadata: this.curation.editorMetadata(),
      userInfo: {
        isLoggedIn: s.loggedIn,
        guest: s.guest,
        username: s.username
      }
    };
  });

  snapshot(): PluginContext {
    return this.context();
  }

  /** Base64-encoded JSON context for iframe `data` params. Mirrors the metadata-agent
   *  browser-extension/bookmarklet contract (`atob` → `decodeURIComponent` → JSON), and
   *  includes a top-level `url` alias of `activeUrl` so that component reads the page URL. */
  encoded(): string {
    const c = this.snapshot();
    const payload = { ...c, url: c.activeUrl };
    return btoa(encodeURIComponent(JSON.stringify(payload)));
  }
}
