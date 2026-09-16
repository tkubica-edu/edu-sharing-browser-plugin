/**
 * The node's page in the repository UI. Used as the link of the active node and as the fallback
 * source URL for a document whose own permalink (`virtual:permalink`) is not loaded yet.
 */
export function renderLink(repositoryUrl: string, nodeId: string): string {
  return `${repositoryUrl.replace(/\/+$/, '')}/components/render/${nodeId}`;
}

/**
 * Whether a URL can be the repository's: edu-sharing always serves its API and web components under a
 * `/edu-sharing` path, so an address without it names a host but not the deployment on it.
 */
export function isRepositoryUrl(url: string): boolean {
  return /\/edu-sharing\/?$/.test(url.trim());
}

/** A node id as the repository writes it into its URLs. */
const NODE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The node a repository page is showing, read from its own URL — the inverse of {@link renderLink}, widened to the
 * other views that name their node: a path segment, or the `id` parameter of an open collection or folder. Only pages
 * under `/components/` are read, so a node id in another URL is never mistaken for the repository showing it.
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
