import { TestBed } from '@angular/core/testing';
import { CollectionService, ConfigService, Node } from 'ngx-edu-sharing-api';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  CollectionsFake,
  ConfigFake,
  CurationFake,
  DevModeFake,
  RecommendationsFake,
  aNode,
  fakeCollections,
  fakeConfig,
  fakeCuration,
  fakeDevMode,
  fakeRecommendations,
} from '../../testing/fakes';
import { provideFake } from '../../testing/provide-fake';
import { CollectionRecommendationService } from './collection-recommendation.service';
import { CurationService } from './curation.service';
import { DevModeService } from './dev-mode.service';
import { EditorialGroup, EditorialGroupsService } from './editorial-groups.service';

const GROUP_A = 'aaaaaaaa-1111-1111-1111-111111111111';
const GROUP_B = 'bbbbbbbb-2222-2222-2222-222222222222';
const FOLDER = 'cccccccc-3333-3333-3333-333333333333';

/** A collection node, named the way the repository names one. */
function aCollection(id: string, title: string, overrides: Partial<Node> = {}): Node {
  return aNode({ ref: { id, repo: 'local' }, collection: { title }, ...overrides } as Partial<Node>);
}

describe('EditorialGroupsService', () => {
  let groups: EditorialGroupsService;
  let config: ConfigFake;
  let collections: CollectionsFake;
  let curation: CurationFake;
  let recommendations: RecommendationsFake;
  let devMode: DevModeFake;

  beforeEach(() => {
    config = fakeConfig();
    collections = fakeCollections();
    curation = fakeCuration();
    recommendations = fakeRecommendations();
    devMode = fakeDevMode();
    TestBed.configureTestingModule({
      providers: [
        provideFake(ConfigService, config.fake),
        provideFake(CollectionService, collections.fake),
        provideFake(CurationService, curation.fake),
        provideFake(CollectionRecommendationService, recommendations.fake),
        provideFake(DevModeService, devMode.fake),
      ],
    });
    groups = TestBed.inject(EditorialGroupsService);
  });

  /** The group under this id, once loaded. */
  function group(id: string): EditorialGroup {
    return groups.groups().find((one) => one.collection.id === id)!;
  }

  describe('reading the config', () => {
    it('reads the list as the repository writes it — bracketed and single-quoted', async () => {
      config.answersVariables({ browserExtensionEditorialGroups: `['${GROUP_A}', '${GROUP_B}']` });
      collections.holds(aCollection(GROUP_A, 'Redaktion A'));
      collections.holds(aCollection(GROUP_B, 'Redaktion B'));

      await groups.load();

      expect(groups.groups().map((one) => one.collection.name)).toEqual(['Redaktion A', 'Redaktion B']);
    });

    it('reads a bare comma-separated list the same way', async () => {
      collections.holds(aCollection(GROUP_A, 'Redaktion A'));
      config.answersVariables({ browserExtensionEditorialGroups: `${GROUP_A}` });

      await groups.load();

      expect(groups.groups()).toHaveLength(1);
    });

    it('reads a real array the same way', async () => {
      collections.holds(aCollection(GROUP_A, 'Redaktion A'));
      config.answersVariables({ browserExtensionEditorialGroups: [GROUP_A] });

      await groups.load();

      expect(groups.groups()).toHaveLength(1);
    });

    it('says the repository names no editorial group where it names none', async () => {
      config.answersVariables({});

      await groups.load();

      expect(groups.configured()).toBe(false);
      expect(groups.none()).toBe(true);
      expect(groups.groups()).toEqual([]);
    });

    it('holds the answer for the session, and hands every later caller the first load', async () => {
      config.answersVariables({ browserExtensionEditorialGroups: [GROUP_A] });
      collections.holds(aCollection(GROUP_A, 'Redaktion A'));

      await Promise.all([groups.load(), groups.load()]);
      await groups.load();

      expect(config.fake.observeVariables).toHaveBeenCalledTimes(1);
    });

    it('reports a config that did not answer, and leaves it unknown whether there are groups', async () => {
      config.failsVariables();

      await groups.load();

      expect(groups.error()).toContain('config unreachable');
      expect(groups.configured()).toBeNull();
      expect(groups.none()).toBe(false);
    });

    it('tries again after such a failure, since a later session may still get the list', async () => {
      config.failsVariables();
      await groups.load();

      config.answersVariables({ browserExtensionEditorialGroups: [GROUP_A] });
      collections.holds(aCollection(GROUP_A, 'Redaktion A'));
      await groups.load();

      expect(groups.groups()).toHaveLength(1);
      expect(groups.error()).toBeNull();
    });

    it('says it is loading while it is', async () => {
      config.answersVariables({ browserExtensionEditorialGroups: [] });
      const pending = groups.load();
      expect(groups.loading()).toBe(true);
      await pending;
      expect(groups.loading()).toBe(false);
    });
  });

  describe('one group', () => {
    beforeEach(() => {
      config.answersVariables({ browserExtensionEditorialGroups: [GROUP_A] });
    });

    it('carries the collections inside it, and the group\'s own node in front of them', async () => {
      collections.holds(aCollection(GROUP_A, 'Redaktion A'), [aCollection(FOLDER, 'Physik')]);

      await groups.load();

      expect(group(GROUP_A).folders).toEqual([{ id: FOLDER, name: 'Physik' }]);
      expect(group(GROUP_A).collectionTree.map((node) => node.ref.id)).toEqual([GROUP_A, FOLDER]);
    });

    it('points every collection inside it at the group, whatever its own parent is', async () => {
      collections.holds(aCollection(GROUP_A, 'Redaktion A'), [
        aCollection(FOLDER, 'Physik', { parent: { id: 'woanders' } } as Partial<Node>),
      ]);

      await groups.load();

      const inside = group(GROUP_A).collectionTree[1] as Node & { parent: { id: string } };
      expect(inside.parent.id).toBe(GROUP_A);
    });

    it('names it by its own title, else the node\'s, else its name', async () => {
      collections.holds(aNode({ ref: { id: GROUP_A, repo: 'local' }, title: 'Aus dem Node' } as Partial<Node>));
      await groups.load();
      expect(group(GROUP_A).collection.name).toBe('Aus dem Node');
    });

    it('carries the group\'s own picture', async () => {
      collections.holds(
        aCollection(GROUP_A, 'Redaktion A', {
          preview: { url: 'https://repo.example.org/logo.png', isIcon: false },
        } as Partial<Node>),
      );

      await groups.load();

      expect(group(GROUP_A).logoUrl).toBe('https://repo.example.org/logo.png');
    });

    it('carries none where the repository has only a type icon, which says nothing about the group', async () => {
      collections.holds(
        aCollection(GROUP_A, 'Redaktion A', {
          preview: { url: 'https://repo.example.org/icon.svg', isIcon: true },
        } as Partial<Node>),
      );

      await groups.load();

      expect(group(GROUP_A).logoUrl).toBeNull();
    });

    it('offers the group itself where the collections inside it could not be read', async () => {
      collections.holds(aCollection(GROUP_A, 'Redaktion A'), [aCollection(FOLDER, 'Physik')]);
      collections.refusesChildren(GROUP_A);

      await groups.load();

      expect(group(GROUP_A).folders).toEqual([]);
    });

    it('names how many groups the repository would not hand back', async () => {
      config.answersVariables({ browserExtensionEditorialGroups: [GROUP_A, GROUP_B] });
      collections.holds(aCollection(GROUP_A, 'Redaktion A'));

      await groups.load();

      expect(groups.groups()).toHaveLength(1);
      expect(groups.unavailable()).toBe(1);
    });
  });

  describe('the choice', () => {
    beforeEach(async () => {
      config.answersVariables({ browserExtensionEditorialGroups: [GROUP_A, GROUP_B] });
      collections.holds(aCollection(GROUP_A, 'Redaktion A'), [aCollection(FOLDER, 'Physik')]);
      collections.holds(aCollection(GROUP_B, 'Redaktion B'));
      await groups.load();
    });

    it('forwards to a group the checkbox ticks', () => {
      groups.toggle(group(GROUP_A), true);

      expect(groups.isSelected(group(GROUP_A))).toBe(true);
      expect(curation.fake.setEditorialTargets).toHaveBeenCalledWith([
        { group: { id: GROUP_A, name: 'Redaktion A' } },
      ]);
    });

    it('stops forwarding, and drops the collection picked for it with it', () => {
      groups.chooseFolder(group(GROUP_A), { id: FOLDER, name: 'Physik' });
      groups.toggle(group(GROUP_A), false);

      expect(groups.isSelected(group(GROUP_A))).toBe(false);
      expect(curation.editorialTargets()).toEqual([]);
    });

    it('leaves every other group alone', () => {
      groups.toggle(group(GROUP_A), true);
      groups.toggle(group(GROUP_B), true);
      groups.toggle(group(GROUP_A), false);

      expect(curation.editorialTargets().map((target) => target.group.id)).toEqual([GROUP_B]);
    });

    it('hands the choice over in the order the groups are listed, not the order they were ticked', () => {
      groups.toggle(group(GROUP_B), true);
      groups.toggle(group(GROUP_A), true);

      expect(curation.editorialTargets().map((target) => target.group.id)).toEqual([GROUP_A, GROUP_B]);
    });

    it('selects the group along with a collection picked inside it', () => {
      groups.chooseFolder(group(GROUP_A), { id: FOLDER, name: 'Physik' });

      expect(groups.isSelected(group(GROUP_A))).toBe(true);
      expect(groups.folderOf(group(GROUP_A))).toEqual({ id: FOLDER, name: 'Physik' });
    });

    it('names the group whose collection is being picked, so both screens read it', () => {
      groups.pick(group(GROUP_A));

      expect(groups.picking()?.collection.id).toBe(GROUP_A);
    });
  });

  describe('the proposal', () => {
    beforeEach(() => {
      config.answersVariables({ browserExtensionEditorialGroups: [GROUP_A] });
      collections.holds(aCollection(GROUP_A, 'Redaktion A'), [aCollection(FOLDER, 'Physik')]);
      curation.fake.contentKeywords.set(['Optik', 'Linsen']);
    });

    it('takes the proposed collection over as the group\'s choice, and forwards to the group', async () => {
      recommendations.proposes(aCollection(FOLDER, 'Physik'), [FOLDER, GROUP_A]);

      await groups.recommendCollection();

      expect(groups.folderOf(group(GROUP_A))).toEqual({ id: FOLDER, name: 'Physik' });
      expect(groups.isSelected(group(GROUP_A))).toBe(true);
      expect(groups.isRecommended(group(GROUP_A))).toBe(true);
    });

    it('offers a collection proposed from deeper inside the tree among the group\'s own', async () => {
      const deep = aCollection('dddddddd-4444-4444-4444-444444444444', 'Optik');
      recommendations.proposes(deep, [deep.ref.id, FOLDER, GROUP_A]);

      await groups.recommendCollection();

      expect(group(GROUP_A).folders.map((folder) => folder.id)).toEqual([deep.ref.id, FOLDER]);
    });

    it('asks once per set of keywords, so re-entering the step does not undo what was done', async () => {
      recommendations.proposes(aCollection(FOLDER, 'Physik'), [FOLDER, GROUP_A]);

      await groups.recommendCollection();
      await groups.recommendCollection();

      expect(recommendations.fake.recommend).toHaveBeenCalledTimes(1);
    });

    it('asks nothing for a content with no keywords, and nothing where no group is configured', async () => {
      curation.fake.contentKeywords.set([]);
      await groups.recommendCollection();
      expect(recommendations.fake.recommend).not.toHaveBeenCalled();

      curation.fake.contentKeywords.set(['Optik']);
      config.answersVariables({});
      await groups.load();
      await groups.recommendCollection();
      expect(recommendations.fake.recommend).not.toHaveBeenCalled();
    });

    it('drops a collection that belongs to no configured group', async () => {
      recommendations.proposes(aCollection(FOLDER, 'Physik'), [FOLDER, 'ganz-woanders']);

      await groups.recommendCollection();

      expect(groups.folderOf(group(GROUP_A))).toBeUndefined();
      expect(groups.isSelected(group(GROUP_A))).toBe(false);
    });

    it('drops one that is the group itself — there is nothing to pick inside it', async () => {
      recommendations.proposes(aCollection(GROUP_A, 'Redaktion A'), [GROUP_A]);

      await groups.recommendCollection();

      expect(groups.folderOf(group(GROUP_A))).toBeUndefined();
    });

    it('lets a collection the user picked by hand stand', async () => {
      await groups.load();
      groups.chooseFolder(group(GROUP_A), { id: FOLDER, name: 'Physik' });
      const deep = aCollection('dddddddd-4444-4444-4444-444444444444', 'Optik');
      recommendations.proposes(deep, [deep.ref.id, GROUP_A]);

      await groups.recommendCollection();

      expect(groups.folderOf(group(GROUP_A))).toEqual({ id: FOLDER, name: 'Physik' });
    });

    it('changes nothing about the step where the assistant could not be asked', async () => {
      recommendations.fails();

      await groups.recommendCollection();
      // The proposal and the load run together; only the proposal failed, so the groups still arrive.
      await groups.load();

      expect(groups.folderOf(group(GROUP_A))).toBeUndefined();
      expect(groups.recommending()).toBe(false);
    });

    it('asks again next time where no group was loaded to take it over for', async () => {
      collections.refuses(GROUP_A);
      recommendations.proposes(aCollection(FOLDER, 'Physik'), [FOLDER, GROUP_A]);

      await groups.recommendCollection();
      expect(recommendations.fake.recommend).toHaveBeenCalledTimes(1);

      await groups.recommendCollection();
      expect(recommendations.fake.recommend).toHaveBeenCalledTimes(2);
    });

    it('says it is asking while it is', async () => {
      recommendations.proposes(aCollection(FOLDER, 'Physik'), [FOLDER, GROUP_A]);

      const pending = groups.recommendCollection();
      expect(groups.recommending()).toBe(true);
      await pending;
      expect(groups.recommending()).toBe(false);
    });

    it('offers the way back to the proposal once something else was picked', async () => {
      const deep = aCollection('dddddddd-4444-4444-4444-444444444444', 'Optik');
      recommendations.proposes(deep, [deep.ref.id, GROUP_A]);
      await groups.recommendCollection();
      expect(groups.droppedRecommendation(group(GROUP_A))).toBeNull();

      groups.chooseFolder(group(GROUP_A), { id: FOLDER, name: 'Physik' });

      expect(groups.isRecommended(group(GROUP_A))).toBe(false);
      expect(groups.droppedRecommendation(group(GROUP_A))).toEqual({ id: deep.ref.id, name: 'Optik' });

      groups.restoreRecommendation(group(GROUP_A));

      expect(groups.isRecommended(group(GROUP_A))).toBe(true);
    });

    it('names no way back for a group nothing was proposed for', async () => {
      await groups.load();

      expect(groups.droppedRecommendation(group(GROUP_A))).toBeNull();
      expect(groups.isRecommended(group(GROUP_A))).toBe(false);
    });

    it('shows the collection from the settings under the first group, for the dev mode alone', async () => {
      const test = aCollection('eeeeeeee-5555-5555-5555-555555555555', 'Testsammlung');
      devMode.fake.fakedCollectionId.set(test.ref.id);
      recommendations.proposes(test, [test.ref.id, 'ganz-woanders']);

      await groups.recommendCollection();

      expect(groups.folderOf(group(GROUP_A))).toEqual({ id: test.ref.id, name: 'Testsammlung' });
    });
  });
});
