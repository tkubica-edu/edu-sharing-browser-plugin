import { signal } from '@angular/core';

import { DevModeService } from '../../app/services/dev-mode.service';

/** `DevModeService` as the switch its dependents branch on: whether the KI answers are faked. */
export function fakeDevMode() {
  const fake = { enabled: signal(false) } satisfies Partial<DevModeService>;
  return { fake };
}

export type DevModeFake = ReturnType<typeof fakeDevMode>;
