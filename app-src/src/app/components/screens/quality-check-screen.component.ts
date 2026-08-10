import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { APP_CONFIG } from '../../config';
import { CurationService } from '../../services/curation.service';
import { CriteriaProperties, QualityCriteriaComponent } from '../quality-criteria.component';

// "Qualität", the first of the Qualitätsprüfung's two views: the content's quality criteria, and the
// confirmation that follows from them.
//
// The view itself is QualityCriteriaComponent, which is self-contained (see its own notes) — this
// screen hands it the content's metadata and takes what it reports back into the curation. Neither
// the criteria nor the confirmation are written here: at this point in the flow the content usually
// has no node yet, so both wait for the save that creates one (CurationService.recordValues and
// .confirmQuality).
@Component({
  selector: 'es-quality-check-screen',
  imports: [QualityCriteriaComponent],
  templateUrl: './quality-check-screen.component.html',
  styleUrl: './quality-check-screen.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class QualityCheckScreenComponent {
  protected readonly curation = inject(CurationService);

  /**
   * The content's metadata, read ONCE as the view opens. Recording a criterion feeds back into this
   * signal, and a live input would hand the component its own answer back mid-click — it already
   * holds what it changed (see QualityCriteriaComponent.changes).
   */
  protected readonly properties = this.curation.editorMetadata();

  /** The criteria are not in every repository's default set — see APP_CONFIG.qualityMetadataSet. */
  protected readonly metadataSet = APP_CONFIG.qualityMetadataSet;

  protected record(values: CriteriaProperties): void {
    this.curation.recordValues(values);
  }

  protected confirm(): void {
    void this.curation.confirmQuality();
  }
}
