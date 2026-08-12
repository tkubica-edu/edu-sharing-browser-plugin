import { Injectable, inject } from '@angular/core';

import { APP_CONFIG } from '../config';
import { MdsValues } from '../util/mds-values';
import { SOURCE_TEXT_KEY, toEnvelope, toPayloadFields } from '../util/agent-payload';
import { BrowserExtensionService, UploadedNode } from './browser-extension.service';
import { MetadataAgentApiService } from './metadata-agent-api.service';
import { errorMessage } from './../util/errors';

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
   * (a guest, with the browser extension custom web component) may not be allowed to read it back.
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
 * Used instead of a direct node create while the browser extension custom web component is enabled (see
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
   * @param collections the collections the created node is to be added to — what the flow's filing
   *   steps picked (see CurationService.filedCollections). The endpoint files them
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
      // The payload in the shape the canvas states it in (`getMetadataForExport`): the envelope at the
      // top level, and the properties — `cclom:title`, `ccm:wwwurl`, the quality criteria — one level
      // in under `metadata`. That is where the endpoint reads them, so this is not the panel's own
      // arrangement to make.
      //
      // Before the flags below, so a payload key that happened to be named like one cannot displace it.
      ...toEnvelope(payload),
      metadata: toPayloadFields(values),
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
