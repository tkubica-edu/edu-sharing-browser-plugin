import { Injectable, computed, inject, signal } from '@angular/core';

import { APP_CONFIG, isFeatureEnabled } from '../config';
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
 * The erschlossene Inhalte a faked `/generate` can answer with, to be chosen between in the settings. The
 * payloads themselves belong to the background worker, which is what answers that call
 * (`EDU_SHARING_DEV_FIXTURES.agentGenerate` in background/dev-fixtures.js) — only the ids and what to call
 * them are here, and the ids have to stay in step with that object's keys.
 */
export const GENERATE_FIXTURES: readonly { id: string; label: string }[] = [
  { id: 'dresden', label: 'Dresden (Wikipedia) — fachlich in Ordnung' },
  { id: 'optik', label: 'Optik (WLO Demo Wiki) — mit eingebauten Fachfehlern' }
];

/** Which of them a run answers with while none was chosen: the first, as in the worker. */
const DEFAULT_FIXTURE = GENERATE_FIXTURES[0].id;

/**
 * Development mode that answers the LLM-backed services from fixtures instead of asking them, saving the minute or
 * more of LLM work each run costs; off by default. Distinct from {@link DebugService}, which fakes what the browser
 * cannot deliver here rather than what a service takes too long to.
 *
 * A deployment can also turn it off outright — `APP_CONFIG.featureBlacklist` naming `developerOptions` — a
 * static, developer-edited switch rather than a setting; see {@link blacklisted} and {@link enabled}.
 * `SettingsScreenComponent` hides the switch entirely for such a deployment, instead of showing one that would
 * have no effect. Unlike the WLO and Nostr switches, {@link load} also writes a persisted "on" back to
 * storage where it finds itself blacklisted: `background/background.js` reads the same key on its own, with
 * no blacklist of its own to stop it, and would otherwise go on answering from fixtures unseen.
 */
@Injectable({ providedIn: 'root' })
export class DevModeService {
  private readonly browserExtension = inject(BrowserExtensionService);

  private readonly enabledState = signal(DEFAULT_ENABLED);

  /** True where `APP_CONFIG.featureBlacklist` names `developerOptions` — see `FeatureKey`. */
  readonly blacklisted = computed(() => !isFeatureEnabled('developerOptions'));

  /** Whether the services' answers are faked — the setting and `developerOptions` not being blacklisted, both. Persisted, so it survives a reload. */
  readonly enabled = computed(() => !this.blacklisted() && this.enabledState());

  private readonly collectionIdState = signal('');

  /**
   * The collection the flow is to behave as if the content had been filed in, so the checks that work
   * off one — the KI-Qualitätsprüfung, which reads the assistant's skill by it — can be reached without
   * walking the filing steps. Empty while none is set, which is the ordinary state.
   */
  readonly collectionId = this.collectionIdState.asReadonly();

  private readonly generateState = signal(DEFAULT_FIXTURE);

  /**
   * The id of the erschlossener Inhalt a faked run answers with — see {@link GENERATE_FIXTURES}. Only
   * persisted here; what reads it is the background worker, which holds the payloads.
   */
  readonly generate = this.generateState.asReadonly();

  /** What there is to choose between, for the settings' select. */
  readonly generateFixtures = GENERATE_FIXTURES;

  private readonly nodeIdState = signal('');

  /**
   * The node the checks are to treat the content as, while the run writes nothing. Empty while none is set,
   * which is the ordinary state.
   */
  readonly nodeId = this.nodeIdState.asReadonly();

  private readonly skipWritesState = signal(false);

  /**
   * Whether the flow's writes are left unmade. Off by default, since the saving is itself worth
   * testing; on, the steps lead on without creating or updating a node, which is what makes a check
   * behind them repeatable without leaving a trail of nodes in the repository.
   */
  readonly skipWrites = this.skipWritesState.asReadonly();

  /** Both of the above are answers about a faked run, so they only hold while the mode is on. */
  readonly fakedCollectionId = computed(() =>
    this.enabled() ? this.collectionIdState().trim() : '',
  );
  readonly writesSkipped = computed(() => this.enabled() && this.skipWritesState());

  /**
   * The node a run stands in for, or empty where it stands in for none.
   *
   * Bound to {@link writesSkipped} rather than to the mode alone: with the writes made, the run has a node of
   * its own and a second id would be a claim about a different content. It matters because the assistant
   * resolves the content by this id — without one it is handed the collection instead, and a check whose
   * subject is the collection answers about the wrong thing (see `contentContextOf`).
   */
  readonly fakedNodeId = computed(() => (this.writesSkipped() ? this.nodeIdState().trim() : ''));

  /**
   * How much of this mode stands away from what the panel ships with — see
   * ChatStyleService.changedSettings for what the settings do with it. What the mode holds is only
   * counted while the mode is on, which is also the only state those settings say anything in (see
   * {@link fakedCollectionId}, {@link writesSkipped}) and the only one the settings show them in.
   */
  readonly changedSettings = computed(() => {
    if (!this.enabled()) return 0;
    return (
      1 +
      (this.generateState() === DEFAULT_FIXTURE ? 0 : 1) +
      (this.fakedCollectionId() ? 1 : 0) +
      (this.writesSkipped() ? 1 : 0) +
      (this.fakedNodeId() ? 1 : 0)
    );
  });

  /**
   * Load the persisted switch. Must run before anything asks one of the faked services, so a boot
   * that starts an Erschließung of its own does not send out the request the mode is there to spare.
   */
  async load(): Promise<void> {
    const keys = APP_CONFIG.storageKeys;
    this.enabledState.set(await this.browserExtension.storageGet(keys.devMode, DEFAULT_ENABLED));
    this.collectionIdState.set(await this.browserExtension.storageGet(keys.devModeCollectionId, ''));
    this.skipWritesState.set(await this.browserExtension.storageGet(keys.devModeSkipWrites, false));
    this.nodeIdState.set(await this.browserExtension.storageGet(keys.devModeNodeId, ''));
    this.generateState.set(
      toFixtureId(await this.browserExtension.storageGet(keys.devModeGenerate, DEFAULT_FIXTURE)),
    );

    // A switch left on from before this deployment blacklisted the mode: turned off here rather than
    // merely read as off, since the background worker reads `devMode` on its own storage lookup, with
    // no blacklist of its own, and would otherwise keep answering `/generate` from fixtures unseen.
    if (this.blacklisted() && this.enabledState()) {
      this.enabledState.set(false);
      await this.browserExtension.storageSet(keys.devMode, false);
    }

    if (this.enabled()) {
      console.log(`${LOG} aktiv — KI-Antworten werden gefakt`, {
        generate: this.generateState(),
        collectionId: this.fakedCollectionId() || null,
        writesSkipped: this.writesSkipped(),
        nodeId: this.fakedNodeId() || null
      });
    }
  }

  async setEnabled(enabled: boolean): Promise<void> {
    this.enabledState.set(enabled);
    await this.browserExtension.storageSet(APP_CONFIG.storageKeys.devMode, enabled);
  }

  /** Take over the collection a faked run is checked against — see {@link collectionId}. */
  async setCollectionId(id: string): Promise<void> {
    const trimmed = id.trim();
    this.collectionIdState.set(trimmed);
    await this.browserExtension.storageSet(APP_CONFIG.storageKeys.devModeCollectionId, trimmed);
  }

  /** Take over which content a faked run answers with — see {@link generate}. */
  async setGenerate(id: string): Promise<void> {
    const fixture = toFixtureId(id);
    this.generateState.set(fixture);
    await this.browserExtension.storageSet(APP_CONFIG.storageKeys.devModeGenerate, fixture);
  }

  /** Take over the node a run without writes stands in for — see {@link nodeId}. */
  async setNodeId(id: string): Promise<void> {
    const trimmed = id.trim();
    this.nodeIdState.set(trimmed);
    await this.browserExtension.storageSet(APP_CONFIG.storageKeys.devModeNodeId, trimmed);
  }

  /** Take over whether the flow's writes are made — see {@link skipWrites}. */
  async setSkipWrites(skip: boolean): Promise<void> {
    this.skipWritesState.set(skip);
    await this.browserExtension.storageSet(APP_CONFIG.storageKeys.devModeSkipWrites, skip);
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

/** An id one of the fixtures is actually held under; the first one for anything else. */
function toFixtureId(value: unknown): string {
  const id = String(value ?? '');
  return GENERATE_FIXTURES.some((fixture) => fixture.id === id) ? id : DEFAULT_FIXTURE;
}
