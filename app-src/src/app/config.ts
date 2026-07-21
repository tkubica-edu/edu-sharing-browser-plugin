// Sidebar defaults. API base is fixed; the repository URL is a user-editable default.
export const APP_CONFIG = {
  apiUrl: 'https://metadata-agent-api.vercel.app',
  defaultRepositoryUrl: 'https://repository.staging.openeduhub.net/edu-sharing',
 //defaultRepositoryUrl: 'http://repository.127.0.0.1.nip.io:8100/edu-sharing',
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
