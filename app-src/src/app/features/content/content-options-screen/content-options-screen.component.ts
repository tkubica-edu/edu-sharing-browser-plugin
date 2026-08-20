import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';

import { IconDirective } from '../../../directives/icon.directive';
import { SectionId } from '../../../model/navigation';
import { ConditionsService } from '../../../services/conditions.service';
import { ContentFlowService } from '../../../services/content-flow.service';
import { CurationService } from '../../../services/curation.service';
import { NavigationService } from '../../../services/navigation.service';
import { NodeConnectorService } from '../../../services/node-connector.service';
import { ContentCardComponent } from '../../../shared/components/content-card/content-card.component';
import { DetailsLinkComponent } from '../../../shared/components/details-link/details-link.component';

/**
 * One way on from a known content. `section` is the step it leads to and decides whether the option applies at
 * all; `icon` is the Material Symbols glyph the row is picked by — several options lead into the same section, so
 * each row names its own.
 */
interface ContentOption {
  section: SectionId;
  icon: string;
  label: string;
  description: string;
  run: () => void | Promise<void>;
  /**
   * The step is offered but cannot be taken yet — an earlier one unlocks it. Offered all the same, so
   * the set of ways on does not change under the user; {@link ContentOption.hint} says what is missing.
   */
  disabled?: boolean;
  /** Why the row cannot be taken, shown in place of its description while it is disabled. */
  hint?: string;
}

// "Inhaltsoptionen": the junction for a node the app already has, whether detected on the page or picked from the
// Verlauf or from the user's own contents. It offers the ways on as main-menu-style rows. "Inhalt bearbeiten"
// depends on the content rather than on the panel's state: it applies to one that opens in a connector, which the
// repository's connector list decides, so that row appears once the answer is in.
@Component({
  selector: 'es-content-options-screen',
  imports: [ContentCardComponent, DetailsLinkComponent, IconDirective],
  templateUrl: './content-options-screen.component.html',
  styleUrl: './content-options-screen.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ContentOptionsScreenComponent {
  protected readonly curation = inject(CurationService);
  protected readonly flow = inject(ContentFlowService);
  private readonly navigation = inject(NavigationService);
  private readonly conditions = inject(ConditionsService);
  private readonly nodeConnector = inject(NodeConnectorService);

  /**
   * Whether the content opens in a connector — the repository's connector list decides, so the
   * answer arrives asynchronously and the row waits for it. Re-asked for every content, and reset
   * first so the previous one's answer never shows for the new one.
   */
  private readonly opensInConnector = signal(false);

  constructor() {
    effect(() => {
      // The hydrated node, not the active-node summary: the connector matching reads its mimetype,
      // properties and access.
      const node = this.curation.previewNode();
      this.opensInConnector.set(false);
      if (!node) return;
      // Only *whether* there is one matters here; which one it is decides where editing navigates
      // to, and that is ContentFlowService's business.
      void this.nodeConnector.connectorFor(node).then((connector) => {
        // Only if it is still the same content — the answer may outlive it.
        if (this.curation.previewNode() === node) this.opensInConnector.set(connector !== null);
      });
    });
  }

  /**
   * The ways on that apply right now, in the order they are offered: looking at the content, working on it, passing
   * it on. Four lead to a *tab* of the Inhaltsübersicht, because those are separate errands. Editing waits for the
   * connector answer. Each option is checked against its target section, so none offers a refused step.
   */
  protected readonly options = computed<readonly ContentOption[]>(() => {
    const conditions = this.conditions.snapshot();
    // The metadata are a view of the Qualitätsprüfung, and that step decides when it opens.
    const metadataLocked = this.navigation.isTabDisabled('quality', 'metadata', conditions);
    const options: ContentOption[] = [
      {
        section: 'overview',
        icon: 'visibility',
        label: 'Vorschau anzeigen',
        description: 'Inhalt und hinterlegte Informationen ansehen',
        run: () => this.flow.showOverview()
      }
    ];
    if (this.opensInConnector()) {
      options.push({
        section: 'editing',
        icon: 'edit',
        label: 'Inhalt bearbeiten',
        description: 'Inhalt und hinterlegte Informationen bearbeiten',
        run: () => this.flow.edit()
      });
    }
    // The working steps in the order the flow walks them: where the content goes is settled before
    // it is described, and the Qualitätsprüfung is what ends with the save.
    options.push(
      {
        section: 'editorial-forward',
        icon: 'person_add',
        label: 'An Redaktion weiterleiten',
        description: 'Den Inhalt an eine oder mehrere Redaktionen weiterleiten',
        run: () => this.flow.showEditorialForward()
      },
      {
        section: 'personal-storage',
        icon: 'folder_open',
        label: 'Ablageort ändern',
        description: 'Inhalt in einer anderen persönlichen Ablage speichern',
        run: () => this.flow.showPersonalStorage()
      }
    );
    // The guided walk through the criteria, which exists only where the Qualität view it opens does:
    // the row is gated by that tab's own statement in the registry rather than by a second one here,
    // so the two can never disagree about when this errand applies. Where the view is absent the
    // section carries the Metadaten view alone, and describing the content is the one way on.
    if (this.navigation.isTabVisible('quality', 'quality-check', conditions)) {
      options.push({
        section: 'quality',
        icon: 'check_circle',
        label: 'Qualität prüfen',
        description: 'Qualitätskriterien kontrollieren und bestätigen',
        run: () => this.flow.showQuality()
      });
    }
    options.push(
      // The other view of that same step, for a content that only needs describing — the walk through
      // the criteria is an errand of its own, and so is this. It carries the tab's own gate: where the
      // criteria decide whether the content may be published, they are answered before it is described.
      {
        section: 'quality',
        icon: 'sell',
        label: 'Metadaten bearbeiten',
        description: 'Beschreibung des Inhalts ansehen und ändern',
        run: () => this.flow.showMetadata(),
        disabled: metadataLocked,
        // Named from where this row stands: from here the way to the metadata leads through the
        // Qualitätsprüfung. Which criteria that step asks for is its own business, and its tab says so.
        hint: metadataLocked ? 'Zuerst die Qualitätsprüfung durchführen.' : undefined
      },
      {
        section: 'overview',
        icon: 'bar_chart',
        label: 'Nutzung anzeigen',
        description: 'Letzte Aktivitäten anzeigen',
        run: () => this.flow.showUsages()
      },
      {
        section: 'overview',
        icon: 'share',
        label: 'Inhalt teilen',
        description: 'Link oder QR-Code erstellen und weitergeben',
        run: () => this.flow.showShare()
      }
    );
    // The exchange with the editorial teams, which only exists where a content is forwarded to them
    // at all: the row is gated by the tab's own statement in the registry rather than by a second one
    // here, so the two can never disagree about when this errand applies.
    if (this.navigation.isTabVisible('overview', 'interactions', conditions)) {
      options.push({
        section: 'overview',
        icon: 'forum',
        label: 'Interaktionen anzeigen',
        description: 'Rückmeldungen der Redaktionen zum Inhalt ansehen',
        run: () => this.flow.showInteractions()
      });
    }
    return options.filter((option) => this.navigation.isVisible(option.section, conditions));
  });
}
