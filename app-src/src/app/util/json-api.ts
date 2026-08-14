// One JSON request against a foreign service, with the three failures such a request has: the service
// is not there, it answers with a status the answer cannot be read under, or what it sends is not JSON.
// Here rather than in each service, because the extension talks to several of them (ContentJudge,
// MetalookUp) the same way, and the three failures have to read the same wherever they come from —
// their message is what a view gets to show.

import { errorMessage } from './errors';

/** What to ask of which service, and how long to wait for it. */
export interface JsonRequest {
  /**
   * The service's name as an error message should name it ("ContentJudge", "MetalookUp"). It is the
   * first thing a reader needs: the answer to "which of them is broken".
   */
  service: string;
  url: string;
  /** `GET` where none is given. */
  method?: 'GET' | 'POST';
  /** Sent besides `Accept`, and besides the `Content-Type` a request with a body brings. */
  headers?: Record<string, string>;
  /** Serialised as the request's JSON body. Omitted entirely for a request that has none. */
  body?: unknown;
  timeoutMs: number;
}

/**
 * The service's answer, parsed. Typed by the caller and not checked against that type: what arrives is a foreign
 * service's JSON, so the type states the contract while this only guarantees that some JSON object arrived. Rejects
 * with a message naming the service and the cause, carrying the whole untruncated body for a non-2xx status.
 */
export async function fetchJson<T>(request: JsonRequest): Promise<T> {
  const { service, url, method = 'GET', headers = {}, body, timeoutMs } = request;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // The timeout bounds the whole exchange, the body included — so it is cleared once there is an answer
  // to return or a reason not to, never as soon as the headers are in.
  try {
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      });
    } catch (cause: unknown) {
      // The only failure that says nothing about the service's answer, because there is none — so it is
      // the one that names the address instead.
      throw new Error(`${service} nicht erreichbar (${url}): ${errorMessage(cause)}`);
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`${service} antwortet mit ${response.status}: ${detail}`);
    }
    const parsed = (await response.json().catch(() => null)) as T | null;
    if (!parsed || typeof parsed !== 'object') {
      throw new Error(`${service} antwortet nicht mit JSON (${url})`);
    }
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}
