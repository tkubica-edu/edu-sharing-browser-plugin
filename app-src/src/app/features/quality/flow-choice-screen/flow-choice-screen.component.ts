import { ChangeDetectionStrategy, Component, OnDestroy, computed, inject, signal } from '@angular/core';

import { SectionId } from '../../../model/navigation';
import { ActionBarService, ApplyHandler } from '../../../services/action-bar.service';
import { NavigationService } from '../../../services/navigation.service';
import { resetChatSession } from '../../../util/chat-session';

/** One of the ways the content can be checked, as the screen offers it. */
interface FlowOption {
  /** The step it leads into — its condition, and where the choice takes the user. */
  section: SectionId;
  label: string;
  description: string;
}

// "Prüfprozess auswählen": the junction between the filing steps and the checking. The content is written by now,
// so the choice is only which of the two processes the user works through — the guided Qualitätsprüfung, or the
// AI dialogue whose step is still to be built. Marking a process does not start it; the footer's *Weiter* opens
// whichever one is marked, so this step has the same pair of controls as every other one.
@Component({
  selector: 'es-flow-choice-screen',
  templateUrl: './flow-choice-screen.component.html',
  styleUrl: './flow-choice-screen.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class FlowChoiceScreenComponent implements OnDestroy {
  private readonly navigation = inject(NavigationService);
  private readonly actionBar = inject(ActionBarService);

  /** The marked process — preset in the constructor, so the way on is open from the start. */
  private readonly selected = signal<SectionId | null>(null);

  private readonly allOptions: readonly FlowOption[] = [
    {
      section: 'quality',
      label: 'Strukturierte Qualitätsprüfung',
      description:
        'Prüfe Qualitätskriterien und Metadaten Schritt für Schritt. KI unterstützt dich mit Vorschlägen.'
    },
    {
      section: 'ai-quality',
      label: 'Individuelle Qualitätsprüfung mit KI',
      description:
        'Lass deinen Inhalt von der KI anhand der Anforderungen der gewählten Sammlung analysieren und erhalte individuelle Empfehlungen im Dialog.'
    }
  ];

  /** Only what can be entered right now — the target step's own visibility decides, as everywhere. */
  protected readonly options = computed(() =>
    this.allOptions.filter((option) => this.navigation.isVisible(option.section)),
  );

  /** The way on: the process that is marked, opened by the footer. */
  private readonly handler: ApplyHandler = {
    apply: () => this.open(this.selected()),
    canApply: computed(() => this.selected() !== null)
  };

  constructor() {
    this.actionBar.registerApplyHandler(this.handler);
    // The guided Qualitätsprüfung is the ordinary process, so it is marked to begin with — it heads
    // the list, and where it is not on offer the first process that is takes its place.
    this.selected.set(this.options()[0]?.section ?? null);
  }

  ngOnDestroy(): void {
    this.actionBar.clearApplyHandler(this.handler);
  }

  protected isSelected(option: FlowOption): boolean {
    return this.selected() === option.section;
  }

  /** Mark a process, so the footer's way on knows which step it opens. */
  protected select(option: FlowOption): void {
    this.selected.set(option.section);
  }

  /** Open the marked process's step. The mark stays, so coming back finds the choice as it was left. */
  private open(section: SectionId | null): void {
    if (!section) return;
    // The Qualitätsprüfung is entered on its first view, which is what its own step does too — the
    // criteria are what it is entered for, and the metadata are worked on off the back of them.
    this.navigation.go(section, section === 'quality' ? { tab: 'quality-check' } : undefined);
    // The KI check is a dialogue about this content, and the chat resumes whatever conversation local storage
    // still holds — the assistant's own screen's, or an earlier check's — which would still be on screen when
    // this one opens. Ended here, where the check is started, rather than in the step itself: the panel is
    // rebuilt on every page change and the step is re-entered with it, so a dialogue under way has to survive
    // that. Read off the step that actually opened, since the move is refused while a write is in flight.
    if (this.navigation.section() === 'ai-quality') {
      resetChatSession('the KI-Qualitätsprüfung is being started');
    }
  }
}
