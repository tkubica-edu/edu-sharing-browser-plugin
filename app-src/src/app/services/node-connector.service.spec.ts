import { TestBed } from '@angular/core/testing';
import { Connector, EduSharingApiConfiguration, Node, ConnectorService } from 'ngx-edu-sharing-api';
import { firstValueFrom } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';

import { ConnectorsFake, aNode, fakeApiConfiguration, fakeConnectors } from '../../testing/fakes';
import { provideFake } from '../../testing/provide-fake';
import { NodeConnectorService } from './node-connector.service';

const REPO_ROOT = 'https://repo.example.org/edu-sharing/rest';

/** The OnlyOffice connector, as the repository reports it. */
function onlyOffice(overrides: Partial<Connector> = {}): Partial<Connector> {
  return {
    id: 'ONLY_OFFICE',
    hasViewMode: true,
    filetypes: [{ mimetype: 'application/vnd.oasis.opendocument.text' }],
    ...overrides,
  };
}

/** A node of the type that connector opens. */
function aDocument(overrides: Partial<Node> = {}): Node {
  return aNode({ mimetype: 'application/vnd.oasis.opendocument.text', ...overrides });
}

describe('NodeConnectorService', () => {
  let connectorFor: NodeConnectorService;
  let connectors: ConnectorsFake;

  beforeEach(() => {
    connectors = fakeConnectors();
    TestBed.configureTestingModule({
      providers: [
        provideFake(ConnectorService, connectors.fake),
        provideFake(EduSharingApiConfiguration, fakeApiConfiguration(REPO_ROOT).fake),
      ],
    });
    connectorFor = TestBed.inject(NodeConnectorService);
  });

  describe('observeConnectorForNode', () => {
    it('finds the connector whose filetype the node is', async () => {
      connectors.offers([onlyOffice()]);

      const found = await firstValueFrom(connectorFor.observeConnectorForNode(aDocument()));

      expect(found?.id).toBe('ONLY_OFFICE');
    });

    it('looks at the simple connectors too', async () => {
      connectors.offers([], [onlyOffice({ id: 'SIMPLE' })]);

      expect((await firstValueFrom(connectorFor.observeConnectorForNode(aDocument())))?.id).toBe('SIMPLE');
    });

    it('finds none for a node of another type', async () => {
      connectors.offers([onlyOffice()]);

      expect(await firstValueFrom(connectorFor.observeConnectorForNode(aNode()))).toBeNull();
    });

    it('finds none where the repository offers no connectors at all', async () => {
      expect(await firstValueFrom(connectorFor.observeConnectorForNode(aDocument()))).toBeNull();
    });

    it('offers a view-only connector to a reader, and a writing one only to a writer', async () => {
      connectors.offers([onlyOffice({ hasViewMode: false })]);

      expect(await firstValueFrom(connectorFor.observeConnectorForNode(aDocument()))).toBeNull();
      expect(
        await firstValueFrom(
          connectorFor.observeConnectorForNode(aDocument({ access: ['Write'] } as Partial<Node>)),
        ),
      ).not.toBeNull();
    });

    it('refines a zip by what it says it holds', async () => {
      const zipped = {
        id: 'H5P',
        hasViewMode: true,
        filetypes: [
          { mimetype: 'application/zip', ccressourcetype: 'h5p', ccressourceversion: '1.0' },
        ],
      };
      connectors.offers([zipped]);

      const h5p = aNode({
        mimetype: 'application/zip',
        properties: { 'ccm:ccressourcetype': ['h5p'], 'ccm:ccressourceversion': ['1.0'] },
      } as Partial<Node>);
      const other = aNode({
        mimetype: 'application/zip',
        properties: { 'ccm:ccressourcetype': ['scorm'] },
      } as Partial<Node>);

      expect(await firstValueFrom(connectorFor.observeConnectorForNode(h5p))).not.toBeNull();
      expect(await firstValueFrom(connectorFor.observeConnectorForNode(other))).toBeNull();
    });

    it('refines by the editor the filetype names, where it names one', async () => {
      connectors.offers([
        onlyOffice({
          filetypes: [
            { mimetype: 'application/vnd.oasis.opendocument.text', editorType: 'ONLYOFFICE' },
          ],
        }),
      ]);

      expect(
        await firstValueFrom(
          connectorFor.observeConnectorForNode(
            aDocument({ properties: { 'ccm:editorType': ['ONLYOFFICE'] } } as Partial<Node>),
          ),
        ),
      ).not.toBeNull();
      expect(await firstValueFrom(connectorFor.observeConnectorForNode(aDocument()))).toBeNull();
    });
  });

  describe('observeIsOnlyOffice', () => {
    it('says so for the connector the content flow branches on', async () => {
      connectors.offers([onlyOffice()]);

      await expect(firstValueFrom(connectorFor.observeIsOnlyOffice(aDocument()))).resolves.toBe(true);
    });

    it('says no for another connector, and for none', async () => {
      connectors.offers([onlyOffice({ id: 'SOMETHING_ELSE' })]);
      await expect(firstValueFrom(connectorFor.observeIsOnlyOffice(aDocument()))).resolves.toBe(false);

      connectors.offers([]);
      await expect(firstValueFrom(connectorFor.observeIsOnlyOffice(aDocument()))).resolves.toBe(false);
    });
  });

  describe('connectorFor', () => {
    it('answers with the connector the node opens in', async () => {
      connectors.offers([onlyOffice()]);

      expect((await connectorFor.connectorFor(aDocument()))?.id).toBe('ONLY_OFFICE');
    });

    it('answers with none where the list cannot be read — the flow must not claim otherwise', async () => {
      connectors.fails();

      await expect(connectorFor.connectorFor(aDocument())).resolves.toBeNull();
    });
  });

  describe('getConnectorUrl', () => {
    it('names the page the Bearbeitungsmodus takes the tab to', () => {
      const url = connectorFor.getConnectorUrl(aDocument(), { id: 'ONLY_OFFICE' } as Connector);

      expect(url).toBe(
        'https://repo.example.org/edu-sharing/eduservlet/connector?' +
          'connectorId=ONLY_OFFICE&nodeId=2c4d6b1a-8f3e-4c2b-9a10-7d5e6f8b0c31',
      );
    });

    it('derives it from the repository rather than from its REST root', () => {
      expect(connectorFor.getConnectorUrl(aDocument(), { id: 'X' } as Connector)).not.toContain('/rest/');
    });
  });
});
