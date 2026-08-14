import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { HOME_REPOSITORY, NodeService } from 'ngx-edu-sharing-api';

import { NodeSummary } from './repository-node.service';

/** The parent a material added through the dialog is created in (as for a curated content). */
const INBOX = '-inbox-';

/** Version comment of the initial content — what the repository's own upload sends. */
const UPLOAD_COMMENT = 'MAIN_FILE_UPLOAD';

/** Fallback mimetype for a file the browser did not type. */
const FALLBACK_MIMETYPE = 'application/octet-stream';

/** What `<edu-sharing-add-material>` emits on `dialogResult`: an uploaded file or a link. */
export type AddMaterialResult =
  | { kind: 'file'; files: File[] | FileList; parent?: { ref?: { id?: string } } | null }
  | {
      kind: 'link';
      link: string;
      parent?: { ref?: { id?: string } } | null;
      lti?: { consumerKey: string; sharedSecret: string } | null;
    };

/**
 * Turns the choice `<edu-sharing-add-material>` emits into a repository node — the host part the dialog leaves to its
 * caller: a file becomes an empty `ccm:io` whose content is written afterwards, since the create API takes properties
 * rather than a body, and a link becomes one carrying the URL in `ccm:wwwurl`, marked as user generated.
 */
@Injectable({ providedIn: 'root' })
export class MaterialUploadService {
  private readonly nodes = inject(NodeService);

  /** Create the node(s) the dialog result describes; the first one is the one to continue with. */
  async create(result: AddMaterialResult): Promise<NodeSummary[]> {
    const parent = result.parent?.ref?.id ?? INBOX;
    if (result.kind === 'link') return [await this.createLink(result, parent)];
    const files = Array.from(result.files as ArrayLike<File>);
    const created: NodeSummary[] = [];
    // Sequentially: the repository renames on collision (renameIfExists), which only works
    // reliably when the creates do not race each other.
    for (const file of files) created.push(await this.createFile(file, parent));
    return created;
  }

  /** A link node: no content, the URL as `ccm:wwwurl`. */
  private async createLink(
    result: Extract<AddMaterialResult, { kind: 'link' }>,
    parent: string,
  ): Promise<NodeSummary> {
    const url = withScheme(result.link);
    const properties: Record<string, string[]> = {
      'cm:name': [url],
      'ccm:wwwurl': [url],
      'ccm:linktype': ['USER_GENERATED']
    };
    const aspects: string[] = [];
    if (result.lti) {
      aspects.push('ccm:tool_instance_link');
      properties['ccm:tool_instance_key'] = [result.lti.consumerKey];
      properties['ccm:tool_instance_secret'] = [result.lti.sharedSecret];
    }
    const node = await firstValueFrom(
      this.nodes.createChild({
        repository: HOME_REPOSITORY,
        node: parent,
        type: 'ccm:io',
        aspects,
        renameIfExists: true,
        versionComment: UPLOAD_COMMENT,
        body: properties
      })
    );
    return { nodeId: node.ref.id, name: node.name };
  }

  /** A file node: create it by name, then write the file as its content. */
  private async createFile(file: File, parent: string): Promise<NodeSummary> {
    const created = await firstValueFrom(
      this.nodes.createChild({
        repository: HOME_REPOSITORY,
        node: parent,
        type: 'ccm:io',
        renameIfExists: true,
        versionComment: UPLOAD_COMMENT,
        body: { 'cm:name': [file.name], 'cclom:title': [file.name] }
      })
    );
    const node = await firstValueFrom(
      this.nodes.changeContent(
        HOME_REPOSITORY,
        created.ref.id,
        file.type || FALLBACK_MIMETYPE,
        UPLOAD_COMMENT,
        { file }
      )
    );
    return { nodeId: node.ref.id, name: node.name ?? created.name };
  }
}

/** The repository stores links absolute; a bare host would otherwise resolve relatively. */
export function withScheme(link: string): string {
  const url = link.trim();
  return url.includes('://') ? url : 'http://' + url;
}
