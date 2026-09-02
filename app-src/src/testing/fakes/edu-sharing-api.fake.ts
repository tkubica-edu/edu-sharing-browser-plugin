import { Observable, Subject, of, throwError } from 'rxjs';
import {
  AuthenticationService,
  ClientConfig,
  ClientutilsV1Service,
  ConfigService,
  CurrentUserInfo,
  LoginInfo,
  UserEntry,
  UserService,
  WebsiteInformation,
} from 'ngx-edu-sharing-api';
import { vi } from 'vitest';

/**
 * Fakes for the `ngx-edu-sharing-api` services the tested code injects. They stand in for the whole
 * repository: nothing in a unit test builds a request, so nothing depends on a repository being up.
 *
 * `provideHttpClientTesting` (see `../test-providers.ts`) is the second line — these fakes are what
 * makes a spec able to *state* what the repository answers, the testing backend is what catches a
 * request that reaches HTTP anyway.
 */

/** A login info the panel reads as a valid session of a real user. */
export function aLoginInfo(overrides: Partial<LoginInfo> = {}): LoginInfo {
  return {
    isValidLogin: true,
    isGuest: false,
    isAdmin: false,
    authorityName: 'test-user',
    sessionTimeout: 3600,
    ...overrides,
  } as LoginInfo;
}

/** `AuthenticationService` answering with whatever login info the spec puts in. */
export function fakeAuthentication(info: LoginInfo = aLoginInfo()) {
  /** What every observer of the login state is answered with; a spec swaps it per case. */
  let loginInfo: Observable<LoginInfo> = of(info);

  /**
   * What the bearer-token login answers with, where a spec wants it to differ from the rest — the
   * repository can refuse an OAuth token it does not know while a password login would have worked.
   * Unset, it answers like every other login action does.
   */
  let tokenLogin: Observable<LoginInfo> | null = null;

  /** The backend ending the session on its own, and the countdown to it — see `observeAutoLogout`. */
  const autoLogout = new Subject<void>();
  const timeUntilAutoLogout = new Subject<number | null>();

  const fake = {
    observeLoginInfo: vi.fn(() => loginInfo),
    forceLoginInfoRefresh: vi.fn(),
    login: vi.fn((_username: string, _password: string, _scope?: string) => loginInfo),
    loginToken: vi.fn((_accessToken: string) => tokenLogin ?? loginInfo),
    logout: vi.fn(() => of(aLoginInfo({ isValidLogin: false, isGuest: true }))),
    observeAutoLogout: vi.fn(() => autoLogout.asObservable()),
    observeTimeUntilAutoLogout: vi.fn((_interval: number) => timeUntilAutoLogout.asObservable()),
  } satisfies Partial<AuthenticationService>;

  /** The repository answers with this login info from now on. */
  function answers(next: LoginInfo): void {
    loginInfo = of(next);
  }

  /** It answers a bearer token with this, whatever it answers the other login actions with. */
  function answersToken(next: LoginInfo): void {
    tokenLogin = of(next);
  }

  /** It refuses the bearer token — the OAuth login completed, the repository still says no. */
  function refusesToken(cause: unknown): void {
    tokenLogin = throwError(() => cause);
  }

  /** The repository cannot be reached, or refuses — every observer sees this error. */
  function fails(cause: unknown): void {
    loginInfo = throwError(() => cause);
  }

  /** The repository never answers, which is what the service's timeout is there for. */
  function silent(): void {
    loginInfo = new Observable<LoginInfo>();
  }

  /** The repository logged the session out because nothing was asked of it for too long. */
  function timesOut(): void {
    autoLogout.next();
  }

  /** The countdown to that, as the library reports it — null once there is no session. */
  function reportsTimeUntilLogout(remaining: number | null): void {
    timeUntilAutoLogout.next(remaining);
  }

  /** The repository refuses the logout call, or cannot be reached for it. */
  function failsLogout(cause: unknown): void {
    fake.logout.mockReturnValue(throwError(() => cause));
  }

  return {
    fake,
    answers,
    answersToken,
    refusesToken,
    fails,
    silent,
    timesOut,
    reportsTimeUntilLogout,
    failsLogout,
  };
}

export type AuthenticationFake = ReturnType<typeof fakeAuthentication>;

/** `UserService` answering with the person behind the session, or refusing to. */
export function fakeUserApi(entry: UserEntry | null = null) {
  let currentUser: Observable<UserEntry | null> = of(entry);

  /**
   * The person plus the login info, as `observeCurrentUserInfo` answers. What the logout reads the
   * user's authentication type off (`cm:esssotype`), which decides which logout address applies.
   */
  let currentUserInfo: Observable<CurrentUserInfo> = of({
    user: entry,
    loginInfo: aLoginInfo(),
  } as CurrentUserInfo);

  const fake = {
    observeCurrentUser: vi.fn(() => currentUser),
    observeCurrentUserInfo: vi.fn(() => currentUserInfo),
  } satisfies Partial<UserService>;

  function answers(next: UserEntry | null): void {
    currentUser = of(next);
    currentUserInfo = of({ user: next, loginInfo: aLoginInfo() } as CurrentUserInfo);
  }

  /** The signed-in user is authenticated the given way — `null` for a user the repository holds. */
  function isAuthenticatedBy(ssoType: string | null): void {
    const person = { properties: ssoType ? { 'cm:esssotype': [ssoType] } : {} };
    currentUserInfo = of({ user: { person }, loginInfo: aLoginInfo() } as unknown as CurrentUserInfo);
  }

  function fails(cause: unknown): void {
    currentUser = throwError(() => cause);
    currentUserInfo = throwError(() => cause);
  }

  return { fake, answers, isAuthenticatedBy, fails };
}

export type UserApiFake = ReturnType<typeof fakeUserApi>;

/**
 * `ClientutilsV1Service`, whose `getWebsiteInformation` is the repository's answer to „is this page
 * already in here". The spy is what a spec asserts *was not called* — most of
 * `PageRecognitionService` is about not asking.
 */
export function fakeClientUtils(information: WebsiteInformation = {}) {
  let answer: Observable<WebsiteInformation> = of(information);

  const fake = {
    getWebsiteInformation: vi.fn(() => answer),
  } satisfies Partial<ClientutilsV1Service>;

  function answers(next: WebsiteInformation): void {
    answer = of(next);
  }

  function fails(cause: unknown): void {
    answer = throwError(() => cause);
  }

  return { fake, answers, fails };
}

export type ClientUtilsFake = ReturnType<typeof fakeClientUtils>;

/**
 * `ConfigService`, whose client config carries the repository's logout policy (`logout`) — what
 * LogoutService branches on. Answers with no config at all by default, which is the ordinary case:
 * a repository that publishes no policy is logged out of by ending the session.
 */
export function fakeConfig(config: ClientConfig | null = null) {
  let answer: Observable<ClientConfig | null> = of(config);

  const fake = {
    observeConfig: vi.fn(() => answer),
  } satisfies Partial<ConfigService>;

  function answers(next: ClientConfig | null): void {
    answer = of(next);
  }

  /** The repository publishes this logout policy and nothing else of interest. */
  function answersLogout(logout: NonNullable<ClientConfig['logout']>): void {
    answer = of({ logout } as ClientConfig);
  }

  function fails(cause: unknown): void {
    answer = throwError(() => cause);
  }

  return { fake, answers, answersLogout, fails };
}

export type ConfigFake = ReturnType<typeof fakeConfig>;
