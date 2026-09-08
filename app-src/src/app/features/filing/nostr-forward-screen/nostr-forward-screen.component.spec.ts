import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  CurationFake,
  NostrForwardFake,
  aReceipt,
  fakeCuration,
  fakeNostrForward,
} from '../../../../testing/fakes';
import { provideFake } from '../../../../testing/provide-fake';
import { CurationService } from '../../../services/curation.service';
import { NostrForwardService } from '../../../services/nostr-forward.service';
import { NostrForwardScreenComponent } from './nostr-forward-screen.component';

/** What the record needs at the least: an address the resource is reachable under, and a title. */
const MINIMAL = { 'ccm:wwwurl': ['https://example.org/optik'], 'cclom:title': ['Optik'] };

/**
 * „An Nostr Relay senden": publishing a content the panel already has. Nothing is edited here, so what
 * the screen is asserted on is the one refusal it can state before anything goes out — a content AMB has
 * nothing to identify the resource by — and the count it puts on what the record carries.
 */
describe('NostrForwardScreenComponent', () => {
  let fixture: ComponentFixture<NostrForwardScreenComponent>;
  let curation: CurationFake;
  let nostr: NostrForwardFake;

  beforeEach(() => {
    curation = fakeCuration();
    nostr = fakeNostrForward();
    TestBed.configureTestingModule({
      imports: [NostrForwardScreenComponent],
      providers: [
        provideFake(CurationService, curation.fake),
        provideFake(NostrForwardService, nostr.fake),
      ],
    });
  });

  async function render(): Promise<void> {
    fixture = TestBed.createComponent(NostrForwardScreenComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const text = (): string => fixture.nativeElement.textContent ?? '';

  const query = <T extends Element>(selector: string): T | null =>
    fixture.nativeElement.querySelector(selector);

  /** One fact of the summary, by the term it is listed under. */
  function fact(term: string): string {
    const terms: HTMLElement[] = Array.from(fixture.nativeElement.querySelectorAll('dt'));
    const found = terms.find((entry) => (entry.textContent ?? '').includes(term));
    if (!found) throw new Error(`no fact for ${term}`);
    return found.nextElementSibling?.textContent?.trim() ?? '';
  }

  it('asks the relay what it already holds about this content, since nothing about it is kept here', async () => {
    curation.describes(MINIMAL);
    await render();

    expect(curation.fake.lookUpOnNostr).toHaveBeenCalledTimes(1);
  });

  it('names the content it is about', async () => {
    curation.named('Optik');
    curation.describes(MINIMAL);
    await render();

    expect(text()).toContain('Optik');
    expect(text()).toContain('als AMB-Eintrag an ein Nostr-Relay gesendet');
  });

  it('stands in for a content with no name of its own', async () => {
    curation.describes(MINIMAL);
    await render();

    expect(text()).toContain('Dieser Inhalt');
  });

  it('reports where it stands with the relay before anything is acted on', async () => {
    curation.describes(MINIMAL);
    await render();

    expect(query('es-nostr-standing')).not.toBeNull();
  });

  it('names the record’s identity, which is the address the relay holds it under', async () => {
    curation.describes(MINIMAL);
    await render();

    expect(fact('Kennung')).toBe('https://example.org/optik');
    expect(fact('Name')).toBe('Optik');
  });

  it('says the record carries nothing but the two, where it carries nothing else', async () => {
    curation.describes(MINIMAL);
    await render();

    expect(fact('Weitere Felder')).toContain('0 Felder');
    expect(fact('Weitere Felder')).toContain('nur Adresse und Titel');
  });

  it('counts what the record carries beyond them', async () => {
    curation.describes({
      ...MINIMAL,
      'cclom:general_description': ['Über die Optik'],
      'cclom:general_keyword': ['Physik', 'Licht'],
    });
    await render();

    expect(fact('Weitere Felder')).toContain('2 Felder');
    expect(fact('Weitere Felder')).not.toContain('nur Adresse und Titel');
  });

  it('says it in the singular for one', async () => {
    curation.describes({ ...MINIMAL, 'cclom:general_description': ['Über die Optik'] });
    await render();

    expect(fact('Weitere Felder')).toContain('1 Feld');
  });

  it('says a second send replaces the record rather than standing one beside it', async () => {
    curation.describes(MINIMAL);
    await render();

    expect(text()).toContain('ersetzt den vorhandenen Eintrag beim Relay');
  });

  it('names what is missing where AMB has nothing to identify the resource by', async () => {
    curation.describes({ 'cclom:title': ['Optik'] }, null);
    await render();

    expect(query('.summary')).toBeNull();
    expect(text()).toContain('Für diesen Inhalt fehlt, was AMB mindestens verlangt');
    expect(text()).toContain('ccm:wwwurl');
  });

  it('names it for a content with an address but no title, the record needing both', async () => {
    curation.describes({ 'ccm:wwwurl': ['https://example.org/optik'] });
    await render();

    expect(query('.summary')).toBeNull();
    expect(text()).toContain('Für diesen Inhalt fehlt, was AMB mindestens verlangt');
  });

  it('falls back to the page the content is where the metadata names no address of its own', async () => {
    curation.describes({ 'cclom:title': ['Optik'] });
    await render();

    expect(fact('Kennung')).toBe('https://example.org/optik');
  });

  it('carries the receipt of what went out', async () => {
    curation.describes(MINIMAL);
    nostr.fake.receipt.set(aReceipt());
    await render();

    expect(query('es-nostr-receipt')).not.toBeNull();
    expect(text()).toContain('nevent1beispiel');
  });
});
