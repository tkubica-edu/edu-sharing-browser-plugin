/**
 * A `prefers-color-scheme` query a test can answer.
 *
 * jsdom implements `matchMedia` but not this feature, so its answer is a fixed `matches: false` and
 * its `change` event never fires — which leaves the panel's "System folgen" untestable. This replaces
 * the function with one whose answer is {@link setSystemDark}'s, and which reports a change like the
 * browser would.
 *
 * A setup file rather than an import in the spec, because of *when* it has to run: `util/system-theme.ts`
 * takes its reference to `matchMedia` at module load, on purpose (see the note there), so a stub
 * installed by the spec's own body would arrive too late. Setup files run before the test module is
 * imported at all.
 *
 * Every other media query is passed to jsdom's own implementation, so a spec that asks about a width
 * gets what it would have got.
 */

/** What the query answers with. */
let systemDark = false;

/** The listeners handed out for a colour-scheme query, so a change can reach all of them. */
const listeners = new Set<EventListenerOrEventListenerObject>();

/** Which scheme a query asks about; one naming neither is answered as `light`. */
const ASKS_FOR_DARK = /dark/i;

/** State what the "system" reports, and tell whoever is listening. */
export function setSystemDark(dark: boolean): void {
  if (dark === systemDark) return;
  systemDark = dark;
  for (const listener of listeners) {
    const event = Object.assign(new Event('change'), { matches: systemDark });
    if (typeof listener === 'function') listener(event);
    else listener.handleEvent(event);
  }
}

/** Back to reporting light, with nothing listening — for a spec's `beforeEach`. */
export function resetSystemTheme(): void {
  systemDark = false;
  listeners.clear();
}

/** jsdom's own implementation, where the environment has one — this one defines no `matchMedia`. */
const jsdomMatchMedia =
  typeof window.matchMedia === 'function' ? window.matchMedia.bind(window) : null;

/**
 * A query this file does not answer, where there is no implementation to pass it to: it matches
 * nothing and reports nothing, which is what an unsupported feature does in a browser too. It carries
 * the query, so a spec can still see that its question went past the colour scheme.
 */
function unanswered(query: string): MediaQueryList {
  return {
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => true,
    addListener: () => undefined,
    removeListener: () => undefined
  } as MediaQueryList;
}

window.matchMedia = ((query: string): MediaQueryList => {
  if (!/prefers-color-scheme/i.test(query)) {
    return jsdomMatchMedia ? jsdomMatchMedia(query) : unanswered(query);
  }
  const asksForDark = ASKS_FOR_DARK.test(query);
  return {
    get matches() {
      return asksForDark ? systemDark : !systemDark;
    },
    media: query,
    onchange: null,
    addEventListener: (_type: string, listener: EventListenerOrEventListenerObject | null) => {
      if (listener) listeners.add(listener);
    },
    removeEventListener: (_type: string, listener: EventListenerOrEventListenerObject | null) => {
      if (listener) listeners.delete(listener);
    },
    dispatchEvent: () => true,
    addListener: () => undefined,
    removeListener: () => undefined
  } as MediaQueryList;
}) as typeof window.matchMedia;
