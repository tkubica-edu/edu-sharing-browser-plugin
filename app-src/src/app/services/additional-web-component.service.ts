import { Injectable, inject, signal } from '@angular/core';
import { ConfigService } from 'ngx-edu-sharing-api';

/** Boolean repository-config variable that switches the additional web component on. */
const CONFIG_VARIABLE = 'additionalWebComponent';

/**
 * The optional WLO metadata editor.
 *
 * When the repository config enables `additionalWebComponent`, the metadata screen embeds
 * WloCanvasComponent (`metadata-agent-canvas` from the packaged `wlo/` bundle) instead of the
 * edu-sharing MDS editor. Everything else is unchanged: "Inhalt erschließen" still runs the
 * metadata agent, its result is loaded into the editor, and saving still creates or updates the
 * repository node.
 *
 * When the variable is absent or false, the bundle is never loaded and the MDS editor is used.
 */
@Injectable({ providedIn: 'root' })
export class AdditionalWebComponentService {
  private readonly config = inject(ConfigService);

  private readonly enabledState = signal(false);

  /** True once the repository config enabled the additional web component. */
  readonly enabled = this.enabledState.asReadonly();

  /** Watch the repository config for the flag. */
  initialize(): void {
    this.config.observeVariables().subscribe((variables) => {
      // `Variables` types every value as string, so a config that delivers the raw string
      // "true" is honoured as well as a real boolean.
      console.log('variables', variables);
      const value = variables?.[CONFIG_VARIABLE] as unknown;
      const enabled = typeof value === 'boolean' ? value : String(value).trim() === 'true';
      if (enabled) this.enabledState.set(true);
    });
  }
}
