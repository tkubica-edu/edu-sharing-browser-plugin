import { Injectable, computed, inject, signal } from '@angular/core';

import { APP_CONFIG } from '../config';
import { BrowserExtensionService } from './browser-extension.service';
import {
  ContentJudgeEvaluation, ContentJudgeInput, ContentJudgeService, judgeableText
} from './content-judge.service';
import {
  MetalookupEvaluation, MetalookupResource, MetalookupService
} from './metalookup.service';
import { JudgementSource, configuredSchemes, metalookupFeatures } from '../util/quality-schemes';
import { errorMessage } from '../util/errors';

/** A judge nobody has asked yet. */
function idle(judge: JudgementSource): JudgeStatus {
  return { judge, state: 'idle', detail: null };
}

/** Log prefixes, as everywhere else in the extension (`[edu-sharing][<station>]`). */
const LOG_QUALITY = '[edu-sharing][quality]';
const LOG_METALOOKUP = '[edu-sharing][metalookup]';
const LOG_CONTENT_JUDGE = '[edu-sharing][contentjudge]';

/**
 * Whether ContentJudge may be asked at all. It may not: one judgement costs far more than the criteria
 * it answers are worth. This outranks the setting, which is therefore shown but not operable — everything
 * the judge needs is in place, so it is asked again as soon as this says so.
 */
export const CONTENT_JUDGE_AVAILABLE = false;

/**
 * MetalookUp measures every content unless the settings say otherwise: the measurement is what answers
 * Barrierearmut, and it is cheap enough to run unasked.
 */
const DEFAULT_METALOOKUP_ENABLED = true;

/**
 * ContentJudge likewise — stated for itself rather than shared with the measurement, since the two are
 * worth very different amounts of a service's work and their defaults have no reason to move together.
 */
const DEFAULT_CONTENT_JUDGE_ENABLED = true;

/**
 * How far one judge got with this content. `skipped` means it was never asked, because the content holds
 * nothing it could judge, and `failed` that it was asked and did not answer — those two are worth showing,
 * since without them an empty result looks like "found nothing".
 */
export type JudgeState = 'idle' | 'running' | 'done' | 'skipped' | 'failed';

/** What one judge did, for the view to report — see {@link QualityJudgeService.statuses}. */
export interface JudgeStatus {
  judge: JudgementSource;
  state: JudgeState;
  /** Why it was skipped, or what went wrong; null when neither applies. */
  detail: string | null;
}

/**
 * Has the content's quality judged and holds what came back. A service rather than the view's business because of
 * when it runs: started as soon as the content is erschlossen and read several steps later, so the minute it takes
 * passes while the user walks the flow. Two independent judges, one measuring the resource, one assessing its text.
 */
@Injectable({ providedIn: 'root' })
export class QualityJudgeService {
  private readonly metalookup = inject(MetalookupService);
  private readonly contentJudge = inject(ContentJudgeService);
  private readonly browserExtension = inject(BrowserExtensionService);

  /** ContentJudge's answer about the current content; null until one arrived. */
  private readonly judgement = signal<ContentJudgeEvaluation | null>(null);
  /** MetalookUp's answer, likewise. Nothing reads it yet — it is logged. */
  private readonly measurement = signal<MetalookupEvaluation | null>(null);

  readonly evaluation = this.judgement.asReadonly();
  readonly measured = this.measurement.asReadonly();

  private readonly metalookupStatus = signal<JudgeStatus>(idle('MetalookUp'));
  private readonly contentJudgeStatus = signal<JudgeStatus>(idle('ContentJudge'));

  /** What each judge did, in the order they are reported. */
  readonly statuses = computed<readonly JudgeStatus[]>(() => [
    this.metalookupStatus(),
    this.contentJudgeStatus()
  ]);

  /** True while either judge is still out. */
  readonly running = computed(() => this.statuses().some((status) => status.state === 'running'));

  /** Whether anything has been asked at all — nothing to report before that. */
  readonly asked = computed(() => this.statuses().some((status) => status.state !== 'idle'));

  /** Whether the content in hand has been judged, so it is not judged twice. */
  private started = false;

  private readonly metalookupEnabledState = signal(DEFAULT_METALOOKUP_ENABLED);

  /** Whether MetalookUp measures the content at all. Persisted, so it survives a reload. */
  readonly metalookupEnabled = this.metalookupEnabledState.asReadonly();

  private readonly contentJudgeEnabledState = signal(DEFAULT_CONTENT_JUDGE_ENABLED);

  /** Whether ContentJudge judges the content: what the setting says, and what the build allows. */
  readonly contentJudgeEnabled = computed(
    () => CONTENT_JUDGE_AVAILABLE && this.contentJudgeEnabledState(),
  );

  /**
   * Load the persisted switches. Before anything is judged, so a content is judged the way the settings
   * say — a judgement takes a minute of a service's work, which is not something to spend against them.
   */
  async load(): Promise<void> {
    const keys = APP_CONFIG.storageKeys;
    this.metalookupEnabledState.set(
      await this.browserExtension.storageGet(keys.qualityMetalookup, DEFAULT_METALOOKUP_ENABLED),
    );
    this.contentJudgeEnabledState.set(
      await this.browserExtension.storageGet(keys.qualityContentJudge, DEFAULT_CONTENT_JUDGE_ENABLED),
    );
  }

  async setMetalookupEnabled(enabled: boolean): Promise<void> {
    this.metalookupEnabledState.set(enabled);
    await this.browserExtension.storageSet(APP_CONFIG.storageKeys.qualityMetalookup, enabled);
  }

  async setContentJudgeEnabled(enabled: boolean): Promise<void> {
    this.contentJudgeEnabledState.set(enabled);
    await this.browserExtension.storageSet(APP_CONFIG.storageKeys.qualityContentJudge, enabled);
  }

  /**
   * Have the content judged, once per content — fire and forget, with the answer picked up from
   * {@link evaluation} wherever it is shown; {@link reset} says a different content is in hand. The resource is
   * the caller's to name and never guessed from the open tab, which shows a different thing.
   */
  start(resource: MetalookupResource): void {
    if (this.started) return;
    this.started = true;
    void this.judge(resource);
  }

  /** Drop what was judged, for a content that is no longer the one in hand. */
  reset(): void {
    this.started = false;
    this.judgement.set(null);
    this.measurement.set(null);
    this.metalookupStatus.set(idle('MetalookUp'));
    this.contentJudgeStatus.set(idle('ContentJudge'));
  }

  /**
   * Both judgements at once. `allSettled`, so one that fails — a service that is down, a credential
   * that is missing — leaves the other's result standing.
   */
  private async judge(resource: MetalookupResource): Promise<void> {
    const schemes = configuredSchemes();
    const features = metalookupFeatures();
    console.log(`${LOG_QUALITY} schemes`, schemes, 'features', features);
    await Promise.allSettled([
      this.runMetalookup(resource, features),
      // Only the schemes themselves; what the mapping left out is in the log above.
      this.runContentJudge(resource, schemes.schemes)
    ]);
  }

  /**
   * MetalookUp retrieves the resource itself, so it is given what identifies it: the address, and the
   * node id for a content the repository already holds. It takes either, and with both it can choose.
   * The features bound what it runs — everything outside them would be measured for nobody.
   */
  private async runMetalookup(
    resource: MetalookupResource,
    features: readonly string[]
  ): Promise<void> {
    if (!this.metalookupEnabled()) {
      const detail = 'Die Messung ist in den Einstellungen abgeschaltet.';
      this.metalookupStatus.set({ judge: 'MetalookUp', state: 'skipped', detail });
      console.log(`${LOG_METALOOKUP} skipped — ${detail}`);
      return;
    }
    if (!resource.url && !resource.nodeId) {
      const detail = 'Der Inhalt hat weder eine Adresse noch einen Node.';
      this.metalookupStatus.set({ judge: 'MetalookUp', state: 'skipped', detail });
      console.log(`${LOG_METALOOKUP} skipped — ${detail}`);
      return;
    }
    if (!features.length) {
      const detail = 'Kein Kriterium verweist auf eine Messung.';
      this.metalookupStatus.set({ judge: 'MetalookUp', state: 'skipped', detail });
      console.log(`${LOG_METALOOKUP} skipped — ${detail}`);
      return;
    }
    this.metalookupStatus.set({ judge: 'MetalookUp', state: 'running', detail: null });
    try {
      // Built here only to log what goes out; the call assembles its own, from the same pure method.
      console.log(`${LOG_METALOOKUP} → request`, this.metalookup.requestBody(resource, features));
      const measurement = await this.metalookup.evaluate(resource, features);
      this.measurement.set(measurement);
      this.metalookupStatus.set({ judge: 'MetalookUp', state: 'done', detail: null });
      console.log(`${LOG_METALOOKUP} ← response`, measurement);
    } catch (cause: unknown) {
      const detail = errorMessage(cause);
      this.metalookupStatus.set({ judge: 'MetalookUp', state: 'failed', detail });
      console.warn(`${LOG_METALOOKUP} evaluation failed`, cause);
    }
  }

  /** ContentJudge judges the content against one scheme per criterion that has one. */
  private async runContentJudge(
    resource: MetalookupResource,
    schemes: readonly string[]
  ): Promise<void> {
    if (!this.contentJudgeEnabled()) {
      const detail = CONTENT_JUDGE_AVAILABLE
        ? 'Die LLM-Bewertung ist in den Einstellungen abgeschaltet.'
        : 'Die LLM-Bewertung ist derzeit abgeschaltet.';
      this.contentJudgeStatus.set({ judge: 'ContentJudge', state: 'skipped', detail });
      console.log(`${LOG_CONTENT_JUDGE} skipped — ${detail}`);
      return;
    }
    if (!schemes.length) {
      const detail = 'Kein Kriterium verweist auf ein Bewertungsschema.';
      this.contentJudgeStatus.set({ judge: 'ContentJudge', state: 'skipped', detail });
      console.log(`${LOG_CONTENT_JUDGE} skipped — ${detail}`);
      return;
    }
    const input = await this.contentJudgeInput(resource);
    if (!input) {
      const detail = 'An diesem Inhalt ist nichts, was sich beurteilen ließe.';
      this.contentJudgeStatus.set({ judge: 'ContentJudge', state: 'skipped', detail });
      console.log(`${LOG_CONTENT_JUDGE} skipped — ${detail}`);
      return;
    }
    this.contentJudgeStatus.set({ judge: 'ContentJudge', state: 'running', detail: null });
    try {
      // The request as it goes out, minus a `text` of up to 50000 characters — it would bury the answer
      // it is logged next to, so only its length is stated.
      const body = this.contentJudge.requestBody(input, schemes);
      console.log(`${LOG_CONTENT_JUDGE} → request`, {
        ...body,
        ...(input.source === 'text' ? { text: `${input.text.length} Zeichen` } : {})
      });
      const judgement = await this.contentJudge.evaluate(input, schemes);
      this.judgement.set(judgement);
      this.contentJudgeStatus.set({ judge: 'ContentJudge', state: 'done', detail: null });
      console.log(`${LOG_CONTENT_JUDGE} ← response`, judgement);
    } catch (cause: unknown) {
      const detail = errorMessage(cause);
      this.contentJudgeStatus.set({ judge: 'ContentJudge', state: 'failed', detail });
      console.warn(`${LOG_CONTENT_JUDGE} evaluation failed`, cause);
    }
  }

  /**
   * How this content is handed to ContentJudge, which follows from what it is: an address means a web page the
   * service fetches whole, a node id alone means a file in its own configured repository, and neither leaves the
   * text read off the open page. Null when even that yields nothing.
   */
  private async contentJudgeInput(
    resource: MetalookupResource
  ): Promise<ContentJudgeInput | null> {
    if (resource.url) return { source: 'url', url: resource.url };
    if (resource.nodeId) return { source: 'nodeid', nodeId: resource.nodeId };
    const text = judgeableText(await this.browserExtension.extractPageData());
    return text ? { source: 'text', text } : null;
  }
}
