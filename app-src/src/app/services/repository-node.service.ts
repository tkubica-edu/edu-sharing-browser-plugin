import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { HOME_REPOSITORY, Node, NodeService, NodeServiceUnwrapped } from 'ngx-edu-sharing-api';

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
  // The generated NodeV1Service (exported as NodeServiceUnwrapped) — the NodeService wrapper does
  // not cover the preview upload.
  private readonly nodesUnwrapped = inject(NodeServiceUnwrapped);

  /** Create a child (`ccm:io`) in the user's inbox with the given MDS properties. */
  async createInInbox(values: MdsValues): Promise<NodeSummary> {
    const node = await firstValueFrom(
      this.nodes.createChild({
        repository: HOME_REPOSITORY,
        node: INBOX,
        type: 'ccm:io',
        renameIfExists: true,
        versionComment: 'MAIN_FILE_UPLOAD',
        body: this.toCreateBody(values)
      })
    );
    return { nodeId: node.ref.id, name: node.name };
  }

  /**
   * Update an existing node's metadata in place. `currentName` keeps the node's name when the
   * values carry none — generated metadata has no `cm:name`, and inventing one from the title
   * would **rename the node** (for a real document that means losing its file extension).
   *
   * When the current name is unknown, no `cm:name` is sent at all. Leaving the property out is
   * the lesser risk: a wrong one renames the document for certain, whereas the omission at worst
   * lets the repository re-derive the name it would have derived anyway.
   */
  async update(nodeId: string, values: MdsValues, currentName?: string): Promise<NodeSummary> {
    const body = toMdsValues(values);
    if (!body['cm:name']?.length && currentName) body['cm:name'] = [currentName];
    const node = await firstValueFrom(
      this.nodes.editNodeMetadata(nodeId, body, { versionComment: 'METADATA_UPDATE' })
    );
    return { nodeId: node.ref.id, name: node.name };
  }

  /**
   * Set the node's preview picture — a multipart upload that REPLACES whatever preview it has, and
   * the only way to give a node a picture of its own: a preview is content, not a property, so it
   * cannot travel with the metadata (see {@link CurationService.writePendingPreview}).
   *
   * No version is created for it: the picture belongs to the metadata being written, not to a new
   * revision of the document.
   */
  async setPreview(nodeId: string, image: Blob): Promise<void> {
    await firstValueFrom(
      this.nodesUnwrapped.changePreview({
        repository: HOME_REPOSITORY,
        node: nodeId,
        mimetype: image.type || 'image/png',
        createVersion: false,
        body: { image }
      })
    );
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
   * Normalize editor values for a NEW node and make sure it carries a name (`cm:name`): the title
   * if there is one, else a fallback — a node cannot be created without a name. Creating is the
   * only case that may invent one; see {@link update} for why an existing node must not be
   * renamed this way.
   */
  private toCreateBody(values: MdsValues): MdsValues {
    const body = toMdsValues(values);
    if (!body['cm:name']?.length) {
      body['cm:name'] = [body['cclom:title']?.[0] || FALLBACK_NAME];
    }
    return body;
  }
}
