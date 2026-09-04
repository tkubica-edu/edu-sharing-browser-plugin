import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { FAKE_RELAY_URL, NostrForwardFake, fakeNostrForward } from '../../../../testing/fakes';
import { provideFake } from '../../../../testing/provide-fake';
import { NostrForwardService } from '../../../services/nostr-forward.service';
import { NostrStandingComponent } from './nostr-standing.component';

/**
 * Where the active content stands with the nostr relay. It states something for every content,
 * including one nothing was ever done with — and the order the states are read in is the point:
 * what was actually done outranks what was merely planned, and „nothing is known" must never read
 * as „nothing was sent".
 */
describe('NostrStandingComponent', () => {
  let fixture: ComponentFixture<NostrStandingComponent>;
  let nostr: NostrForwardFake;

  beforeEach(() => {
    nostr = fakeNostrForward();
    TestBed.configureTestingModule({
      imports: [NostrStandingComponent],
      providers: [provideFake(NostrForwardService, nostr.fake)],
    });
    fixture = TestBed.createComponent(NostrStandingComponent);
    fixture.detectChanges();
  });

  function render(): void {
    fixture.detectChanges();
  }

  const text = (): string => fixture.nativeElement.textContent ?? '';
  const label = (): string => fixture.nativeElement.querySelector('.head-label')?.textContent?.trim() ?? '';
  const detail = (): string => fixture.nativeElement.querySelector('.detail')?.textContent?.trim() ?? '';
  const adverse = (): boolean =>
    fixture.nativeElement.querySelector('.standing').classList.contains('is-adverse');

  describe('the state it reports', () => {
    it('is that nothing is there, for a content nothing was done with', () => {
      expect(label()).toBe('Nicht gesendet');
      expect(detail()).toContain(`${FAKE_RELAY_URL} hält keinen Eintrag`);
      expect(adverse()).toBe(false);
    });

    it('is that it is planned, where the forwarding step has the relay ticked', () => {
      nostr.select();
      render();

      expect(label()).toBe('Vorgemerkt');
    });

    it('is that it is published, for a record under this installation own key', () => {
      nostr.holds();
      render();

      expect(label()).toBe('Veröffentlicht');
      expect(detail()).toContain('Das Relay hat den AMB-Eintrag angenommen.');
      expect(adverse()).toBe(false);
    });

    it('says the record was found there, where it came off the relay rather than out of this session', () => {
      nostr.holds({ origin: 'relay' });
      render();

      expect(label()).toBe('Veröffentlicht');
      expect(detail()).toContain('Das Relay hält einen AMB-Eintrag zu diesem Inhalt');
    });

    it('tells a record of somebody else apart, since sending would not replace it', () => {
      nostr.holds({ own: false });
      render();

      expect(label()).toBe('Von einem anderen Absender veröffentlicht');
      expect(detail()).toContain('stellt einen zweiten Eintrag daneben');
      expect(adverse()).toBe(false);
    });

    it('reports a refusal as one, and points at the receipt for the relay own words', () => {
      nostr.holds({ accepted: false });
      render();

      expect(label()).toBe('Vom Relay abgelehnt');
      expect(detail()).toContain(FAKE_RELAY_URL);
      expect(adverse()).toBe(true);
    });

    it('reports a publication that is on its way', () => {
      nostr.fake.sending.set(true);
      render();

      expect(label()).toBe('Wird gesendet');
    });

    it('reports a lookup that is on its way', () => {
      nostr.fake.looking.set(true);
      render();

      expect(label()).toBe('Wird nachgesehen');
    });

    it('reports an attempt that never reached the relay', () => {
      nostr.fake.error.set('Relay nicht erreichbar');
      render();

      expect(label()).toBe('Senden fehlgeschlagen');
      expect(detail()).toContain('Es liegt nichts beim Relay');
      expect(adverse()).toBe(true);
    });

    it('says it does not know, where the lookup itself failed', () => {
      nostr.fake.lookupError.set('Zeitüberschreitung');
      render();

      // Not knowing is not the same as knowing that nothing is there, and only the second may read
      // as „nicht gesendet".
      expect(label()).toBe('Unbekannt');
      expect(detail()).toContain('Möglicherweise ist einer vorhanden');
      expect(adverse()).toBe(true);
    });
  });

  describe('the order the states are read in', () => {
    it('puts what was done above what was planned', () => {
      nostr.select();
      nostr.holds();
      render();

      expect(label()).toBe('Veröffentlicht');
    });

    it('keeps a published record published although a later send failed', () => {
      nostr.holds();
      nostr.fake.error.set('Relay nicht erreichbar');
      render();

      // The record on the relay is the older event, which is true; the failure is what the error
      // line beside this is about.
      expect(label()).toBe('Veröffentlicht');
      expect(text()).toContain('Relay nicht erreichbar');
    });

    it('puts a refusal above a lookup that also failed', () => {
      nostr.holds({ accepted: false });
      nostr.fake.lookupError.set('Zeitüberschreitung');
      render();

      expect(label()).toBe('Vom Relay abgelehnt');
    });

    it('puts a send under way above a failure of the attempt before it', () => {
      nostr.fake.sending.set(true);
      nostr.fake.error.set('Relay nicht erreichbar');
      render();

      expect(label()).toBe('Wird gesendet');
    });

    it('puts not knowing above the plan, since a record may be there already', () => {
      nostr.select();
      nostr.fake.lookupError.set('Zeitüberschreitung');
      render();

      expect(label()).toBe('Unbekannt');
    });
  });

  describe('the two facts that carry the state', () => {
    it('names the relay, which holds whether anything was published or not', () => {
      expect(text()).toContain(FAKE_RELAY_URL);
    });

    it('says where an address that is no relay address has to be corrected', () => {
      nostr.fake.relayUsable.set(false);
      render();

      expect(text()).toContain('Keine Relay-Adresse');
      expect(text()).toContain('In den Einstellungen');
    });

    it('names the key the panel publishes under', () => {
      expect(text()).toContain('npub1beispiel');
    });

    it('says where that key does not exist yet, and when it will', () => {
      nostr.fake.npub.set(null);
      render();

      expect(text()).toContain('Noch kein Schlüssel');
      expect(text()).toContain('beim ersten Senden erzeugt');
    });

    it('says when the publication was made, where there was one', () => {
      nostr.holds();
      render();

      expect(fixture.nativeElement.querySelector('.head-at')?.textContent?.trim()).toBe(
        '06.05.2026, 09:30',
      );
    });

    it('says nothing about a time where nothing was published', () => {
      expect(fixture.nativeElement.querySelector('.head-at')).toBeNull();
    });
  });

  describe('what went wrong', () => {
    it('is stated where the sending failed', () => {
      nostr.fake.error.set('Relay nicht erreichbar');
      render();

      expect(fixture.nativeElement.querySelector('.error')?.textContent).toContain(
        'Relay nicht erreichbar',
      );
    });

    it('is stated where the looking failed, as the other kind of failure it is', () => {
      nostr.fake.lookupError.set('Zeitüberschreitung');
      render();

      expect(text()).toContain('Nachsehen fehlgeschlagen: Zeitüberschreitung');
    });
  });
});
