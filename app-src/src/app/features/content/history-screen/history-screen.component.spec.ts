import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { aHistoryEntry, fakeHistory } from '../../../../testing/fakes';
import { HistoryFake } from '../../../../testing/fakes/history.fake';
import { provideFake } from '../../../../testing/provide-fake';
import { HistoryEntry, HistoryService } from '../../../services/history.service';
import { ParsedMetadata } from '../../../services/metadata-agent.service';
import { HistoryScreenComponent } from './history-screen.component';

/** An entry with the fields a run recorded for it, which is what expanding one shows. */
function anEntryWith(fields: { key: string; values: string[] }[], overrides: Partial<HistoryEntry> = {}) {
  return aHistoryEntry({ parsed: { fields } as unknown as ParsedMetadata, ...overrides });
}

/**
 * The saved contents, newest first. Loading one back is the shell's business — this screen only
 * reports the request — so what it decides is the folding, the counts, and that emptying the list
 * happens only once it was confirmed.
 */
describe('HistoryScreenComponent', () => {
  let fixture: ComponentFixture<HistoryScreenComponent>;
  let history: HistoryFake;

  /** What the user answered the confirmation with. */
  let confirms = true;

  beforeEach(() => {
    confirms = true;
    vi.stubGlobal('confirm', vi.fn(() => confirms));
    history = fakeHistory();
    TestBed.configureTestingModule({
      imports: [HistoryScreenComponent],
      providers: [provideFake(HistoryService, history.fake)],
    });
    fixture = TestBed.createComponent(HistoryScreenComponent);
    fixture.detectChanges();
  });

  afterEach(() => vi.unstubAllGlobals());

  function render(): void {
    fixture.detectChanges();
  }

  /** Put these entries in the list. */
  function holding(...entries: readonly HistoryEntry[]): void {
    history.fake.entries.set([...entries]);
    render();
  }

  const text = (): string => fixture.nativeElement.textContent ?? '';
  const items = (): HTMLLIElement[] => Array.from(fixture.nativeElement.querySelectorAll('li.item'));
  const heads = (): HTMLButtonElement[] =>
    Array.from(fixture.nativeElement.querySelectorAll('button.item-head'));

  describe('an empty list', () => {
    it('says so, and offers nothing to empty', () => {
      expect(text()).toContain('Noch keine gespeicherten Inhalte.');
      expect(fixture.nativeElement.querySelector('button.btn-text')).toBeNull();
    });
  });

  describe('the entries', () => {
    it('are listed with what they are called and where they came from', () => {
      holding(aHistoryEntry({ title: 'Optik', url: 'https://example.org/optik' }));

      expect(fixture.nativeElement.querySelector('.item-title')?.textContent?.trim()).toBe('Optik');
      expect(fixture.nativeElement.querySelector('.item-url')?.textContent?.trim()).toBe(
        'https://example.org/optik',
      );
    });

    it('are named by their address where they carry no title', () => {
      holding(aHistoryEntry({ title: '', url: 'https://example.org/optik' }));

      expect(fixture.nativeElement.querySelector('.item-title')?.textContent?.trim()).toBe(
        'https://example.org/optik',
      );
    });

    it('say how much of the metadata set a run answered', () => {
      holding(aHistoryEntry({ fieldsExtracted: 7, fieldsTotal: 12 }));

      expect(fixture.nativeElement.querySelector('.chip')?.textContent?.trim()).toBe('7/12');
    });

    it('say nothing rather than zero where a run counted nothing', () => {
      holding(aHistoryEntry());

      expect(fixture.nativeElement.querySelector('.chip')?.textContent?.trim()).toBe('–/–');
    });
  });

  describe('expanding one', () => {
    beforeEach(() =>
      holding(
        anEntryWith([{ key: 'cclom:title', values: ['Optik', 'Licht'] }], { id: 'a' }),
        anEntryWith([{ key: 'cclom:general_description', values: ['Über Licht'] }], { id: 'b' }),
      ),
    );

    it('shows nothing of an entry until it is asked for', () => {
      expect(fixture.nativeElement.querySelector('.item-body')).toBeNull();
    });

    it('shows what the run recorded, value by value', () => {
      heads()[0].click();
      render();

      expect(fixture.nativeElement.querySelector('dt')?.textContent?.trim()).toBe('cclom:title');
      expect(
        Array.from(fixture.nativeElement.querySelectorAll('.val')).map((value) =>
          ((value as HTMLElement).textContent ?? '').trim(),
        ),
      ).toEqual(['Optik', 'Licht']);
    });

    it('shows when it was recorded', () => {
      holding(anEntryWith([], { timestamp: Date.UTC(2026, 4, 6, 9, 30) }));
      heads()[0].click();
      render();

      expect(fixture.nativeElement.querySelector('.meta-line')?.textContent?.trim()).toBe(
        '06.05.2026 11:30',
      );
    });

    it('folds it away again', () => {
      heads()[0].click();
      render();

      heads()[0].click();
      render();

      expect(fixture.nativeElement.querySelector('.item-body')).toBeNull();
    });

    it('shows one at a time, the next replacing the one before it', () => {
      heads()[0].click();
      render();

      heads()[1].click();
      render();

      const bodies = fixture.nativeElement.querySelectorAll('.item-body');
      expect(bodies).toHaveLength(1);
      expect(items()[1].querySelector('.item-body')).not.toBeNull();
    });

    it('reports the request to take the content back up, and loads nothing itself', () => {
      const opened = vi.fn();
      fixture.componentInstance.open.subscribe(opened);
      heads()[0].click();
      render();

      (fixture.nativeElement.querySelector('button.btn-load') as HTMLButtonElement).click();

      expect(opened).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
    });
  });

  describe('emptying the list', () => {
    beforeEach(() => holding(aHistoryEntry({ id: 'a' }), aHistoryEntry({ id: 'b' })));

    it('asks first, since it cannot be undone', () => {
      confirms = false;

      (fixture.nativeElement.querySelector('button.btn-text') as HTMLButtonElement).click();

      expect(globalThis.confirm).toHaveBeenCalled();
      expect(history.fake.clear).not.toHaveBeenCalled();
    });

    it('empties it once that is confirmed', () => {
      (fixture.nativeElement.querySelector('button.btn-text') as HTMLButtonElement).click();

      expect(history.fake.clear).toHaveBeenCalled();
    });

    it('folds away whatever was open, there being nothing left to show', () => {
      heads()[0].click();
      render();

      (fixture.nativeElement.querySelector('button.btn-text') as HTMLButtonElement).click();
      history.fake.entries.set([]);
      render();

      expect(fixture.nativeElement.querySelector('.item-body')).toBeNull();
    });
  });
});
