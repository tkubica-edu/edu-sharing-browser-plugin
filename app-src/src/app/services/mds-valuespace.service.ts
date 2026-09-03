import { Injectable, inject } from '@angular/core';
import { HOME_REPOSITORY, MdsDefinition, MdsService, MdsWidget } from 'ngx-edu-sharing-api';
import { firstValueFrom } from 'rxjs';

import { ValueMatch, matchVocabularyValues, suggestionCapableWidget } from '../util/vocabulary-match';
import { formWidgets } from '../util/mds-form-widgets';

/** Log prefix for what a metadata set's vocabularies answer. */
const LOG = '[edu-sharing][valuespace]';

/**
 * A metadata set's vocabularies, as far as the panel needs to resolve a word to a value: which widget holds
 * a property in the form being rendered, which values it offers, and whether it can show a proposal.
 *
 * The set is fetched once per id and held for the session — it is a large, unchanging document, and the
 * quality view fetches the same one. Everything on top of it is local: the values arrive resolved on the
 * widget (`MdsWidget.values`), so matching a term costs no request.
 *
 * Best-effort like the rest: a repository that will not hand the set over leaves every answer empty, and the
 * caller then simply has no vocabulary-bound proposals.
 */
@Injectable({ providedIn: 'root' })
export class MdsValuespaceService {
  private readonly mds = inject(MdsService);

  /** The set per id, as the promise, so two callers asking at once make one request. */
  private readonly sets = new Map<string, Promise<MdsDefinition | null>>();

  /** The metadata set; `null` where the repository will not answer. */
  set(setId: string): Promise<MdsDefinition | null> {
    const held = this.sets.get(setId);
    if (held) return held;
    const asked = this.ask(setId);
    this.sets.set(setId, asked);
    return asked;
  }

  /**
   * The widget a property is rendered by in the named group's form. Read off the group rather than off the
   * set's whole vocabulary, because a set may define a widget once per template and the rendered definition
   * is the one whose kind decides whether a proposal is visible (see `formWidgets`).
   */
  async widget(setId: string, groupId: string, property: string): Promise<MdsWidget | undefined> {
    const set = await this.set(setId);
    if (!set) return undefined;
    return formWidgets(set, groupId).find((widget) => widget.id === property);
  }

  /**
   * The values of a property that the page's terms name — nothing where none of them does, which is the
   * common case and no failure. Only for a property the form actually renders: a value written to a
   * property no widget shows can neither be checked nor corrected by the person in front of the form.
   */
  async resolve(
    setId: string,
    groupId: string,
    property: string,
    terms: readonly string[],
    limit = 2,
  ): Promise<ValueMatch[]> {
    if (!terms.length) return [];
    const widget = await this.widget(setId, groupId, property);
    if (!widget?.values?.length) return [];
    const matched = matchVocabularyValues(widget.values, terms, limit);
    console.log(
      `${LOG} ${property}: ${matched.length} of ${terms.length} terms resolved against ${widget.values.length} values`,
      {
        terms,
        matched: matched.map((match) => `${match.term} → ${match.value.caption ?? match.value.id} (${match.by})`)
      },
    );
    return matched;
  }

  /**
   * Whether the property's widget in this form can show a pending proposal. A property the form does not
   * render at all counts as unable — there is nothing to show it in.
   */
  async canShowSuggestion(setId: string, groupId: string, property: string): Promise<boolean> {
    const widget = await this.widget(setId, groupId, property);
    return widget ? suggestionCapableWidget(widget) : false;
  }

  private async ask(setId: string): Promise<MdsDefinition | null> {
    try {
      const set = await firstValueFrom(
        this.mds.getMetadataSet({ repository: HOME_REPOSITORY, metadataSet: setId }),
      );
      return set ?? null;
    } catch (cause: unknown) {
      console.warn(`${LOG} could not read the metadata set ${setId}:`, cause);
      return null;
    }
  }
}
