import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, Subject, firstValueFrom, take, timeout } from 'rxjs';
import {
  AuthenticationService,
  ClientConfig,
  ConfigService,
  RestConstants,
  UserService,
} from 'ngx-edu-sharing-api';

import { BrowserExtensionService } from './browser-extension.service';

/** How long the repository is given to answer the questions a logout has to ask it. */
const LOGOUT_TIMEOUT_MS = 8000;

/** The repository's logout policy, as it publishes it in the client config's `logout` block. */
export type LogoutPolicy = NonNullable<ClientConfig['logout']>;

/** How the URL the policy named was called, if it named one at all. */
export type LogoutCall = 'none' | 'ajax' | 'window';

/** What a logout did, for the caller to report and for a test to assert on. */
export interface LogoutOutcome {
  /**
   * Whether the repository's own session was ended through the API. False only where the repository
   * refused or could not be reached — it is always attempted, see {@link LogoutService.run}.
   */
  readonly sessionDestroyed: boolean;
  /** The absolute address the policy named, or null where it named none. */
  readonly url: string | null;
  /** How that address was called — see {@link LogoutCall}. */
  readonly call: LogoutCall;
  /** Where the repository wants the user to end up afterwards (`logout.next`), or null. */
  readonly next: string | null;
}

/**
 * The repository's logout policy, carried out the way edu-sharing's own frontend carries it out
 * (`UiService.handleLogout`): the client config decides whether ending the session is enough, or
 * whether an address of the repository's — its own logout page, or the identity provider's single
 * logout — has to be called as well, and which of the three addresses it publishes applies to this
 * user.
 *
 * Three things are deliberately done differently here, because this is a panel docked next to a page
 * rather than a page of its own.
 *
 * The session is **always** ended through the API, where the frontend leaves that to the logout
 * address unless `destroySession` says otherwise. The frontend can: it hands the browser to that
 * address in its own top-level tab and the whole redirect chain runs there. This panel opens a window
 * it does not follow and cannot wait for — one the user may close unread — so leaving the session to
 * it means a panel that shows a login card while the session cookie is still alive, and the next boot
 * takes that cookie straight back up (`AuthService.restoreSession`). A logout that can be undone by
 * navigating to another page is not a logout. `destroySession` therefore only tells us what the
 * repository expected, not whether to do it.
 *
 * The address is opened in a **window of its own**, the way the sign-in pages come up, rather than by
 * navigating the panel's tab: the panel does not survive that, and the page the user is working on is
 * not the logout's to take away. The window is left standing — it is a page of the repository's or of
 * the identity provider's, it may well ask the user something, and closing it is theirs to do. And
 * `logout.next` opens in a **tab beside the docked one**, for the same reason.
 *
 * Neither the OAuth session nor the panel's own logged-out state is this service's: it is the
 * repository's policy and nothing else, and AuthService is what puts the three together.
 */
@Injectable({ providedIn: 'root' })
export class LogoutService {
  private readonly authentication = inject(AuthenticationService);
  private readonly config = inject(ConfigService);
  private readonly userApi = inject(UserService);
  private readonly http = inject(HttpClient);
  private readonly browserExtension = inject(BrowserExtensionService);
  private readonly startedSubject = new Subject<ClientConfig | null>();

  /**
   * Fires once a logout is under way, before anything of the session is torn down, with the client
   * config it will be carried out under. The place for anything that has to let go of state that
   * belongs to the ending session while it is still usable.
   */
  readonly started: Observable<ClientConfig | null> = this.startedSubject.asObservable();

  /**
   * Log out of the repository. `repositoryUrl` is the base a relative address in the policy is
   * resolved against — the panel is served from the extension's own origin, where a relative URL
   * would point at nothing.
   */
  async run(repositoryUrl: string): Promise<LogoutOutcome> {
    const config = await this.clientConfig();
    this.startedSubject.next(config);

    const policy = config?.logout;
    // No policy is the ordinary case: ending the session is the whole of the logout.
    if (!policy) {
      return { sessionDestroyed: await this.destroySession(), url: null, call: 'none', next: null };
    }

    const next = policy.next?.trim() || null;
    const url = this.absolute(await this.urlFor(policy), repositoryUrl);
    // The address goes first, so it is carried while the session it may have to present still
    // exists — an identity provider's single logout identifies the session by the cookies it comes
    // with.
    const call = url ? await this.callLogoutUrl(url, policy.ajax === true) : 'none';
    // Then the session, whatever `destroySession` says: this panel cannot follow the address it
    // opened, so the API call is the only part of a logout it can stand behind. See the note above.
    return { sessionDestroyed: await this.destroySession(), url, call, next };
  }

  /**
   * Take the user to where the repository wants them after a logout (`logout.next`), in a tab of its
   * own. Separate from {@link run} so the caller can put its own screen in order first.
   */
  async openNext(next: string, repositoryUrl: string): Promise<void> {
    const url = this.absolute(next, repositoryUrl);
    if (!url) return;
    // A tab, not a window: this is a page the user is to carry on in rather than one that carries a
    // logout.
    await this.browserExtension.openTab(url).catch(() => undefined);
  }

  /**
   * Which of the policy's three addresses applies. A user known through Shibboleth has a session at
   * the identity provider as well, and only `ssoUrl` ends that one; `localUrl` is for a user the
   * repository holds itself, and `url` is what both fall back to.
   */
  private async urlFor(policy: LogoutPolicy): Promise<string | null> {
    const sso = await this.ssoType();
    if (sso === RestConstants.SSO_TYPE_Shibboleth) return policy.ssoUrl || policy.url || null;
    return policy.localUrl || policy.url || null;
  }

  /** How the signed-in user is authenticated, as the repository records it on the person. */
  private async ssoType(): Promise<string | null> {
    try {
      const info = await firstValueFrom(
        this.userApi.observeCurrentUserInfo().pipe(take(1), timeout(LOGOUT_TIMEOUT_MS)),
      );
      const properties = info?.user?.person?.properties as Record<string, string[]> | undefined;
      return properties?.[RestConstants.CM_PROP_ESSSOTYPE]?.[0] ?? null;
    } catch {
      // Unanswered, the user counts as a local one: `url` then applies, which is the address a
      // repository that publishes only one means for everybody.
      return null;
    }
  }

  /** The repository's client config, or null where it cannot be had. */
  private async clientConfig(): Promise<ClientConfig | null> {
    try {
      return await firstValueFrom(
        this.config.observeConfig().pipe(take(1), timeout(LOGOUT_TIMEOUT_MS)),
      );
    } catch {
      return null;
    }
  }

  /**
   * Let the repository's logout address be reached, the way the policy asks for it: `ajax` calls it
   * from the panel, anything else opens it in a window the user sees.
   *
   * For the call, `withCredentials` is set here rather than left to the library's interceptor, which
   * sets it for the API root alone — and a logout address that arrives without the session cookie
   * logs nobody out. A refused call falls back to the window: the request leaves the extension's own
   * origin, so a repository whose CORS rules do not name that origin turns it down, while a window
   * the browser opens carries the very same cookies with no origin to be refused for.
   */
  private async callLogoutUrl(url: string, ajax: boolean): Promise<LogoutCall> {
    if (!ajax) {
      await this.openLogoutWindow(url);
      return 'window';
    }
    try {
      await firstValueFrom(
        this.http
          .get(url, { responseType: 'text', withCredentials: true })
          .pipe(timeout(LOGOUT_TIMEOUT_MS)),
      );
      return 'ajax';
    } catch {
      await this.openLogoutWindow(url);
      return 'window';
    }
  }

  /** End the repository session through the API. False where it refused or could not be reached. */
  private async destroySession(): Promise<boolean> {
    try {
      await firstValueFrom(this.authentication.logout().pipe(timeout(LOGOUT_TIMEOUT_MS)));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Let the browser open the logout address, which is what carries it with the cookies the session
   * lives in. Best-effort: a window that could not be opened is not a logout that failed — the
   * session is gone either way.
   */
  private async openLogoutWindow(url: string): Promise<void> {
    await this.browserExtension.openWindow(url).catch(() => undefined);
  }

  /**
   * A policy address as an absolute one. A repository may publish its logout as a path, which is
   * absolute against itself and against nothing in a panel served from the extension.
   */
  private absolute(url: string | null, repositoryUrl: string): string | null {
    const address = url?.trim();
    if (!address) return null;
    try {
      return new URL(address, `${repositoryUrl.replace(/\/+$/, '')}/`).toString();
    } catch {
      return null;
    }
  }
}
