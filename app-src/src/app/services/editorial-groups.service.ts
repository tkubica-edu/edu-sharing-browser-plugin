import { Injectable, computed, inject, signal } from '@angular/core';
import { CollectionService, ConfigService, Node } from 'ngx-edu-sharing-api';
import { firstValueFrom } from 'rxjs';

import { errorMessage } from '../util/errors';
import { Collection, CurationService, EditorialTarget } from './curation.service';

/**
 * Repository-config variable naming the editorial groups a content may be forwarded to, as a list of
 * collection IDs: `['ID1', 'ID2']`. Absent means the repository has no editorial groups — the
 * forwarding step then has nothing to offer.
 */
const CONFIG_VARIABLE = 'browserExtensionEditorialGroups';

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
  /** The collections inside the group; empty when it has none. */
  folders: readonly Collection[];
  /**
   * The group as the embedded selector shows it: its own collection node followed by the collection
   * nodes inside it, each pointed at the group as its parent.
   *
   * Tree *data*, not a list of ids — the selector hands it straight to its tree's data source, which
   * builds the hierarchy from each node's `parent.id` (the same shape the selector builds for its own
   * roots). So the nodes are kept as the repository handed them over, rather than reduced to
   * {@link folders}. See NodesSelectorComponent.collectionTree.
   */
  collectionTree: readonly Node[];
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
  // Where the choices this service's views make are recorded — the flow carries them to the save.
  private readonly curation = inject(CurationService);

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

  /**
   * The group whose collection is being picked, while the *Sammlung auswählen* step is open. It is a
   * step of its own rather than a view inside the forwarding, so the group it belongs to lives here
   * — both screens read it, and it survives the navigation between them.
   */
  private readonly pickingState = signal<EditorialGroup | null>(null);
  readonly picking = this.pickingState.asReadonly();

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

  /** Name the group the *Sammlung auswählen* step is entered for. */
  pick(group: EditorialGroup): void {
    this.pickingState.set(group);
  }

  /** Whether the content is being forwarded to this group. */
  isSelected(group: EditorialGroup): boolean {
    return !!this.targetOf(group);
  }

  /** The collection picked inside this group, if any. */
  folderOf(group: EditorialGroup): Collection | undefined {
    return this.targetOf(group)?.folder;
  }

  /** Forward to this group, or stop doing so — the checkbox's answer. */
  toggle(group: EditorialGroup, selected: boolean): void {
    // The picked collection goes with it: it was a choice about a forwarding that is no longer made.
    if (!selected) return this.write(this.others(group));
    this.write([...this.others(group), { group: group.collection }]);
  }

  /**
   * Take a picked collection over: the content is forwarded into it rather than into the group's own
   * collection. Picking one selects the group as well — going and choosing a collection inside it is
   * the clearer statement of the two, and a choice that left the group unticked would take no effect.
   */
  chooseFolder(group: EditorialGroup, folder: Collection): void {
    this.write([...this.others(group), { group: group.collection, folder }]);
  }

  private targetOf(group: EditorialGroup): EditorialTarget | undefined {
    return this.curation
      .editorialTargets()
      .find((target) => target.group.id === group.collection.id);
  }

  /** The forwardings to every group but this one — what a change to it leaves alone. */
  private others(group: EditorialGroup): EditorialTarget[] {
    return this.curation
      .editorialTargets()
      .filter((target) => target.group.id !== group.collection.id);
  }

  /**
   * Hand the choice to the flow, in the order the groups are listed rather than in the order they
   * were ticked — the list is what the user reads it back off.
   */
  private write(targets: readonly EditorialTarget[]): void {
    const order = this.groupsState().map((group) => group.collection.id);
    this.curation.setEditorialTargets(
      [...targets].sort((a, b) => order.indexOf(a.group.id) - order.indexOf(b.group.id)),
    );
  }

  /** One group, or `null` when the repository will not hand its collection back. */
  private async loadGroup(id: string): Promise<EditorialGroup | null> {
    try {
      const node = await firstValueFrom(this.collections.getCollection(id));
      // The tree reads the hierarchy off `parent.id`, and a collection's own parent is wherever it
      // sits in the repository — which is not necessarily the group it is being offered under.
      // Copies, not the loaded nodes: the library hands them out of a cache it keeps for the whole
      // session, so rewriting them in place would change what every other caller sees.
      const children = (await this.loadChildren(id)).map((child) =>
        child.parent ? { ...child, parent: { ...child.parent, id: node.ref.id } } : child,
      );
      return {
        collection: toCollection(node),
        logoUrl: node.preview && !node.preview.isIcon ? node.preview.url : null,
        folders: children.map((child) => toCollection(child)),
        collectionTree: [node, ...children]
      };
    } catch {
      return null;
    }
  }

  /**
   * The collections inside a group, as the repository hands them over — the selector needs the nodes
   * themselves, not just their names (see {@link EditorialGroup.collectionTree}).
   *
   * An empty list on failure: it reads as "no collection to choose", which is the harmless of the two
   * outcomes — the content then goes to the group itself rather than into one that could not be shown.
   */
  private async loadChildren(id: string): Promise<Node[]> {
    try {
      return await firstValueFrom(this.collections.getSubCollections(id));
    } catch {
      return [];
    }
  }
}
