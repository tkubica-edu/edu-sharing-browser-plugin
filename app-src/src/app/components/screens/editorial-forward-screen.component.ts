import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import { IconDirective } from '../../directives/icon.directive';
import { Collection, CurationService, EditorialTarget } from '../../services/curation.service';
import { EditorialGroup, EditorialGroupsService } from '../../services/editorial-groups.service';
import { CollectionSelectorComponent } from '../collection-selector.component';
import { SpinnerComponent } from '../spinner.component';

// "An Redaktionen weiterleiten", the first sub step of "Einsortieren und weiterleiten": where the
// curated content is handed to one or more editorial teams. Offered only where the repository config
// enables the additional web component (see the `collections` section in the navigation registry).
//
// The groups on offer are the collections the config names (EditorialGroupsService). Ticking one
// forwards the content to it; where a group has collection folders, one of them can be picked and the
// content then goes into that folder instead (see EditorialTarget).
//
// Nothing is written here: the choice is held by the flow and carried out by the save at the end of
// the Qualitätsprüfung behind this step — which is also what creates the content in the first place,
// so this view works on a content that has no node yet (see CurationService.editorialTargets).
@Component({
  selector: 'es-editorial-forward-screen',
  imports: [CollectionSelectorComponent, IconDirective, SpinnerComponent],
  templateUrl: './editorial-forward-screen.component.html',
  styleUrl: './editorial-forward-screen.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    // The picker view fills the panel, the list view grows with its content — see the stylesheet.
    '[class.is-picking]': 'picking()'
  }
})
export class EditorialForwardScreenComponent {
  protected readonly curation = inject(CurationService);
  protected readonly groups = inject(EditorialGroupsService);

  /**
   * The group a collection folder is being picked for; `null` while the list of groups is shown. The
   * picker takes the whole screen — it is the selector's own tabbed UI, which needs the room, and the
   * choice belongs to exactly one group.
   */
  protected readonly picking = signal<EditorialGroup | null>(null);

  /**
   * The collection the picker may pick *inside* — the group it was opened for and only that one, so
   * the folder that comes back really belongs to the group it is recorded for.
   *
   * A computed rather than a literal in the template: the selector compares this against the value it
   * last applied by identity and reloads its tree whenever it differs, so a fresh array on every
   * change detection would put it in a permanent reload.
   */
  protected readonly pickerParents = computed<readonly string[] | undefined>(() => {
    const group = this.picking();
    return group ? [group.collection.id] : undefined;
  });

  constructor() {
    // Reads the config and loads the collections once per session (see EditorialGroupsService.load).
    void this.groups.load();
  }

  /** Whether the content is being forwarded to this group. */
  protected isSelected(group: EditorialGroup): boolean {
    return !!this.targetOf(group);
  }

  /** The collection folder picked for this group, if any. */
  protected folderOf(group: EditorialGroup): Collection | undefined {
    return this.targetOf(group)?.folder;
  }

  /** Forward to this group, or stop doing so — the checkbox's answer. */
  protected toggle(group: EditorialGroup, selected: boolean): void {
    if (!selected) {
      // The picked folder goes with it: it was a choice about a forwarding that is no longer made.
      this.write(this.others(group));
      return;
    }
    this.write([...this.others(group), { group: group.collection }]);
  }

  /** Open the folder picker for a group. */
  protected openFolderPicker(group: EditorialGroup): void {
    this.picking.set(group);
  }

  protected cancelPicking(): void {
    this.picking.set(null);
  }

  /**
   * Take the picked folder over: the content is forwarded into it rather than into the group's own
   * collection. Picking one selects the group as well — going and choosing a folder inside it is the
   * clearer statement of the two, and a choice that left the group unticked would take no effect.
   */
  protected chooseFolder(collections: Collection[]): void {
    const group = this.picking();
    const folder = collections[0];
    this.picking.set(null);
    if (!group || !folder) return;
    this.write([...this.others(group), { group: group.collection, folder }]);
  }

  private targetOf(group: EditorialGroup): EditorialTarget | undefined {
    return this.curation
      .editorialTargets()
      .find((target) => target.group.id === group.collection.id);
  }

  /** The forwardings to every group but this one — what a change to it leaves alone. */
  private others(group: EditorialGroup): EditorialTarget[] {
    return this.curation
      .editorialTargets()
      .filter((target) => target.group.id !== group.collection.id);
  }

  /**
   * Hand the choice to the flow, in the order the groups are listed rather than in the order they
   * were ticked — the list is what the user reads it back off.
   */
  private write(targets: readonly EditorialTarget[]): void {
    const order = this.groups.groups().map((group) => group.collection.id);
    this.curation.setEditorialTargets(
      [...targets].sort((a, b) => order.indexOf(a.group.id) - order.indexOf(b.group.id)),
    );
  }
}
