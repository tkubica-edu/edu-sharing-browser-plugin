import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  CurationFake,
  EditorialGroupsFake,
  NavigationFake,
  NostrForwardFake,
  WebComponentFake,
  aCollection,
  anEditorialGroup,
  aReceipt,
  fakeCuration,
  fakeEditorialGroups,
  fakeNavigation,
  fakeNostrForward,
  fakeWebComponent,
} from '../../../../testing/fakes';
import { provideFake } from '../../../../testing/provide-fake';
import { BrowserExtensionCustomWebComponentService } from '../../../services/browser-extension-custom-web-component.service';
import { BusyService } from '../../../services/busy.service';
import { CurationService } from '../../../services/curation.service';
import { EditorialGroupsService } from '../../../services/editorial-groups.service';
import { NavigationService } from '../../../services/navigation.service';
import { NostrForwardService } from '../../../services/nostr-forward.service';
import { EditorialForwardScreenComponent } from './editorial-forward-screen.component';

/** Two teams: one that takes the content directly, and one the content is filed inside. */
const DIRECT = anEditorialGroup('team-direct');
const FOLDERED = anEditorialGroup('team-folders', [aCollection('folder-1', 'Physik')]);

/**
 * „An Redaktionen weiterleiten": the two kinds of target this step offers, each shown where it applies.
 * Nothing is written here — what the screen decides is what the save on the way on will carry out — so
 * what it is asserted on is which service a tick reached and what the row then says.
 */
describe('EditorialForwardScreenComponent', () => {
  let fixture: ComponentFixture<EditorialForwardScreenComponent>;
  let curation: CurationFake;
  let groups: EditorialGroupsFake;
  let wlo: WebComponentFake;
  let nostr: NostrForwardFake;
  let navigation: NavigationFake;

  beforeEach(() => {
    curation = fakeCuration();
    groups = fakeEditorialGroups([DIRECT, FOLDERED]);
    wlo = fakeWebComponent(true);
    nostr = fakeNostrForward();
    navigation = fakeNavigation();
    TestBed.configureTestingModule({
      imports: [EditorialForwardScreenComponent],
      providers: [
        provideFake(CurationService, curation.fake),
        provideFake(EditorialGroupsService, groups.fake),
        provideFake(BrowserExtensionCustomWebComponentService, wlo.fake),
        provideFake(NostrForwardService, nostr.fake),
        provideFake(NavigationService, navigation.fake),
        // Used for real: it is `saving() || assigning()` over the curation fake, and faking it would
        // move the rule that a write closes the picking out of the service that holds it.
        BusyService,
      ],
    });
  });

  async function render(): Promise<void> {
    fixture = TestBed.createComponent(EditorialForwardScreenComponent);
    fixture.detectChanges();
    await settle();
  }

  async function settle(): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const text = (): string => fixture.nativeElement.textContent ?? '';

  const query = <T extends Element>(selector: string): T | null =>
    fixture.nativeElement.querySelector(selector);

  /** The rows of the teams' list, in the order the step offers them. */
  function teamRows(): HTMLLIElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll('ul.groups:not(.nostr) li.group'));
  }

  /** One team's row, by the name it is shown under. */
  function teamRow(name: string): HTMLLIElement {
    const found = teamRows().find((row) => (row.textContent ?? '').includes(name));
    if (!found) throw new Error(`no row for ${name}`);
    return found;
  }

  /** The relay's row, which is a list of its own below the teams. */
  function relayRow(): HTMLLIElement {
    return query<HTMLLIElement>('ul.groups.nostr li.group')!;
  }

  /** Tick a row the way a person does — the whole head is the box's label. */
  async function tick(row: HTMLElement, checked = true): Promise<void> {
    const input = row.querySelector('input')!;
    input.checked = checked;
    input.dispatchEvent(new Event('change'));
    await settle();
  }

  describe('what the step promises', () => {
    it('names the content it is about', async () => {
      curation.named('Optik');
      await render();

      expect(text()).toContain('Wähle die Redaktionen, an die');
      expect(text()).toContain('Optik');
    });

    it('stands in for a content with no name of its own', async () => {
      await render();

      expect(text()).toContain('dieser Inhalt');
    });

    it('promises no Redaktionen where there are none to offer', async () => {
      wlo = fakeWebComponent(false);
      TestBed.overrideProvider(BrowserExtensionCustomWebComponentService, { useValue: wlo.fake });
      await render();

      expect(text()).toContain('Wähle, wohin');
      expect(text()).not.toContain('Wähle die Redaktionen');
    });
  });

  describe('the editorial teams', () => {
    it('loads them and has a collection proposed, once and only where they are shown', async () => {
      await render();

      expect(groups.fake.load).toHaveBeenCalledTimes(1);
      expect(groups.fake.recommendCollection).toHaveBeenCalledTimes(1);
    });

    it('asks for neither where the repository offers no teams, both answering a list nothing renders', async () => {
      wlo = fakeWebComponent(false);
      TestBed.overrideProvider(BrowserExtensionCustomWebComponentService, { useValue: wlo.fake });
      await render();

      expect(groups.fake.load).not.toHaveBeenCalled();
      expect(groups.fake.recommendCollection).not.toHaveBeenCalled();
      expect(teamRows()).toHaveLength(0);
    });

    it('waits for the collections and the collections inside them together', async () => {
      groups.loading();
      await render();

      expect(text()).toContain('Die Redaktionen werden geladen');
    });

    it('reports a repository that would not hand them back', async () => {
      groups.fails('HTTP 500');
      await render();

      expect(text()).toContain('Die Redaktionen konnten nicht geladen werden: HTTP 500');
    });

    it('says as much where the repository has none configured', async () => {
      groups = fakeEditorialGroups();
      groups.unconfigured();
      TestBed.overrideProvider(EditorialGroupsService, { useValue: groups.fake });
      await render();

      expect(text()).toContain('Für dieses Repository sind keine Redaktionen konfiguriert');
    });

    it('names how many the config names that the repository did not hand back', async () => {
      groups.missing(2);
      await render();

      expect(text()).toContain('2 konfigurierte Redaktionen sind derzeit nicht verfügbar');
    });

    it('says it in the singular for one', async () => {
      groups.missing(1);
      await render();

      expect(text()).toContain('1 konfigurierte Redaktion ist derzeit nicht verfügbar');
    });

    it('offers a row per team, and marks the ticked ones', async () => {
      await render();

      expect(teamRows()).toHaveLength(2);
      expect(teamRow('team-direct').classList.contains('is-selected')).toBe(false);

      await tick(teamRow('team-direct'));

      expect(groups.fake.toggle).toHaveBeenCalledWith(DIRECT, true);
      expect(teamRow('team-direct').classList.contains('is-selected')).toBe(true);
    });

    it('takes a tick back', async () => {
      await render();
      await tick(teamRow('team-direct'));

      await tick(teamRow('team-direct'), false);

      expect(groups.fake.toggle).toHaveBeenLastCalledWith(DIRECT, false);
      expect(teamRow('team-direct').classList.contains('is-selected')).toBe(false);
    });

    it('draws the team’s own glyph where the repository has no picture of it', async () => {
      await render();

      expect(teamRow('team-direct').querySelector('img')).toBeNull();
      expect(teamRow('team-direct').querySelector('.logo-glyph')).not.toBeNull();
    });

    it('shows the picture where there is one', async () => {
      const withLogo = anEditorialGroup('team-logo', [], 'https://repo.example/logo.png');
      groups = fakeEditorialGroups([withLogo]);
      TestBed.overrideProvider(EditorialGroupsService, { useValue: groups.fake });
      await render();

      expect(teamRow('team-logo').querySelector('img')!.getAttribute('src')).toBe(
        'https://repo.example/logo.png',
      );
    });
  });

  describe('where inside a team the content lands', () => {
    it('offers the choice for a team that has collections inside it', async () => {
      await render();

      const folder = teamRow('team-folders').querySelector('button.folder')!;
      expect(folder.textContent).toContain('Sammlung auswählen');
    });

    it('says the row means nothing to choose for a team without them', async () => {
      await render();

      expect(teamRow('team-direct').querySelector('button.folder')).toBeNull();
      expect(teamRow('team-direct').textContent).toContain('Keine Sammlungsauswahl erforderlich');
    });

    it('opens the step that picks it, on the group it was asked for', async () => {
      await render();

      teamRow('team-folders').querySelector<HTMLButtonElement>('button.folder')!.click();
      await settle();

      expect(groups.fake.pick).toHaveBeenCalledWith(FOLDERED);
      expect(navigation.fake.go).toHaveBeenCalledWith('select-collection');
    });

    it('names a picked collection as chosen', async () => {
      groups.picked(FOLDERED, aCollection('folder-1', 'Physik'));
      await render();

      expect(teamRow('team-folders').textContent).toContain('Ausgewählte Sammlung: Physik');
    });

    it('names a proposed one as a proposal for as long as it is one', async () => {
      groups.picked(FOLDERED, aCollection('folder-1', 'Physik'), true);
      await render();

      expect(teamRow('team-folders').textContent).toContain('Empfohlene Sammlung: Physik');
    });

    it('shows the wait for the proposal in the row its answer will land in', async () => {
      groups.fake.recommending.set(true);
      await render();

      expect(teamRow('team-folders').textContent).toContain('Empfohlene Sammlung wird ermittelt');
      expect(teamRow('team-folders').querySelector('es-spinner')).not.toBeNull();
    });
  });

  describe('while the way on writes what was picked', () => {
    it('closes the picking, since what the save reads is settled the moment it starts', async () => {
      curation.fake.saving.set(true);
      await render();

      expect(query('ul.groups')!.classList.contains('is-locked')).toBe(true);
      expect(teamRow('team-direct').querySelector('input')!.disabled).toBe(true);
      expect(
        teamRow('team-folders').querySelector<HTMLButtonElement>('button.folder')!.disabled,
      ).toBe(true);
    });

    it('refuses to open the picking step, which would leave a group marked with no step on it', async () => {
      curation.fake.assigning.set(true);
      await render();

      teamRow('team-folders').querySelector<HTMLButtonElement>('button.folder')!.click();
      await settle();

      expect(groups.fake.pick).not.toHaveBeenCalled();
      expect(navigation.fake.go).not.toHaveBeenCalled();
    });

    it('says why the rows cannot be answered', async () => {
      curation.fake.saving.set(true);
      await render();

      expect(teamRow('team-direct').querySelector('.head')!.getAttribute('title')).toBeTruthy();
    });
  });

  describe('the relay below the teams', () => {
    it('is a target of this step wherever the settings let the panel speak to one', async () => {
      wlo = fakeWebComponent(false);
      TestBed.overrideProvider(BrowserExtensionCustomWebComponentService, { useValue: wlo.fake });
      await render();

      expect(relayRow().textContent).toContain('An Nostr Relay weiterleiten');
    });

    it('is gone with the connection itself', async () => {
      nostr.fake.enabled.set(false);
      await render();

      expect(query('ul.groups.nostr')).toBeNull();
    });

    it('names the relay a publication would go to, which is what the choice rests on', async () => {
      await render();

      expect(relayRow().textContent).toContain(nostr.fake.relayUrl());
      expect(relayRow().textContent).toContain('AMB-Eintrag');
    });

    it('ticks the relay, and says what pressing on then means', async () => {
      await render();

      expect(text()).not.toContain('Das ist eine Veröffentlichung');

      await tick(relayRow());

      expect(nostr.fake.selected()).toBe(true);
      expect(text()).toContain('Das ist eine Veröffentlichung');
    });

    it('shows the send while it runs, in the row that made the choice', async () => {
      nostr.select();
      nostr.fake.sending.set(true);
      await render();

      expect(relayRow().textContent).toContain('Der Eintrag wird an');
      expect(relayRow().querySelector('es-spinner')).not.toBeNull();
      expect(relayRow().querySelector('input')!.disabled).toBe(true);
    });

    it('reports what a publication of this session left behind', async () => {
      // The whole receipt rather than the fake's shorthand: the row's own statement stands over the
      // receipt view, which reads the signed event out of it.
      nostr.fake.selected.set(true);
      nostr.fake.receipt.set(aReceipt());
      await render();

      expect(relayRow().textContent).toContain('Gesendet an');
      expect(relayRow().querySelector('input')!.disabled).toBe(true);
    });

    it('reports a record that was already on the relay as one that is there rather than sent', async () => {
      nostr.fake.receipt.set(aReceipt({ origin: 'relay' }));
      await render();

      expect(relayRow().textContent).toContain('Liegt bereits bei');
    });

    it('reports a publication that did not get through', async () => {
      nostr.fake.error.set('Das Relay hat den Eintrag abgelehnt.');
      await render();

      expect(text()).toContain('Der Eintrag konnte nicht an das Relay gesendet werden');
      expect(text()).toContain('Das Relay hat den Eintrag abgelehnt.');
    });

    it('carries the receipt of what went out', async () => {
      await render();

      expect(query('es-nostr-receipt')).not.toBeNull();
    });
  });

  describe('what the way on reports back', () => {
    it('says the content could not be handed on, where the picking can be answered differently', async () => {
      curation.fake.assignError.set('Die Sammlung nimmt keine Inhalte auf.');
      await render();

      expect(text()).toContain('Der Inhalt konnte nicht weitergeleitet werden');
      expect(text()).toContain('Die Sammlung nimmt keine Inhalte auf.');
    });

    it('says the write itself failed', async () => {
      curation.fake.saveError.set('HTTP 403');
      await render();

      expect(text()).toContain('Speichern fehlgeschlagen: HTTP 403');
    });
  });
});
