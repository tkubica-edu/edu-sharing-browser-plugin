import { ChangeDetectionStrategy, Component, output } from '@angular/core';

import { Collection } from '../services/curation.service';
import { NodesSelectorComponent, NodesSelectorOption, SelectedNode } from './nodes-selector.component';

// The shared nodes selector configured as a collection picker. The selector owns its apply button,
// so this component only reports the confirmed choice.
//
// Nothing embeds it at the moment: the screen it belonged to ("Einsortieren in Sammlungen") is now
// the "Persönliche Ablage" sub step, whose own component is supplied later — this is what that one
// is expected to build on, together with CurationService.assignToCollections.
@Component({
  selector: 'es-collection-selector',
  imports: [NodesSelectorComponent],
  templateUrl: './collection-selector.component.html',
  styleUrl: './collection-selector.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CollectionSelectorComponent {
  /** The collection(s) the user confirmed via the selector's apply button. */
  readonly choose = output<Collection[]>();

  protected readonly hiddenTabs = ['search', 'workspace', 'upload'];

  protected readonly option: NodesSelectorOption = {
    optionConfig: {
      state: 'collections',
      applyLabel: 'In Sammlung einfügen',
      autoClose: false,
      // Enable the apply button only once a collection is picked.
      applyCallback: (nodes) => Array.isArray(nodes) && nodes.length > 0,
      onNodesChoosen: ({ nodes }) => this.choose.emit(this.toCollections(nodes))
    }
  };

  /** Reduce the selected nodes to what adding a collection reference needs. */
  private toCollections(nodes: SelectedNode[] = []): Collection[] {
    return nodes
      .map((node) => ({ id: node.ref?.id ?? '', name: node.name ?? '' }))
      .filter((collection) => !!collection.id);
  }
}
