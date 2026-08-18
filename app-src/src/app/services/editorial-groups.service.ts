import { Injectable, computed, inject, signal } from '@angular/core';
import { CollectionService, ConfigService, Node } from 'ngx-edu-sharing-api';
import { firstValueFrom } from 'rxjs';

import { errorMessage } from '../util/errors';
import { CollectionRecommendationService, RecommendedCollection } from './collection-recommendation.service';
import { DevModeService } from './dev-mode.service';
import { Collection, CurationService, EditorialTarget } from './curation.service';

/**
 * Repository-config variable naming the editorial groups a content may be forwarded to, as a list of
 * collection IDs: `['ID1', 'ID2']`. Absent means the repository has no editorial groups — the
 * forwarding step then has nothing to offer.
 */
const CONFIG_VARIABLE = 'browserExtensionEditorialGroups';

/** Log prefix, as everywhere else in the extension (`[edu-sharing][<station>]`). */
const LOG = '[edu-sharing][collection]';

/**
 * One editorial group a content can be forwarded to: the collection it is, plus the collection folders inside
 * it. A group without folders takes the content directly; with folders one is picked, and the content goes
 * there rather than into the group's own collection.
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
   * The group as the embedded selector shows it: its own collection node followed by the nodes inside it, each
   * pointed at the group as its parent. Tree data rather than ids — the selector builds the hierarchy from each
   * node's `parent.id`, so the nodes stay as the repository handed them over.
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
 * The editorial groups a content can be forwarded to, as the repository config names them — read once, then
 * held for the session. Loaded on demand rather than at boot: the collections are read through the repository
 * session, and the only step that shows them sits behind the login anyway.
 */
@Injectable({ providedIn: 'root' })
export class EditorialGroupsService {
  private readonly config = inject(ConfigService);
  private readonly collections = inject(CollectionService);
  // Where the choices this service's views make are recorded — the flow carries them to the save.
  private readonly curation = inject(CurationService);
  private readonly recommendations = inject(CollectionRecommendationService);
  private readonly devMode = inject(DevModeService);

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

  /**
   * The collection the topic assistant proposed and the group it was taken over for. Held for as long
   * as the step lives, and not only while it is what stands: it says what a proposal was where the
   * choice is shown — that is not readable off the choice itself — and it is what a user who picked
   * something else goes back to.
   */
  private readonly recommendedState = signal<{ groupId: string; folder: Collection } | null>(null);

  private readonly recommendingState = signal(false);

  /** A proposal is being asked for right now — see {@link recommendCollection}. */
  readonly recommending = this.recommendingState.asReadonly();

  /**
   * The keywords a proposal was already asked for, so re-entering the step does not ask again — and
   * does not undo what the user did with the last answer. Null while none was asked for.
   */
  private recommendedFor: string | null = null;

  /** The load, from the first caller on — see {@link load}. */
  private pending: Promise<void> | null = null;

  /**
   * Read the config and load the groups it names. Idempotent — the answer is the same for the whole
   * session, so every later caller gets (and waits for) what the first one started.
   */
  load(): Promise<void> {
    this.pending ??= this.runLoad();
    return this.pending;
  }

  private async runLoad(): Promise<void> {
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
      this.pending = null;
    } finally {
      this.loadingState.set(false);
    }
  }

  /**
   * Have a collection proposed for the content and take it over as a group's choice: the topic assistant
   * reads the content's best keywords — ranked against the text they were generated from — and answers
   * with the topics they belong to, and the collection the best of those is kept as is picked for the
   * group whose own collection it sits in (see {@link CollectionRecommendationService}). Once per set of
   * keywords — from the answer on the choice is the user's, including the choice to drop it again.
   *
   * Asked for alongside the groups rather than after them: the two answers are only worth anything
   * together, but neither request needs the other's answer, and the assistant is the slower of the two.
   */
  async recommendCollection(): Promise<void> {
    const keywords = this.curation.contentKeywords();
    const asked = keywords.join('|');
    // A repository the config named no group for was read as such by an earlier load — nothing to ask
    // for, since a proposal is only ever taken over as a group's choice.
    if (!asked || this.recommendedFor === asked || this.configuredState() === false) return;
    this.recommendedFor = asked;
    this.recommendingState.set(true);
    try {
      const [found] = await Promise.all([
        this.recommendations.recommend(keywords, this.curation.contentText()),
        this.load()
      ]);
      // The groups did not load, so there is nothing to take a proposal over for; asked again the next
      // time the step is entered, since by then they may well be there.
      if (!this.groupsState().length) {
        this.recommendedFor = null;
        console.log(`${LOG} proposal dropped, no editorial group was loaded`);
        return;
      }
      if (found) this.applyRecommendation(found);
      else console.log(`${LOG} no collection to propose for:`, keywords);
    } catch (cause: unknown) {
      // A proposal that could not be made changes nothing about the step: every group is still there
      // to be forwarded to, and every collection inside it still there to be picked by hand.
      console.warn(`${LOG} no collection proposed:`, errorMessage(cause));
    } finally {
      this.recommendingState.set(false);
    }
  }

  /**
   * Take a proposed collection over: the group it belongs to is forwarded to, and the collection becomes
   * the one inside it the content is filed in. A collection that belongs to no configured group is
   * dropped — the content would land somewhere no editorial team was picked for.
   */
  private applyRecommendation(found: RecommendedCollection): void {
    const group =
      this.groupsState().find((candidate) => found.ancestry.includes(candidate.collection.id)) ??
      this.hostGroupForTest(found);
    if (!group) {
      console.log(`${LOG} proposed collection belongs to no editorial group:`, found.ancestry);
      return;
    }
    // A collection the user picked for this group themselves stands: the keywords may have changed
    // since (which is what produced this second proposal), but the choice was still theirs to make.
    if (this.folderOf(group) && !this.isRecommended(group)) {
      console.log(`${LOG} proposal dropped, the group's collection was picked by hand`);
      return;
    }
    // The group's own collection: there is nothing to pick inside it, so the proposal says no more than
    // what forwarding to the group says anyway — and forwarding is the user's to decide.
    if (group.collection.id === found.node.ref.id) {
      console.log(`${LOG} proposed collection is the group itself, nothing to preselect inside it`);
      return;
    }
    const offered = this.offer(group, found.node);
    const folder = toCollection(found.node);
    // Both halves of the proposal are taken over: the collection inside the group the content goes into,
    // and the group it sits in as one to forward to — a collection picked inside a group that is not
    // forwarded to would take no effect. Held as the proposal as well, so the choice is still named as
    // one where it is shown and can be undone as a whole (see isRecommended, toggle).
    this.recommendedState.set({ groupId: offered.collection.id, folder });
    this.chooseFolder(offered, folder);
  }

  /**
   * The group a collection named in the settings is shown under, for the dev mode's proposal alone: a
   * test collection sits wherever it sits, usually under none of the configured groups, and the row of
   * the first group is where a proposal can be seen and worked with at all. Null for every other
   * proposal — belonging to a group is what makes a real one usable (see {@link applyRecommendation}).
   */
  private hostGroupForTest(found: RecommendedCollection): EditorialGroup | undefined {
    if (this.devMode.fakedCollectionId() !== found.node.ref.id) return undefined;
    const group = this.groupsState()[0];
    if (group) {
      console.log(
        `${LOG} dev mode: the collection from the settings is offered under ${group.collection.name}`,
      );
    }
    return group;
  }

  /**
   * Add a collection to what a group offers, so one proposed from deeper inside its tree is listed and
   * picked like the collections directly in it. Pointed at the group as its parent for the same reason
   * the loaded children are — see {@link loadGroup}. Answers the group as it now stands.
   */
  private offer(group: EditorialGroup, node: Node): EditorialGroup {
    if (group.folders.some((folder) => folder.id === node.ref.id)) return group;
    const child = node.parent
      ? { ...node, parent: { ...node.parent, id: group.collection.id } }
      : node;
    const offered: EditorialGroup = {
      ...group,
      folders: [toCollection(child), ...group.folders],
      collectionTree: [...group.collectionTree, child]
    };
    this.groupsState.update((groups) =>
      groups.map((entry) => (entry.collection.id === group.collection.id ? offered : entry)),
    );
    return offered;
  }

  /** Name the group the *Sammlung auswählen* step is entered for. */
  pick(group: EditorialGroup): void {
    this.pickingState.set(group);
  }

  /** Whether the content is being forwarded to this group. */
  isSelected(group: EditorialGroup): boolean {
    return !!this.targetOf(group);
  }

  /**
   * The collection picked inside this group, if any — the proposed one while nothing else was picked,
   * whether or not the group is forwarded to. What the content would go into is an answer of its own:
   * it stands before the group is ticked and survives its being unticked again.
   */
  folderOf(group: EditorialGroup): Collection | undefined {
    return this.targetOf(group)?.folder ?? this.recommendationFor(group);
  }

  /** The collection proposed for this group, whatever became of it since. */
  private recommendationFor(group: EditorialGroup): Collection | undefined {
    const recommended = this.recommendedState();
    return recommended?.groupId === group.collection.id ? recommended.folder : undefined;
  }

  /**
   * Whether the collection picked inside this group is the proposed one rather than one the user picked
   * — what tells the two apart where the choice is shown.
   */
  isRecommended(group: EditorialGroup): boolean {
    const recommended = this.recommendedState();
    return (
      !!recommended &&
      recommended.groupId === group.collection.id &&
      this.folderOf(group)?.id === recommended.folder.id
    );
  }

  /**
   * The proposed collection this group can be put back to: the one the topic assistant proposed, while
   * something else is picked inside the group. `null` where nothing was proposed for it or the proposal
   * is what stands — there is then nothing to go back to.
   */
  droppedRecommendation(group: EditorialGroup): Collection | null {
    const recommended = this.recommendedState();
    if (!recommended || recommended.groupId !== group.collection.id) return null;
    return this.isRecommended(group) ? null : recommended.folder;
  }

  /** Pick the proposed collection for this group again — the way back from having picked another. */
  restoreRecommendation(group: EditorialGroup): void {
    const folder = this.droppedRecommendation(group);
    if (folder) this.chooseFolder(group, folder);
  }

  /** Forward to this group, or stop doing so — the checkbox's answer. */
  toggle(group: EditorialGroup, selected: boolean): void {
    // The picked collection goes with it: it was a choice about a forwarding that is no longer made.
    if (!selected) return this.write(this.others(group));
    // The collection the group stands at goes along, so ticking a group forwards into the collection
    // the row names rather than into the group itself — a proposal among them (see folderOf).
    const folder = this.folderOf(group);
    this.write([...this.others(group), { group: group.collection, ...(folder ? { folder } : {}) }]);
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
   * The collections inside a group as the repository hands them over, since the selector needs the nodes
   * themselves. An empty list on failure reads as "no collection to choose", so the content goes to the group
   * itself rather than into one that could not be shown.
   */
  private async loadChildren(id: string): Promise<Node[]> {
    try {
      return await firstValueFrom(this.collections.getSubCollections(id));
    } catch {
      return [];
    }
  }
}
