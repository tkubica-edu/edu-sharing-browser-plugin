import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';

import { APP_CONFIG } from '../../config';
import { BrowserExtensionService } from '../../services/browser-extension.service';
import { CurationService } from '../../services/curation.service';
import { CriteriaProperties, QualityCriteriaComponent } from '../quality-criteria.component';
import { judgeableText } from '../../services/content-judge.service';

// "Qualität", the first of the Qualitätsprüfung's two views: the content's quality criteria, and the
// confirmation that follows from them.
//
// The view itself is QualityCriteriaComponent, which is self-contained (see its own notes) — this
// screen hands it the content's metadata and takes what it reports back into the curation. Neither
// the criteria nor the confirmation are written here: at this point in the flow the content usually
// has no node yet, so both wait for the save that creates one (CurationService.recordValues and
// .confirmQuality).
//
// That view also has two services judge the content, and what it needs for that is the open page. This
// screen reads it and hands it over: reading the page is the extension's business, and the view stays
// out of it.
@Component({
  selector: 'es-quality-check-screen',
  imports: [QualityCriteriaComponent],
  templateUrl: './quality-check-screen.component.html',
  styleUrl: './quality-check-screen.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class QualityCheckScreenComponent implements OnInit {
  /** Protected, unlike the service below: the template binds the confirmation state off it. */
  protected readonly curation = inject(CurationService);

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

  /** The open page, for the view to have judged; empty until it is read — see {@link readPage}. */
  protected readonly pageUrl = signal('');
  protected readonly pageText = signal('');

  /** The node the content already has, for the service that can work from the repository's copy. */
  protected readonly nodeId = this.curation.activeNode()?.nodeId ?? '';

  protected record(values: CriteriaProperties): void {
    this.curation.recordValues(values);
  }

  protected confirm(): void {
    void this.curation.confirmQuality();
  }

  /**
   * Read the page as the view is built, not from an effect: the screen is rebuilt whenever the step's
   * tab is re-entered, so this is once per visit — whereas a signal that kept tracking would have the
   * content judged again on every change to it.
   */
  ngOnInit(): void {
    void this.readPage();
  }

  /**
   * The open page, as far as the two services need it: its address for MetalookUp, its text for
   * ContentJudge.
   *
   * Both are asked for separately because they fail separately — the extraction injects a script and is
   * refused on a protected page, and the address is still worth having then. They are published
   * together once both attempts are done, so the view judges the whole page instead of whichever half
   * arrived first.
   */
  private async readPage(): Promise<void> {
    const [tab, page] = await Promise.all([
      this.browserExtension.getActiveTab(),
      this.browserExtension.extractPageData()
    ]);
    this.pageUrl.set(tab?.url ?? '');
    // Picked and cut here, where the page is at hand: which of its texts is judged, and how much of it,
    // is what judgeableText decides.
    this.pageText.set(judgeableText(page) ?? '');
  }
}
