import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { ImpressumScreenComponent } from './impressum-screen.component';

/**
 * The legal notice, reachable from the settings screen — see model/navigation.ts, section `impressum`.
 * Has no dependencies of its own, so there is nothing to fake.
 */
describe('ImpressumScreenComponent', () => {
  let fixture: ComponentFixture<ImpressumScreenComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [ImpressumScreenComponent] });
    fixture = TestBed.createComponent(ImpressumScreenComponent);
    fixture.detectChanges();
  });

  it('marks itself as a draft, not yet filled in', () => {
    expect(fixture.nativeElement.textContent).toContain('Entwurf');
  });

  it('points at the full document in the repository', () => {
    expect(fixture.nativeElement.textContent).toContain('IMPRESSUM.md');
  });
});
