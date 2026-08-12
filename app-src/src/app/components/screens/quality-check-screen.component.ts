import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';

import { APP_CONFIG } from '../../config';
import { CurationService } from '../../services/curation.service';
import { CriteriaProperties, QualityCriteriaComponent } from '../quality-criteria.component';

// "Qualität", the first of the Qualitätsprüfung's two views: the content's quality criteria, and the
// confirmation that follows from them.
//
// The view itself is QualityCriteriaComponent, which is self-contained (see its own notes) — this
// screen hands it the content's metadata and takes what it reports back into the curation: the
// criteria it recorded, and whether they allow the quality to be confirmed. The confirmation itself
// is offered by the footer (ActionBarService), which is where this step's actions live.
//
// Neither the criteria nor the confirmation are written here: at this point in the flow the content
// usually has no node yet, so both wait for the save that creates one (CurationService.recordValues
// and .confirmQuality).
//
// The machine's judgement of the content is not started here either: it runs from the moment the content
// was erschlossen (QualityJudgeService), so it is usually done by the time this step is reached. This
// screen only asks for it once more, for a content that never came through an analysis — asking twice
// about the same one costs nothing (see QualityJudgeService.start).
@Component({
  selector: 'es-quality-check-screen',
  imports: [QualityCriteriaComponent],
  templateUrl: './quality-check-screen.component.html',
  styleUrl: './quality-check-screen.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class QualityCheckScreenComponent implements OnInit {
  /** Protected: the template binds the confirmation state off it. */
  protected readonly curation = inject(CurationService);

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

  /**
   * The WLO set, not the one the panel resolves for its forms: the criteria are defined nowhere else,
   * and this step only exists where the panel is a WLO one anyway (see the `quality-check` entry in
   * navigation.ts) — so there is no case in which the repository's default set would do.
   */
  protected readonly metadataSet = APP_CONFIG.metadataSet;

  protected record(values: CriteriaProperties): void {
    this.curation.recordValues(values);
  }

  /**
   * Pass the view's gate on to the flow, which is where both things that hang off it live: the
   * footer's "Qualität bestätigen" and the Metadaten sub step it unlocks. Kept in the curation and
   * not here, because both outlive this screen.
   */
  protected reportCriteria(satisfied: boolean): void {
    this.curation.reportQualityCriteria(satisfied);
  }

  ngOnInit(): void {
    // A no-op for a content that was judged on its way here, which is the normal case.
    this.curation.judgeQuality();
  }
}
