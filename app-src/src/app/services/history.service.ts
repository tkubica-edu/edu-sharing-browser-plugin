import { Injectable, inject, signal } from '@angular/core';

import { APP_CONFIG } from '../config';
import { BrowserExtensionService } from './browser-extension.service';
import { ParsedMetadata } from './metadata-agent.service';

export interface HistoryEntry {
  id: string;
  /** The created edu-sharing node — the history only holds saved nodes. */
  nodeId: string;
  url: string;
  title: string;
  favIconUrl?: string;
  timestamp: number;
  fieldsExtracted: number | null;
  fieldsTotal: number | null;
  /** Full parsed metadata, so a past entry can be re-displayed. */
  parsed: ParsedMetadata;
}

/** What a caller supplies; id and timestamp are assigned here. */
export type NewHistoryEntry = Omit<HistoryEntry, 'id' | 'timestamp'>;

/** The saved nodes, persisted in extension storage. */
@Injectable({ providedIn: 'root' })
export class HistoryService {
  private readonly browserExtension = inject(BrowserExtensionService);

  readonly entries = signal<readonly HistoryEntry[]>([]);

  async load(): Promise<void> {
    const stored = await this.browserExtension.storageGet<HistoryEntry[]>(
      APP_CONFIG.storageKeys.history,
      [],
    );
    const list = Array.isArray(stored) ? stored : [];
    // Keep only entries that carry a node id (drops legacy pre-node entries).
    const valid = list.filter((entry) => !!entry?.nodeId);
    this.entries.set(valid);
    if (valid.length !== list.length) await this.persist();
  }

  async add(entry: NewHistoryEntry): Promise<void> {
    const added: HistoryEntry = { ...entry, id: crypto.randomUUID(), timestamp: Date.now() };
    // De-dupe by node id: a re-saved node moves to the top rather than piling up.
    const others = this.entries().filter((existing) => existing.nodeId !== added.nodeId);
    this.entries.set([added, ...others].slice(0, APP_CONFIG.maxHistory));
    await this.persist();
  }

  async clear(): Promise<void> {
    this.entries.set([]);
    await this.persist();
  }

  private persist(): Promise<void> {
    return this.browserExtension.storageSet(APP_CONFIG.storageKeys.history, this.entries());
  }
}
