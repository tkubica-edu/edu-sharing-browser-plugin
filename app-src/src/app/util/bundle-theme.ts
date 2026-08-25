/**
 * The theme the embedded edu-sharing forms are rendered in. Like the language (see
 * `installBundleLanguage`), the bundle decides it itself — and it has to be told, because a light form in
 * a dark panel is the one part of the panel that does not follow the setting.
 *
 * **How the bundle decides.** Its theme service resolves
 * `isDark = (query param ?? the stored setting) === 'dark' || (that setting is 'auto' && the browser
 * prefers dark)`, and from that it puts `isDarkTheme` / `isLightTheme` on `<body>`, recomputes its whole
 * Material palette and pulls in its dark token set. Two facts about it shape what happens below:
 *
 * - the stored setting comes out of local storage under its own key, and it is read **once** as the
 *   service subscribes — the notification the service listens on is internal to the bundle, so a value
 *   written from outside is only ever seen at bootstrap;
 * - the browser's preference, by contrast, is read as a live media query, and the service re-resolves the
 *   theme on every `change` of it.
 *
 * So the setting is written as **`auto`** — which is what makes the bundle ask the media query at all,
 * since its own default is `light` — and the media query is the answered one. That way the theme is not
 * merely right at boot, it follows a switch the reader makes while a form is open.
 */

/** Log prefix for what is forced here, as everywhere else in the extension. */
const LOG_THEME = '[edu-sharing][bundle]';

/**
 * The preference the bundle reads the theme from, under the prefix its accessibility settings share
 * (`AccessibilityService.STORAGE_PREFIX`). Stored as JSON, exactly as the bundle stores it itself.
 */
const THEME_KEY = 'accessibility_darkMode';

/** The one value that leaves the decision to the media query below, rather than fixing it. */
const FOLLOW_QUERY = 'auto';

/** The query the answer is given through. Matched loosely, so `(prefers-color-scheme:dark)` counts too. */
const COLOR_SCHEME_QUERY = /prefers-color-scheme/i;

/** Which scheme such a query asks about; a query naming neither is answered as `light`. */
const ASKS_FOR_DARK = /dark/i;

/** Whether `matchMedia` is already replaced — the install is idempotent, the patch must be applied once. */
let patched = false;

/** The panel's theme, as it was last published. What every answered query reports. */
let panelPrefersDark = false;

/** The lists handed out for a colour-scheme query, so a change can be reported to all of them. */
const answered = new Set<AnsweredQuery>();

/**
 * A `MediaQueryList` for a colour-scheme query whose answer is the panel's theme rather than the browser's.
 * Only the parts a listener needs are its own; everything else is the interface's.
 */
interface AnsweredQuery extends MediaQueryList {
  /** Tell whoever is listening that {@link panelPrefersDark} moved. */
  publish(): void;
}

/**
 * Hand the panel's theme to the edu-sharing bundle, for the rest of the document's life: its stored
 * preference is set to follow the media query, and the media query is answered with
 * {@link publishPanelTheme}'s last word. Runs before the bundle's scripts do — the preference is read at
 * its bootstrap. Idempotent, and every query that is not about the colour scheme is left to the browser.
 */
export function installBundleTheme(): void {
  try {
    localStorage.setItem(THEME_KEY, JSON.stringify(FOLLOW_QUERY));
  } catch {
    // No local storage, no handover — the bundle then renders in its own default, which is light.
    console.warn(`${LOG_THEME} theme preference could not be stored; the forms stay light`);
  }

  // Nothing to patch, and nothing that could ask: without `matchMedia` the bundle resolves its theme
  // from the preference alone, which is what the `auto` above then leaves at light.
  if (patched || typeof window.matchMedia !== 'function') return;
  patched = true;

  const native = window.matchMedia.bind(window);
  window.matchMedia = ((query: string): MediaQueryList => {
    if (!COLOR_SCHEME_QUERY.test(query)) return native(query);
    const list = answeredQuery(query);
    answered.add(list);
    return list;
  }) as typeof window.matchMedia;

  console.info(`${LOG_THEME} colour-scheme queries now answer with the panel's theme`);
}

/**
 * State the panel's theme. Reported to every colour-scheme query handed out since the install, which is how
 * a switch reaches an already-running bundle; before the install it is only remembered, so a bundle loading
 * later starts on the theme that is up.
 */
export function publishPanelTheme(dark: boolean): void {
  if (dark === panelPrefersDark) return;
  panelPrefersDark = dark;
  for (const list of answered) list.publish();
}

/**
 * A colour-scheme query whose `matches` is the panel's theme. `media` is the query as it was asked, and the
 * listeners are held on an `EventTarget` of the query's own — nothing here goes to the browser, because there
 * is nothing left to ask it: what the caller wants to know is the panel's answer.
 */
function answeredQuery(query: string): AnsweredQuery {
  const asksForDark = ASKS_FOR_DARK.test(query);
  const matches = () => (asksForDark ? panelPrefersDark : !panelPrefersDark);
  const target = new EventTarget();
  // The deprecated `addListener`/`removeListener` pair is part of the interface, so it is routed to the
  // same target — which needs the wrapper each raw listener was added under to be removable again.
  const wrappers = new Map<(event: MediaQueryListEvent) => void, EventListener>();

  return {
    get matches() {
      return matches();
    },
    media: query,
    // The legacy property, kept because it is the interface's; the bundle uses `addEventListener`.
    onchange: null,
    addEventListener: (
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions,
    ) => target.addEventListener(type, listener, options),
    removeEventListener: (
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | EventListenerOptions,
    ) => target.removeEventListener(type, listener, options),
    dispatchEvent: (event: Event) => target.dispatchEvent(event),
    addListener(listener: ((event: MediaQueryListEvent) => void) | null) {
      if (!listener) return;
      const wrapped = ((event: Event) => listener(event as MediaQueryListEvent)) as EventListener;
      wrappers.set(listener, wrapped);
      target.addEventListener('change', wrapped);
    },
    removeListener(listener: ((event: MediaQueryListEvent) => void) | null) {
      const wrapped = listener && wrappers.get(listener);
      if (!listener || !wrapped) return;
      wrappers.delete(listener);
      target.removeEventListener('change', wrapped);
    },
    publish() {
      // A plain `Event` carrying the two fields a listener reads off it: `MediaQueryListEvent` is not
      // constructible in every engine, and what reads this only ever asks for `matches`.
      const event = Object.assign(new Event('change'), { matches: matches(), media: query });
      this.onchange?.call(this, event as MediaQueryListEvent);
      target.dispatchEvent(event);
    }
  } as AnsweredQuery;
}
