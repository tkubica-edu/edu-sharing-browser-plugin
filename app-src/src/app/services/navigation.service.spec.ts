import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthService } from './auth.service';
import { BrowserExtensionCustomWebComponentService } from './browser-extension-custom-web-component.service';
import { ConditionsService } from './conditions.service';
import { CurationService } from './curation.service';
import { DebugService } from './debug.service';
import { HistoryService } from './history.service';
import { NavigationService } from './navigation.service';
import { NostrForwardService } from './nostr-forward.service';
import { PageRecognitionService } from './page-recognition.service';
import { provideFake } from '../../testing/provide-fake';
import {
  AuthFake,
  CurationFake,
  HistoryFake,
  NostrForwardFake,
  PageRecognitionFake,
  WebComponentFake,
  anActiveNode,
  fakeAuth,
  fakeCuration,
  fakeDebug,
  fakeHistory,
  fakeNostrForward,
  fakePageRecognition,
  fakeWebComponent,
} from '../../testing/fakes';

describe('NavigationService', () => {
  let navigation: NavigationService;
  let conditions: ConditionsService;
  let auth: AuthFake;
  let curation: CurationFake;
  let webComponent: WebComponentFake;
  let history: HistoryFake;
  let nostr: NostrForwardFake;
  let recognition: PageRecognitionFake;

  /**
   * The real `ConditionsService` and the real `BusyService` are used rather than fakes of them: both are
   * derivations over the fakes below — the conditions every section's predicate is decided against, and
   * „a write is in flight". Faking them would move the registry's own rules into this file.
   */
  beforeEach(() => {
    auth = fakeAuth();
    curation = fakeCuration();
    webComponent = fakeWebComponent();
    history = fakeHistory();
    nostr = fakeNostrForward();
    recognition = fakePageRecognition();
    TestBed.configureTestingModule({
      providers: [
        provideFake(AuthService, auth.fake),
        provideFake(CurationService, curation.fake),
        provideFake(DebugService, fakeDebug().fake),
        provideFake(BrowserExtensionCustomWebComponentService, webComponent.fake),
        provideFake(HistoryService, history.fake),
        provideFake(NostrForwardService, nostr.fake),
        provideFake(PageRecognitionService, recognition.fake),
      ],
    });
    conditions = TestBed.inject(ConditionsService);
    navigation = TestBed.inject(NavigationService);
    auth.signIn();
    // The recognition has answered: while it has not, half the menu is disabled for that reason
    // alone, which is a state of its own rather than the one most of these tests are about.
    conditions.recognizingContent.set(false);
  });

  /** A content the flow works on, so its steps apply. */
  function contentInHand(): void {
    curation.fake.activeNode.set(anActiveNode());
    curation.fake.hasEditableMetadata.set(true);
  }

  /** The repository runs the browser extension custom web component, which several steps belong to. */
  function withWebComponent(): void {
    webComponent.fake.offeredByRepository.set(true);
  }

  /** The ids the menu offers, in the order it lists them. */
  function menuIds(): string[] {
    return navigation.menuSections().map((section) => section.id);
  }

  /** One menu entry as the menu renders it. */
  function entry(id: string) {
    const found = navigation.menuSections().find((section) => section.id === id);
    expect(found, `no menu entry for ${id}`).toBeDefined();
    return found!;
  }

  describe('what the menu lists', () => {
    it('offers nothing to do while nothing is logged in', () => {
      auth.fake.authorized.set(false);

      expect(menuIds()).toEqual([]);
    });

    it('lists the entries in registry order', () => {
      expect(menuIds()).toEqual([
        'content-options',
        'add-content',
        'curation',
        'own-content',
        'history',
      ]);
    });

    it('drops the WLO steps where the settings switch the repository variable off', async () => {
      contentInHand();
      withWebComponent();
      // Steps of the flow rather than menu entries, so they are asked for by id.
      const wloSteps = ['flow-choice', 'ai-quality', 'select-collection', 'ai-assistant'] as const;
      for (const id of wloSteps) expect(navigation.isVisible(id), id).toBe(true);
      expect(navigation.isTabVisible('quality', 'quality-check')).toBe(true);

      await webComponent.fake.setEnabled(false);

      // Every step that belongs to the browser extension custom web component goes with it, leaving a core
      // panel behind — which is what makes the ordinary flow walkable against a WLO repository.
      for (const id of wloSteps) expect(navigation.isVisible(id), id).toBe(false);
      // The Qualitätsprüfung stays, as the Metadaten view it is in a core panel — its criteria tab is what
      // belongs to the web component, and the gate that tab put in front of the metadata goes with it.
      expect(navigation.isVisible('quality')).toBe(true);
      expect(navigation.isTabVisible('quality', 'quality-check')).toBe(false);
      expect(navigation.isTabDisabled('quality', 'metadata')).toBe(false);
    });

    it('keeps the utilities out of the menu and in the topbar', () => {
      expect(menuIds()).not.toContain('settings');
      expect(navigation.topbarSections().map((section) => section.id)).toEqual(['settings']);
    });

    it('offers the utilities to a panel that is not logged in at all', () => {
      auth.fake.authorized.set(false);

      // Einstellungen is where the repository is configured, so it can never be behind a login.
      expect(navigation.topbarSections()).toHaveLength(1);
    });

    it('resolves an entry that names its own state', () => {
      expect(entry('content-options')).toMatchObject({
        label: 'Kein Inhalt erkannt',
        disabled: true,
        loading: false,
      });
      expect(entry('content-options').disabledHint).toContain('Inhalt erschließen');
    });

    it('reports the recognition that is still under way', () => {
      conditions.recognizingContent.set(true);

      expect(entry('content-options')).toMatchObject({
        label: 'Geöffneter Inhalt wird erkannt …',
        disabled: true,
        loading: true,
      });
    });

    it('opens the entry once a content was recognised', () => {
      curation.fake.activeNode.set(anActiveNode());

      expect(entry('content-options')).toMatchObject({
        label: 'Inhalt erkannt',
        disabled: false,
        loading: false,
      });
    });

    it('says why nothing is erschlossen on the repository`s own pages', () => {
      conditions.activeUrl.set('https://repo.example/edu-sharing/components/search');

      expect(entry('curation').disabled).toBe(true);
      expect(entry('curation').disabledHint).toContain('Edu-Sharing-Seiten');
    });

    it('says why a page whose content was detected is not erschlossen again', () => {
      curation.detect();

      expect(entry('curation').disabled).toBe(true);
      expect(entry('curation').disabledHint).toContain('bereits erschlossen');
    });
  });

  describe('entering a section', () => {
    it('opens one that applies, with its first sub step', () => {
      navigation.go('history');

      expect(navigation.section()).toBe('history');
      expect(navigation.screen()).toBe('history');
    });

    it('opens it straight at a named sub step', () => {
      contentInHand();
      withWebComponent();
      curation.fake.qualityCriteriaMet.set(true);

      navigation.go('quality', { tab: 'metadata' });

      expect(navigation.screen()).toBe('metadata');
    });

    it('opens the forwarding without the web component, for the relay it also offers', () => {
      contentInHand();

      navigation.go('editorial-forward');

      // The editorial teams belong to the web component, the nostr relay to nobody — so the step
      // applies wherever a content can be forwarded at all, see model/navigation.ts.
      expect(navigation.section()).toBe('editorial-forward');
    });

    it('opens the publication step for a saved content', () => {
      contentInHand();

      navigation.go('nostr-forward');

      expect(navigation.section()).toBe('nostr-forward');
    });

    it('refuses the publication step where the settings switched the relay off', () => {
      contentInHand();
      nostr.disable();

      navigation.go('nostr-forward');

      expect(navigation.section()).toBe('menu');
    });

    it('refuses the forwarding where neither a team nor the relay is left to forward to', () => {
      contentInHand();
      nostr.disable();

      navigation.go('editorial-forward');

      // Without the web component there are no editorial teams, and with the relay switched off there
      // is no second target either — the step would be a heading over an empty list.
      expect(navigation.section()).toBe('menu');
    });

    it('keeps the forwarding where the teams stand for the switched-off relay', () => {
      contentInHand();
      withWebComponent();
      nostr.disable();

      navigation.go('editorial-forward');

      expect(navigation.section()).toBe('editorial-forward');
    });

    it('refuses the collection pick without the web component, since there are no groups to pick in', () => {
      contentInHand();

      navigation.go('select-collection');

      expect(navigation.section()).toBe('menu');
    });

    it('refuses a section that does not apply', () => {
      navigation.go('quality');

      // No content to be about, so the step does not exist to be entered.
      expect(navigation.section()).toBe('menu');
    });

    it('refuses a disabled one as firmly, so no caller routes around the menu row', () => {
      conditions.recognizingContent.set(true);

      navigation.go('curation');

      expect(navigation.section()).toBe('menu');
    });

    it('refuses every move while a write is in flight', () => {
      curation.fake.saving.set(true);

      navigation.go('history');

      expect(navigation.section()).toBe('menu');
    });

    it('makes the step it left the one back returns to', () => {
      navigation.go('history');
      contentInHand();
      navigation.go('overview');
      navigation.back();

      expect(navigation.section()).toBe('history');
    });

    it('counts re-entering the open section as a tab change rather than as a step', () => {
      contentInHand();
      navigation.go('history');
      navigation.go('overview');
      navigation.go('overview', { tab: 'usages' });

      expect(navigation.screen()).toBe('usages');
      navigation.back();
      // One step behind the Übersicht, not two.
      expect(navigation.section()).toBe('history');
    });
  });

  describe('naming a step from outside it', () => {
    it('names a section by the title it is open under, not by the label it is entered by', () => {
      // The Inhaltsoptionen are entered from a row that reports the *finding* ("Inhalt erkannt").
      expect(navigation.stepLabel({ section: 'content-options', tab: 'content-options' })).toBe(
        'Inhaltsoptionen',
      );
    });

    it('names the sub step behind it where the section has more than one to tell apart', () => {
      contentInHand();
      withWebComponent();

      expect(navigation.stepLabel({ section: 'quality', tab: 'metadata' })).toBe(
        'Qualitätsprüfung – Metadaten',
      );
    });

    it('leaves the sub step out where the section is that one step', () => {
      contentInHand();

      // Without the web component the Qualitätsprüfung is the Metadaten view alone, so naming both
      // would say the same thing twice.
      expect(navigation.stepLabel({ section: 'quality', tab: 'metadata' })).toBe('Qualitätsprüfung');
    });

    it('says nothing about a step the registry does not know', () => {
      expect(navigation.stepLabel(null)).toBe('');
    });
  });

  describe('walking back', () => {
    it('returns to the sub step that was open there', () => {
      contentInHand();
      navigation.go('overview', { tab: 'share' });
      navigation.go('history');
      navigation.back();

      expect(navigation.section()).toBe('overview');
      expect(navigation.screen()).toBe('share');
    });

    it('ends at the main menu once the trail is used up', () => {
      navigation.go('history');
      navigation.back();

      expect(navigation.section()).toBe('menu');
    });

    it('walks past a step that must not be re-entered', () => {
      navigation.go('curation');
      contentInHand();
      navigation.go('curation-preview');
      navigation.back();

      // Entering "Inhalt erschließen" starts the run, so stepping back into it would run it again.
      expect(navigation.section()).toBe('menu');
    });

    it('walks past a step that no longer applies', () => {
      contentInHand();
      withWebComponent();
      // The choice of process, which exists only where there are two processes to choose between.
      navigation.go('flow-choice');
      navigation.go('quality');
      webComponent.fake.offeredByRepository.set(false);

      navigation.back();

      expect(navigation.section()).toBe('menu');
    });

    it('refuses to walk while a write is in flight', () => {
      navigation.go('history');
      curation.fake.saving.set(true);

      navigation.back();

      expect(navigation.section()).toBe('history');
    });

    it('asks the open step before leaving it, and stays where the answer is no', () => {
      navigation.go('history');
      const guard = vi.fn(() => false);
      navigation.registerLeaveGuard(guard);

      navigation.back();

      expect(guard).toHaveBeenCalled();
      expect(navigation.section()).toBe('history');
    });

    it('walks on where the step lets it', () => {
      navigation.go('history');
      navigation.registerLeaveGuard(() => true);

      navigation.back();

      expect(navigation.section()).toBe('menu');
    });

    it('asks nothing once the screen that registered the guard has cleared it', () => {
      navigation.go('history');
      const guard = vi.fn(() => false);
      navigation.registerLeaveGuard(guard);
      navigation.clearLeaveGuard(guard);

      navigation.back();

      expect(guard).not.toHaveBeenCalled();
      expect(navigation.section()).toBe('menu');
    });

    it('keeps the guard of the screen that is mounted when an earlier one clears its own', () => {
      navigation.go('history');
      const gone = () => false;
      const current = vi.fn(() => false);
      navigation.registerLeaveGuard(gone);
      navigation.registerLeaveGuard(current);
      navigation.clearLeaveGuard(gone);

      navigation.back();

      expect(current).toHaveBeenCalled();
      expect(navigation.section()).toBe('history');
    });

    it('lets go of a picked content when stepping back to a view that needs none', () => {
      contentInHand();
      navigation.go('history');
      navigation.go('overview');

      navigation.back();

      expect(curation.fake.releaseChosenContent).toHaveBeenCalled();
    });

    it('holds on to it where the step behind is about a content itself', () => {
      contentInHand();
      navigation.go('overview');
      navigation.go('editing');

      navigation.back();

      expect(navigation.section()).toBe('overview');
      expect(curation.fake.releaseChosenContent).not.toHaveBeenCalled();
    });
  });

  describe('a utility laid over the step', () => {
    it('covers the step without leaving it', () => {
      navigation.go('history');

      navigation.toggle('settings');

      expect(navigation.overlaySection()).toBe('settings');
      expect(navigation.section()).toBe('history');
    });

    it('is taken off again by the icon that opened it', () => {
      navigation.toggle('settings');
      navigation.toggle('settings');

      expect(navigation.overlaySection()).toBeNull();
    });

    it('is closed by the back button, which leaves no step behind', () => {
      navigation.go('history');
      navigation.toggle('settings');

      navigation.back();

      expect(navigation.overlaySection()).toBeNull();
      expect(navigation.section()).toBe('history');
    });

    it('asks the step underneath nothing — it is not being left', () => {
      navigation.go('history');
      const guard = vi.fn(() => false);
      navigation.registerLeaveGuard(guard);
      navigation.toggle('settings');

      navigation.back();

      expect(guard).not.toHaveBeenCalled();
    });

    it('has nothing left to cover once another step is entered', () => {
      navigation.toggle('settings');

      navigation.go('history');

      expect(navigation.overlaySection()).toBeNull();
    });

    it('is refused while a write is in flight', () => {
      curation.fake.saving.set(true);

      navigation.toggle('settings');

      expect(navigation.overlaySection()).toBeNull();
    });

    it('shows its own first sub step, and no tab bar', () => {
      contentInHand();
      withWebComponent();
      navigation.go('overview');
      navigation.toggle('settings');

      expect(navigation.overlayScreen()).toBe('settings');
      expect(navigation.showTabs()).toBe(false);
    });

    it('is what the heading names, since it is what the person is looking at', () => {
      navigation.go('history');
      navigation.toggle('settings');

      expect(navigation.title()).toBe('Einstellungen');
      expect(navigation.backLabel()).toBe('Zurück zu „Verlauf“');
    });
  });

  describe('the sub steps of a section', () => {
    beforeEach(() => {
      contentInHand();
      withWebComponent();
      navigation.go('quality');
    });

    it('offers the views in the order they are worked through', () => {
      expect(navigation.tabs().map((tab) => tab.id)).toEqual(['quality-check', 'metadata']);
      expect(navigation.showTabs()).toBe(true);
    });

    it('shows the step that is still to come as locked rather than as absent', () => {
      expect(navigation.tabs()[1]).toMatchObject({ id: 'metadata', disabled: true });
      expect(navigation.screen()).toBe('quality-check');
    });

    it('opens it once its gate is answered', () => {
      curation.fake.qualityCriteriaMet.set(true);

      navigation.goTab('metadata');

      expect(navigation.screen()).toBe('metadata');
    });

    it('refuses a locked one', () => {
      navigation.goTab('metadata');

      expect(navigation.screen()).toBe('quality-check');
    });

    it('refuses a tab change while a write is in flight', () => {
      curation.fake.qualityCriteriaMet.set(true);
      curation.fake.saving.set(true);

      navigation.goTab('metadata');

      expect(navigation.screen()).toBe('quality-check');
    });

    it('advances to the next one', () => {
      curation.fake.qualityCriteriaMet.set(true);

      expect(navigation.nextTab()?.id).toBe('metadata');
      navigation.goNextTab();

      expect(navigation.screen()).toBe('metadata');
    });

    it('has nothing after the last one', () => {
      curation.fake.qualityCriteriaMet.set(true);
      navigation.goTab('metadata');

      expect(navigation.nextTab()).toBeNull();
    });

    it('strands nobody on a view that locked again', () => {
      curation.fake.qualityCriteriaMet.set(true);
      navigation.goTab('metadata');

      curation.fake.qualityCriteriaMet.set(false);

      expect(navigation.screen()).toBe('quality-check');
    });

    it('is one view alone without the web component, and then carries no tab bar', () => {
      webComponent.fake.offeredByRepository.set(false);

      expect(navigation.tabs().map((tab) => tab.id)).toEqual(['metadata']);
      expect(navigation.showTabs()).toBe(false);
      // The gate belongs to the Qualität view, which is not there to answer it.
      expect(navigation.screen()).toBe('metadata');
    });
  });

  describe('the views of the Inhaltsübersicht', () => {
    beforeEach(() => {
      contentInHand();
      navigation.go('overview');
    });

    it('reports the Interaktionen for the relay alone, without the editorial teams', () => {
      expect(navigation.tabs().map((tab) => tab.id)).toContain('interactions');
    });

    it('drops them where there is neither a team nor a relay to report about', () => {
      nostr.disable();

      expect(navigation.tabs().map((tab) => tab.id)).not.toContain('interactions');
    });

    it('keeps them for the teams where the relay is switched off', () => {
      withWebComponent();
      nostr.disable();

      expect(navigation.tabs().map((tab) => tab.id)).toContain('interactions');
    });
  });

  describe('what the chrome renders', () => {
    it('names the main menu and offers no way back out of it', () => {
      expect(navigation.title()).toBe('Hauptmenü');
      expect(navigation.showBack()).toBe(false);
    });

    it('heads a section by the name it carries while it is open', () => {
      curation.fake.activeNode.set(anActiveNode());
      navigation.go('content-options');

      // Entered as the recognition's report, open as the choice of what to do with the finding.
      expect(navigation.title()).toBe('Inhaltsoptionen');
      expect(navigation.showBack()).toBe(true);
    });

    it('offers the way back out of a utility laid over the menu', () => {
      navigation.toggle('settings');

      expect(navigation.showBack()).toBe(true);
    });

    it('names where the way back leads', () => {
      navigation.go('history');
      contentInHand();
      navigation.go('overview');

      expect(navigation.backLabel()).toBe('Zurück zu „Verlauf“');
    });

    it('names the main menu where the trail is used up', () => {
      navigation.go('history');

      expect(navigation.backLabel()).toBe('Zurück zum Hauptmenü');
    });

    it('names the step the walk back actually reaches, not the one it skips', () => {
      contentInHand();
      withWebComponent();
      navigation.go('flow-choice');
      navigation.go('quality');
      webComponent.fake.offeredByRepository.set(false);

      expect(navigation.backLabel()).toBe('Zurück zum Hauptmenü');
    });
  });

  describe('the login gate in front of a step', () => {
    beforeEach(() => {
      contentInHand();
      // Authorized by the embedding host: the panel may act, but there is no person behind the session.
      auth.authorizeWithoutSession();
    });

    it('stands where the step asks for a session this one is not', () => {
      curation.fake.agentEditWindowClosed.set(true);
      navigation.go('quality');

      expect(navigation.sessionGate()).toBe(true);
    });

    it('is absent while the content can still be written without one', () => {
      navigation.go('quality');

      expect(navigation.sessionGate()).toBe(false);
    });

    it('is absent for a session of the user`s own', () => {
      curation.fake.agentEditWindowClosed.set(true);
      auth.signIn();
      navigation.go('quality');

      expect(navigation.sessionGate()).toBe(false);
    });
  });

  describe('landing', () => {
    it('sends a panel with no login to the login', () => {
      auth.fake.authorized.set(false);

      navigation.land();

      expect(navigation.section()).toBe('login');
    });

    it('lands on the main menu, and asks the recognition again on the way', () => {
      navigation.go('history');

      navigation.land();

      expect(navigation.section()).toBe('menu');
      expect(curation.fake.releaseChosenContent).toHaveBeenCalled();
      expect(recognition.fake.recognizeIfStale).toHaveBeenCalled();
    });

    it('leaves nothing behind to walk back to', () => {
      navigation.go('history');
      navigation.land();

      navigation.back();

      expect(navigation.section()).toBe('menu');
    });

    it('re-lands where the open step falls away underneath the user', () => {
      contentInHand();
      navigation.go('overview');
      TestBed.tick();

      curation.fake.activeNode.set(null);
      curation.fake.hasEditableMetadata.set(false);
      TestBed.tick();

      expect(navigation.section()).toBe('menu');
    });

    it('re-lands where the open step locks underneath the user', () => {
      navigation.go('curation');
      TestBed.tick();

      // A content was detected for this page while "Inhalt erschließen" was open.
      curation.detect();
      TestBed.tick();

      expect(navigation.section()).toBe('menu');
    });
  });

  it('tells the history where the user stands, and which content it is about', () => {
    curation.fake.activeNode.set(anActiveNode('node-7'));
    navigation.go('content-options');

    TestBed.tick();

    expect(history.fake.noteStep).toHaveBeenCalledWith(
      { section: 'content-options', tab: 'content-options' },
      'node-7',
    );
  });

  describe('the questions the screens ask about a section they are not on', () => {
    it('answers whether a section applies', () => {
      expect(navigation.isVisible('history')).toBe(true);
      expect(navigation.isVisible('quality')).toBe(false);

      contentInHand();
      expect(navigation.isVisible('quality')).toBe(true);
    });

    it('answers whether one of its sub steps applies', () => {
      contentInHand();

      expect(navigation.isTabVisible('quality', 'quality-check')).toBe(false);
      withWebComponent();
      expect(navigation.isTabVisible('quality', 'quality-check')).toBe(true);
    });

    it('counts a sub step that does not exist as absent', () => {
      expect(navigation.isTabVisible('history', 'metadata')).toBe(false);
    });

    it('answers whether one of its sub steps is locked', () => {
      contentInHand();
      withWebComponent();

      expect(navigation.isTabDisabled('quality', 'metadata')).toBe(true);
      curation.fake.qualityCriteriaMet.set(true);
      expect(navigation.isTabDisabled('quality', 'metadata')).toBe(false);
    });

    it('counts a sub step that does not exist as open — there is nothing to gate', () => {
      expect(navigation.isTabDisabled('history', 'metadata')).toBe(false);
    });
  });

  describe('a step carried across a page change', () => {
    it('states what entering a section would leave behind, without entering it', () => {
      contentInHand();
      navigation.go('history');

      expect(navigation.stateFor('overview', { tab: 'usages' })).toEqual({
        section: 'overview',
        tab: 'usages',
        trail: [{ section: 'menu', tab: null }, { section: 'history', tab: 'history' }],
      });
      // Stated rather than performed.
      expect(navigation.section()).toBe('history');
    });

    it('states nothing for a section that could not be entered', () => {
      expect(navigation.stateFor('quality')).toBeNull();
    });

    it('offers a remembered step that can be opened again', () => {
      contentInHand();

      expect(navigation.resumableStep({ section: 'overview', tab: 'share' })).toMatchObject({
        section: 'overview',
        tab: 'share',
      });
    });

    it('offers no step that must not be re-entered', () => {
      expect(navigation.resumableStep({ section: 'curation', tab: 'curation' })).toBeNull();
    });

    it('offers no step that this page has nothing to show for', () => {
      expect(navigation.resumableStep({ section: 'overview', tab: 'preview' })).toBeNull();
      expect(navigation.resumableStep(null)).toBeNull();
    });

    it('reopens the step with the steps behind it', () => {
      contentInHand();

      expect(
        navigation.resume({ section: 'overview', tab: 'usages' }, [
          { section: 'menu', tab: null },
          { section: 'history', tab: 'history' },
        ]),
      ).toBe(true);
      expect(navigation.section()).toBe('overview');
      expect(navigation.screen()).toBe('usages');

      navigation.back();
      expect(navigation.section()).toBe('history');
    });

    it('comes back as close as the page allows where the step itself is gone', () => {
      contentInHand();
      withWebComponent();

      const resumed = navigation.resume({ section: 'ai-quality', tab: 'ai-quality' }, [
        { section: 'menu', tab: null },
        { section: 'history', tab: 'history' },
        { section: 'flow-choice', tab: 'flow-choice' },
      ]);
      expect(resumed).toBe(true);
      expect(navigation.section()).toBe('ai-quality');

      // The same page without the web component: neither step belongs to it any more.
      webComponent.fake.offeredByRepository.set(false);
      navigation.land();

      expect(
        navigation.resume({ section: 'ai-quality', tab: 'ai-quality' }, [
          { section: 'menu', tab: null },
          { section: 'history', tab: 'history' },
          { section: 'flow-choice', tab: 'flow-choice' },
        ]),
      ).toBe(true);
      expect(navigation.section()).toBe('history');
    });

    it('opens nothing where no step of the trail survived', () => {
      expect(
        navigation.resume({ section: 'overview', tab: 'preview' }, [{ section: 'menu', tab: null }]),
      ).toBe(false);
      expect(navigation.section()).toBe('menu');
    });
  });
});
