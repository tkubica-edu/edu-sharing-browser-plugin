import { Injectable, effect, inject, signal } from '@angular/core';

import { APP_CONFIG } from '../config';
import { ScreenId, SectionId } from '../model/navigation';
import { BrowserExtensionService } from './browser-extension.service';
import { ConditionsService } from './conditions.service';
import { CurationService, NodeSource } from './curation.service';
import { NavState, NavStep, NavigationService } from './navigation.service';

/** What is carried across a page change. Ids only — everything else is re-derived on the new page. */
interface ResumeState {
  section: SectionId;
  tab: ScreenId | null;
  /** The steps behind the open one, so the back button still walks them on the new page. */
  trail: NavStep[];
  nodeId: string | null;
  nodeSource: NodeSource | null;
  /** The page the state belongs to — the current one, or the one it is being carried to. */
  url: string | null;
  at: number;
}

/**
 * How long a saved state stays valid. Long enough for a slow page load, short enough that a state
 * left behind by a load that never happened does not resurface much later.
 */
const RESUME_WINDOW_MS = 60000;

/**
 * Carries the panel's state across a page change: the panel is an iframe inside the page, so any navigation destroys
 * it and the app boots from scratch. Written continuously rather than at the moment of a navigation, since a link
 * the user clicks gives no warning. Only the node's id and where the user was are stored, and per tab.
 */
@Injectable({ providedIn: 'root' })
export class SessionResumeService {
  private readonly browserExtension = inject(BrowserExtensionService);
  private readonly navigation = inject(NavigationService);
  private readonly curation = inject(CurationService);
  private readonly conditions = inject(ConditionsService);

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
   * Write the state right now and wait for it — for the app's own navigations, where the scheduled effect above would
   * not have run before the load tears the app down. `targetUrl` is stored as the state's page and `state` as where
   * the panel should come back. The app's last write: tracking is switched off first, so nothing overwrites it.
   */
  async save(targetUrl?: string, state?: NavState): Promise<void> {
    this.tracking.set(false);
    await this.write({
      ...this.snapshot(),
      url: targetUrl ?? this.conditions.activeUrl(),
      ...(state ? { section: state.section, tab: state.tab, trail: [...state.trail] } : {})
    });
  }

  /** Where the user is. Reads every signal the state is made of, so the effect tracks them all. */
  private snapshot(): ResumeState {
    return {
      section: this.navigation.section(),
      tab: this.navigation.screen(),
      trail: [...this.navigation.trailOf()],
      nodeId: this.curation.activeNode()?.nodeId ?? null,
      nodeSource: this.curation.nodeSourceOf() ?? null,
      url: this.conditions.activeUrl(),
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
    if (state.nodeId && this.nodeStillApplies(state)) {
      await this.curation.resumeNode(state.nodeId, state.nodeSource ?? 'detected');
    }
    // The whole way the user came, not just where they stood: a step that does not apply on this
    // page (an OnlyOffice-only one, or one that needs a node that could not be loaded) hands over to
    // the one behind it, and only a state of which nothing applies is no restore at all — then the
    // caller lands. A stored state that carries no trail restores its step alone.
    return this.navigation.resume(
      { section: state.section, tab: state.tab ?? null },
      state.trail ?? [],
    );
  }

  /**
   * Whether the stored node is still the panel's content on this page. A `detected` node is a statement about the page
   * it was found on and does not survive a page change, except one the app made itself. A `chosen` node belongs to the
   * user's flow and stays. An unknown page is taken at face value rather than as a reason to drop the node.
   */
  private nodeStillApplies(state: ResumeState): boolean {
    const current = this.conditions.activeUrl();
    if (state.nodeSource !== 'detected' || !state.url || !current) return true;
    return state.url === current;
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
