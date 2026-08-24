import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_CONFIG } from '../config';
import { AuthService } from './auth.service';
import { BrowserExtensionService } from './browser-extension.service';
import { HistoryEntry, HistoryService, NewHistoryEntry } from './history.service';
import { ParsedMetadata } from './metadata-agent.service';
import { provideFake } from '../../testing/provide-fake';
import {
  AuthFake,
  BrowserExtensionFake,
  FAKE_REPOSITORY_URL,
  aHistoryEntry,
  fakeAuth,
  fakeBrowserExtension,
} from '../../testing/fakes';

const OTHER_REPOSITORY = 'https://other.example/edu-sharing';

/** What a caller hands `add()`: everything but the four fields the service assigns itself. */
function newEntry(overrides: Partial<NewHistoryEntry> = {}): NewHistoryEntry {
  return {
    nodeId: 'node-1',
    url: 'https://example.org/page',
    title: 'Eine Seite',
    fieldsExtracted: null,
    fieldsTotal: null,
    parsed: { fields: [] } as unknown as ParsedMetadata,
    ...overrides,
  };
}

describe('HistoryService', () => {
  let history: HistoryService;
  let extension: BrowserExtensionFake;
  let auth: AuthFake;

  beforeEach(() => {
    extension = fakeBrowserExtension();
    auth = fakeAuth();
    TestBed.configureTestingModule({
      providers: [
        provideFake(BrowserExtensionService, extension.fake),
        provideFake(AuthService, auth.fake),
      ],
    });
    history = TestBed.inject(HistoryService);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-24T12:00:00Z'));
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('11111111-2222-3333-4444-555555555555');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Seed the storage as a previous session would have left it. */
  function stored(entries: unknown): void {
    extension.storage.set(APP_CONFIG.storageKeys.history, entries);
  }

  /** What the last write put into storage, across every repository. */
  function persisted(): readonly HistoryEntry[] {
    return (extension.storage.get(APP_CONFIG.storageKeys.history) ?? []) as readonly HistoryEntry[];
  }

  describe('load', () => {
    it('reads nothing and writes nothing when the storage is empty', async () => {
      await history.load();

      expect(history.entries()).toEqual([]);
      expect(extension.fake.storageSet).not.toHaveBeenCalled();
    });

    it('leaves a sound list alone instead of writing it back', async () => {
      stored([aHistoryEntry()]);

      await history.load();

      expect(history.entries()).toHaveLength(1);
      expect(extension.fake.storageSet).not.toHaveBeenCalled();
    });

    it('drops an entry without a node id, since it could not be reopened', async () => {
      stored([aHistoryEntry(), { ...aHistoryEntry({ id: 'entry-2' }), nodeId: '' }]);

      await history.load();

      expect(history.entries().map((entry) => entry.id)).toEqual(['entry-1']);
      expect(extension.fake.storageSet).toHaveBeenCalledTimes(1);
    });

    it('stamps the configured repository onto an entry written before the split', async () => {
      const legacy = aHistoryEntry();
      stored([{ ...legacy, repositoryUrl: undefined }]);

      await history.load();

      expect(history.entries()[0].repositoryUrl).toBe(FAKE_REPOSITORY_URL);
      // Repaired in place, so the next session reads a complete entry.
      expect(persisted()[0].repositoryUrl).toBe(FAKE_REPOSITORY_URL);
    });

    it('survives a stored value that is not a list', async () => {
      stored({ nonsense: true });

      await history.load();

      expect(history.entries()).toEqual([]);
    });
  });

  describe('entries', () => {
    it('shows only the configured repository, whatever its trailing slash and casing', async () => {
      stored([
        aHistoryEntry({ id: 'own', repositoryUrl: 'https://REPO.example/edu-sharing/' }),
        aHistoryEntry({ id: 'foreign', nodeId: 'node-2', repositoryUrl: OTHER_REPOSITORY }),
      ]);

      await history.load();

      expect(history.entries().map((entry) => entry.id)).toEqual(['own']);
    });

    it('answers for the repository that is configured now, not the one at load time', async () => {
      stored([
        aHistoryEntry({ id: 'own' }),
        aHistoryEntry({ id: 'foreign', nodeId: 'node-2', repositoryUrl: OTHER_REPOSITORY }),
      ]);
      await history.load();

      auth.fake.repositoryUrl.set(OTHER_REPOSITORY);

      expect(history.entries().map((entry) => entry.id)).toEqual(['foreign']);
    });
  });

  describe('add', () => {
    it('assigns the id, the time, the repository and the open step', async () => {
      history.noteStep({ section: 'curation', tab: 'metadata' }, null);

      await history.add(newEntry());

      expect(history.entries()[0]).toMatchObject({
        id: '11111111-2222-3333-4444-555555555555',
        timestamp: Date.parse('2026-08-24T12:00:00Z'),
        repositoryUrl: FAKE_REPOSITORY_URL,
        step: { section: 'curation', tab: 'metadata' },
      });
    });

    it('moves a re-saved node to the top instead of piling it up', async () => {
      await history.add(newEntry({ nodeId: 'node-1', title: 'erst' }));
      await history.add(newEntry({ nodeId: 'node-2' }));
      await history.add(newEntry({ nodeId: 'node-1', title: 'dann' }));

      expect(history.entries().map((entry) => entry.nodeId)).toEqual(['node-1', 'node-2']);
      expect(history.entries()[0].title).toBe('dann');
    });

    it('leaves another repository entry for the same node standing', async () => {
      stored([aHistoryEntry({ id: 'foreign', repositoryUrl: OTHER_REPOSITORY })]);
      await history.load();

      await history.add(newEntry({ nodeId: 'node-1' }));

      expect(history.entries()).toHaveLength(1);
      expect(persisted()).toHaveLength(2);
    });

    it('caps each repository on its own, so one cannot crowd out another', async () => {
      const own = Array.from({ length: APP_CONFIG.maxHistory }, (_unused, index) =>
        aHistoryEntry({ id: `own-${index}`, nodeId: `own-node-${index}` }),
      );
      const foreign = Array.from({ length: 3 }, (_unused, index) =>
        aHistoryEntry({
          id: `foreign-${index}`,
          nodeId: `foreign-node-${index}`,
          repositoryUrl: OTHER_REPOSITORY,
        }),
      );
      stored([...own, ...foreign]);
      await history.load();

      await history.add(newEntry({ nodeId: 'one-too-many' }));

      expect(history.entries()).toHaveLength(APP_CONFIG.maxHistory);
      expect(history.entries()[0].nodeId).toBe('one-too-many');
      // The oldest of this repository fell out; none of the other's did.
      expect(history.entries().some((entry) => entry.nodeId === `own-node-${APP_CONFIG.maxHistory - 1}`)).toBe(false);
      expect(persisted().filter((entry) => entry.repositoryUrl === OTHER_REPOSITORY)).toHaveLength(3);
    });

    it('persists under the configured key, all repositories together', async () => {
      await history.add(newEntry());

      expect(extension.fake.storageSet).toHaveBeenLastCalledWith(
        APP_CONFIG.storageKeys.history,
        expect.arrayContaining([expect.objectContaining({ nodeId: 'node-1' })]),
      );
    });
  });

  describe('clear', () => {
    it('drops this repository and keeps every other one', async () => {
      stored([
        aHistoryEntry({ id: 'own' }),
        aHistoryEntry({ id: 'foreign', nodeId: 'node-2', repositoryUrl: OTHER_REPOSITORY }),
      ]);
      await history.load();

      await history.clear();

      expect(history.entries()).toEqual([]);
      expect(persisted().map((entry) => entry.id)).toEqual(['foreign']);
    });
  });

  describe('noteStep', () => {
    it('writes the step onto the entry the node already has', async () => {
      stored([aHistoryEntry({ step: null })]);
      await history.load();
      extension.fake.storageSet.mockClear();

      history.noteStep({ section: 'quality', tab: 'quality-check' }, 'node-1');
      await vi.runAllTimersAsync();

      expect(history.entries()[0].step).toEqual({ section: 'quality', tab: 'quality-check' });
      expect(extension.fake.storageSet).toHaveBeenCalledTimes(1);
    });

    it('says nothing about a content for the menu or the login', async () => {
      stored([aHistoryEntry({ step: { section: 'quality', tab: null } })]);
      await history.load();
      extension.fake.storageSet.mockClear();

      history.noteStep({ section: 'menu', tab: null }, 'node-1');
      history.noteStep({ section: 'login', tab: null }, 'node-1');
      await vi.runAllTimersAsync();

      expect(history.entries()[0].step).toEqual({ section: 'quality', tab: null });
      expect(extension.fake.storageSet).not.toHaveBeenCalled();
    });

    it('writes nothing for a node the history does not hold', async () => {
      stored([aHistoryEntry()]);
      await history.load();
      extension.fake.storageSet.mockClear();

      history.noteStep({ section: 'quality', tab: null }, 'unknown-node');
      await vi.runAllTimersAsync();

      expect(extension.fake.storageSet).not.toHaveBeenCalled();
    });

    it('writes nothing when the entry already stands on that step', async () => {
      stored([aHistoryEntry({ step: { section: 'quality', tab: null } })]);
      await history.load();
      extension.fake.storageSet.mockClear();

      history.noteStep({ section: 'quality', tab: null }, 'node-1');
      await vi.runAllTimersAsync();

      expect(extension.fake.storageSet).not.toHaveBeenCalled();
    });
  });
});
