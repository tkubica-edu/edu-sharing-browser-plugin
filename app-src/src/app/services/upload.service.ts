import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Node, NodeService } from 'ngx-edu-sharing-api';

export interface UploadedNode {
  nodeId: string;
  name: string;
}

// Creates/updates/loads edu-sharing nodes via ngx-edu-sharing-api's NodeService.
@Injectable({ providedIn: 'root' })
export class UploadService {
  private readonly nodes = inject(NodeService);

  // Create a child (ccm:io) in the user's INBOX with the given MDS properties.
  async createInInbox(values: Record<string, string[]>): Promise<UploadedNode> {
    const body = this.toBody(values);
    const node = await firstValueFrom(
      this.nodes.createChild({
        repository: '-home-',
        node: '-inbox-',
        type: 'ccm:io',
        renameIfExists: true,
        versionComment: 'MAIN_FILE_UPLOAD',
        body
      })
    );
    return { nodeId: node.ref.id, name: node.name };
  }

  // Update an existing node's metadata in place.
  async updateNode(nodeId: string, values: Record<string, string[]>): Promise<UploadedNode> {
    const node = await firstValueFrom(
      this.nodes.editNodeMetadata(nodeId, this.toBody(values), { versionComment: 'METADATA_UPDATE' })
    );
    return { nodeId: node.ref.id, name: node.name };
  }

  // Load the full (hydrated) node. Its `properties` re-seed the MDS editor for
  // re-editing, and the node object itself feeds the preview web component (whose
  // `node` input is the Node object rather than an id).
  getNode(nodeId: string): Promise<Node> {
    return firstValueFrom(this.nodes.getNode(nodeId));
  }

  // Coerce editor values to string[] and ensure a node name (cm:name).
  private toBody(values: Record<string, unknown>): { [key: string]: string[] } {
    const body: { [key: string]: string[] } = {};
    for (const [key, value] of Object.entries(values ?? {})) {
      if (value === null || value === undefined) continue;
      body[key] = Array.isArray(value) ? value.map((v) => String(v)) : [String(value)];
    }
    if (!body['cm:name']?.length) {
      body['cm:name'] = [body['cclom:title']?.[0] || 'Neue Ressource'];
    }
    return body;
  }
}
