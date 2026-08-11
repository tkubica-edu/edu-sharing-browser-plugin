import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

import { Collection } from '../services/curation.service';
import { NodesSelectorComponent, NodesSelectorOption, SelectedNode } from './nodes-selector.component';

// The shared nodes selector configured as a collection picker. The selector owns its apply button,
// so this component only reports the confirmed choice.
//
// Embedded by the forwarding step to pick a collection folder inside an editorial group
// (EditorialForwardScreenComponent); the "Persönliche Ablage" sub step is expected to build on it
// too, together with CurationService.assignToCollections.
@Component({
  selector: 'es-collection-selector',
  imports: [NodesSelectorComponent],
  templateUrl: './collection-selector.component.html',
  styleUrl: './collection-selector.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CollectionSelectorComponent {
  /** What the selector's own apply button is labelled after — what picking a collection does here. */
  readonly applyLabel = input('In Sammlung einfügen');

  /**
   * Whether exactly one collection may be confirmed. The selector has no single-selection mode (its
   * element takes no such input and its lists carry checkboxes), so `applyCallback` is the supported
   * way to say which selections count: a `false` disables its apply button and shows the reason as
   * its tooltip, so a second ticked collection blocks the step instead of being silently dropped.
   */
  readonly singleSelection = input(false);

  /**
   * The collections whose sub collections may be picked, by id — what makes a *collection folder*
   * selectable rather than merely open-able (see NodesSelectorComponent.parentCollections).
   */
  readonly parentCollections = input<readonly string[] | undefined>(undefined);

  /** The collection(s) the user confirmed via the selector's apply button. */
  readonly choose = output<Collection[]>();

  protected readonly hiddenTabs = ['search', 'workspace', 'upload'];

  protected readonly option = computed<NodesSelectorOption>(() => ({
    optionConfig: {
      state: 'collections',
      applyLabel: this.applyLabel(),
      autoClose: false,
      // Enable the apply button only once a collection is picked — exactly one where the caller
      // takes only one (see singleSelection).
      applyCallback: (nodes) =>
        Array.isArray(nodes) && (this.singleSelection() ? nodes.length === 1 : nodes.length > 0),
      onNodesChoosen: ({ nodes }) => this.choose.emit(this.toCollections(nodes))
    }
  }));

  /** Reduce the selected nodes to what adding a collection reference needs. */
  private toCollections(nodes: SelectedNode[] = []): Collection[] {
    return nodes
      .map((node) => ({ id: node.ref?.id ?? '', name: node.name ?? '' }))
      .filter((collection) => !!collection.id);
  }
}
