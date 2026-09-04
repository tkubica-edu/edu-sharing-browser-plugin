import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installBundleTheme, publishPanelTheme } from './bundle-theme';

/** The key the edu-sharing bundle reads its theme preference from. */
const THEME_KEY = 'accessibility_darkMode';

/**
 * The install patches `window.matchMedia` once and for the rest of the module's life — a module-level
 * flag it shares with production, since in the panel it is a correction that must not be applied twice.
 * The spec therefore installs once, and every test works against that one patch.
 */
describe('installBundleTheme', () => {
  beforeEach(() => {
    localStorage.clear();
    installBundleTheme();
    publishPanelTheme(false);
  });

  afterEach(() => {
    publishPanelTheme(false);
  });

  it('sets the preference to follow the query, since the bundle defaults to light', () => {
    // Written as JSON, exactly as the bundle's own storage wrapper writes it.
    expect(localStorage.getItem(THEME_KEY)).toBe('"auto"');
  });

  it('rewrites the preference on a later install, so a cleared profile is filled again', () => {
    localStorage.removeItem(THEME_KEY);

    installBundleTheme();

    expect(localStorage.getItem(THEME_KEY)).toBe('"auto"');
  });

  it('answers a colour-scheme query with the panel theme rather than the browser', () => {
    const dark = window.matchMedia('(prefers-color-scheme: dark)');
    const light = window.matchMedia('(prefers-color-scheme: light)');

    expect(dark.matches).toBe(false);
    expect(light.matches).toBe(true);

    publishPanelTheme(true);

    expect(dark.matches).toBe(true);
    expect(light.matches).toBe(false);
  });

  it('matches the query without spaces too, as a minified stylesheet writes it', () => {
    publishPanelTheme(true);

    expect(window.matchMedia('(prefers-color-scheme:dark)').matches).toBe(true);
  });

  it('leaves every other query alone, so a layout query is not given the theme', () => {
    publishPanelTheme(true);

    // Passed straight through: what answers it is the environment (see color-scheme.setup.ts), which
    // is what keeps a component asking about a width out of this.
    const answer = window.matchMedia('(min-width: 600px)');

    expect(answer.media).toBe('(min-width: 600px)');
    expect(answer.matches).toBe(false);
  });

  it('reports a change to a listener, which is how a running bundle repaints', () => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const heard: boolean[] = [];
    query.addEventListener('change', (event) => heard.push(event.matches));

    publishPanelTheme(true);
    publishPanelTheme(false);

    expect(heard).toEqual([true, false]);
  });

  it('reports nothing where the theme did not actually move', () => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = vi.fn();
    query.addEventListener('change', listener);

    publishPanelTheme(false);

    expect(listener).not.toHaveBeenCalled();
  });

  it('stops reporting to a listener that was removed', () => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = vi.fn();
    query.addEventListener('change', listener);
    query.removeEventListener('change', listener);

    publishPanelTheme(true);

    expect(listener).not.toHaveBeenCalled();
  });

  it('reports to the query handed out before the switch as well as after it', () => {
    const before = window.matchMedia('(prefers-color-scheme: dark)');
    publishPanelTheme(true);
    const after = window.matchMedia('(prefers-color-scheme: dark)');

    expect(before.matches).toBe(true);
    expect(after.matches).toBe(true);
  });

  it('carries on without a preference where the profile has no storage', () => {
    // Stubbed on the prototype and put back by hand: `vi.stubGlobal('localStorage', …)` outlives
    // `unstubAllGlobals` here and would leave every later spec file without storage.
    const denied = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage denied');
    });
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      expect(() => installBundleTheme()).not.toThrow();
      expect(warned).toHaveBeenCalled();
    } finally {
      denied.mockRestore();
      warned.mockRestore();
    }
  });

  it('takes a listener added the old way, which is how an older bundle subscribes', () => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const heard: boolean[] = [];
    query.addListener((event) => heard.push(event.matches));

    publishPanelTheme(true);

    expect(heard).toEqual([true]);
  });

  it('stops reporting to one removed the old way', () => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = vi.fn();
    query.addListener(listener);
    query.removeListener(listener);

    publishPanelTheme(true);

    expect(listener).not.toHaveBeenCalled();
  });

  it('is unbothered by a listener that was never added, or by none at all', () => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');

    expect(() => query.removeListener(vi.fn())).not.toThrow();
    expect(() => query.removeListener(null)).not.toThrow();
    expect(() => query.addListener(null)).not.toThrow();

    publishPanelTheme(true);

    expect(query.matches).toBe(true);
  });

  it('passes an event dispatched on it through to its own listeners', () => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = vi.fn();
    query.addEventListener('change', listener);

    expect(query.dispatchEvent(new Event('change'))).toBe(true);
    expect(listener).toHaveBeenCalled();
  });
});
