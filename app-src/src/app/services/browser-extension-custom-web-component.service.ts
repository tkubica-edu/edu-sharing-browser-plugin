import { Injectable, computed, inject, signal } from '@angular/core';
import { ConfigService, DEFAULT } from 'ngx-edu-sharing-api';

import { APP_CONFIG } from '../config';

/** Boolean repository-config variable that switches the browser extension custom web component on. */
const CONFIG_VARIABLE = 'browserExtensionCustomWebComponent';

/** Class on the document element that switches the panel over to the WLO palette. */
const THEME_CLASS = 'wlo-theme';

/**
 * The optional WLO metadata editor. Where the repository config enables `browserExtensionCustomWebComponent`, the
 * metadata screen embeds the WLO canvas instead of the MDS editor and the footer buttons take the bundle's pill
 * shape ({@link THEME_CLASS}); without the variable the wlo bundle is never loaded.
 */
@Injectable({ providedIn: 'root' })
export class BrowserExtensionCustomWebComponentService {
  private readonly config = inject(ConfigService);

  private readonly enabledState = signal(false);

  /** True once the repository config enabled the browser extension custom web component. */
  readonly enabled = this.enabledState.asReadonly();

  /**
   * The metadata set the panel's forms are built from: the WLO set where this is a WLO panel, the repository's own
   * default set elsewhere. Tied to the flag, since a repository that asks for none of this does not describe its
   * contents with WLO fields — and asking it for a set it lacks leaves every form blank.
   */
  readonly metadataSet = computed(() => (this.enabled() ? APP_CONFIG.metadataSet : DEFAULT));

  /** Watch the repository config for the flag. */
  initialize(): void {
    this.config.observeVariables().subscribe((variables) => {
      // `Variables` types every value as string, so a config that delivers the raw string
      // "true" is honoured as well as a real boolean.
      const value = variables?.[CONFIG_VARIABLE] as unknown;
      const enabled = typeof value === 'boolean' ? value : String(value).trim() === 'true';
      if (enabled) {
        this.enabledState.set(true);
        document.documentElement.classList.add(THEME_CLASS);
      }
    });
  }
}
