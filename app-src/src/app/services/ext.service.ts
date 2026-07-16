import { Injectable } from '@angular/core';
import browser from 'webextension-polyfill';

export interface ExtractedSource {
  url: string;
  title: string;
  favIconUrl?: string;
}

export interface AnalyzeResult {
  success: boolean;
  result?: any;
  source?: ExtractedSource;
  error?: string;
}

// Wrapper over WebExtension messaging + storage. Privileged work (tab read, /generate)
// is delegated to the background worker to stay CORS-portable across browsers.
@Injectable({ providedIn: 'root' })
export class ExtService {
  /** Whether we appear to be inside the extension (vs. a plain dev server). */
  get available(): boolean {
    return typeof browser !== 'undefined' && !!browser.runtime?.id;
  }

  /** Ask the background worker to run the full analysis for the active tab. */
  async runAnalyze(language = 'de'): Promise<AnalyzeResult> {
    const resp = (await browser.runtime.sendMessage({ action: 'analyze.run', language })) as AnalyzeResult;
    if (!resp) return { success: false, error: 'NO_RESPONSE' };
    return resp;
  }

  async getActiveTab(): Promise<ExtractedSource | null> {
    const resp = (await browser.runtime.sendMessage({ action: 'tabs.getActive' })) as any;
    return resp?.success ? resp.tab : null;
  }

  async storageGet<T>(key: string, fallback: T): Promise<T> {
    const items = await browser.storage.local.get({ [key]: fallback });
    return items[key] as T;
  }

  async storageSet(key: string, value: unknown): Promise<void> {
    await browser.storage.local.set({ [key]: value });
  }

  /** Close the injected panel by messaging the host page; fall back to closing a tab. */
  closePanel(): void {
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'edusharing-panel-close' }, '*');
        return;
      }
    } catch { /* cross-origin parent — fall through */ }
    try { window.close(); } catch { /* ignore */ }
  }
}
