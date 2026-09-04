import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  CurationFake,
  fakeAuth,
  fakeCuration,
  fakeDebug,
  fakeNostrForward,
  fakeWebComponent,
} from '../../../../testing/fakes';
import { provideFake } from '../../../../testing/provide-fake';
import { AuthService } from '../../../services/auth.service';
import { BrowserExtensionCustomWebComponentService } from '../../../services/browser-extension-custom-web-component.service';
import { ConditionsService } from '../../../services/conditions.service';
import { CurationService } from '../../../services/curation.service';
import { DebugService } from '../../../services/debug.service';
import { NostrForwardService } from '../../../services/nostr-forward.service';
import { RepositoryPageService } from '../../../services/repository-page.service';
import { LoginGateComponent } from './login-gate.component';

/**
 * What a section shows instead of its screen while the panel has no session of its own. It is the
 * login rather than a refusal — the section was entered on purpose — and the one thing it decides is
 * which of the two reasons it names.
 */
describe('LoginGateComponent', () => {
  let fixture: ComponentFixture<LoginGateComponent>;
  let curation: CurationFake;

  beforeEach(() => {
    curation = fakeCuration();
    TestBed.configureTestingModule({
      imports: [LoginGateComponent],
      providers: [
        provideFake(AuthService, fakeAuth().fake),
        provideFake(CurationService, curation.fake),
        provideFake(DebugService, fakeDebug().fake),
        provideFake(BrowserExtensionCustomWebComponentService, fakeWebComponent().fake),
        provideFake(NostrForwardService, fakeNostrForward().fake),
        provideFake(RepositoryPageService, {
          registerUrl: () => 'https://repo.example/edu-sharing/components/register',
          passwordResetUrl: () => 'https://repo.example/edu-sharing/components/register/request',
          open: () => Promise.resolve(),
        } as unknown as RepositoryPageService),
        // Used for real: whether the agent's edit window has closed is a derivation over the fakes
        // above, and it is the one condition this component branches on.
        ConditionsService,
      ],
    });
    fixture = TestBed.createComponent(LoginGateComponent);
    fixture.detectChanges();
  });

  const text = (): string => fixture.nativeElement.textContent ?? '';

  it('offers the login rather than a refusal', () => {
    expect(fixture.nativeElement.querySelector('es-login')).not.toBeNull();
    expect(text()).toContain('Anmelden und fortfahren');
  });

  it('says the section asks for a session, and that the step is picked back up afterwards', () => {
    expect(text()).toContain('Melde dich an, um diese Funktion zu nutzen.');
    expect(text()).toContain('weitermachen, wo du aufgehört hast');
  });

  it('names the other reason where it is the content rather than the section', () => {
    curation.fake.agentEditWindowClosed.set(true);
    fixture.detectChanges();

    expect(text()).toContain('vor längerer Zeit angelegt');
    expect(text()).not.toContain('um diese Funktion zu nutzen');
  });
});
