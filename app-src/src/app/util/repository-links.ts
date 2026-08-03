/**
 * The node's page in the repository UI. Used as the link of the active node and as the fallback
 * source URL for a document whose own permalink (`virtual:permalink`) is not loaded yet.
 */
export function renderLink(repositoryUrl: string, nodeId: string): string {
  return `${repositoryUrl.replace(/\/+$/, '')}/components/render/${nodeId}`;
}
