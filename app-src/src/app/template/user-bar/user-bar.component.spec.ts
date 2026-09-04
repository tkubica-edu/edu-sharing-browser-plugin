import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { User } from 'ngx-edu-sharing-api';
import { beforeEach, describe, expect, it } from 'vitest';

import { AuthFake, NavigationFake, fakeAuth, fakeNavigation } from '../../../testing/fakes';
import { provideFake } from '../../../testing/provide-fake';
import { AuthService } from '../../services/auth.service';
import { BusyService } from '../../services/busy.service';
import { NavigationService } from '../../services/navigation.service';
import { UserBarComponent } from './user-bar.component';

/**
 * The bar naming who the panel is acting as. It decides for itself whether it is on screen — the shell
 * renders it unconditionally — so where it appears is as much its subject as what it says.
 */
describe('UserBarComponent', () => {
  let fixture: ComponentFixture<UserBarComponent>;
  let auth: AuthFake;
  let navigation: NavigationFake;

  const busy = signal(false);
  const hint = signal<string | null>(null);

  /** The section the panel stands in, as the registry describes it. */
  const currentSection = signal<{ plain?: boolean } | undefined>(undefined);

  beforeEach(() => {
    auth = fakeAuth();
    navigation = fakeNavigation();
    busy.set(false);
    hint.set(null);
    currentSection.set(undefined);
    TestBed.configureTestingModule({
      imports: [UserBarComponent],
      providers: [
        provideFake(AuthService, auth.fake),
        provideFake(NavigationService, { ...navigation.fake, currentSection } as never),
        provideFake(BusyService, { busy, hint } as never),
      ],
    });
    fixture = TestBed.createComponent(UserBarComponent);
    fixture.detectChanges();
  });

  function render(): void {
    fixture.detectChanges();
  }

  /** The panel is where the bar belongs: an authorized session standing on the main menu. */
  function onTheMenu(): void {
    auth.signIn();
    navigation.fake.section.set('menu');
    render();
  }

  const bar = (): HTMLElement | null => fixture.nativeElement.querySelector('.user-bar');
  const row = (): HTMLButtonElement => fixture.nativeElement.querySelector('button.ub-row');
  const title = (): string => fixture.nativeElement.querySelector('.ub-title')?.textContent?.trim() ?? '';
  const name = (): string => fixture.nativeElement.querySelector('.ub-name')?.textContent?.trim() ?? '';
  const actions = (): HTMLButtonElement[] =>
    Array.from(fixture.nativeElement.querySelectorAll('button.ub-action'));

  /** Fold the row out, which is what offers the session's actions. */
  function open(): void {
    row().click();
    render();
  }

  describe('where the bar is', () => {
    it('is nowhere while the panel may not act at all', () => {
      navigation.fake.section.set('menu');
      render();

      expect(bar()).toBeNull();
    });

    it('is on the main menu once there is a session to name', () => {
      onTheMenu();

      expect(bar()).not.toBeNull();
    });

    it('is on a screen that is a plain list', () => {
      auth.signIn();
      navigation.fake.section.set('history');
      currentSection.set({ plain: true });
      render();

      expect(bar()).not.toBeNull();
    });

    it('is nowhere on a screen that brings its own bottom edge', () => {
      auth.signIn();
      navigation.fake.section.set('quality');
      currentSection.set({ plain: false });
      render();

      expect(bar()).toBeNull();
    });

    it('is nowhere under the login gate, which brings its own', () => {
      onTheMenu();
      navigation.fake.sessionGate.set(true);
      render();

      expect(bar()).toBeNull();
    });

    it('is nowhere under a utility, whose bottom edge the covered screen does not own', () => {
      onTheMenu();
      navigation.fake.overlaySection.set('settings');
      render();

      expect(bar()).toBeNull();
    });
  });

  describe('what it says', () => {
    it('names a guest as one, and says what signing in is for', () => {
      auth.authorizeWithoutSession();
      navigation.fake.section.set('menu');
      render();

      expect(title()).toBe('Gastzugang');
      expect(name()).toBe('Anmelden schaltet weitere Funktionen frei');
    });

    it('names the person the way the repository names them everywhere else', () => {
      auth.signIn();
      auth.fake.username.set('anna');
      auth.fake.currentUser.set({
        profile: { firstName: 'Anna', lastName: 'Beispiel' },
      } as unknown as User);
      navigation.fake.section.set('menu');
      render();

      expect(title()).toBe('Angemeldet');
      expect(name()).toBe('Anna Beispiel');
    });

    it('falls back to the login name while the profile is still on its way', () => {
      auth.signIn();
      auth.fake.username.set('anna');
      navigation.fake.section.set('menu');
      render();

      expect(name()).toBe('anna');
    });

    it('says nothing rather than nonsense where there is neither', () => {
      auth.signIn();
      navigation.fake.section.set('menu');
      render();

      expect(name()).toBe('–');
    });

    it('carries the countdown once the session is nearly over', () => {
      onTheMenu();
      auth.endingSoon('4 Minuten');
      render();

      expect(title()).toBe('Angemeldet · 4 Minuten');
      expect(row().classList.contains('is-ending')).toBe(true);
    });

    it('says nothing about the hour a fresh session has left', () => {
      onTheMenu();
      auth.fake.sessionRemainingText.set('58 Minuten');
      render();

      expect(title()).toBe('Angemeldet');
      expect(row().classList.contains('is-ending')).toBe(false);
    });
  });

  describe('what the row folds out', () => {
    it('is folded away until it is asked for', () => {
      onTheMenu();

      expect(actions()).toHaveLength(0);
      expect(row().getAttribute('aria-expanded')).toBe('false');
    });

    it('offers the way out of the session', () => {
      onTheMenu();

      open();

      expect(actions().map((action) => action.textContent?.trim())).toEqual(['Abmelden']);
      expect(row().getAttribute('aria-expanded')).toBe('true');
    });

    it('ends the session and folds itself away again', () => {
      onTheMenu();
      open();

      actions()[0].click();
      render();

      expect(auth.fake.logout).toHaveBeenCalled();
      expect(actions()).toHaveLength(0);
    });

    it('offers a guest the way in instead', () => {
      auth.authorizeWithoutSession();
      navigation.fake.section.set('menu');
      render();

      open();

      expect(actions().map((action) => action.textContent?.trim())).toEqual(['Anmelden']);
    });

    it('takes a guest to the login screen', () => {
      auth.authorizeWithoutSession();
      navigation.fake.section.set('menu');
      render();
      open();

      actions()[0].click();
      render();

      expect(navigation.fake.go).toHaveBeenCalledWith('login');
      expect(actions()).toHaveLength(0);
    });

    it('repeats the countdown where the session is nearly over', () => {
      onTheMenu();
      auth.endingSoon('3 Minuten');
      render();

      open();

      expect(fixture.nativeElement.querySelector('.ub-session')?.textContent).toContain(
        'Sitzung endet in 3 Minuten ohne weitere Aktivität',
      );
    });

    it('says nothing about the time while there is plenty of it', () => {
      onTheMenu();
      open();

      expect(fixture.nativeElement.querySelector('.ub-session')).toBeNull();
    });

    it('folds out nothing while a write is in flight, since ending the session would break it', () => {
      onTheMenu();
      busy.set(true);
      hint.set('Wird gespeichert …');
      render();

      expect(row().disabled).toBe(true);
      expect(row().getAttribute('title')).toBe('Wird gespeichert …');
    });

    it('says what folding it out would offer while nothing is in flight', () => {
      onTheMenu();
      auth.fake.username.set('anna');
      render();

      expect(row().getAttribute('title')).toBe('Angemeldet als anna');
    });

    it('says the other thing once it is open', () => {
      onTheMenu();

      open();

      expect(row().getAttribute('title')).toBe('Schließen');
    });
  });
});
