import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';

import { SectionId } from '../../model/navigation';
import { ConditionsService } from '../../services/conditions.service';
import { ContentFlowService } from '../../services/content-flow.service';
import { CurationService } from '../../services/curation.service';
import { NavigationService } from '../../services/navigation.service';
import { NodeConnectorService } from '../../services/node-connector.service';
import { IconId, OptionIconService } from '../../services/option-icon.service';
import { ContentCardComponent } from '../content-card.component';

/**
 * One way on from a known content. `section` is the step it leads to — its condition, and the icon
 * it is picked by unless `icon` names another: two of the options lead into the same section (its
 * Vorschau and its Freigabe), and a row is told apart by its icon before it is read.
 */
interface ContentOption {
  section: SectionId;
  icon?: IconId;
  label: string;
  description: string;
  run: () => void | Promise<void>;
}

// "Inhaltsoptionen": the junction for a node the app already has — detected on the page (a
// DOCUMENT_INFO from the OnlyOffice plugin, a content the repository holds for this URL), picked
// from the Verlauf, or picked from den eigenen Inhalten. It offers the ways on as main-menu-style
// rows.
//
// "Inhalt bearbeiten" is the one that depends on the content rather than on the panel's state: it
// applies to a content that opens in a connector, which the repository's connector list decides
// (see NodeConnectorService) — so the row appears once that answer is in.
@Component({
  selector: 'es-content-options-screen',
  imports: [ContentCardComponent],
  templateUrl: './content-options-screen.component.html',
  styleUrl: './content-options-screen.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ContentOptionsScreenComponent {
  protected readonly curation = inject(CurationService);
  protected readonly flow = inject(ContentFlowService);
  protected readonly icons = inject(OptionIconService);
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
   * The ways on that apply right now, in the order they are offered: looking at the content first,
   * then working on it, then passing it on.
   *
   * Two of them are a *tab* of a section rather than the section itself — the Vorschau and the
   * Freigabe of the Inhaltsübersicht. They are offered separately because they are separate errands:
   * looking at a content and handing it out are not the same visit, and neither should have to be
   * found behind the other's tab bar.
   *
   * Editing is offered for a content that opens in a connector — the repository's connector list
   * decides, so the row waits for that answer. What the row then does is not decided here:
   * {@link ContentFlowService.edit} opens the connector, or goes straight to the Bearbeitungsmodus
   * when the content is already open in it.
   *
   * Each option is checked against its target section as well, so none of them offers a step that
   * {@link NavigationService.go} would refuse.
   */
  protected readonly options = computed<readonly ContentOption[]>(() => {
    const conditions = this.conditions.snapshot();
    const options: ContentOption[] = [
      {
        section: 'overview',
        label: 'Inhaltsübersicht',
        description: 'Vorschau und Nutzung des Inhalts ansehen',
        run: () => this.flow.showOverview()
      },
      // The two working steps in the order the flow walks them: where the content goes is settled
      // before it is described, and the Qualitätsprüfung is what ends with the save.
      {
        section: 'collections',
        label: 'Einsortieren und weiterleiten',
        description: 'Den Inhalt weiterleiten und in der eigenen Ablage einsortieren',
        run: () => this.flow.showCollections()
      },
      {
        section: 'quality',
        label: 'Qualitätsprüfung',
        description: 'Qualität prüfen und Metadaten anreichern',
        run: () => this.flow.showQuality()
      }
    ];
    if (this.opensInConnector()) {
      options.push({
        section: 'editing',
        label: 'Inhalt bearbeiten',
        description: 'Im Connector öffnen und bearbeiten',
        run: () => this.flow.edit()
      });
    }
    options.push({
      section: 'overview',
      icon: 'share',
      label: 'Freigabe',
      description: 'Den Inhalt für andere freigeben',
      run: () => this.flow.showShare()
    });
    return options.filter((option) => this.navigation.isVisible(option.section, conditions));
  });
}
