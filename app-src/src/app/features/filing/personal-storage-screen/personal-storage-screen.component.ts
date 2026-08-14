import { ChangeDetectionStrategy, Component, OnDestroy, computed, inject, viewChild } from '@angular/core';

import { Node } from 'ngx-edu-sharing-api';

import { ActionBarService, ApplyHandler } from '../../../services/action-bar.service';
import { Collection, CurationService } from '../../../services/curation.service';
import { RepositoryNodeService } from '../../../services/repository-node.service';
import { CollectionSelectorComponent } from '../collection-selector/collection-selector.component';
import { StorageLocationPickerComponent } from '../storage-location-picker/storage-location-picker.component';

// "Persönliche Ablage": where the content is filed in the user's own place, offered only for a session of their
// own. Two ways of filing, both theirs — a folder in their workspace and, optionally, a collection. Neither is
// carried out here: the folder is the parent the content is created in and a collection takes a node, so both
// wait for the save at the end of the Qualitätsprüfung. The step is passable without picking anything, so the
// way on stays "Weiter" and takes the ticked collection over as it leads on.
@Component({
  selector: 'es-personal-storage-screen',
  imports: [CollectionSelectorComponent, StorageLocationPickerComponent],
  templateUrl: './personal-storage-screen.component.html',
  styleUrl: './personal-storage-screen.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class PersonalStorageScreenComponent implements OnDestroy {
  protected readonly curation = inject(CurationService);

  private readonly actionBar = inject(ActionBarService);
  private readonly repositoryNodes = inject(RepositoryNodeService);

  private readonly selector = viewChild(CollectionSelectorComponent);

  /**
   * The way on's take-over of the ticked collection, applied by the footer before it leads on, so a collection
   * that is ticked but never confirmed still counts. `canApply` only says whether there is anything to take over
   * — the footer's button stays available either way, the collection being optional.
   */
  private readonly handler: ApplyHandler = {
    apply: () => this.selector()?.apply(),
    canApply: computed(() => this.selector()?.canApply() ?? false)
  };

  constructor() {
    this.actionBar.registerApplyHandler(this.handler);
    void this.seedParent();
  }

  ngOnDestroy(): void {
    this.actionBar.clearApplyHandler(this.handler);
  }

  /**
   * Start the step with a folder already set — the user's default, else their inbox — since the control takes
   * none of its own and would otherwise open on "kein Speicherort". Only where the flow holds none: a folder
   * picked earlier is the user's statement about this content and must survive re-entering the step.
   */
  private async seedParent(): Promise<void> {
    if (this.curation.storageParent()) return;
    try {
      const parent = await this.repositoryNodes.defaultParent();
      if (!this.curation.storageParent()) this.curation.setStorageParent(parent);
    } catch {
      /* no folder to show — the control then asks for one, and the save falls back to the inbox */
    }
  }

  /** Record the folder the picker reports for the content. */
  protected chooseLocation(parent: Node): void {
    this.curation.setStorageParent(parent);
  }

  /**
   * Record the confirmed collections as the choice made here — replacing the previous one rather
   * than adding to it, so what the selector shows as ticked is what is recorded.
   */
  protected chooseCollections(collections: Collection[]): void {
    this.curation.setPersonalCollections(collections);
  }
}
