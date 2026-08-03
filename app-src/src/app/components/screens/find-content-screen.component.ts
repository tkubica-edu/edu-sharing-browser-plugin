import { ChangeDetectionStrategy, Component, CUSTOM_ELEMENTS_SCHEMA, OnInit, inject } from '@angular/core';
import { Node } from 'ngx-edu-sharing-api';

import { AuthService } from '../../services/auth.service';
import { BrowserExtensionService } from '../../services/browser-extension.service';
import { ContentSuggestionsService } from '../../services/content-suggestions.service';
import { loadWebComponentBundle } from '../../services/web-component-bundle.service';
import { LoginComponent } from '../login.component';

/** The element is only rendered once its tag is defined, so bindings hit an upgraded element. */
const SEARCH_TAG = 'edu-sharing-search';

// "Passende Inhalte finden": the OnlyOffice counterpart of "Inhalt suchen" — the search word is
// not typed but derived from the edited document (see ContentSuggestionsService: plugin content →
// metadata agent → keywords). Results are searched by <edu-sharing-search>, the embedded search
// with the metadata filters of the search page; double-clicking a result inserts it into the
// document, like the nodes selector does on the search screen.
@Component({
  selector: 'es-find-content-screen',
  imports: [LoginComponent],
  templateUrl: './find-content-screen.component.html',
  styleUrl: './find-content-screen.component.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class FindContentScreenComponent implements OnInit {
  protected readonly auth = inject(AuthService);
  protected readonly suggestions = inject(ContentSuggestionsService);
  private readonly browserExtension = inject(BrowserExtensionService);

  protected readonly bundle = loadWebComponentBundle('edu', SEARCH_TAG);

  ngOnInit(): void {
    // Opening the option is the request: read the document and derive its keywords. Skipped when
    // a previous visit already did — "Neu aus Dokument" repeats it explicitly.
    if (!this.suggestions.keywords().length) void this.suggestions.deriveFromOpenDocument();
  }

  protected refresh(): void {
    void this.suggestions.deriveFromOpenDocument();
  }

  /** A double-clicked result is inserted into the open document by the host page. */
  protected insert(event: Event): void {
    const node = (event as CustomEvent).detail as Node | null;
    if (node) this.browserExtension.insertNodes([node]);
  }
}
