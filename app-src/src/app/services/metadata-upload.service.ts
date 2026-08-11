import { Injectable, inject } from '@angular/core';

import { APP_CONFIG } from '../config';
import { MdsValues } from '../util/mds-values';
import { BrowserExtensionService, UploadedNode } from './browser-extension.service';
import { MetadataAgentApiService } from './metadata-agent-api.service';
import { errorMessage } from './../util/errors';

/**
 * The envelope keys the agent's payload carries alongside the field values — which set the values
 * are read against. They travel at the top level of the request, next to the fields themselves.
 */
const ENVELOPE_KEYS = ['contextName', 'schemaVersion', 'metadataset', 'metadataset_uri'] as const;

/**
 * The agent's own record of where its result came from. Not properties of the content, so they are
 * not sent as fields: the page's raw text travels as `extended_text` (which is what
 * `write_extended_data` writes), and `_origins` describes the run rather than the content.
 */
const SOURCE_TEXT_KEY = '_source_text';

/** How a screenshot for the preview is taken; the agent's own default for an embedded canvas. */
const SCREENSHOT_METHOD = 'pageshot';

/**
 * Request key holding the collection IDs the created node is added to — the step of the endpoint's
 * own pipeline that runs after the metadata was written (`_set_metadata` → **Collections** → …, see
 * WIDGET-REFERENZ.md).
 *
 * Singular by the endpoint's naming, plural in what it takes: the value is the list of picked
 * collections, one element or several (see {@link MetadataUploadService.fieldsOf} for why a single one
 * still travels as a list).
 */
const COLLECTION_ID_KEY = 'collection_id';

/** What the caller needs to know about an upload: the node it produced, or why there is none. */
export interface UploadOutcome {
  ok: boolean;
  /**
   * The created node as the endpoint described it. This is the *only* description of it the app
   * gets: the agent writes the node with its own privileges, so the session the panel runs under
   * (a guest, with the additional web component) may not be allowed to read it back.
   */
  node?: UploadedNode;
  /** The endpoint recognised the content as already present. */
  duplicate?: boolean;
  error?: string;
}

/**
 * Saving through the metadata agent's own `POST /upload` — the web component's way of writing a
 * curated content into the repository: it creates the node, checks for duplicates and starts the
 * editorial workflow, none of which the plain node API does.
 *
 * Used instead of a direct node create while the additional web component is enabled (see
 * {@link CurationService.save}): there the WLO canvas is the editor, so its own upload is the
 * matching save. The request is proxied by the background worker to stay CORS-portable, exactly
 * like `/generate`.
 */
@Injectable({ providedIn: 'root' })
export class MetadataUploadService {
  private readonly browserExtension = inject(BrowserExtensionService);
  private readonly agentApi = inject(MetadataAgentApiService);

  /**
   * Upload the edited values as a new content.
   *
   * @param values  the field values as the editor committed them.
   * @param payload the agent result the editing started from — it carries the envelope (content
   *   type, `_origins`, `_source_text`) that the endpoint expects alongside the values, and which
   *   an editor's committed values alone do not contain.
   * @param sourceUrl the page the content was curated from, used for the preview screenshot.
   * @param collections the collections the created node is to be added to — the editorial groups the
   *   forwarding step picked (see CurationService.editorialCollections). The endpoint files them
   *   itself, which is the only way here: the node belongs to the agent's own privileges, so the
   *   panel session may not add it to a collection afterwards.
   */
  async upload(
    values: MdsValues,
    payload: Record<string, unknown> | null,
    sourceUrl?: string,
    collections: readonly string[] = [],
  ): Promise<UploadOutcome> {
    const body: Record<string, unknown> = {
      // The fields go at the TOP LEVEL, one key per property — `cclom:title`, `ccm:wwwurl`, the
      // quality criteria, all of it. What the endpoint takes under `metadata` it writes into the
      // node's extended data instead, which is the wrong place for a property the metadata set
      // defines: it would be stored beside the node's own fields rather than as them.
      //
      // Before the flags below, so a field that happened to be named like one cannot displace it.
      ...this.envelopeOf(payload),
      ...this.fieldsOf(values),
      repository: APP_CONFIG.uploadRepository,
      // Never here: the question is answered BEFORE anything is curated — the panel looks the open
      // page up as soon as it is opened and adopts the content the repository already holds for it
      // (PageRecognitionService), so a curation that got this far is one the repository does not
      // have. Asking again would only stand in the way of a deliberate re-save, whose duplicate is
      // the node the previous save created (see CurationService.saveThroughAgent).
      check_duplicates: false,
      start_workflow: true,
      write_extended_data: true,
      extended_text: payload?.[SOURCE_TEXT_KEY],
      preview_url: sourceUrl || (values['ccm:wwwurl'] as string[] | undefined)?.[0],
      screenshot_method: SCREENSHOT_METHOD
    };
    // Left out entirely where nothing was picked: the key is what the endpoint files the node under,
    // and an empty list is not a statement the request needs to make.
    if (collections.length) body[COLLECTION_ID_KEY] = [...collections];
    try {
      const response = await this.browserExtension.uploadMetadata(body, this.agentApi.baseUrl());
      if (!response.success) return { ok: false, error: response.error ?? 'Upload fehlgeschlagen.' };
      const result = response.result ?? {};
      return {
        ok: result.success === true,
        node: result.node,
        // The endpoint answers `null`, not `false`, when nothing was duplicated.
        duplicate: result.duplicate ?? false,
        error: result.success === true ? undefined : this.describe(result)
      };
    } catch (cause: unknown) {
      return { ok: false, error: errorMessage(cause) };
    }
  }

  /**
   * The field values as request keys, each as the list the property is.
   *
   * Deliberately NOT unwrapped to a bare value when there happens to be one of it: how many values a
   * property holds right now says nothing about how many it *takes*. `ccm:oeh_buffet_criteria` is a
   * list of criteria, and sending the single one that is ticked as a bare string makes it a
   * different property than the one with two ticked. The endpoint documents its fields with plain
   * values (`"cclom:title": "…"`), and a one-element list is that same value said in the shape the
   * repository stores it in.
   *
   * An empty one is left out altogether — it says nothing, and sending it would clear a field the
   * editor never touched.
   */
  private fieldsOf(values: MdsValues): Record<string, unknown> {
    return Object.fromEntries(Object.entries(values).filter(([, value]) => value?.length));
  }

  /** The envelope fields of an agent payload, skipping the ones it did not deliver. */
  private envelopeOf(payload: Record<string, unknown> | null): Record<string, unknown> {
    const source = payload ?? {};
    return Object.fromEntries(
      ENVELOPE_KEYS.filter((key) => source[key] !== undefined && source[key] !== null).map((key) => [
        key,
        source[key]
      ]),
    );
  }

  private describe(result: {
    error?: string | null;
    duplicate?: boolean | null;
    node?: UploadedNode;
  }): string {
    if (result.duplicate) {
      const title = result.node?.title;
      return title
        ? `Dieser Inhalt liegt bereits im Repository: „${title}“.`
        : 'Dieser Inhalt liegt bereits im Repository.';
    }
    return result.error ?? 'Upload fehlgeschlagen.';
  }
}
