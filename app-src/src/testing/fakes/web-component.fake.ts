import { computed, signal } from '@angular/core';
import { DEFAULT } from 'ngx-edu-sharing-api';

import { APP_CONFIG } from '../../app/config';
import { BrowserExtensionCustomWebComponentService } from '../../app/services/browser-extension-custom-web-component.service';

/**
 * `BrowserExtensionCustomWebComponentService` without the repository config behind it. The real one
 * subscribes to `ConfigService` and toggles a class on `document.documentElement`; a spec sets the flag
 * directly, which is the only thing its dependents read.
 */
export function fakeWebComponent(enabled = false) {
  const enabledState = signal(enabled);

  const fake = {
    enabled: enabledState,
    metadataSet: computed(() => (enabledState() ? APP_CONFIG.metadataSet : DEFAULT)),
  } satisfies Partial<BrowserExtensionCustomWebComponentService>;

  return { fake };
}

export type WebComponentFake = ReturnType<typeof fakeWebComponent>;
