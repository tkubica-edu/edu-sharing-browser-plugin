import { Component, CUSTOM_ELEMENTS_SCHEMA, Input, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';

import { AuthService } from '../services/auth.service';
import { EduBundleService } from '../services/edu-bundle.service';
import { toApiRootUrl } from '../config';

// Renders the created node with <edu-sharing-preview-sidebar> used as a REAL custom
// element in the sidebar document (no iframe). The bundle is loaded once on demand by
// EduBundleService; the element is only placed once its tag is defined, so property
// bindings ([node]/[editorMode]) apply to an already-upgraded element.
//
// Contract: the element's `node` input is the full (hydrated) Node object — not an id
// — so the caller must already have the node loaded (see UploadService.getNode).
@Component({
  selector: 'es-preview-node',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './preview-node.component.html',
  styleUrl: './preview-node.component.scss',
  // Allow the unknown <edu-sharing-preview-sidebar> tag in this component's template.
  schemas: [CUSTOM_ELEMENTS_SCHEMA]
})
export class PreviewNodeComponent {
  private readonly auth = inject(AuthService);
  private readonly bundle = inject(EduBundleService);

  /** The hydrated Node object to preview. */
  @Input() node: unknown;

  /** True once the bundle is loaded and the custom element is defined. */
  readonly ready = signal(false);
  readonly error = signal<string | null>(null);

  constructor() {
    const api = toApiRootUrl(this.auth.state().repositoryUrl);
    this.bundle
      .load(api)
      .then(() => customElements.whenDefined('edu-sharing-preview-sidebar'))
      .then(() => this.ready.set(true))
      .catch((e: unknown) => this.error.set(String((e as Error)?.message || e)));
  }
}
