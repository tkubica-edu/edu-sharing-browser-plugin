import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { AuthFake, NavigationFake, fakeAuth, fakeNavigation } from '../../../../testing/fakes';
import { provideFake } from '../../../../testing/provide-fake';
import { APP_CONFIG } from '../../../config';
import { AuthService } from '../../../services/auth.service';
import { NavigationService } from '../../../services/navigation.service';
import { OnboardingScreenComponent } from './onboarding-screen.component';

/**
 * The one screen a fresh install shows before anything else — see the `onboarded` condition in
 * model/navigation.ts. The field starts empty and the suggestion is only ever taken on request, so
 * connecting to the shipped staging repository is a choice rather than a default.
 */
describe('OnboardingScreenComponent', () => {
  let fixture: ComponentFixture<OnboardingScreenComponent>;
  let auth: AuthFake;
  let navigation: NavigationFake;

  beforeEach(() => {
    auth = fakeAuth('');
    navigation = fakeNavigation();
    TestBed.configureTestingModule({
      imports: [OnboardingScreenComponent],
      providers: [
        provideFake(AuthService, auth.fake),
        provideFake(NavigationService, navigation.fake),
      ],
    });
    fixture = TestBed.createComponent(OnboardingScreenComponent);
    fixture.detectChanges();
  });

  const query = <T extends Element>(selector: string): T | null =>
    fixture.nativeElement.querySelector(selector);

  const button = (label: string): HTMLButtonElement => {
    const buttons: HTMLButtonElement[] = Array.from(fixture.nativeElement.querySelectorAll('button'));
    const found = buttons.find((entry) => (entry.textContent ?? '').trim().includes(label));
    if (!found) throw new Error(`no button labelled ${label}`);
    return found;
  };

  async function settle(): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function type(value: string): Promise<void> {
    const input = query<HTMLInputElement>('#ob-repo-url')!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await settle();
  }

  it('starts with an empty field, asking nothing of any repository yet', () => {
    expect(query<HTMLInputElement>('#ob-repo-url')!.value).toBe('');
    expect(auth.fake.setRepositoryUrl).not.toHaveBeenCalled();
  });

  it('fills the field with the shipped suggestion only on request, never on its own', async () => {
    button('Vorschlag übernehmen').click();
    await settle();

    expect(query<HTMLInputElement>('#ob-repo-url')!.value).toBe(APP_CONFIG.defaultRepositoryUrl);
    expect(auth.fake.setRepositoryUrl).not.toHaveBeenCalled();
  });

  it('blocks connecting on a URL that does not name an edu-sharing deployment', async () => {
    await type('https://not-a-repository.example');
    button('Verbinden').click();
    await settle();

    expect(auth.fake.setRepositoryUrl).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('/edu-sharing');
  });

  it('persists a valid repository and reloads the sidebar to pick it up', async () => {
    await type('https://repo.example/edu-sharing');
    button('Verbinden').click();
    await settle();

    expect(auth.fake.setRepositoryUrl).toHaveBeenCalledWith('https://repo.example/edu-sharing');
    expect(auth.fake.applyRepositoryChange).toHaveBeenCalled();
  });

  it('leads to the same privacy screen the settings offer later', () => {
    button('Datenschutzerklärung').click();

    expect(navigation.fake.go).toHaveBeenCalledWith('privacy');
  });
});
