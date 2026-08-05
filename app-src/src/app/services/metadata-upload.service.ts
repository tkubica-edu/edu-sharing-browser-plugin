import { Injectable, inject } from '@angular/core';

import { APP_CONFIG } from '../config';
import { MdsValues } from '../util/mds-values';
import { BrowserExtensionService, UploadedNode } from './browser-extension.service';
import { errorMessage } from './../util/errors';

/** The envelope keys the agent's payload carries alongside the field values. */
const ENVELOPE_KEYS = [
  'contextName',
  'schemaVersion',
  'metadataset',
  'metadataset_uri',
  '_origins',
  '_source_text'
] as const;

/** How a screenshot for the preview is taken; the agent's own default for an embedded canvas. */
const SCREENSHOT_METHOD = 'pageshot';

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

  /**
   * Upload the edited values as a new content.
   *
   * @param values  the field values as the editor committed them.
   * @param payload the agent result the editing started from — it carries the envelope (content
   *   type, `_origins`, `_source_text`) that the endpoint expects alongside the values, and which
   *   an editor's committed values alone do not contain.
   * @param sourceUrl the page the content was curated from, used for the preview screenshot.
   */
  async upload(
    values: MdsValues,
    payload: Record<string, unknown> | null,
    sourceUrl?: string,
  ): Promise<UploadOutcome> {
    const envelope = this.envelopeOf(payload);
    const body: Record<string, unknown> = {
      metadata: { ...values, ...envelope },
      repository: APP_CONFIG.uploadRepository,
      // Never here: the question is answered BEFORE anything is curated — the panel looks the open
      // page up as soon as it is opened and adopts the content the repository already holds for it
      // (PageRecognitionService), so a curation that got this far is one the repository does not
      // have. Asking again would only stand in the way of a deliberate re-save, whose duplicate is
      // the node the previous save created (see CurationService.saveThroughAgent).
      check_duplicates: false,
      start_workflow: true,
      write_extended_data: true,
      extended_text: envelope['_source_text'],
      preview_url: sourceUrl || (values['ccm:wwwurl'] as string[] | undefined)?.[0],
      screenshot_method: SCREENSHOT_METHOD
    };
    try {
      const response = await this.browserExtension.uploadMetadata(body);
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
