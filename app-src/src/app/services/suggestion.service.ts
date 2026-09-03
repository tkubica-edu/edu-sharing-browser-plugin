import { Injectable, inject } from '@angular/core';
import { CreateSuggestionRequestDto, HOME_REPOSITORY, SuggestionsV1Service } from 'ngx-edu-sharing-api';
import { firstValueFrom } from 'rxjs';

import {
  NodeSuggestions, aiSuggestionRequests, proposedFieldsOf, storedAiSuggestions
} from '../util/mds-suggestions';

/** Log prefix for what the panel proposes for a node and what it reads back. */
const LOG = '[edu-sharing][suggestions]';

/**
 * The version every proposal of this panel is written under. It is the handle for replacing them: a repeated
 * Erschließung deletes this version before writing the new run's findings, so the proposals do not stack —
 * while a proposal made anywhere else, under a version of its own, stays untouched.
 */
const PANEL_VERSION = 'browser-extension';

/**
 * The content's generated metadata as KI-Vorschläge on its node, through the repository's suggestion API
 * (`/suggestions/v1/{repository}/{node}`). They are what the Metadaten step's form offers for acceptance
 * instead of presenting the agent's values as decided, and unlike the panel's own in-memory offer they
 * outlive the session: the node carries them into the edu-sharing workspace.
 *
 * The API needs the repository's `mongo-plugin`, so neither direction is a hard requirement of the flow —
 * both answer with what they achieved and leave the caller its own way (see MdsEditorComponent).
 */
@Injectable({ providedIn: 'root' })
export class SuggestionService {
  private readonly suggestions = inject(SuggestionsV1Service);

  /**
   * Propose the run's findings for the node, replacing what this panel proposed for it before — a model's
   * generated values and the ones derived from the page alike, since both are a machine's proposal and the
   * store is where an acceptance of either is recorded. Answers
   * whether anything was written; a payload with nothing to propose is no failure and writes nothing.
   *
   * The endpoint validates the whole list before it stores any of it, so one property it will not take
   * loses the rest with it. Hence the same shape as RepositoryNodeService.writeExtendedData: the batch
   * first, and entry by entry where that was refused, so the values it does accept still get through.
   */
  async propose(nodeId: string, payload: Record<string, unknown> | null): Promise<boolean> {
    const body = aiSuggestionRequests(payload);
    // The payload's proposed fields against the ones a request is made of: a proposed field that is not
    // in the body was left out on purpose — the licence, which is set rather than proposed, a name from a
    // vocabulary the repository cannot resolve to a property, or a field carrying no value at all
    // (see aiSuggestionRequests).
    const proposable = new Set(body.map((entry) => entry.propertyId));
    console.log(`${LOG} ${proposable.size} proposed fields are to be proposed for ${nodeId}`, {
      toPropose: [...proposable],
      notProposed: proposedFieldsOf(payload).filter((propertyId) => !proposable.has(propertyId))
    });
    if (!body.length) {
      console.log(`${LOG} nothing to propose for ${nodeId} — the run marked no field as a proposal`);
      return true;
    }
    // An earlier run's proposals first: the same node would otherwise carry both, and the form would
    // offer a value the content was never described with.
    await this.discardOwn(nodeId);
    console.log(`${LOG} → proposing ${body.length} values for ${nodeId}`, body);
    if (await this.write(nodeId, body)) return true;
    // A single entry was already tried on its own above; retrying it would only repeat the refusal.
    if (body.length === 1) {
      console.warn(`${LOG} the repository took none of the proposals for ${nodeId}`);
      return false;
    }
    const refused: string[] = [];
    for (const entry of body) {
      if (!(await this.write(nodeId, [entry]))) refused.push(entry.propertyId);
    }
    if (refused.length === body.length) {
      console.warn(`${LOG} the repository took none of the proposals for ${nodeId}`);
      return false;
    }
    console.warn(`${LOG} the repository refused ${refused.length} of the proposals for ${nodeId}`, refused);
    return true;
  }

  /** One create request; answers whether it went through, since a refused entry is not a failed flow. */
  private async write(nodeId: string, body: CreateSuggestionRequestDto[]): Promise<boolean> {
    try {
      await firstValueFrom(
        this.suggestions.createSuggestions({
          repository: HOME_REPOSITORY,
          node: nodeId,
          type: 'AI',
          version: PANEL_VERSION,
          body
        }),
      );
      return true;
    } catch (cause: unknown) {
      // Only where the entry stands alone: a batch failing is expected as soon as one of its entries is
      // not to the repository's liking, and it is the single-entry retry that names the culprit.
      if (body.length === 1) console.warn(`${LOG} ${body[0].propertyId} was refused:`, cause);
      return false;
    }
  }

  /**
   * The node's open KI-Vorschläge as the editor's widgets read them; null where it carries none or the
   * repository cannot answer — the caller then falls back to the run's own findings.
   */
  async load(nodeId: string): Promise<NodeSuggestions | null> {
    try {
      const response = await firstValueFrom(
        this.suggestions.getSuggestionsByNodeId({
          repository: HOME_REPOSITORY,
          node: nodeId,
          status: ['PENDING']
        }),
      );
      const suggestions = storedAiSuggestions(response);
      // The properties by name, and what the store holds that this does not offer: a proposal already
      // accepted or declined, or a person's, is dropped here, and a form showing none of them is then
      // reporting a decision rather than a failure (see storedAiSuggestions).
      console.log(
        `${LOG} ← ${Object.keys(suggestions?.suggestions ?? {}).length} proposed properties for ${nodeId}`,
        {
          offered: Object.keys(suggestions?.suggestions ?? {}),
          stored: Object.entries(response?.suggestions ?? {}).map(
            ([propertyId, entries]) =>
              `${propertyId}: ${(entries ?? [])
                .map((entry) => `${entry.type}/${entry.status}`)
                .join(', ')}`,
          )
        },
      );
      return suggestions;
    } catch (cause: unknown) {
      console.warn(`${LOG} could not read the proposals for ${nodeId}:`, cause);
      return null;
    }
  }

  /** Drop what this panel proposed for the node before; a repository that refuses is only reported. */
  private async discardOwn(nodeId: string): Promise<void> {
    try {
      await firstValueFrom(
        this.suggestions.deleteSuggestions({
          repository: HOME_REPOSITORY,
          node: nodeId,
          version: [PANEL_VERSION]
        }),
      );
    } catch (cause: unknown) {
      console.warn(`${LOG} could not discard the earlier proposals for ${nodeId}:`, cause);
    }
  }
}
