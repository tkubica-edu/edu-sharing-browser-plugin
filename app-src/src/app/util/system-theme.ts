/**
 * What the browser says about the reader's own preference — the answer behind the panel's "System folgen".
 *
 * It exists as a module of its own for one reason: the query has to be asked through the *native*
 * `matchMedia`. `util/bundle-theme.ts` replaces that function so the embedded edu-sharing bundle can be
 * handed the panel's theme through the query it reads, and a panel that then asked the replaced function
 * would be reading back its own answer. The reference is taken here, at module load — the app's own
 * modules are evaluated before any bundle script is appended, so what is captured is always the browser's.
 */

/** The browser's `matchMedia`, before anything in this app has a chance to replace it. */
const nativeMatchMedia: typeof window.matchMedia | null =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia.bind(window)
    : null;

/** The media query the reader's preference is stated in. */
const PREFERS_DARK = '(prefers-color-scheme: dark)';

/**
 * The reader's own preference, as the browser reports it right now — and `false` where it reports nothing
 * at all, which is the same answer the browser gives for "no preference". Never throws: this is read on the
 * boot path, and a panel that cannot ask has a theme either way.
 */
export function systemPrefersDark(): boolean {
  try {
    return !!nativeMatchMedia?.(PREFERS_DARK).matches;
  } catch {
    return false;
  }
}

/**
 * Report every later change of that preference, and return the way to stop listening. Nothing is reported
 * where the browser cannot be asked, so the caller keeps whatever it started with.
 */
export function watchSystemTheme(onChange: (dark: boolean) => void): () => void {
  let query: MediaQueryList;
  try {
    if (!nativeMatchMedia) return () => undefined;
    query = nativeMatchMedia(PREFERS_DARK);
  } catch {
    return () => undefined;
  }
  const listener = (event: MediaQueryListEvent) => onChange(event.matches);
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}
