import { TestBed } from '@angular/core/testing';
import { Node } from 'ngx-edu-sharing-api';
import { Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_CONFIG, toTopicAssistantUrl } from '../config';
import {
  AuthFake,
  BrowserExtensionFake,
  DevModeFake,
  aNode,
  fakeAuth,
  fakeBrowserExtension,
  fakeDevMode,
} from '../../testing/fakes';
import { provideFake } from '../../testing/provide-fake';
import { AuthService } from './auth.service';
import { BrowserExtensionService } from './browser-extension.service';
import {
  CollectionRecommendationService,
  DEFAULT_MAX_KEYWORDS,
  DEFAULT_MIN_SCORE,
} from './collection-recommendation.service';
import { DevModeService } from './dev-mode.service';
import { RepositoryNodeService } from './repository-node.service';

const REPOSITORY = 'https://repo.example.org/edu-sharing';
const TOPIC_A = 'aaaaaaaa-1111-1111-1111-111111111111';
const TOPIC_B = 'bbbbbbbb-2222-2222-2222-222222222222';

/** The text the keywords were generated from — what ranks them. */
const TEXT = 'Optik ist die Lehre vom Licht. Optik, Linsen und Spiegel gehören zur Optik.';

/** A collection node the assistant's topic leads to. */
function aCollection(id: string, title = 'Physik'): Node {
  return aNode({ ref: { id, repo: 'local' }, title, collection: { title } } as Partial<Node>);
}

describe('CollectionRecommendationService', () => {
  let recommendation: CollectionRecommendationService;
  let auth: AuthFake;
  let extension: BrowserExtensionFake;
  let devMode: DevModeFake;
  let fetchMock: Mock;
  let repositoryNodes: { get: Mock; ancestors: Mock };

  beforeEach(() => {
    auth = fakeAuth(REPOSITORY);
    extension = fakeBrowserExtension();
    devMode = fakeDevMode();
    repositoryNodes = {
      get: vi.fn((id: string) => Promise.resolve(aCollection(id))),
      ancestors: vi.fn(() => Promise.resolve([] as Node[])),
    };
    TestBed.configureTestingModule({
      providers: [
        provideFake(AuthService, auth.fake),
        provideFake(BrowserExtensionService, extension.fake),
        provideFake(DevModeService, devMode.fake),
        provideFake(RepositoryNodeService, repositoryNodes as never),
      ],
    });
    recommendation = TestBed.inject(CollectionRecommendationService);
    // Stubbed over the guard from `no-network.setup.ts`: the topic assistant is reached by `fetch`.
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => vi.useRealTimers());

  /** The assistant answers with these topics. */
  function answersTopics(topics: unknown[]): void {
    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ topics, version: '1.0' }))),
    );
  }

  /** What the assistant was asked. */
  function asked(): { text: string } {
    return JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
  }

  describe('the settings', () => {
    it('ships with a handful of keywords and a high bar', () => {
      expect(recommendation.maxKeywords()).toBe(DEFAULT_MAX_KEYWORDS);
      expect(recommendation.minScore()).toBe(DEFAULT_MIN_SCORE);
      expect(recommendation.changedSettings()).toBe(0);
    });

    it('keeps both, so the next session finds them', async () => {
      await recommendation.setMaxKeywords(5);
      await recommendation.setMinScore(0.5);

      expect(extension.fake.storageSet).toHaveBeenCalledWith(
        APP_CONFIG.storageKeys.recommendationKeywords,
        5,
      );
      expect(extension.fake.storageSet).toHaveBeenCalledWith(
        APP_CONFIG.storageKeys.recommendationMinScore,
        0.5,
      );
      expect(recommendation.changedSettings()).toBe(2);
    });

    it('brings a keyword count into range: a whole number, at least one', async () => {
      await recommendation.setMaxKeywords(2.7);
      expect(recommendation.maxKeywords()).toBe(2);

      await recommendation.setMaxKeywords(0);
      expect(recommendation.maxKeywords()).toBe(1);

      await recommendation.setMaxKeywords(Number.NaN);
      expect(recommendation.maxKeywords()).toBe(DEFAULT_MAX_KEYWORDS);
    });

    it('brings a score into the range the ranking answers in', async () => {
      await recommendation.setMinScore(2);
      expect(recommendation.minScore()).toBe(1);

      await recommendation.setMinScore(-1);
      expect(recommendation.minScore()).toBe(0);

      await recommendation.setMinScore(Number.NaN);
      expect(recommendation.minScore()).toBe(DEFAULT_MIN_SCORE);
    });

    it('loads what was kept, bringing it into range on the way in', async () => {
      extension.storage.set(APP_CONFIG.storageKeys.recommendationKeywords, '4');
      extension.storage.set(APP_CONFIG.storageKeys.recommendationMinScore, '5');

      await recommendation.load();

      expect(recommendation.maxKeywords()).toBe(4);
      expect(recommendation.minScore()).toBe(1);
    });

    it('puts both back to what they are without anybody setting them', async () => {
      await recommendation.setMaxKeywords(9);
      await recommendation.setMinScore(0.1);

      await recommendation.resetToDefaults();

      expect(recommendation.changedSettings()).toBe(0);
    });
  });

  describe('recommend', () => {
    it('asks the topic assistant behind the repository\'s own proxy, carrying the session', async () => {
      answersTopics([{ label: 'Physik', weight: 5, uri: `http://vocab/${TOPIC_A}` }]);

      await recommendation.recommend(['Optik'], TEXT);

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(toTopicAssistantUrl(REPOSITORY));
      expect(init.method).toBe('POST');
      expect(init.credentials).toBe('include');
    });

    it('proposes the collection the best-weighted topic is kept as', async () => {
      answersTopics([
        { label: 'Sonstiges', weight: 1, uri: `http://vocab/${TOPIC_B}` },
        { label: 'Physik', weight: 9, uri: `http://vocab/${TOPIC_A}` },
      ]);

      const found = await recommendation.recommend(['Optik'], TEXT);

      expect(found?.node.ref.id).toBe(TOPIC_A);
      expect(repositoryNodes.get).toHaveBeenCalledWith(TOPIC_A);
    });

    it('walks on to the next candidate where one is nothing to file into', async () => {
      answersTopics([
        { label: 'Physik', weight: 9, uri: `http://vocab/${TOPIC_A}` },
        { label: 'Sonstiges', weight: 1, uri: `http://vocab/${TOPIC_B}` },
      ]);
      repositoryNodes.get.mockImplementation((id: string) =>
        id === TOPIC_A ? Promise.resolve(aNode()) : Promise.resolve(aCollection(id)),
      );

      expect((await recommendation.recommend(['Optik'], TEXT))?.node.ref.id).toBe(TOPIC_B);
    });

    it('reads a node the repository will not hand back as nothing to file into either', async () => {
      answersTopics([{ label: 'Physik', weight: 9, uri: `http://vocab/${TOPIC_A}` }]);
      repositoryNodes.get.mockRejectedValue(new Error('gone'));

      await expect(recommendation.recommend(['Optik'], TEXT)).resolves.toBeNull();
    });

    it('follows only the topics the assistant named, and not the tree\'s own root', async () => {
      answersTopics([
        { weight: 99, uri: `http://vocab/${TOPIC_B}` },
        { label: '  ', weight: 50, uri: `http://vocab/${TOPIC_B}` },
        { label: 'Physik', weight: 1, uri: `http://vocab/${TOPIC_A}` },
      ]);

      expect((await recommendation.recommend(['Optik'], TEXT))?.node.ref.id).toBe(TOPIC_A);
    });

    it('looks each node up once, and only the best few', async () => {
      answersTopics(
        Array.from({ length: 8 }, (_, index) => ({
          label: `Thema ${index}`,
          weight: index,
          uri: `http://vocab/topic-${index}`,
        })).concat([{ label: 'Doppelt', weight: 99, uri: 'http://vocab/topic-7' }]),
      );
      repositoryNodes.get.mockResolvedValue(aNode());

      await recommendation.recommend(['Optik'], TEXT);

      expect(repositoryNodes.get.mock.calls.map((call) => call[0])).toEqual([
        'topic-7',
        'topic-6',
        'topic-5',
      ]);
    });

    it('names where the collection sits, closest first, with itself in front', async () => {
      answersTopics([{ label: 'Physik', weight: 9, uri: `http://vocab/${TOPIC_A}` }]);
      repositoryNodes.ancestors.mockResolvedValue([aCollection(TOPIC_B, 'Redaktion')]);

      expect((await recommendation.recommend(['Optik'], TEXT))?.ancestry).toEqual([TOPIC_A, TOPIC_B]);
    });

    it('leaves the answer\'s own order alone where it already leads with the node', async () => {
      answersTopics([{ label: 'Physik', weight: 9, uri: `http://vocab/${TOPIC_A}` }]);
      repositoryNodes.ancestors.mockResolvedValue([aCollection(TOPIC_A), aCollection(TOPIC_B)]);

      expect((await recommendation.recommend(['Optik'], TEXT))?.ancestry).toEqual([TOPIC_A, TOPIC_B]);
    });

    it('falls back to the node\'s own parent where the chain cannot be read', async () => {
      answersTopics([{ label: 'Physik', weight: 9, uri: `http://vocab/${TOPIC_A}` }]);
      repositoryNodes.get.mockResolvedValue(
        aCollection(TOPIC_A) && { ...aCollection(TOPIC_A), parent: { id: TOPIC_B } },
      );
      repositoryNodes.ancestors.mockRejectedValue(new Error('no parents'));

      expect((await recommendation.recommend(['Optik'], TEXT))?.ancestry).toEqual([TOPIC_A, TOPIC_B]);
    });

    it('asks with at most as many keywords as the settings allow', async () => {
      answersTopics([]);
      await recommendation.setMaxKeywords(2);
      await recommendation.setMinScore(0);

      await recommendation.recommend(['Optik', 'Linsen', 'Spiegel', 'Licht'], TEXT);

      expect(asked().text.split(', ')).toHaveLength(2);
    });

    it('asks nothing where nothing reaches the bar', async () => {
      await recommendation.setMinScore(1);

      await expect(recommendation.recommend(['Nichts', 'Anderes'], TEXT)).resolves.toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('lets the keywords stand as generated where there is no text to rank them against', async () => {
      answersTopics([]);
      await recommendation.setMaxKeywords(2);

      await recommendation.recommend(['Optik', 'Linsen', 'Spiegel']);

      expect(asked().text).toBe('Optik, Linsen');
    });

    it('asks nothing for a content with no keywords', async () => {
      await expect(recommendation.recommend([])).resolves.toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects where the assistant itself did not answer — that is not "came up empty"', async () => {
      fetchMock.mockRejectedValue(new Error('Failed to fetch'));

      await expect(recommendation.recommend(['Optik'], TEXT)).rejects.toThrow(
        'Themen-Assistent nicht erreichbar',
      );
    });

    it('proposes the collection from the settings while the dev mode names one, asking nothing', async () => {
      devMode.fake.fakedCollectionId.set(TOPIC_B);

      const found = await recommendation.recommend(['Optik'], TEXT);

      expect(found?.node.ref.id).toBe(TOPIC_B);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('proposes nothing where that collection is none this session can read', async () => {
      devMode.fake.fakedCollectionId.set(TOPIC_B);
      repositoryNodes.get.mockResolvedValue(aNode());

      await expect(recommendation.recommend(['Optik'], TEXT)).resolves.toBeNull();
    });
  });
});
