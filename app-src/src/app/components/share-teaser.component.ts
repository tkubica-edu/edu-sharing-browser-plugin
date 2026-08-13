import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { CurationService } from '../services/curation.service';
import { NavigationService } from '../services/navigation.service';
import { QrCodeComponent } from './qr-code.component';

/**
 * Edge length of the code in the card. Small enough to be a thumbnail beside its text, large enough
 * to be scanned — and the tab it leads to shows the same code at full size.
 */
const QR_SIZE = 104;

/**
 * The share offer as a card: the content's QR code, its address, and the way to "Inhalt teilen",
 * where both are shown in full.
 *
 * What it encodes is the link the flow already holds (`ActiveNode.link` — the node's page in the
 * repository, which the write reported or the panel derived). Nothing is requested for it: the
 * element edu-sharing brings for this resolves the address from a node id and therefore loads the
 * node, which fails for one the panel session may not read (see QrCodeComponent).
 */
@Component({
  selector: 'es-share-teaser',
  imports: [QrCodeComponent],
  templateUrl: './share-teaser.component.html',
  styleUrl: './share-teaser.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ShareTeaserComponent {
  private readonly curation = inject(CurationService);
  private readonly navigation = inject(NavigationService);

  protected readonly qrSize = QR_SIZE;

  /** The address the code stands for; null while there is no content to share. */
  protected readonly link = computed(() => this.curation.activeNode()?.link || null);

  /** Open "Inhalt teilen" — the same section, so it is a tab change rather than a step. */
  protected openShare(): void {
    this.navigation.goTab('share');
  }
}
