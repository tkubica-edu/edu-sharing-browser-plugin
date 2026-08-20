import { Injectable, computed, inject, signal, untracked } from '@angular/core';

import { APP_CONFIG } from '../config';
import { AuthService } from './auth.service';
import { BrowserExtensionService } from './browser-extension.service';
import { ParsedMetadata } from './metadata-agent.service';
import type { SectionId } from '../model/navigation';
import type { NavStep } from './navigation.service';

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
  /** What the node holds, so a past entry can be re-displayed and stand in for it. */
  parsed: ParsedMetadata;
  /**
   * The metadata-agent result this content was erschlossen with, kept beside what was written: it is
   * what the flow's steps work from — the proposals for the fields the node leaves empty, the marks
   * saying which are the agent's, the text it was all read from — and keeping it is what spares the
   * content a second run of the agent when it is taken up again. Absent for an entry written before
   * it was kept, and for a content that never went through the agent.
   */
  run?: ParsedMetadata | null;
  /**
   * The step this content was last left on — kept in step with the panel for as long as the content is the
   * one it works on ({@link noteStep}), not the step the write happened to be made from. What an entry
   * *opened from the Verlauf* leads to is the junction all the same — the choice of what to do with the
   * content is the person's; this is what the main menu's card offers for an Erschließung left unfinished
   * (CurationService.leftAtStep). Only ever *offered*: a step that no longer applies is passed over — see
   * NavigationService.resumableStep.
   */
  step?: NavStep | null;
  /**
   * How far the Qualitätsprüfung had got with this content. Kept because it is what the steps behind
   * it are unlocked by — the Metadaten view opens once the criteria are answered — and the panel holds
   * it as state of the flow rather than reading it back off the node.
   */
  quality?: { criteriaMet: boolean; confirmed: boolean } | null;
  /**
   * Whether the Erschließung was carried to its end — the handover to the editorial queue, which is the
   * last thing the flow does. Absent for an entry written before this was kept, which is not the same
   * statement as `false`: nothing is known about those, see CurationService.curationUnfinished.
   */
  finished?: boolean;
}

/** What a caller supplies; id, timestamp, repository and the open step are assigned here. */
export type NewHistoryEntry = Omit<HistoryEntry, 'id' | 'timestamp' | 'repositoryUrl' | 'step'>;

const LOG = '[edu-sharing][history]';

/** Whether two steps are the same one; a missing step is the same as no step. */
function sameStep(a: NavStep | null | undefined, b: NavStep | null | undefined): boolean {
  return (a?.section ?? null) === (b?.section ?? null) && (a?.tab ?? null) === (b?.tab ?? null);
}

/**
 * The steps an entry is never said to have been left on: the main menu is where the offer to continue is
 * made, so a content taken up there has to keep the step it is offered for, and the login is no step of a
 * content's own at all.
 */
const UNREMEMBERED_STEPS: readonly SectionId[] = ['menu', 'login'];

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

  /**
   * The step the panel is on, kept here so an entry can say where its content was left — reported by
   * whoever owns the navigation (see NavigationService), since the history is written from the flow
   * and not from the screen the user stands on.
   */
  private readonly openStep = signal<NavStep | null>(null);

  /**
   * Take over which step is open, for the content the panel is working on. Beside {@link openStep} for the
   * next entry, it is written onto the entry that content already has: what such an entry says is where its
   * content was *left*, and the flow moves on long after the save that wrote it (see
   * {@link HistoryEntry.step}). Steps of {@link UNREMEMBERED_STEPS} and a content the history does not hold
   * leave every entry as it is.
   */
  noteStep(step: NavStep | null, nodeId: string | null): void {
    this.openStep.set(step);
    if (!nodeId || !step || UNREMEMBERED_STEPS.includes(step.section)) return;
    void this.rememberStep(nodeId, step);
  }

  /** Write the step onto the node's entry, where it holds one and it says something else. */
  private async rememberStep(nodeId: string, step: NavStep): Promise<void> {
    // Untracked: this runs inside the effect that reports the step, which has no business
    // re-running because the list it writes to changed.
    const entry = untracked(this.entries).find((candidate) => candidate.nodeId === nodeId);
    if (!entry || sameStep(entry.step, step)) return;
    this.allEntries.update((entries) =>
      entries.map((candidate) => (candidate === entry ? { ...candidate, step } : candidate)),
    );
    console.log(`${LOG} ➡ ${nodeId} was left on ${step.section}/${step.tab ?? '—'}`);
    await this.persist();
  }

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
    console.log(
      `${LOG} ⬅ read from storage: ${repaired.length} entries, ${this.entries().length} of them this repository's`,
      { dropped: list.length - valid.length, repository: this.auth.repositoryUrl() },
    );
    if (valid.length !== list.length || repaired.some((entry, index) => entry !== valid[index])) {
      await this.persist();
    }
  }

  async add(entry: NewHistoryEntry): Promise<void> {
    const repositoryUrl = this.auth.repositoryUrl();
    const added: HistoryEntry = {
      ...entry,
      repositoryUrl,
      step: this.openStep(),
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
    // Whether this node was in the history already, read before the list is replaced below.
    const known = this.entries().some((existing) => existing.nodeId === added.nodeId);
    // The cap counts per repository, so one repository's history cannot crowd out another's.
    this.allEntries.set([...[added, ...own].slice(0, APP_CONFIG.maxHistory), ...foreign]);
    console.log(`${LOG} ➡ writing entry for ${added.nodeId}`, {
      url: added.url,
      title: added.title,
      // What the entry carries beyond the node's own fields, since that is what a reopening stands on.
      step: added.step,
      quality: added.quality,
      run: added.run ? `${added.run.fields.length} fields` : 'none',
      storedFields: added.parsed?.fields?.length ?? 0,
      replacesPrevious: known
    });
    await this.persist();
  }

  /** Drop the configured repository's entries; the other repositories' histories are untouched. */
  async clear(): Promise<void> {
    const current = this.auth.repositoryUrl();
    const dropped = this.entries().length;
    this.allEntries.update((entries) =>
      entries.filter((entry) => !sameRepository(entry.repositoryUrl, current)),
    );
    console.log(`${LOG} ✖ cleared ${dropped} entries of ${current}`);
    await this.persist();
  }

  private persist(): Promise<void> {
    const entries = this.allEntries();
    console.log(`${LOG} ➡ storing ${entries.length} entries under ${APP_CONFIG.storageKeys.history}`);
    return this.browserExtension.storageSet(APP_CONFIG.storageKeys.history, entries);
  }
}
