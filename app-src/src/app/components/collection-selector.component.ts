import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Output, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';

import { AuthService } from '../services/auth.service';
import { EduBundleService } from '../services/edu-bundle.service';
import { toApiRootUrl } from '../config';

/** A collection the user picked in the selector. */
export interface CollectionChoice {
  id: string;
  name: string;
}

/** Minimal shape of the edu-sharing Node objects the selector hands back. */
interface NodeLike {
  ref?: { id?: string };
  name?: string;
}

// Embeds <edu-sharing-nodes-selector> as a REAL custom element (no iframe), configured
// as a collection picker (Collections tab). The bundle is loaded once by
// EduBundleService.
//
// Rendered behind `@if (option)` (a synchronous guard) rather than gated on the async
// bundle load: the element's `option` must be present when it connects (a computed reads
// option().optionConfig unguarded on first render), so it's rendered with option set.
@Component({
  selector: 'es-collection-selector',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './collection-selector.component.html',
  styleUrl: './collection-selector.component.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA]
})
export class CollectionSelectorComponent {
  private readonly auth = inject(AuthService);
  private readonly bundle = inject(EduBundleService);

  // Emits the collection(s) the user confirmed via the selector's apply button.
  @Output() choose = new EventEmitter<CollectionChoice[]>();

  readonly error = signal<string | null>(null);

  // Restrict the selector to the Collections tab.
  readonly tabBlacklist = ['search', 'workspace', 'upload'];

  readonly option = {
    optionConfig: {
      state: 'collections',
      applyLabel: 'In Sammlung einfügen',
      autoClose: false,
      // Enable the apply button only once a collection is picked.
      applyCallback: (nodes: unknown[]) => Array.isArray(nodes) && nodes.length > 0,
      // Confirm hook → emit the chosen collection(s) to the sidebar.
      onNodesChoosen: (e: { nodes?: NodeLike[] }) => this.choose.emit(this.toChoice(e?.nodes))
    }
  };

  constructor() {
    const api = toApiRootUrl(this.auth.state().repositoryUrl);
    this.bundle.load(api).catch((e: unknown) => this.error.set(String((e as Error)?.message || e)));
  }

  // Reduce Node objects to the minimal shape needed to add a collection reference.
  private toChoice(nodes?: NodeLike[]): CollectionChoice[] {
    return (nodes ?? [])
      .map((n) => ({ id: n?.ref?.id ?? '', name: n?.name ?? '' }))
      .filter((c) => !!c.id);
  }
}
