import { Observable, of, throwError } from 'rxjs';
import {
  AuthenticationService,
  ClientutilsV1Service,
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

  const fake = {
    observeLoginInfo: vi.fn(() => loginInfo),
    forceLoginInfoRefresh: vi.fn(),
    login: vi.fn((_username: string, _password: string, _scope?: string) => loginInfo),
    logout: vi.fn(() => of(aLoginInfo({ isValidLogin: false, isGuest: true }))),
  } satisfies Partial<AuthenticationService>;

  /** The repository answers with this login info from now on. */
  function answers(next: LoginInfo): void {
    loginInfo = of(next);
  }

  /** The repository cannot be reached, or refuses — every observer sees this error. */
  function fails(cause: unknown): void {
    loginInfo = throwError(() => cause);
  }

  /** The repository never answers, which is what the service's timeout is there for. */
  function silent(): void {
    loginInfo = new Observable<LoginInfo>();
  }

  return { fake, answers, fails, silent };
}

export type AuthenticationFake = ReturnType<typeof fakeAuthentication>;

/** `UserService` answering with the person behind the session, or refusing to. */
export function fakeUserApi(entry: UserEntry | null = null) {
  let currentUser: Observable<UserEntry | null> = of(entry);

  const fake = {
    observeCurrentUser: vi.fn(() => currentUser),
  } satisfies Partial<UserService>;

  function answers(next: UserEntry | null): void {
    currentUser = of(next);
  }

  function fails(cause: unknown): void {
    currentUser = throwError(() => cause);
  }

  return { fake, answers, fails };
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
