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
 * Make the bundle's `window.open` calls land on the repository instead of on a non-existent
 * extension URL, for as long as a screen that embeds such an element is mounted. Returns the
 * undo — patching `window` is global, so it must not outlive that screen.
 */
export function redirectBundleWindows(repositoryUrl: () => string): () => void {
  const original = window.open.bind(window);
  window.open = (url?: string | URL, target?: string, features?: string): Window | null => {
    const raw = url instanceof URL ? url.href : url ?? '';
    const redirected = repositoryWindowUrl(raw, repositoryUrl());
    return original(redirected ?? url, target, features);
  };
  return () => {
    window.open = original;
  };
}
