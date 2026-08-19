import { ChangeDetectionStrategy, Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { APP_CONFIG } from '../../../config';
import { IconDirective } from '../../../directives/icon.directive';
import { AuthService } from '../../../services/auth.service';
import { ChatSkillService, MasterSkillSetting } from '../../../services/chat-skill.service';
import { ChatStyleService } from '../../../services/chat-style.service';
import { CollectionRecommendationService } from '../../../services/collection-recommendation.service';
import { ContextRefreshService } from '../../../services/context-refresh.service';
import { DebugService } from '../../../services/debug.service';
import { DevModeService } from '../../../services/dev-mode.service';
import { ContentJudgeService } from '../../../services/content-judge.service';
import { QualityJudgeService } from '../../../services/quality-judge.service';
import { configuredSchemes } from '../../../util/quality-schemes';

// Repository configuration plus the two development switches. Changing the URL requires a reload,
// because the API library freezes its rootUrl at bootstrap (see AuthService).
@Component({
  selector: 'es-settings-screen',
  imports: [FormsModule, IconDirective],
  templateUrl: './settings-screen.component.html',
  styleUrl: './settings-screen.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SettingsScreenComponent implements OnDestroy {
  protected readonly auth = inject(AuthService);
  protected readonly debug = inject(DebugService);
  protected readonly devMode = inject(DevModeService);
  protected readonly chatStyle = inject(ChatStyleService);
  protected readonly chatSkill = inject(ChatSkillService);
  protected readonly recommendations = inject(CollectionRecommendationService);
  protected readonly qualityJudge = inject(QualityJudgeService);
  protected readonly contentJudge = inject(ContentJudgeService);

  /** Whether the credential is legible on screen; masked until it is asked for. */
  protected readonly basicAuthVisible = signal(false);

  /**
   * The schemes a judgement asks for, as its description lists them — read from the same derivation the
   * request itself uses, so the listing cannot state something the judge is not doing.
   */
  protected readonly contentJudgeSchemes = configuredSchemes().schemes;

  /**
   * The checks the measurement is asked for, as its description lists them. Read from the rules rather than
   * written into the text, because the rules are also what the request asks for — a listing written by hand
   * would state something the service is not doing.
   */
  protected readonly metalookupChecks = APP_CONFIG.qualityMetalookupRules;

  private readonly contextRefresh = inject(ContextRefreshService);

  protected readonly repositoryUrl = signal(this.auth.repositoryUrl());
  /** True once the field was edited, so the "required" hint only shows after a change. */
  protected readonly touched = signal(false);

  protected readonly missingUrl = computed(() => this.touched() && !this.repositoryUrl().trim());

  /** Set by every setting, so leaving without having changed anything costs no requests. */
  private changed = false;

  /**
   * Which of the folded sections is open, if any. The settings the panel is opened for are the ones at
   * the top; what these two hold is tuning, and shown as a heading until it is asked for. One at a time,
   * so the screen stays as short as it is when both are closed.
   */
  protected readonly openSection = signal<'recommendation' | 'quality' | null>(null);

  protected toggleSection(section: 'recommendation' | 'quality'): void {
    this.openSection.update((open) => (open === section ? null : section));
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

  protected setContentJudgeAuth(credential: string): void {
    void this.contentJudge.setBasicAuth(credential);
  }

  protected toggleBasicAuthVisible(): void {
    this.basicAuthVisible.update((visible) => !visible);
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
  protected setDevMode(enabled: boolean): void {
    this.changed = true;
    void this.devMode.setEnabled(enabled);
  }

  protected setDevGenerate(id: string): void {
    this.changed = true;
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
}
