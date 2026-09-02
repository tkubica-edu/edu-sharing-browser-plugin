import { TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { AuthenticationService, ConfigService, RestConstants, UserService } from 'ngx-edu-sharing-api';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';

import { BrowserExtensionService } from './browser-extension.service';
import { LogoutService } from './logout.service';
import { provideFake } from '../../testing/provide-fake';
import {
  AuthenticationFake,
  BrowserExtensionFake,
  ConfigFake,
  UserApiFake,
  fakeAuthentication,
  fakeBrowserExtension,
  aLoginInfo,
  fakeConfig,
  fakeUserApi,
} from '../../testing/fakes';

/** The repository the panel runs against, as AuthService hands it to every call here. */
const REPOSITORY = 'https://repo.example/edu-sharing';

/**
 * Let the pending microtasks run. The logout asks the repository two questions before it issues the
 * request the `ajax` branch is about, so there is nothing for `expectOne` to find until they resolve.
 */
async function settled(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

describe('LogoutService', () => {
  let logout: LogoutService;
  let authentication: AuthenticationFake;
  let config: ConfigFake;
  let userApi: UserApiFake;
  let extension: BrowserExtensionFake;
  let http: HttpTestingController;

  beforeEach(() => {
    authentication = fakeAuthentication();
    config = fakeConfig();
    userApi = fakeUserApi();
    extension = fakeBrowserExtension();
    TestBed.configureTestingModule({
      providers: [
        provideFake(AuthenticationService, authentication.fake),
        provideFake(ConfigService, config.fake),
        provideFake(UserService, userApi.fake),
        provideFake(BrowserExtensionService, extension.fake),
      ],
    });
    logout = TestBed.inject(LogoutService);
    http = TestBed.inject(HttpTestingController);
  });

  describe('a repository that publishes no logout policy', () => {
    it('ends the session and nothing else', async () => {
      const outcome = await logout.run(REPOSITORY);

      expect(authentication.fake.logout).toHaveBeenCalled();
      expect(outcome).toEqual({ sessionDestroyed: true, url: null, call: 'none', next: null });
      expect(extension.fake.openWindow).not.toHaveBeenCalled();
    });

    it('reports a session it could not end', async () => {
      authentication.failsLogout(new Error('502 Bad Gateway'));

      const outcome = await logout.run(REPOSITORY);

      expect(outcome.sessionDestroyed).toBe(false);
    });

    it('does the same where the repository does not answer about its config at all', async () => {
      config.fails(new Error('offline'));

      const outcome = await logout.run(REPOSITORY);

      expect(authentication.fake.logout).toHaveBeenCalled();
      expect(outcome.call).toBe('none');
    });
  });

  describe('a policy that names a logout address', () => {
    it('opens it in a window of its own and ends the session as well', async () => {
      config.answersLogout({ url: 'https://repo.example/logout', destroySession: true });

      const outcome = await logout.run(REPOSITORY);

      expect(authentication.fake.logout).toHaveBeenCalled();
      // Not the panel's own tab: the panel does not survive it being navigated, and the page the
      // user is working on is not the logout's to take away. A window, like the sign-in pages, and
      // left standing for the user to close.
      expect(extension.fake.openWindow).toHaveBeenCalledWith('https://repo.example/logout');
      expect(outcome).toMatchObject({ sessionDestroyed: true, call: 'window' });
    });

    it('ends the session even where the policy leaves that to the address', async () => {
      config.answersLogout({ url: 'https://repo.example/logout' });

      const outcome = await logout.run(REPOSITORY);

      // The panel cannot follow the window it opened, and a session cookie that survives is taken
      // straight back up on the next boot — so `destroySession` does not get to decide this.
      expect(authentication.fake.logout).toHaveBeenCalled();
      expect(outcome.sessionDestroyed).toBe(true);
    });

    it('opens the address before it ends the session, so the address is carried by that session', async () => {
      config.answersLogout({ url: 'https://idp.example/Logout' });
      const order: string[] = [];
      extension.fake.openWindow.mockImplementation(async () => void order.push('window'));
      authentication.fake.logout.mockImplementation(() => {
        order.push('logout');
        return of(aLoginInfo({ isValidLogin: false, isGuest: true }));
      });

      await logout.run(REPOSITORY);

      // A single logout at the identity provider identifies the session by the cookies it comes with.
      expect(order).toEqual(['window', 'logout']);
    });

    it('resolves an address the repository publishes as a path', async () => {
      config.answersLogout({ url: '/shibboleth/Logout' });

      await logout.run(REPOSITORY);

      // Resolved against the repository the way the browser would, so a path is absolute against
      // the repository's own host — the panel's own origin is the extension's.
      expect(extension.fake.openWindow).toHaveBeenCalledWith('https://repo.example/shibboleth/Logout');
    });
  });

  describe('which of the three addresses applies', () => {
    beforeEach(() => {
      config.answersLogout({
        url: 'https://repo.example/logout',
        localUrl: 'https://repo.example/local-logout',
        ssoUrl: 'https://idp.example/Logout',
      });
    });

    it('takes the SSO address for a user known through Shibboleth', async () => {
      userApi.isAuthenticatedBy(RestConstants.SSO_TYPE_Shibboleth);

      const outcome = await logout.run(REPOSITORY);

      // Only that address ends the session the user also holds at the identity provider.
      expect(outcome.url).toBe('https://idp.example/Logout');
    });

    it('takes the local address for a user the repository holds itself', async () => {
      userApi.isAuthenticatedBy(null);

      const outcome = await logout.run(REPOSITORY);

      expect(outcome.url).toBe('https://repo.example/local-logout');
    });

    it('falls back to the general one where the person cannot be asked', async () => {
      userApi.fails(new Error('offline'));
      config.answersLogout({ url: 'https://repo.example/logout' });

      const outcome = await logout.run(REPOSITORY);

      expect(outcome.url).toBe('https://repo.example/logout');
    });
  });

  describe('a policy that asks for the address to be called in the background', () => {
    it('fetches it without leaving the panel', async () => {
      config.answersLogout({ url: 'https://repo.example/logout', ajax: true });

      const running = logout.run(REPOSITORY);
      await settled();
      const request = http.expectOne('https://repo.example/logout');
      // The session cookie is what makes the call about this session; the library's own interceptor
      // sets `withCredentials` for the API root alone.
      expect(request.request.withCredentials).toBe(true);
      request.flush('logged out');

      expect((await running).call).toBe('ajax');
      expect(extension.fake.openWindow).not.toHaveBeenCalled();
    });

    it('opens the window instead where the request is refused', async () => {
      config.answersLogout({ url: 'https://repo.example/logout', ajax: true });

      const running = logout.run(REPOSITORY);
      await settled();
      // What a repository whose CORS rules do not name the extension's origin answers.
      http.expectOne('https://repo.example/logout').error(new ProgressEvent('error'));

      expect((await running).call).toBe('window');
      expect(extension.fake.openWindow).toHaveBeenCalled();
    });
  });

  describe('where the repository wants the user afterwards', () => {
    it('reports the page it names', async () => {
      config.answersLogout({ url: 'https://repo.example/logout', next: 'https://portal.example/' });

      expect((await logout.run(REPOSITORY)).next).toBe('https://portal.example/');
    });

    it('opens it in a tab beside the docked one — a page to carry on in, not to carry a logout', async () => {
      await logout.openNext('components/login', REPOSITORY);

      expect(extension.fake.openTab).toHaveBeenCalledWith(
        'https://repo.example/edu-sharing/components/login',
      );
      expect(extension.fake.openWindow).not.toHaveBeenCalled();
    });
  });

  it('announces the logout before anything of the session is torn down', async () => {
    config.answersLogout({ url: 'https://repo.example/logout', destroySession: true });
    const seen: boolean[] = [];
    logout.started.subscribe(() => seen.push(authentication.fake.logout.mock.calls.length === 0));

    await logout.run(REPOSITORY);

    expect(seen).toEqual([true]);
  });
});
