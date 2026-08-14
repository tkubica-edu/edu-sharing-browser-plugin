/**
 * Compensation for every place where the edu-sharing bundle opens a window itself: it builds those URLs from the
 * DOM's base href, which is the extension here rather than the repository, so each dies on an extension error page.
 * {@link installBundleWindowRedirect} rewrites them, {@link captureBundleEditorWindow} takes one over instead.
 */

/** Path the bundle's own routes start with (its `UIConstants.ROUTER_PREFIX`). */
const ROUTER_PREFIX = 'components/';

/** Query param the bundle marks a window it wants the picked node sent back through. */
const REURL_PARAM = 'reurl';

/** Query param that lets a repository route be used under a guest session. */
const ALLOW_GUEST_PARAM = 'allowGuest';

/**
 * The query string a repository route is opened with, asking for guest access where a node is picked to be
 * handed back (`reurl`). The panel's session may be a guest one, which the repository's search refuses
 * without that flag — the window would show the login instead of the search.
 */
function repositoryQuery(params: URLSearchParams): string {
  if (params.has(REURL_PARAM)) params.set(ALLOW_GUEST_PARAM, 'true');
  const query = params.toString();
  return query ? `?${query}` : '';
}

/**
 * Where a window the bundle wants to open should really point; null for a URL that already targets a normal
 * web origin. `rawUrl` is the URL as passed to `window.open` — possibly relative, or empty for a blank window.
 */
export function repositoryWindowUrl(rawUrl: string, repositoryUrl: string): string | null {
  const base = repositoryUrl.replace(/\/+$/, '');
  if (!base) return null;

  let resolved: URL;
  try {
    resolved = new URL(rawUrl || '', document.baseURI);
  } catch {
    return null;
  }
  // Already a real web URL (the connector link itself, a permalink) — leave it alone.
  if (/^https?:$/.test(resolved.protocol)) return null;

  // Anything else resolved against our own document: an extension URL the bundle believes to be a
  // repository one. Carry its route over to the repository, so the tab opens where the bundle
  // meant to send it.
  // Without a recognizable route (an empty URL for a blank window) the repository itself is the
  // best target: the bundle navigates the tab on from there anyway.
  const start = resolved.pathname.indexOf(ROUTER_PREFIX);
  if (start < 0) return `${base}/`;
  const query = repositoryQuery(resolved.searchParams);
  return `${base}/${resolved.pathname.slice(start)}${query}${resolved.hash}`;
}

/**
 * Answers a window the bundle wants to open instead of the repository redirect, for the URL it was
 * asked about. Returning null passes the call on to the redirect.
 */
type WindowTakeover = (rawUrl: string) => Window | null;

/**
 * The takeover currently claiming the bundle's windows, if any. At most one: the screens registering
 * it are leaves of the navigation, so two are never mounted at once — and two claims on the same
 * window would have no defined winner anyway.
 */
let takeover: WindowTakeover | null = null;

/** The native `window.open`, kept from before the patch so the redirect can call through. */
let nativeOpen: typeof window.open | null = null;

/** Where the redirect currently sends the bundle's windows; set by the install below. */
let currentRepositoryUrl: () => string = () => '';

/**
 * Send every window the bundle opens on one of its own routes to the repository instead of to the extension,
 * for the rest of the document's life. Idempotent: later calls only refresh where "the repository" points.
 * Real web URLs are passed through untouched, so nothing outside the bundle's own routes is affected.
 */
export function installBundleWindowRedirect(repositoryUrl: () => string): void {
  currentRepositoryUrl = repositoryUrl;
  if (nativeOpen) return;
  nativeOpen = window.open;
  window.open = (url?: string | URL, target?: string, features?: string): Window | null => {
    const raw = url instanceof URL ? url.href : url ?? '';
    const rewritten = repositoryWindowUrl(raw, currentRepositoryUrl());
    // A real web URL (the connector link itself, a permalink) — not ours to interfere with.
    if (rewritten === null) return nativeOpen!.call(window, url, target, features);
    // `target`/`features` are the bundle's own and are passed on unchanged: the caller keeps the
    // handle it expects (the preview widget closes the window it opened), and no `noopener` is added
    // — the picked node comes back through `window.opener.postMessage`.
    return takeover?.(raw) ?? nativeOpen!.call(window, rewritten, target, features);
  };
}

/**
 * Take over the window the bundle opens for the editor while a screen embedding such an element is mounted;
 * returns the undo, since the claim is global. The panel lives in this tab and cannot follow a new one, so
 * the window stays a stub and its URL goes to `onEditorUrl`, which takes this tab there.
 */
export function captureBundleEditorWindow(
  repositoryUrl: () => string,
  onEditorUrl: (url: string) => void,
): () => void {
  // Installed from here too, not just by the bundle service: the screen is constructed before the
  // bundle has finished loading, so this must not depend on which of the two ran first.
  installBundleWindowRedirect(repositoryUrl);
  const claim: WindowTakeover = () => stubWindow(repositoryUrl, onEditorUrl);
  takeover = claim;
  return () => {
    // Only if it is still ours — a later claim is the one in force, and dropping that one instead
    // would leave the screen holding it without a takeover.
    if (takeover === claim) takeover = null;
  };
}

/**
 * Stands in for the window the bundle believes it opened. It only has to carry what the bundle does
 * with the handle: assign `location.href` once the node exists, and `close()` it when creating
 * failed.
 */
function stubWindow(repositoryUrl: () => string, onEditorUrl: (url: string) => void): Window {
  const location = {
    set href(value: string) {
      onEditorUrl(editorUrl(value, repositoryUrl()));
    },
    get href(): string {
      return '';
    },
  };
  return { location, close: () => {}, closed: false, focus: () => {} } as unknown as Window;
}

/**
 * The URL to actually navigate to, from what the bundle assigned. Normalized because the bundle composes it
 * by string and we hand it on to `tabs.update` and store it as the resumed page, where it should be the
 * address the page will really have.
 */
function editorUrl(raw: string, repositoryUrl: string): string {
  const rewritten = repositoryWindowUrl(raw, repositoryUrl);
  if (rewritten) return rewritten;
  try {
    return new URL(raw, document.baseURI).href;
  } catch {
    return raw;
  }
}
