import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { NavigationFake, aTab, fakeNavigation } from '../../../testing/fakes';
import { provideFake } from '../../../testing/provide-fake';
import { BusyService } from '../../services/busy.service';
import { NavigationService } from '../../services/navigation.service';
import { OptionIconService } from '../../services/option-icon.service';
import { TabBarComponent } from './tab-bar.component';

/**
 * The open section's sub steps. The bar itself decides almost nothing — which tabs there are and
 * whether one is reachable is the registry's answer (`NavigationService.tabs`) — but two things are
 * this component's: that a locked step stays on screen and says what it is waiting for instead of
 * appearing out of nowhere, and that a write in flight locks the whole row.
 */
describe('TabBarComponent', () => {
  let fixture: ComponentFixture<TabBarComponent>;
  let navigation: NavigationFake;

  const busy = signal(false);
  const hint = signal<string | null>(null);

  beforeEach(() => {
    navigation = fakeNavigation();
    busy.set(false);
    hint.set(null);
    TestBed.configureTestingModule({
      imports: [TabBarComponent],
      providers: [
        provideFake(NavigationService, navigation.fake),
        provideFake(BusyService, { busy, hint } as never),
        // Used for real: it is a lookup over the registry, and faking it would put the registry's
        // own glyph table into this spec.
        OptionIconService,
      ],
    });
    fixture = TestBed.createComponent(TabBarComponent);
    fixture.detectChanges();
  });

  function render(): void {
    fixture.detectChanges();
  }

  const tabs = (): HTMLButtonElement[] =>
    Array.from(fixture.nativeElement.querySelectorAll('button.tab'));

  it('shows nothing while the section has no sub steps', () => {
    expect(tabs()).toHaveLength(0);
  });

  it('shows one tab per sub step, labelled as the registry names it', () => {
    navigation.fake.tabs.set([
      aTab('quality-check', { label: 'Qualität' }),
      aTab('metadata', { label: 'Metadaten' }),
    ]);
    render();

    expect(tabs().map((tab) => tab.querySelector('.t-label')?.textContent)).toEqual([
      'Qualität',
      'Metadaten',
    ]);
  });

  it('marks the one that is open', () => {
    navigation.fake.tabs.set([aTab('quality-check'), aTab('metadata')]);
    navigation.fake.screen.set('metadata');
    render();

    expect(tabs()[0].getAttribute('aria-selected')).toBe('false');
    expect(tabs()[1].getAttribute('aria-selected')).toBe('true');
    expect(tabs()[1].classList.contains('is-active')).toBe(true);
  });

  it('goes to the step a tab stands for', () => {
    navigation.fake.tabs.set([aTab('quality-check'), aTab('metadata')]);
    render();

    tabs()[1].click();

    expect(navigation.fake.goTab).toHaveBeenCalledWith('metadata');
  });

  it('keeps a locked step on screen, saying what it is waiting for', () => {
    navigation.fake.tabs.set([
      aTab('quality-check', { label: 'Qualität' }),
      aTab('metadata', {
        label: 'Metadaten',
        disabled: true,
        disabledHint: 'Erst die Qualität bestätigen',
      }),
    ]);
    render();

    expect(tabs()).toHaveLength(2);
    expect(tabs()[1].disabled).toBe(true);
    expect(tabs()[1].getAttribute('title')).toBe('Erst die Qualität bestätigen');
  });

  it('names a reachable step by its label instead', () => {
    navigation.fake.tabs.set([aTab('quality-check', { label: 'Qualität' })]);
    render();

    expect(tabs()[0].getAttribute('title')).toBe('Qualität');
  });

  it('locks the whole row while a write is in flight, whichever step is which', () => {
    navigation.fake.tabs.set([aTab('quality-check'), aTab('metadata')]);
    busy.set(true);
    hint.set('Wird gespeichert …');
    render();

    expect(tabs().every((tab) => tab.disabled)).toBe(true);
    expect(tabs()[0].getAttribute('title')).toBe('Wird gespeichert …');
  });

  it('gives every tab a glyph', () => {
    navigation.fake.tabs.set([aTab('quality-check'), aTab('metadata')]);
    render();

    expect(tabs().every((tab) => !!tab.querySelector('.t-icon'))).toBe(true);
  });
});
