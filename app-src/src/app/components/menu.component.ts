import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import { CurationService } from '../services/curation.service';
import { HistoryService } from '../services/history.service';
import { NavigationService } from '../services/navigation.service';
import { OptionIconService } from '../services/option-icon.service';

// The main menu: the sections marked `menu`, filtered to those visible for the current conditions.
// It is the start view everywhere — nothing opens itself, so what is on offer stays visible.
// Selecting an entry navigates to its section.
//
// Two groups, not one list: the focal entry is the content of the open page and is shown as that — a
// card with the content's picture and name — the rest are rows. See AppSection.focal.
@Component({
  selector: 'es-menu',
  templateUrl: './menu.component.html',
  styleUrl: './menu.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class MenuComponent {
  protected readonly navigation = inject(NavigationService);
  protected readonly icons = inject(OptionIconService);
  // For the Verlauf entry's count badge.
  protected readonly history = inject(HistoryService);
  // For the recognised content's own picture and name on the focal card.
  private readonly curation = inject(CurationService);

  /** The centre of the menu, rendered as a card; empty when no focal section applies right now. */
  protected readonly focalSections = computed(() =>
    this.navigation.menuSections().filter((section) => section.focal),
  );

  /** Everything else, as rows. */
  protected readonly rowSections = computed(() =>
    this.navigation.menuSections().filter((section) => !section.focal),
  );

  /** The card's headline once there is a content. */
  protected readonly contentTitle = this.curation.contentTitle;

  /** The preview URL that failed to load, so it is not tried again; null while none has. */
  private readonly brokenPreview = signal<string | null>(null);

  /**
   * The content's picture (see CurationService.contentPreview), or null when the card falls back to the
   * section's icon. `isIcon` decides how it is rendered, not whether — see the stylesheet.
   */
  protected readonly contentPreview = computed(() => {
    const preview = this.curation.contentPreview();
    return preview && preview.url !== this.brokenPreview() ? preview : null;
  });

  /**
   * Fall back to the icon when the preview cannot be loaded — a foreign URL, or one this session may
   * not read. Remembered by URL, so the next content is tried on its own merits.
   */
  protected dropBrokenPreview(url: string): void {
    this.brokenPreview.set(url);
  }
}
