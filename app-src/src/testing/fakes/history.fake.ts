import { signal } from '@angular/core';
import { vi } from 'vitest';

import { HistoryEntry, HistoryService } from '../../app/services/history.service';
import { ParsedMetadata } from '../../app/services/metadata-agent.service';
import { FAKE_REPOSITORY_URL } from './auth.fake';

/** An entry as `add()` would have written it, for the lookups that read the history back. */
export function aHistoryEntry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: 'entry-1',
    nodeId: 'node-1',
    repositoryUrl: FAKE_REPOSITORY_URL,
    url: 'https://example.org/page',
    title: 'Eine Seite',
    timestamp: 1_700_000_000_000,
    fieldsExtracted: null,
    fieldsTotal: null,
    parsed: { fields: [] } as unknown as ParsedMetadata,
    ...overrides,
  };
}

/** `HistoryService` as the list its readers search, without the storage behind it. */
export function fakeHistory(entries: readonly HistoryEntry[] = []) {
  const fake = {
    entries: signal<HistoryEntry[]>([...entries]),
    noteStep: vi.fn(),
    add: vi.fn((_entry: Partial<HistoryEntry>): Promise<void> => Promise.resolve()),
    clear: vi.fn((): Promise<void> => Promise.resolve()),
  } satisfies Partial<HistoryService>;

  return { fake };
}

export type HistoryFake = ReturnType<typeof fakeHistory>;
