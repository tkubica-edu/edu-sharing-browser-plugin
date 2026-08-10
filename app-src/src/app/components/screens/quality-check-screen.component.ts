import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';

import { APP_CONFIG } from '../../config';
import { BrowserExtensionService } from '../../services/browser-extension.service';
import { ContentJudgeService, judgeableText } from '../../services/content-judge.service';
import { CurationService } from '../../services/curation.service';
import { CriteriaProperties, QualityCriteriaComponent } from '../quality-criteria.component';
import { MetalookupService } from '../../services/metalookup.service';

/** Log prefixes, as everywhere else in the extension (`[edu-sharing][<station>]`). */
const LOG_METALOOKUP = '[edu-sharing][metalookup]';
const LOG_CONTENT_JUDGE = '[edu-sharing][contentjudge]';

// "Qualität", the first of the Qualitätsprüfung's two views: the content's quality criteria, and the
// confirmation that follows from them.
//
// The view itself is QualityCriteriaComponent, which is self-contained (see its own notes) — this
// screen hands it the content's metadata and takes what it reports back into the curation. Neither
// the criteria nor the confirmation are written here: at this point in the flow the content usually
// has no node yet, so both wait for the save that creates one (CurationService.recordValues and
// .confirmQuality).
//
// Alongside that, two services judge the content on their own, and they judge different things:
// MetalookUp measures the resource itself (security headers, paywalls, accessibility), ContentJudge
// has an LLM assess its text against evaluation schemes. They run side by side, neither waits for the
// other, and what they answer goes to the console only — which of it belongs next to the criteria is
// not decided yet, so they leave the view alone.
@Component({
  selector: 'es-quality-check-screen',
  imports: [QualityCriteriaComponent],
  templateUrl: './quality-check-screen.component.html',
  styleUrl: './quality-check-screen.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class QualityCheckScreenComponent implements OnInit {
  /** Protected, unlike the services below: the template binds the confirmation state off it. */
  protected readonly curation = inject(CurationService);

  private readonly metalookup = inject(MetalookupService);
  private readonly contentJudge = inject(ContentJudgeService);
  private readonly browserExtension = inject(BrowserExtensionService);

  /**
   * The content's metadata, tracked rather than sampled: a node picked from the Verlauf or den
   * eigenen Inhalten is still loading when this view opens, and a record read once would then stay
   * empty — every criterion would look unanswered, and the first click would write the view's idea
   * of the answers over the ones the content actually holds.
   *
   * Feeding it live is safe because recording is additive on both sides: the criteria view keeps
   * what it changed, and the curation merges rather than replaces (see recordValues).
   */
  protected readonly properties = this.curation.editorMetadata;

  /** The criteria are not in every repository's default set — see APP_CONFIG.qualityMetadataSet. */
  protected readonly metadataSet = APP_CONFIG.qualityMetadataSet;

  protected record(values: CriteriaProperties): void {
    this.curation.recordValues(values);
  }

  protected confirm(): void {
    void this.curation.confirmQuality();
  }

  /**
   * Judge once as the view is built, not from an effect: the screen is rebuilt whenever the step's tab
   * is re-entered, so this is once per visit — whereas a signal that kept tracking would ask again on
   * every change to the node.
   */
  ngOnInit(): void {
    //void this.evaluate();
  }

  /**
   * Both judgements at once. `allSettled`, so one that fails — a service that is down, a credential
   * that is missing — leaves the other's result standing.
   */
  private async evaluate(): Promise<void> {
    await Promise.allSettled([this.runMetalookup(), this.runContentJudge()]);
  }

  /**
   * MetalookUp retrieves the resource itself, so it is given what identifies it: the page's address,
   * and the node id for a content the repository already holds. The API takes either, and with both it
   * can choose.
   */
  private async runMetalookup(): Promise<void> {
    const resource = {
      url: (await this.browserExtension.getActiveTab())?.url ?? null,
      nodeId: this.curation.activeNode()?.nodeId ?? null
    };
    try {
      // Built here only to log what goes out; the call assembles its own, from the same pure method.
      console.log(`${LOG_METALOOKUP} → request`, this.metalookup.requestBody(resource));
      console.log(`${LOG_METALOOKUP} ← response`, await this.metalookup.evaluate(resource));
    } catch (cause: unknown) {
      console.warn(`${LOG_METALOOKUP} evaluation failed`, cause);
    }
  }

  /**
   * ContentJudge judges text, and the text is read off the open page rather than crawled: that way the
   * judgement is about what the user has in front of them — a page behind a login included — and the
   * page is not fetched a second time.
   */
  private async runContentJudge(): Promise<void> {
    const text = judgeableText(await this.browserExtension.extractPageData());
    if (!text) {
      console.log(`${LOG_CONTENT_JUDGE} skipped — the page yielded too little text to judge`);
      return;
    }
    try {
      // The schemes and how much text they get — not the text itself, which is up to 50000 characters
      // and would bury the answer it is logged next to.
      const { schemes } = this.contentJudge.requestBody(text);
      console.log(`${LOG_CONTENT_JUDGE} → request`, { schemes, textLength: text.length });
      console.log(`${LOG_CONTENT_JUDGE} ← response`, await this.contentJudge.evaluate(text));
    } catch (cause: unknown) {
      console.warn(`${LOG_CONTENT_JUDGE} evaluation failed`, cause);
    }
  }
}
