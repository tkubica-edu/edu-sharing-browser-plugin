import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { provideFake } from '../../../testing/provide-fake';
import { ActionBarService, FooterAction } from '../../services/action-bar.service';
import { BusyService } from '../../services/busy.service';
import { ActionBarComponent } from './action-bar.component';

/**
 * The persistent footer. It holds no logic of its own beyond two decisions, and both are about the
 * whole bar rather than about one action: whether it is on screen at all, and that a write in flight
 * refuses every button — the one that started the write says so itself, and its neighbours would lead
 * away from it.
 */
describe('ActionBarComponent', () => {
  let fixture: ComponentFixture<ActionBarComponent>;

  /** What the current view offers, as the footer service reports it. */
  const actions = signal<readonly FooterAction[]>([]);

  /** Whether a write is in flight, and what the panel says about it. */
  const busy = signal(false);
  const hint = signal<string | null>(null);

  /** An offered next step. */
  function anAction(label: string, overrides: Partial<FooterAction> = {}): FooterAction {
    return { label, disabled: false, run: vi.fn(), ...overrides };
  }

  beforeEach(() => {
    actions.set([]);
    busy.set(false);
    hint.set(null);
    TestBed.configureTestingModule({
      imports: [ActionBarComponent],
      providers: [
        provideFake(ActionBarService, { actions } as never),
        provideFake(BusyService, { busy, hint } as never),
      ],
    });
    fixture = TestBed.createComponent(ActionBarComponent);
    fixture.detectChanges();
  });

  /** Re-render over whatever was just set. */
  function render(): void {
    fixture.detectChanges();
  }

  const buttons = (): HTMLButtonElement[] =>
    Array.from(fixture.nativeElement.querySelectorAll('button.fbtn'));

  it('is not on screen while the view offers no next step', () => {
    expect(fixture.nativeElement.querySelector('.action-bar')).toBeNull();
  });

  it('offers one button per action, in the order the view named them', () => {
    actions.set([anAction('Weiter'), anAction('Zurück')]);
    render();

    expect(buttons().map((button) => button.textContent?.trim())).toEqual(['Weiter', 'Zurück']);
  });

  it('runs the action the button stands for', () => {
    const weiter = anAction('Weiter');
    actions.set([weiter]);
    render();

    buttons()[0].click();

    expect(weiter.run).toHaveBeenCalled();
  });

  it('carries the way on and the way back out of a step differently', () => {
    actions.set([anAction('Weiter'), anAction('Zurück', { kind: 'secondary' })]);
    render();

    expect(buttons()[0].classList.contains('fbtn-primary')).toBe(true);
    expect(buttons()[1].classList.contains('fbtn-secondary')).toBe(true);
    expect(buttons()[1].classList.contains('fbtn-primary')).toBe(false);
  });

  it('refuses an action the view itself disabled', () => {
    actions.set([anAction('Weiter', { disabled: true })]);
    render();

    expect(buttons()[0].disabled).toBe(true);
  });

  it('refuses every action while a write is in flight, and says why', () => {
    actions.set([anAction('Weiter'), anAction('Zurück')]);
    busy.set(true);
    hint.set('Wird gespeichert …');
    render();

    expect(buttons().every((button) => button.disabled)).toBe(true);
    expect(buttons()[0].getAttribute('title')).toBe('Wird gespeichert …');
  });

  it('takes the refusal back once the write is through', () => {
    actions.set([anAction('Weiter')]);
    busy.set(true);
    render();

    busy.set(false);
    render();

    expect(buttons()[0].disabled).toBe(false);
  });
});
