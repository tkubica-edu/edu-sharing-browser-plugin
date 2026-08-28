import { computed, signal } from '@angular/core';
import { DEFAULT } from 'ngx-edu-sharing-api';

import { APP_CONFIG } from '../../app/config';
import { BrowserExtensionCustomWebComponentService } from '../../app/services/browser-extension-custom-web-component.service';

/**
 * `BrowserExtensionCustomWebComponentService` without the repository config behind it. The real one
 * subscribes to `ConfigService`, reads a setting out of the extension storage and toggles a class on
 * `document.documentElement`; a spec sets the two statements directly, which is the only thing its
 * dependents read.
 *
 * `enabled` is the two of them together, as in the real service: `repository` is what the config answered
 * and `setting` whether the settings let it count. A spec that only cares about the outcome passes the one
 * argument and never touches the setting.
 */
export function fakeWebComponent(enabled = false) {
  const repositoryState = signal(enabled);
  const settingState = signal(true);
  const enabledState = computed(() => settingState() && repositoryState());

  const fake = {
    enabled: enabledState,
    settingEnabled: settingState,
    offeredByRepository: repositoryState,
    changedSettings: computed(() => (settingState() ? 0 : 1)),
    metadataSet: computed(() => (enabledState() ? APP_CONFIG.metadataSet : DEFAULT)),
    load: async () => {},
    setEnabled: async (value: boolean) => {
      settingState.set(value);
    },
  } satisfies Partial<BrowserExtensionCustomWebComponentService>;

  return { fake };
}

export type WebComponentFake = ReturnType<typeof fakeWebComponent>;
