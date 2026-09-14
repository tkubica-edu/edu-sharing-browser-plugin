import { computed, signal } from '@angular/core';
import { vi } from 'vitest';
import { DEFAULT } from 'ngx-edu-sharing-api';

import { APP_CONFIG } from '../../app/config';
import { BrowserExtensionCustomWebComponentService } from '../../app/services/browser-extension-custom-web-component.service';

/**
 * `BrowserExtensionCustomWebComponentService` without the repository config behind it. The real one
 * subscribes to `ConfigService`, reads a setting out of the extension storage and toggles a class on
 * `document.documentElement`; a spec sets the statements directly, which is the only thing its
 * dependents read.
 *
 * `enabled` is all of them together, as in the real service: `repository` is what the config answered,
 * `setting` whether the settings let it count, and `blacklisted` whether `APP_CONFIG.featureBlacklist`
 * names `wlo` (a knob, not a derivation — see {@link blacklist}). A spec that only cares about the outcome
 * passes the one argument and never touches the setting or the blacklist.
 */
export function fakeWebComponent(enabled = false) {
  const repositoryState = signal(enabled);
  const settingState = signal(true);
  const blacklistedState = signal(false);
  const enabledState = computed(() => !blacklistedState() && settingState() && repositoryState());

  const fake = {
    enabled: enabledState,
    settingEnabled: settingState,
    offeredByRepository: repositoryState,
    blacklisted: blacklistedState,
    changedSettings: computed(() => (blacklistedState() || settingState() ? 0 : 1)),
    metadataSet: computed(() => (enabledState() ? APP_CONFIG.metadataSet : DEFAULT)),
    load: async () => {},
    refresh: vi.fn(),
    setEnabled: async (value: boolean) => {
      settingState.set(value);
    },
  } satisfies Partial<BrowserExtensionCustomWebComponentService>;

  /** The deployment turned `wlo` off outright — see `FeatureKey`. */
  function blacklist(): void {
    blacklistedState.set(true);
  }

  return { fake, blacklist };
}

export type WebComponentFake = ReturnType<typeof fakeWebComponent>;
