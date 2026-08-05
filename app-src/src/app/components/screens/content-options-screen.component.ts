import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';

import { SectionId } from '../../model/navigation';
import { ConditionsService } from '../../services/conditions.service';
import { ContentFlowService } from '../../services/content-flow.service';
import { CurationService } from '../../services/curation.service';
import { NavigationService } from '../../services/navigation.service';
import { NodeConnectorService } from '../../services/node-connector.service';
import { OptionIconService } from '../../services/option-icon.service';

/** One way on from a known content. `section` is the step it leads to — its icon, and its condition. */
interface ContentOption {
  section: SectionId;
  label: string;
  description: string;
  run: () => void | Promise<void>;
}

// "Inhaltsoptionen": the junction for a node the app already has — detected on the page (a
// DOCUMENT_INFO from the OnlyOffice plugin, a content the repository holds for this URL), picked
// from the Verlauf, or picked from den eigenen Inhalten. It offers the ways on as main-menu-style
// rows.
//
// "Bearbeitungsmodus" is the one that depends on the content rather than on the panel's state: it
// applies to a content that opens in a connector, which the repository's connector list decides
// (see NodeConnectorService) — so the row appears once that answer is in.
@Component({
  selector: 'es-content-options-screen',
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
   * The ways on that apply right now, in the order they are offered.
   *
   * The Bearbeitungsmodus is offered for a content that opens in a connector, and on the insert host
   * itself — there the editor is on screen, which is that same statement made by the page. Either way
   * the editor is already open by the time this screen is reached, so the row only enters the panel
   * step (see {@link ContentFlowService.enterEditing}).
   *
   * Each option is checked against its target section as well, so none of them offers a step that
   * {@link NavigationService.go} would refuse.
   */
  protected readonly options = computed<readonly ContentOption[]>(() => {
    const conditions = this.conditions.snapshot();
    const options: ContentOption[] = [];
    if (this.opensInConnector() || conditions.onlyOfficePresent) {
      options.push({
        section: 'editing',
        label: 'Bearbeitungsmodus',
        description: 'Inhalte suchen und in das Dokument einfügen',
        run: () => this.flow.enterEditing()
      });
    }
    options.push(
      {
        section: 'quality',
        label: 'Qualitätssicherung',
        description: 'Metadaten anreichern und Sammlungen zuordnen',
        run: () => this.flow.showQuality()
      },
      {
        section: 'overview',
        label: 'Inhaltsübersicht',
        description: 'Vorschau, Nutzung und Teilen des Inhalts',
        run: () => this.flow.showOverview()
      },
    );
    return options.filter((option) => this.navigation.isVisible(option.section, conditions));
  });
}
