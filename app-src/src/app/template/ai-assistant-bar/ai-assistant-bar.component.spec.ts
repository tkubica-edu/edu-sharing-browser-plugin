import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  AuthFake,
  NavigationFake,
  WebComponentFake,
  fakeAuth,
  fakeNavigation,
  fakeWebComponent,
} from '../../../testing/fakes';
import { provideFake } from '../../../testing/provide-fake';
import { AuthService } from '../../services/auth.service';
import { BrowserExtensionCustomWebComponentService } from '../../services/browser-extension-custom-web-component.service';
import { BusyService } from '../../services/busy.service';
import { NavigationService } from '../../services/navigation.service';
import { AiAssistantBarComponent } from './ai-assistant-bar.component';

/**
 * The assistant's offer, above the session bar. Like the bars around it, it decides for itself whether
 * it is on screen — and that is nearly all of it: the assistant comes with the WLO bundle, so the offer
 * exists only where that does.
 */
describe('AiAssistantBarComponent', () => {
  let fixture: ComponentFixture<AiAssistantBarComponent>;
  let auth: AuthFake;
  let navigation: NavigationFake;
  let webComponent: WebComponentFake;

  const busy = signal(false);
  const hint = signal<string | null>(null);
  const currentSection = signal<{ plain?: boolean } | undefined>(undefined);

  beforeEach(() => {
    auth = fakeAuth();
    navigation = fakeNavigation();
    webComponent = fakeWebComponent(true);
    busy.set(false);
    hint.set(null);
    currentSection.set(undefined);
    TestBed.configureTestingModule({
      imports: [AiAssistantBarComponent],
      providers: [
        provideFake(AuthService, auth.fake),
        provideFake(NavigationService, { ...navigation.fake, currentSection } as never),
        provideFake(BrowserExtensionCustomWebComponentService, webComponent.fake),
        provideFake(BusyService, { busy, hint } as never),
      ],
    });
    fixture = TestBed.createComponent(AiAssistantBarComponent);
    fixture.detectChanges();
  });

  function render(): void {
    fixture.detectChanges();
  }

  /** The panel where the offer belongs: a WLO session standing on the main menu. */
  function onTheMenu(): void {
    auth.signIn();
    navigation.fake.section.set('menu');
    render();
  }

  const bar = (): HTMLElement | null => fixture.nativeElement.querySelector('.ai-bar');
  const row = (): HTMLButtonElement => fixture.nativeElement.querySelector('button.ai-row');

  describe('where the offer is', () => {
    it('is on the main menu of a WLO panel with a session', () => {
      onTheMenu();

      expect(bar()).not.toBeNull();
      expect(fixture.nativeElement.textContent).toContain('Boerdi - KI-Assistent');
    });

    it('is nowhere without the bundle the assistant comes with', () => {
      auth.signIn();
      navigation.fake.section.set('menu');
      webComponent.fake.offeredByRepository.set(false);
      render();

      expect(bar()).toBeNull();
    });

    it('is nowhere while the panel may not act at all', () => {
      navigation.fake.section.set('menu');
      render();

      expect(bar()).toBeNull();
    });

    it('is on a screen that is a plain list, like the session bar under it', () => {
      auth.signIn();
      navigation.fake.section.set('history');
      currentSection.set({ plain: true });
      render();

      expect(bar()).not.toBeNull();
    });

    it('is nowhere on a screen that owns its own bottom edge', () => {
      auth.signIn();
      navigation.fake.section.set('quality');
      currentSection.set({ plain: false });
      render();

      expect(bar()).toBeNull();
    });

    it('is nowhere under the login gate, which brings its own edge', () => {
      onTheMenu();
      navigation.fake.sessionGate.set(true);
      render();

      expect(bar()).toBeNull();
    });

    it('is nowhere on the assistant own screen, where the asking is what is on screen', () => {
      auth.signIn();
      navigation.fake.section.set('ai-assistant');
      currentSection.set({ plain: true });
      render();

      expect(bar()).toBeNull();
    });
  });

  describe('the offer itself', () => {
    it('leads into asking', () => {
      onTheMenu();

      row().click();

      expect(navigation.fake.go).toHaveBeenCalledWith('ai-assistant');
    });

    it('says who is being asked', () => {
      onTheMenu();

      expect(row().getAttribute('title')).toBe('Eine Frage an Boerdi - KI-Assistent stellen');
    });

    it('leads nowhere while a write is in flight, and says why instead', () => {
      onTheMenu();
      busy.set(true);
      hint.set('Wird gespeichert …');
      render();

      expect(row().disabled).toBe(true);
      expect(row().getAttribute('title')).toBe('Wird gespeichert …');
    });

    it('takes the mascot off the row where its picture is missing', () => {
      onTheMenu();
      const avatar = fixture.nativeElement.querySelector('img.ai-avatar') as HTMLImageElement;

      avatar.dispatchEvent(new Event('error'));

      expect(avatar.style.display).toBe('none');
    });
  });
});
