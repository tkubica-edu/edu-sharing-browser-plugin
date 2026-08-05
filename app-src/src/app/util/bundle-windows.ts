/**
 * Compensation for the one place where the edu-sharing web-component bundle opens a window itself.
 *
 * The bundle is a repository app: it builds such URLs from the DOM's base href, which is the
 * *repository* in its own deployment but the **extension** in ours. `<edu-sharing-add-with-connector>`
 * pre-opens a tab on its loading route before creating the node
 * (`window.open(uiService.getLoadingSpinnerUrl())`, i.e. `<base>components/loading`) and navigates
 * that same tab to the connector once the node exists. With our base that first URL is a
 * `chrome-extension://…` path that does not exist, so the tab dies on an extension error page
 * instead of ending up in the editor.
 *
 * Rewriting the URL to the repository fixes it at the root: the tab opens on the repository's own
 * loading route, and the bundle's later navigation to the connector then happens in a tab that
 * lives on the right origin.
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
 * Take over the window the bundle opens for the editor, for as long as a screen embedding such an
 * element is mounted. Returns the undo — patching `window` is global, so it must not outlive that
 * screen.
 *
 * A tab we cannot reach is worse than no tab: the panel lives in *this* tab and cannot be injected
 * into a new one, so the editor opening there means the user ends up in front of the document
 * without the panel that sent them. So the pre-opened window is not opened at all — it is a stub,
 * and the URL the bundle assigns to it goes to `onEditorUrl` instead. The caller then takes its own
 * tab there, where the panel comes back with the page (see ContentFlowService.openNodePage).
 *
 * Only the bundle's *own* (extension-origin) URLs are taken over — those are the ones it builds
 * from our base href and that lead nowhere. A window it opens on a real web URL is passed straight
 * through, so nothing else the bundle might do is affected.
 */
export function captureBundleEditorWindow(
  repositoryUrl: () => string,
  onEditorUrl: (url: string) => void,
): () => void {
  // The reference itself, not a bound copy: the undo has to put back exactly what was there, or
  // repeated mount/unmount cycles would leave a stack of wrappers behind.
  const original = window.open;
  window.open = (url?: string | URL, target?: string, features?: string): Window | null => {
    const raw = url instanceof URL ? url.href : url ?? '';
    if (repositoryWindowUrl(raw, repositoryUrl()) === null) {
      // A real web URL — not ours to interfere with.
      return original.call(window, url, target, features);
    }
    return stubWindow(repositoryUrl, onEditorUrl);
  };
  return () => {
    window.open = original;
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
