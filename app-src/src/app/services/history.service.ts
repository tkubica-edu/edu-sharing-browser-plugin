import { Injectable, computed, inject, signal } from '@angular/core';

import { APP_CONFIG } from '../config';
import { AuthService } from './auth.service';
import { BrowserExtensionService } from './browser-extension.service';
import { ParsedMetadata } from './metadata-agent.service';

export interface HistoryEntry {
  id: string;
  /** The created edu-sharing node — the history only holds saved nodes. */
  nodeId: string;
  /** The repository the node lives in; entries are only ever shown for the configured one. */
  repositoryUrl: string;
  url: string;
  title: string;
  favIconUrl?: string;
  timestamp: number;
  fieldsExtracted: number | null;
  fieldsTotal: number | null;
  /** Full parsed metadata, so a past entry can be re-displayed. */
  parsed: ParsedMetadata;
}

/** What a caller supplies; id, timestamp and repository are assigned here. */
export type NewHistoryEntry = Omit<HistoryEntry, 'id' | 'timestamp' | 'repositoryUrl'>;

/** Compare repository bases regardless of trailing slash and casing. */
function sameRepository(a: string, b: string): boolean {
  return normalizeRepository(a) === normalizeRepository(b);
}

function normalizeRepository(url: string): string {
  return (url || '').trim().replace(/\/+$/, '').toLowerCase();
}

/**
 * The saved nodes, persisted in extension storage. A node only exists in the repository it was saved
 * to, so the history is kept per repository: all of them are stored together, but only the entries of
 * the configured repository are ever exposed.
 */
@Injectable({ providedIn: 'root' })
export class HistoryService {
  private readonly browserExtension = inject(BrowserExtensionService);
  private readonly auth = inject(AuthService);

  /** Every stored entry, across all repositories. */
  private readonly allEntries = signal<readonly HistoryEntry[]>([]);

  /** The entries of the configured repository, newest first. */
  readonly entries = computed(() =>
    this.allEntries().filter((entry) => sameRepository(entry.repositoryUrl, this.auth.repositoryUrl())),
  );

  async load(): Promise<void> {
    const stored = await this.browserExtension.storageGet<HistoryEntry[]>(
      APP_CONFIG.storageKeys.history,
      [],
    );
    const list = Array.isArray(stored) ? stored : [];
    // Keep only entries that carry a node id — without one an entry cannot be reopened.
    const valid = list.filter((entry) => !!entry?.nodeId);
    // Entries written before the history was split per repository carry no repository: they can only
    // have come from the one that is configured, so that is where they stay.
    const repaired = valid.map((entry) =>
      entry.repositoryUrl ? entry : { ...entry, repositoryUrl: this.auth.repositoryUrl() },
    );
    this.allEntries.set(repaired);
    if (valid.length !== list.length || repaired.some((entry, index) => entry !== valid[index])) {
      await this.persist();
    }
  }

  async add(entry: NewHistoryEntry): Promise<void> {
    const repositoryUrl = this.auth.repositoryUrl();
    const added: HistoryEntry = {
      ...entry,
      repositoryUrl,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
    };
    // De-dupe by node id within the repository: a re-saved node moves to the top rather than piling up.
    const foreign = this.allEntries().filter(
      (existing) => !sameRepository(existing.repositoryUrl, repositoryUrl),
    );
    const own = this.allEntries().filter(
      (existing) =>
        sameRepository(existing.repositoryUrl, repositoryUrl) && existing.nodeId !== added.nodeId,
    );
    // The cap counts per repository, so one repository's history cannot crowd out another's.
    this.allEntries.set([...[added, ...own].slice(0, APP_CONFIG.maxHistory), ...foreign]);
    await this.persist();
  }

  /** Drop the configured repository's entries; the other repositories' histories are untouched. */
  async clear(): Promise<void> {
    const current = this.auth.repositoryUrl();
    this.allEntries.update((entries) =>
      entries.filter((entry) => !sameRepository(entry.repositoryUrl, current)),
    );
    await this.persist();
  }

  private persist(): Promise<void> {
    return this.browserExtension.storageSet(APP_CONFIG.storageKeys.history, this.allEntries());
  }
}
