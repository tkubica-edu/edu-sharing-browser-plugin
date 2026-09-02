import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom, timeout } from 'rxjs';
import { AuthenticationService, LoginInfo, User, UserService } from 'ngx-edu-sharing-api';

import { APP_CONFIG, toApiRootUrl } from '../config';
import { BOOT_ROOT_URL } from '../app.config';
import { BrowserExtensionCustomWebComponentService } from './browser-extension-custom-web-component.service';
import { BrowserExtensionService } from './browser-extension.service';
import { OAuthProvider, OAuthService } from './oauth.service';

/** How long to wait for the session check on startup. */
const RESTORE_TIMEOUT_MS = 8000;

// Login against a user-supplied edu-sharing repository via ngx-edu-sharing-api.
// The library freezes rootUrl at bootstrap, so switching repositories reloads the
// sidebar (persist URL → reload → main.ts re-bootstraps).
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly authentication = inject(AuthenticationService);
  private readonly userApi = inject(UserService);
  private readonly browserExtension = inject(BrowserExtensionService);
  private readonly bootRootUrl = inject(BOOT_ROOT_URL);
  private readonly browserExtensionCustomWebComponent = inject(BrowserExtensionCustomWebComponentService);
  private readonly oauth = inject(OAuthService);

  /** The repository base URL (`…/edu-sharing`) the user configured. */
  readonly repositoryUrl = signal(this.bootRootUrl.replace(/\/rest$/, ''));
  /** True for a valid, non-guest repository session. */
  readonly loggedIn = signal(false);
  readonly username = signal<string | null>(null);
  /**
   * The signed-in user's person record, fetched once the session is established — it carries the
   * profile the user is named by (first/last name), which the login name alone does not. Null while
   * it is still being fetched, and whenever the request fails: {@link username} is what remains.
   */
  readonly currentUser = signal<User | null>(null);
  readonly error = signal<string | null>(null);
  /** True when the repository URL was edited to differ from the bootstrapped one. */
  readonly needsReload = signal(false);

  /** The library's rootUrl for the configured repository (`…/edu-sharing/rest`). */
  readonly apiRootUrl = computed(() => toApiRootUrl(this.repositoryUrl()));

  /**
   * The gate every feature is behind: a real session, or a repository that enables the additional web component,
   * where the session is brought by the embedding host and the panel must never ask for credentials.
   * {@link loggedIn} stays the plain fact of a repository session and is what the login screen reports.
   */
  readonly authorized = computed(() => this.loggedIn() || this.browserExtensionCustomWebComponent.enabled());

  /**
   * Whether a login applies at all. False with the browser extension custom web component enabled:
   * it replaces the login necessity entirely, so not even the logged-out state is reported — nothing
   * about a login is shown at all.
   */
  readonly loginRequired = computed(() => !this.browserExtensionCustomWebComponent.enabled());

  /**
   * Whether the login card leads through an identity provider — true exactly where the repository
   * publishes an authorization server of its own (see OAuthService.available).
   *
   * Deliberately not gated on {@link loginRequired}: the card is reachable where no login is
   * required too (the Login section, whose lead then reads that only public content is available
   * without one), and it offers the same way in there.
   */
  readonly oauthOffered = computed(() => this.oauth.available());

  /**
   * Whether the card asks for username and password. The other way round from {@link oauthOffered}
   * rather than beside it: a repository that federates has said which identity it wants to be signed
   * in with, so its own credential form is not a second way in but a different answer — and one this
   * panel has no business offering. Where the repository federates against nothing, this is the only
   * way in and the card is what it always was.
   */
  readonly passwordLoginOffered = computed(() => !this.oauth.available());

  /** The providers to offer, as the repository advertises them — see OAuthService.providers. */
  readonly oauthProviders = this.oauth.providers;

  /** Set while the identity provider's pages are up — see OAuthService.running. */
  readonly oauthRunning = this.oauth.running;

  /** Load the persisted repository URL (or default), then revalidate any session. */
  async init(): Promise<void> {
    this.repositoryUrl.set(
      await this.browserExtension.storageGet(
        APP_CONFIG.storageKeys.repositoryUrl,
        APP_CONFIG.defaultRepositoryUrl,
      ),
    );
    this.needsReload.set(false);
    // Asked before anything else about a login: the answer decides which way in the card offers, and
    // it is a fact about this repository rather than a setting (see OAuthService.probe).
    await this.oauth.probe(this.repositoryUrl());
    await this.restoreSession();
    // The repository session outlives a sidebar reload as a cookie, so this only runs where that
    // cookie is gone — the repository's own session timeout, or a browser that dropped it. The OAuth
    // refresh token then puts the session back without asking, which is what holding one is for.
    if (!this.loggedIn()) await this.resumeOAuthSession();
  }

  // Restore an existing repository session on startup: the library authenticates by session cookie, which survives
  // a sidebar reload — so the backend is asked for the current login info and a valid non-guest session is taken
  // up. No credentials are stored; without the cookie this resolves to guest.
  private async restoreSession(): Promise<void> {
    try {
      const info = await firstValueFrom(
        this.authentication.observeLoginInfo().pipe(timeout(RESTORE_TIMEOUT_MS)),
      );
      this.applyOAuthEntries(info);
      if (this.isValidUser(info)) this.applyLogin(info.authorityName ?? this.username());
    } catch {
      /* no active session (or unreachable) — stay logged out */
    }
  }

  /**
   * Ask the repository again what this session is. Unlike the boot's restore this also drops a session
   * that is gone — it answers the question "is what the panel shows still true?", which a check that
   * can only ever log in would leave half-answered.
   */
  async revalidate(): Promise<void> {
    // Without this the library answers from the login info it already holds, which is exactly the
    // stale answer this is here to replace.
    this.authentication.forceLoginInfoRefresh();
    try {
      const info = await firstValueFrom(
        this.authentication.observeLoginInfo().pipe(timeout(RESTORE_TIMEOUT_MS)),
      );
      this.applyOAuthEntries(info);
      if (this.isValidUser(info)) this.applyLogin(info.authorityName ?? this.username());
      else this.applyLogout(null);
    } catch {
      /* unreachable — keep the session as it is rather than logging the user out on a hiccup */
    }
  }

  /** Persist the repository base; flag needsReload if it differs from the booted URL. */
  setRepositoryUrl(repositoryBase: string): void {
    const base = repositoryBase.trim();
    this.repositoryUrl.set(base);
    this.needsReload.set(!!base && toApiRootUrl(base) !== this.bootRootUrl);
    if (base) {
      void this.browserExtension.storageSet(APP_CONFIG.storageKeys.repositoryUrl, base);
    }
  }

  /** Reload the sidebar so the library re-initializes against the new repository. */
  applyRepositoryChange(): void {
    location.reload();
  }

  /**
   * Log in with username/password. Returns true on a valid, non-guest login.
   *
   * Refused outright where the repository federates: it has named the identity provider its users
   * are known by, and a credential presented here would go around it (see
   * {@link passwordLoginOffered}, which is also what hides the form).
   */
  async login(username: string, password: string): Promise<boolean> {
    this.error.set(null);
    if (!this.passwordLoginOffered()) {
      this.applyLogout('Dieses Repository erlaubt die Anmeldung nur über SSO.');
      return false;
    }
    try {
      const info = await firstValueFrom(this.authentication.login(username, password));
      this.applyOAuthEntries(info);
      if (!this.isValidUser(info)) {
        this.applyLogout('Ungültige Anmeldedaten.');
        return false;
      }
      this.applyLogin(info.authorityName ?? username);
      return true;
    } catch (cause: unknown) {
      this.applyLogout(this.describeError(cause));
      return false;
    }
  }

  /**
   * Sign in through an identity provider instead of with a password: the background worker runs the
   * Authorization Code flow with PKCE, and the access token it ends with is traded here for a
   * repository session — `loginToken` presents it as a bearer token, and the repository answers with
   * the session cookie every later request carries. Returns true on a valid, non-guest session.
   *
   * The trade is the step that can still refuse a completed OAuth login: the person is who the IdP
   * says they are, and the repository may still not know them.
   */
  async loginWithOAuth(provider?: OAuthProvider): Promise<boolean> {
    this.error.set(null);
    const outcome = await this.oauth.login(this.repositoryUrl(), provider);
    // Nobody completed the flow. Not an error: the screen is left exactly as it was.
    if (outcome.kind === 'cancelled') return false;
    if (outcome.kind === 'failed') {
      this.applyLogout(outcome.error);
      return false;
    }
    return this.exchangeForSession(outcome.accessToken, 'Das Repository hat die SSO-Anmeldung nicht akzeptiert.');
  }

  /**
   * Put a session back from the refresh token the worker kept, without showing anything — see
   * {@link init}. Silent throughout: a stored token that no longer works is not something to report
   * on a panel nobody has asked for a login on, and the login screen it leaves standing says the rest.
   */
  private async resumeOAuthSession(): Promise<boolean> {
    const accessToken = await this.oauth.silentAccessToken(this.repositoryUrl());
    if (!accessToken) return false;
    const restored = await this.exchangeForSession(accessToken, null);
    // The refusal belongs to a login nobody asked for; the screen stays as the failed restore left it.
    if (!restored) this.error.set(null);
    return restored;
  }

  /**
   * Trade an OAuth access token for a repository session. `refusal` is what a token the repository
   * will not take reads as, or null where the attempt is to stay silent about it.
   */
  private async exchangeForSession(accessToken: string, refusal: string | null): Promise<boolean> {
    try {
      const info = await firstValueFrom(
        this.authentication.loginToken(accessToken).pipe(timeout(RESTORE_TIMEOUT_MS)),
      );
      this.applyOAuthEntries(info);
      if (!this.isValidUser(info)) {
        this.applyLogout(refusal);
        return false;
      }
      this.applyLogin(info.authorityName ?? this.username());
      return true;
    } catch (cause: unknown) {
      this.applyLogout(refusal ?? this.describeError(cause));
      return false;
    }
  }

  async logout(): Promise<void> {
    try {
      await firstValueFrom(this.authentication.logout());
    } catch {
      /* best-effort — drop the local session either way */
    }
    // The OAuth session is dropped with the repository one, refresh token included. Leaving it would
    // make the next boot sign the user straight back in — a logout that does not log out.
    await this.oauth.logout(this.repositoryUrl());
    this.applyLogout(null);
  }

  private isValidUser(info: LoginInfo | undefined): info is LoginInfo {
    return !!info?.isValidLogin && !info.isGuest;
  }

  /**
   * Take over the identity providers the repository advertises. `oauthEntries` sits on the primary
   * login only — a scope login describes a different thing — so the field is narrowed rather than
   * assumed. An entry without a registration id names nothing the authorization request could pass
   * on and is dropped: it would produce a button that does the same as the plain one.
   */
  private applyOAuthEntries(info: LoginInfo | undefined): void {
    if (!info || !('oauthEntries' in info)) return;
    const providers: OAuthProvider[] = (info.oauthEntries ?? [])
      .filter((entry) => !!entry?.registrationId)
      .map((entry) => ({
        label: entry.name?.trim() || String(entry.registrationId),
        registrationId: entry.registrationId,
      }));
    this.oauth.setProviders(providers);
  }

  private applyLogin(username: string | null): void {
    this.loggedIn.set(true);
    this.username.set(username);
    this.error.set(null);
    void this.loadCurrentUser();
  }

  private applyLogout(error: string | null): void {
    this.loggedIn.set(false);
    this.username.set(null);
    this.currentUser.set(null);
    this.error.set(error);
  }

  /**
   * Fetch the person behind the session. Best-effort and never awaited by the login: the session is
   * valid either way, and everything that shows a name falls back to the login name.
   */
  private async loadCurrentUser(): Promise<void> {
    try {
      const entry = await firstValueFrom(
        this.userApi.observeCurrentUser().pipe(timeout(RESTORE_TIMEOUT_MS)),
      );
      this.currentUser.set(entry?.person ?? null);
    } catch {
      this.currentUser.set(null);
    }
  }

  private describeError(cause: unknown): string {
    const { status, message } = (cause ?? {}) as { status?: number; message?: string };
    if (status === 0) return 'Verbindung zum Repository fehlgeschlagen (CORS/Netzwerk). URL prüfen.';
    if (status === 401 || status === 403) return 'Ungültige Anmeldedaten.';
    return message ? String(message) : 'Login fehlgeschlagen.';
  }
}
