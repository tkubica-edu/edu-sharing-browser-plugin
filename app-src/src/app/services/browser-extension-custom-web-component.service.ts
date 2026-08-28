import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { take } from 'rxjs';
import { ConfigService, DEFAULT } from 'ngx-edu-sharing-api';

import { APP_CONFIG } from '../config';
import { BrowserExtensionService } from './browser-extension.service';

/** Boolean repository-config variable that switches the browser extension custom web component on. */
const CONFIG_VARIABLE = 'browserExtensionCustomWebComponent';

/** Class on the document element that switches the panel over to the WLO palette. */
const THEME_CLASS = 'wlo-theme';

/**
 * Whether the repository's own answer counts. What a repository offers is what the panel offers, unless the
 * settings say otherwise — see {@link BrowserExtensionCustomWebComponentService.settingEnabled}.
 */
const DEFAULT_SETTING = true;

/**
 * The optional WLO metadata editor. Where the repository config enables `browserExtensionCustomWebComponent`, the
 * metadata screen embeds the WLO canvas instead of the MDS editor and the footer buttons take the bundle's pill
 * shape ({@link THEME_CLASS}); without the variable the wlo bundle is never loaded.
 *
 * Two statements make that one: what the repository says, and whether the settings let it count. Everything
 * WLO-specific in the panel hangs on {@link enabled} alone, so refusing the variable here is what lets the
 * ordinary core flow be walked through against a repository that has the variable set.
 */
@Injectable({ providedIn: 'root' })
export class BrowserExtensionCustomWebComponentService {
  private readonly config = inject(ConfigService);
  private readonly browserExtension = inject(BrowserExtensionService);

  private readonly configState = signal(false);
  private readonly settingState = signal(DEFAULT_SETTING);

  /**
   * True once the repository config enabled the browser extension custom web component and the settings let
   * that answer count. The one statement every WLO branch in the panel reads.
   */
  readonly enabled = computed(() => this.settingState() && this.configState());

  /**
   * Whether the settings let the repository's variable count. The switch itself rather than its outcome: a
   * repository that offers none of this leaves {@link enabled} false while this stays true, which is what the
   * settings' checkbox has to show — it says what the panel was told, not what the repository answered.
   */
  readonly settingEnabled = this.settingState.asReadonly();

  /** Whether the repository offers the WLO extensions at all, whatever the settings make of it. */
  readonly offeredByRepository = this.configState.asReadonly();

  /** Whether the setting stands away from what the panel ships with — see ChatStyleService.changedSettings. */
  readonly changedSettings = computed(() => (this.settingState() === DEFAULT_SETTING ? 0 : 1));

  /**
   * The metadata set the panel's forms are built from: the WLO set where this is a WLO panel, the repository's own
   * default set elsewhere. Tied to the flag, since a repository that asks for none of this does not describe its
   * contents with WLO fields — and asking it for a set it lacks leaves every form blank.
   */
  readonly metadataSet = computed(() => (this.enabled() ? APP_CONFIG.metadataSet : DEFAULT));

  constructor() {
    // The palette follows the panel the class stands for, so it has to follow both statements rather than the
    // repository's alone — a panel switched back to the core flow is not a WLO panel in another colour.
    effect(() => document.documentElement.classList.toggle(THEME_CLASS, this.enabled()));
  }

  /** Load the persisted setting. Before the repository config can be read as an answer. */
  async load(): Promise<void> {
    this.settingState.set(
      await this.browserExtension.storageGet(APP_CONFIG.storageKeys.wloEnabled, DEFAULT_SETTING)
    );
  }

  /**
   * Take over whether the repository's variable counts. Nothing of the content is let go of with it: the switch
   * decides which screens and which fields a save has, not what has been curated — and an Erschließung in
   * progress carries on into whichever editor the metadata screen mounts next.
   */
  async setEnabled(enabled: boolean): Promise<void> {
    this.settingState.set(enabled);
    await this.browserExtension.storageSet(APP_CONFIG.storageKeys.wloEnabled, enabled);
  }

  /** Watch the repository config for the flag. */
  initialize(): void {
    this.config.observeVariables().subscribe((variables) => {
      // No config (yet) is not an answer: leave the flag as it is rather than reading the absence
      // of variables as the absence of the flag.
      if (!variables) return;
      // `Variables` types every value as string, so a config that delivers the raw string
      // "true" is honoured as well as a real boolean.
      const value = variables[CONFIG_VARIABLE] as unknown;
      this.configState.set(typeof value === 'boolean' ? value : String(value).trim() === 'true');
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
}
