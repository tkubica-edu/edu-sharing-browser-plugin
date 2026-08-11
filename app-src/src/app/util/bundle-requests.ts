/**
 * Enforcement of the one rule the curation's stand-in node comes with: a request must never be built
 * from it (see DRAFT_NODE_ID). The panel keeps to it, the edu-sharing web-component bundle does not.
 *
 * The bundle's widgets read the node they are given off `MdsEditorInstanceService`, and some of them
 * ask the repository about it no matter which `editorMode` the editor runs in — the child-objects
 * widget is one: its `ngOnInit` subscribes to `nodes$` and fetches the node's children as soon as a
 * single node is set (`GET /node/v1/nodes/-home-/-draft-/children?assocName=ccm:childio`). For a
 * stand-in that 404s, and there is no input on the wrapper to leave such a widget out of a view group.
 *
 * So the request is stopped where it would leave the panel: an XHR opened on a stand-in URL is not
 * sent but answered locally with an empty result, which is the truth for a content the repository does
 * not hold yet. The widget then shows what it would show for a node without children, and nothing
 * reaches the repository under an id that identifies nothing there.
 */

import { DRAFT_NODE_ID } from './mds-node';

/** Log prefix for what the guard intercepts, as everywhere else in the extension. */
const LOG_GUARD = '[edu-sharing][bundle]';

/**
 * The answer every intercepted request gets: a node listing with nothing in it. It is the shape the
 * repository's node endpoints reply in, and the one the child-objects widget reads (`.nodes`).
 */
const EMPTY_RESULT = JSON.stringify({
  nodes: [],
  pagination: { total: 0, from: 0, count: 0 },
});

/** The URL of a guarded request, per XHR that was opened on one; empty for every other request. */
const guarded = new WeakMap<XMLHttpRequest, string>();

/** Whether the prototype is already patched — the install is idempotent, the patch must be applied once. */
let patched = false;

/**
 * Whether this URL addresses the stand-in node. Matched on the path segment rather than on a
 * substring, so an id that merely contains the word is not caught.
 */
export function isDraftNodeUrl(url: string): boolean {
  let path: string;
  try {
    path = new URL(url, document.baseURI).pathname;
  } catch {
    path = url;
  }
  return path.split('/').includes(DRAFT_NODE_ID);
}

/**
 * Keep every request the bundle builds from the stand-in node inside the panel, for the rest of the
 * document's life. Idempotent, and a no-op for every other request — the guard only ever sees an XHR
 * after it was opened on such a URL.
 *
 * Patched on `XMLHttpRequest.prototype` rather than on the global constructor: the bundle's HttpClient
 * builds its own instances (`BrowserXhr`), and jQuery in the bundle's `scripts.js` builds others.
 */
export function installDraftRequestGuard(): void {
  if (patched) return;
  patched = true;

  const nativeOpen = XMLHttpRequest.prototype.open;
  const nativeSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (
    this: XMLHttpRequest,
    ...args: [string, string | URL, ...unknown[]]
  ): void {
    const url = String(args[1] ?? '');
    // Remembered rather than acted on here: only `send` can be skipped, and an XHR may be opened and
    // never sent at all.
    if (isDraftNodeUrl(url)) guarded.set(this, url);
    else guarded.delete(this);
    (nativeOpen as (...a: unknown[]) => void).apply(this, args);
  } as typeof XMLHttpRequest.prototype.open;

  XMLHttpRequest.prototype.send = function (
    this: XMLHttpRequest,
    body?: Document | XMLHttpRequestBodyInit | null,
  ): void {
    const url = guarded.get(this);
    if (url === undefined) {
      nativeSend.call(this, body);
      return;
    }
    guarded.delete(this);
    console.warn(`${LOG_GUARD} not sent, answered empty (draft node):`, url);
    answerEmpty(this, url);
  };
}

/**
 * Let an XHR report the empty result without ever having gone anywhere.
 *
 * The response state lives on the instance, shadowing the prototype's accessors, so every reader sees
 * a request that succeeded — `HttpXhrBackend` reads status, statusText, the headers and the response,
 * and takes the whole reply from them.
 */
function answerEmpty(xhr: XMLHttpRequest, url: string): void {
  const shadow = (property: string, value: unknown) =>
    Object.defineProperty(xhr, property, { configurable: true, get: () => value });

  shadow('readyState', XMLHttpRequest.DONE);
  shadow('status', 200);
  shadow('statusText', 'OK');
  shadow('responseURL', url);
  shadow('responseText', EMPTY_RESULT);
  // What `response` holds depends on what the caller asked for, exactly as it would for a real reply:
  // a parsed body only for `json`, the raw text for `text` and for the default empty response type.
  shadow('response', xhr.responseType === 'json' ? JSON.parse(EMPTY_RESULT) : EMPTY_RESULT);
  Object.defineProperty(xhr, 'getAllResponseHeaders', {
    configurable: true,
    value: () => 'content-type: application/json\r\n',
  });
  Object.defineProperty(xhr, 'getResponseHeader', {
    configurable: true,
    value: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null),
  });

  // Asynchronously, because a real one never answers within `send`: the caller registers nothing after
  // it, but it does return before its listeners may run. Through `setTimeout`, so the bundle's zone
  // takes the callback and its change detection follows.
  setTimeout(() => {
    xhr.dispatchEvent(new Event('readystatechange'));
    xhr.dispatchEvent(new ProgressEvent('load'));
    xhr.dispatchEvent(new ProgressEvent('loadend'));
  });
}
