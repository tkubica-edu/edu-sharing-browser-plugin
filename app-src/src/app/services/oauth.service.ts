import { Injectable, computed, inject, signal } from '@angular/core';

import { APP_CONFIG } from '../config';
import { BrowserExtensionService, OAuthDiscovery, OAuthRequest, RedirectUriInUse } from './browser-extension.service';
import { errorMessage } from '../util/errors';

/**
 * One identity provider the login screen can offer, as the repository advertises it in the login
 * info's `oauthEntries`. The registration id is what the authorization request passes on so the IdP
 * goes straight to that provider instead of showing its own chooser; a repository that advertises
 * none leaves the panel with a single button and the server's own chooser.
 */
export interface OAuthProvider {
  /**
   * The repository's own name for the provider, else its registration id. Not what the button says —
   * that names the flow (see LoginComponent) — but what the panel knows the provider as.
   */
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

/**
 * What the repository answered about its authorization server — see {@link OAuthService.probe}.
 * `unknown` is the state before it was asked, in which the panel behaves as if there were none:
 * the SSO login is a claim about the repository, and nothing is claimed until it answers.
 */
export type OAuthAvailability =
  | { readonly kind: 'unknown' }
  | { readonly kind: 'available'; readonly server: OAuthDiscovery }
  | { readonly kind: 'unavailable'; readonly discoveryUrl: string; readonly error: string };

/** The worker's own vocabulary for a flow nobody completed — see `background/oauth.js`. */
const CANCELLED = /OAUTH_CANCELLED|OAUTH_TIMEOUT/;

/**
 * What the reported failures read as where a user sees them. Keyed by the codes the worker's flow
 * throws, so a refusal says which step refused rather than showing its internals.
 */
const ERROR_TEXTS: readonly (readonly [RegExp, string])[] = [
  [/OAUTH_NO_REPOSITORY|OAUTH_NO_CLIENT_ID/, 'Die SSO-Anmeldung steht für dieses Repository nicht zur Verfügung.'],
  [/OAUTH_DISCOVERY_INCOMPLETE/, 'Das Repository beschreibt keine nutzbaren OAuth-Endpunkte.'],
  [/OAUTH_DISCOVERY_FAILED/, 'Das Repository veröffentlicht keine OAuth-Konfiguration.'],
  [/OAUTH_NO_REDIRECT_URI/, 'Für diesen Browser lässt sich keine Redirect-URI bilden — Repository-URL prüfen.'],
  [/OAUTH_STATE_MISMATCH/, 'Die Antwort des Identity Providers gehört nicht zu dieser Anmeldung.'],
  [/invalid_scope/, 'Der Identity Provider kennt einen der angeforderten Scopes nicht.'],
  [/redirect_uri_mismatch|invalid_redirect/, 'Die Redirect-URI ist beim Provider nicht (so) hinterlegt — den in den Einstellungen angezeigten Wert eintragen.'],
  [/invalid_client|unauthorized_client/, 'Der Provider kennt diese Client-ID nicht, oder der Client ist nicht als öffentlicher Client (ohne Secret) registriert.'],
  [/OAUTH_REFUSED/, 'Der Identity Provider hat die Anmeldung abgelehnt.'],
  [/OAUTH_TOKEN_FAILED/, 'Der Identity Provider hat kein Token ausgegeben. Client-ID und Redirect-URI prüfen.'],
  [/OAUTH_TAB_FAILED/, 'Das Anmeldefenster konnte nicht geöffnet werden.'],
];

/**
 * The panel's side of the OAuth flow the background worker runs (`background/oauth.js`), and the one
 * question that decides whether it is offered: does the repository publish an authorization server
 * of its own?
 *
 * Nothing here is configured. The server is discovered below the repository the panel is pointed at,
 * the client and the scopes are shipped constants (`APP_CONFIG.oauth`), and the redirect address is
 * the browser's. The flow itself is the worker's, and the repository session the access token is
 * traded for is AuthService's — this service hands one to the other and knows nothing about either.
 */
@Injectable({ providedIn: 'root' })
export class OAuthService {
  private readonly browserExtension = inject(BrowserExtensionService);

  /** The client and the scopes every message states — the panel ships with both. */
  readonly clientId = APP_CONFIG.oauth.clientId;
  readonly scopes = APP_CONFIG.oauth.scopes;

  private readonly availabilityState = signal<OAuthAvailability>({ kind: 'unknown' });

  /** What the repository answered, for the settings screen to render — see {@link probe}. */
  readonly availability = this.availabilityState.asReadonly();

  /**
   * Whether the SSO login is the way into this repository. It is the *only* way where it is
   * available at all: a repository that publishes an authorization server has said which identity
   * it wants to be signed in with, and the credential form would be a second, weaker answer to a
   * question it has already settled (see AuthService.passwordLoginOffered).
   */
  readonly available = computed(() => this.availabilityState().kind === 'available');

  /** Set while the repository is being asked, so the login card can hold still until it answers. */
  private readonly probingState = signal(false);
  readonly probing = this.probingState.asReadonly();

  /**
   * The providers the repository advertises, fed from the login info (see
   * AuthService.applyOAuthEntries). Empty is the ordinary case: the button then leads to the
   * server's own chooser, which is where a federating IdP asks the same question anyway.
   */
  private readonly providersState = signal<readonly OAuthProvider[]>([]);
  readonly providers = this.providersState.asReadonly();

  /** Set while the IdP's pages are up, so the login screen can lock its buttons. */
  private readonly runningState = signal(false);
  readonly running = this.runningState.asReadonly();

  /**
   * Ask the repository whether it federates, and remember the answer. Before the login screen
   * decides what to offer, and again whenever the panel is pointed at another repository — the
   * answer belongs to that repository and to no other.
   *
   * A repository that publishes no such document is the ordinary case and no error: the answer is
   * simply that there is no SSO login here.
   */
  async probe(repositoryUrl: string): Promise<OAuthAvailability> {
    this.probingState.set(true);
    try {
      const server = await this.browserExtension.oauthDiscover(this.request(repositoryUrl));
      return this.remember({ kind: 'available', server });
    } catch (cause: unknown) {
      return this.remember({
        kind: 'unavailable',
        discoveryUrl: this.discoveryUrlOf(repositoryUrl),
        error: this.describe(errorMessage(cause)),
      });
    } finally {
      this.probingState.set(false);
    }
  }

  /**
   * Where the answer was looked for, as the worker assembles the address (`discoveryUrlOf` in
   * `background/oauth.js`). Repeated here only so the settings can name it for a repository that
   * answered nothing — where the worker never got as far as reporting it.
   */
  discoveryUrlOf(repositoryUrl: string): string {
    const base = repositoryUrl.trim().replace(/\/+$/, '');
    return base ? `${base}/.well-known/oauth-authorization-server` : '';
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
    if (!this.available()) return { kind: 'failed', error: ERROR_TEXTS[0][1] };
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
    if (!this.available()) return null;
    const session = await this.browserExtension.oauthSilent(this.request(repositoryUrl)).catch(() => null);
    if (!session?.success || session.signedIn === false) return null;
    return session.accessToken ?? null;
  }

  /**
   * Drop the OAuth session the worker holds. Best-effort: the repository logout stands either way.
   *
   * Deliberately not gated on {@link available}, unlike everything else here. The worker's store
   * outlives any one boot, so a probe that happened to fail on this one would leave a refresh token
   * standing that the next boot — where the probe succeeds — signs the user straight back in with.
   * Whether a token is held is not a question about the repository, and dropping one costs nothing
   * where there is none.
   */
  async logout(repositoryUrl: string): Promise<void> {
    await this.browserExtension.oauthLogout(this.request(repositoryUrl)).catch(() => null);
  }

  /**
   * The address that has to be registered with the client at the IdP, and whether the browser's own
   * `identity` API is what produced it. Null where the worker cannot say — see
   * BrowserExtensionService.oauthRedirectUri.
   */
  redirectUriInUse(repositoryUrl: string): Promise<RedirectUriInUse | null> {
    return this.browserExtension.oauthRedirectUri(this.request(repositoryUrl));
  }

  /**
   * What every message to the worker states — see {@link OAuthRequest}. The repository is passed in
   * rather than read here: which one the panel runs against is AuthService's, and asking it for it
   * would make the two services depend on each other in a circle.
   */
  private request(repositoryUrl: string, provider?: OAuthProvider): OAuthRequest {
    return {
      repositoryUrl,
      clientId: this.clientId,
      scopes: this.scopes,
      registrationId: provider?.registrationId,
    };
  }

  private remember(availability: OAuthAvailability): OAuthAvailability {
    this.availabilityState.set(availability);
    return availability;
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
}
