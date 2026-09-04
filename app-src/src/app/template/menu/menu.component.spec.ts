import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  CurationFake,
  NavigationFake,
  aHistoryEntry,
  aSectionView,
  fakeCuration,
  fakeHistory,
  fakeNavigation,
} from '../../../testing/fakes';
import { provideFake } from '../../../testing/provide-fake';
import { CurationService } from '../../services/curation.service';
import { HistoryFake } from '../../../testing/fakes/history.fake';
import { HistoryService } from '../../services/history.service';
import { NavigationService } from '../../services/navigation.service';
import { OptionIconService } from '../../services/option-icon.service';
import { MenuComponent } from './menu.component';

/**
 * The main menu. Which entries there are is the registry's answer; what this component decides is the
 * card at its centre — what it is called, what it says about the content, and above all where pressing
 * it leads, which is not always the section the card stands for.
 */
describe('MenuComponent', () => {
  let fixture: ComponentFixture<MenuComponent>;
  let navigation: NavigationFake;
  let curation: CurationFake;
  let history: HistoryFake;

  /** The focal entry of the menu, which is the card — in the registry that is „Inhaltsoptionen". */
  const focal = () => aSectionView('content-options', { label: 'Inhaltsoptionen', focal: true });

  /** The row the card consults about whether a page may be curated at all. */
  const curationRow = (disabled = false) =>
    aSectionView('curation', { label: 'Inhalt erschließen', disabled });

  beforeEach(() => {
    navigation = fakeNavigation();
    curation = fakeCuration();
    history = fakeHistory();
    TestBed.configureTestingModule({
      imports: [MenuComponent],
      providers: [
        provideFake(NavigationService, navigation.fake),
        provideFake(CurationService, curation.fake),
        provideFake(HistoryService, history.fake),
        OptionIconService,
      ],
    });
    fixture = TestBed.createComponent(MenuComponent);
    fixture.detectChanges();
  });

  function render(): void {
    fixture.detectChanges();
  }

  const text = (): string => fixture.nativeElement.textContent ?? '';
  const rows = (): HTMLButtonElement[] =>
    Array.from(fixture.nativeElement.querySelectorAll('button.menu-item'));
  const card = (): HTMLButtonElement | null =>
    fixture.nativeElement.querySelector('es-content-card button.focus-card');
  const cardTitle = (): string =>
    fixture.nativeElement.querySelector('es-content-card .fc-title')?.textContent?.trim() ?? '';
  const cardNote = (): string =>
    fixture.nativeElement.querySelector('es-content-card .fc-note')?.textContent?.trim() ?? '';
  const cardAction = (): string =>
    fixture.nativeElement.querySelector('es-content-card .fc-action-label')?.textContent?.trim() ?? '';

  describe('the two groups', () => {
    it('shows nothing while no section applies', () => {
      expect(rows()).toHaveLength(0);
      expect(fixture.nativeElement.querySelector('es-content-card')).toBeNull();
    });

    it('puts the focal section on the card and everything else in the list', () => {
      navigation.lists(focal(), aSectionView('history', { label: 'Verlauf' }), curationRow());
      render();

      expect(fixture.nativeElement.querySelector('es-content-card')).not.toBeNull();
      expect(rows().map((row) => row.querySelector('.mi-title')?.textContent?.trim())).toEqual([
        'Verlauf',
        'Inhalt erschließen',
      ]);
    });

    it('enters the section a row stands for', () => {
      navigation.lists(aSectionView('history', { label: 'Verlauf' }));
      render();

      rows()[0].click();

      expect(navigation.fake.go).toHaveBeenCalledWith('history');
    });

    it('keeps a section that does not apply listed, with the reason in place of its description', () => {
      navigation.lists(
        aSectionView('curation', {
          label: 'Inhalt erschließen',
          description: 'Die offene Seite beschreiben',
          disabled: true,
          disabledHint: 'Auf einer Edu-Sharing-Seite nicht möglich',
        }),
      );
      render();

      expect(rows()[0].disabled).toBe(true);
      expect(rows()[0].querySelector('.mi-desc')?.textContent?.trim()).toBe(
        'Auf einer Edu-Sharing-Seite nicht möglich',
      );
    });

    it('counts what the Verlauf holds, and says nothing where it is empty', () => {
      navigation.lists(aSectionView('history', { label: 'Verlauf' }));
      render();
      expect(fixture.nativeElement.querySelector('.mi-count')).toBeNull();

      history.fake.entries.set([aHistoryEntry(), aHistoryEntry({ id: 'entry-2' })]);
      render();

      expect(fixture.nativeElement.querySelector('.mi-count')?.textContent?.trim()).toBe('2');
    });
  });

  describe('the card at the centre', () => {
    it('offers to curate a page the repository does not hold yet', () => {
      navigation.lists(focal(), curationRow());
      render();

      expect(cardTitle()).toBe('Neuer Inhalt erkannt');
      expect(cardAction()).toBe('Inhalt jetzt erschließen');
    });

    it('leads to the erschließen step rather than to its own section', () => {
      navigation.lists(focal(), curationRow());
      render();

      card()!.click();

      expect(navigation.fake.go).toHaveBeenCalledWith('curation');
    });

    it('makes no such offer where the page may not be curated', () => {
      navigation.lists(focal(), curationRow(true));
      render();

      expect(cardTitle()).toBe('Inhaltsoptionen');
      expect(cardAction()).toBe('');
    });

    it('makes none while the recognition is still running', () => {
      navigation.lists(
        aSectionView('content-options', { label: 'Inhaltsoptionen', focal: true, loading: true }),
        curationRow(),
      );
      render();

      expect(cardAction()).toBe('');
    });

    it('names a content the repository holds, and says so', () => {
      curation.named('Optik');
      navigation.lists(focal(), curationRow());
      render();

      expect(cardTitle()).toBe('Optik');
      expect(cardNote()).toBe('Bestehender Inhalt');
    });

    it('opens the Inhaltsoptionen for it', () => {
      curation.named('Optik');
      navigation.lists(focal(), curationRow());
      render();

      card()!.click();

      expect(navigation.fake.go).toHaveBeenCalledWith('content-options');
    });

    it('says which content exists only in the panel', () => {
      curation.named('Optik');
      curation.fake.hasUnsavedWork.set(true);
      navigation.lists(focal(), curationRow());
      render();

      expect(cardNote()).toBe('Neuer Inhalt');
    });

    it('takes a draft back into its own step, which the Inhaltsoptionen could do nothing with', () => {
      curation.named('Optik');
      curation.fake.hasUnsavedWork.set(true);
      navigation.offer('curation-preview');
      navigation.lists(focal(), curationRow());
      render();

      card()!.click();

      expect(navigation.fake.go).toHaveBeenCalledWith('curation-preview');
    });

    it('does the same for an Erschließung no node stands for', () => {
      curation.fake.hasCuratedResult.set(true);
      curation.fake.contentTitle.set('Optik');
      navigation.offer('curation-preview');
      navigation.lists(focal(), curationRow());
      render();

      card()!.click();

      expect(navigation.fake.go).toHaveBeenCalledWith('curation-preview');
    });

    it('leads to its own section where that step cannot be opened', () => {
      curation.named('Optik');
      curation.fake.hasUnsavedWork.set(true);
      navigation.lists(focal(), curationRow());
      render();

      card()!.click();

      expect(navigation.fake.go).toHaveBeenCalledWith('content-options');
    });

    it('is enterable for a draft even where its own section is not', () => {
      curation.named('Optik');
      curation.fake.hasUnsavedWork.set(true);
      navigation.offer('curation-preview');
      navigation.lists(
        aSectionView('content-options', { label: 'Inhaltsoptionen', focal: true, disabled: true }),
        curationRow(),
      );
      render();

      expect(card()!.disabled).toBe(false);
    });

    it('refuses a card whose section is refused and which offers nothing else', () => {
      curation.named('Optik');
      navigation.lists(
        aSectionView('content-options', { label: 'Inhaltsoptionen', focal: true, disabled: true }),
        curationRow(),
      );
      render();

      expect(card()!.disabled).toBe(true);
    });
  });

  describe('an Erschließung that was left unfinished', () => {
    beforeEach(() => {
      curation.named('Optik');
      curation.leftAt({ section: 'quality', tab: 'metadata' });
      navigation.resumesAt('quality', 'metadata');
      navigation.lists(focal(), curationRow());
      render();
    });

    it('says on the card that it can be carried on', () => {
      expect(cardNote()).toBe('Bestehender Inhalt – Erschließung fortfahren');
    });

    it('says where continuing would lead, before the press rather than after it', () => {
      expect(text()).toContain('öffnet');
      expect(fixture.nativeElement.querySelector('.resume-note strong')?.textContent).toBe('quality');
    });

    it('continues at the step it was left on', () => {
      card()!.click();

      expect(navigation.fake.go).toHaveBeenCalledWith('quality', { tab: 'metadata' });
    });

    it('offers the other way as well, since continuing is not always what is wanted', () => {
      (fixture.nativeElement.querySelector('button.resume-alt') as HTMLButtonElement).click();

      expect(navigation.fake.go).toHaveBeenCalledWith('content-options');
    });

  });

  describe('one whose step can no longer be opened', () => {
    beforeEach(() => {
      curation.named('Optik');
      curation.leftAt({ section: 'quality', tab: 'metadata' });
      // No `resumesAt`: the registry refuses the remembered step — it does not apply on this page, or
      // entering it would start something rather than show it.
      navigation.lists(focal(), curationRow());
      render();
    });

    it('says nothing about continuing', () => {
      expect(fixture.nativeElement.querySelector('.resume-note')).toBeNull();
    });

    it('still says the Erschließung is unfinished, which is true of the content either way', () => {
      expect(cardNote()).toBe('Bestehender Inhalt – Erschließung fortfahren');
    });

    it('hands over to the card own target instead', () => {
      card()!.click();

      expect(navigation.fake.go).toHaveBeenCalledWith('content-options');
    });
  });
});
