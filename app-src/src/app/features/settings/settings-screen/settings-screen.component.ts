import { ChangeDetectionStrategy, Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { APP_CONFIG } from '../../../config';
import { IconDirective } from '../../../directives/icon.directive';
import { AuthService } from '../../../services/auth.service';
import { BrowserExtensionCustomWebComponentService } from '../../../services/browser-extension-custom-web-component.service';
import { ChatSkillService, MasterSkillSetting } from '../../../services/chat-skill.service';
import { ChatStyleService } from '../../../services/chat-style.service';
import { CollectionRecommendationService } from '../../../services/collection-recommendation.service';
import { ContextRefreshService } from '../../../services/context-refresh.service';
import { CurationService } from '../../../services/curation.service';
import { DebugService } from '../../../services/debug.service';
import { DevModeService } from '../../../services/dev-mode.service';
import { NostrForwardService } from '../../../services/nostr-forward.service';
import { RedirectUriInUse } from '../../../services/browser-extension.service';
import { OAuthService } from '../../../services/oauth.service';
import { ContentJudgeService } from '../../../services/content-judge.service';
import { QualityJudgeService } from '../../../services/quality-judge.service';
import { ThemeService, ThemeSetting } from '../../../services/theme.service';
import { configuredSchemes } from '../../../util/quality-schemes';

/**
 * The folded groups of this screen, in the order they are offered and each named after what it holds: the
 * switches that stand in for a service while the panel is developed on, the chat and what the KI is told
 * with it, what a collection proposal is derived from, which services a quality check asks, and where the
 * forwarding step publishes AMB records to.
 */
type SettingsSection = 'developer' | 'sso' | 'ai' | 'recommendation' | 'quality' | 'nostr';

/**
 * The sections that hold settings at all, and can therefore say how many of them stand away from the
 * shipped defaults. *SSO-Anmeldung* holds none: it reports what the repository answered.
 */
type TunableSection = Exclude<SettingsSection, 'sso'>;

// Repository configuration plus the settings of the chat, the checks and the two development switches.
// Changing the URL requires a reload, because the API library freezes its rootUrl at bootstrap (see
// AuthService).
@Component({
  selector: 'es-settings-screen',
  imports: [FormsModule, IconDirective],
  templateUrl: './settings-screen.component.html',
  styleUrl: './settings-screen.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SettingsScreenComponent implements OnDestroy {
  protected readonly auth = inject(AuthService);
  /**
   * Whether this is a WLO panel, and the switch that decides it along with the repository: the settings that
   * tune the chat, the KI check and the collection proposal configure steps that only exist there, so they are
   * shown only where those steps are — the same statement the registry gates those steps by (see
   * model/navigation.ts). The switch itself stands in the Entwickler-Optionen, which are outside that gate.
   */
  protected readonly wlo = inject(BrowserExtensionCustomWebComponentService);
  protected readonly debug = inject(DebugService);
  protected readonly devMode = inject(DevModeService);
  protected readonly chatStyle = inject(ChatStyleService);
  protected readonly chatSkill = inject(ChatSkillService);
  protected readonly recommendations = inject(CollectionRecommendationService);
  protected readonly qualityJudge = inject(QualityJudgeService);
  protected readonly contentJudge = inject(ContentJudgeService);
  protected readonly theme = inject(ThemeService);
  protected readonly nostr = inject(NostrForwardService);
  protected readonly oauth = inject(OAuthService);

  /** Whether the credential is legible on screen; masked until it is asked for. */
  protected readonly basicAuthVisible = signal(false);

  /**
   * The schemes a judgement asks for, as its description lists them — read from the same derivation the
   * request itself uses, so the listing cannot state something the judge is not doing.
   */
  protected readonly contentJudgeSchemes = configuredSchemes().schemes;

  /** The relay the panel ships with, named where the field says what an empty one falls back to. */
  protected readonly defaultNostrRelayUrl = APP_CONFIG.nostrRelayUrl;

  /**
   * Where the SSO login is looked for, as the worker assembles the address — shown because a
   * repository that answers nothing there is the whole reason the login card asks for a password.
   */
  protected readonly discoveryUrl = computed(() => this.oauth.discoveryUrlOf(this.auth.repositoryUrl()));

  /**
   * The redirect address this browser will actually use, as the background worker reports it, and
   * whether its own `identity` API produced it. Null until it has answered, and where it cannot —
   * outside an extension, or with no repository to derive one from. Shown because it is what has to
   * be registered with the client at the identity provider, and with the `identity` API it is an
   * address the browser makes up that nobody could otherwise look up.
   */
  protected readonly redirectUriInUse = signal<RedirectUriInUse | null>(null);

  /**
   * The checks the measurement is asked for, as its description lists them. Read from the rules rather than
   * written into the text, because the rules are also what the request asks for — a listing written by hand
   * would state something the service is not doing.
   */
  protected readonly metalookupChecks = APP_CONFIG.qualityMetalookupRules;

  private readonly contextRefresh = inject(ContextRefreshService);
  private readonly curation = inject(CurationService);

  protected readonly repositoryUrl = signal(this.auth.repositoryUrl());
  /** True once the field was edited, so the "required" hint only shows after a change. */
  protected readonly touched = signal(false);

  protected readonly missingUrl = computed(() => this.touched() && !this.repositoryUrl().trim());

  /** Set by every setting, so leaving without having changed anything costs no requests. */
  private changed = false;

  /**
   * Which of the folded sections is open, if any. The setting the panel is opened for — the repository —
   * is the one at the top; everything else is tuning of one kind or another and shown as a heading until
   * it is asked for. One at a time, so the screen stays as short as it is with all of them closed.
   */
  protected readonly openSection = signal<SettingsSection | null>(null);

  /**
   * How many settings of each section stand away from what the panel ships with, so a folded section says
   * whether anything in it was touched. Summed from the services rather than compared here: which value a
   * setting has without anybody setting it is the knowledge of whoever holds the setting (see
   * ChatStyleService.changedSettings). Stated per section of this screen, since the sections are how they
   * are grouped for the reader and not how the services are split.
   */
  protected readonly changedPerSection = computed<Record<TunableSection, number>>(() => ({
    developer: this.wlo.changedSettings() + this.devMode.changedSettings() + this.debug.changedSettings(),
    ai: this.chatStyle.changedSettings() + this.chatSkill.changedSettings(),
    recommendation: this.recommendations.changedSettings(),
    quality: this.qualityJudge.changedSettings() + this.contentJudge.changedSettings(),
    nostr: this.nostr.changedSettings()
  }));

  protected toggleSection(section: SettingsSection): void {
    this.openSection.update((open) => (open === section ? null : section));
    // Asked when the section is opened rather than on boot: it costs a round trip to the worker, and
    // it is only ever read here. Re-asked on every open, because the repository it is derived from
    // may have been edited since.
    if (this.openSection() === 'sso') void this.readRedirectUri();
  }

  private async readRedirectUri(): Promise<void> {
    this.redirectUriInUse.set(await this.oauth.redirectUriInUse(this.auth.repositoryUrl()));
  }

  /**
   * Leaving the settings re-runs the checks whose answers the changed settings may have invalidated — the menu the
   * user lands on is built on them, and they are otherwise answered once on boot.
   */
  ngOnDestroy(): void {
    if (this.changed) void this.contextRefresh.refresh();
  }

  protected apply(url: string): void {
    this.repositoryUrl.set(url);
    this.touched.set(true);
    this.changed = true;
    this.auth.setRepositoryUrl(url);
  }

  protected resetToDefault(): void {
    this.apply(APP_CONFIG.defaultRepositoryUrl);
  }

  /** Take the changed repository over right away, instead of leaving it to the screen being left. */
  protected reload(): void {
    void this.contextRefresh.refresh();
  }

  // ---- Collection proposal ------------------------------------------------
  // Written as it is edited, like every other setting here. A field the user has emptied reports no
  // number at all — that is a field halfway through being typed in, not a value, so it is ignored and
  // the setting keeps what it had until a number arrives.

  protected setRecommendationKeywords(count: number | null): void {
    if (typeof count === 'number' && Number.isFinite(count)) {
      void this.recommendations.setMaxKeywords(count);
    }
  }

  protected setRecommendationMinScore(score: number | null): void {
    if (typeof score === 'number' && Number.isFinite(score)) {
      void this.recommendations.setMinScore(score);
    }
  }

  protected resetRecommendation(): void {
    void this.recommendations.resetToDefaults();
  }

  // ---- Quality judges -----------------------------------------------------
  // Which of the two services a quality check asks. Fire-and-forget like the other switches: the signal
  // already carries the new state, and a failed write only means it is not remembered across reloads.

  protected setMetalookup(enabled: boolean): void {
    void this.qualityJudge.setMetalookupEnabled(enabled);
  }

  protected setContentJudge(enabled: boolean): void {
    void this.qualityJudge.setContentJudgeEnabled(enabled);
  }

  /** No condition depends on it, so leaving the settings needs no refresh on its account. */
  protected setChatStyleOverrides(enabled: boolean): void {
    void this.chatStyle.setOverridesEnabled(enabled);
  }

  /**
   * The three states of the panel's colours, in the order they are offered: what the reader already told
   * their browser first, because that is what the panel keeps to unless it is told otherwise.
   */
  protected readonly themeOptions: { value: ThemeSetting; label: string }[] = [
    { value: 'system', label: 'System folgen' },
    { value: 'light', label: 'Hell' },
    { value: 'dark', label: 'Dunkel' }
  ];

  /** Applies at once, and no condition depends on it — so leaving the settings needs no refresh either. */
  protected setTheme(setting: ThemeSetting): void {
    void this.theme.setSetting(setting);
  }

  /**
   * The three states of the master skill, in the order they are offered: the operator's configuration first,
   * because that is what the panel keeps to unless it is told otherwise.
   */
  protected readonly masterSkillOptions: { value: MasterSkillSetting; label: string }[] = [
    { value: 'operator', label: 'Vorgabe des Betreibers' },
    { value: 'on', label: 'An' },
    { value: 'off', label: 'Aus' }
  ];

  /** Like the other chat switches: read as the next conversation's element is created, so no refresh. */
  protected setMasterSkill(setting: MasterSkillSetting): void {
    void this.chatSkill.setMasterSkill(setting);
  }

  /**
   * Put every setting of the KI section back to its default. The button offering it stands at the end of
   * the card and is read as the card's, so it resets what the card holds rather than the one group it is
   * written under — which is also what makes the section's pill go to zero when it is used.
   */
  protected resetAiOptions(): void {
    void this.chatStyle.resetToDefault();
    void this.chatSkill.resetToDefault();
  }

  protected setContentJudgeAuth(credential: string): void {
    void this.contentJudge.setBasicAuth(credential);
  }

  protected toggleBasicAuthVisible(): void {
    this.basicAuthVisible.update((visible) => !visible);
  }

  // ---- SSO (OpenID Connect) -----------------------------------------------
  // Nothing to set: the section reports what the repository answered about its own authorization
  // server, which is what decides whether the login card leads through it (see OAuthService).

  /**
   * Ask the repository again. The one thing worth a button here: the answer is a fact about the
   * repository rather than a setting, so it changes when *it* changes — and having enabled its
   * authorization server, whoever runs it wants to see that without reloading the panel.
   */
  protected probeOAuth(): void {
    void this.oauth.probe(this.auth.repositoryUrl());
  }

  // ---- Nostr relay --------------------------------------------------------
  // Written as it is edited, like every other setting here. An emptied field is not an invalid one: it
  // puts the relay the panel ships with back in force (see NostrForwardService.relayUrl).

  /**
   * Switch the whole nostr connection on or off. Marked as a change, unlike the relay address beside it:
   * which steps the panel offers hangs on it, and the menu that is landed on when the settings are left is
   * built from those (see {@link ngOnDestroy}).
   */
  protected setNostrEnabled(enabled: boolean): void {
    this.changed = true;
    void this.nostr.setEnabled(enabled);
  }

  protected setNostrRelayUrl(url: string): void {
    void this.nostr.setRelayUrl(url);
  }

  protected resetNostrRelayUrl(): void {
    void this.nostr.setRelayUrl('');
  }

  // ---- WLO extensions -----------------------------------------------------

  /**
   * Whether the repository's `browserExtensionCustomWebComponent` variable counts. Marked as a change: which
   * steps the panel offers hangs on it, and the menu that is landed on when the settings are left is built
   * from those (see {@link ngOnDestroy}).
   */
  protected setWloEnabled(enabled: boolean): void {
    this.changed = true;
    void this.wlo.setEnabled(enabled);
  }

  // ---- Debug mode ---------------------------------------------------------
  // Persisting is fire-and-forget: the signal already carries the new state, and a failed write
  // only means the flag is not remembered across reloads.
  protected setDebug(enabled: boolean): void {
    this.changed = true;
    void this.debug.setEnabled(enabled);
  }

  protected setDebugNodeId(nodeId: string): void {
    this.changed = true;
    void this.debug.setDocumentNodeId(nodeId);
  }

  protected simulatePreviewNode(): void {
    this.debug.emitPreviewNode();
  }

  // ---- Dev mode -----------------------------------------------------------

  /**
   * Let go of the content the panel holds, which the switches below have just made a statement about a
   * run that is over: it came out of the fixture that was chosen, or out of faked answers the mode no
   * longer gives. Keeping it would leave *Geöffneter Inhalt* naming the old fixture and take the
   * Erschließung away from the page — the offer is disabled for a page that already has a content.
   * Unsaved work is dropped along with it, since a faked run's result is a test result.
   */
  private releaseFakedRun(): void {
    if (this.curation.activeNode() || this.curation.hasUnsavedWork()) this.curation.startNew();
  }

  protected setDevMode(enabled: boolean): void {
    this.changed = true;
    this.releaseFakedRun();
    void this.devMode.setEnabled(enabled);
  }

  protected setDevGenerate(id: string): void {
    if (id === this.devMode.generate()) return;
    this.changed = true;
    this.releaseFakedRun();
    void this.devMode.setGenerate(id);
  }

  protected setDevCollectionId(id: string): void {
    this.changed = true;
    void this.devMode.setCollectionId(id);
  }

  protected setDevSkipWrites(skip: boolean): void {
    this.changed = true;
    void this.devMode.setSkipWrites(skip);
  }

  protected setDevNodeId(id: string): void {
    this.changed = true;
    void this.devMode.setNodeId(id);
  }
}
