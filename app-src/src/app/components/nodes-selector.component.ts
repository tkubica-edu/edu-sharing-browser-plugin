import { ChangeDetectionStrategy, Component, CUSTOM_ELEMENTS_SCHEMA, computed, input } from '@angular/core';
import { Node } from 'ngx-edu-sharing-api';

import { loadWebComponentBundle } from '../services/web-component-bundle.service';

/** Minimal shape of the edu-sharing Node objects the selector hands back. */
export interface SelectedNode {
  ref?: { id?: string };
  name?: string;
}

/**
 * The `option` object the selector is configured with. Its contract is callback-based:
 * `onNodesChoosen` receives the confirmed selection, `applyCallback` enables the apply button.
 */
export interface NodesSelectorOption {
  option?: string;
  trap?: boolean;
  optionConfig: {
    /**
     * The tab the selector opens on. It MUST be one the selector actually offers — the tab is
     * looked up in its own supported list, so a value that is blacklisted here (or unsupported in
     * the current selection mode) selects nothing and the element renders empty. `'workspace'` is
     * accepted by the element but has not proven usable as an opening tab (see
     * OwnContentScreenComponent).
     */
    state: 'search' | 'collections' | 'workspace';
    applyLabel?: string;
    autoClose?: boolean;
    /** Let collection nodes be selected, not just opened. Set from the component input. */
    allowCollectionSelection?: boolean;
    applyCallback?: (nodes: unknown[]) => boolean;
    onNodesChoosen: (payload: { nodes?: SelectedNode[] }) => void;
  };
}

// Embeds <edu-sharing-nodes-selector> as a REAL custom element (no iframe). Shared by every
// screen that picks nodes (searching for content, choosing a collection); the caller supplies
// the option config and the tabs to hide.
//
// The tag is NOT gated on the async bundle load — the element must upgrade with its inputs already
// in place, because a computed inside the bundle reads `option().optionConfig` unguarded as it
// connects. It IS wrapped in an `@if` (see the template): a conditional block creates the node
// detached, binds it, and inserts it afterwards. At the template root it would be inserted during
// the creation pass, before any binding, and that computed throws.
@Component({
  selector: 'es-nodes-selector',
  templateUrl: './nodes-selector.component.html',
  styleUrl: './nodes-selector.component.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class NodesSelectorComponent {
  readonly option = input.required<NodesSelectorOption>();
  readonly tabBlacklist = input.required<readonly string[]>();
  readonly primaryMode = input.required<string>();
  /**
   * Whether a collection can be picked as a selection. Off by default, where clicking a
   * collection only opens it; with it on, collections are selectable like any other node and
   * come back through `onNodesChoosen`.
   */
  readonly allowCollectionSelection = input(false);
  /**
   * The tree the Sammlungen tab shows instead of the one it builds itself — which is what narrows
   * the pick to one editorial group (see SelectCollectionScreenComponent).
   *
   * Tree *data*, not a list of ids: the element hands the value straight to its tree data source,
   * which builds the hierarchy from each node's `parent.id`. So it takes the collection nodes
   * themselves, in one flat list — the group's own first and the ones inside it after it. A value
   * holding only the roots is a tree of roots, not a tree that loads the rest on demand.
   *
   * `undefined` when the caller names none, which is the value the element sees when nobody sets the
   * property at all: every other screen embeds the selector without it.
   */
  readonly collectionTree = input<readonly Node[] | undefined>(undefined);
  /** Message shown when the bundle cannot be loaded. */
  readonly errorLabel = input('Auswahl konnte nicht geladen werden');

  protected readonly bundle = loadWebComponentBundle('edu');

  /** The caller's option with the selection flags this component owns merged in. */
  protected readonly selectorOption = computed<NodesSelectorOption>(() => {
    const option = this.option();
    return {
      ...option,
      optionConfig: {
        ...option.optionConfig,
        allowCollectionSelection: this.allowCollectionSelection()
      }
    };
  });
}
