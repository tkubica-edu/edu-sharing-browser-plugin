import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom, timeout } from 'rxjs';
import { AuthenticationService, LoginInfo } from 'ngx-edu-sharing-api';

import { APP_CONFIG, toApiRootUrl } from '../config';
import { BOOT_ROOT_URL } from '../app.config';
import { ExtService } from './ext.service';

export interface AuthState {
  repositoryUrl: string;
  loggedIn: boolean;
  guest: boolean;
  username: string | null;
  error: string | null;
  /** True when the repo URL was edited to differ from the bootstrapped one. */
  needsReload: boolean;
  /** True while an existing session is being revalidated on startup. */
  restoring: boolean;
}

// Login against a user-supplied edu-sharing repository via ngx-edu-sharing-api.
// The library freezes rootUrl at bootstrap, so switching repositories reloads the
// sidebar (persist URL → reload → main.ts re-bootstraps).
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly auth = inject(AuthenticationService);
  private readonly ext = inject(ExtService);
  private readonly bootRootUrl = inject(BOOT_ROOT_URL);

  // Signal so login/state changes update the UI immediately.
  readonly state = signal<AuthState>({
    repositoryUrl: this.bootRootUrl.replace(/\/rest$/, ''),
    loggedIn: false,
    guest: true,
    username: null,
    error: null,
    needsReload: false,
    restoring: true
  });

  readonly loggedIn = computed(() => this.state().loggedIn);

  /** Load the persisted repository URL (or default), then revalidate any session. */
  async init(): Promise<void> {
    let repoUrl = APP_CONFIG.defaultRepositoryUrl;
    if (this.ext.available) {
      repoUrl = await this.ext.storageGet(APP_CONFIG.storageKeys.repositoryUrl, APP_CONFIG.defaultRepositoryUrl);
    }
    this.state.update((s) => ({ ...s, repositoryUrl: repoUrl, needsReload: false }));
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
      const info = (await firstValueFrom(this.auth.observeLoginInfo().pipe(timeout(8000)))) as LoginInfo;
      if (info?.isValidLogin && !info?.isGuest) {
        this.state.update((s) => ({
          ...s,
          loggedIn: true,
          guest: false,
          username: info.authorityName || s.username,
          error: null
        }));
      }
    } catch {
      /* no active session (or unreachable) — stay logged out */
    } finally {
      this.state.update((s) => ({ ...s, restoring: false }));
    }
  }

  // Persist the repository base; flag needsReload if it differs from the booted URL.
  setRepositoryUrl(repositoryBase: string): void {
    const base = (repositoryBase || '').trim();
    this.state.update((s) => ({
      ...s,
      repositoryUrl: base,
      needsReload: !!base && toApiRootUrl(base) !== this.bootRootUrl
    }));
    if (base && this.ext.available) {
      void this.ext.storageSet(APP_CONFIG.storageKeys.repositoryUrl, base);
    }
  }

  /** Reload the sidebar so the library re-initializes against the new repository. */
  applyRepositoryChange(): void {
    location.reload();
  }

  /** Log in with username/password. Returns true on a valid, non-guest login. */
  async login(username: string, password: string): Promise<boolean> {
    this.state.update((s) => ({ ...s, error: null }));
    try {
      const info = (await firstValueFrom(this.auth.login(username, password))) as LoginInfo;
      const valid = !!info?.isValidLogin && !info?.isGuest;
      if (!valid) {
        this.state.update((s) => ({ ...s, loggedIn: false, guest: true, username: null, error: 'Ungültige Anmeldedaten.' }));
        return false;
      }
      this.state.update((s) => ({
        ...s,
        loggedIn: true,
        guest: false,
        username: info?.authorityName || username,
        error: null
      }));
      return true;
    } catch (e: unknown) {
      this.state.update((s) => ({ ...s, loggedIn: false, guest: true, username: null, error: this.describeError(e) }));
      return false;
    }
  }

  async logout(): Promise<void> {
    try { await firstValueFrom(this.auth.logout()); } catch { /* best-effort */ }
    this.state.update((s) => ({ ...s, loggedIn: false, guest: true, username: null }));
  }

  private describeError(e: unknown): string {
    const err = e as { status?: number; message?: string };
    if (err?.status === 0) return 'Verbindung zum Repository fehlgeschlagen (CORS/Netzwerk). URL prüfen.';
    if (err?.status === 401 || err?.status === 403) return 'Ungültige Anmeldedaten.';
    if (typeof err?.message === 'string') return err.message;
    return 'Login fehlgeschlagen.';
  }
}
