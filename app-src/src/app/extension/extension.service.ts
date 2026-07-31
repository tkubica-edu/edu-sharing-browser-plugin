import { Injectable, inject, signal } from '@angular/core';
import { ConfigService, Variables } from 'ngx-edu-sharing-api';
import browser from 'webextension-polyfill';

import { AppOption, Conditions, OptionId } from '../model/options';
import {
  CustomOptionRendering, EduSharingExtensionApi, ExtensionOption, OptionSlot,
} from './extension.model';
import { WLO_ELEMENT_TAG, registerWloOptions } from './register-wlo-options';

/** Boolean config variable that switches the extension point on. */
const WEB_COMPONENT_VARIABLE = 'additionalWebComponent';

/** Folder of the packaged wlo web-component bundle (see scripts/wlo → dist/<t>/wlo). */
const WLO_BUNDLE_DIR = 'wlo';

/** How long to wait for the bundle to define its element before registering anyway. */
const ELEMENT_TIMEOUT_MS = 15_000;

/**
 * Central, self-contained extension point for the "Aktionen & Optionen" menu.
 *
 * The extension only activates when the repository config enables
 * `additionalWebComponent`: the packaged `wlo/` web-component bundle is loaded, the options
 * for its elements are registered (see register-wlo-options.ts), and the registration API is
 * exposed on `window.eduSharingExtension` so the bundle can contribute more of its own.
 * Without the variable nothing is registered and the default application is used unchanged.
 *
 * The feature is decoupled from the core: it lives under `app/extension/` and the core
 * only reaches it through a few thin pass-throughs (navigation, menu, shell). Removing the
 * feature means deleting this folder and reverting those hooks (see README.md).
 */
@Injectable({ providedIn: 'root' })
export class ExtensionService {
  private readonly configService = inject(ConfigService);

  private readonly registeredOptions = signal<ExtensionOption[]>([]);
  private readonly registeredRenderings = signal<CustomOptionRendering[]>([]);
  private readonly loginRequiredState = signal(true);

  /** Whether login must be completed before other options are usable. */
  readonly loginRequired = this.loginRequiredState.asReadonly();

  private activated = false;

  /**
   * Subscribes to the repository config variables. When `additionalWebComponent` is enabled,
   * the extension is activated once; otherwise this is a no-op and the default application
   * is used.
   */
  initialize(): void {
    this.configService.observeVariables().subscribe((variables) => {
      if (this.extensionEnabled(variables)) this.activate();
    });
  }

  // --- registration API (used by the loaded bundle via window.eduSharingExtension) ------

  /** Add a new option, or replace a built-in one carrying the same id. */
  registerOption(option: ExtensionOption): void {
    this.registeredOptions.update((options) => [
      ...options.filter((existing) => existing.id !== option.id),
      option,
    ]);
  }

  /** Register a custom rendering (template or custom element) for an option + slot. */
  registerRendering(rendering: CustomOptionRendering): void {
    this.registeredRenderings.update((renderings) => [
      ...renderings.filter(
        (existing) => !(existing.optionId === rendering.optionId && existing.slot === rendering.slot),
      ),
      rendering,
    ]);
  }

  /** Set whether login is required as a first step (e.g. relax it for custom elements). */
  setLoginRequired(required: boolean): void {
    this.loginRequiredState.set(required);
  }

  // --- consumption API (used by the thin core hooks) ------------------------------------

  /**
   * Merge the base options with the registered ones: a same-id extension option replaces
   * the built-in one in place; new ids are appended after the built-ins.
   */
  applyOptions(base: AppOption[]): AppOption[] {
    const extras = this.registeredOptions();
    if (!extras.length) {
      return base;
    }
    const overrides = new Map<OptionId, AppOption>();
    const appended: AppOption[] = [];
    for (const option of extras) {
      const merged = this.toAppOption(option);
      if (base.some((builtin) => builtin.id === option.id)) {
        overrides.set(option.id, merged);
      } else {
        appended.push(merged);
      }
    }
    return [...base.map((option) => overrides.get(option.id) ?? option), ...appended];
  }

  /** The custom rendering for an option + slot that applies to the given conditions. */
  getRendering(slot: OptionSlot, id: OptionId, conditions: Conditions): CustomOptionRendering | null {
    return (
      this.registeredRenderings().find(
        (rendering) =>
          rendering.slot === slot &&
          rendering.optionId === id &&
          (!rendering.useCallback || rendering.useCallback(conditions)),
      ) ?? null
    );
  }

  // --- internals -----------------------------------------------------------------------

  // A boolean flag. `Variables` types every value as string, so a config that delivers the
  // raw string "true"/"false" is honoured as well.
  private extensionEnabled(variables: Variables | null): boolean {
    const value = variables?.[WEB_COMPONENT_VARIABLE] as unknown;
    if (typeof value === 'boolean') return value;
    return typeof value === 'string' && value.trim().toLowerCase() === 'true';
  }

  private activate(): void {
    if (this.activated) {
      return;
    }
    this.activated = true;

    const api: EduSharingExtensionApi = {
      registerOption: (option) => this.registerOption(option),
      registerRendering: (rendering) => this.registerRendering(rendering),
      setLoginRequired: (required) => this.setLoginRequired(required),
    };
    // Exposed so a bundle CAN self-register; bundles that only provide custom elements
    // (like metadata-agent-canvas) don't, so the app registers the option on load below.
    window.eduSharingExtension = api;

    void this.loadWebComponentBundle()
      .then(() => this.whenElementDefined(WLO_ELEMENT_TAG))
      .then(() => {
        // Runs once the bundle's element is actually defined — its scripts only *start* the
        // bundle, which registers the element during its own async bootstrap. Registering
        // afterwards guarantees the tag upgrades as soon as an option renders it.
        registerWloOptions(api);
      })
      .catch((e: unknown) =>
        console.error('[edu-sharing][extension] failed to load the wlo web-component bundle:', e),
      );
  }

  private toAppOption(option: ExtensionOption): AppOption {
    return {
      id: option.id,
      label: option.label ?? String(option.id),
      description: option.description ?? '',
      icon: option.icon ?? '',
      visible: option.visible ?? (() => true),
    };
  }

  /**
   * Load the packaged wlo bundle (`wlo/`) into THIS document, so the elements it defines
   * (`metadata-agent-canvas`, …) are usable as real tags.
   *
   * Remote loading is not an option here: MV3 forbids remote code on extension pages and the
   * CSP is `script-src 'self'`. The bundle therefore ships inside the extension as a
   * web_accessible_resource and is loaded from its own folder.
   *
   * The bundle's file names are content-hashed, so the entry points are read from the
   * bundle's own `index.html` (in document order) instead of being hardcoded.
   */
  private async loadWebComponentBundle(): Promise<void> {
    const { styles, scripts } = await this.readBundleIndex();

    for (const href of styles) this.addLink(href);
    for (const src of scripts) {
      // zone.js — loaded only if no other bundle brought a Zone already (zone.js throws
      // "Zone already loaded" on a second load; see EduBundleService).
      if (/(^|\/)polyfills[.-]/.test(src) && (window as unknown as { Zone?: unknown }).Zone) {
        continue;
      }
      // Modules, as in the bundle's index.html: relative dynamic chunk imports must resolve
      // against the bundle folder, not against the sidebar document.
      await this.addScript(src, true);
    }
  }

  /**
   * Resolve once `tag` is a defined custom element. Never rejects: on timeout it warns and
   * resolves anyway, so a renamed/missing tag degrades to "option present, element blank"
   * instead of silently dropping the whole registration (the element still upgrades if it
   * is defined later).
   */
  private whenElementDefined(tag: string): Promise<void> {
    return Promise.race([
      customElements.whenDefined(tag).then(() => undefined),
      new Promise<void>((resolve) =>
        setTimeout(() => {
          if (!customElements.get(tag)) {
            console.warn(
              `[edu-sharing][extension] <${tag}> was not defined within ${ELEMENT_TIMEOUT_MS}ms — ` +
                'registering the options anyway.',
            );
          }
          resolve();
        }, ELEMENT_TIMEOUT_MS),
      ),
    ]);
  }

  /** Entry points declared by the bundle's index.html, resolved to extension URLs. */
  private async readBundleIndex(): Promise<{ styles: string[]; scripts: string[] }> {
    const response = await fetch(this.bundleUrl('index.html'));
    if (!response.ok) {
      throw new Error(`${WLO_BUNDLE_DIR}/index.html not found (${response.status})`);
    }
    // Parsed detached: <script src> tags in a DOMParser document are inert, so nothing runs
    // until the elements below are created explicitly.
    const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
    const attr = (el: Element, name: string) => el.getAttribute(name) ?? '';
    const local = (value: string) => !!value && !/^([a-z]+:)?\/\//i.test(value);
    return {
      styles: Array.from(doc.querySelectorAll('link[rel="stylesheet"][href]'))
        .map((el) => attr(el, 'href'))
        .filter(local)
        .map((href) => this.bundleUrl(href)),
      scripts: Array.from(doc.querySelectorAll('script[src]'))
        .map((el) => attr(el, 'src'))
        .filter(local)
        .map((src) => this.bundleUrl(src)),
    };
  }

  private bundleUrl(file: string): string {
    const path = `${WLO_BUNDLE_DIR}/${file.replace(/^\.?\//, '')}`;
    return browser?.runtime?.getURL ? browser.runtime.getURL(path) : path;
  }

  private addLink(href: string): void {
    if (document.querySelector(`link[data-edu-sharing-extension][href="${href}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.setAttribute('data-edu-sharing-extension', '');
    document.head.appendChild(link);
  }

  private addScript(src: string, module: boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      if (module) script.type = 'module';
      script.setAttribute('data-edu-sharing-extension', '');
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load ' + src));
      document.head.appendChild(script);
    });
  }
}
