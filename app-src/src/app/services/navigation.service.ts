import { Injectable, computed, effect, inject, signal } from '@angular/core';

import { UiStateService } from './ui-state.service';
import { AppOption, OptionId, OPTIONS, optionById } from '../model/options';

export type View = 'menu' | OptionId;

// The single source of navigation truth: which view is shown, guarded transitions, the
// current title, and the landing logic that picks the right view for the current context.
// The back button always returns to the options menu (no step-history stack).
@Injectable({ providedIn: 'root' })
export class NavigationService {
  private readonly ui = inject(UiStateService);

  readonly view = signal<View>('menu');

  /** Back button is shown on every view except the menu; it always returns to the menu. */
  readonly showBack = computed(() => this.view() !== 'menu');

  /** Title shown in the topbar for the current view. */
  readonly title = computed(() => {
    const v = this.view();
    return v === 'menu' ? 'Aktionen & Optionen' : optionById(v).label;
  });

  /** The visible options for the current conditions (drives the menu). */
  readonly visibleOptions = computed<AppOption[]>(() => {
    const c = this.ui.conditions();
    return OPTIONS.filter((o) => o.visible(c));
  });

  constructor() {
    // Guard: if the current option becomes invisible (logout, node cleared, page change),
    // don't strand the user on a dead screen — re-land on a valid view.
    effect(() => {
      const v = this.view();
      if (v === 'menu') return;
      if (!optionById(v).visible(this.ui.conditions())) {
        this.land();
      }
    });
  }

  /** Navigate to an option, if currently visible. */
  go(id: OptionId): void {
    if (!optionById(id).visible(this.ui.conditions())) return;
    this.view.set(id);
  }

  openMenu(): void {
    this.view.set('menu');
  }

  // Pick the view that fits the current context. `nodeJustLoaded` marks an explicit node
  // load (PREVIEW_NODE / Verlauf) which should win over the OnlyOffice default.
  land(opts?: { nodeJustLoaded?: boolean }): void {
    const c = this.ui.conditions();
    if (!c.loggedIn) { this.view.set('login'); return; }
    if (opts?.nodeJustLoaded && c.hasActiveNode) { this.view.set('vorschau'); return; }
    if (c.onlyOfficePresent) { this.view.set('suchen'); return; }
    this.view.set('menu');
  }
}
