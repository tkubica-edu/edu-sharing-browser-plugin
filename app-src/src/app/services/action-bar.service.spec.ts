import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Mock, beforeEach, describe, expect, it, vi } from 'vitest';

import { ActionBarService, FooterAction } from './action-bar.service';
import { CurationService } from './curation.service';
import { NavigationService } from './navigation.service';
import { PageRecognitionService } from './page-recognition.service';
import { provideFake } from '../../testing/provide-fake';
import {
  CurationFake,
  NavigationFake,
  PageRecognitionFake,
  aTab,
  anActiveNode,
  fakeCuration,
  fakeNavigation,
  fakePageRecognition,
} from '../../testing/fakes';

/** Where the chat widget keeps the session it would resume — see `util/chat-session.ts`. */
const CHAT_SESSION_KEY = 'boerdi_session_id';

describe('ActionBarService', () => {
  let bar: ActionBarService;
  let curation: CurationFake;
  let navigation: NavigationFake;
  let recognition: PageRecognitionFake;
  /** Stands in for `window.confirm`; answers yes unless a test says otherwise. */
  let asked: Mock<(message?: string) => boolean>;

  beforeEach(() => {
    curation = fakeCuration();
    navigation = fakeNavigation();
    recognition = fakePageRecognition();
    asked = vi.fn(() => true);
    // Through the global rather than through a provider: the service asks the browser directly, and
    // `no-network.setup.ts` puts every stubbed global back after the test.
    vi.stubGlobal('confirm', asked);
    TestBed.configureTestingModule({
      providers: [
        provideFake(CurationService, curation.fake),
        provideFake(NavigationService, navigation.fake),
        provideFake(PageRecognitionService, recognition.fake),
      ],
    });
    bar = TestBed.inject(ActionBarService);
  });

  /** The labels the footer offers right now, in order. */
  function labels(): string[] {
    return bar.actions().map((action) => action.label);
  }

  /** The footer's way on: the action behind the way back, which every step but the last carries. */
  function onwards(): FooterAction {
    const actions = bar.actions();
    expect(actions.length).toBeGreaterThan(1);
    return actions[actions.length - 1];
  }

  /** A screen's save handler, as the metadata step registers one while it is mounted. */
  function aSaveHandler(canSave = true, saves = true) {
    const handler = { save: vi.fn(() => Promise.resolve(saves)), canSave: signal(canSave) };
    bar.registerSaveHandler(handler);
    return handler;
  }

  /** A screen's apply handler, as the steps with an embedded selector register one. */
  function anApplyHandler(canApply = true) {
    const handler = { apply: vi.fn(), canApply: signal(canApply) };
    bar.registerApplyHandler(handler);
    return handler;
  }

  describe('what covers the step`s own actions', () => {
    it('offers nothing while a utility is laid over the step', () => {
      navigation.at('curation');
      navigation.fake.overlaySection.set('settings');

      // The way out of a utility is the icon that opened it, not a footer button.
      expect(bar.actions()).toEqual([]);
    });

    it('offers the way back alone under the login gate', () => {
      navigation.at('quality', 'metadata');
      navigation.fake.sessionGate.set(true);

      expect(labels()).toEqual(['Zurück']);
    });

    it('offers nothing for a section that owns its own primary action', () => {
      navigation.at('menu');
      expect(bar.actions()).toEqual([]);

      navigation.at('login', 'login');
      expect(bar.actions()).toEqual([]);
    });
  });

  it('carries the way back out of every step, as the topbar does', () => {
    navigation.at('editing', 'search');

    const [back] = bar.actions();
    expect(back).toMatchObject({ label: 'Zurück', kind: 'secondary', disabled: false });
    back.run();

    expect(navigation.fake.back).toHaveBeenCalled();
  });

  describe('Inhalt erschließen', () => {
    beforeEach(() => navigation.at('curation', 'curation'));

    it('offers the repeat, for a run that failed or a page that changed', () => {
      expect(labels()).toEqual(['Zurück', 'Erschließung wiederholen']);
      expect(onwards().disabled).toBe(false);
    });

    it('says the run is under way, and refuses a second one meanwhile', () => {
      curation.fake.running.set(true);

      expect(onwards()).toMatchObject({
        label: 'Erschließe… (kann etwas dauern)',
        disabled: true,
      });
    });

    it('leads to the preview once the run answered', async () => {
      await onwards().run();

      expect(curation.fake.analyze).toHaveBeenCalled();
      expect(navigation.fake.go).toHaveBeenCalledWith('curation-preview');
    });

    it('stays where it is on a run that found nothing', async () => {
      curation.fake.analyze.mockResolvedValue(false);

      await onwards().run();

      expect(navigation.fake.go).not.toHaveBeenCalled();
    });
  });

  describe('the preview step, which writes the content', () => {
    beforeEach(() => navigation.at('curation-preview', 'curation-preview'));

    it('hands the picked picture over before the write that carries it', async () => {
      await onwards().run();

      expect(curation.fake.applyDraftValues).toHaveBeenCalled();
      expect(curation.fake.createContent).toHaveBeenCalled();
      const [handover] = curation.fake.applyDraftValues.mock.invocationCallOrder;
      const [written] = curation.fake.createContent.mock.invocationCallOrder;
      expect(handover).toBeLessThan(written);
    });

    it('enters no step behind a write that failed', async () => {
      curation.fake.createContent.mockResolvedValue(false);

      await onwards().run();

      expect(navigation.fake.go).not.toHaveBeenCalled();
    });

    it('asks where the content goes before it is described', async () => {
      navigation.offer('editorial-forward', 'personal-storage', 'flow-choice');

      await onwards().run();

      expect(navigation.fake.go).toHaveBeenCalledWith('editorial-forward');
    });

    it('walks past a filing step that does not apply', async () => {
      navigation.offer('personal-storage', 'flow-choice');

      await onwards().run();

      expect(navigation.fake.go).toHaveBeenCalledWith('personal-storage');
    });

    it('leads to the Qualitätsprüfung where no step in between applies', async () => {
      await onwards().run();

      // Every route through the flow ends there, so it is what a walked-past step falls back to.
      expect(navigation.fake.go).toHaveBeenCalledWith('quality');
    });

    it('says the write is under way, and refuses a second one meanwhile', () => {
      curation.fake.saving.set(true);

      expect(onwards()).toMatchObject({ label: 'Speichern…', disabled: true });
    });
  });

  it('hands over from the Bearbeitungsmodus to the Qualitätsprüfung', () => {
    navigation.at('editing', 'search');

    onwards().run();

    expect(navigation.fake.go).toHaveBeenCalledWith('quality');
  });

  describe('the Qualität view', () => {
    beforeEach(() => {
      navigation.at('quality', 'quality-check');
      navigation.fake.tabs.set([aTab('quality-check'), aTab('metadata', { disabled: true })]);
      navigation.fake.nextTab.set(aTab('metadata', { disabled: true }));
    });

    it('refuses the way on while the criteria are unanswered', () => {
      expect(onwards().disabled).toBe(true);
    });

    it('refuses it while a check is still running', () => {
      curation.fake.qualityCriteriaMet.set(true);
      curation.fake.qualityChecksRunning.set(true);

      // The confirmation records what is on screen, and that is not answered yet.
      expect(onwards().disabled).toBe(true);
    });

    it('offers the confirmation once the criteria allow it', () => {
      curation.fake.qualityCriteriaMet.set(true);

      expect(onwards()).toMatchObject({ label: 'Weiter', disabled: false });
    });

    it('writes the confirmation and walks on to the Metadaten view', async () => {
      curation.fake.qualityCriteriaMet.set(true);

      await onwards().run();

      expect(curation.fake.confirmQuality).toHaveBeenCalled();
      expect(navigation.fake.goNextTab).toHaveBeenCalled();
    });

    it('stays in the view where the repository refused the confirmation', async () => {
      curation.fake.qualityCriteriaMet.set(true);
      curation.refuseQuality();

      await onwards().run();

      expect(curation.fake.confirmQuality).toHaveBeenCalled();
      expect(navigation.fake.goNextTab).not.toHaveBeenCalled();
    });

    it('is the plain step forward once the confirmation was given', async () => {
      curation.fake.qualityConfirmed.set(true);
      navigation.fake.nextTab.set(aTab('metadata'));

      await onwards().run();

      // Returning to the view later still leads on, and does not confirm a second time.
      expect(curation.fake.confirmQuality).not.toHaveBeenCalled();
      expect(navigation.fake.goNextTab).toHaveBeenCalled();
    });

    it('leads nowhere once confirmed while the next view is locked or absent', () => {
      curation.fake.qualityConfirmed.set(true);
      navigation.fake.nextTab.set(null);
      expect(onwards().disabled).toBe(true);

      navigation.fake.nextTab.set(aTab('metadata', { disabled: true }));
      expect(onwards().disabled).toBe(true);
    });
  });

  describe('the Metadaten view, which ends the first big step', () => {
    beforeEach(() => {
      navigation.at('quality', 'metadata');
      navigation.fake.tabs.set([aTab('quality-check'), aTab('metadata')]);
    });

    it('goes back to the Qualität view where there is one', () => {
      const [back] = bar.actions();
      back.run();

      expect(navigation.fake.goTab).toHaveBeenCalledWith('quality-check');
      expect(navigation.fake.back).not.toHaveBeenCalled();
    });

    it('leaves the section altogether where the Qualität view is not on offer', () => {
      navigation.fake.tabs.set([aTab('metadata')]);

      bar.actions()[0].run();

      expect(navigation.fake.goTab).not.toHaveBeenCalled();
      expect(navigation.fake.back).toHaveBeenCalled();
    });

    it('commits the editor`s values through the handler the screen registered', async () => {
      const handler = aSaveHandler();
      navigation.offer('overview');

      await onwards().run();

      expect(handler.save).toHaveBeenCalled();
      expect(curation.fake.saveCollected).not.toHaveBeenCalled();
      expect(navigation.fake.go).toHaveBeenCalledWith('overview');
    });

    it('enters no step behind a commit that failed', async () => {
      aSaveHandler(true, false);

      await onwards().run();

      expect(navigation.fake.go).not.toHaveBeenCalled();
      expect(recognition.fake.invalidate).not.toHaveBeenCalled();
    });

    it('writes what the other steps recorded where no editor is on screen', async () => {
      await onwards().run();

      expect(curation.fake.saveCollected).toHaveBeenCalledWith({ metadata: true, review: true });
    });

    it('leaves the step without a write where the form has nothing to commit', async () => {
      aSaveHandler(false);
      curation.fake.activeNode.set(anActiveNode());

      const action = onwards();
      expect(action.disabled).toBe(false);
      await action.run();

      // Nothing to save, but a content that is written — so the step is over rather than stuck.
      expect(curation.fake.saveCollected).not.toHaveBeenCalled();
      expect(navigation.fake.go).toHaveBeenCalled();
    });

    it('refuses the way on where nothing can be written and no content exists', () => {
      aSaveHandler(false);

      expect(onwards().disabled).toBe(true);
    });

    it('refuses it while a write is in flight', () => {
      curation.fake.saving.set(true);

      expect(onwards()).toMatchObject({ label: 'Speichern…', disabled: true });
    });

    it('asks the recognition again, since the page now has a content', async () => {
      await onwards().run();

      expect(recognition.fake.invalidate).toHaveBeenCalled();
    });

    it('ends on the menu where the Inhaltsübersicht has no content to be about', async () => {
      await onwards().run();

      expect(navigation.fake.go).toHaveBeenCalledWith('menu');
    });
  });

  describe('the handler slots', () => {
    it('lets go of the save handler the screen registered', async () => {
      const handler = aSaveHandler();
      bar.clearSaveHandler(handler);
      navigation.at('quality', 'metadata');

      await onwards().run();

      expect(handler.save).not.toHaveBeenCalled();
      expect(curation.fake.saveCollected).toHaveBeenCalled();
    });

    it('keeps the handler in place when an earlier screen clears its own', async () => {
      const gone = aSaveHandler();
      const current = aSaveHandler();
      bar.clearSaveHandler(gone);
      navigation.at('quality', 'metadata');

      await onwards().run();

      // A screen mounting before the previous one unmounts must not take the new one's slot with it.
      expect(current.save).toHaveBeenCalled();
    });

    it('does the same for the apply handler', () => {
      const gone = anApplyHandler();
      const current = anApplyHandler();
      bar.clearApplyHandler(gone);
      navigation.at('select-collection', 'select-collection');

      onwards().run();

      expect(current.apply).toHaveBeenCalled();
    });
  });

  describe('An Redaktionen weiterleiten', () => {
    beforeEach(() => navigation.at('editorial-forward', 'editorial-forward'));

    it('writes what the step picked and leads on', async () => {
      navigation.offer('personal-storage');

      await onwards().run();

      expect(curation.fake.saveCollected).toHaveBeenCalled();
      expect(navigation.fake.go).toHaveBeenCalledWith('personal-storage');
    });

    it('enters no step behind a write that failed', async () => {
      curation.fake.saveCollected.mockResolvedValue(false);

      await onwards().run();

      expect(navigation.fake.go).not.toHaveBeenCalled();
    });

    it('leads to the choice of process where the other filing does not apply', async () => {
      navigation.offer('flow-choice');

      await onwards().run();

      expect(navigation.fake.go).toHaveBeenCalledWith('flow-choice');
    });
  });

  describe('Persönliche Ablage', () => {
    beforeEach(() => navigation.at('personal-storage', 'personal-storage'));

    it('takes over a ticked collection on the way on, since the step has no confirmation', async () => {
      const handler = anApplyHandler();

      await onwards().run();

      expect(handler.apply).toHaveBeenCalled();
      expect(curation.fake.saveCollected).toHaveBeenCalled();
    });

    it('passes the step as it stands where nothing was ticked', async () => {
      const handler = anApplyHandler(false);

      await onwards().run();

      expect(handler.apply).not.toHaveBeenCalled();
      // The content is filed in the folder alone, so the step still writes and leads on.
      expect(curation.fake.saveCollected).toHaveBeenCalled();
      expect(navigation.fake.go).toHaveBeenCalledWith('quality');
    });

    it('is offered without a selector on screen at all', async () => {
      expect(onwards().disabled).toBe(false);

      await onwards().run();

      expect(curation.fake.saveCollected).toHaveBeenCalled();
    });
  });

  describe('the steps whose way on belongs to their own screen', () => {
    it('opens the marked process of the Prüfprozess choice', () => {
      navigation.at('flow-choice', 'flow-choice');
      const handler = anApplyHandler();

      expect(onwards()).toMatchObject({ label: 'Weiter', disabled: false });
      onwards().run();

      expect(handler.apply).toHaveBeenCalled();
    });

    it('refuses the way on while no process is marked', () => {
      navigation.at('flow-choice', 'flow-choice');
      anApplyHandler(false);

      expect(onwards().disabled).toBe(true);
    });

    it('refuses it with no screen registered at all', () => {
      navigation.at('flow-choice', 'flow-choice');

      expect(onwards().disabled).toBe(true);
    });

    it('takes over the collection the embedded selector holds', () => {
      navigation.at('select-collection', 'select-collection');
      const handler = anApplyHandler();

      expect(onwards()).toMatchObject({ label: 'Sammlung übernehmen', disabled: false });
      onwards().run();

      expect(handler.apply).toHaveBeenCalled();
    });

    it('refuses the takeover while nothing is picked', () => {
      navigation.at('select-collection', 'select-collection');
      anApplyHandler(false);

      expect(onwards().disabled).toBe(true);
    });
  });

  describe('the KI-Qualitätsprüfung', () => {
    beforeEach(() => {
      navigation.at('ai-quality', 'ai-quality');
      localStorage.setItem(CHAT_SESSION_KEY, 'session-7');
    });

    /** Both halves of the check answered: the criteria judged and the metadata confirmed. */
    function answered(): void {
      curation.fake.qualityCriteriaJudged.set(true);
      curation.fake.qualityMetadataEnriched.set(true);
    }

    it('closes a finished check without asking anything', async () => {
      answered();

      await onwards().run();

      expect(asked).not.toHaveBeenCalled();
      expect(curation.fake.confirmQuality).toHaveBeenCalled();
    });

    it('stays open even where a step is unanswered, and says what closing costs', async () => {
      const action = onwards();
      expect(action.disabled).toBe(false);

      await action.run();

      expect(asked).toHaveBeenCalledOnce();
      expect(asked.mock.calls[0][0]).toContain('noch nicht abgeschlossen');
      expect(curation.fake.confirmQuality).toHaveBeenCalled();
    });

    it('writes nothing where the question was answered with no', async () => {
      asked.mockReturnValue(false);

      await onwards().run();

      expect(curation.fake.confirmQuality).not.toHaveBeenCalled();
      expect(navigation.fake.go).not.toHaveBeenCalled();
    });

    it('asks about the proposal where only the assistant`s report is missing', async () => {
      curation.fake.qualityCriteriaJudged.set(true);
      curation.fake.qualityMetadataProposed.set(true);

      await onwards().run();

      expect(asked.mock.calls[0][0]).toContain('vorgeschlagenen Werte übernehmen');
      // Answering it is the decision the assistant never reported.
      expect(curation.fake.reportMetadataEnriched).toHaveBeenCalled();
    });

    it('takes no proposal over where the criteria are still unjudged', async () => {
      curation.fake.qualityMetadataProposed.set(true);

      await onwards().run();

      expect(asked.mock.calls[0][0]).toContain('noch nicht abgeschlossen');
      expect(curation.fake.reportMetadataEnriched).not.toHaveBeenCalled();
    });

    it('ends the conversation and leaves the flow once the confirmation held', async () => {
      answered();
      navigation.offer('overview');

      await onwards().run();

      // Left in local storage it would be resumed by the next chat that opens.
      expect(localStorage.getItem(CHAT_SESSION_KEY)).toBeNull();
      expect(recognition.fake.invalidate).toHaveBeenCalled();
      expect(navigation.fake.go).toHaveBeenCalledWith('overview');
    });

    it('keeps the step open where the repository refused the confirmation', async () => {
      answered();
      curation.refuseQuality();

      await onwards().run();

      expect(localStorage.getItem(CHAT_SESSION_KEY)).toBe('session-7');
      expect(navigation.fake.go).not.toHaveBeenCalled();
    });

    it('offers the way back alone once the check is confirmed', () => {
      curation.fake.qualityConfirmed.set(true);

      expect(labels()).toEqual(['Zurück']);
    });

    it('says the write is under way, and refuses a second one meanwhile', () => {
      curation.fake.saving.set(true);

      expect(onwards()).toMatchObject({ label: 'Speichern…', disabled: true });
    });
  });

  it('offers the one way out of the Inhaltsübersicht', () => {
    navigation.at('overview', 'preview');

    const actions = bar.actions();
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ label: 'Zurück zum Hauptmenü', kind: 'secondary' });
    actions[0].run();

    expect(navigation.fake.openMenu).toHaveBeenCalled();
  });
});
