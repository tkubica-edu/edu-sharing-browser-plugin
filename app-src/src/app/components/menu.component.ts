import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { IconDirective } from '../directives/icon.directive';
import { SectionId } from '../model/navigation';
import { CurationService } from '../services/curation.service';
import { ContentCardComponent } from './content-card.component';
import { HistoryService } from '../services/history.service';
import { NavigationService, SectionView } from '../services/navigation.service';
import { OptionIconService } from '../services/option-icon.service';

// The main menu: the sections marked `menu`, filtered to those visible for the current conditions.
// It is the start view everywhere — nothing opens itself, so what is on offer stays visible.
// Selecting an entry navigates to its section.
//
// Two groups, not one list: the focal entry is the content of the open page and is shown as that — a
// card with the content's picture and name — the rest are rows. See AppSection.focal.
@Component({
  selector: 'es-menu',
  imports: [ContentCardComponent, IconDirective],
  templateUrl: './menu.component.html',
  styleUrl: './menu.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class MenuComponent {
  protected readonly navigation = inject(NavigationService);
  protected readonly icons = inject(OptionIconService);
  // For the Verlauf entry's count badge.
  protected readonly history = inject(HistoryService);
  // For what the focal card says about the content it shows — the card names it itself.
  private readonly curation = inject(CurationService);

  /** The centre of the menu, rendered as a card; empty when no focal section applies right now. */
  protected readonly focalSections = computed(() =>
    this.navigation.menuSections().filter((section) => section.focal),
  );

  /** Everything else, as rows. */
  protected readonly rowSections = computed(() =>
    this.navigation.menuSections().filter((section) => !section.focal),
  );

  /** Whether there is a content at all — which decides what the card's note says. */
  private readonly contentTitle = this.curation.contentTitle;

  /**
   * The content shown on the card exists only in the panel — curated, but never written to the
   * repository. Said on the card, because it otherwise looks exactly like one for a saved content:
   * same picture, same title. What is missing is the node behind them, and closing the panel loses it.
   */
  protected readonly unsaved = this.curation.hasUnsavedWork;

  /**
   * The step an unsaved draft belongs to, while there is one and it can be entered — `null` otherwise.
   * Checked against the registry rather than assumed, so the card never offers a target
   * {@link NavigationService.go} would refuse.
   */
  private readonly draftStep = computed<SectionId | null>(() =>
    this.unsaved() && this.navigation.isVisible('curation-preview') ? 'curation-preview' : null,
  );

  /**
   * The *Inhalt erschließen* entry as the menu renders it, for the state below: whether that step can
   * be entered is what decides whether the card may offer it — the registry's answer, not a second
   * reading of the conditions (it is disabled on Edu-Sharing's own pages, among others).
   */
  private readonly curationEntry = computed(() =>
    this.navigation.menuSections().find((section) => section.id === 'curation'),
  );

  /**
   * The open page is a content the repository does not hold yet: nothing was recognised, the
   * recognition has answered, and erschließen can be started here.
   *
   * Then the card is not the report of an absence but the offer to curate the page — a page that is
   * not in the repository is a *new* content, and the one thing to do with it is the step the card
   * then leads to. Where that step is not available the card stays the report, since there would be
   * nothing to offer.
   */
  protected newContent(section: SectionView): boolean {
    const curation = this.curationEntry();
    return (
      !this.contentTitle() && !this.unsaved() && !section.loading && !!curation && !curation.disabled
    );
  }

  /**
   * Where the card leads. Normally into the section it stands for; for a page that is not in the
   * repository into the erschließen step it offers; and while it carries an unsaved draft back into
   * that draft's own step — its picture and title are all there is of the content, and that step is
   * where they are worked on. Inhaltsoptionen could do nothing with it: everything it offers acts on
   * a node, which is exactly what a draft does not have yet.
   */
  protected cardTarget(section: SectionView): SectionId {
    if (this.newContent(section)) return 'curation';
    return this.draftStep() ?? section.id;
  }

  /** …and the card is enterable then, even though its own section is not (it wants a node). */
  protected cardDisabled(section: SectionView): boolean {
    return this.draftStep() || this.newContent(section) ? false : section.disabled;
  }

  /** What the card is called where the content cannot name it: the state it reports. */
  protected cardTitle(section: SectionView): string {
    return this.newContent(section) ? 'Neuer Inhalt erkannt' : section.label;
  }

  /** The step the card offers, for the one state in which it is an offer — see {@link newContent}. */
  protected cardAction(section: SectionView): string {
    return this.newContent(section) ? 'Inhalt jetzt erschließen' : '';
  }

  /** The sign for adding a content, in place of the kind of content there is none of yet. */
  protected cardIcon(section: SectionView): string {
    return this.newContent(section) ? 'add_circle' : '';
  }

  /**
   * What an entry says under its title. For one that cannot be entered that is the reason why —
   * which is the more useful of the two texts, and the one the user is owed.
   *
   * It used to be the button's `title` and so was never read: a disabled control takes no pointer
   * events, so the browser has nothing to show a tooltip for. Hence it is written out here.
   */
  protected entryDescription(section: SectionView): string {
    return (section.disabled && section.disabledHint) || section.description;
  }

  /**
   * What the card says under the title, where the card has something to say about itself: whether the
   * content is one the repository already holds or one that exists only here, and while the
   * recognition runs, that it runs. `null` leaves the line to entryDescription — the case where there
   * is no content and the reason for that is the more useful text.
   */
  protected cardNote(section: SectionView): string | null {
    if (this.unsaved()) return 'Neuer Inhalt';
    if (this.contentTitle()) return 'Bestehender Inhalt';
    return section.loading ? this.entryDescription(section) : null;
  }
}
