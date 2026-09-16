import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { PrivacyScreenComponent } from './privacy-screen.component';

/**
 * The summary shown from the onboarding screen and from the settings — see model/navigation.ts,
 * section `privacy`. Has no dependencies of its own, so there is nothing to fake.
 */
describe('PrivacyScreenComponent', () => {
  let fixture: ComponentFixture<PrivacyScreenComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [PrivacyScreenComponent] });
    fixture = TestBed.createComponent(PrivacyScreenComponent);
    fixture.detectChanges();
  });

  it('marks itself as a draft, not yet legally reviewed', () => {
    expect(fixture.nativeElement.textContent).toContain('Entwurf');
  });

  it('points at the full document in the repository', () => {
    expect(fixture.nativeElement.textContent).toContain('PRIVACY.md');
  });
});
