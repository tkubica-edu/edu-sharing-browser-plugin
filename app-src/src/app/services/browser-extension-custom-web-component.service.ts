import { Injectable, computed, inject, signal } from '@angular/core';
import { take } from 'rxjs';
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
      // No config (yet) is not an answer: leave the flag as it is rather than reading the absence
      // of variables as the absence of the flag.
      if (!variables) return;
      // `Variables` types every value as string, so a config that delivers the raw string
      // "true" is honoured as well as a real boolean.
      const value = variables[CONFIG_VARIABLE] as unknown;
      this.apply(typeof value === 'boolean' ? value : String(value).trim() === 'true');
    });
  }

  /**
   * Fetch the repository config again, so a config that changed since the boot reaches the
   * subscription above. The variables share the library's config update trigger, which is what
   * `forceUpdate` pulls.
   */
  refresh(): void {
    this.config.observeConfig({ forceUpdate: true }).pipe(take(1)).subscribe({
      error: () => {
        /* unreachable repository — the flag stays as it is */
      }
    });
  }

  private apply(enabled: boolean): void {
    this.enabledState.set(enabled);
    document.documentElement.classList.toggle(THEME_CLASS, enabled);
  }
}
