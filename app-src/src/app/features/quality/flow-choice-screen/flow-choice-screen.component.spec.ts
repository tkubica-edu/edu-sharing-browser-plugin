import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CurationFake, NavigationFake, fakeCuration, fakeNavigation } from '../../../../testing/fakes';
import { provideFake } from '../../../../testing/provide-fake';
import { ActionBarService, ApplyHandler } from '../../../services/action-bar.service';
import { CurationService } from '../../../services/curation.service';
import { NavigationService } from '../../../services/navigation.service';
import { FlowChoiceScreenComponent } from './flow-choice-screen.component';

/**
 * „Prüfprozess auswählen". The screen collects a choice and nothing else — marking a process does not
 * start it; the footer's way on opens whichever is marked, which is why the handler it registers is as
 * much its subject as the cards are.
 */
describe('FlowChoiceScreenComponent', () => {
  let fixture: ComponentFixture<FlowChoiceScreenComponent>;
  let navigation: NavigationFake;
  let curation: CurationFake;

  /** The way on the screen handed the footer. */
  let handler: ApplyHandler | null;

  const actionBar = {
    registerApplyHandler: vi.fn((given: ApplyHandler) => {
      handler = given;
    }),
    clearApplyHandler: vi.fn(() => {
      handler = null;
    }),
  };

  beforeEach(() => {
    handler = null;
    actionBar.registerApplyHandler.mockClear();
    actionBar.clearApplyHandler.mockClear();
    navigation = fakeNavigation();
    curation = fakeCuration();
    TestBed.configureTestingModule({
      imports: [FlowChoiceScreenComponent],
      providers: [
        provideFake(NavigationService, navigation.fake),
        provideFake(CurationService, curation.fake),
        provideFake(ActionBarService, actionBar as never),
      ],
    });
  });

  /** Render the screen with these processes reachable. */
  function render(...reachable: readonly ('quality' | 'ai-quality')[]): void {
    navigation.offer(...reachable);
    fixture = TestBed.createComponent(FlowChoiceScreenComponent);
    fixture.detectChanges();
  }

  const cards = (): HTMLLabelElement[] =>
    Array.from(fixture.nativeElement.querySelectorAll('label.choice'));
  const radios = (): HTMLInputElement[] =>
    Array.from(fixture.nativeElement.querySelectorAll('input[type="radio"]'));
  const marked = (): string | undefined =>
    cards()
      .find((card) => card.classList.contains('is-selected'))
      ?.querySelector('.choice-label')?.textContent?.trim();

  /** Mark a process the way a person does. */
  function choose(index: number): void {
    radios()[index].dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  describe('what is on offer', () => {
    it('is the two processes where both can be entered', () => {
      render('quality', 'ai-quality');

      expect(cards().map((card) => card.querySelector('.choice-label')?.textContent?.trim())).toEqual([
        'Strukturierte Qualitätsprüfung',
        'Individuelle Qualitätsprüfung mit KI',
      ]);
    });

    it('is only what can be entered right now', () => {
      render('quality');

      expect(cards()).toHaveLength(1);
      expect(marked()).toBe('Strukturierte Qualitätsprüfung');
    });

    it('is nothing at all where neither step applies', () => {
      render();

      expect(cards()).toHaveLength(0);
    });
  });

  describe('the mark', () => {
    it('starts on the first process, so the way on is open from the start', () => {
      render('quality', 'ai-quality');

      expect(marked()).toBe('Strukturierte Qualitätsprüfung');
      expect(handler?.canApply()).toBe(true);
    });

    it('is the one the flow already holds for this content', () => {
      curation.fake.checkProcess.set('ai-quality');

      render('quality', 'ai-quality');

      expect(marked()).toBe('Individuelle Qualitätsprüfung mit KI');
    });

    it('falls back to the first where what is marked cannot be entered any more', () => {
      curation.fake.checkProcess.set('ai-quality');

      render('quality');

      expect(marked()).toBe('Strukturierte Qualitätsprüfung');
    });

    it('is recorded on the flow, so a process left again is found marked on the way back', () => {
      render('quality', 'ai-quality');

      choose(1);

      expect(curation.fake.setCheckProcess).toHaveBeenCalledWith('ai-quality');
      expect(marked()).toBe('Individuelle Qualitätsprüfung mit KI');
    });

    it('opens nothing by itself', () => {
      render('quality', 'ai-quality');

      choose(1);

      expect(navigation.fake.go).not.toHaveBeenCalled();
    });

    it('leaves the way on shut where there is nothing to mark', () => {
      render();

      expect(handler?.canApply()).toBe(false);
    });
  });

  describe('the way on the footer offers', () => {
    it('enters the structured check on its criteria, which is what it is entered for', () => {
      render('quality', 'ai-quality');

      handler?.apply();

      expect(navigation.fake.go).toHaveBeenCalledWith('quality', { tab: 'quality-check' });
    });

    it('enters the KI dialogue on its own step', () => {
      render('quality', 'ai-quality');
      choose(1);

      handler?.apply();

      expect(navigation.fake.go).toHaveBeenCalledWith('ai-quality', undefined);
    });

    it('ends whatever conversation was still on screen when the KI check starts', () => {
      render('quality', 'ai-quality');
      choose(1);
      navigation.fake.go.mockImplementation(() => navigation.fake.section.set('ai-quality'));

      handler?.apply();

      // Read off the step that actually opened: the move is refused while a write is in flight, and
      // ending the dialogue then would throw away a conversation nothing replaced.
      expect(navigation.fake.section()).toBe('ai-quality');
    });

    it('leaves the conversation alone where the move was refused', () => {
      render('quality', 'ai-quality');
      choose(1);

      handler?.apply();

      expect(navigation.fake.section()).toBe('menu');
    });

    it('does nothing where nothing is marked', () => {
      render();

      handler?.apply();

      expect(navigation.fake.go).not.toHaveBeenCalled();
    });
  });

  it('takes its way on off the footer when the screen is left', () => {
    render('quality', 'ai-quality');
    const registered = handler;

    fixture.destroy();

    expect(actionBar.clearApplyHandler).toHaveBeenCalledWith(registered);
  });
});
