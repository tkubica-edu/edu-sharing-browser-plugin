import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { HOME_REPOSITORY, Node, NodeService } from 'ngx-edu-sharing-api';

import { MdsValues, toMdsValues } from '../util/mds-values';

/** The parent every curated node is created in. */
const INBOX = '-inbox-';

/** Fallback name when the metadata carries no title. */
const FALLBACK_NAME = 'Neue Ressource';

/** Identity of a created or updated node. */
export interface NodeSummary {
  nodeId: string;
  name: string;
}

/** Creates, updates and loads edu-sharing nodes via ngx-edu-sharing-api's NodeService. */
@Injectable({ providedIn: 'root' })
export class RepositoryNodeService {
  private readonly nodes = inject(NodeService);

  /** Create a child (`ccm:io`) in the user's inbox with the given MDS properties. */
  async createInInbox(values: MdsValues): Promise<NodeSummary> {
    const node = await firstValueFrom(
      this.nodes.createChild({
        repository: HOME_REPOSITORY,
        node: INBOX,
        type: 'ccm:io',
        renameIfExists: true,
        versionComment: 'MAIN_FILE_UPLOAD',
        body: this.toBody(values)
      })
    );
    return { nodeId: node.ref.id, name: node.name };
  }

  /**
   * Update an existing node's metadata in place. `currentName` keeps the node's name when the
   * values carry none — generated metadata has no `cm:name`, and inventing one from the title
   * would **rename the node** (for a real document that means losing its file extension).
   */
  async update(nodeId: string, values: MdsValues, currentName?: string): Promise<NodeSummary> {
    const node = await firstValueFrom(
      this.nodes.editNodeMetadata(nodeId, this.toBody(values, currentName), {
        versionComment: 'METADATA_UPDATE'
      })
    );
    return { nodeId: node.ref.id, name: node.name };
  }

  /**
   * Load the full (hydrated) node. Its `properties` re-seed the MDS editor for re-editing, and
   * the node object itself feeds the preview element (whose `node` input is the Node object
   * rather than an id).
   */
  get(nodeId: string): Promise<Node> {
    return firstValueFrom(this.nodes.getNode(nodeId));
  }

  /**
   * Normalize editor values and make sure the node carries a name (`cm:name`): the node's existing
   * name if there is one, else the title, else a fallback (a node cannot be created without one).
   */
  private toBody(values: MdsValues, currentName?: string): MdsValues {
    const body = toMdsValues(values);
    if (!body['cm:name']?.length) {
      body['cm:name'] = [currentName || body['cclom:title']?.[0] || FALLBACK_NAME];
    }
    return body;
  }
}
