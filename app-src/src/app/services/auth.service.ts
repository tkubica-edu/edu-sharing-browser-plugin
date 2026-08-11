import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom, timeout } from 'rxjs';
import { AuthenticationService, LoginInfo, User, UserService } from 'ngx-edu-sharing-api';

import { APP_CONFIG, toApiRootUrl } from '../config';
import { BOOT_ROOT_URL } from '../app.config';
import { AdditionalWebComponentService } from './additional-web-component.service';
import { BrowserExtensionService } from './browser-extension.service';

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
  private readonly additionalWebComponent = inject(AdditionalWebComponentService);

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
   * The gate every feature is behind: a real session, OR a repository that enables the additional
   * web component — there the session is brought by the embedding host, so the panel must never ask
   * for credentials. {@link loggedIn} stays the plain fact of a repository session and is what the
   * login screen reports; everything that only needs to know *whether it may
   * work* (option visibility, the landing view, the screens' gates, the API-backed actions) uses
   * this instead.
   */
  readonly authorized = computed(() => this.loggedIn() || this.additionalWebComponent.enabled());

  /**
   * Whether a login applies at all. False with the additional web component enabled: it replaces
   * the login necessity entirely, so not even the logged-out state is reported — nothing about a
   * login is shown at all.
   */
  readonly loginRequired = computed(() => !this.additionalWebComponent.enabled());

  /** Load the persisted repository URL (or default), then revalidate any session. */
  async init(): Promise<void> {
    this.repositoryUrl.set(
      await this.browserExtension.storageGet(
        APP_CONFIG.storageKeys.repositoryUrl,
        APP_CONFIG.defaultRepositoryUrl,
      ),
    );
    this.needsReload.set(false);
    await this.restoreSession();
  }

  // Restore an existing repository session on startup. The library authenticates via a
  // session cookie — Basic auth is sent only on the login request; every later request
  // carries the cookie (withCredentials). That cookie survives sidebar reloads, so we
  // ask the backend for the current login info and, if a valid non-guest session is
  // still active, mark the user logged in. No credentials are stored; if the cookie is
  // gone (browser restart, Safari ITP, server logout) this simply resolves to guest.
  private async restoreSession(): Promise<void> {
    try {
      const info = await firstValueFrom(
        this.authentication.observeLoginInfo().pipe(timeout(RESTORE_TIMEOUT_MS)),
      );
      if (this.isValidUser(info)) this.applyLogin(info.authorityName ?? this.username());
    } catch {
      /* no active session (or unreachable) — stay logged out */
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

  /** Log in with username/password. Returns true on a valid, non-guest login. */
  async login(username: string, password: string): Promise<boolean> {
    this.error.set(null);
    try {
      const info = await firstValueFrom(this.authentication.login(username, password));
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

  async logout(): Promise<void> {
    try {
      await firstValueFrom(this.authentication.logout());
    } catch {
      /* best-effort — drop the local session either way */
    }
    this.applyLogout(null);
  }

  private isValidUser(info: LoginInfo | undefined): info is LoginInfo {
    return !!info?.isValidLogin && !info.isGuest;
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
