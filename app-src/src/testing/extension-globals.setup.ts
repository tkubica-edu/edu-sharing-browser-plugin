/**
 * Lets `webextension-polyfill` be imported outside an extension. The module throws on import unless
 * `chrome.runtime.id` exists, and it is reached from almost every service transitively — a DI token
 * pulls in the class, the class pulls in `BrowserExtensionService`, and that imports the polyfill. So
 * a spec cannot avoid it by not touching the extension.
 *
 * `globalThis.browser` is set as well as `chrome`: with a `browser.runtime.id` already in place the
 * polyfill skips building its wrappers and re-exports this object unchanged (see the last lines of
 * `dist/browser-polyfill.js`). That makes what the app receives *this* object rather than a wrapper
 * around a chrome shim — which is what lets the proxy below stand between a test and the browser.
 *
 * Everything except `runtime.id` throws. The extension APIs are an outbound channel like any other,
 * and a service that reaches them un-faked must fail its test rather than quietly do nothing:
 * `fakeBrowserExtension()` is what a spec provides in place of `BrowserExtensionService`.
 *
 * The one spec that cannot do that is the one whose subject *is* the wrapper — see
 * {@link useExtensionApi}.
 */

/** The one member that has to answer, because the polyfill's own guard reads it. */
const RUNTIME_ID = 'edu-sharing-unit-test';

/** The APIs a spec answers with itself, or null while the refusal below stands. */
let installed: Record<string, unknown> | null = null;

/**
 * Answer `browser.*` out of `api` instead of refusing. For `browser-extension.service.spec.ts`, whose
 * subject is the wrapper over these APIs and which therefore has to let it reach them.
 *
 * Installed here rather than by the spec assigning `globalThis.browser` itself, because by then it is
 * too late: `webextension-polyfill` reads the global once, at import, and re-exports it unchanged —
 * so the service holds whatever object stood there when its module was first evaluated, which is this
 * proxy. Swapping what the proxy answers out of is the only way in that a spec still controls.
 */
export function useExtensionApi(api: Record<string, unknown>): void {
  installed = api;
}

/** Put the refusal back, which is every other spec's state. */
export function resetExtensionApi(): void {
  installed = null;
}

function unreachable(namespace: string): never {
  throw new Error(
    `a unit test reached for browser.${namespace} — provide fakeBrowserExtension() in place of ` +
      'BrowserExtensionService instead of letting a service talk to the extension',
  );
}

/** A namespace whose every member refuses, named in the refusal. */
function refusing(namespace: string): Record<string, never> {
  return new Proxy({} as Record<string, never>, {
    get(_target, property) {
      if (namespace === 'runtime' && property === 'id') return RUNTIME_ID as never;
      // Asked by the polyfill's guard and by any `typeof`/truthiness check on the namespace itself.
      if (typeof property === 'symbol') return undefined as never;
      unreachable(`${namespace}.${String(property)}`);
    },
  });
}

const extensionApi = new Proxy({} as Record<string, unknown>, {
  get(_target, property) {
    if (typeof property === 'symbol') return undefined;
    if (installed) return installed[String(property)];
    return refusing(String(property));
  },
});

Object.assign(globalThis, { chrome: extensionApi, browser: extensionApi });
