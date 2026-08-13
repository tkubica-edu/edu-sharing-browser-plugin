import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  HOME_REPOSITORY, Node, NodeService, NodeServiceUnwrapped, UserService
} from 'ngx-edu-sharing-api';

import { MdsValues, toMdsValues } from '../util/mds-values';

/** The parent a curated node is created in where none was picked for it. */
const INBOX = '-inbox-';

/**
 * The setting that names the folder the user files content in by default — what the repository's own
 * Ablageort control writes when its „als Standard verwenden" box is ticked, so both read and write
 * the same one.
 *
 * It lives in two places, and which one applies is decided by the session rather than by the caller
 * (that is how the library's own SessionStorageService keeps it): in the **user's profile
 * preferences** where there is a profile to keep it in, and in the **browser** — plain key, the value
 * JSON-encoded — for a session that has none, the guest one the browser extension custom web
 * component brings. See {@link RepositoryNodeService.storedDefaultFolder}.
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
   * The folder a curated content is filed in unless the user picks another one: the one they set as
   * their default, else their inbox — the same answer the repository's own Ablageort control gives
   * (NodeHelperService.getDefaultInboxFolder).
   *
   * The node itself rather than its id, because that is what the control shows: it renders the folder
   * as a breadcrumb, which it resolves from the node.
   *
   * A default that cannot be loaded falls back to the inbox: the setting names a folder that may
   * since have been deleted or become unreadable, and a filing place the user cannot see is worse
   * than the one every content starts in.
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
   * The folder the user set as their default ({@link DEFAULT_FOLDER_KEY}); null when they set none.
   *
   * **Read on every ask, and not through `SessionStorageService`.** That service is what *writes* the
   * setting — the Ablageort control calls it when the box is ticked — but it serves the profile
   * preferences from a copy it holds for as long as the app lives, re-reading them only when the
   * login changes. And the control does not run in this app: it is an element of the edu bundle,
   * which brings its own copy of the library and therefore its own cache. So the write lands in the
   * bundle's copy, this app's copy never hears of it, and the panel goes on offering the folder that
   * was the default when it started.
   *
   * Both places the setting can live are consulted, the profile first: a session without a profile to
   * keep preferences in has the browser's copy and nothing else, and one that has a profile has that
   * as its answer — the browser's copy then only stands in where the profile names no folder at all.
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
   * Create a child (`ccm:io`) with the given MDS properties in `parent` — the folder picked for the
   * content, or the user's inbox where there is none.
   *
   * `obeyMds` is stated rather than left to the server's default: the properties come from a form the
   * metadata set defines, and the set is what decides which of them a node may carry. The fields it
   * does not define are dropped here on purpose — the ones that still belong on the node are written
   * afterwards, by the one call that does not obey it (see {@link writeExtendedData}).
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
   * Write the WLO extended fields onto a node (see `toExtendedFields`) — a call of its own, because
   * the metadata set does not define them: a write that obeys the set drops them silently, so this
   * one does not obey it and says what it is for in its version comment.
   *
   * Answers which fields did not get through, so the caller can report an incomplete write without
   * losing the content over it. A bulk write that fails is retried field by field: the repository
   * refuses the whole request over a single property it will not take, and the other fields are
   * worth having (the raw text is the largest of them by far and the likeliest to be refused).
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
   * Record a workflow status on the node — an entry in its workflow history, which is how the
   * repository tracks the editorial ladder (see WorkflowStatus). It is a history, not a property:
   * writing one adds a step, it does not overwrite the step before it.
   *
   * `receiver` are the authorities the step is addressed to, by name. Only the handover states have
   * one — they name the queue the content lands in; a state that merely records an outcome is
   * written on the acting user and passes none.
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
