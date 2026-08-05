import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';

import { errorMessage } from '../../util/errors';
import { AuthService } from '../../services/auth.service';
import { CurationService } from '../../services/curation.service';
import { NavigationService } from '../../services/navigation.service';
import { LoginComponent } from '../login.component';
import { NodesSelectorComponent, NodesSelectorOption } from '../nodes-selector.component';

// "Eigene Inhalte": the shared nodes selector, restricted to the user's own workspace. The picked
// node becomes the app's active content — from there the flow is the same as for a detected or a
// history node, so the *Inhaltsoptionen* screen offers the ways on — which is why the selector's own
// button is labelled after that screen: picking a content here opens the choice, not the content.
//
// A collection can be picked as well as a file (`allowCollectionSelection`, see the template): both
// are content of the user's own, and which of the two it is only shows up further along the flow.
@Component({
  selector: 'es-own-content-screen',
  imports: [LoginComponent, NodesSelectorComponent],
  templateUrl: './own-content-screen.component.html',
  styleUrl: './own-content-screen.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class OwnContentScreenComponent {
  protected readonly auth = inject(AuthService);
  private readonly curation = inject(CurationService);
  private readonly navigation = inject(NavigationService);

  protected readonly error = signal<string | null>(null);
  protected readonly loading = signal(false);

  /**
   * The selector is configured exactly as on the search screen — the one configuration this bundle
   * is known to work under: same `state`, same `primaryMode` (see the template), and only the upload
   * tab hidden.
   *
   * Its own *Eigene Inhalte* tab is the workspace, so what this screen is for is one tab away.
   * Opening straight *on* that tab is what does not work: narrowing the selector down to the
   * workspace alone (hiding search and collections, `state: 'workspace'`) makes it throw inside the
   * bundle before it renders.
   *
   * The Sammlungen tab therefore stays visible for a second reason too: with
   * `allowCollectionSelection` there has to be a way to reach a collection in order to select it.
   */
  protected readonly hiddenTabs = ['upload'];

  // `parent` omitted → no auto-selected source node. The selector's own button routes the selection
  // through option.optionConfig.onNodesChoosen.
  protected readonly option: NodesSelectorOption = {
    option: 'SORT_INTO',
    trap: false,
    optionConfig: {
      state: 'search',
      applyLabel: 'Inhaltsoptionen öffnen',
      autoClose: false,
      // Exactly one: this screen opens *the* content the user picked, so a second one has nowhere
      // to go. The selector has no single-selection mode (its element takes no such input and its
      // lists carry checkboxes), but `applyCallback` is the supported way to say which selections
      // count: a `false` disables its apply button and shows the reason as its tooltip, so a second
      // ticked node blocks the step instead of being silently dropped.
      applyCallback: (nodes) => Array.isArray(nodes) && nodes.length === 1,
      onNodesChoosen: ({ nodes }) =>
        void (nodes?.length === 1 ? this.open(nodes[0]?.ref?.id) : undefined)
    }
  };

  /** Load the picked node into the flow and hand over to the *Inhaltsoptionen* screen. */
  private async open(nodeId: string | undefined): Promise<void> {
    if (!nodeId) return;
    this.error.set(null);
    this.loading.set(true);
    try {
      await this.curation.openNode(nodeId);
      this.navigation.go('content-options');
    } catch (cause: unknown) {
      this.error.set('Der Inhalt konnte nicht geladen werden: ' + errorMessage(cause));
    } finally {
      this.loading.set(false);
    }
  }
}
