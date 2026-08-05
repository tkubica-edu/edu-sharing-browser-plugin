/**
 * The node's page in the repository UI. Used as the link of the active node and as the fallback
 * source URL for a document whose own permalink (`virtual:permalink`) is not loaded yet.
 */
export function renderLink(repositoryUrl: string, nodeId: string): string {
  return `${repositoryUrl.replace(/\/+$/, '')}/components/render/${nodeId}`;
}

/** A node id as the repository writes it into its URLs. */
const NODE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The node a repository page is showing, read from its own URL — the inverse of {@link renderLink},
 * widened to the other views that name their node. Two places carry it:
 *
 * - a path segment, as `…/components/render/<id>` does (a version may follow it);
 * - the `id` parameter, as `…/components/collections?id=<id>` and
 *   `…/components/workspace?root=MY_FILES&id=<id>&…` do — the open collection, the open folder.
 *
 * `null` when the URL names none: a search, a login page, the workspace root. Only pages under
 * `/components/` are read at all, so a node id sitting in the URL of something else is never
 * mistaken for the repository showing that node.
 */
export function nodeIdFromRepositoryUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!parsed.pathname.toLowerCase().includes('/components/')) return null;
  const fromPath = parsed.pathname.split('/').find((segment) => NODE_ID.test(segment));
  if (fromPath) return fromPath;
  const fromQuery = parsed.searchParams.get('id');
  return fromQuery && NODE_ID.test(fromQuery) ? fromQuery : null;
}
