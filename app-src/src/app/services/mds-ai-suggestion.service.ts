import { Injectable, inject } from '@angular/core';
import { HOME_REPOSITORY, MdsDefinition, MdsService, MdsWidget } from 'ngx-edu-sharing-api';
import {
  EduSharingLlmService, EduSharingLlmWidgetAiConfigRequest, WidgetAiConfigInfo
} from 'ngx-edu-sharing-b-api';
import { firstValueFrom } from 'rxjs';

import { AuthService } from './auth.service';
import { NodeSuggestions, proposedAiSuggestions } from '../util/mds-suggestions';

/** Log prefix for the generation run and what it was asked for. */
const LOG = '[edu-sharing][mds-ai]';

/** The prompt configuration the MDS editor's own „Metadaten generieren" runs under. */
const CONFIG_ID = { type: 'mds', id: 'suggestion_ai' };

/** The `aiConfig` a widget is generated under, as the MDS editor asks for it — see {@link aiConfigOf}. */
const DEFAULT_AI_CONFIG = 'default';

/**
 * How much of the page's text a run is given as a variable. The prompts of a metadata set are written for
 * a document, not for a whole site: a text far beyond this says no more about the content and costs the
 * run the time — and past the model's window, the answer — so it is cut rather than sent whole.
 */
export const TEXT_VARIABLE_MAX = 20_000;

/** What the prompts may refer to: the values the run is given to work from, per variable name. */
export type SuggestionVariables = Record<string, string[]>;

/**
 * The repository's own metadata generation, as the MDS editor's „Für alle Metadaten-Felder, welche über die
 * KI generiert werden können, Vorschläge erzeugen" triggers it: a run over every widget of the metadata set
 * that carries an `aiConfig`, whose findings the repository stores as KI-Vorschläge on the node.
 *
 * The panel asks for it itself rather than letting the editor's toggle do it, because the toggle only appears
 * where the editor decides it should and starts a run the panel cannot give its own inputs. The inputs are the
 * point: the content's title and the text of the page it was read from travel as `variables`, which is what
 * the set's prompts are written against.
 *
 * Best-effort throughout, like the suggestion store beside it (see SuggestionService): a repository without
 * the service, a set without a single `aiConfig`, a run that fails — each leaves the form with whatever
 * proposals the node already carries.
 */
@Injectable({ providedIn: 'root' })
export class MdsAiSuggestionService {
  private readonly auth = inject(AuthService);
  private readonly mds = inject(MdsService);
  // The generation itself: `POST {bApiUrl}/api/v1/edu-sharing/suggestions`, addressed through the
  // b-API client the repository publishes for it (see app.config.ts).
  private readonly llm = inject(EduSharingLlmService);

  /**
   * The nodes a run was already made for in this session. One run per node: the findings are stored on the
   * node, so re-entering the Metadaten step reads them again rather than paying for them again.
   */
  private readonly generated = new Set<string>();

  /**
   * Have the repository generate what the metadata set can generate for this node, from the values handed
   * in. Answers what the run proposed, in the shape the widgets read; null where there was nothing to ask
   * for, where the set names no generatable field, or where the run failed or proposed nothing.
   *
   * The answer is the run's own report of what it wrote. The proposals are read from the node behind this
   * (SuggestionService.load), which is the better source — those carry the ids an acceptance is recorded
   * under — so this is the fallback for a store that will not hand them back.
   */
  async generate(
    nodeId: string,
    setId: string,
    variables: SuggestionVariables,
  ): Promise<NodeSuggestions | null> {
    if (this.generated.has(nodeId)) return null;
    if (!Object.keys(variables).length) {
      console.log(`${LOG} nothing to generate from for ${nodeId} — no variable carries a value`);
      return null;
    }
    const set = await this.metadataSet(setId);
    if (!set) return null;
    // Never the fields the caller already has an answer for: they are what the run works *from*.
    const widgets = generatableWidgets(set, Object.keys(variables));
    if (!widgets.length) {
      console.log(
        `${LOG} the metadata set ${set.id} names no field left to generate — no widget carries an aiConfig`,
      );
      return null;
    }
    // Marked before the request rather than after it: a run that failed is not one to repeat on every
    // re-entry of the step, and the form works from what the node already carries either way.
    this.generated.add(nodeId);
    const body: EduSharingLlmWidgetAiConfigRequest = {
      user: this.auth.username() ?? '',
      metadataSet: set.id,
      configIds: [CONFIG_ID],
      widgetAiConfigs: widgets,
      contextNodeId: nodeId,
      variables
    };
    console.log(
      `${LOG} → generating ${widgets.length} fields for ${nodeId}`,
      { fields: widgets.map((widget) => widget.widgetId), body },
    );
    try {
      const proposed = await firstValueFrom(this.llm.suggestions({ body }));
      const offer = proposedAiSuggestions(nodeId, proposed);
      // By property and value, because this is where a run that answered for only some of the fields it
      // was asked about shows itself — the ones it left out are the set's own prompts to look at.
      console.log(`${LOG} ← the run proposed ${proposed?.length ?? 0} values for ${nodeId}`, {
        proposed: Object.fromEntries(
          Object.entries(offer?.suggestions ?? {}).map(([propertyId, values]) => [
            propertyId,
            values.map((entry) => entry.value)
          ]),
        ),
        withoutProposal: widgets
          .map((widget) => widget.widgetId)
          .filter((widgetId) => !offer?.suggestions[widgetId])
      });
      return offer;
    } catch (cause: unknown) {
      console.warn(`${LOG} the run for ${nodeId} failed:`, cause);
      return null;
    }
  }

  /** The metadata set the fields are read off; null where the repository will not hand it over. */
  private async metadataSet(setId: string): Promise<MdsDefinition | null> {
    try {
      return await firstValueFrom(
        this.mds.getMetadataSet({ repository: HOME_REPOSITORY, metadataSet: setId }),
      );
    } catch (cause: unknown) {
      console.warn(`${LOG} could not read the metadata set ${setId}:`, cause);
      return null;
    }
  }
}

/**
 * The set's widgets a run can fill: the ones carrying an `aiConfig`, each named once however many templates
 * it appears in, minus the ones `settled` already answers. The editor picks the config named `default` and so
 * does this; a widget that names its configs differently is asked for under the first it offers.
 */
function generatableWidgets(set: MdsDefinition, settled: readonly string[]): WidgetAiConfigInfo[] {
  const named = new Map<string, WidgetAiConfigInfo>();
  for (const widget of set.widgets ?? []) {
    const widgetId = widget.id;
    if (!widgetId || named.has(widgetId) || settled.includes(widgetId)) continue;
    const aiConfigId = aiConfigOf(widget);
    if (aiConfigId) named.set(widgetId, { widgetId, aiConfigId });
  }
  return [...named.values()];
}

/**
 * The `aiConfig` a widget is generated under; null for a widget that carries none. The one named
 * `default` — which is the only one the MDS editor ever asks for — else the first the widget offers,
 * and that name again for a config that states none: a run under the name the set is written for
 * stands a better chance than one refused for the sake of a missing id.
 */
function aiConfigOf(widget: MdsWidget): string | null {
  const configs = widget.aiConfigs ?? [];
  if (!configs.length) return null;
  const named = configs.find((config) => config.id === DEFAULT_AI_CONFIG);
  return named?.id ?? configs[0].id ?? DEFAULT_AI_CONFIG;
}
