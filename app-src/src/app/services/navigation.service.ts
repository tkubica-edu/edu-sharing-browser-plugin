import { Injectable, computed, effect, inject, signal } from '@angular/core';

import { AppOption, OPTIONS, OptionId } from '../model/options';
import { ConditionsService } from './conditions.service';

/** The menu itself, or one of the options. */
export type View = 'menu' | OptionId;

// The single source of navigation truth: which view is shown, guarded transitions, the
// current title, and the landing logic that picks the right view for the current context.
// The back button always returns to the options menu (no step-history stack).
@Injectable({ providedIn: 'root' })
export class NavigationService {
  private readonly conditions = inject(ConditionsService);

  readonly view = signal<View>('menu');

  /** Back button is shown on every view except the menu; it always returns to the menu. */
  readonly showBack = computed(() => this.view() !== 'menu');

  /** The options visible for the current conditions (drives the menu). */
  readonly visibleOptions = computed(() =>
    OPTIONS.filter((option) => option.visible(this.conditions.snapshot())),
  );

  /** Title shown in the topbar for the current view. */
  readonly title = computed(() => {
    const view = this.view();
    return view === 'menu' ? 'Aktionen & Optionen' : this.optionOf(view)?.label ?? '';
  });

  constructor() {
    // Guard: if the current option becomes invisible (logout, node cleared, page change),
    // don't strand the user on a dead screen — re-land on a valid view.
    effect(() => {
      const view = this.view();
      if (view === 'menu') return;
      if (!this.optionOf(view)?.visible(this.conditions.snapshot())) this.land();
    });
  }

  /** Navigate to an option, if currently visible. */
  go(id: OptionId): void {
    if (!this.optionOf(id)?.visible(this.conditions.snapshot())) return;
    this.view.set(id);
  }

  openMenu(): void {
    this.view.set('menu');
  }

  /**
   * Pick the view that fits the current context. `nodeJustLoaded` marks an explicit node load
   * (an OnlyOffice preview or a history entry), which wins over the OnlyOffice default.
   */
  land(options?: { nodeJustLoaded?: boolean }): void {
    const conditions = this.conditions.snapshot();
    if (!conditions.loggedIn) return this.view.set('login');
    if (options?.nodeJustLoaded && conditions.hasActiveNode) return this.view.set('preview');
    if (conditions.onlyOfficePresent) return this.view.set('search');
    this.view.set('menu');
  }

  private optionOf(id: OptionId): AppOption | undefined {
    return OPTIONS.find((option) => option.id === id);
  }
}
