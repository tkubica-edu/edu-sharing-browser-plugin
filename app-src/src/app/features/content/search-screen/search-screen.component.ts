import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { AuthService } from '../../../services/auth.service';
import { BrowserExtensionService } from '../../../services/browser-extension.service';
import { LoginGateComponent } from '../../auth/login-gate/login-gate.component';
import { NodesSelectorComponent, NodesSelectorOption } from '../../../shared/components/nodes-selector/nodes-selector.component';

// The shared nodes selector in search mode. The chosen nodes are posted to the host page, which inserts them.
// Used from two places, since picking content to insert is the same job in both: "Inhalt hinzufügen" and the
// Bearbeitungsmodus, where it sits next to the keyword-driven extended search.
@Component({
  selector: 'es-search-screen',
  imports: [LoginGateComponent, NodesSelectorComponent],
  templateUrl: './search-screen.component.html',
  styleUrl: './search-screen.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SearchScreenComponent {
  protected readonly auth = inject(AuthService);
  private readonly browserExtension = inject(BrowserExtensionService);

  // The collections tab stays visible: with allowCollectionSelection there has to be a way to
  // reach a collection in order to select it.
  protected readonly hiddenTabs = ['upload'];

  // `parent` omitted → no auto-selected source node. The selector's own button routes the
  // selection through option.optionConfig.onNodesChoosen.
  protected readonly option: NodesSelectorOption = {
    option: 'SORT_INTO',
    trap: false,
    optionConfig: {
      state: 'search',
      onNodesChoosen: ({ nodes }) => this.browserExtension.insertNodes(nodes ?? [])
    }
  };
}
