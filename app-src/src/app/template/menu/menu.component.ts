import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { IconDirective } from '../../directives/icon.directive';
import { SectionId } from '../../model/navigation';
import { CurationService } from '../../services/curation.service';
import { ContentCardComponent } from '../../shared/components/content-card/content-card.component';
import { HistoryService } from '../../services/history.service';
import { NavigationService, SectionView } from '../../services/navigation.service';
import { OptionIconService } from '../../services/option-icon.service';

// The main menu: the sections marked `menu` that are visible for the current conditions. It is the start view
// everywhere, so what is on offer stays visible. Two groups rather than one list — the focal entry is the
// content of the open page and shown as a card, the rest are rows (see AppSection.focal).
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
   * An Erschließung whose content no node stands for: the run is all there is of it. Beside the
   * unsaved draft, this is a content whose save left the panel without a node — the agent's route
   * answers without one where it merely updated, and a dev-mode run writes nothing at all.
   */
  private readonly nodeless = computed(
    () => this.curation.hasCuratedResult() && !this.curation.activeNode(),
  );

  /**
   * The step such a content belongs to, while there is one and it can be entered — `null` otherwise.
   * Checked against the registry rather than assumed, so the card never offers a target
   * {@link NavigationService.go} would refuse. It is the only way back into a content the
   * Inhaltsoptionen cannot take: those work on a node, and this content has none.
   */
  private readonly draftStep = computed<SectionId | null>(() =>
    (this.unsaved() || this.nodeless()) && this.navigation.isVisible('curation-preview')
      ? 'curation-preview'
      : null,
  );

  /**
   * The step an unfinished Erschließung would be continued at, while the card is that offer — see
   * {@link activateCard}. Null where the card leads somewhere else: a page not yet curated, a draft with
   * no node, or a content whose Erschließung was never left unfinished.
   *
   * Held as the state itself rather than as its name, since both the note under the card and the walk the
   * card makes are this one answer — asked once, so they cannot come apart.
   */
  private readonly resumeState = computed(() =>
    !this.draftStep() && this.curation.curationUnfinished()
      ? this.navigation.resumableStep(this.curation.leftAtStep())
      : null,
  );

  /**
   * What that step is called, for the line that says where continuing would lead. Null while the card is
   * not that offer, which is also what takes the line off the screen.
   */
  protected readonly resumeStepLabel = computed(() => {
    const step = this.resumeState();
    return step ? this.navigation.stepLabel(step) || null : null;
  });

  /**
   * The *Inhalt erschließen* entry as the menu renders it, for the state below: whether that step can
   * be entered is what decides whether the card may offer it — the registry's answer, not a second
   * reading of the conditions (it is disabled on Edu-Sharing's own pages, among others).
   */
  private readonly curationEntry = computed(() =>
    this.navigation.menuSections().find((section) => section.id === 'curation'),
  );

  /**
   * Whether the open page is a content the repository does not hold yet: nothing recognised, the recognition
   * answered, and erschließen available. The card is then the offer to curate the page rather than the report
   * of an absence.
   */
  protected newContent(section: SectionView): boolean {
    const curation = this.curationEntry();
    return (
      !this.contentTitle() && !this.unsaved() && !section.loading && !!curation && !curation.disabled
    );
  }

  /**
   * Where the card leads: into its own section, into the erschließen step for a page the repository does not
   * hold, or back into an unsaved draft's step, whose picture and title are all there is of the content.
   * Inhaltsoptionen could do nothing with a draft — everything it offers acts on a node.
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

  /**
   * Open what the card stands for: an Erschließung that was left unfinished continues at the step it was left
   * on, since that is what the card offers ({@link cardNote}) — and every other content goes where
   * {@link cardTarget} says. The remembered step is only taken where it can be opened again: one that no
   * longer applies, or that would start something rather than show it, hands over to the target as well.
   */
  protected activateCard(section: SectionView): void {
    const left = this.resumeState();
    if (left) this.navigation.go(left.section, { tab: left.tab ?? undefined });
    else this.navigation.go(this.cardTarget(section));
  }

  /**
   * Open the Inhaltsoptionen for the content the card shows, instead of continuing its Erschließung.
   * Offered beside the card because the card can only do one thing when pressed, and continuing is not
   * always what is wanted of a content that was left half-described — looking at it, filing it or handing
   * it on are all reached from there.
   *
   * The focal card *is* the Inhaltsoptionen (`focal` in the registry), so this is where the card leads
   * whenever it is not the offer to continue.
   */
  protected openContentOptions(): void {
    this.navigation.go('content-options');
  }

  /** The sign for adding a content, in place of the kind of content there is none of yet. */
  protected cardIcon(section: SectionView): string {
    return this.newContent(section) ? 'add_circle' : '';
  }

  /**
   * What an entry says under its title: for one that cannot be entered, the reason why. Written into the line
   * rather than offered as the button's `title`, since a disabled control takes no pointer events.
   */
  protected entryDescription(section: SectionView): string {
    return (section.disabled && section.disabledHint) || section.description;
  }

  /**
   * What the card says under the title where it has something to say about itself: whether the content is one
   * the repository holds or one that exists only here, whether its Erschließung is still to be carried to its
   * end, and that the recognition is running. Null leaves the line to {@link entryDescription}, whose reason
   * is the more useful text then.
   */
  protected cardNote(section: SectionView): string | null {
    if (this.unsaved()) return 'Neuer Inhalt';
    if (this.contentTitle()) {
      // Only where the panel knows this content was left unfinished — see
      // CurationService.curationUnfinished; for every other one the plain statement stands.
      return this.curation.curationUnfinished()
        ? 'Bestehender Inhalt – Erschließung fortfahren'
        : 'Bestehender Inhalt';
    }
    return section.loading ? this.entryDescription(section) : null;
  }
}
