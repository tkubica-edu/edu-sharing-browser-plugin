import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { filter, take, timeout } from 'rxjs/operators';
import { ConfigService } from 'ngx-edu-sharing-api';

import { OptionsRegistryService } from './options-registry.service';
import { NavigationService } from './navigation.service';
import { ExtService } from './ext.service';
import { PluginContextService } from './plugin-context.service';
import { AppOption, Conditions } from '../model/options';
import { EduSharingPluginApi, PluginOptionInput } from '../plugin/plugin-api';
import { registerMetadataAgent } from '../integrations/metadata-agent.adapter';
import { APP_CONFIG } from '../config';

// Config-variable keys (untyped, dynamic keys on the edu-sharing Variables string map).
const VAR_URL = 'additionalWebComponentUrl';
const VAR_MODE = 'additionalWebComponentMode'; // 'iframe' (default) | 'element'

// Detects an externally configured web component via the edu-sharing ConfigService,
// probes it for reachability, exposes the `window.eduSharingPlugin` registration API, and
// loads the component so it can contribute/replace menu options. Fully degrades to the
// built-in menu when no URL is configured or the component is unreachable.
//
// Two load modes (see the plan's CSP notes):
//  - 'iframe'  (default, MV3/Web-Store safe): the component runs in a sandboxed iframe on
//    its own origin; the extension registers the contribution on its behalf (adapter).
//  - 'element' (opt-in; needs a script-src CSP relaxation, enterprise/Firefox): the remote
//    bundle is injected as a script and registers itself via window.eduSharingPlugin.
@Injectable({ providedIn: 'root' })
export class AdditionalWebComponentService {
  private readonly config = inject(ConfigService);
  private readonly registry = inject(OptionsRegistryService);
  private readonly nav = inject(NavigationService);
  private readonly ext = inject(ExtService);
  private readonly ctx = inject(PluginContextService);

  private started = false;

  async init(): Promise<void> {
    if (this.started) return;
    this.started = true;

    // The registration API is always available, so injected/bridged code can call it.
    this.installApi();

    // Resolve the URL + mode. A non-empty APP_CONFIG override wins and short-circuits the
    // backend config lookup entirely (used for local testing — no backend variable needed).
    let url = (APP_CONFIG.additionalWebComponentUrl ?? '').trim();
    let mode: 'iframe' | 'element' = APP_CONFIG.additionalWebComponentMode === 'element' ? 'element' : 'iframe';

    if (!url) {
      let vars: Record<string, string> | null = null;
      try {
        vars = (await firstValueFrom(
          this.config.observeVariables().pipe(filter((v) => !!v), take(1), timeout(8000))
        )) as Record<string, string> | null;
      } catch {
        return; // config unreachable → built-in menu (graceful)
      }
      url = (vars?.[VAR_URL] ?? '').trim();
      if (!url) return; // not configured → nothing to do
      mode = (vars?.[VAR_MODE] ?? 'iframe').trim() === 'element' ? 'element' : 'iframe';
    }

    console.log('[edu-sharing][additional-wc] configured:', { url, mode });
    if (!(await this.isReachable(url))) {
      console.warn('[edu-sharing][additional-wc] not reachable, keeping built-in menu:', url);
      return;
    }

    // Register the contribution + disable login UP FRONT so the menu reflects it
    // immediately — independent of, and before, the (heavier / possibly CSP-blocked)
    // element-bundle download. Otherwise a slow/failed bundle load would strand the user
    // on the login gate.
    registerMetadataAgent(this.api(), { url, mode });
    console.log('[edu-sharing][additional-wc] contribution registered; loginRequirementDisabled =',
      this.nav.loginRequirementDisabled());
    if (this.nav.view() === 'login' && this.nav.loginRequirementDisabled()) this.nav.land();

    // Element mode: load the bundle so the custom element becomes defined for the view.
    // A failure here leaves the menu/option intact (the view then surfaces the error).
    if (mode === 'element') {
      try {
        await this.loadElementBundle(url);
        console.log('[edu-sharing][additional-wc] element bundle loaded; defined =',
          !!customElements.get('metadata-agent-canvas'));
      } catch (e: unknown) {
        console.warn('[edu-sharing][additional-wc] element bundle failed (CSP?):', e);
      }
    }
  }

  // ---- loading -------------------------------------------------------------

  // Load the agent's multi-file Angular bundle from `base` (a build with outputHashing:none
  // → runtime.js / polyfills.js / main.js / styles.css), in the same order its index.html
  // uses. main.js sees no app-root and self-registers customElements.define('metadata-agent-canvas').
  // polyfills.js is the agent's zone.js; the sidebar is zoneless (ships no zone.js) so there
  // is no "Zone already loaded" conflict (cf. EduBundleService).
  private async loadElementBundle(base: string): Promise<void> {
    const root = base.replace(/\/+$/, '');
    this.addLink(`${root}/styles.css`);
    await this.injectScript(`${root}/runtime.js`);
    await this.injectScript(`${root}/polyfills.js`);
    await this.injectScript(`${root}/main.js`);
  }

  private addLink(href: string): void {
    if (document.querySelector(`link[data-additional-wc][href="${href}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.setAttribute('data-additional-wc', '');
    document.head.appendChild(link);
  }

  private injectScript(src: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[data-additional-wc][src="${src}"]`)) { resolve(); return; }
      const script = document.createElement('script');
      script.src = src;
      script.type = 'module';
      script.setAttribute('data-additional-wc', '');
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load ' + src + ' (blocked by CSP?)'));
      document.head.appendChild(script);
    });
  }

  // ---- detection helpers ---------------------------------------------------

  // Extension pages hold host_permissions for https://* / http://*, so a cross-origin
  // fetch here is CORS-exempt. A no-cors GET (opaque response) still resolves on a
  // reachable host, which is all we need for a liveness probe.
  private async isReachable(url: string): Promise<boolean> {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 5000);
    try {
      await fetch(url, { method: 'GET', mode: 'no-cors', signal: controller.signal });
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(t);
    }
  }

  // ---- registration API ----------------------------------------------------

  private installApi(): void {
    if (window.eduSharingPlugin) return;
    window.eduSharingPlugin = this.api();
    // Minimal postMessage bridge for iframe-hosted code that wants to self-register with a
    // *serializable* descriptor (no function `visible`; use `bypassLogin` + built-in id
    // semantics instead). Filter by a source marker.
    window.addEventListener('message', (e: MessageEvent) => {
      const m = e.data as { source?: string; action?: string; option?: PluginOptionInput } | null;
      if (!m || m.source !== 'edu-sharing-plugin') return;
      if (m.action === 'registerOption' && m.option) this.api().registerOption(m.option);
      else if (m.action === 'disableLoginRequirement') this.api().disableLoginRequirement();
    });
  }

  private apiInstance?: EduSharingPluginApi;

  private api(): EduSharingPluginApi {
    if (this.apiInstance) return this.apiInstance;
    const registry = this.registry;
    const nav = this.nav;
    const ext = this.ext;
    const ctx = this.ctx;
    this.apiInstance = {
      version: '1.0.0',
      registerOption(opt: PluginOptionInput): void {
        registry.register([toAppOption(opt)]);
      },
      disableLoginRequirement(): void {
        nav.loginRequirementDisabled.set(true);
      },
      getContext() {
        return ctx.snapshot();
      },
      onContext(cb) {
        // Poll-free subscription is overkill here; return a no-op unsubscribe. Contributed
        // views mostly read getContext() at mount and receive the base64 `data` param.
        cb(ctx.snapshot());
        return () => { /* no-op */ };
      },
      requestPageExtraction() {
        return ext.runAnalyze();
      },
      insertNodes(nodes: unknown[]) {
        ext.insertNodes(nodes);
      }
    };
    return this.apiInstance;
  }
}

// Normalize a contributed PluginOptionInput into an AppOption. A missing `visible` defaults
// to always-visible (the registry then applies the login requirement unless bypassLogin).
function toAppOption(o: PluginOptionInput): AppOption {
  const visible: (c: Conditions) => boolean = o.visible ?? (() => true);
  return {
    id: o.id,
    label: o.label,
    description: o.description ?? '',
    icon: o.icon ?? { kind: 'builtin', key: 'erschliessen' },
    visible,
    bypassLogin: o.bypassLogin,
    view: o.view,
    external: true
  };
}
