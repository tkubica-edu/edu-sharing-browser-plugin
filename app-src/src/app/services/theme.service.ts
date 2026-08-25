import { Injectable, computed, effect, inject, signal } from '@angular/core';

import { APP_CONFIG } from '../config';
import { installBundleTheme, publishPanelTheme } from '../util/bundle-theme';
import { systemPrefersDark, watchSystemTheme } from '../util/system-theme';
import { BrowserExtensionService } from './browser-extension.service';

/** What the panel can be told about its own colours. */
export type ThemeSetting = 'system' | 'light' | 'dark';

/**
 * Follows the reader's own preference unless it was overruled: a panel docked beside a page is read next to
 * a browser that already answers this question, and a light strip beside a dark page is the odd one out
 * rather than the neutral choice.
 */
const DEFAULT_SETTING: ThemeSetting = 'system';

/**
 * The attribute the resolved theme is stamped on the document element as, and read back by
 * `styles/_tokens.scss`. The setting has three states and the stylesheet has two, which is deliberate:
 * resolving "follow the system" here means no stylesheet asks the media query and no component knows which
 * of the two it is being rendered in.
 */
const THEME_ATTRIBUTE = 'data-theme';

/**
 * Where the resolved theme is mirrored for the one reader that cannot wait for this service: the snippet in
 * `index.html` that stamps the attribute before the first paint. Local storage because that read has to be
 * synchronous — extension storage, which is the setting's actual home, is not.
 */
const MIRROR_KEY = 'eduSharingResolvedTheme';

/**
 * The panel's colours: which theme is up, and who is told about it.
 *
 * It is the one place the three-state setting becomes a yes or no, and it hands that answer to everything
 * that paints:
 *
 * - the panel's own styles, through `data-theme` on the document element (see `styles/_tokens.scss`);
 * - `color-scheme`, so the scrollbars and the widgets of native form controls follow rather than staying
 *   light in a dark panel;
 * - the embedded edu-sharing bundle, through the media query it resolves its own theme from (see
 *   `util/bundle-theme.ts`) — which is why the answer is published even before that bundle is loaded;
 * - the assistant's chat widget, which reads it as an attribute of its element (see
 *   AiAssistantScreenComponent).
 *
 * The WLO metadata canvas is the one embedded element that is *not* told: its bundle ships no dark theme at
 * all, and the two screens it takes over therefore stay light — see `styles/_wlo-canvas-light.scss`.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly browserExtension = inject(BrowserExtensionService);

  private readonly settingState = signal<ThemeSetting>(DEFAULT_SETTING);

  /** What the panel was told about its colours. Persisted, so it survives a reload. */
  readonly setting = this.settingState.asReadonly();

  /** The reader's own preference, kept up to date for as long as the panel runs. */
  private readonly systemDark = signal(systemPrefersDark());

  /** Which of the two themes is actually up — the setting, with "follow the system" answered. */
  readonly dark = computed(() =>
    this.settingState() === 'system' ? this.systemDark() : this.settingState() === 'dark',
  );

  constructor() {
    // The bundle's handover is installed here rather than where the bundle is loaded, so the answer to the
    // media query exists before anything can ask it. It replaces `window.matchMedia`, which is why the
    // watch above went through the reference `util/system-theme.ts` took at module load.
    installBundleTheme();
    watchSystemTheme((dark) => this.systemDark.set(dark));
    effect(() => this.apply(this.dark()));
  }

  /**
   * Load the persisted setting. First of the boot's steps: everything after it renders, and a screen that
   * appears light and turns dark a moment later is the one thing this setting cannot afford.
   */
  async load(): Promise<void> {
    const stored = await this.browserExtension.storageGet<string>(
      APP_CONFIG.storageKeys.theme,
      DEFAULT_SETTING,
    );
    this.settingState.set(toSetting(stored));
  }

  /** Take the reader's choice over, and remember it. */
  async setSetting(setting: ThemeSetting): Promise<void> {
    this.settingState.set(setting);
    await this.browserExtension.storageSet(APP_CONFIG.storageKeys.theme, setting);
  }

  /**
   * Switch to the other of the two themes — what the topbar's button does.
   *
   * It resolves against what is on screen, not against the setting: from "follow the system" it goes to the
   * opposite of what the system just gave, so the button always changes the panel the reader is looking at.
   * That leaves an explicit setting behind, and "follow the system" is reachable again through the
   * Einstellungen — a one-press control cannot offer three states, and the third is the one nobody needs in
   * the middle of a step.
   */
  async toggle(): Promise<void> {
    await this.setSetting(this.dark() ? 'light' : 'dark');
  }

  /** Stamp the resolved theme where everything that paints reads it. */
  private apply(dark: boolean): void {
    const theme = dark ? 'dark' : 'light';
    const root = document.documentElement;
    root.setAttribute(THEME_ATTRIBUTE, theme);
    try {
      localStorage.setItem(MIRROR_KEY, theme);
    } catch {
      // Without the mirror the panel only flashes its old theme for the length of one boot.
    }
    publishPanelTheme(dark);
  }
}

/** One of the three states; the default for anything else, including a value from an older build. */
function toSetting(value: unknown): ThemeSetting {
  return value === 'light' || value === 'dark' || value === 'system' ? value : DEFAULT_SETTING;
}
