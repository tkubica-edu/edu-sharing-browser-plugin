import { signal } from '@angular/core';
import { vi } from 'vitest';

import { Collection } from '../../app/services/curation.service';
import { EditorialGroup, EditorialGroupsService } from '../../app/services/editorial-groups.service';

/** A collection as the panel names one: what a group and a folder are shown and tracked by. */
export function aCollection(id: string, name = id): Collection {
  return { id, name };
}

/**
 * An editorial group: the collection it is, and the collections inside it. Without a logo, which is the
 * ordinary case — a collection whose repository has none answers with its type icon, and the views draw
 * their own glyph for it instead.
 */
export function anEditorialGroup(
  id: string,
  folders: readonly Collection[] = [],
  logoUrl: string | null = null,
): EditorialGroup {
  return {
    collection: aCollection(id, id),
    logoUrl,
    folders,
    collectionTree: [],
  };
}

/**
 * `EditorialGroupsService` as the two screens that read it use it: which groups the repository holds, what
 * is ticked and what folder is picked for each, and the three states the loading can be in.
 *
 * The picks are kept in the fake rather than stated as answers, because the screens read them straight
 * back after making them — `toggle` and the tick it shows are one statement, and a fake that answered a
 * fixed `isSelected` would let a screen that never ticked anything pass.
 */
export function fakeEditorialGroups(groups: readonly EditorialGroup[] = []) {
  const selected = new Set<string>();
  const folders = new Map<string, Collection>();
  /** The folders that were proposed rather than picked — what makes the row say so. */
  const recommended = new Set<string>();

  const fake = {
    groups: signal(groups),
    loading: signal(false),
    error: signal<string | null>(null),
    unavailable: signal(0),
    configured: signal<boolean | null>(groups.length > 0),
    none: signal(false),
    picking: signal<EditorialGroup | null>(null),
    recommending: signal(false),
    load: vi.fn((): Promise<void> => Promise.resolve()),
    recommendCollection: vi.fn((): Promise<void> => Promise.resolve()),
    pick: vi.fn((group: EditorialGroup): void => {
      fake.picking.set(group);
    }),
    isSelected: vi.fn((group: EditorialGroup): boolean => selected.has(group.collection.id)),
    folderOf: vi.fn((group: EditorialGroup): Collection | undefined =>
      folders.get(group.collection.id),
    ),
    isRecommended: vi.fn((group: EditorialGroup): boolean =>
      recommended.has(group.collection.id),
    ),
    toggle: vi.fn((group: EditorialGroup, isSelected: boolean): void => {
      if (isSelected) selected.add(group.collection.id);
      else selected.delete(group.collection.id);
      fake.groups.set([...fake.groups()]);
    }),
    chooseFolder: vi.fn((group: EditorialGroup, folder: Collection): void => {
      folders.set(group.collection.id, folder);
    }),
  } satisfies Partial<EditorialGroupsService>;

  /** The collections are on their way, which is the state the step is first reached in. */
  function loading(): void {
    fake.loading.set(true);
  }

  /** The repository would not hand the groups back at all. */
  function fails(message: string): void {
    fake.error.set(message);
  }

  /** The config names no group for this repository, so there is nothing to forward to. */
  function unconfigured(): void {
    fake.configured.set(false);
    fake.none.set(true);
  }

  /** This many of the configured groups the repository did not hand back. */
  function missing(count: number): void {
    fake.unavailable.set(count);
  }

  /** A folder was picked for the group — by the user unless it says it was proposed. */
  function picked(group: EditorialGroup, folder: Collection, byRecommendation = false): void {
    folders.set(group.collection.id, folder);
    if (byRecommendation) recommended.add(group.collection.id);
  }

  return { fake, loading, fails, unconfigured, missing, picked, selected };
}

export type EditorialGroupsFake = ReturnType<typeof fakeEditorialGroups>;
