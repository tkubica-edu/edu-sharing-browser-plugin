import { computed, signal } from '@angular/core';
import { vi } from 'vitest';

import { ThemeService, ThemeSetting } from '../../app/services/theme.service';

/**
 * `ThemeService` without a `matchMedia` behind it: the setting, and whether the panel is dark under it.
 * The real one follows the browser where the setting says `system` and writes a class on
 * `document.documentElement` for it; a spec states the two, which is all anything reads.
 */
export function fakeTheme(setting: ThemeSetting = 'system') {
  const settingState = signal(setting);
  /** What the browser asks for while the setting follows it. */
  const systemDark = signal(false);

  const fake = {
    setting: settingState,
    dark: computed(() =>
      settingState() === 'system' ? systemDark() : settingState() === 'dark',
    ),
    setSetting: vi.fn((next: ThemeSetting): Promise<void> => {
      settingState.set(next);
      return Promise.resolve();
    }),
    toggle: vi.fn((): Promise<void> => Promise.resolve()),
  } satisfies Partial<ThemeService>;

  /** The browser is set to dark, which the panel follows while the setting says `system`. */
  function systemPrefersDark(): void {
    systemDark.set(true);
  }

  return { fake, systemPrefersDark };
}

export type ThemeFake = ReturnType<typeof fakeTheme>;
