import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, inject, input, output,
  signal
} from '@angular/core';

import { Node } from 'ngx-edu-sharing-api';

import { Collection } from '../../../services/curation.service';
import { NodesSelectorComponent, NodesSelectorOption, SelectedNode } from '../../../shared/components/nodes-selector/nodes-selector.component';

/**
 * The apply control inside the embedded selector: the button of its own action bar that confirms the
 * selection. Everything but its back button, which carries `back-btn`.
 */
const APPLY_BUTTON = '.tab-action-bar button[mat-flat-button]:not(.back-btn)';

// The shared nodes selector configured as a collection picker. The selector owns its apply button, so this
// component only reports the confirmed choice — unless the caller takes that button over (see
// {@link CollectionSelectorComponent.externalApply}).
@Component({
  selector: 'es-collection-selector',
  imports: [NodesSelectorComponent],
  templateUrl: './collection-selector.component.html',
  styleUrl: './collection-selector.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.is-bare]': 'externalApply()'
  }
})
export class CollectionSelectorComponent {
  /** What the selector's own apply button is labelled after — what picking a collection does here. */
  readonly applyLabel = input('In Sammlung einfügen');

  /**
   * Whether exactly one collection may be confirmed. The selector has no single-selection mode, so `applyCallback`
   * is the supported way to say which selections count: a `false` disables its apply button and shows the reason,
   * so a second ticked collection blocks the step instead of being silently dropped.
   */
  readonly singleSelection = input(false);

  /**
   * The tree the picker offers instead of the selector's own — the group's collection node and the
   * ones inside it, as one flat list (see NodesSelectorComponent.collectionTree).
   */
  readonly collectionTree = input<readonly Node[] | undefined>(undefined);

  /**
   * Whether the confirmation lives outside this component, in the panel's action bar. The selector's own bar is
   * hidden then and the caller drives it through {@link canApply} and {@link apply}: the element offers no API for
   * this, so the outside button reads the state of its own button and clicks it.
   */
  readonly externalApply = input(false);

  /** The collection(s) the user confirmed via the apply button. */
  readonly choose = output<Collection[]>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  private readonly applyEnabled = signal(false);

  /** Whether a selection that may be confirmed exists — for a caller that owns the apply button. */
  readonly canApply = this.applyEnabled.asReadonly();

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

  constructor() {
    // The element renders its action bar only once something is selected, and disables its button
    // for a selection that does not count — so an outside button tracks both by watching the DOM.
    const observer = new MutationObserver(() => this.readApplyState());
    observer.observe(this.host.nativeElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['disabled', 'class']
    });
    inject(DestroyRef).onDestroy(() => observer.disconnect());
  }

  /** Confirm the current selection — the caller's apply button (see {@link externalApply}). */
  apply(): void {
    this.applyButton()?.click();
  }

  private readApplyState(): void {
    const button = this.applyButton();
    this.applyEnabled.set(!!button && !button.disabled);
  }

  private applyButton(): HTMLButtonElement | null {
    return this.host.nativeElement.querySelector<HTMLButtonElement>(APPLY_BUTTON);
  }

  /** Reduce the selected nodes to what adding a collection reference needs. */
  private toCollections(nodes: SelectedNode[] = []): Collection[] {
    return nodes
      .map((node) => ({ id: node.ref?.id ?? '', name: node.name ?? '' }))
      .filter((collection) => !!collection.id);
  }
}
