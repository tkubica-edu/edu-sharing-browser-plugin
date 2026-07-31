import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { AuthService } from '../services/auth.service';
import { BrowserExtensionService } from '../services/browser-extension.service';
import { LoginComponent } from './login.component';
import { NodesSelectorComponent, NodesSelectorOption } from './nodes-selector.component';

// "Inhalt suchen": the shared nodes selector in search mode. The chosen nodes are posted to the
// host page (OnlyOffice), which inserts them.
@Component({
  selector: 'es-search',
  imports: [LoginComponent, NodesSelectorComponent],
  templateUrl: './search.component.html',
  styleUrl: './search.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SearchComponent {
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
