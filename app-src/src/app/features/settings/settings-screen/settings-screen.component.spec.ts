import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  AuthFake,
  BrowserExtensionFake,
  ChatSkillFake,
  ChatStyleFake,
  ContentJudgeFake,
  ContextRefreshFake,
  CurationFake,
  DebugFake,
  DevModeFake,
  NostrForwardFake,
  OAuthFake,
  QualityJudgeFake,
  RecommendationsFake,
  RepositoryVersionFake,
  ThemeFake,
  WebComponentFake,
  aDiscovery,
  anActiveNode,
  fakeAuth,
  fakeBrowserExtension,
  fakeChatSkill,
  fakeChatStyle,
  fakeContentJudge,
  fakeContextRefresh,
  fakeCuration,
  fakeDebug,
  fakeDevMode,
  fakeNostrForward,
  fakeOAuth,
  fakeQualityJudge,
  fakeRecommendations,
  fakeRepositoryVersion,
  fakeTheme,
  fakeWebComponent,
} from '../../../../testing/fakes';
import { provideFake } from '../../../../testing/provide-fake';
import { APP_CONFIG } from '../../../config';
import { configuredSchemes } from '../../../util/quality-schemes';
import { AuthService } from '../../../services/auth.service';
import { BrowserExtensionCustomWebComponentService } from '../../../services/browser-extension-custom-web-component.service';
import { BrowserExtensionService } from '../../../services/browser-extension.service';
import { ChatSkillService } from '../../../services/chat-skill.service';
import { ChatStyleService } from '../../../services/chat-style.service';
import { CollectionRecommendationService } from '../../../services/collection-recommendation.service';
import { ContentJudgeService } from '../../../services/content-judge.service';
import { ContextRefreshService } from '../../../services/context-refresh.service';
import { CurationService } from '../../../services/curation.service';
import { DebugService } from '../../../services/debug.service';
import { DevModeService } from '../../../services/dev-mode.service';
import { NostrForwardService } from '../../../services/nostr-forward.service';
import { OAuthService } from '../../../services/oauth.service';
import { QualityJudgeService } from '../../../services/quality-judge.service';
import { RepositoryVersionService } from '../../../services/repository-version.service';
import { ThemeService } from '../../../services/theme.service';
import { SettingsScreenComponent } from './settings-screen.component';

/** The folded sections, by the heading each is reached under. */
const SSO = 'SSO-Anmeldung';
const DEVELOPER = 'Entwickler-Optionen';
const AI = 'KI- und Chatbot-Optionen';
const RECOMMENDATION = 'Zugehörige Sammlungen empfehlen';
const QUALITY = 'Qualitätsprüfung';
const NOSTR = 'Nostr-Relay';

/**
 * The panel's settings. Every setting here is written as it is edited rather than on a save, so what the
 * screen is asserted on is which service a change reached and what it left behind — plus the two states
 * around that: which of the folded sections says it holds something changed, and whether leaving the
 * screen re-answers the checks a change may have invalidated.
 *
 * The screen injects fifteen services and shows different cards depending on one of them, so the fakes are
 * built per test and the WLO switch is stated at render time.
 */
describe('SettingsScreenComponent', () => {
  let fixture: ComponentFixture<SettingsScreenComponent>;
  let auth: AuthFake;
  let extension: BrowserExtensionFake;
  let wlo: WebComponentFake;
  let devMode: DevModeFake;
  let debug: DebugFake;
  let chatStyle: ChatStyleFake;
  let chatSkill: ChatSkillFake;
  let recommendations: RecommendationsFake;
  let qualityJudge: QualityJudgeFake;
  let contentJudge: ContentJudgeFake;
  let repositoryVersion: RepositoryVersionFake;
  let theme: ThemeFake;
  let nostr: NostrForwardFake;
  let oauth: OAuthFake;
  let contextRefresh: ContextRefreshFake;
  let curation: CurationFake;

  beforeEach(() => {
    auth = fakeAuth();
    extension = fakeBrowserExtension();
    wlo = fakeWebComponent(true);
    devMode = fakeDevMode();
    debug = fakeDebug();
    chatStyle = fakeChatStyle();
    chatSkill = fakeChatSkill();
    recommendations = fakeRecommendations();
    qualityJudge = fakeQualityJudge();
    contentJudge = fakeContentJudge();
    repositoryVersion = fakeRepositoryVersion();
    theme = fakeTheme();
    nostr = fakeNostrForward();
    oauth = fakeOAuth();
    contextRefresh = fakeContextRefresh();
    curation = fakeCuration();
    TestBed.configureTestingModule({
      imports: [SettingsScreenComponent],
      providers: [
        provideFake(AuthService, auth.fake),
        provideFake(BrowserExtensionService, extension.fake),
        provideFake(BrowserExtensionCustomWebComponentService, wlo.fake),
        provideFake(DevModeService, devMode.fake),
        provideFake(DebugService, debug.fake),
        provideFake(ChatStyleService, chatStyle.fake),
        provideFake(ChatSkillService, chatSkill.fake),
        provideFake(CollectionRecommendationService, recommendations.fake),
        provideFake(QualityJudgeService, qualityJudge.fake),
        provideFake(ContentJudgeService, contentJudge.fake),
        provideFake(RepositoryVersionService, repositoryVersion.fake),
        provideFake(ThemeService, theme.fake),
        provideFake(NostrForwardService, nostr.fake),
        provideFake(OAuthService, oauth.fake),
        provideFake(ContextRefreshService, contextRefresh.fake),
        provideFake(CurationService, curation.fake),
      ],
    });
  });

  async function render(): Promise<void> {
    fixture = TestBed.createComponent(SettingsScreenComponent);
    fixture.detectChanges();
    await settle();
  }

  /** Let whatever was just set reach the DOM. */
  async function settle(): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const text = (): string => fixture.nativeElement.textContent ?? '';

  const query = <T extends Element>(selector: string): T | null =>
    fixture.nativeElement.querySelector(selector);

  /** One of the cards' heads, by the heading it carries. */
  function head(heading: string): HTMLButtonElement {
    const heads: HTMLButtonElement[] = Array.from(
      fixture.nativeElement.querySelectorAll('button.section-head'),
    );
    const found = heads.find((entry) => (entry.textContent ?? '').includes(heading));
    if (!found) throw new Error(`no section head for ${heading} in: ${heads.map((h) => h.textContent)}`);
    return found;
  }

  /** Fold a section open, or the open one shut. */
  async function open(heading: string): Promise<void> {
    head(heading).click();
    await settle();
  }

  /** What a folded section says it holds away from the defaults, or null where it says nothing. */
  function pill(heading: string): string | null {
    return head(heading).querySelector('.section-count')?.textContent?.trim() ?? null;
  }

  /** A button by its label, within a card or anywhere on the screen. */
  function button(label: string, within: Element = fixture.nativeElement): HTMLButtonElement {
    const buttons: HTMLButtonElement[] = Array.from(within.querySelectorAll('button'));
    const found = buttons.find((entry) => (entry.textContent ?? '').trim().includes(label));
    if (!found) throw new Error(`no button labelled ${label}`);
    return found;
  }

  /**
   * The card one of the folded sections is shown in. Needed wherever a label stands in more than one of
   * them: „Auf Standard zurücksetzen" is offered by the repository, the KI card and the proposal alike.
   */
  function card(heading: string): HTMLElement {
    return head(heading).closest('section')!;
  }

  /** A checkbox by the text of the label it sits in. */
  function box(label: string): HTMLInputElement {
    const labels: HTMLLabelElement[] = Array.from(
      fixture.nativeElement.querySelectorAll('label.check'),
    );
    const found = labels.find((entry) => (entry.textContent ?? '').includes(label));
    if (!found) throw new Error(`no checkbox labelled ${label}`);
    return found.querySelector('input')!;
  }

  /** Tick or untick it the way a person does. */
  async function tick(label: string, checked = true): Promise<void> {
    const input = box(label);
    input.checked = checked;
    input.dispatchEvent(new Event('change'));
    await settle();
  }

  /** Type into a field, which is what every text and number setting here is written by. */
  async function type(selector: string, value: string): Promise<void> {
    const input = query<HTMLInputElement>(selector)!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await settle();
  }

  /** Choose from a select — the one setting offered as a list rather than a field. */
  async function choose(selector: string, value: string): Promise<void> {
    const select = query<HTMLSelectElement>(selector)!;
    select.value = value;
    select.dispatchEvent(new Event('change'));
    await settle();
  }

  /** One of a segmented control's buttons, by the group it belongs to and its label. */
  function segment(group: string, label: string): HTMLButtonElement {
    const buttons: HTMLButtonElement[] = Array.from(
      fixture.nativeElement.querySelectorAll(`[aria-labelledby="${group}"] .seg-btn`),
    );
    const found = buttons.find((entry) => (entry.textContent ?? '').trim() === label);
    if (!found) throw new Error(`no segment ${label} in ${group}`);
    return found;
  }

  describe('the repository', () => {
    it('takes the address over as it is typed, since there is no save to press', async () => {
      await render();

      await type('#repo-url', 'https://other.example/edu-sharing');

      expect(auth.fake.setRepositoryUrl).toHaveBeenCalledWith('https://other.example/edu-sharing');
    });

    it('calls the field required once it was emptied, and not before', async () => {
      await render();

      expect(text()).not.toContain('Die Repository-URL ist erforderlich');

      await type('#repo-url', '   ');

      expect(text()).toContain('Die Repository-URL ist erforderlich');
      expect(query('#repo-url')!.classList.contains('invalid')).toBe(true);
    });

    it('puts the shipped address back', async () => {
      await render();

      button('Auf Standard zurücksetzen').click();
      await settle();

      expect(auth.fake.setRepositoryUrl).toHaveBeenCalledWith(APP_CONFIG.defaultRepositoryUrl);
      expect(query<HTMLInputElement>('#repo-url')!.value).toBe(APP_CONFIG.defaultRepositoryUrl);
    });

    it('names the version the repository answered', async () => {
      repositoryVersion.runs('11.0.1');
      await render();

      expect(text()).toContain('edu-sharing-Version: 11.0.1');
    });

    it('says it is still asking while nothing was answered', async () => {
      await render();

      expect(text()).toContain('edu-sharing-Version wird abgefragt');
    });

    it('reports what the repository refused with, rather than a version', async () => {
      repositoryVersion.unknown('HTTP 401');
      await render();

      expect(text()).toContain('edu-sharing-Version unbekannt');
      expect(text()).toContain('HTTP 401');
    });

    it('says the packaged elements are left out where the version is not one they were built for', async () => {
      repositoryVersion.unsupported('10.1');
      await render();

      expect(text()).toContain('Diese Version wird nicht unterstützt');
      expect(text()).toContain('Version 11');
    });

    it('offers to take a changed address over at once, and does', async () => {
      auth.fake.needsReload.set(true);
      await render();

      button('Jetzt übernehmen').click();
      await settle();

      expect(contextRefresh.fake.refresh).toHaveBeenCalled();
    });

    it('offers that only while a change is outstanding', async () => {
      await render();

      expect(text()).not.toContain('Jetzt übernehmen');
    });
  });

  describe('leaving the screen', () => {
    it('re-answers the checks when a setting was changed that a step hangs on', async () => {
      await render();
      await open(NOSTR);
      await tick('Nostr-Relay verwenden', false);

      fixture.destroy();

      expect(contextRefresh.fake.refresh).toHaveBeenCalled();
    });

    it('costs nothing when nothing was changed', async () => {
      await render();

      fixture.destroy();

      expect(contextRefresh.fake.refresh).not.toHaveBeenCalled();
    });

    it('costs nothing for a setting no condition depends on', async () => {
      await render();
      segment('theme-label', 'Dunkel').click();
      await settle();
      await open(AI);
      await tick('Chat-Darstellung anpassen', false);

      fixture.destroy();

      expect(theme.fake.setSetting).toHaveBeenCalledWith('dark');
      expect(chatStyle.fake.setOverridesEnabled).toHaveBeenCalledWith(false);
      expect(contextRefresh.fake.refresh).not.toHaveBeenCalled();
    });
  });

  describe('the folded sections', () => {
    it('shows every heading and nothing under it', async () => {
      await render();

      for (const heading of [SSO, DEVELOPER, AI, RECOMMENDATION, QUALITY, NOSTR]) {
        expect(head(heading).getAttribute('aria-expanded')).toBe('false');
      }
      expect(query('#nostr-relay')).toBeNull();
    });

    it('opens one at a time, so the screen stays as short as it is folded', async () => {
      await render();

      await open(NOSTR);
      expect(head(NOSTR).getAttribute('aria-expanded')).toBe('true');

      await open(QUALITY);
      expect(head(QUALITY).getAttribute('aria-expanded')).toBe('true');
      expect(head(NOSTR).getAttribute('aria-expanded')).toBe('false');
    });

    it('folds the open one shut again', async () => {
      await render();

      await open(NOSTR);
      await open(NOSTR);

      expect(head(NOSTR).getAttribute('aria-expanded')).toBe('false');
    });

    it('says per section how much of it stands away from the defaults', async () => {
      void wlo.fake.setEnabled(false);
      devMode.faking(3);
      debug.simulating(2);
      chatStyle.fake.changedSettings.set(1);
      chatSkill.fake.changedSettings.set(1);
      recommendations.fake.changedSettings.set(2);
      qualityJudge.fake.changedSettings.set(1);
      contentJudge.fake.changedSettings.set(1);
      nostr.fake.changedSettings.set(1);
      // The WLO switch is off, so the three cards behind it are gone with their pills — what is left is
      // the developer options it stands in, and the relay outside the gate.
      await render();

      expect(pill(DEVELOPER)).toBe('6 geändert');
      expect(pill(NOSTR)).toBe('1 geändert');
    });

    it('sums the KI card over both services it holds and the quality card over both judges', async () => {
      chatStyle.fake.changedSettings.set(1);
      chatSkill.fake.changedSettings.set(1);
      qualityJudge.fake.changedSettings.set(2);
      contentJudge.fake.changedSettings.set(1);
      recommendations.fake.changedSettings.set(1);
      await render();

      expect(pill(AI)).toBe('2 geändert');
      expect(pill(QUALITY)).toBe('3 geändert');
      expect(pill(RECOMMENDATION)).toBe('1 geändert');
    });

    it('says nothing where a section holds only the defaults', async () => {
      await render();

      for (const heading of [DEVELOPER, AI, RECOMMENDATION, QUALITY, NOSTR]) {
        expect(pill(heading)).toBeNull();
      }
    });

    it('carries no pill on the SSO section, which holds no setting to change', async () => {
      await render();

      expect(head(SSO).querySelector('.section-count')).toBeNull();
    });
  });

  describe('the SSO section', () => {
    it('names the address the repository is asked under', async () => {
      await render();
      await open(SSO);

      expect(text()).toContain(oauth.fake.discoveryUrlOf(auth.fake.repositoryUrl()));
    });

    it('asks the worker for the redirect address when it is opened, not on boot', async () => {
      oauth.redirectsTo('https://abc.chromiumapp.org/');
      await render();

      expect(oauth.fake.redirectUriInUse).not.toHaveBeenCalled();

      await open(SSO);

      expect(oauth.fake.redirectUriInUse).toHaveBeenCalledWith(auth.fake.repositoryUrl());
      expect(text()).toContain('https://abc.chromiumapp.org/');
      expect(text()).toContain('von diesem Browser selbst vergeben');
    });

    it('asks again on every open, since the repository it is derived from may have changed', async () => {
      oauth.redirectsTo('https://abc.chromiumapp.org/');
      await render();

      await open(SSO);
      await open(SSO);
      await open(SSO);

      expect(oauth.fake.redirectUriInUse).toHaveBeenCalledTimes(2);
    });

    it('says which address a browser without the identity API is watched for on', async () => {
      oauth.redirectsTo('https://repo.example/edu-sharing/oauth/extension-callback', false);
      await render();
      await open(SSO);

      expect(text()).toContain('keine identity-API (Safari)');
    });

    it('reports the authorization server the repository publishes', async () => {
      oauth.federates(aDiscovery({ issuer: 'https://idp.example/realms/wlo' }));
      await render();
      await open(SSO);

      expect(text()).toContain('https://idp.example/realms/wlo');
    });

    it('calls a repository that publishes none the normal case rather than an error', async () => {
      oauth.federatesNothing('HTTP 404');
      await render();
      await open(SSO);

      expect(text()).toContain('Das ist der Normalfall und kein Fehler');
      expect(text()).toContain('HTTP 404');
    });

    it('says nothing about a repository nobody asked yet', async () => {
      await render();
      await open(SSO);

      expect(text()).toContain('Noch nicht gefragt');
    });

    it('asks the repository again on request', async () => {
      await render();
      await open(SSO);

      button('Erneut fragen').click();
      await settle();

      expect(oauth.fake.probe).toHaveBeenCalledWith(auth.fake.repositoryUrl());
    });

    it('refuses a second ask while one is running', async () => {
      oauth.fake.probing.set(true);
      await render();
      await open(SSO);

      expect(button('Frage…').disabled).toBe(true);
    });

    it('names the cookies a drop removed, and offers the boot that follows it', async () => {
      await render();
      await open(SSO);

      expect(text()).not.toContain('Panel neu laden');

      button('Session-Cookie entfernen').click();
      await settle();

      expect(extension.fake.dropSessionCookies).toHaveBeenCalledWith(auth.fake.repositoryUrl());
      expect(text()).toContain('JSESSIONID');
      expect(text()).toContain('Panel neu laden');
    });

    it('says as much where there were no cookies for the address', async () => {
      extension.dropsNothing();
      await render();
      await open(SSO);

      button('Session-Cookie entfernen').click();
      await settle();

      expect(text()).toContain('Es gab keine Cookies für diese Adresse');
    });

    it('reports a drop that did not happen', async () => {
      extension.refusesDrop('NO_COOKIES_PERMISSION');
      await render();
      await open(SSO);

      button('Session-Cookie entfernen').click();
      await settle();

      expect(text()).toContain('Fehlgeschlagen');
      expect(text()).toContain('NO_COOKIES_PERMISSION');
    });

    // `reloadPanel()` is deliberately not driven: it calls `location.reload()`, which jsdom does not
    // implement — the boot after a drop is what the manual checklist covers.
  });

  describe('the panel’s colours', () => {
    it('offers the three states, the browser’s own first', async () => {
      await render();

      const labels: string[] = Array.from(
        fixture.nativeElement.querySelectorAll('[aria-labelledby="theme-label"] .seg-btn'),
      ).map((entry) => (entry as HTMLElement).textContent?.trim() ?? '');
      expect(labels).toEqual(['System folgen', 'Hell', 'Dunkel']);
    });

    it('marks the state that holds', async () => {
      theme = fakeTheme('dark');
      TestBed.overrideProvider(ThemeService, { useValue: theme.fake });
      await render();

      expect(segment('theme-label', 'Dunkel').getAttribute('aria-pressed')).toBe('true');
      expect(segment('theme-label', 'System folgen').getAttribute('aria-pressed')).toBe('false');
    });

    it('takes a chosen state over, and shows it as the one that holds', async () => {
      await render();

      segment('theme-label', 'Hell').click();
      await settle();

      expect(theme.fake.setSetting).toHaveBeenCalledWith('light');
      expect(segment('theme-label', 'Hell').getAttribute('aria-pressed')).toBe('true');
    });
  });

  describe('the developer options', () => {
    it('lets the WLO extensions of the repository be switched off, which a step hangs on', async () => {
      await render();
      await open(DEVELOPER);

      await tick('WLO-Funktionen verwenden', false);

      expect(wlo.fake.enabled()).toBe(false);
      expect(pill(DEVELOPER)).toBe('1 geändert');
      fixture.destroy();
      expect(contextRefresh.fake.refresh).toHaveBeenCalled();
    });

    it('says where a repository offers no WLO extensions for the switch to let count', async () => {
      wlo = fakeWebComponent(false);
      TestBed.overrideProvider(BrowserExtensionCustomWebComponentService, { useValue: wlo.fake });
      await render();
      await open(DEVELOPER);

      expect(text()).toContain('Dieses Repositorium bietet keine WLO-Funktionen an');
    });

    it('shows the faked run’s fields only while the mode is on', async () => {
      await render();
      await open(DEVELOPER);

      expect(query('#dev-generate')).toBeNull();

      await tick('Dev-Modus: KI-Antworten faken');

      expect(devMode.fake.setEnabled).toHaveBeenCalledWith(true);
      expect(query('#dev-generate')).not.toBeNull();
    });

    it('lets go of the held content when the mode is switched, since it came out of a run that is over', async () => {
      curation.fake.activeNode.set(anActiveNode('node-7'));
      await render();
      await open(DEVELOPER);

      await tick('Dev-Modus: KI-Antworten faken');

      expect(curation.fake.startNew).toHaveBeenCalled();
    });

    it('lets go of unsaved work along with it, a faked run’s result being a test result', async () => {
      curation.fake.hasUnsavedWork.set(true);
      await render();
      await open(DEVELOPER);

      await tick('Dev-Modus: KI-Antworten faken');

      expect(curation.fake.startNew).toHaveBeenCalled();
    });

    it('has nothing to let go of where the panel holds no content', async () => {
      await render();
      await open(DEVELOPER);

      await tick('Dev-Modus: KI-Antworten faken');

      expect(curation.fake.startNew).not.toHaveBeenCalled();
    });

    it('offers the fixtures a faked run answers with, and takes the chosen one over', async () => {
      devMode.faking();
      curation.fake.activeNode.set(anActiveNode('node-7'));
      await render();
      await open(DEVELOPER);

      const options: string[] = Array.from(
        fixture.nativeElement.querySelectorAll('#dev-generate option'),
      ).map((entry) => (entry as HTMLOptionElement).value);
      expect(options).toEqual(devMode.fake.generateFixtures.map((entry) => entry.id));

      await choose('#dev-generate', 'optik');

      expect(devMode.fake.setGenerate).toHaveBeenCalledWith('optik');
      expect(curation.fake.startNew).toHaveBeenCalled();
    });

    it('does nothing at all where the fixture chosen is the one that already holds', async () => {
      devMode.faking();
      curation.fake.activeNode.set(anActiveNode('node-7'));
      await render();
      await open(DEVELOPER);

      await choose('#dev-generate', devMode.fake.generate());

      expect(devMode.fake.setGenerate).not.toHaveBeenCalled();
      expect(curation.fake.startNew).not.toHaveBeenCalled();
    });

    it('offers the test collection only where the WLO check that reads it exists', async () => {
      devMode.faking();
      void wlo.fake.setEnabled(false);
      await render();
      await open(DEVELOPER);

      expect(query('#dev-collection')).toBeNull();

      await tick('WLO-Funktionen verwenden');

      expect(query('#dev-collection')).not.toBeNull();
      await type('#dev-collection', 'collection-3');
      expect(devMode.fake.setCollectionId).toHaveBeenCalledWith('collection-3');
    });

    it('asks for the node a run stands in for only while it writes nothing', async () => {
      devMode.faking();
      await render();
      await open(DEVELOPER);

      expect(query('#dev-node')).toBeNull();

      await tick('Nichts ins Repositorium schreiben');

      expect(devMode.fake.setSkipWrites).toHaveBeenCalledWith(true);
      expect(query('#dev-node')).not.toBeNull();

      await type('#dev-node', 'node-42');
      expect(devMode.fake.setNodeId).toHaveBeenCalledWith('node-42');
    });

    it('shows the simulated document’s node only while the events are simulated', async () => {
      await render();
      await open(DEVELOPER);

      expect(query('#debug-node')).toBeNull();

      await tick('Debug-Modus: OnlyOffice-Events simulieren');

      expect(debug.fake.setEnabled).toHaveBeenCalledWith(true);
      expect(query('#debug-node')).not.toBeNull();

      await type('#debug-node', 'node-9');
      expect(debug.fake.setDocumentNodeId).toHaveBeenCalledWith('node-9');
    });

    it('sends the event the host plugin would send', async () => {
      debug.simulating();
      await render();
      await open(DEVELOPER);

      button('PREVIEW_NODE simulieren').click();
      await settle();

      expect(debug.fake.emitPreviewNode).toHaveBeenCalled();
    });
  });

  describe('the KI and chatbot options', () => {
    it('is not offered at a repository without the WLO extensions, the chat being one of them', async () => {
      wlo = fakeWebComponent(false);
      TestBed.overrideProvider(BrowserExtensionCustomWebComponentService, { useValue: wlo.fake });
      await render();

      expect(text()).not.toContain(AI);
      expect(text()).not.toContain(RECOMMENDATION);
      expect(text()).not.toContain('MetalookUp');
    });

    it('switches the corrections to the chat’s presentation off', async () => {
      await render();
      await open(AI);

      await tick('Chat-Darstellung anpassen', false);

      expect(chatStyle.fake.setOverridesEnabled).toHaveBeenCalledWith(false);
      expect(box('Chat-Darstellung anpassen').checked).toBe(false);
    });

    it('offers the three states of the master skill, the operator’s first', async () => {
      await render();
      await open(AI);

      const labels: string[] = Array.from(
        fixture.nativeElement.querySelectorAll('[aria-labelledby="master-skill-label"] .seg-btn'),
      ).map((entry) => (entry as HTMLElement).textContent?.trim() ?? '');
      expect(labels).toEqual(['Vorgabe des Betreibers', 'An', 'Aus']);
      expect(segment('master-skill-label', 'Vorgabe des Betreibers').getAttribute('aria-pressed')).toBe(
        'true',
      );
    });

    it('says it for this embedding, whatever the operator configured', async () => {
      await render();
      await open(AI);

      segment('master-skill-label', 'Aus').click();
      await settle();

      expect(chatSkill.fake.setMasterSkill).toHaveBeenCalledWith('off');
      expect(segment('master-skill-label', 'Aus').getAttribute('aria-pressed')).toBe('true');
    });

    it('resets what the whole card holds, not the one group the button stands under', async () => {
      await render();
      await open(AI);

      button('Auf Standard zurücksetzen', card(AI)).click();
      await settle();

      expect(chatStyle.fake.resetToDefault).toHaveBeenCalled();
      expect(chatSkill.fake.resetToDefault).toHaveBeenCalled();
    });
  });

  describe('the collection proposal', () => {
    it('takes over how many keywords are asked with', async () => {
      await render();
      await open(RECOMMENDATION);

      await type('#rec-keywords', '5');

      expect(recommendations.fake.setMaxKeywords).toHaveBeenCalledWith(5);
    });

    it('takes over what a keyword has to score', async () => {
      await render();
      await open(RECOMMENDATION);

      await type('#rec-score', '0.5');

      expect(recommendations.fake.setMinScore).toHaveBeenCalledWith(0.5);
    });

    it('leaves an emptied field alone, which is a value halfway typed rather than a setting', async () => {
      await render();
      await open(RECOMMENDATION);

      await type('#rec-keywords', '');
      await type('#rec-score', '');

      expect(recommendations.fake.setMaxKeywords).not.toHaveBeenCalled();
      expect(recommendations.fake.setMinScore).not.toHaveBeenCalled();
      expect(recommendations.fake.maxKeywords()).toBe(3);
    });

    it('puts both numbers back to what the panel ships with', async () => {
      recommendations.fake.maxKeywords.set(9);
      await render();
      await open(RECOMMENDATION);

      button('Auf Standard zurücksetzen', card(RECOMMENDATION)).click();
      await settle();

      expect(recommendations.fake.resetToDefaults).toHaveBeenCalled();
      expect(query<HTMLInputElement>('#rec-keywords')!.value).toBe('3');
    });
  });

  describe('the quality check’s services', () => {
    it('switches the measurement off, which leaves the criteria that live on it unanswered', async () => {
      await render();
      await open(QUALITY);

      await tick('MetalookUp: Inhalt messen', false);

      expect(qualityJudge.fake.setMetalookupEnabled).toHaveBeenCalledWith(false);
    });

    it('names the checks the measurement asks for, read from the rules the request is built from', async () => {
      await render();
      await open(QUALITY);

      for (const rule of APP_CONFIG.qualityMetalookupRules) {
        expect(text()).toContain(rule.label);
        expect(text()).toContain(rule.feature);
      }
    });

    it('takes over the credential the guarded deployment is answered with', async () => {
      await render();
      await open(QUALITY);

      await type('#cj-auth', 'user:secret');

      expect(contentJudge.fake.setBasicAuth).toHaveBeenCalledWith('user:secret');
    });

    it('masks the credential until it is asked for', async () => {
      await render();
      await open(QUALITY);

      expect(query('#cj-auth')!.getAttribute('type')).toBe('password');

      query<HTMLButtonElement>('.reveal')!.click();
      await settle();

      expect(query('#cj-auth')!.getAttribute('type')).toBe('text');
      expect(query('.reveal')!.getAttribute('aria-pressed')).toBe('true');
    });

    it('leaves the judgement unavailable while there is no credential to reach it with', async () => {
      contentJudge.fake.credentialSet.set(false);
      await render();
      await open(QUALITY);

      expect(box('ContentJudge: Inhalt per LLM bewerten').disabled).toBe(true);
    });

    it('switches the judgement on once there is one', async () => {
      await render();
      await open(QUALITY);

      await tick('ContentJudge: Inhalt per LLM bewerten');

      expect(qualityJudge.fake.setContentJudgeEnabled).toHaveBeenCalledWith(true);
    });

    it('names the schemes a judgement asks for, read from the same derivation the request uses', async () => {
      await render();
      await open(QUALITY);

      const listed: string[] = Array.from(
        fixture.nativeElement.querySelectorAll('.desc-list code'),
      ).map((entry) => (entry as HTMLElement).textContent ?? '');
      expect(listed).toEqual([...configuredSchemes().schemes]);
    });
  });

  describe('the nostr relay', () => {
    it('is offered at every repository, an AMB record belonging to none', async () => {
      wlo = fakeWebComponent(false);
      TestBed.overrideProvider(BrowserExtensionCustomWebComponentService, { useValue: wlo.fake });
      await render();

      expect(text()).toContain(NOSTR);
    });

    it('drops the address and the identity with the connection itself', async () => {
      await render();
      await open(NOSTR);

      expect(query('#nostr-relay')).not.toBeNull();

      await tick('Nostr-Relay verwenden', false);

      expect(nostr.fake.setEnabled).toHaveBeenCalledWith(false);
      expect(query('#nostr-relay')).toBeNull();
    });

    it('takes over the relay a publication goes to', async () => {
      await render();
      await open(NOSTR);

      await type('#nostr-relay', 'wss://relay.example');

      expect(nostr.fake.setRelayUrl).toHaveBeenCalledWith('wss://relay.example');
    });

    it('shows the relay the panel ships with as what an empty field falls back to', async () => {
      await render();
      await open(NOSTR);

      expect(query<HTMLInputElement>('#nostr-relay')!.placeholder).toBe(nostr.fake.relayUrl());
      expect(text()).toContain(APP_CONFIG.nostrRelayUrl);
    });

    it('says what an address that cannot be a relay is missing', async () => {
      nostr.fake.relayUsable.set(false);
      await render();
      await open(NOSTR);

      expect(text()).toContain('wird über WebSocket angesprochen');
      expect(query('#nostr-relay')!.classList.contains('invalid')).toBe(true);
    });

    it('names the key this installation publishes under, which is what a relay knows it by', async () => {
      await render();
      await open(NOSTR);

      expect(text()).toContain('npub1beispiel');
    });

    it('says when the key will be made where there is none yet', async () => {
      nostr.fake.npub.set(null);
      await render();
      await open(NOSTR);

      expect(text()).toContain('Noch kein Schlüssel vorhanden');
    });
  });
});
