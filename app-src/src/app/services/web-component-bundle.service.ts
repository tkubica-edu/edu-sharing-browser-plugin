import { Injectable, Signal, inject, signal } from '@angular/core';
import browser from 'webextension-polyfill';

import { errorMessage } from '../util/errors';
import { installBundleWindowRedirect } from '../util/bundle-windows';
import { installDraftRequestGuard } from '../util/bundle-requests';
import { AuthService } from './auth.service';
import { MetadataAgentApiService } from './metadata-agent-api.service';

/**
 * The pre-built web-component bundles packaged with the extension. Each name is both the
 * source folder (`scripts/<name>/`) and the folder in the built extension (see
 * `scripts/build.mjs`, and `web_accessible_resources` in `manifest.base.json`).
 *
 * - `edu` — the edu-sharing bundle (`edu-sharing-mds-editor-wrapper`,
 *   `edu-sharing-preview-sidebar`, `edu-sharing-nodes-selector`,
 *   `edu-sharing-add-with-connector`).
 * - `wlo` — the additional WLO bundle (`metadata-agent-canvas`), enabled by repository
 *   config (see BrowserExtensionCustomWebComponentService).
 */
export type WebComponentBundle = 'edu' | 'wlo';

/** One `<script>` of a bundle, in load order. */
interface BundleScript {
  src: string;
  module: boolean;
}

/** A bundle's entry points, in load order. */
interface BundleEntries {
  styles: string[];
  scripts: BundleScript[];
}

/** Load state of a bundle, for gating a custom element in a template. */
export interface BundleStatus {
  /** True once the bundle's scripts have run (and the awaited element is defined). */
  ready: Signal<boolean>;
  /** The failure message if loading went wrong. */
  error: Signal<string | null>;
}

/** How long to wait for a bundle to define an awaited element before giving up on it. */
const ELEMENT_TIMEOUT_MS = 15_000;

/**
 * Loads the packaged web-component bundles into THIS document (the sidebar) — no iframe — so their
 * custom elements can be used as real tags. Each bundle is loaded at most once (memoised).
 *
 * Remote loading is unsupported by design: MV3 forbids remote code on extension pages and the
 * extension CSP is `script-src 'self'`, so every bundle ships as a `web_accessible_resource`.
 *
 * Constraints that shaped this (see README "Direct web-component embedding"):
 * - `window.__env.EDU_SHARING_API_URL` must be set BEFORE the edu bundle boots; its HttpClient
 *   freezes the value at bootstrap.
 * - A bundle's `polyfills` script is its own zone.js. The sidebar app is zoneless, so the first
 *   bundle to load provides Zone — a second load throws "Zone already loaded", hence the guard in
 *   {@link addScript}.
 * - `main` is loaded as an ES module so its relative dynamic chunk imports resolve against the
 *   bundle folder, not the sidebar document.
 * - The edu bundle's `scripts.js` (jQuery + globals) is a classic script and must run first.
 */
@Injectable({ providedIn: 'root' })
export class WebComponentBundleService {
  private readonly auth = inject(AuthService);
  private readonly agentApi = inject(MetadataAgentApiService);

  private readonly loads = new Map<WebComponentBundle, Promise<void>>();

  /** Idempotently load a bundle; resolves once its scripts have run. */
  load(bundle: WebComponentBundle): Promise<void> {
    let load = this.loads.get(bundle);
    if (!load) {
      load = this.loadEntries(bundle);
      this.loads.set(bundle, load);
    }
    return load;
  }

  /**
   * Resolve once `tag` is a defined custom element. Rejects after {@link ELEMENT_TIMEOUT_MS}
   * so a renamed or missing tag surfaces as an error instead of hanging forever.
   */
  whenElementDefined(tag: string): Promise<void> {
    return Promise.race([
      customElements.whenDefined(tag).then(() => undefined),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`<${tag}> was not defined within ${ELEMENT_TIMEOUT_MS}ms`)),
          ELEMENT_TIMEOUT_MS,
        ),
      ),
    ]);
  }

  private async loadEntries(bundle: WebComponentBundle): Promise<void> {
    this.publishEnvironment(bundle);
    // The edu bundle opens windows on its own routes and builds them from the DOM's base href — the
    // extension here, so they lead nowhere. Redirecting them to the repository is a correction of
    // that base, so it lives as long as the bundle does rather than being scoped to a screen; see
    // installBundleWindowRedirect.
    if (bundle === 'edu') {
      installBundleWindowRedirect(() => this.auth.repositoryUrl());
      // The bundle's widgets ask the repository about the node they are given, including the stand-in
      // the curation renders a form on — which identifies nothing there. Also a correction that
      // belongs to the bundle rather than to a screen; see installDraftRequestGuard.
      installDraftRequestGuard();
    }
    const { styles, scripts } = await this.entriesOf(bundle);
    for (const href of styles) this.addLink(href);
    for (const script of scripts) await this.addScript(script);
  }

  /**
   * The edu bundle has stable file names, so its entries are declared here. The wlo bundle
   * uses content-hashed names, so they are read from its own `index.html` — nothing to keep
   * in sync after a rebundle.
   */
  private async entriesOf(bundle: WebComponentBundle): Promise<BundleEntries> {
    if (bundle === 'edu') {
      return {
        styles: [this.assetUrl(bundle, 'styles.css')],
        scripts: [
          { src: this.assetUrl(bundle, 'scripts.js'), module: false },
          { src: this.assetUrl(bundle, 'polyfills.js'), module: true },
          { src: this.assetUrl(bundle, 'main.js'), module: true },
        ],
      };
    }
    return this.readIndexHtml(bundle);
  }

  /** The `<link rel="stylesheet">` / `<script src>` entries a bundle's index.html declares. */
  private async readIndexHtml(bundle: WebComponentBundle): Promise<BundleEntries> {
    const response = await fetch(this.assetUrl(bundle, 'index.html'));
    if (!response.ok) {
      throw new Error(`${bundle}/index.html not found (${response.status})`);
    }
    // Parsed detached: <script src> tags in a DOMParser document are inert, so nothing runs
    // until addScript() re-creates them in this document.
    const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
    const localAssets = (selector: string, attribute: string) =>
      Array.from(doc.querySelectorAll(selector))
        .map((element) => element.getAttribute(attribute) ?? '')
        .filter((value) => !!value && !/^([a-z]+:)?\/\//i.test(value))
        .map((value) => this.assetUrl(bundle, value));
    return {
      styles: localAssets('link[rel="stylesheet"][href]', 'href'),
      scripts: localAssets('script[src]', 'src').map((src) => ({ src, module: true })),
    };
  }

  /**
   * Publish the globals a bundle reads at bootstrap — both freeze their value there, so this has
   * to happen before the scripts run.
   *
   * - `edu` reads `window.__env.EDU_SHARING_API_URL`, which MUST be absolute: the bundle passes it
   *   through unchanged only when it starts with http(s):// (getAbsoluteEndpointUrl). A relative
   *   value would resolve against this document's origin — the extension — so the top-level
   *   connector navigation (…/eduservlet/connector) would become chrome-extension://ID/… and never
   *   load. Better to refuse booting with a clear error than to produce that URL silently.
   * - `wlo` reads `window.__ENV.agentUrl` for the metadata-agent API, falling back to its own
   *   hardcoded default if unset — so this keeps it on the configured API.
   */
  private publishEnvironment(bundle: WebComponentBundle): void {
    const globals = window as unknown as {
      __env?: Record<string, string>;
      __ENV?: Record<string, string>;
    };
    if (bundle === 'wlo') {
      globals.__ENV = { ...(globals.__ENV ?? {}), agentUrl: this.agentApi.baseUrl() };
      return;
    }
    const apiRootUrl = this.auth.apiRootUrl();
    if (!/^https?:\/\//i.test(apiRootUrl)) {
      throw new Error(
        `EDU_SHARING_API_URL must be an absolute http(s) URL, got "${apiRootUrl}". ` +
          'Configure the repository as a full URL (…/edu-sharing) so it normalizes to …/edu-sharing/rest.',
      );
    }
    globals.__env = { ...(globals.__env ?? {}), EDU_SHARING_API_URL: apiRootUrl };
  }

  private assetUrl(bundle: WebComponentBundle, file: string): string {
    const path = `${bundle}/${file.replace(/^\.?\//, '')}`;
    return browser?.runtime?.getURL ? browser.runtime.getURL(path) : path;
  }

  private addLink(href: string): void {
    if (document.querySelector(`link[data-web-component-bundle][href="${href}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.setAttribute('data-web-component-bundle', '');
    document.head.appendChild(link);
  }

  private addScript({ src, module }: BundleScript): Promise<void> {
    // Skip a bundle's zone.js when another bundle already provided one (see class comment).
    if (/(^|\/)polyfills[.-]/.test(src) && (window as unknown as { Zone?: unknown }).Zone) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      if (module) script.type = 'module';
      script.setAttribute('data-web-component-bundle', '');
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load ' + src));
      document.head.appendChild(script);
    });
  }
}

/**
 * Load a bundle and track it as signals, for components that embed one of its elements:
 *
 * ```ts
 * protected readonly bundle = loadWebComponentBundle('edu', 'edu-sharing-preview-sidebar');
 * ```
 * ```html
 * @if (bundle.ready()) { <edu-sharing-preview-sidebar … /> }
 * ```
 *
 * Pass `elementTag` when the element must be defined before it is rendered (its inputs have
 * to be in place as it upgrades); omit it when the element is created imperatively.
 * Must be called in an injection context (i.e. as a field initializer).
 */
export function loadWebComponentBundle(
  bundle: WebComponentBundle,
  elementTag?: string,
): BundleStatus {
  const bundles = inject(WebComponentBundleService);
  const ready = signal(false);
  const error = signal<string | null>(null);
  bundles
    .load(bundle)
    .then(() => (elementTag ? bundles.whenElementDefined(elementTag) : undefined))
    .then(() => ready.set(true))
    .catch((cause: unknown) => error.set(errorMessage(cause)));
  return { ready: ready.asReadonly(), error: error.asReadonly() };
}
