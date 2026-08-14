import { ChangeDetectionStrategy, Component, CUSTOM_ELEMENTS_SCHEMA, computed, inject } from '@angular/core';

import { CurationService } from '../services/curation.service';
import { NavigationService } from '../services/navigation.service';
import { loadWebComponentBundle } from '../services/web-component-bundle.service';

/** The element is only rendered once its tag is defined, so bindings hit an upgraded element. */
const SHARE_TAG = 'edu-sharing-share-qr';

/**
 * Edge length of the code in the compact card. The element's own default for that variant, stated
 * here because the card is a thumbnail beside its link and the *Inhalt teilen* tab is where the same
 * code is shown large.
 */
const QR_SIZE = 104;

/**
 * The share offer above the Vorschau: the content's QR code, its link and the way to copy it, as
 * `<edu-sharing-share-qr>` renders them in its compact variant.
 *
 * The address is handed in (`link`) rather than left to the element to resolve: resolving means
 * loading the node, and a content written by the metadata agent is one the panel session may not read
 * (see CurationService.applySavedNode) — the card then stayed empty although the address had been
 * known since the save. Handed in, nothing is requested at all.
 *
 * The card is also the way into "Inhalt teilen", where the same code is shown large enough to be
 * scanned from further away — see {@link openShare}.
 */
@Component({
  selector: 'es-share-teaser',
  templateUrl: './share-teaser.component.html',
  styleUrl: './share-teaser.component.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(click)': 'openShare($event)'
  }
})
export class ShareTeaserComponent {
  private readonly curation = inject(CurationService);
  private readonly navigation = inject(NavigationService);

  protected readonly bundle = loadWebComponentBundle('edu', SHARE_TAG);

  protected readonly qrSize = QR_SIZE;

  /** The address the code stands for; null while there is no content to share. */
  protected readonly link = computed(() => this.curation.activeNode()?.link || null);

  /**
   * Open "Inhalt teilen" — the same section, so it is a tab change rather than a step.
   *
   * The card carries this rather than a button of its own: the element renders the code, the link
   * field and the copy button as one card, and a card that is a button could hold neither. So what
   * the element offers itself keeps its click, and the rest of the card leads on.
   */
  protected openShare(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (target?.closest('input, textarea, button, a')) return;
    this.navigation.goTab('share');
  }
}
