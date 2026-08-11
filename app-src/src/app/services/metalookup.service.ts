import { Injectable, signal } from '@angular/core';
import { HOME_REPOSITORY } from 'ngx-edu-sharing-api';

import { APP_CONFIG } from '../config';
import { errorMessage } from '../util/errors';
import { fetchJson } from '../util/json-api';

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
 * One check's result: the property it bears on, the number it rated, and how sure it is
 * (`MetadataUpdateRule` in the gateway).
 *
 * `value` and `confidence` are `double` there, so both really are numbers — but a check that could not
 * run reports its excuse in `description` and a `value` that means nothing ("No files to extract"), so
 * a number here is not yet an answer. That reading is `measurementOf`'s, in `util/quality-schemes.ts`.
 */
export interface MetalookupRule {
  /** The metadata property the check rates, by the id the metadata set gives it. */
  propertyId: string;
  value: number;
  /** What the check found, in prose. Also how one check is told from another — see `MetalookupRule` in `config.ts`. */
  description: string;
  /** 0 to 1, higher is more certain. */
  confidence: number;
}

/**
 * MetalookUp's answer (`Response` in the gateway).
 *
 * `error` and `featureExtractions` are absent rather than null where they are empty — the DTO is
 * serialised without its nulls (`@JsonInclude(NON_NULL)`). The other three are on every answer,
 * including the ones that report a failure: `status` carries it a second time, in the body.
 */
export interface MetalookupEvaluation {
  /** When the answer was made, ISO 8601. */
  timestamp: string;
  /** The path that produced it. */
  path: string;
  /** The HTTP status, repeated in the body. */
  status: number;
  /** What went wrong, on an answer that reports a failure. */
  error?: string;
  /** One entry per check that ran. Absent where none did. */
  featureExtractions?: MetalookupRule[];
}

/**
 * MetalookUp's evaluation of a content: what metadata can be extracted from the resource, and how
 * certain each value is. `POST /api/evaluation` — the endpoint that answers directly instead of
 * persisting anything to the suggestion service, so calling it has no effect beyond the answer.
 *
 * That endpoint is the deployment's and not the gateway sources': those declare `POST /api/extract`,
 * which starts the extraction and answers `202` with an empty body, and `POST /api/poll` to ask after
 * it. `/api/evaluation` answers on staging all the same — where the two disagree, the deployment is
 * what this client is written against, and the DTOs below are the sources' (`Response`,
 * `MetadataUpdateRule`), whose field names its answer matches.
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

  private postEvaluation(body: Record<string, string>): Promise<MetalookupEvaluation> {
    return fetchJson<MetalookupEvaluation>({
      service: 'MetalookUp',
      url: `${APP_CONFIG.metalookupApiUrl}/api/evaluation`,
      method: 'POST',
      // Only where a key is configured: the header's mere presence is what an unauthenticated
      // deployment would reject.
      headers: APP_CONFIG.metalookupApiKey
        ? { 'X-API-KEY': APP_CONFIG.metalookupApiKey }
        : {},
      body,
      timeoutMs: EVALUATE_TIMEOUT_MS,
    });
  }
}
