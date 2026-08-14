import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import { CurationService } from '../../services/curation.service';
import { IconDirective } from '../../directives/icon.directive';
import { QrCodeComponent } from '../qr-code.component';

/** Edge length of the code — as wide as the panel's card allows, so it is scanned off the screen. */
const QR_SIZE = 220;

/**
 * Largest the enlarged code is drawn. The panel can be dragged to nine tenths of the window (see
 * content/panel-host.js), and a code the height of a screen is no easier to scan than a hand-sized
 * one — past this the extra width only pushes the code out of a camera's frame.
 */
const ZOOM_MAX = 480;

/** What the enlarged code leaves free left and right, so it never sits flush against the panel. */
const ZOOM_INSET = 48;

/** How long the copy confirmation stays on the button. */
const COPIED_MS = 2000;

// "Inhalt teilen": the link to the content plus its QR code, both from the address the flow already
// holds (`ActiveNode.link` — the node's page in the repository).
//
// Nothing is requested for either. The element edu-sharing brings for this,
// `<edu-sharing-share-qr>`, takes a node *id* and resolves the address itself, which means it loads
// the node: for a content written by the metadata agent the panel session may not read that node
// (see CurationService.applySavedNode) and the whole card stayed empty — although the address was
// known from the moment the content was saved. So the code is encoded here (QrCodeComponent) and
// the link is written out as it is.
//
// It is the node's own page, never a share link: creating one has an unlimited expiry as a side
// effect, which sharing a *view* of the content must not do.
//
// The code can be pressed to lay it enlarged over the panel: at the card's size it is scanned from
// arm's length, and holding a phone that close to someone else's screen is what the enlarged one
// spares.
@Component({
  selector: 'es-share-screen',
  imports: [IconDirective, QrCodeComponent],
  templateUrl: './share-screen.component.html',
  styleUrl: './share-screen.component.scss',
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

  protected readonly qrSize = QR_SIZE;

  /** The address to share; null while there is no content. */
  protected readonly link = computed(() => this.curation.activeNode()?.link || null);

  /** Set for a moment after the link was copied, so the button reports that it happened. */
  protected readonly copied = signal(false);

  /** Set when the clipboard refused the link — the field is still there to copy by hand. */
  protected readonly copyError = signal(false);

  /** Whether the code is currently shown enlarged over the panel. */
  protected readonly zoomed = signal(false);

  /**
   * The panel's width: the app is an iframe docked in the page, so its viewport is the panel rather
   * than the tab.
   */
  private readonly viewportWidth = signal(window.innerWidth);

  /**
   * Edge length of the enlarged code: the panel's width, less the inset and bounded by {@link
   * ZOOM_MAX}. Measured rather than left to CSS because the code carries its edge length as an
   * inline style, which no stylesheet rule can scale down without distorting its square.
   */
  protected readonly zoomSize = computed(() =>
    Math.max(QR_SIZE, Math.min(this.viewportWidth() - ZOOM_INSET, ZOOM_MAX))
  );

  private copiedTimer: ReturnType<typeof setTimeout> | null = null;

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

  protected async copy(): Promise<void> {
    const link = this.link();
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      this.copyError.set(false);
      this.copied.set(true);
      if (this.copiedTimer) clearTimeout(this.copiedTimer);
      this.copiedTimer = setTimeout(() => this.copied.set(false), COPIED_MS);
    } catch (cause: unknown) {
      console.warn('[share] Der Link konnte nicht kopiert werden', cause);
      this.copied.set(false);
      this.copyError.set(true);
    }
  }
}
