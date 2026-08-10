import { Injectable, signal } from '@angular/core';
import { HOME_REPOSITORY } from 'ngx-edu-sharing-api';

import { APP_CONFIG } from '../config';
import { errorMessage } from '../util/errors';

/** How long to wait for an evaluation before giving up on it. */
const EVALUATE_TIMEOUT_MS = 120_000;

/**
 * How MetalookUp retrieves the resource it is pointed at. Only `webpage` is used so far — the panel's
 * content is the open page, and the other kinds would need a decision about the content's type that
 * nothing makes yet.
 */
type ResourceType = 'webpage' | 'document' | 'binary' | 'pdf';

/** The resource an evaluation is about. At least one of the two is required. */
export interface MetalookupResource {
  /** The page's address. */
  url?: string | null;
  /** The repository's id for the content, where it already has one. */
  nodeId?: string | null;
}

/**
 * One metadata property MetalookUp extracted, with how sure it is of the value. `value` is
 * deliberately `unknown`: the service types it as a free-form object, so its shape follows the
 * property rather than a schema of its own.
 */
export interface MetalookupRule {
  propertyId: string;
  value: unknown;
  description: string;
  confidence: number;
}

/**
 * MetalookUp's answer. Every field is optional here although the API declares them required: an error
 * response is served under the same schema, and a body that lost a field must not turn into a parse
 * failure that hides the status behind it.
 */
export interface MetalookupEvaluation {
  timestamp?: string;
  path?: string;
  status?: number;
  error?: string;
  featureExtractions?: MetalookupRule[];
}

/**
 * MetalookUp's evaluation of a content: what metadata can be extracted from the resource, and how
 * certain each value is. `POST /api/evaluation` — the endpoint that answers directly instead of
 * persisting anything to the suggestion service, so calling it has no effect beyond the answer.
 *
 * The request goes out from the panel document rather than through the background worker, like the
 * metadata agent's (see MetadataAgentService.postExtractField): the extension's `host_permissions`
 * are what let this document reach a foreign origin, and MetalookUp serves no CORS headers of its own
 * — a preflight from an extension origin is rejected outright. So this is reachable from the panel
 * and from the worker, but never from a page's own scripts.
 */
@Injectable({ providedIn: 'root' })
export class MetalookupService {
  /** True while an evaluation is in flight. */
  readonly running = signal(false);
  /** The last answer, whatever its status; null until one arrived. */
  readonly lastEvaluation = signal<MetalookupEvaluation | null>(null);
  /** Why the last evaluation did not produce an answer; null when it did. */
  readonly error = signal<string | null>(null);

  /**
   * Evaluate a resource. Rejects when the service cannot be reached, answers with a status the
   * request cannot be served under, or sends something that is not a JSON object — the caller decides
   * what to do with that; {@link error} carries it for the view either way.
   */
  async evaluate(resource: MetalookupResource): Promise<MetalookupEvaluation> {
    const body = this.requestBody(resource);
    this.running.set(true);
    this.error.set(null);
    try {
      const evaluation = await this.postEvaluation(body);
      this.lastEvaluation.set(evaluation);
      return evaluation;
    } catch (cause: unknown) {
      this.error.set(errorMessage(cause));
      throw cause;
    } finally {
      this.running.set(false);
    }
  }

  /**
   * The request as the API wants it: `type` and `repository` are required, and one of `url`/`node`
   * identifies the resource. A resource with neither is refused here rather than sent — the answer
   * would be a 400, which says less than the refusal does.
   */
  requestBody(resource: MetalookupResource): Record<string, string> {
    const url = resource.url?.trim();
    const node = resource.nodeId?.trim();
    if (!url && !node) {
      throw new Error('evaluation needs a url or a node id, and this content has neither');
    }
    return {
      type: 'webpage' satisfies ResourceType,
      repository: HOME_REPOSITORY,
      ...(url ? { url } : {}),
      ...(node ? { node } : {}),
    };
  }

  private async postEvaluation(body: Record<string, string>): Promise<MetalookupEvaluation> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), EVALUATE_TIMEOUT_MS);
    try {
      const response = await fetch(`${APP_CONFIG.metalookupApiUrl}/api/evaluation`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          // Only where a key is configured: the header's mere presence is what an unauthenticated
          // deployment would reject.
          ...(APP_CONFIG.metalookupApiKey ? { 'X-API-KEY': APP_CONFIG.metalookupApiKey } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        const detail = (await response.text().catch(() => '')).substring(0, 300);
        throw new Error(`evaluation failed: ${response.status} - ${detail}`);
      }
      const evaluation = (await response.json().catch(() => null)) as MetalookupEvaluation | null;
      if (!evaluation || typeof evaluation !== 'object') {
        throw new Error('evaluation: invalid API response');
      }
      return evaluation;
    } finally {
      clearTimeout(timer);
    }
  }
}
