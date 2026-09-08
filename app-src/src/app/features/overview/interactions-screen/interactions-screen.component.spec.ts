import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  CurationFake,
  EditorialGroupsFake,
  NostrForwardFake,
  WebComponentFake,
  aCollection,
  aNode,
  aReceipt,
  anEditorialGroup,
  fakeCuration,
  fakeEditorialGroups,
  fakeNostrForward,
  fakeWebComponent,
} from '../../../../testing/fakes';
import { provideFake } from '../../../../testing/provide-fake';
import { BrowserExtensionCustomWebComponentService } from '../../../services/browser-extension-custom-web-component.service';
import { CurationService } from '../../../services/curation.service';
import { EditorialGroupsService } from '../../../services/editorial-groups.service';
import { NostrForwardService } from '../../../services/nostr-forward.service';
import { InteractionsScreenComponent } from './interactions-screen.component';

/** A team whose collection the repository holds a picture of, so a card can show it as itself. */
const WITH_LOGO = anEditorialGroup('team-physik', [], 'https://repo.example/physik.png');

/**
 * „Interaktionen": where the content went outside the panel. Two halves that answer for themselves — the
 * teams a save proposed it to, whose exchange is a draft the repository cannot yet fill, and the relay,
 * which is a state rather than an exchange. What the screen is asserted on is which half is shown at all
 * and what each reads its rows off.
 */
describe('InteractionsScreenComponent', () => {
  let fixture: ComponentFixture<InteractionsScreenComponent>;
  let curation: CurationFake;
  let groups: EditorialGroupsFake;
  let wlo: WebComponentFake;
  let nostr: NostrForwardFake;

  beforeEach(() => {
    curation = fakeCuration();
    groups = fakeEditorialGroups([WITH_LOGO]);
    wlo = fakeWebComponent(true);
    nostr = fakeNostrForward();
    TestBed.configureTestingModule({
      imports: [InteractionsScreenComponent],
      providers: [
        provideFake(CurationService, curation.fake),
        provideFake(EditorialGroupsService, groups.fake),
        provideFake(BrowserExtensionCustomWebComponentService, wlo.fake),
        provideFake(NostrForwardService, nostr.fake),
      ],
    });
  });

  async function render(): Promise<void> {
    fixture = TestBed.createComponent(InteractionsScreenComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const text = (): string => fixture.nativeElement.textContent ?? '';

  const query = <T extends Element>(selector: string): T | null =>
    fixture.nativeElement.querySelector(selector);

  /** One card per team the content was proposed to, in the order the forwarding listed them. */
  function cards(): HTMLLIElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll('li.exchange'));
  }

  /** The steps of one card's exchange. */
  function steps(card: HTMLElement): HTMLLIElement[] {
    return Array.from(card.querySelectorAll('li.step'));
  }

  describe('what the view is about', () => {
    it('names the teams’ feedback and marks it as the draft it is', async () => {
      curation.named('Optik');
      await render();

      expect(text()).toContain('Rückmeldungen der Redaktionen');
      expect(text()).toContain('Entwurf');
      expect(text()).toContain('Der Kommunikationsverlauf kann derzeit nicht abgerufen werden');
      expect(text()).toContain('Optik');
    });

    it('is no draft without the teams, what a relay took being a fact', async () => {
      wlo = fakeWebComponent(false);
      TestBed.overrideProvider(BrowserExtensionCustomWebComponentService, { useValue: wlo.fake });
      await render();

      expect(text()).toContain('Wohin dieser Inhalt gegangen ist');
      expect(text()).not.toContain('Entwurf');
      expect(text()).not.toContain('Redaktionen');
    });

    it('leaves the content unnamed where it has no name of its own', async () => {
      await render();

      expect(query('.es-content-title')).toBeNull();
    });
  });

  describe('what it asks for on the way in', () => {
    it('loads the groups the pictures come from, and asks the relay what it holds', async () => {
      await render();

      expect(groups.fake.load).toHaveBeenCalledTimes(1);
      expect(curation.fake.lookUpOnNostr).toHaveBeenCalledTimes(1);
    });

    it('asks for no groups where there are no teams, the view then holding the relay alone', async () => {
      wlo = fakeWebComponent(false);
      TestBed.overrideProvider(BrowserExtensionCustomWebComponentService, { useValue: wlo.fake });
      await render();

      expect(groups.fake.load).not.toHaveBeenCalled();
      expect(curation.fake.lookUpOnNostr).toHaveBeenCalled();
    });

    it('asks the relay nothing with the connection switched off, which is where its half is not shown', async () => {
      nostr.fake.enabled.set(false);
      await render();

      expect(curation.fake.lookUpOnNostr).not.toHaveBeenCalled();
      expect(query('es-nostr-standing')).toBeNull();
      expect(text()).not.toContain('Nostr-Anbindung');
    });
  });

  describe('the teams the content was proposed to', () => {
    it('reads them off the forwardings the content stands in, so a resumed one names them too', async () => {
      curation.forwarded(
        { group: aCollection('team-physik', 'Physik-Redaktion') },
        { group: aCollection('team-chemie', 'Chemie-Redaktion') },
      );
      await render();

      expect(cards()).toHaveLength(2);
      expect(cards()[0].textContent).toContain('Physik-Redaktion');
      expect(cards()[1].textContent).toContain('Chemie-Redaktion');
    });

    it('names where inside a team the content was proposed', async () => {
      curation.forwarded({
        group: aCollection('team-physik', 'Physik-Redaktion'),
        folder: aCollection('folder-1', 'Optik'),
      });
      await render();

      expect(cards()[0].textContent).toContain('Sammlung: Optik');
    });

    it('says it went to the team itself where no collection was picked', async () => {
      curation.forwarded({ group: aCollection('team-physik', 'Physik-Redaktion') });
      await render();

      expect(cards()[0].textContent).toContain('Direkt an die Redaktion');
    });

    it('shows the team’s picture where the repository has one', async () => {
      curation.forwarded({ group: aCollection('team-physik', 'Physik-Redaktion') });
      await render();

      expect(cards()[0].querySelector('img')!.getAttribute('src')).toBe(
        'https://repo.example/physik.png',
      );
    });

    it('draws its own glyph for a team the loaded groups do not name', async () => {
      curation.forwarded({ group: aCollection('team-chemie', 'Chemie-Redaktion') });
      await render();

      expect(cards()[0].querySelector('img')).toBeNull();
      expect(cards()[0].querySelector('.logo-glyph')).not.toBeNull();
    });

    it('draws the exchange up to where it stands, with the outstanding step marked as such', async () => {
      curation.forwarded({ group: aCollection('team-physik', 'Physik-Redaktion') });
      await render();

      const listed = steps(cards()[0]);
      expect(listed.map((step) => step.querySelector('.step-label')!.textContent)).toEqual([
        'Vorschlag übermittelt',
        'Eingang bestätigt',
        'Noch keine Entscheidung erhalten',
      ]);
      expect(listed[2].classList.contains('is-pending')).toBe(true);
      expect(cards()[0].querySelector('.state')!.textContent).toContain('Offen');
    });

    it('dates the submission by the node the save created', async () => {
      curation.forwarded({ group: aCollection('team-physik', 'Physik-Redaktion') });
      curation.hydrated(aNode({ createdAt: '2026-05-06T09:30:00Z' } as never));
      await render();

      expect(steps(cards()[0])[0].querySelector('time')!.textContent).toContain('06.05.2026');
    });

    it('names no moment for a content whose node states no date, rather than an invented one', async () => {
      curation.forwarded({ group: aCollection('team-physik', 'Physik-Redaktion') });
      await render();

      expect(steps(cards()[0])[0].querySelector('time')).toBeNull();
    });

    it('names the step that starts an exchange where there is none', async () => {
      await render();

      expect(cards()).toHaveLength(0);
      expect(text()).toContain('Für diesen Inhalt sind keine Redaktionen hinterlegt');
    });

    it('says nothing of the kind without teams, the view then being the relay’s alone', async () => {
      wlo = fakeWebComponent(false);
      TestBed.overrideProvider(BrowserExtensionCustomWebComponentService, { useValue: wlo.fake });
      await render();

      expect(text()).not.toContain('Für diesen Inhalt sind keine Redaktionen hinterlegt');
    });
  });

  describe('the relay’s half', () => {
    it('reports the standing even for a content that was never sent', async () => {
      await render();

      expect(text()).toContain('Nostr-Anbindung');
      expect(query('es-nostr-standing')).not.toBeNull();
    });

    it('carries the receipt where there was a publication', async () => {
      nostr.fake.receipt.set(aReceipt());
      await render();

      expect(query('es-nostr-receipt')).not.toBeNull();
      expect(text()).toContain('nevent1beispiel');
    });
  });
});
