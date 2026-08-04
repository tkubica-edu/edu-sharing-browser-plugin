import { Injectable, effect, inject, signal } from '@angular/core';

import { APP_CONFIG } from '../config';
import { ScreenId, SectionId } from '../model/navigation';
import { BrowserExtensionService } from './browser-extension.service';
import { CurationService, NodeSource } from './curation.service';
import { NavigationService } from './navigation.service';

/** What is carried across a page change. Ids only — everything else is re-derived on the new page. */
interface ResumeState {
  section: SectionId;
  tab: ScreenId | null;
  nodeId: string | null;
  nodeSource: NodeSource | null;
  at: number;
}

/**
 * How long a saved state stays valid. Long enough for a slow page load, short enough that a state
 * left behind by a load that never happened does not resurface much later.
 */
const RESUME_WINDOW_MS = 60000;

/**
 * Carries the panel's state across a page change.
 *
 * The panel is an iframe inside the page, so ANY navigation destroys it and the app is booted from
 * scratch afterwards (the background worker reopens the panel — see background.js). Its state
 * therefore has to live outside the app, in extension storage, and be picked up again on boot.
 *
 * Written continuously, not at the moment of a navigation: a link the user clicks gives no warning,
 * so there is no point at which the app could still save. {@link track} starts that, after the
 * restore has had its turn.
 *
 * Only the node's id and where the user was are stored, so nothing here can go stale — the node
 * itself is re-loaded. The state is **per tab**: two tabs are two independent panels, and one must
 * never restore into the other.
 */
@Injectable({ providedIn: 'root' })
export class SessionResumeService {
  private readonly browserExtension = inject(BrowserExtensionService);
  private readonly navigation = inject(NavigationService);
  private readonly curation = inject(CurationService);

  /** Off until {@link track} is called, so nothing is written before the restore has run. */
  private readonly tracking = signal(false);

  /** Resolved once and reused; the key depends on it. */
  private storageKey: string | null = null;

  constructor() {
    // Persist on every change of what makes up the state. Reads `tracking` FIRST: while it is off
    // nothing else is read, so nothing is tracked and no write can happen — turning it on re-runs
    // this and subscribes from there.
    effect(() => {
      if (!this.tracking()) return;
      void this.write(this.snapshot());
    });
  }

  /** Start persisting the state. Call after {@link restore}, so the restored state is not overwritten. */
  track(): void {
    this.tracking.set(true);
  }

  /**
   * Write the state right now and wait for it.
   *
   * For the app's own navigations (see ContentFlowService): the effect above is *scheduled*, so it
   * would not have run before the page load tears this app down. Everything else is covered by it.
   */
  async save(): Promise<void> {
    await this.write(this.snapshot());
  }

  /** Where the user is. Reads every signal the state is made of, so the effect tracks them all. */
  private snapshot(): ResumeState {
    return {
      section: this.navigation.section(),
      tab: this.navigation.screen(),
      nodeId: this.curation.activeNode()?.nodeId ?? null,
      nodeSource: this.curation.nodeSourceOf() ?? null,
      at: Date.now()
    };
  }

  /**
   * Restore the state this tab's panel had before the page changed, and report whether one applied —
   * the caller then skips its own landing logic.
   */
  async restore(): Promise<boolean> {
    const key = await this.key();
    const state = await this.browserExtension
      .storageGet<ResumeState | null>(key, null)
      .catch(() => null);
    if (!state?.section || Date.now() - (state.at ?? 0) > RESUME_WINDOW_MS) return false;

    // The node first: the section the user was in is often only reachable *because* of it.
    if (state.nodeId) {
      await this.curation.resumeNode(state.nodeId, state.nodeSource ?? 'detected');
    }
    this.navigation.go(state.section, { tab: state.tab ?? undefined });
    // `go` refuses a section that does not apply on this page (an OnlyOffice-only one, or one that
    // needs a node that could not be loaded) — then nothing was restored and the caller should land.
    return this.navigation.section() === state.section;
  }

  /** Forget the state, so the next opening of the panel starts at the main menu. */
  async clear(): Promise<void> {
    this.tracking.set(false);
    await this.browserExtension.storageSet(await this.key(), null);
  }

  private async write(state: ResumeState): Promise<void> {
    await this.browserExtension.storageSet(await this.key(), state).catch(() => {
      /* a state that cannot be stored only means the panel comes back at the main menu */
    });
  }

  /**
   * The storage key for THIS tab. Without a tab id — the sidebar opened as its own tab, or a plain
   * dev server — one shared key is used: there is only one panel then.
   */
  private async key(): Promise<string> {
    if (this.storageKey) return this.storageKey;
    const tabId = await this.browserExtension.getOwnTabId().catch(() => null);
    this.storageKey =
      tabId === null
        ? APP_CONFIG.storageKeys.resumeState
        : `${APP_CONFIG.storageKeys.resumeState}:${tabId}`;
    return this.storageKey;
  }
}
