import { Injectable, inject, signal } from '@angular/core';

import { APP_CONFIG } from '../config';
import { BrowserExtensionService } from './browser-extension.service';

/**
 * Off unless it was switched on: what the panel does by default is ask the real services, so an
 * install nobody configured never shows a faked answer as if it were one.
 */
const DEFAULT_ENABLED = false;

/**
 * Delay before a faked answer arrives, so a caller sees the same asynchronous behaviour — spinner,
 * in-flight guard — as with the real service. Small, since saving the wait is the point.
 */
const LATENCY_MS = 300;

/** Log prefix, as everywhere else in the extension (`[edu-sharing][<station>]`). */
const LOG = '[edu-sharing][devmode]';

/**
 * Development mode that answers the LLM-backed services from fixtures instead of asking them, saving the minute or
 * more of LLM work each run costs; off by default. Distinct from {@link DebugService}, which fakes what the browser
 * cannot deliver here rather than what a service takes too long to.
 */
@Injectable({ providedIn: 'root' })
export class DevModeService {
  private readonly browserExtension = inject(BrowserExtensionService);

  private readonly enabledState = signal(DEFAULT_ENABLED);

  /** True while the services' answers are faked. Persisted, so it survives a reload. */
  readonly enabled = this.enabledState.asReadonly();

  /**
   * Load the persisted switch. Must run before anything asks one of the faked services, so a boot
   * that starts an Erschließung of its own does not send out the request the mode is there to spare.
   */
  async load(): Promise<void> {
    this.enabledState.set(
      await this.browserExtension.storageGet(APP_CONFIG.storageKeys.devMode, DEFAULT_ENABLED),
    );
    if (this.enabledState()) console.log(`${LOG} aktiv — KI-Antworten werden gefakt`);
  }

  async setEnabled(enabled: boolean): Promise<void> {
    this.enabledState.set(enabled);
    await this.browserExtension.storageSet(APP_CONFIG.storageKeys.devMode, enabled);
  }

  /**
   * A fixture as an answer, delivered after {@link LATENCY_MS}. Deep-copied, because a service is a
   * singleton for the panel's whole lifetime while a caller may write into what it got — without the
   * copy, one run's edit would be the next run's starting point.
   */
  async answer<T>(label: string, fixture: T): Promise<T> {
    await this.delay();
    console.log(`${LOG} ⬅ gefakte Antwort: ${label}`);
    return structuredClone(fixture);
  }

  /**
   * A failure as an answer — for a call whose faked outcome *is* an error (ContentJudge's
   * `/evaluate/`). Waits like {@link answer}, so the caller's in-flight state is exercised too.
   */
  async fail(label: string, error: Error): Promise<never> {
    await this.delay();
    console.log(`${LOG} ⬅ gefakter Fehler: ${label} — ${error.message}`);
    throw error;
  }

  private delay(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, LATENCY_MS));
  }
}
