import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  HOME_REPOSITORY, Node, NodeService, NodeServiceUnwrapped, UserService
} from 'ngx-edu-sharing-api';

import { MdsValues, toMdsValues } from '../util/mds-values';

/** The parent a curated node is created in where none was picked for it. */
const INBOX = '-inbox-';

/**
 * The setting naming the folder the user files content in by default — the same one the repository's own
 * Ablageort control writes. It lives in the profile preferences where there is a profile, and in the
 * browser (JSON-encoded) for a session without one; see {@link RepositoryNodeService.storedDefaultFolder}.
 */
const DEFAULT_FOLDER_KEY = 'defaultInboxFolder';

/** Fallback name when the metadata carries no title. */
const FALLBACK_NAME = 'Neue Ressource';

/** A stored setting read as a node id: a non-blank string, else null. */
function folderId(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

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
  // The user's profile preferences, where their default filing folder is kept — read through the
  // plain API rather than through SessionStorageService, see {@link storedDefaultFolder}.
  private readonly users = inject(UserService);

  /**
   * The folder a curated content is filed in unless the user picks another: their default, else their
   * inbox. The node itself rather than its id, since the control renders it as a breadcrumb. A default
   * that cannot be loaded falls back to the inbox — a filing place the user cannot see is worse.
   */
  async defaultParent(): Promise<Node> {
    const preferred = (await this.storedDefaultFolder()) || INBOX;
    try {
      return await this.get(preferred);
    } catch {
      return this.get(INBOX);
    }
  }

  /**
   * The folder the user set as their default; null when they set none. Read on every ask and not through
   * `SessionStorageService`: the control that writes the setting runs in the edu bundle, whose copy of that
   * cache this app never hears about. Profile first, browser copy standing in where it names none.
   */
  private async storedDefaultFolder(): Promise<string | null> {
    let preferences: Record<string, unknown> | null = null;
    try {
      preferences = (await firstValueFrom(this.users.getUserPreferences())) as Record<
        string,
        unknown
      > | null;
    } catch {
      /* no profile to read them from — the browser's copy below is what such a session has */
    }
    return folderId(preferences?.[DEFAULT_FOLDER_KEY]) ?? this.locallyStoredDefaultFolder();
  }

  /** The setting as the library leaves it in the browser for a session without a profile. */
  private locallyStoredDefaultFolder(): string | null {
    try {
      return folderId(JSON.parse(localStorage.getItem(DEFAULT_FOLDER_KEY) ?? 'null'));
    } catch {
      /* not JSON — nothing this app wrote, so nothing it reads */
      return null;
    }
  }

  /**
   * Create a child (`ccm:io`) with the given MDS properties in `parent`. `obeyMds` is stated rather than
   * left to the server default: the metadata set decides which properties a node may carry, and the
   * fields it does not define are written afterwards by the one call that does not obey it.
   */
  async create(values: MdsValues, parent: string = INBOX): Promise<NodeSummary> {
    const entry = await firstValueFrom(
      this.nodesUnwrapped.createChild({
        repository: HOME_REPOSITORY,
        node: parent,
        type: 'ccm:io',
        renameIfExists: true,
        versionComment: 'MAIN_FILE_UPLOAD',
        obeyMds: true,
        body: this.toCreateBody(values)
      })
    );
    return { nodeId: entry.node.ref.id, name: entry.node.name };
  }

  /**
   * Write the WLO extended fields onto a node — a call of its own, since a write that obeys the metadata
   * set drops fields the set does not define. Answers which fields did not get through; a failed bulk
   * write is retried field by field, as one refused property fails the whole request.
   */
  async writeExtendedData(nodeId: string, fields: MdsValues): Promise<string[]> {
    const names = Object.keys(fields);
    if (!names.length) return [];
    try {
      await this.writeUnchecked(nodeId, fields);
      return [];
    } catch {
      const failed: string[] = [];
      for (const name of names) {
        try {
          await this.writeUnchecked(nodeId, { [name]: fields[name] });
        } catch {
          failed.push(name);
        }
      }
      return failed;
    }
  }

  /** One metadata write that does not obey the metadata set — see {@link writeExtendedData}. */
  private writeUnchecked(nodeId: string, fields: MdsValues): Promise<Node> {
    return firstValueFrom(
      this.nodes.editNodeMetadata(nodeId, fields, {
        versionComment: 'EXTENDED_DATA',
        obeyMds: false
      })
    );
  }

  /**
   * Update an existing node's metadata in place. `currentName` keeps the node's name where the values
   * carry none — inventing one from the title would rename the node and cost a document its extension.
   * With the name unknown no `cm:name` is sent at all, which at worst lets the repository re-derive it.
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
   * Set the node's preview picture — a multipart upload that replaces the existing preview, and the only
   * way to give a node a picture of its own, since a preview is content rather than a property. No
   * version is created for it.
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
   * Record a workflow status on the node: an entry in its workflow history, so writing one adds a step
   * rather than overwriting the one before. `receiver` names the authorities a handover is addressed to;
   * a state that merely records an outcome passes none.
   */
  async addWorkflowStatus(
    nodeId: string,
    status: string,
    comment = '',
    receiver: readonly string[] = [],
  ): Promise<void> {
    await firstValueFrom(
      this.nodesUnwrapped.addWorkflowHistory({
        repository: HOME_REPOSITORY,
        node: nodeId,
        // `editor` and `time` are filled in by the repository.
        body: { status, comment, receiver: receiver.map((authorityName) => ({ authorityName })) }
      })
    );
  }

  /**
   * Move the node into another folder — what the user's own filing step decides, *after* the content
   * was created: the node exists from the preview step on, so where it is filed can no longer be the
   * parent it is created in (see {@link CurationService.moveToStorageParent}).
   */
  async moveTo(nodeId: string, parent: string): Promise<void> {
    await firstValueFrom(
      this.nodesUnwrapped.createChildByMoving({
        repository: HOME_REPOSITORY,
        node: parent,
        source: nodeId
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
   * The node and the nodes it sits in, closest first — where a node is in the repository, in one answer
   * rather than by following `parent` from node to node. Read for a collection whose place inside a
   * collection tree decides what it belongs to (see CollectionRecommendationService).
   */
  async ancestors(nodeId: string): Promise<Node[]> {
    const entries = await firstValueFrom(this.nodes.getParents(nodeId));
    return entries.nodes ?? [];
  }

  /**
   * Normalize editor values for a new node and make sure it carries a `cm:name` — a node cannot be
   * created without one. Creating is the only case that may invent a name; see {@link update}.
   */
  private toCreateBody(values: MdsValues): MdsValues {
    const body = toMdsValues(values);
    if (!body['cm:name']?.length) {
      body['cm:name'] = [body['cclom:title']?.[0] || FALLBACK_NAME];
    }
    return body;
  }
}
