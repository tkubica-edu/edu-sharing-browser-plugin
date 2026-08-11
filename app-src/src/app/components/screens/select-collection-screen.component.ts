import {
  ChangeDetectionStrategy, Component, OnDestroy, computed, inject, viewChild
} from '@angular/core';

import { Node } from 'ngx-edu-sharing-api';

import { IconDirective } from '../../directives/icon.directive';
import { ActionBarService, ApplyHandler } from '../../services/action-bar.service';
import { Collection } from '../../services/curation.service';
import { EditorialGroupsService } from '../../services/editorial-groups.service';
import { NavigationService } from '../../services/navigation.service';
import { CollectionSelectorComponent } from '../collection-selector.component';

// "Sammlung auswählen": which collection inside an editorial group the content is filed into. Entered
// from that group's row in "An Redaktionen weiterleiten", which is also where it returns to — the
// group it was entered for is held by EditorialGroupsService.picking.
//
// The confirmation sits in the panel's action bar rather than in the selector, so this step's two
// controls (the way back and the way on) are the same pair as everywhere else — the selector is
// driven through the handler this screen registers.
@Component({
  selector: 'es-select-collection-screen',
  imports: [CollectionSelectorComponent, IconDirective],
  templateUrl: './select-collection-screen.component.html',
  styleUrl: './select-collection-screen.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SelectCollectionScreenComponent implements OnDestroy {
  protected readonly groups = inject(EditorialGroupsService);

  private readonly actionBar = inject(ActionBarService);
  private readonly navigation = inject(NavigationService);

  private readonly selector = viewChild(CollectionSelectorComponent);

  /**
   * What the picker offers: the group this step was entered for and the collections inside it, so
   * what comes back really belongs to the group it is recorded for (see
   * EditorialGroup.collectionTree).
   *
   * A computed rather than a literal in the template: the selector compares this against the value
   * it last applied by identity and reloads its tree whenever it differs, so a fresh array on every
   * change detection would put it in a permanent reload.
   */
  protected readonly collectionTree = computed<readonly Node[] | undefined>(
    () => this.groups.picking()?.collectionTree,
  );

  /** The collection that is currently recorded for this group, if one was picked before. */
  protected readonly activeCollection = computed<Collection | undefined>(() => {
    const group = this.groups.picking();
    return group ? this.groups.folderOf(group) : undefined;
  });

  private readonly handler: ApplyHandler = {
    apply: () => this.selector()?.apply(),
    canApply: computed(() => this.selector()?.canApply() ?? false)
  };

  constructor() {
    this.actionBar.registerApplyHandler(this.handler);
  }

  ngOnDestroy(): void {
    this.actionBar.clearApplyHandler(this.handler);
  }

  /** Record the confirmed collection for the group and go back to the forwarding. */
  protected choose(collections: Collection[]): void {
    const group = this.groups.picking();
    const folder = collections[0];
    if (group && folder) this.groups.chooseFolder(group, folder);
    this.navigation.back();
  }
}
