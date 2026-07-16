import { bootstrapApplication } from '@angular/platform-browser';
import browser from 'webextension-polyfill';

import { AppComponent } from './app/app.component';
import { buildAppConfig } from './app/app.config';
import { APP_CONFIG, toApiRootUrl } from './app/config';

// Read the persisted repository URL before bootstrapping, so the library gets the
// right rootUrl up front.
async function readRepositoryBase(): Promise<string> {
  try {
    if (browser?.runtime?.id && browser.storage?.local) {
      const key = APP_CONFIG.storageKeys.repositoryUrl;
      const items = await browser.storage.local.get({ [key]: APP_CONFIG.defaultRepositoryUrl });
      const stored = items[key];
      if (typeof stored === 'string' && stored.trim()) return stored.trim();
    }
  } catch {
    /* not in an extension context — use default */
  }
  return APP_CONFIG.defaultRepositoryUrl;
}

(async () => {
  const repositoryBase = await readRepositoryBase();
  const rootUrl = toApiRootUrl(repositoryBase);
  try {
    await bootstrapApplication(AppComponent, buildAppConfig(rootUrl));
  } catch (err) {
    console.error('bootstrap failed', err);
  }
})();
