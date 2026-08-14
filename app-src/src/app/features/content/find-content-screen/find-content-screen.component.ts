import {
  ChangeDetectionStrategy,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  OnInit,
  inject,
  signal
} from '@angular/core';
import { Node } from 'ngx-edu-sharing-api';

import { AuthService } from '../../../services/auth.service';
import { BrowserExtensionService } from '../../../services/browser-extension.service';
import { ContentSuggestionsService } from '../../../services/content-suggestions.service';
import { loadWebComponentBundle } from '../../../services/web-component-bundle.service';
import { LoginGateComponent } from '../../auth/login-gate/login-gate.component';

/** The element is only rendered once its tag is defined, so bindings hit an upgraded element. */
const SEARCH_TAG = 'edu-sharing-search';

// "Passende Inhalte finden": the OnlyOffice counterpart of "Inhalt suchen" — the search word is
// not typed but derived from the edited document (see ContentSuggestionsService: plugin content →
// metadata agent → keywords). Results are searched by <edu-sharing-search>, the embedded search
// with the metadata filters of the search page; double-clicking a result inserts it into the
// document, like the nodes selector does on the search screen.
@Component({
  selector: 'es-find-content-screen',
  imports: [LoginGateComponent],
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

  /** What the element's last query found; null until it reported a result. */
  protected readonly resultCount = signal<number | null>(null);

  ngOnInit(): void {
    // Opening the option is the request: read the document and derive its keywords. Skipped when
    // a previous visit already did — "Neu aus Dokument" repeats it explicitly.
    if (!this.suggestions.keywords().length) void this.suggestions.deriveFromOpenDocument();
  }

  protected refresh(): void {
    this.resultCount.set(null);
    void this.suggestions.deriveFromOpenDocument();
  }

  /**
   * The element reports every query's result count. Nothing found means the keywords are carried by
   * no node, so the search is widened once (fewer keywords match more) — the service's step is the
   * guard, so a second empty result simply leaves the notice to the template.
   */
  protected onTotalResults(event: Event): void {
    const total = Number((event as CustomEvent).detail ?? 0);
    // Widening re-runs the query, so the count is unknown again — otherwise the empty-result notice
    // would flash while the wider search is still running.
    this.resultCount.set(total === 0 && this.suggestions.relax() ? null : total);
  }

  /** Offered when even a single keyword found nothing: search the repository unfiltered. */
  protected searchWithoutKeywords(): void {
    this.resultCount.set(null);
    this.suggestions.searchWithoutKeywords();
  }

  /** A double-clicked result is inserted into the open document by the host page. */
  protected insert(event: Event): void {
    const node = (event as CustomEvent).detail as Node | null;
    if (node) this.browserExtension.insertNodes([node]);
  }
}
