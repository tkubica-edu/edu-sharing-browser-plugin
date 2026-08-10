/**
 * Compensation for every place where the edu-sharing web-component bundle opens a window itself.
 *
 * The bundle is a repository app: it builds such URLs from the DOM's base href, which is the
 * *repository* in its own deployment but the **extension** in ours. So each of them comes out as a
 * `chrome-extension://…` path that does not exist, and the window dies on an extension error page.
 * Two of them are reached from the panel:
 *
 * - `<edu-sharing-add-with-connector>` pre-opens a tab on its loading route before creating the node
 *   (`window.open(uiService.getLoadingSpinnerUrl())`, i.e. `<base>components/loading`) and navigates
 *   that same tab to the connector once the node exists.
 * - the native preview widget's "Aus der Suche auswählen" opens the repository's search with a reurl
 *   (`UIHelper.openSearchWithReurl(…, 'WINDOW')`, i.e. `<base>components/search?…&reurl=WINDOW`) and
 *   waits for the picked node to come back through `window.opener.postMessage`.
 *
 * Rewriting the URL to the repository fixes both at the root: the window opens on the repository's
 * own route, so the bundle's later navigation happens on the right origin and the session cookie
 * applies. That is what {@link installBundleWindowRedirect} does, and it is the default for every
 * such URL.
 *
 * A caller can take one of those windows over instead ({@link captureBundleEditorWindow}), for the
 * case where the panel cannot follow where the window would go.
 */

/** Path the bundle's own routes start with (its `UIConstants.ROUTER_PREFIX`). */
const ROUTER_PREFIX = 'components/';

/**
 * Where a window the bundle wants to open should really point. Returns null for a URL that already
 * targets a normal web origin — that one is meant as it is and must not be touched.
 *
 * @param rawUrl the URL as passed to `window.open` (may be relative, or empty for a blank window)
 * @param repositoryUrl the repository base (`…/edu-sharing`)
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
  return `${base}/${resolved.pathname.slice(start)}${resolved.search}${resolved.hash}`;
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
 * Send every window the bundle opens on one of its own routes to the repository instead of to the
 * extension, for the rest of the document's life. Idempotent — the first call patches, later ones
 * only refresh where "the repository" points.
 *
 * Not scoped to a screen, unlike the takeover below: this is a correction of the bundle's base href
 * and belongs to the bundle, whose lifetime is the document's. It is a no-op for every real web URL
 * (those are passed through untouched), so nothing that does not come from the bundle's own routes
 * is affected — and the one screen that does not want its window opened at all claims it explicitly.
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
 * Take over the window the bundle opens for the editor, for as long as a screen embedding such an
 * element is mounted. Returns the undo — the claim is global, so it must not outlive that screen
 * (the redirect it is registered on stays either way).
 *
 * A tab we cannot reach is worse than no tab: the panel lives in *this* tab and cannot be injected
 * into a new one, so the editor opening there means the user ends up in front of the document
 * without the panel that sent them. So the pre-opened window is not opened at all — it is a stub,
 * and the URL the bundle assigns to it goes to `onEditorUrl` instead. The caller then takes its own
 * tab there, where the panel comes back with the page (see ContentFlowService.openNodePage).
 *
 * Only the bundle's *own* (extension-origin) URLs reach here — those are the ones it builds from our
 * base href and that lead nowhere. A window it opens on a real web URL is passed straight through,
 * so nothing else the bundle might do is affected.
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
 * The URL to actually navigate to, from what the bundle assigned.
 *
 * Normalized, because the bundle composes it by string (`…/rest/` + `../eduservlet/connector?…`):
 * a browser collapses that on navigation, but we hand the URL on to `tabs.update` and store it as
 * the resumed page, and there it should be the address the page will really have. An
 * extension-origin value — only possible with a missing `__env` — is carried over to the repository
 * rather than navigated to, as everywhere else here.
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
