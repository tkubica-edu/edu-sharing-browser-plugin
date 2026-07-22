// Sidebar defaults. API base is fixed; the repository URL is a user-editable default.
export const APP_CONFIG = {
  apiUrl: 'https://metadata-agent-api.vercel.app',
  defaultRepositoryUrl: 'https://repository.staging.openeduhub.net/edu-sharing',
 //defaultRepositoryUrl: 'http://repository.127.0.0.1.nip.io:8100/edu-sharing',
  // TEST ONLY: static override for the externally loaded web component. When non-empty,
  // AdditionalWebComponentService uses this instead of the backend config variable
  // (additionalWebComponentUrl) — so a local agent can be tested without any backend config.
  // Leave '' for production. Example: 'http://localhost:4300'.
  additionalWebComponentUrl: 'http://localhost:4300',
  additionalWebComponentMode: 'element' as 'iframe' | 'element',
  storageKeys: {
    repositoryUrl: 'eduSharingRepoUrl',
    history: 'eduSharingHistory',
    pendingPreview: 'eduSharingPendingPreview'
  },
  maxHistory: 200
};

// Normalize a repository base to the library's rootUrl (`<host>/edu-sharing/rest`).
export function toApiRootUrl(repositoryBase: string): string {
  let base = (repositoryBase || '').trim().replace(/\/+$/, '');
  if (/\/rest$/.test(base)) return base;
  return base + '/rest';
}
