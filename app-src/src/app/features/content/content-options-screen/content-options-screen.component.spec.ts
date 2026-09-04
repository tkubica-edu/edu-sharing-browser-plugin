import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Connector, Node } from 'ngx-edu-sharing-api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ContentFlowFake,
  CurationFake,
  NavigationFake,
  aNode,
  fakeAuth,
  fakeContentFlow,
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
import { ContentFlowService } from '../../../services/content-flow.service';
import { CurationService } from '../../../services/curation.service';
import { DebugService } from '../../../services/debug.service';
import { NavigationService } from '../../../services/navigation.service';
import { NodeConnectorService } from '../../../services/node-connector.service';
import { NostrForwardService } from '../../../services/nostr-forward.service';
import { ContentOptionsScreenComponent } from './content-options-screen.component';

/** Every step the screen can offer, in the order it offers them. */
const EVERY_SECTION = [
  'overview',
  'editing',
  'editorial-forward',
  'personal-storage',
  'quality',
  'nostr-forward',
] as const;

/**
 * „Inhaltsoptionen": the junction for a content the panel already has. What it decides is which ways on
 * apply — every row is checked against the step it leads to, and „Inhalt bearbeiten" additionally waits
 * for the repository's answer about the connector.
 */
describe('ContentOptionsScreenComponent', () => {
  let fixture: ComponentFixture<ContentOptionsScreenComponent>;
  let navigation: NavigationFake;
  let curation: CurationFake;
  let flow: ContentFlowFake;

  /** What the repository answers about the content's connector. */
  let connector: Connector | null;

  const nodeConnector = {
    connectorFor: vi.fn((_node: Node): Promise<Connector | null> => Promise.resolve(connector)),
  };

  beforeEach(() => {
    connector = null;
    // Re-stated rather than cleared: a test that leaves the answer outstanding does so with
    // `mockReturnValue`, which outlives it — `mockClear` only forgets the calls.
    nodeConnector.connectorFor.mockReset();
    nodeConnector.connectorFor.mockImplementation(() => Promise.resolve(connector));
    navigation = fakeNavigation();
    curation = fakeCuration();
    flow = fakeContentFlow();
    TestBed.configureTestingModule({
      imports: [ContentOptionsScreenComponent],
      providers: [
        provideFake(NavigationService, navigation.fake),
        provideFake(CurationService, curation.fake),
        provideFake(ContentFlowService, flow.fake),
        provideFake(NodeConnectorService, nodeConnector as never),
        provideFake(AuthService, fakeAuth().fake),
        provideFake(DebugService, fakeDebug().fake),
        provideFake(BrowserExtensionCustomWebComponentService, fakeWebComponent().fake),
        provideFake(NostrForwardService, fakeNostrForward().fake),
        // Used for real: it is a derivation over the fakes above, and the screen only reads its
        // snapshot to hand it on to the registry.
        ConditionsService,
      ],
    });
  });

  /** Render the junction with every step reachable unless a test says otherwise. */
  async function render(...reachable: readonly string[]): Promise<void> {
    navigation.offer(...((reachable.length ? reachable : EVERY_SECTION) as never[]));
    fixture = TestBed.createComponent(ContentOptionsScreenComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const rows = (): HTMLButtonElement[] =>
    Array.from(fixture.nativeElement.querySelectorAll('.option-list button.menu-item'));
  const labels = (): string[] =>
    rows().map((row) => row.querySelector('.mi-title')?.textContent?.trim() ?? '');

  /** One row, by the label it carries. */
  function rowFor(label: string): HTMLButtonElement {
    const found = rows().find((row) => row.querySelector('.mi-title')?.textContent?.trim() === label);
    if (!found) throw new Error(`no row „${label}" in: ${labels().join(' | ')}`);
    return found;
  }

  describe('the ways on it offers', () => {
    it('leads with looking at the content, and ends with passing it on', async () => {
      await render();

      expect(labels()).toEqual([
        'Vorschau anzeigen',
        'An Redaktion weiterleiten',
        'Ablageort ändern',
        'Qualität prüfen',
        'Metadaten bearbeiten',
        'Nutzung anzeigen',
        'Inhalt teilen',
        'An Nostr Relay senden',
        'Interaktionen anzeigen',
      ]);
    });

    it('leaves out a step that does not apply to this content', async () => {
      await render('overview', 'quality');

      expect(labels()).not.toContain('An Redaktion weiterleiten');
      expect(labels()).not.toContain('An Nostr Relay senden');
    });

    it('takes the step the row stands for', async () => {
      await render();

      rowFor('Vorschau anzeigen').click();
      rowFor('Inhalt teilen').click();
      rowFor('An Nostr Relay senden').click();

      expect(flow.fake.showOverview).toHaveBeenCalled();
      expect(flow.fake.showShare).toHaveBeenCalled();
      expect(flow.fake.showNostrForward).toHaveBeenCalled();
    });

    it('names the content the options act on', async () => {
      curation.named('Optik');

      await render();

      expect(fixture.nativeElement.querySelector('es-content-card .fc-title')?.textContent).toContain(
        'Optik',
      );
    });
  });

  describe('the steps a sub step gates', () => {
    it('offers the guided walk only where the Qualität view exists', async () => {
      navigation.hideTab('quality', 'quality-check');

      await render();

      expect(labels()).not.toContain('Qualität prüfen');
      expect(labels()).toContain('Metadaten bearbeiten');
    });

    it('offers the exchange with the editorial teams where that view exists', async () => {
      await render();

      expect(labels()).toContain('Interaktionen anzeigen');
    });

    it('leaves it out where it does not', async () => {
      navigation.hideTab('overview', 'interactions');

      await render();

      expect(labels()).not.toContain('Interaktionen anzeigen');
    });

    it('keeps the metadata listed but shut where the criteria come first, and says so', async () => {
      navigation.lockTab('quality', 'metadata');

      await render();

      const metadata = rowFor('Metadaten bearbeiten');
      expect(metadata.disabled).toBe(true);
      expect(metadata.querySelector('.mi-desc')?.textContent?.trim()).toBe(
        'Zuerst die Qualitätsprüfung durchführen.',
      );
    });

    it('describes it plainly once it is open', async () => {
      await render();

      expect(rowFor('Metadaten bearbeiten').querySelector('.mi-desc')?.textContent?.trim()).toBe(
        'Beschreibung des Inhalts ansehen und ändern',
      );
    });
  });

  describe('editing the content', () => {
    it('is not offered while the repository has not answered', async () => {
      curation.hydrated(aNode());
      nodeConnector.connectorFor.mockReturnValue(new Promise(() => undefined));

      await render();

      expect(labels()).not.toContain('Inhalt bearbeiten');
    });

    it('is not offered for a content that opens in no connector', async () => {
      curation.hydrated(aNode());

      await render();

      expect(nodeConnector.connectorFor).toHaveBeenCalled();
      expect(labels()).not.toContain('Inhalt bearbeiten');
    });

    it('is offered once the answer is in, second in the list', async () => {
      curation.hydrated(aNode());
      connector = { id: 'ONLYOFFICE' } as Connector;

      await render();

      expect(labels()[1]).toBe('Inhalt bearbeiten');
    });

    it('opens the content where it is edited', async () => {
      curation.hydrated(aNode());
      connector = { id: 'ONLYOFFICE' } as Connector;
      await render();

      rowFor('Inhalt bearbeiten').click();

      expect(flow.fake.edit).toHaveBeenCalled();
    });

    it('is not asked about at all where no node is loaded', async () => {
      await render();

      expect(nodeConnector.connectorFor).not.toHaveBeenCalled();
    });

    it('drops the previous content answer before asking about the new one', async () => {
      curation.hydrated(aNode({ ref: { id: 'node-1', repo: 'local' } } as never));
      connector = { id: 'ONLYOFFICE' } as Connector;
      await render();
      expect(labels()).toContain('Inhalt bearbeiten');

      connector = null;
      curation.hydrated(aNode({ ref: { id: 'node-2', repo: 'local' } } as never));
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(labels()).not.toContain('Inhalt bearbeiten');
    });
  });

  describe('while the content is being checked', () => {
    it('refuses every way on, and says what is happening', async () => {
      await render();

      flow.fake.deciding.set(true);
      fixture.detectChanges();

      expect(rows().every((row) => row.disabled)).toBe(true);
      expect(fixture.nativeElement.textContent).toContain('Der Inhalt wird geprüft');
    });
  });
});
