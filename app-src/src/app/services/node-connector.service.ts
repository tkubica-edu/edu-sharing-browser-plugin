import { inject, Injectable } from '@angular/core';
import {
  Connector,
  ConnectorFileType,
  ConnectorService,
  EduSharingApiConfiguration,
  Node,
  RestConstants
} from 'ngx-edu-sharing-api';
import { firstValueFrom, map, Observable } from 'rxjs';

/** The OnlyOffice connector's id, as the repository reports it. */
const ONLY_OFFICE_CONNECTOR_ID = 'ONLY_OFFICE';

// Whether a node is opened *in* a connector (OnlyOffice and friends) rather than merely
// downloaded — the fact the content flow branches on: a node that opens in a connector is edited
// there, so the panel accompanies that editing (Bearbeitungsmodus) instead of jumping straight
// into the Qualitätsprüfung.
@Injectable({ providedIn: 'root' })
export class NodeConnectorService {
  private connectors = inject(ConnectorService);
  private apiConfig = inject(EduSharingApiConfiguration);

  /** The connector that would open this node, or null. Emits again when the login changes. */
  observeConnectorForNode(node: Node): Observable<Connector | null> {
    return this.connectors.observeConnectorList().pipe(
      map((list) => {
        const all = [...(list?.connectors ?? []), ...(list?.simpleConnectors ?? [])];
        const canWrite = node.access?.includes(RestConstants.ACCESS_WRITE) ?? false;
        return (
          all.find(
            (connector) =>
              (connector.hasViewMode || canWrite) && matchesFiletype(node, connector) != null,
          ) ?? null
        );
      }),
    );
  }

  /** Whether the node opens in OnlyOffice. */
  observeIsOnlyOffice(node: Node): Observable<boolean> {
    return this.observeConnectorForNode(node).pipe(
      map((connector) => connector?.id === ONLY_OFFICE_CONNECTOR_ID),
    );
  }

  /**
   * The connector this node opens in, or null — the branch point of the content flow and the source of the URL that
   * editing navigates to. Null as well when the connector list cannot be read: without that knowledge the flow must
   * not claim the node is being edited elsewhere.
   */
  async connectorFor(node: Node): Promise<Connector | null> {
    try {
      return await firstValueFrom(this.observeConnectorForNode(node));
    } catch {
      return null;
    }
  }

  /** URL that opens the node in its connector — the page the Bearbeitungsmodus takes the tab to. */
  getConnectorUrl(node: Node, connector: Connector): string {
    const base = this.apiConfig.rootUrl.replace(/\/rest\/?$/, '');
    const params = new URLSearchParams({ connectorId: connector.id ?? '', nodeId: node.ref.id });
    return `${base}/eduservlet/connector?${params}`;
  }
}

/** Mirrors the repository's connector filetype matching (mimetype + ccrestype/editorType refinements). */
function matchesFiletype(node: Node, connector: Connector): ConnectorFileType | null {
  const prop = (key: string) => node.properties?.[key]?.[0];
  return (
    connector.filetypes?.find((filetype) => {
      if (filetype.mimetype !== node.mimetype) {
        return false;
      }
      if (filetype.mimetype === 'application/zip') {
        return (
          (!filetype.ccressourceversion ||
            filetype.ccressourceversion === prop(RestConstants.CCM_PROP_CCRESSOURCEVERSION)) &&
          filetype.ccressourcetype === prop(RestConstants.CCM_PROP_CCRESSOURCETYPE) &&
          (!filetype.ccresourcesubtype ||
            filetype.ccresourcesubtype === prop(RestConstants.CCM_PROP_CCRESSOURCESUBTYPE))
        );
      }
      return (
        !filetype.editorType || filetype.editorType === prop(RestConstants.CCM_PROP_EDITOR_TYPE)
      );
    }) ?? null
  );
}
