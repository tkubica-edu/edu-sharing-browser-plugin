import { Injectable, computed, inject, signal } from '@angular/core';
import { CollectionService, ConfigService, HOME_REPOSITORY, Node, NodeService } from 'ngx-edu-sharing-api';
import { firstValueFrom } from 'rxjs';

import { errorMessage } from '../util/errors';
import { Collection } from './curation.service';

/**
 * Repository-config variable naming the editorial groups a content may be forwarded to, as a list of
 * collection IDs: `['ID1', 'ID2']`. Absent means the repository has no editorial groups — the
 * forwarding step then has nothing to offer.
 */
const CONFIG_VARIABLE = 'browserExtensionEditorialGroups';

/** How many children of a group's collection are read when looking for its collection folders. */
const MAX_FOLDERS = 100;

/** Collection nodes are folders (`ccm:map`); a collection's other children are its references. */
const COLLECTION_TYPE = 'ccm:map';

/**
 * One editorial group a content can be forwarded to: the collection it *is*, plus the collection
 * folders inside it.
 *
 * A group without folders takes the content directly. A group with folders expects one to be picked
 * — the content then goes into that folder rather than into the group's own collection, which is
 * where a collection keeps what it holds anyway (see {@link EditorialTarget}).
 */
export interface EditorialGroup {
  /** The group's own collection — the target where no folder is picked. */
  collection: Collection;
  /**
   * The group's picture, for showing it as itself. `null` where the repository has none of its own:
   * a collection without a logo answers with its *type* icon (`preview.isIcon`), which says nothing
   * about this group, so the view draws its own glyph instead.
   */
  logoUrl: string | null;
  /** The collection folders inside the group; empty when it has none. */
  folders: readonly Collection[];
}

/**
 * The collection IDs a config value names. Written as `['ID1', 'ID2']` — which is JSON only by
 * accident (the quotes are single ones), so it is read as what it is: a bracketed, comma-separated
 * list. A bare `ID1, ID2` and a real array both fall out of the same reading.
 */
function parseIds(value: unknown): string[] {
  const entries = Array.isArray(value) ? value : String(value ?? '').replace(/^\s*\[|]\s*$/g, '').split(',');
  return entries
    .map((entry) => String(entry).trim().replace(/^['"]|['"]$/g, '').trim())
    .filter((id) => !!id);
}

/** What to call a collection: its own title, else the node's, else the node's name. */
function titleOf(node: Node, fallback: string): string {
  return node.collection?.title || node.title || node.name || fallback;
}

/** Reduce a loaded collection node to the target it is. */
function toCollection(node: Node): Collection {
  return { id: node.ref.id, name: titleOf(node, node.ref.id) };
}

/**
 * The editorial groups a content can be forwarded to, as the repository config names them (see
 * {@link CONFIG_VARIABLE}) — read once, then held for the session.
 *
 * Loaded on demand rather than at boot: the collections are read through the repository session, and
 * the only step that shows them is behind the login gate anyway (EditorialForwardScreenComponent).
 */
@Injectable({ providedIn: 'root' })
export class EditorialGroupsService {
  private readonly config = inject(ConfigService);
  private readonly collections = inject(CollectionService);
  private readonly nodes = inject(NodeService);

  private readonly groupsState = signal<readonly EditorialGroup[]>([]);
  /** The groups that could be loaded, in the order the config names them. */
  readonly groups = this.groupsState.asReadonly();

  private readonly loadingState = signal(false);
  readonly loading = this.loadingState.asReadonly();

  /** Why the groups could not be read at all; `null` while nothing failed. */
  readonly error = signal<string | null>(null);

  /**
   * How many of the configured collections the repository would not hand back — a group that is
   * gone, or one this session may not see. Named rather than swallowed: the list is otherwise
   * silently short, and a user cannot forward to a group that is not offered.
   */
  private readonly unavailableState = signal(0);
  readonly unavailable = this.unavailableState.asReadonly();

  /** Whether the config names any editorial group; `null` until it has been read. */
  private readonly configuredState = signal<boolean | null>(null);
  readonly configured = this.configuredState.asReadonly();

  /** The config has been read and there is nothing to forward to — see {@link configuredState}. */
  readonly none = computed(() => this.configuredState() === false);

  /** Set once the load ran, so re-entering the step does not fetch the groups again. */
  private loaded = false;

  /**
   * Read the config and load the groups it names. Idempotent — the answer is the same for the whole
   * session, so the second caller gets what the first one loaded.
   */
  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    this.loadingState.set(true);
    this.error.set(null);
    try {
      const variables = await firstValueFrom(this.config.observeVariables());
      const ids = parseIds(variables?.[CONFIG_VARIABLE]);
      this.configuredState.set(ids.length > 0);
      const loaded = await Promise.all(ids.map((id) => this.loadGroup(id)));
      this.groupsState.set(loaded.filter((group): group is EditorialGroup => !!group));
      this.unavailableState.set(ids.length - this.groupsState().length);
    } catch (cause: unknown) {
      // The config itself did not answer, so it is unknown whether there are any groups at all —
      // `configured` stays null and the view reports the failure instead of "keine Redaktionen".
      this.error.set(errorMessage(cause));
      // Not loaded after all: a session that arrives later (or a repository that answers again) may
      // still produce the list, and the step is re-entered often enough for that to matter.
      this.loaded = false;
    } finally {
      this.loadingState.set(false);
    }
  }

  /** One group, or `null` when the repository will not hand its collection back. */
  private async loadGroup(id: string): Promise<EditorialGroup | null> {
    try {
      const node = await firstValueFrom(this.collections.getCollection(id));
      return {
        collection: toCollection(node),
        logoUrl: node.preview && !node.preview.isIcon ? node.preview.url : null,
        folders: await this.loadFolders(id)
      };
    } catch {
      return null;
    }
  }

  /**
   * The collection folders inside a group. `filter: ['folders']` asks the repository to leave the
   * group's *references* out — the contents it holds, of which there can be thousands — and the
   * answer is narrowed to collections here as well, so a repository that ignores the filter still
   * yields folders alone.
   *
   * An empty list on failure: it reads as "no folder needed", which is the harmless of the two
   * outcomes — the content goes to the group itself rather than to a folder that could not be shown.
   */
  private async loadFolders(id: string): Promise<readonly Collection[]> {
    try {
      const children = await firstValueFrom(
        this.nodes.getChildren(id, {
          repository: HOME_REPOSITORY,
          filter: ['folders'],
          maxItems: MAX_FOLDERS
        })
      );
      return (children.nodes ?? [])
        .filter((node) => node.type === COLLECTION_TYPE || !!node.collection)
        .map((node) => toCollection(node));
    } catch {
      return [];
    }
  }
}
