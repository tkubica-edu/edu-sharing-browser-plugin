/**
 * The language the embedded edu-sharing forms are rendered in. The bundle picks it itself: the logged-in user's
 * repository profile first, the browser's language after that — so an English profile or an English browser turns
 * the metadata form, and with it the labels the repository sends for the metadata set, English. The panel around
 * it is German only, so the language the bundle reads is answered as German on both of those paths.
 */

/** Log prefix for what is forced here, as everywhere else in the extension. */
const LOG_LANGUAGE = '[edu-sharing][bundle]';

/** The one language the embedded forms are ever rendered in; one of the bundle's supported languages. */
const LANGUAGE = 'de';

/** The preference the bundle reads the language from — in the user profile and in local storage alike. */
const LANGUAGE_KEY = 'language';

/**
 * The user's preferences as the repository answers them: a JSON document of its own, inside the
 * `preferences` field of the reply.
 */
const PREFERENCES_PATH = /\/iam\/[^/]+\/people\/[^/]+\/[^/]+\/preferences$/;

/** Whether the prototype is already patched — the install is idempotent, the patch must be applied once. */
let patched = false;

/**
 * Make the bundle render in German, for the rest of the document's life: its preferences are answered with the
 * language set, and local storage — the fallback it reads for a user whose preferences it cannot get at all —
 * carries it too. Idempotent, and a no-op for every request that is not about the preferences.
 */
export function installBundleLanguage(): void {
  // What the bundle falls back to when it has no user preferences to read (a guest session): the key is
  // its own, stored as JSON exactly as it stores it itself.
  localStorage.setItem(LANGUAGE_KEY, JSON.stringify(LANGUAGE));

  if (patched) return;
  patched = true;

  const nativeOpen = XMLHttpRequest.prototype.open;
  const descriptors = {
    response: Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'response'),
    responseText: Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'responseText')
  };

  XMLHttpRequest.prototype.open = function (
    this: XMLHttpRequest,
    ...args: [string, string | URL, ...unknown[]]
  ): void {
    if (isPreferencesUrl(String(args[1] ?? ''))) {
      console.info(`${LOG_LANGUAGE} preferences answered with language "${LANGUAGE}"`);
      // Shadowing accessors rather than a finished reply: the value is rewritten whenever it is read, so it
      // does not matter that the caller registered its load listener before this instance was touched.
      for (const [property, descriptor] of Object.entries(descriptors)) {
        const native = descriptor?.get;
        if (!native) continue;
        Object.defineProperty(this, property, {
          configurable: true,
          get: () => withLanguage(native.call(this))
        });
      }
    }
    (nativeOpen as (...a: unknown[]) => void).apply(this, args);
  } as typeof XMLHttpRequest.prototype.open;
}

/** Whether this URL asks for a user's preferences. Matched on the path, so a query string cannot fool it. */
function isPreferencesUrl(url: string): boolean {
  let path: string;
  try {
    path = new URL(url, document.baseURI).pathname;
  } catch {
    path = url;
  }
  return PREFERENCES_PATH.test(path);
}

/**
 * The preferences reply with the language set, in the shape it was read in: parsed for a request that asked
 * for JSON, raw text for every other one. Anything that does not look like the reply is passed through.
 */
function withLanguage(body: unknown): unknown {
  if (typeof body === 'string') {
    try {
      return JSON.stringify(withLanguage(JSON.parse(body)));
    } catch {
      return body;
    }
  }
  if (!body || typeof body !== 'object') return body;
  const envelope = body as { preferences?: unknown };
  if (typeof envelope.preferences !== 'string') return body;
  let preferences: unknown;
  try {
    preferences = JSON.parse(envelope.preferences);
  } catch {
    preferences = null;
  }
  const values = preferences && typeof preferences === 'object' ? preferences : {};
  return { ...envelope, preferences: JSON.stringify({ ...values, [LANGUAGE_KEY]: LANGUAGE }) };
}
