import { Injectable, computed, inject, signal } from '@angular/core';
import { ConfigService, DEFAULT } from 'ngx-edu-sharing-api';

import { APP_CONFIG } from '../config';

/** Boolean repository-config variable that switches the browser extension custom web component on. */
const CONFIG_VARIABLE = 'browserExtensionCustomWebComponent';

/** Class on the document element that switches the panel over to the WLO palette. */
const THEME_CLASS = 'wlo-theme';

/**
 * The optional WLO metadata editor.
 *
 * When the repository config enables `browserExtensionCustomWebComponent`, the metadata screen embeds
 * WloCanvasComponent (`metadata-agent-canvas` from the packaged `wlo/` bundle) instead of the
 * edu-sharing MDS editor. Everything else is unchanged: "Inhalt erschließen" still runs the
 * metadata agent, its result is loaded into the editor, and saving still creates or updates the
 * repository node.
 *
 * When the variable is absent or false, the bundle is never loaded and the MDS editor is used.
 *
 * Enabling it also puts {@link THEME_CLASS} on the document element, which gives the footer buttons
 * the pill shape of the bundle's own buttons (see `_wlo-theme.scss`). The panel's colours stay its
 * own either way.
 */
@Injectable({ providedIn: 'root' })
export class BrowserExtensionCustomWebComponentService {
  private readonly config = inject(ConfigService);

  private readonly enabledState = signal(false);

  /** True once the repository config enabled the browser extension custom web component. */
  readonly enabled = this.enabledState.asReadonly();

  /**
   * The metadata set the panel's forms are built from: the WLO set (`APP_CONFIG.metadataSet`) where
   * this is a WLO panel, the repository's own default set anywhere else.
   *
   * Tied to the flag rather than configured on its own, because the flag is what makes the panel a
   * WLO one — the same switch loads the WLO canvas and {@link THEME_CLASS}. A repository that does
   * not ask for any of that is not one whose contents are described with WLO fields, and asking it
   * for a set it does not have leaves every form blank.
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
