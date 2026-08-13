import { Injectable, inject } from '@angular/core';

import { MdsValues } from '../util/mds-values';
import { SOURCE_TEXT_KEY, toEnvelope, toPayloadFields } from '../util/agent-payload';
import { BrowserExtensionService, SavedNode } from './browser-extension.service';
import { MetadataAgentApiService } from './metadata-agent-api.service';
import { errorMessage } from './../util/errors';

/** What a `/nodes` call does beyond putting the values on the node. */
export interface NodeWriteSteps {
  /**
   * The content's picture, which the endpoint puts on the node as its **preview** — a
   * `POST …/nodes/-home-/{id}/preview` of its own, not a metadata field.
   *
   * Either an address the service fetches (`http(s)://…`) or the picture itself, as the data URL
   * `/generate` states `preview_image_url` in (bare base64 is taken as well). Left out entirely
   * where there is nothing to say: a node keeps the preview it has unless one is sent.
   */
  preview?: string;
  /** Reference the node in these collections (`collection_id`). */
  collections?: readonly string[];
  /** Confirm the quality — the endpoint writes `140_ELEMENT_LEGALLY_APPROVED`. */
  quality?: boolean;
  /** Hand the content over for review — the endpoint writes `200_tocheck`. */
  review?: boolean;
  /** Write the WLO extended fields (`ccm:oeh_extendedType/Data/Text`). */
  extended?: boolean;
}

/** What the caller needs to know about a write: the node it wrote, or why there is none. */
export interface NodeWriteOutcome {
  ok: boolean;
  /**
   * The node as the endpoint described it. Along this route it is the *only* description the app
   * gets: the agent writes with its own privileges, so the session the panel runs under (a guest,
   * with the browser extension custom web component) may not be allowed to read the node back.
   */
  node?: SavedNode;
  /**
   * The whole edu-sharing node, as the endpoint reads it back after every write — the same shape a
   * node load answers with, so the flow can work on it as on any other node.
   */
  nodeFull?: Record<string, unknown> | null;
  /** Whether this call created the node rather than updating one. */
  created?: boolean;
  error?: string;
  /**
   * Why a requested workflow step did not happen. Separate from {@link error}: the metadata is
   * written either way, so a failed handover is a report and not a failed write.
   */
  workflowError?: string;
  /** Why the content did not reach one of the collections it was to be referenced in; as above. */
  collectionError?: string;
  /**
   * Why the picture did not become the node's preview; as above. The endpoint states it explicitly
   * (`preview.success`), because a picture it cannot load or decode leaves the metadata write valid.
   */
  previewError?: string;
}

/**
 * What the repository answers for a node that is in the collection already. Not a failure to report:
 * the content is where it was to be put — see {@link NodeWriteService.collectionProblem}.
 */
const ALREADY_IN_COLLECTION = 'DuplicateNodeException';

/**
 * Writing the flow's node through the metadata agent's `POST /nodes` — the web component's way of
 * putting a curated content into the repository: it creates the node, references it in collections,
 * writes the extended fields and runs the editorial workflow steps, none of which the plain node API
 * does for a session that is not the user's own.
 *
 * Used instead of writing the node ourselves while the browser extension custom web component is
 * enabled *and* nobody is signed in (see {@link CurationService.savesThroughAgent}): the guest
 * session that web component brings may not create a node in the repository at all, and the agent
 * writes with the agent's own privileges.
 *
 * Unlike the `/upload` this replaces, the endpoint also UPDATES: a body that names a `node_id`
 * rewrites that node instead of creating a second one, which is what lets the flow save the content
 * early and edit it from there on. The repository holds it to a window of two hours after the node
 * was created — after that the endpoint answers 403 and the editorial interface takes over.
 *
 * The request is proxied by the background worker to stay CORS-portable, exactly like `/generate`.
 */
@Injectable({ providedIn: 'root' })
export class NodeWriteService {
  private readonly browserExtension = inject(BrowserExtensionService);
  private readonly agentApi = inject(MetadataAgentApiService);

  /**
   * Write the values to the node, creating it where `nodeId` is absent.
   *
   * @param values  the field values as the flow holds them.
   * @param payload the agent result they came from — it carries the envelope (content type,
   *   `_origins`, `_source_text`) that the endpoint expects alongside the values, and which the
   *   values alone do not contain.
   * @param nodeId  the node to update; absent creates one.
   * @param steps   what the call does besides writing the values.
   */
  async write(
    values: MdsValues,
    payload: Record<string, unknown> | null,
    nodeId: string | null,
    steps: NodeWriteSteps = {},
  ): Promise<NodeWriteOutcome> {
    const body: Record<string, unknown> = {
      // The payload in the shape the canvas states it in (`getMetadataForExport`): the envelope at
      // the top level, and the properties — `cclom:title`, `ccm:wwwurl`, the quality criteria — one
      // level in under `metadata`. That is where the endpoint reads them, so this is not the panel's
      // own arrangement to make.
      //
      // Before the options below, so a payload key that happened to be named like one cannot
      // displace it.
      ...toEnvelope(payload),
      metadata: toPayloadFields(values),
      // Stated explicitly in both directions: the endpoint's own default for the extended data is
      // `true`, and a step that is not about them must not write them off the back of that.
      write_extended_data: steps.extended === true,
      start_quality_workflow: steps.quality === true,
      start_review_workflow: steps.review === true
    };
    // The node being updated. Left out entirely for a create — the endpoint tells the two apart by
    // the key's presence, and a `null` under it is not the same statement.
    if (nodeId) body['node_id'] = nodeId;
    // The raw text the metadata was read from, only where it is written: it is by far the largest
    // thing in the request, and without the extended fields it has nowhere to go.
    if (steps.extended && payload?.[SOURCE_TEXT_KEY]) body['extended_text'] = payload[SOURCE_TEXT_KEY];
    // Left out entirely where nothing was picked: the key is what the endpoint files the node under,
    // and an empty list is not a statement the request needs to make.
    if (steps.collections?.length) body['collection_id'] = [...steps.collections];
    // Same for the picture: a request that names none leaves the node's own preview alone.
    if (steps.preview) body['preview'] = steps.preview;

    try {
      const response = await this.browserExtension.saveNode(body, this.agentApi.baseUrl());
      if (!response.success) return { ok: false, error: response.error ?? 'Speichern fehlgeschlagen.' };
      const result = response.result ?? {};
      const ok = result.success === true;
      return {
        ok,
        node: result.node,
        nodeFull: result.node_full ?? null,
        created: result.node_created ?? undefined,
        error: ok ? undefined : result.error ?? 'Speichern fehlgeschlagen.',
        workflowError: ok ? this.workflowProblem(result.workflow) : undefined,
        collectionError: ok ? this.collectionProblem(result.collections) : undefined,
        // Read from `preview` rather than from the answer's `error`, which carries the same reason
        // beside a `success: true`: only this says whether the picture was the thing that failed.
        previewError:
          ok && result.preview && result.preview.success === false
            ? result.preview.error ?? 'Vorschaubild nicht gesetzt.'
            : undefined
      };
    } catch (cause: unknown) {
      return { ok: false, error: errorMessage(cause) };
    }
  }

  /**
   * The first failed workflow step, as one line; `undefined` while every requested step ran. Read
   * per step because the endpoint reports each one on its own — the write succeeds whether or not
   * the handover behind it did.
   */
  private workflowProblem(
    steps: readonly { status?: string; success?: boolean; error?: string | null }[] | null | undefined,
  ): string | undefined {
    const failed = (steps ?? []).find((step) => step.success === false);
    if (!failed) return undefined;
    return failed.error ? `${failed.status}: ${failed.error}` : `${failed.status} nicht gesetzt.`;
  }

  /**
   * The first collection the content did not reach, as one line; `undefined` while every one it was
   * to be referenced in holds it. A collection that already holds it is not among them: the request
   * asked for the content to be in it, and it is (see {@link ALREADY_IN_COLLECTION}).
   */
  private collectionProblem(
    collections:
      | readonly { collectionId?: string; success?: boolean; error?: string | null }[]
      | null
      | undefined,
  ): string | undefined {
    const failed = (collections ?? []).find(
      (entry) => entry.success === false && !entry.error?.includes(ALREADY_IN_COLLECTION),
    );
    if (!failed) return undefined;
    return `Sammlung ${failed.collectionId}: ${failed.error ?? 'nicht übernommen.'}`;
  }
}
