import { ChangeDetectionStrategy, Component, CUSTOM_ELEMENTS_SCHEMA, computed, inject } from '@angular/core';

import { CurationService } from '../../services/curation.service';
import { loadWebComponentBundle } from '../../services/web-component-bundle.service';

/** The element is only rendered once its tag is defined, so bindings hit an upgraded element. */
const USAGES_TAG = 'edu-sharing-usages';

// "Aufrufe & Nutzung": the usage statistics of the active node, rendered by the repository's own
// <edu-sharing-usages> element (views, downloads, plays and where the node is embedded / in which
// collections it sits).
//
// Contract: the element's `nodes` input is a LIST of full (hydrated) Node objects — it reads
// `ref.id` and `mediatype` off them — so the screen waits for `CurationService.previewNode`, the
// node that is (re)loaded after every save, and passes it as a single-element array.
@Component({
  selector: 'es-usages-screen',
  templateUrl: './usages-screen.component.html',
  styleUrl: './usages-screen.component.scss',
  // Allow the unknown <edu-sharing-usages> tag in this component's template.
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class UsagesScreenComponent {
  protected readonly curation = inject(CurationService);

  protected readonly bundle = loadWebComponentBundle('edu', USAGES_TAG);

  /** The element takes a selection, not a single node — computed so the array is stable per node. */
  protected readonly nodes = computed(() => {
    const node = this.curation.previewNode();
    return node ? [node] : [];
  });
}
