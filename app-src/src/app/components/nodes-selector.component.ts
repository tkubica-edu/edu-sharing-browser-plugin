import { ChangeDetectionStrategy, Component, CUSTOM_ELEMENTS_SCHEMA, computed, input } from '@angular/core';

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
    state: 'search' | 'collections';
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
// The tag is NOT gated on the async bundle load — the element must be able to upgrade with its
// inputs already in place, because a computed inside the bundle reads `option().optionConfig`
// unguarded as it connects. It IS wrapped in an `@if` (see the template): a conditional block
// creates the node detached, applies the bindings, and inserts it afterwards, so `option` is set
// before connectedCallback runs. Rendering it at the template root instead inserts it during the
// creation pass — before any binding — and that computed throws.
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
