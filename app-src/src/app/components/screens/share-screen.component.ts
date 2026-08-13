import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import { CurationService } from '../../services/curation.service';
import { IconDirective } from '../../directives/icon.directive';
import { QrCodeComponent } from '../qr-code.component';

/** Edge length of the code — as wide as the panel's card allows, so it is scanned off the screen. */
const QR_SIZE = 220;

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
@Component({
  selector: 'es-share-screen',
  imports: [IconDirective, QrCodeComponent],
  templateUrl: './share-screen.component.html',
  styleUrl: './share-screen.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
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

  private copiedTimer: ReturnType<typeof setTimeout> | null = null;

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
