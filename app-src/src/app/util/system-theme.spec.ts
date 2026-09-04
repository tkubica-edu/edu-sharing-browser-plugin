import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  installColorSchemeQuery, resetSystemTheme, setSystemDark,
} from '../../testing/color-scheme.setup';

/**
 * A fresh instance of the module under test.
 *
 * It takes its reference to `matchMedia` at *module load*, on purpose (see the note there), and a worker
 * runs several spec files against one jsdom — so which `matchMedia` an already-imported instance captured
 * depends on which file imported it first. Loading it here instead makes that reference the one this
 * environment has, and it is also the honest way to exercise the capture at all.
 *
 * The colour-scheme query is put back first. `bundle-theme.spec.ts` installs a `matchMedia` of its own
 * that answers with the *panel's* theme, and it holds for the rest of that jsdom — so without this the
 * module captures that one whenever the two files land in the same worker, and every preference this
 * spec states goes unanswered. That is the CI failure this line exists for; it is not hypothetical.
 */
async function loadSystemTheme(): Promise<typeof import('./system-theme')> {
  installColorSchemeQuery();
  vi.resetModules();
  return import('./system-theme');
}

describe('systemPrefersDark', () => {
  beforeEach(resetSystemTheme);
  afterEach(resetSystemTheme);

  it('reports what the browser says about the reader\'s own preference', async () => {
    const { systemPrefersDark } = await loadSystemTheme();

    expect(systemPrefersDark()).toBe(false);
    setSystemDark(true);
    expect(systemPrefersDark()).toBe(true);
  });

  it('asks the browser afresh every time, so a preference changed between reads is seen', async () => {
    const { systemPrefersDark } = await loadSystemTheme();

    setSystemDark(true);
    expect(systemPrefersDark()).toBe(true);
    setSystemDark(false);
    expect(systemPrefersDark()).toBe(false);
  });

  it('asks the browser rather than whatever replaced matchMedia since', async () => {
    // `util/bundle-theme.ts` replaces the function so the embedded bundle reads the panel's theme
    // through it. A panel asking the replacement would be reading back its own answer, which is why
    // the reference is taken at module load.
    const { systemPrefersDark } = await loadSystemTheme();
    const replaced = vi
      .spyOn(window, 'matchMedia')
      .mockImplementation((query: string) => ({ matches: true, media: query }) as MediaQueryList);

    expect(systemPrefersDark()).toBe(false);

    replaced.mockRestore();
  });

  it('answers false where the browser cannot be asked at all', async () => {
    const native = window.matchMedia;
    // Taken away before the load, so the module finds nothing to capture — a panel booting in an
    // environment without the query still has a theme.
    (window as { matchMedia?: unknown }).matchMedia = undefined;
    try {
      const { systemPrefersDark, watchSystemTheme } = await loadSystemTheme();
      expect(systemPrefersDark()).toBe(false);
      expect(() => watchSystemTheme(() => undefined)()).not.toThrow();
    } finally {
      window.matchMedia = native;
    }
  });
});

describe('watchSystemTheme', () => {
  beforeEach(resetSystemTheme);
  afterEach(resetSystemTheme);

  it('reports every later change of the preference', async () => {
    const { watchSystemTheme } = await loadSystemTheme();
    const changes: boolean[] = [];
    const stop = watchSystemTheme((dark) => changes.push(dark));

    setSystemDark(true);
    setSystemDark(false);

    expect(changes).toEqual([true, false]);
    stop();
  });

  it('reports nothing once the caller has stopped listening', async () => {
    const { watchSystemTheme } = await loadSystemTheme();
    const changes: boolean[] = [];
    const stop = watchSystemTheme((dark) => changes.push(dark));

    stop();
    setSystemDark(true);

    expect(changes).toEqual([]);
  });

  it('lets two readers watch the same preference', async () => {
    const { watchSystemTheme } = await loadSystemTheme();
    const first: boolean[] = [];
    const second: boolean[] = [];
    const stopFirst = watchSystemTheme((dark) => first.push(dark));
    const stopSecond = watchSystemTheme((dark) => second.push(dark));

    setSystemDark(true);

    expect(first).toEqual([true]);
    expect(second).toEqual([true]);
    stopFirst();
    stopSecond();
  });
});
