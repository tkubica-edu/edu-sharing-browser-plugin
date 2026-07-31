import { Injectable } from '@angular/core';
import browser from 'webextension-polyfill';

// Loads the pre-built edu-sharing web-component bundle directly into THIS document
// (the sidebar) — no iframe — so its custom elements (edu-sharing-preview-sidebar,
// …) can be used as real tags. Loaded exactly once and memoised.
//
// Notes / constraints (see README "Direct web-component embedding"):
// - `window.__env.EDU_SHARING_API_URL` must be set BEFORE the bundle boots; the
//   bundle's HttpClient freezes it at bootstrap.
// - `polyfills.js` is the bundle's own zone.js and IS loaded here (before main.js):
//   the sidebar app is zoneless (no zone.js of its own), but this bundle is a
//   zone-based Angular app and requires Zone. Because the sidebar doesn't ship
//   zone.js, there is no "Zone already loaded" double-load conflict.
//   NOTE: if the sidebar ever reverts to zone-based change detection, STOP loading
//   polyfills.js here (the sidebar would provide Zone and a second load would throw).
// - `main.js` is loaded as an ES module so its relative dynamic chunk imports resolve
//   against the bundle folder, not the sidebar document.
// - `scripts.js` (jQuery + globals) is a classic script and must run before main.js.
@Injectable({ providedIn: 'root' })
export class EduBundleService {
  private loadPromise: Promise<void> | null = null;

  /** Idempotently load the bundle, targeting the given API root (`…/edu-sharing/rest`). */
  load(apiRootUrl: string): Promise<void> {
    if (!this.loadPromise) this.loadPromise = this.doLoad(apiRootUrl);
    return this.loadPromise;
  }

  private async doLoad(apiRootUrl: string): Promise<void> {
    // EDU_SHARING_API_URL MUST be absolute. The bundle passes it through unchanged only
    // when it starts with http(s):// (getAbsoluteEndpointUrl); a relative value (e.g. the
    // sample index.html's '/edu-sharing/rest') would be resolved against THIS document's
    // origin — the extension — so the top-level connector navigation
    // (…/eduservlet/connector) would resolve to chrome-extension://ID/… and never load.
    // Refuse to boot with a clear error rather than silently producing that broken URL.
    if (!/^https?:\/\//i.test(apiRootUrl)) {
      throw new Error(
        `EDU_SHARING_API_URL must be an absolute http(s) URL, got "${apiRootUrl}". ` +
          `Configure the repository as a full URL (…/edu-sharing) so it normalizes to …/edu-sharing/rest.`
      );
    }

    const win = window as unknown as { __env?: Record<string, string> };
    win.__env = { ...(win.__env ?? {}), EDU_SHARING_API_URL: apiRootUrl };

    this.addLink(this.url('styles.css'));                // global Angular Material styles
    await this.addScript(this.url('scripts.js'), false);  // jQuery + globals (classic)
    // zone.js — the bundle needs it; sidebar is zoneless. Skipped when the wlo extension
    // bundle already brought its own Zone: zone.js throws "Zone already loaded" on a
    // second load, and either copy serves both bundles.
    if (!(window as unknown as { Zone?: unknown }).Zone) {
      await this.addScript(this.url('polyfills.js'), true);
    }
    await this.addScript(this.url('main.js'), true);       // Angular bundle (module) → registers the elements
  }

  private url(file: string): string {
    return browser?.runtime?.getURL
      ? browser.runtime.getURL('edu/' + file)
      : 'edu/' + file;
  }

  private addLink(href: string): void {
    if (document.querySelector(`link[data-edu-bundle][href="${href}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.setAttribute('data-edu-bundle', '');
    document.head.appendChild(link);
  }

  private addScript(src: string, module: boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      if (module) script.type = 'module';
      script.setAttribute('data-edu-bundle', '');
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load ' + src));
      document.head.appendChild(script);
    });
  }
}
