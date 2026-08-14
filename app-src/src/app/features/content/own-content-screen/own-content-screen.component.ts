import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';

import { errorMessage } from '../../../util/errors';
import { AuthService } from '../../../services/auth.service';
import { ContentFlowService } from '../../../services/content-flow.service';
import { CurationService } from '../../../services/curation.service';
import { LoginGateComponent } from '../../auth/login-gate/login-gate.component';
import { NodesSelectorComponent, NodesSelectorOption } from '../../../shared/components/nodes-selector/nodes-selector.component';

// "Meine Inhalte": the shared nodes selector, restricted to the user's own workspace. The picked node becomes the
// app's active content, from where the flow is the same as for a detected one — which is why the selector's button
// is labelled after the *Inhaltsoptionen* screen it opens. A collection can be picked as well as a file: both are
// content of the user's own.
@Component({
  selector: 'es-own-content-screen',
  imports: [LoginGateComponent, NodesSelectorComponent],
  templateUrl: './own-content-screen.component.html',
  styleUrl: './own-content-screen.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class OwnContentScreenComponent {
  protected readonly auth = inject(AuthService);
  private readonly curation = inject(CurationService);
  private readonly contentFlow = inject(ContentFlowService);

  protected readonly error = signal<string | null>(null);
  protected readonly loading = signal(false);

  /**
   * The selector is configured exactly as on the search screen — the one configuration this bundle is known to work
   * under, with only the upload tab hidden. Opening straight on the workspace tab makes the bundle throw before it
   * renders, and the Sammlungen tab has to stay reachable for `allowCollectionSelection`.
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

  /**
   * Load the picked node into the flow and hand over to the *Inhaltsoptionen* screen — which takes
   * the tab to that content's own page in the repository, see
   * {@link ContentFlowService.showContentOptions}.
   */
  private async open(nodeId: string | undefined): Promise<void> {
    if (!nodeId) return;
    this.error.set(null);
    this.loading.set(true);
    try {
      await this.curation.openNode(nodeId);
      await this.contentFlow.showContentOptions();
    } catch (cause: unknown) {
      this.error.set('Der Inhalt konnte nicht geladen werden: ' + errorMessage(cause));
    } finally {
      this.loading.set(false);
    }
  }
}
