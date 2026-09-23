/**
 * The theme the embedded edu-sharing forms are rendered in. Like the language (see
 * `installBundleLanguage`), the bundle decides it itself — and it has to be told, because a light form in
 * a dark panel is the one part of the panel that does not follow the setting.
 *
 * **How the bundle decides.** Web-component embedding counts to its theme service as an "external
 * context" — nothing there is isolated behind a shadow root, so a dark theme it picked on its own would
 * colour the host page along with itself. In that context it ignores the reader's stored preference
 * outright and forces light, *unless* its own document's URL carries a `theme` query parameter: read once
 * at its own bootstrap and again on every navigation its own router processes, `dark`/`light` there decide
 * everything, while `auto` is the one value that still asks further — it falls through to
 * `(prefers-color-scheme: dark)`, exactly as if no external context applied at all. Two facts about that
 * media query shape what happens below:
 *
 * - it is read as a live query, and the theme service re-resolves on every `change` of it;
 * - `prefers-color-scheme` is the *only* thing an external context still lets the reader's own choice
 *   reach, since the URL parameter itself is set once and not rewritten on every switch.
 *
 * So the parameter is written as **`auto`**, once, before the bundle's scripts run — and the media query
 * is the one answered below, with the panel's own theme rather than the browser's. That way the theme is
 * not merely right at boot, it follows a switch the reader makes while a form is open.
 */

/** Log prefix for what is forced here, as everywhere else in the extension. */
const LOG_THEME = '[edu-sharing][bundle]';

/** The query parameter the bundle's theme service reads from its own document's URL. */
const THEME_PARAM = 'theme';

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
 * Hand the panel's theme to the edu-sharing bundle, for the rest of the document's life: the bundle's own
 * URL is given `theme=auto`, and the media query that answer defers to is answered with
 * {@link publishPanelTheme}'s last word. Runs before the bundle's scripts do — the parameter is read at
 * its bootstrap. Idempotent, and every query that is not about the colour scheme is left to the browser.
 */
export function installBundleTheme(): void {
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.get(THEME_PARAM) !== FOLLOW_QUERY) {
      url.searchParams.set(THEME_PARAM, FOLLOW_QUERY);
      history.replaceState(history.state, '', url.toString());
    }
  } catch {
    // No history API, no handover — the bundle then renders in its own default, which is light.
    console.warn(`${LOG_THEME} theme parameter could not be written; the forms stay light`);
  }

  // Nothing to patch, and nothing that could ask: without `matchMedia` the bundle resolves its theme
  // from the parameter alone, which is what the `auto` above then leaves at light.
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
