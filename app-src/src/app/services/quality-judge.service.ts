import { Injectable, computed, inject, signal } from '@angular/core';

import { BrowserExtensionService } from './browser-extension.service';
import {
  ContentJudgeEvaluation, ContentJudgeInput, ContentJudgeService, judgeableText
} from './content-judge.service';
import {
  MetalookupEvaluation, MetalookupResource, MetalookupService
} from './metalookup.service';
import { JudgementSource, configuredSchemes } from '../util/quality-schemes';
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
 * How far one judge got with this content:
 *
 * - `idle` — not asked yet;
 * - `running` — asked, still out;
 * - `done` — answered;
 * - `skipped` — never asked, because this content holds nothing it could judge;
 * - `failed` — asked and did not answer (unreachable, a missing credential, a timeout).
 *
 * The last two are the ones worth showing: without them an empty result looks like "found nothing".
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
 * Has the content's quality judged, and holds what came back for whoever asks later.
 *
 * A service rather than the view's own business, because of *when* it runs: the judgement is started as
 * soon as the content is erschlossen (CurationService.analyze), and it is read several steps later, in
 * the Qualitätsprüfung (QualityCriteriaComponent). ContentJudge takes about a minute for a set of
 * master gates — run from the view, that minute would be the user waiting; run from here it passes while
 * they walk through the preview and the metadata.
 *
 * Two judges, side by side and independent of each other: MetalookUp measures the resource itself,
 * ContentJudge has an LLM assess its text against evaluation schemes. Which schemes those are follows
 * from the quality criteria — see {@link configuredSchemes}.
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

  /**
   * Have the content judged, once. Fire and forget: the caller gets on with the flow, and the answer is
   * picked up from {@link evaluation} whenever the step that shows it is reached.
   *
   * Once **per content**, not per call: whoever asks second is the flow passing this point again, not a
   * new question — and it is {@link reset} that says a different content is in hand now. That is what
   * lets the step which *shows* the judgement ask for it too, as a fallback for a content that never
   * came through an analysis (one opened from the Verlauf, say) without judging the same page twice.
   *
   * The resource is the caller's to name and is never guessed from the open tab: the content the flow
   * works on and the page the browser happens to show are two different things (see
   * CurationService.judgeQuality).
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
    console.log(`${LOG_QUALITY} schemes`, schemes);
    await Promise.allSettled([
      this.runMetalookup(resource)
      // ContentJudge is switched off: one judgement costs far more than the criteria it answers are
      // worth. Put the call back once that is fixed — everything it feeds is still in place.
      // this.runContentJudge(resource, schemes.schemes)
    ]);
    this.contentJudgeStatus.set({
      judge: 'ContentJudge',
      state: 'skipped',
      detail: 'Die LLM-Bewertung ist derzeit abgeschaltet.'
    });
  }

  /**
   * MetalookUp retrieves the resource itself, so it is given what identifies it: the address, and the
   * node id for a content the repository already holds. It takes either, and with both it can choose.
   */
  private async runMetalookup(resource: MetalookupResource): Promise<void> {
    if (!resource.url && !resource.nodeId) {
      const detail = 'Der Inhalt hat weder eine Adresse noch einen Node.';
      this.metalookupStatus.set({ judge: 'MetalookUp', state: 'skipped', detail });
      console.log(`${LOG_METALOOKUP} skipped — ${detail}`);
      return;
    }
    this.metalookupStatus.set({ judge: 'MetalookUp', state: 'running', detail: null });
    try {
      // Built here only to log what goes out; the call assembles its own, from the same pure method.
      console.log(`${LOG_METALOOKUP} → request`, this.metalookup.requestBody(resource));
      const measurement = await this.metalookup.evaluate(resource);
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
   * How this content is handed to ContentJudge — which of its three input sources fits follows from what
   * the content *is*, and that is exactly what identifies it here:
   *
   * - an address means the content is a web page, and a page is judged by address: the service fetches
   *   it whole, rather than being handed the extract this extension could read off the open tab;
   * - only a node id means the repository holds the content as a file, so the service reads it from
   *   there — its own configured repository, which has to be the same one the panel works against;
   * - neither leaves the text, read off the open page. A content that is not reachable from outside at
   *   all (behind a login, on an intranet) is judged this way and no other.
   *
   * `null` when even that yields nothing to judge.
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
