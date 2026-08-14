import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';

import { APP_CONFIG } from '../../../config';
import { CurationService } from '../../../services/curation.service';
import { CriteriaProperties, QualityCriteriaComponent } from '../quality-criteria/quality-criteria.component';

// "Qualität", the first of the Qualitätsprüfung's two views: the content's quality criteria and the confirmation
// that follows from them. The view itself is QualityCriteriaComponent; this screen hands it the metadata and takes
// back what it recorded plus whether the quality may be confirmed, which the footer offers. Neither is written
// here — the content usually has no node yet, so both wait for the save that creates one. The machine's judgement
// runs from the moment the content was erschlossen; this screen only asks again for one that never was analysed.
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
   * The content's metadata, tracked rather than sampled: a node picked from the Verlauf is still loading when this
   * view opens, so a record read once would stay empty and the first click would write the view's idea of the
   * answers over the content's. Safe because recording is additive on both sides.
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
