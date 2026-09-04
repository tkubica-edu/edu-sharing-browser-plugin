import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NostrForwardFake, aReceipt, fakeNostrForward } from '../../../../testing/fakes';
import { provideFake } from '../../../../testing/provide-fake';
import { NostrForwardService } from '../../../services/nostr-forward.service';
import { NostrReceiptComponent } from './nostr-receipt.component';

/**
 * The record on the relay, in full. It shows the event as it was actually sent rather than a
 * description of it — a receipt that has been summarised is the one thing that cannot be checked
 * against the relay — so what this spec pins is that nothing published is dropped on the way to the
 * screen, and that the commands offered would really fetch it back.
 */
describe('NostrReceiptComponent', () => {
  let fixture: ComponentFixture<NostrReceiptComponent>;
  let nostr: NostrForwardFake;

  /** What the panel put on the clipboard. */
  let clipboard: string[];

  /** Whether writing to it is allowed — a browser may refuse. */
  let clipboardRefuses = false;

  beforeEach(() => {
    clipboard = [];
    clipboardRefuses = false;
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: vi.fn((value: string) => {
          if (clipboardRefuses) return Promise.reject(new Error('denied'));
          clipboard.push(value);
          return Promise.resolve();
        }),
      },
    });
    nostr = fakeNostrForward();
    TestBed.configureTestingModule({
      imports: [NostrReceiptComponent],
      providers: [provideFake(NostrForwardService, nostr.fake)],
    });
    fixture = TestBed.createComponent(NostrReceiptComponent);
    fixture.detectChanges();
  });

  afterEach(() => vi.unstubAllGlobals());

  function render(): void {
    fixture.detectChanges();
  }

  const text = (): string => fixture.nativeElement.textContent ?? '';
  const tags = (): string[] =>
    Array.from(fixture.nativeElement.querySelectorAll('li.tag')).map((line) => {
      const entry = line as HTMLElement;
      return `${entry.querySelector('.tag-key')?.textContent} = ${entry.querySelector('.tag-value')?.textContent}`;
    });
  const lookups = (): { label: string; value: string }[] =>
    Array.from(fixture.nativeElement.querySelectorAll('li.lookup')).map((entry) => ({
      label: (entry as HTMLElement).querySelector('.lookup-label')?.textContent?.trim() ?? '',
      value: (entry as HTMLElement).querySelector('code')?.textContent?.trim() ?? '',
    }));

  it('shows nothing at all where no record is known', () => {
    expect(fixture.nativeElement.querySelector('.receipt')).toBeNull();
  });

  describe('what it says happened', () => {
    it('is that the record was sent, for a publication this session made', () => {
      nostr.holds();
      render();

      expect(text()).toContain('An das Nostr-Relay gesendet');
      expect(text()).toContain('Diese Daten wurden gesendet');
    });

    it('is that it lies there, for one the relay handed back', () => {
      nostr.holds({ origin: 'relay' });
      render();

      expect(text()).toContain('Beim Nostr-Relay hinterlegt');
      expect(text()).toContain('Diese Daten liegen beim Relay');
    });

    it('is that it was refused, and the receipt says so in its border', () => {
      nostr.holds({ accepted: false, message: 'blocked: pubkey not allowed' });
      render();

      expect(text()).toContain('Vom Nostr-Relay abgelehnt');
      expect(fixture.nativeElement.querySelector('.receipt').classList).toContain('is-rejected');
      expect(text()).toContain('OK: false, abgelehnt');
      expect(text()).toContain('blocked: pubkey not allowed');
    });

    it('quotes the relay verdict only for a publication, a fetched record having none', () => {
      nostr.holds({ origin: 'relay' });
      render();

      expect(text()).not.toContain('Antwort des Relays');
      expect(text()).toContain('Veröffentlicht am');
      expect(text()).toContain('06.05.2026, 11:30');
    });
  });

  describe('the four things the record is found by', () => {
    beforeEach(() => {
      nostr.holds();
      render();
    });

    it('names the relay, the kind and the identifier', () => {
      expect(text()).toContain('wss://relay.test');
      expect(text()).toContain('30142');
      expect(text()).toContain('https://example.org/optik');
    });

    it('says that a later record under the same identifier replaces this one', () => {
      expect(text()).toContain('ersetzt diesen, statt neben ihm zu stehen');
    });

    it('names the sender, and says the key never leaves this browser', () => {
      expect(text()).toContain('npub1beispiel');
      expect(text()).toContain('Der Schlüssel dieser Installation.');
    });

    it('says outright where the key is not this installation own', () => {
      nostr.holds({ own: false });
      render();

      expect(text()).toContain('Ein fremder Schlüssel');
      expect(text()).toContain('stellt einen zweiten Eintrag daneben');
    });
  });

  describe('what was published', () => {
    it('is the event own tags, key by key', () => {
      nostr.holds();
      render();

      expect(tags()).toEqual([
        'd = https://example.org/optik',
        'name = Optik',
        't = Physik',
      ]);
    });

    it('keeps everything a tag carries beyond its value, so nothing published is hidden', () => {
      nostr.holds({
        event: { ...aReceipt().event, tags: [['p', 'pk2', 'wss://relay.test', 'author']] },
      } as never);
      render();

      expect(tags()).toEqual(['p = pk2 · wss://relay.test · author']);
    });

    it('drops the empty parts of a tag rather than showing separators for them', () => {
      nostr.holds({ event: { ...aReceipt().event, tags: [['a', 'wert', '']] } } as never);
      render();

      expect(tags()).toEqual(['a = wert']);
    });

    it('is offered in the raw as well, exactly as a relay stores it', () => {
      nostr.holds();
      render();

      const raw = fixture.nativeElement.querySelector('.raw pre')?.textContent ?? '';
      expect(JSON.parse(raw)).toEqual(nostr.fake.receipt()!.event);
    });
  });

  describe('how it can be checked', () => {
    beforeEach(() => {
      nostr.holds();
      render();
    });

    it('offers the ways from the narrowest to the widest', () => {
      expect(lookups().map((lookup) => lookup.label)).toEqual([
        'Dieses Event holen',
        'Den aktuellen Stand holen',
        'Alles von dieser Installation',
        'Ohne Werkzeug, nur WebSocket',
        'Im Browser ansehen',
      ]);
    });

    it('addresses this one event by its reference, and the record by its address', () => {
      expect(lookups()[0].value).toBe('nak fetch nevent1beispiel');
      expect(lookups()[1].value).toBe('nak fetch naddr1beispiel');
    });

    it('asks for everything under this key on this relay', () => {
      expect(lookups()[2].value).toBe('nak req -k 30142 -a pk1 wss://relay.test');
    });

    it('offers the same over the bare protocol, by event id', () => {
      expect(lookups()[3].value).toContain('"ids":["e1"]');
      expect(lookups()[3].value).toContain('websocat wss://relay.test');
    });

    it('offers the one that is an address as a link as well', () => {
      const open = fixture.nativeElement.querySelectorAll('a.lookup-open');
      expect(open).toHaveLength(1);
      expect(open[0].getAttribute('href')).toBe('https://njump.me/nevent1beispiel');
      expect(open[0].getAttribute('rel')).toBe('noopener noreferrer');
    });
  });

  describe('copying a command', () => {
    beforeEach(() => {
      nostr.holds();
      render();
    });

    /** The copy button of one lookup row. */
    function copyButton(index: number): HTMLButtonElement {
      return fixture.nativeElement.querySelectorAll('button.lookup-copy')[index];
    }

    it('puts it on the clipboard, since it is made to be run elsewhere', async () => {
      copyButton(0).click();
      await fixture.whenStable();

      expect(clipboard).toEqual(['nak fetch nevent1beispiel']);
    });

    it('says which one was copied, and only that one', async () => {
      copyButton(0).click();
      await fixture.whenStable();
      render();

      expect(copyButton(0).getAttribute('title')).toBe('Kopiert');
      expect(copyButton(1).getAttribute('title')).toBe('Kopieren');
    });

    it('copies the whole event where that is what was asked for', async () => {
      (fixture.nativeElement.querySelector('.raw button') as HTMLButtonElement).click();
      await fixture.whenStable();
      render();

      expect(JSON.parse(clipboard[0])).toEqual(nostr.fake.receipt()!.event);
      expect(fixture.nativeElement.querySelector('.raw button')?.textContent?.trim()).toBe('Kopiert');
    });

    it('says nothing was copied where the browser refused', async () => {
      clipboardRefuses = true;

      copyButton(0).click();
      await fixture.whenStable();
      render();

      // The value is on screen and selectable either way, so the refusal is not reported as an error.
      expect(copyButton(0).getAttribute('title')).toBe('Kopieren');
    });
  });
});
