import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  NavigationFake,
  fakeAuth,
  fakeCuration,
  fakeDebug,
  fakeNavigation,
  fakeNostrForward,
  fakeWebComponent,
} from '../../../../testing/fakes';
import { provideFake } from '../../../../testing/provide-fake';
import { AuthService } from '../../../services/auth.service';
import { BrowserExtensionCustomWebComponentService } from '../../../services/browser-extension-custom-web-component.service';
import { ConditionsService } from '../../../services/conditions.service';
import { CurationService } from '../../../services/curation.service';
import { DebugService } from '../../../services/debug.service';
import { NavigationService } from '../../../services/navigation.service';
import { NostrForwardService } from '../../../services/nostr-forward.service';
import { OptionIconService } from '../../../services/option-icon.service';
import { AddContentScreenComponent } from './add-content-screen.component';

/**
 * „Inhalt hinzufügen": the choice of how content enters the repository. A placeholder for the
 * repository's own add element — nothing about adding is implemented here, so every row only
 * navigates, and the one decision the screen makes is which rows apply.
 */
describe('AddContentScreenComponent', () => {
  let fixture: ComponentFixture<AddContentScreenComponent>;
  let navigation: NavigationFake;

  beforeEach(() => {
    navigation = fakeNavigation();
    TestBed.configureTestingModule({
      imports: [AddContentScreenComponent],
      providers: [
        provideFake(NavigationService, navigation.fake),
        provideFake(AuthService, fakeAuth().fake),
        provideFake(CurationService, fakeCuration().fake),
        provideFake(DebugService, fakeDebug().fake),
        provideFake(BrowserExtensionCustomWebComponentService, fakeWebComponent().fake),
        provideFake(NostrForwardService, fakeNostrForward().fake),
        ConditionsService,
        OptionIconService,
      ],
    });
  });

  /** Render the screen with these ways of adding reachable. */
  function render(...reachable: readonly string[]): void {
    navigation.offer(...(reachable as never[]));
    fixture = TestBed.createComponent(AddContentScreenComponent);
    fixture.detectChanges();
  }

  const rows = (): HTMLButtonElement[] =>
    Array.from(fixture.nativeElement.querySelectorAll('button.menu-item'));
  const labels = (): string[] =>
    rows().map((row) => row.querySelector('.mi-title')?.textContent?.trim() ?? '');

  it('offers the three ways in, in the order they are meant to be considered', () => {
    render('new-document', 'add-material', 'search');

    expect(labels()).toEqual(['Erstellen', 'Datei oder Link', 'Suchen & einfügen']);
  });

  it('offers only what can be entered right now', () => {
    render('add-material');

    expect(labels()).toEqual(['Datei oder Link']);
  });

  it('offers nothing where none of them applies', () => {
    render();

    expect(rows()).toHaveLength(0);
  });

  it('opens the section a row stands for, and does nothing else', () => {
    render('new-document', 'add-material', 'search');

    rows()[2].click();

    expect(navigation.fake.go).toHaveBeenCalledWith('search');
  });

  it('gives every row a glyph', () => {
    render('new-document', 'add-material', 'search');

    expect(rows().every((row) => !!row.querySelector('.mi-icon'))).toBe(true);
  });

  it('says what each way is for', () => {
    render('new-document');

    expect(rows()[0].querySelector('.mi-desc')?.textContent?.trim()).toBe(
      'Ein neues Dokument anlegen und im Connector bearbeiten',
    );
  });
});
