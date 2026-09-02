import { Injectable, computed, inject, signal } from '@angular/core';

import { APP_CONFIG } from '../config';
import { BrowserExtensionService, OAuthRequest } from './browser-extension.service';
import { errorMessage } from '../util/errors';

/**
 * One identity provider the login screen can offer, as the repository advertises it in the login
 * info's `oauthEntries`. The registration id is what the authorization request passes on so the IdP
 * goes straight to that provider instead of showing its own chooser; a repository that advertises
 * none leaves the panel with the plain "sign in with SSO" button and the issuer's own chooser.
 */
export interface OAuthProvider {
  /** What the button says — the repository's name for the provider, else the registration id. */
  readonly label: string;
  readonly registrationId?: string;
}

/**
 * How an OAuth attempt ended, as the login screen reports it. `cancelled` is the user closing the
 * IdP's window, which is an answer rather than a failure and is shown as no error at all.
 */
export type OAuthOutcome =
  | { readonly kind: 'token'; readonly accessToken: string }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'failed'; readonly error: string };

/** The worker's own vocabulary for a flow nobody completed — see `background/oauth.js`. */
const CANCELLED = /OAUTH_CANCELLED|OAUTH_TIMEOUT/;

/**
 * What the reported failures read as where a user sees them. Keyed by the codes the worker's flow
 * throws, so a refusal says which step refused rather than showing its internals.
 */
const ERROR_TEXTS: readonly (readonly [RegExp, string])[] = [
  [/OAUTH_NO_ISSUER|OAUTH_NO_CLIENT_ID/, 'Die SSO-Anmeldung ist nicht konfiguriert (Issuer und Client-ID in den Einstellungen).'],
  [/OAUTH_DISCOVERY_INCOMPLETE/, 'Der Identity Provider beschreibt keine nutzbaren OAuth-Endpunkte.'],
  [/OAUTH_DISCOVERY_FAILED/, 'Der Identity Provider war nicht erreichbar. Issuer-URL prüfen.'],
  [/OAUTH_NO_REDIRECT_URI/, 'Für diesen Browser muss die Redirect-URI in den Einstellungen gesetzt werden.'],
  [/OAUTH_STATE_MISMATCH/, 'Die Antwort des Identity Providers gehört nicht zu dieser Anmeldung.'],
  [/OAUTH_REFUSED/, 'Der Identity Provider hat die Anmeldung abgelehnt.'],
  [/OAUTH_TOKEN_FAILED/, 'Der Identity Provider hat kein Token ausgegeben. Client-ID und Redirect-URI prüfen.'],
  [/OAUTH_TAB_FAILED/, 'Das Anmeldefenster konnte nicht geöffnet werden.'],
];

/**
 * The OpenID Connect client the alternative login uses, and the panel's side of the flow the
 * background worker runs (`background/oauth.js`).
 *
 * Only the configuration and the reporting live here. The flow itself is the worker's, and the
 * repository session the access token is traded for is AuthService's — this service hands one to the
 * other and knows nothing about either.
 */
@Injectable({ providedIn: 'root' })
export class OAuthService {
  private readonly browserExtension = inject(BrowserExtensionService);

  private readonly issuerState = signal('');
  private readonly clientIdState = signal('');
  private readonly scopesState = signal('');
  private readonly redirectUriState = signal('');

  /** The issuer the settings name; empty leaves `APP_CONFIG.oauth.issuer` standing. */
  readonly issuer = computed(() => this.issuerState().trim() || APP_CONFIG.oauth.issuer);
  readonly clientId = computed(() => this.clientIdState().trim() || APP_CONFIG.oauth.clientId);
  readonly scopes = computed(() => this.scopesState().trim() || APP_CONFIG.oauth.scopes);
  readonly redirectUri = computed(() => this.redirectUriState().trim() || APP_CONFIG.oauth.redirectUri);

  /** What the fields hold verbatim, for the settings screen to edit — see {@link issuer}. */
  readonly configuredIssuer = this.issuerState.asReadonly();
  readonly configuredClientId = this.clientIdState.asReadonly();
  readonly configuredScopes = this.scopesState.asReadonly();
  readonly configuredRedirectUri = this.redirectUriState.asReadonly();

  /**
   * Whether the alternative login is offered at all. Both halves of a client are needed for it: an
   * issuer to discover the endpoints from and a client id to name this extension by. Without them the
   * login screen shows the credential form alone, as it did before there was an alternative.
   */
  readonly configured = computed(() => !!this.issuer() && !!this.clientId());

  /**
   * The providers the repository advertises, fed from the login info (see
   * AuthService.applyOAuthEntries). Empty is the ordinary case: the button then leads to the
   * issuer's own chooser, which is where a federating IdP asks the same question anyway.
   */
  private readonly providersState = signal<readonly OAuthProvider[]>([]);
  readonly providers = this.providersState.asReadonly();

  /** Set while the IdP's pages are up, so the login screen can lock its buttons. */
  private readonly runningState = signal(false);
  readonly running = this.runningState.asReadonly();

  /**
   * How many settings stand away from what the panel ships with — see ChatStyleService.changedSettings.
   * Each field counts while it holds something, the shipped default being what the config carries.
   */
  readonly changedSettings = computed(
    () =>
      (this.issuerState().trim() ? 1 : 0) +
      (this.clientIdState().trim() ? 1 : 0) +
      (this.scopesState().trim() ? 1 : 0) +
      (this.redirectUriState().trim() ? 1 : 0),
  );

  /** Load the persisted client. Before the login screen decides whether to offer the alternative. */
  async load(): Promise<void> {
    const keys = APP_CONFIG.storageKeys;
    this.issuerState.set((await this.browserExtension.storageGet<string>(keys.oauthIssuer, '')) || '');
    this.clientIdState.set((await this.browserExtension.storageGet<string>(keys.oauthClientId, '')) || '');
    this.scopesState.set((await this.browserExtension.storageGet<string>(keys.oauthScopes, '')) || '');
    this.redirectUriState.set((await this.browserExtension.storageGet<string>(keys.oauthRedirectUri, '')) || '');
  }

  async setIssuer(issuer: string): Promise<void> {
    await this.persist(this.issuerState, APP_CONFIG.storageKeys.oauthIssuer, issuer);
  }

  async setClientId(clientId: string): Promise<void> {
    await this.persist(this.clientIdState, APP_CONFIG.storageKeys.oauthClientId, clientId);
  }

  async setScopes(scopes: string): Promise<void> {
    await this.persist(this.scopesState, APP_CONFIG.storageKeys.oauthScopes, scopes);
  }

  async setRedirectUri(redirectUri: string): Promise<void> {
    await this.persist(this.redirectUriState, APP_CONFIG.storageKeys.oauthRedirectUri, redirectUri);
  }

  /** Take over what the repository advertises — see {@link providers}. */
  setProviders(providers: readonly OAuthProvider[]): void {
    this.providersState.set(providers);
  }

  /**
   * Run the interactive flow and answer with the access token it produced. The repository session is
   * not established here: what the token is worth against a repository is AuthService's question.
   * Guarded against a second concurrent attempt, which would open a second IdP window.
   */
  async login(repositoryUrl: string, provider?: OAuthProvider): Promise<OAuthOutcome> {
    if (!this.configured()) return { kind: 'failed', error: ERROR_TEXTS[0][1] };
    if (this.runningState()) return { kind: 'cancelled' };
    this.runningState.set(true);
    try {
      return this.readOutcome(await this.browserExtension.oauthLogin(this.request(repositoryUrl, provider)));
    } catch (cause: unknown) {
      return { kind: 'failed', error: this.describe(errorMessage(cause)) };
    } finally {
      this.runningState.set(false);
    }
  }

  /**
   * An access token from the refresh token the worker kept, without showing anything. Null both for
   * nobody being signed in and for a renewal that failed: either way the user has to be asked, and
   * the reason belongs in the log rather than on a screen nobody asked for a login on.
   */
  async silentAccessToken(repositoryUrl: string): Promise<string | null> {
    if (!this.configured()) return null;
    const session = await this.browserExtension.oauthSilent(this.request(repositoryUrl)).catch(() => null);
    if (!session?.success || session.signedIn === false) return null;
    return session.accessToken ?? null;
  }

  /** Drop the OAuth session the worker holds. Best-effort: the repository logout stands either way. */
  async logout(repositoryUrl: string): Promise<void> {
    if (!this.configured()) return;
    await this.browserExtension.oauthLogout(this.request(repositoryUrl)).catch(() => null);
  }

  /**
   * The address that has to be registered with the client at the IdP, and whether the browser's own
   * `identity` API is what produced it. Null where the worker cannot say — see
   * BrowserExtensionService.oauthRedirectUri.
   */
  redirectUriInUse(repositoryUrl: string): Promise<{ redirectUri: string; usesIdentityApi: boolean } | null> {
    return this.browserExtension.oauthRedirectUri(this.request(repositoryUrl));
  }

  /**
   * What every message to the worker states — see {@link OAuthRequest}. The repository is passed in
   * rather than read here: which one the panel runs against is AuthService's, and asking it for it
   * would make the two services depend on each other in a circle.
   */
  private request(repositoryUrl: string, provider?: OAuthProvider): OAuthRequest {
    return {
      issuer: this.issuer(),
      clientId: this.clientId(),
      scopes: this.scopes(),
      redirectUri: this.redirectUri(),
      repositoryUrl,
      registrationId: provider?.registrationId,
    };
  }

  /** The worker's answer as an outcome — see {@link OAuthOutcome}. */
  private readOutcome(session: { success: boolean; accessToken?: string; error?: string }): OAuthOutcome {
    if (session.success && session.accessToken) return { kind: 'token', accessToken: session.accessToken };
    const error = session.error ?? '';
    if (CANCELLED.test(error)) return { kind: 'cancelled' };
    return { kind: 'failed', error: this.describe(error) };
  }

  /** A reported code as the sentence it stands for; anything unrecognised is passed through. */
  private describe(error: string): string {
    for (const [pattern, text] of ERROR_TEXTS) if (pattern.test(error)) return text;
    return error || 'Die SSO-Anmeldung ist fehlgeschlagen.';
  }

  private async persist(state: { set(value: string): void }, key: string, value: string): Promise<void> {
    const trimmed = value.trim();
    state.set(trimmed);
    await this.browserExtension.storageSet(key, trimmed);
  }
}
