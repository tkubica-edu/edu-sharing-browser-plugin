import { signal } from '@angular/core';

import { DebugService } from '../../app/services/debug.service';

/** `DebugService` as the one flag its dependents read: whether OnlyOffice events are simulated. */
export function fakeDebug() {
  const fake = { enabled: signal(false) } satisfies Partial<DebugService>;
  return { fake };
}

export type DebugFake = ReturnType<typeof fakeDebug>;
