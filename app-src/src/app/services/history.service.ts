import { Injectable, inject, signal } from '@angular/core';
import { APP_CONFIG } from '../config';
import { ExtService } from './ext.service';
import { ParsedResult } from './generate.service';

export interface HistoryEntry {
  id: string;
  /** The created edu-sharing node — the Verlauf only holds saved nodes. */
  nodeId: string;
  url: string;
  title: string;
  favIconUrl?: string;
  timestamp: number;
  fieldsExtracted: number | null;
  fieldsTotal: number | null;
  /** Full parsed result, so a past entry can be re-displayed. */
  parsed: ParsedResult;
}

@Injectable({ providedIn: 'root' })
export class HistoryService {
  private readonly ext = inject(ExtService);
  readonly entries = signal<HistoryEntry[]>([]);

  async load(): Promise<void> {
    if (!this.ext.available) return;
    const list = await this.ext.storageGet<HistoryEntry[]>(APP_CONFIG.storageKeys.history, []);
    const raw = Array.isArray(list) ? list : [];
    // Keep only entries that carry a node id (drops legacy pre-node entries).
    const valid = raw.filter((e) => !!e?.nodeId);
    this.entries.set(valid);
    if (valid.length !== raw.length) await this.persist();
  }

  async add(entry: Omit<HistoryEntry, 'id' | 'timestamp'> & { timestamp?: number }): Promise<void> {
    const full: HistoryEntry = {
      ...entry,
      id: this.makeId(),
      timestamp: entry.timestamp ?? Date.now()
    };
    // De-dupe by node id: a re-saved node moves to the top rather than piling up.
    const rest = this.entries().filter((e) => e.nodeId !== full.nodeId);
    const next = [full, ...rest].slice(0, APP_CONFIG.maxHistory);
    this.entries.set(next);
    await this.persist();
  }

  async clear(): Promise<void> {
    this.entries.set([]);
    await this.persist();
  }

  private async persist(): Promise<void> {
    if (this.ext.available) {
      await this.ext.storageSet(APP_CONFIG.storageKeys.history, this.entries());
    }
  }

  private makeId(): string {
    // Date.now + counter-ish random; sufficient for a local list key.
    return 'h_' + Date.now().toString(36) + '_' + Math.floor(Math.random() * 1e6).toString(36);
  }
}
