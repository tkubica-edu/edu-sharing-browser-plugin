import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import { CurationService } from '../services/curation.service';
import { HistoryService } from '../services/history.service';
import { NavigationService } from '../services/navigation.service';
import { OptionIconService } from '../services/option-icon.service';

// The main menu: the sections marked `menu`, filtered to those visible for the current conditions.
// It is the start view everywhere — nothing opens itself, so what is on offer stays visible.
// Selecting an entry navigates to its section.
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
  // For the recognised content's own preview on the *Inhalt erkannt* entry.
  private readonly curation = inject(CurationService);

  /** The preview URL that failed to load, so it is not tried again; null while none has. */
  private readonly brokenPreview = signal<string | null>(null);

  /**
   * The active content's picture (see CurationService.contentPreview), or null when the entry falls
   * back to its own icon — there is none, or the one there is could not be loaded.
   *
   * `isIcon` decides how it is rendered, not whether: a type icon is a transparent glyph rather than
   * a picture of the material, so it is shown at icon size and unframed — see `.mi-preview.is-icon`.
   */
  protected readonly contentPreview = computed(() => {
    const preview = this.curation.contentPreview();
    return preview && preview.url !== this.brokenPreview() ? preview : null;
  });

  /**
   * Fall back to the icon when the preview cannot be loaded — it is a repository URL the session may
   * not be allowed to read. Remembered by URL, not as a flag: the next content brings another one
   * (the preview endpoint carries a cache-buster), which is then tried on its own merits.
   */
  protected dropBrokenPreview(url: string): void {
    this.brokenPreview.set(url);
  }
}
