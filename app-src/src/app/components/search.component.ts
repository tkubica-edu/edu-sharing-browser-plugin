import { Component, CUSTOM_ELEMENTS_SCHEMA, Input, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';

import { AuthService } from '../services/auth.service';
import { ExtService } from '../services/ext.service';
import { EduBundleService } from '../services/edu-bundle.service';
import { LoginComponent } from './login.component';
import { toApiRootUrl } from '../config';

// Embeds <edu-sharing-nodes-selector> as a REAL custom element (no iframe), opening on
// the SEARCH tab in "source" mode. The bundle is loaded once by EduBundleService.
//
// The tag is rendered behind `@if (option)` (a synchronous guard) rather than gated on
// the async bundle load: the element's `option` must be present when it connects,
// because a computed reads option().optionConfig unguarded on first render. Rendering
// with option already set — before the bundle upgrades the element — lets Angular set
// the property up front so it's in place on connect.
@Component({
  selector: 'es-search',
  standalone: true,
  imports: [CommonModule, LoginComponent],
  templateUrl: './search.component.html',
  styleUrl: './search.component.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA]
})
export class SearchComponent {
  readonly auth = inject(AuthService);
  private readonly ext = inject(ExtService);
  private readonly bundle = inject(EduBundleService);

  @Input() contextUrl: string | null = null;

  readonly error = signal<string | null>(null);

  readonly tabBlacklist = ['collections', 'upload'];

  // `parent` omitted → no auto-selected source node. The "Gewählten Inhalt kopieren"
  // button routes the selection through option.optionConfig.onNodesChoosen.
  readonly option = {
    option: 'SORT_INTO',
    trap: false,
    optionConfig: {
      state: 'search',
      onNodesChoosen: (payload: { nodes?: unknown[] }) => this.ext.insertNodes(payload?.nodes ?? [])
    }
  };

  constructor() {
    const api = toApiRootUrl(this.auth.state().repositoryUrl);
    this.bundle.load(api).catch((e: unknown) => this.error.set(String((e as Error)?.message || e)));
  }
}
