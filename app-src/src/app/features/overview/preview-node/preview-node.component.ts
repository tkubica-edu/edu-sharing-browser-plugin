import { ChangeDetectionStrategy, Component, CUSTOM_ELEMENTS_SCHEMA, input } from '@angular/core';
import { Node } from 'ngx-edu-sharing-api';

import { loadWebComponentBundle } from '../../../services/web-component-bundle.service';

/** The element is only rendered once its tag is defined, so bindings hit an upgraded element. */
const PREVIEW_TAG = 'edu-sharing-preview-sidebar';

// Renders the active node with <edu-sharing-preview-sidebar> as a REAL custom element in the
// sidebar document (no iframe).
//
// Contract: the element's `node` input is the full (hydrated) Node object — not an id — so the
// caller must already have the node loaded (see RepositoryNodeService.get).
@Component({
  selector: 'es-preview-node',
  templateUrl: './preview-node.component.html',
  styleUrl: './preview-node.component.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class PreviewNodeComponent {
  /** The hydrated node to preview. */
  readonly node = input.required<Node>();

  protected readonly bundle = loadWebComponentBundle('edu', PREVIEW_TAG);
}
