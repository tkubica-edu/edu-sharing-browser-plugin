import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CurationFake, aNode, fakeCuration } from '../../../../testing/fakes';
import { provideFake } from '../../../../testing/provide-fake';
import { CurationService } from '../../../services/curation.service';
import { ContentCardComponent } from './content-card.component';

/**
 * The card that shows which content the panel is working on. It takes no content as an input — the
 * menu and the Inhaltsoptionen mean the same one, so it asks `CurationService` itself and only the
 * framing differs per place. What it decides on its own is the tile's glyph and which single line
 * goes under the title.
 */
describe('ContentCardComponent', () => {
  let fixture: ComponentFixture<ContentCardComponent>;
  let curation: CurationFake;

  beforeEach(() => {
    curation = fakeCuration();
    TestBed.configureTestingModule({
      imports: [ContentCardComponent],
      providers: [provideFake(CurationService, curation.fake)],
    });
    fixture = TestBed.createComponent(ContentCardComponent);
    fixture.componentRef.setInput('heading', 'Geöffneter Inhalt');
    fixture.detectChanges();
  });

  /** Set one of the card's inputs and re-render. */
  function set(inputs: Record<string, unknown>): void {
    for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
    fixture.detectChanges();
  }

  const text = (): string => fixture.nativeElement.textContent ?? '';
  const title = (): string => fixture.nativeElement.querySelector('.fc-title')?.textContent?.trim() ?? '';
  const card = (): HTMLElement => fixture.nativeElement.querySelector('.focus-card');
  const glyph = (): string => fixture.nativeElement.querySelector('.fc-icon')?.textContent?.trim() ?? '';

  it('is named by its heading', () => {
    expect(fixture.nativeElement.querySelector('.focus-label')?.textContent?.trim()).toBe(
      'Geöffneter Inhalt',
    );
  });

  it('names the content the panel is working on', () => {
    curation.named('Optik – Licht und Linsen');
    fixture.detectChanges();

    expect(title()).toBe('Optik – Licht und Linsen');
    expect(card().getAttribute('title')).toBe('Optik – Licht und Linsen');
  });

  it('reports the state instead where there is no content to name', () => {
    set({ fallbackTitle: 'Neuer Inhalt erkannt' });

    expect(title()).toBe('Neuer Inhalt erkannt');
  });

  describe('the tile', () => {
    it('carries the kind of content, read off the node the repository holds', () => {
      curation.hydrated(aNode({ mediatype: 'video' } as never));
      fixture.detectChanges();

      expect(glyph()).toBe('movie');
    });

    it('carries the sign for a page where the kind is unknown', () => {
      expect(glyph()).toBe('language');

      curation.hydrated(aNode({ mediatype: 'etwas-neues' } as never));
      fixture.detectChanges();

      expect(glyph()).toBe('language');
    });

    it('carries the glyph the caller asks for instead, where the card is about something else', () => {
      curation.hydrated(aNode({ mediatype: 'video' } as never));
      set({ icon: 'add_circle' });

      expect(glyph()).toBe('add_circle');
    });

    it('carries the spinner while the content is not known yet', () => {
      set({ loading: true });

      expect(fixture.nativeElement.querySelector('.fc-spinner')).not.toBeNull();
      expect(fixture.nativeElement.querySelector('.fc-icon')).toBeNull();
    });
  });

  describe('the one line under the title', () => {
    it('is the step the card offers, where it is an offer', () => {
      set({ action: 'Inhalt jetzt erschließen', note: 'Neuer Inhalt', description: 'etwas' });

      expect(fixture.nativeElement.querySelector('.fc-action-label')?.textContent?.trim()).toBe(
        'Inhalt jetzt erschließen',
      );
      expect(text()).not.toContain('Neuer Inhalt');
      expect(text()).not.toContain('etwas');
    });

    it('is the card own state where it offers no step', () => {
      set({ note: 'Bestehender Inhalt', description: 'etwas' });

      expect(fixture.nativeElement.querySelector('.fc-note')?.textContent?.trim()).toBe(
        'Bestehender Inhalt',
      );
      expect(text()).not.toContain('etwas');
    });

    it('is the description where there is neither', () => {
      set({ description: 'Die Seite wird erkannt …' });

      expect(fixture.nativeElement.querySelector('.fc-desc')?.textContent?.trim()).toBe(
        'Die Seite wird erkannt …',
      );
    });

    it('is nothing at all where the caller says nothing', () => {
      expect(fixture.nativeElement.querySelector('.fc-action')).toBeNull();
      expect(fixture.nativeElement.querySelector('.fc-note')).toBeNull();
      expect(fixture.nativeElement.querySelector('.fc-desc')).toBeNull();
    });
  });

  describe('as a way on', () => {
    it('is a statement rather than a control unless it leads somewhere', () => {
      expect(fixture.nativeElement.querySelector('button.focus-card')).toBeNull();
      expect(fixture.nativeElement.querySelector('.focus-card.is-static')).not.toBeNull();
    });

    it('is a button where it does, and reports the press', () => {
      const pressed = vi.fn();
      fixture.componentInstance.activate.subscribe(pressed);
      set({ interactive: true });

      fixture.nativeElement.querySelector('button.focus-card').click();

      expect(pressed).toHaveBeenCalled();
    });

    it('presses nowhere while it is refused', () => {
      const pressed = vi.fn();
      fixture.componentInstance.activate.subscribe(pressed);
      set({ interactive: true, disabled: true });

      const button = fixture.nativeElement.querySelector('button.focus-card') as HTMLButtonElement;
      button.click();

      expect(button.disabled).toBe(true);
      expect(pressed).not.toHaveBeenCalled();
    });

    it('is lifted off the surface only where it is the centre of the screen', () => {
      expect(card().classList.contains('is-elevated')).toBe(false);

      set({ elevated: true });

      expect(card().classList.contains('is-elevated')).toBe(true);
    });
  });
});
