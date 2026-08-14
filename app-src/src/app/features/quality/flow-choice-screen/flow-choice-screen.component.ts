import { ChangeDetectionStrategy, Component, OnDestroy, computed, inject, signal } from '@angular/core';

import { SectionId } from '../../../model/navigation';
import { ActionBarService, ApplyHandler } from '../../../services/action-bar.service';
import { NavigationService } from '../../../services/navigation.service';

/** One of the ways the content can be checked, as the screen offers it. */
interface FlowOption {
  /** The step it leads into — its condition, and where the choice takes the user. */
  section: SectionId;
  label: string;
  description: string;
  /** What the card's own button says. Names the process being started, not the step it opens. */
  action: string;
}

// "Prüfprozess auswählen": the junction between the filing steps and the checking. The content is written by now,
// so the choice is only which of the two processes the user works through — the guided Qualitätsprüfung, or the
// AI dialogue whose step is still to be built. The card's button starts its process straight away, the footer's
// *Weiter* starts whichever card is selected; both are the same choice made in two ways.
@Component({
  selector: 'es-flow-choice-screen',
  templateUrl: './flow-choice-screen.component.html',
  styleUrl: './flow-choice-screen.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class FlowChoiceScreenComponent implements OnDestroy {
  private readonly navigation = inject(NavigationService);
  private readonly actionBar = inject(ActionBarService);

  /** The card the user marked; null until one is. */
  private readonly selected = signal<SectionId | null>(null);

  private readonly allOptions: readonly FlowOption[] = [
    {
      section: 'quality',
      label: 'Geführte Qualitätsprüfung',
      description:
        'Prüfe Qualitätskriterien und Metadaten Schritt für Schritt. KI unterstützt dich mit Vorschlägen.',
      action: 'Geführte Prüfung starten'
    },
    {
      section: 'ai-quality',
      label: 'Individuelle Qualitätsprüfung mit KI',
      description:
        'Lass deinen Inhalt von der KI anhand der Anforderungen der gewählten Sammlung analysieren und erhalte individuelle Empfehlungen im Dialog.',
      action: 'KI-Analyse starten'
    }
  ];

  /** Only what can be entered right now — the target step's own visibility decides, as everywhere. */
  protected readonly options = computed(() =>
    this.allOptions.filter((option) => this.navigation.isVisible(option.section)),
  );

  /** The way on the footer repeats: whichever card is selected. */
  private readonly handler: ApplyHandler = {
    apply: () => this.start(this.selected()),
    canApply: computed(() => this.selected() !== null)
  };

  constructor() {
    this.actionBar.registerApplyHandler(this.handler);
  }

  ngOnDestroy(): void {
    this.actionBar.clearApplyHandler(this.handler);
  }

  protected isSelected(option: FlowOption): boolean {
    return this.selected() === option.section;
  }

  /** Mark a card, so the footer's own way on knows which process it starts. */
  protected select(option: FlowOption): void {
    this.selected.set(option.section);
  }

  /**
   * Start a process: the card is marked as the one chosen and its step is opened. Marking it as well
   * as opening it keeps the two ways on saying the same thing — coming back from the step it opened
   * finds the choice as it was left.
   */
  protected start(section: SectionId | null): void {
    if (!section) return;
    this.selected.set(section);
    // The Qualitätsprüfung is entered on its first view, which is what its own step does too — the
    // criteria are what it is entered for, and the metadata are worked on off the back of them.
    this.navigation.go(section, section === 'quality' ? { tab: 'quality-check' } : undefined);
  }
}
