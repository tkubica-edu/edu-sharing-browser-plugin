import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { APP_CONFIG } from '../config';
import { BrowserExtensionService } from './browser-extension.service';
import { ThemeService } from './theme.service';
import { BrowserExtensionFake, fakeBrowserExtension } from '../../testing/fakes';
import { provideFake } from '../../testing/provide-fake';
import { resetSystemTheme, setSystemDark } from '../../testing/color-scheme.setup';

describe('ThemeService', () => {
  let theme: ThemeService;
  let extension: BrowserExtensionFake;

  /** The attribute the panel's stylesheet reads the theme back from. */
  const stamped = () => document.documentElement.getAttribute('data-theme');

  beforeEach(() => {
    resetSystemTheme();
    document.documentElement.removeAttribute('data-theme');
    localStorage.clear();
    extension = fakeBrowserExtension();
    TestBed.configureTestingModule({
      providers: [provideFake(BrowserExtensionService, extension.fake)],
    });
    theme = TestBed.inject(ThemeService);
    // The stamping is an effect, and a zoneless app only runs one when change detection does.
    TestBed.tick();
  });

  it('follows the system until it is told otherwise', () => {
    expect(theme.setting()).toBe('system');
    expect(theme.dark()).toBe(false);
  });

  describe('resolving the setting', () => {
    it('answers "system" with what the browser reports', async () => {
      setSystemDark(true);
      expect(theme.dark()).toBe(true);

      setSystemDark(false);
      expect(theme.dark()).toBe(false);
    });

    it('lets an explicit choice overrule the browser, either way', async () => {
      setSystemDark(true);
      await theme.setSetting('light');
      expect(theme.dark()).toBe(false);

      setSystemDark(false);
      await theme.setSetting('dark');
      expect(theme.dark()).toBe(true);
    });

    it('picks the browser up again when the choice is dropped', async () => {
      setSystemDark(true);
      await theme.setSetting('light');
      expect(theme.dark()).toBe(false);

      await theme.setSetting('system');
      expect(theme.dark()).toBe(true);
    });
  });

  describe('toggle', () => {
    it('swaps the two themes, and leaves a setting behind that says which', async () => {
      await theme.setSetting('light');

      await theme.toggle();

      expect(theme.setting()).toBe('dark');
      expect(theme.dark()).toBe(true);

      await theme.toggle();

      expect(theme.setting()).toBe('light');
      expect(theme.dark()).toBe(false);
    });

    it('turns "system" into the opposite of what the browser just gave', async () => {
      setSystemDark(true);

      await theme.toggle();

      expect(theme.setting()).toBe('light');
      expect(theme.dark()).toBe(false);
    });

    it('persists what it switched to', async () => {
      await theme.toggle();

      expect(extension.storage.get(APP_CONFIG.storageKeys.theme)).toBe('dark');
    });
  });

  describe('load', () => {
    it('takes over the persisted setting', async () => {
      extension.storage.set(APP_CONFIG.storageKeys.theme, 'dark');

      await theme.load();

      expect(theme.setting()).toBe('dark');
      expect(theme.dark()).toBe(true);
    });

    it('falls back to following the system for anything that is not one of the three', async () => {
      for (const stored of ['sepia', '', null, 7]) {
        extension.storage.set(APP_CONFIG.storageKeys.theme, stored);

        await theme.load();

        expect(theme.setting()).toBe('system');
      }
    });
  });

  describe('what the resolved theme is stamped on', () => {
    it('stamps the document element, so the stylesheet has a theme to read', async () => {
      expect(stamped()).toBe('light');

      await theme.setSetting('dark');
      TestBed.tick();

      expect(stamped()).toBe('dark');
    });

    it('follows a change of the browser preference, not only of the setting', () => {
      setSystemDark(true);
      TestBed.tick();

      expect(stamped()).toBe('dark');
    });

    it('mirrors it into local storage, which is what the pre-boot snippet reads', async () => {
      await theme.setSetting('dark');
      TestBed.tick();

      expect(localStorage.getItem('eduSharingResolvedTheme')).toBe('dark');
    });
  });

  describe('persistence', () => {
    it('writes the choice through to its own key', async () => {
      await theme.setSetting('dark');

      expect(extension.storage.get(APP_CONFIG.storageKeys.theme)).toBe('dark');
    });
  });
});
