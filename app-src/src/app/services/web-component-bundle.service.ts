import { Injectable, Signal, inject, signal } from '@angular/core';
import browser from 'webextension-polyfill';

import { errorMessage } from '../util/errors';
import { installBundleWindowRedirect } from '../util/bundle-windows';
import { installDraftRequestGuard } from '../util/bundle-requests';
import { installBundleLanguage } from '../util/bundle-language';
import { AuthService } from './auth.service';
import { MetadataAgentApiService } from './metadata-agent-api.service';
import { RepositoryVersionService, SUPPORTED_VERSIONS_TEXT } from './repository-version.service';

/**
 * The pre-built web-component bundles packaged with the extension: `edu` for the edu-sharing elements, `wlo`
 * for the metadata-agent canvas that the repository config enables, `boerdi` for the chat widget of the KI
 * assistant. Each name is both the source folder (`scripts/<name>/`) and the folder in the built extension.
 */
export type WebComponentBundle = 'edu' | 'wlo' | 'boerdi';

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

/** What a component says instead of an edu element where the repository is not one the bundle fits. */
const UNSUPPORTED_VERSION = (version: string) =>
  `Die eingebetteten edu-sharing Komponenten unterstützen nur ${SUPPORTED_VERSIONS_TEXT}, ` +
  `dieses Repository meldet ${version}.`;

/** How long to wait for a bundle to define an awaited element before giving up on it. */
const ELEMENT_TIMEOUT_MS = 15_000;

/**
 * Loads the packaged bundles into this document — no iframe — so their custom elements can be used as real tags;
 * each at most once. Remote loading is impossible by design: MV3 forbids remote code and the CSP is `script-src
 * 'self'`. Load order and globals are constrained, see {@link publishEnvironment} and {@link addScript}.
 */
@Injectable({ providedIn: 'root' })
export class WebComponentBundleService {
  private readonly auth = inject(AuthService);
  private readonly agentApi = inject(MetadataAgentApiService);
  private readonly repositoryVersion = inject(RepositoryVersionService);

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
    // The edu bundle is the repository's own UI, built from one edu-sharing release: against a repository of
    // another major version its elements talk to an API that is not there. Refused before anything of it is put
    // into the document, so the screens report the version rather than the failures that would follow it. The
    // wlo and boerdi bundles are not the repository's and are not asked about its version.
    if (bundle === 'edu') await this.refuseUnsupportedRepository();
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
      // The bundle chooses its language from the user's profile and from the browser, both of which can be
      // English while the panel around its forms is German only; see installBundleLanguage.
      installBundleLanguage();
      // The theme is the one such correction that is NOT made here: the bundle resolves it from a media
      // query, so the answer has to exist before its scripts run — ThemeService installs it as the app
      // boots and keeps it in step with the panel's setting (see util/bundle-theme.ts).
    }
    const { styles, scripts } = await this.entriesOf(bundle);
    for (const href of styles) this.addLink(href);
    for (const script of scripts) await this.addScript(script);
  }

  /**
   * Throw where the repository named a version the edu bundle was not built for. Waits for `/_about` to have
   * been answered, since the load would otherwise race the boot's own request and let the elements through on
   * a repository that is about to be reported as unsupported.
   */
  private async refuseUnsupportedRepository(): Promise<void> {
    await this.repositoryVersion.load();
    if (this.repositoryVersion.webComponentsRefused()) {
      throw new Error(UNSUPPORTED_VERSION(this.repositoryVersion.version() ?? '—'));
    }
  }

  /**
   * The edu and boerdi bundles have stable file names, so their entries are declared here — the boerdi
   * widget is a single script that carries its styles itself. The wlo bundle uses content-hashed names,
   * so they are read from its own `index.html` — nothing to keep in sync after a rebundle.
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
    if (bundle === 'boerdi') {
      return { styles: [], scripts: [{ src: this.assetUrl(bundle, 'boerdi-widget.js'), module: true }] };
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
   * Publish the globals a bundle reads at bootstrap, where both freeze their value — so this runs before the scripts
   * do. The edu bundle's API URL must be absolute: a relative one would resolve against the extension origin, which
   * no connector navigation can load. The wlo bundle's agent URL keeps it on the configured API. The boerdi widget
   * reads no global at all — it is configured through the attributes of its element.
   */
  private publishEnvironment(bundle: WebComponentBundle): void {
    const globals = window as unknown as {
      __env?: Record<string, string>;
      __ENV?: Record<string, string>;
    };
    if (bundle === 'boerdi') return;
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
 * Load a bundle and track it as signals, for a component that embeds one of its elements. Pass `elementTag`
 * where the element must be defined before it is rendered, so its inputs are in place as it upgrades; omit it
 * for an element created imperatively. Must be called in an injection context.
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
