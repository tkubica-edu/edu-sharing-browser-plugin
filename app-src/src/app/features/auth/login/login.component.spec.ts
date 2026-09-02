import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { AuthService } from '../../../services/auth.service';
import { LoginComponent } from './login.component';
import { RepositoryPageService } from '../../../services/repository-page.service';
import { provideFake } from '../../../../testing/provide-fake';
import { AuthFake, fakeAuth } from '../../../../testing/fakes';

/**
 * The login card's own rendering — the one place where what the panel *offers* is decided by a
 * template rather than by a service. `AuthService.oauthOffered` and `passwordLoginOffered` say which
 * of the two ways in the repository has; which controls actually appear is this component's answer,
 * and only a rendered template can be asked.
 */
describe('LoginComponent', () => {
  let fixture: ComponentFixture<LoginComponent>;
  let auth: AuthFake;

  beforeEach(() => {
    auth = fakeAuth();
    TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
        provideFake(AuthService, auth.fake),
        provideFake(RepositoryPageService, {
          registerUrl: () => 'https://repo.example/edu-sharing/components/register',
          passwordResetUrl: () => 'https://repo.example/edu-sharing/components/register/request',
          open: () => Promise.resolve(),
        } as unknown as RepositoryPageService),
      ],
    });
    fixture = TestBed.createComponent(LoginComponent);
    fixture.detectChanges();
  });

  /** The SSO buttons on the card, by the class the template marks them with. */
  function ssoButtons(): HTMLButtonElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll('button.lg-sso'));
  }

  /**
   * The buttons' visible labels. The icon is a Material ligature, so `IconDirective` puts its name
   * into the host's text content — that is glyph, not label, and is dropped before comparing.
   */
  function labels(): string[] {
    return ssoButtons().map((button) => {
      const label = button.cloneNode(true) as HTMLElement;
      label.querySelectorAll('i').forEach((icon) => icon.remove());
      return (label.textContent ?? '').trim();
    });
  }

  it('offers no identity provider where the repository names none', () => {
    // The card as it was before there was an alternative: the credential form alone.
    expect(ssoButtons()).toHaveLength(0);
    expect(fixture.nativeElement.querySelectorAll('input')).toHaveLength(2);
    expect(fixture.nativeElement.querySelector('.lg-submit')).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('Account erstellen');
  });

  it('drops the credential form where the repository names one', () => {
    auth.offerOAuth();
    fixture.detectChanges();

    // The two are alternatives rather than a pair: the repository has said which identity it knows
    // its users by, so nothing on the card asks for a password (AuthService.passwordLoginOffered).
    expect(fixture.nativeElement.querySelectorAll('input')).toHaveLength(0);
    expect(fixture.nativeElement.textContent).not.toContain('Passwort vergessen');
    expect(ssoButtons()).toHaveLength(1);
  });

  it('drops the way to an account of the repository`s own along with it', () => {
    auth.offerOAuth();
    fixture.detectChanges();

    // An account is created where the identity comes from, which is then not this repository.
    expect(fixture.nativeElement.textContent).not.toContain('Account erstellen');
  });

  it('offers one button where the repository advertises no provider', () => {
    auth.offerOAuth();
    fixture.detectChanges();

    // The provider's own chooser is one step further on, which is the same question anyway.
    expect(labels()).toEqual(['Anmelden mit OAuth']);
  });

  it('offers a button per provider the repository advertises, each naming the flow', () => {
    auth.offerOAuth([
      { label: 'myopenidconnect', registrationId: 'myopenidconnect' },
      { label: 'Schul-Login', registrationId: 'schule' },
    ]);
    fixture.detectChanges();

    // What the repository advertises is a registration id — a configuration name — so the buttons
    // say what they do instead of repeating it.
    expect(labels()).toEqual(['Anmelden mit OAuth', 'Anmelden mit OAuth']);
  });

  it('hands the picked provider to the login', async () => {
    auth.offerOAuth([{ label: 'Uni-Login', registrationId: 'uni' }]);
    fixture.detectChanges();

    ssoButtons()[0].click();
    await fixture.whenStable();

    expect(auth.fake.loginWithOAuth).toHaveBeenCalledWith({ label: 'Uni-Login', registrationId: 'uni' });
  });

  it('asks for no particular provider where the button names none', async () => {
    auth.offerOAuth();
    fixture.detectChanges();

    ssoButtons()[0].click();
    await fixture.whenStable();

    // `undefined`, not `null`: the flow takes "no provider named" as the absence of the parameter.
    expect(auth.fake.loginWithOAuth).toHaveBeenCalledWith(undefined);
  });

  it('locks the buttons while the provider`s pages are up, and says so', () => {
    auth.offerOAuth();
    auth.fake.oauthRunning.set(true);
    fixture.detectChanges();

    expect(ssoButtons()[0].disabled).toBe(true);
    expect(labels()).toEqual(['Anmelden…']);
  });

  it('locks them while the repository change waits to be applied', () => {
    auth.offerOAuth();
    auth.fake.needsReload.set(true);
    fixture.detectChanges();

    expect(ssoButtons()[0].disabled).toBe(true);
  });

  it('starts no second flow from a locked button', async () => {
    auth.offerOAuth();
    auth.fake.oauthRunning.set(true);
    fixture.detectChanges();

    ssoButtons()[0].click();
    await fixture.whenStable();

    expect(auth.fake.loginWithOAuth).not.toHaveBeenCalled();
  });

  it('shows no card at all, and so no button, once there is a session', () => {
    auth.offerOAuth();
    auth.signIn();
    fixture.detectChanges();

    expect(ssoButtons()).toHaveLength(0);
    expect(fixture.nativeElement.textContent).toContain('Angemeldet');
  });
});
