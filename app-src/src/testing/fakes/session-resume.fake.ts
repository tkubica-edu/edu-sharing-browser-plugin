import { vi } from 'vitest';

import { SessionResumeService } from '../../app/services/session-resume.service';

/** `SessionResumeService` as the two calls a page change is bracketed by, both spies. */
export function fakeSessionResume() {
  const fake = {
    save: vi.fn((_url?: string): Promise<void> => Promise.resolve()),
    track: vi.fn(),
  } satisfies Partial<SessionResumeService>;

  return { fake };
}

export type SessionResumeFake = ReturnType<typeof fakeSessionResume>;
