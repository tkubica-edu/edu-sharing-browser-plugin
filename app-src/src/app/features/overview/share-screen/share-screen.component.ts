import {
  ChangeDetectionStrategy, Component, CUSTOM_ELEMENTS_SCHEMA, computed, inject, signal
} from '@angular/core';

import { CurationService } from '../../../services/curation.service';
import { loadWebComponentBundle } from '../../../services/web-component-bundle.service';

/** The element is only rendered once its tag is defined, so bindings hit an upgraded element. */
const SHARE_TAG = 'edu-sharing-share-qr';

/** Edge length of the code in the card — the element's default for the full variant. */
const QR_SIZE = 220;

/**
 * Largest the enlarged code is drawn. The panel can be dragged to nine tenths of the window (see
 * content/panel-host.js), and a code the height of a screen is no easier to scan than a hand-sized
 * one — past this the extra width only pushes the code out of a camera's frame.
 */
const ZOOM_MAX = 480;

/** What the enlarged code leaves free left and right, so it never sits flush against the panel. */
const ZOOM_INSET = 48;

// "Inhalt teilen": the link to the content plus its QR code, rendered by `<edu-sharing-share-qr>`, which brings the
// code, the link field and its copy control. The address is handed in as `link` rather than resolved by the
// element, which would load a node this session may not read; the flow holds it as `ActiveNode.link`. It is the
// node's own page, never a share link — creating one sets an unlimited expiry. The code can be laid enlarged over
// the panel, which spares holding a phone close to someone else's screen.
@Component({
  selector: 'es-share-screen',
  templateUrl: './share-screen.component.html',
  styleUrl: './share-screen.component.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    // On the document rather than on the overlay: the overlay is opened from a button that keeps the
    // focus, so a key pressed right after opening it never reaches the overlay itself.
    '(document:keydown.escape)': 'closeZoom()',
    // The panel is resizable, and the enlarged code is measured against its width.
    '(window:resize)': 'measureViewport()'
  }
})
export class ShareScreenComponent {
  protected readonly curation = inject(CurationService);

  protected readonly bundle = loadWebComponentBundle('edu', SHARE_TAG);

  protected readonly qrSize = QR_SIZE;

  /** The address to share; null while there is no content. */
  protected readonly link = computed(() => this.curation.activeNode()?.link || null);

  /** Whether the code is currently shown enlarged over the panel. */
  protected readonly zoomed = signal(false);

  /**
   * The panel's width: the app is an iframe docked in the page, so its viewport is the panel rather
   * than the tab.
   */
  private readonly viewportWidth = signal(window.innerWidth);

  /**
   * Edge length of the enlarged code: the panel's width, less the inset and bounded by
   * {@link ZOOM_MAX}.
   */
  protected readonly zoomSize = computed(() =>
    Math.max(QR_SIZE, Math.min(this.viewportWidth() - ZOOM_INSET, ZOOM_MAX))
  );

  protected openZoom(): void {
    this.measureViewport();
    this.zoomed.set(true);
  }

  protected closeZoom(): void {
    this.zoomed.set(false);
  }

  protected measureViewport(): void {
    this.viewportWidth.set(window.innerWidth);
  }
}
