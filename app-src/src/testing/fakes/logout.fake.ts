import { Subject } from 'rxjs';
import { vi } from 'vitest';

import { LogoutOutcome, LogoutService } from '../../app/services/logout.service';

/** An outcome for the ordinary repository: it publishes no policy, so the session is simply ended. */
export function aLogoutOutcome(overrides: Partial<LogoutOutcome> = {}): LogoutOutcome {
  return { sessionDestroyed: true, url: null, call: 'none', next: null, ...overrides };
}

/**
 * `LogoutService`, so a spec about the *session* does not have to state a repository's logout
 * policy as well. What it answers is what AuthService reads: whether the session was ended through
 * the API, and where the repository wants the user taken afterwards.
 */
export function fakeLogout(outcome: LogoutOutcome = aLogoutOutcome()) {
  const started = new Subject<never>();

  const fake = {
    started: started.asObservable(),
    run: vi.fn((_repositoryUrl: string): Promise<LogoutOutcome> => Promise.resolve(outcome)),
    openNext: vi.fn((_next: string, _repositoryUrl: string): Promise<void> => Promise.resolve()),
  } as unknown as LogoutService;

  /** The policy ends this way from now on. */
  function ends(next: LogoutOutcome): void {
    (fake.run as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(next);
  }

  return { fake, ends };
}

export type LogoutFake = ReturnType<typeof fakeLogout>;
