import { Injectable, computed, effect, inject, signal } from '@angular/core';

import { UiStateService } from './ui-state.service';
import { OptionsRegistryService } from './options-registry.service';
import { AppOption, BUILTIN_OPTION_IDS, OptionId } from '../model/options';

export type View = 'menu' | OptionId;

// The single source of navigation truth: which view is shown, guarded transitions, the
// current title, and the landing logic that picks the right view for the current context.
// The back button always returns to the options menu (no step-history stack).
@Injectable({ providedIn: 'root' })
export class NavigationService {
  private readonly ui = inject(UiStateService);
  private readonly registry = inject(OptionsRegistryService);

  readonly view = signal<View>('menu');

  // Set by externally loaded code (via AdditionalWebComponentService) when it takes over
  // the backend/guest flow. While true, the app no longer forces the login gate and
  // guest-visible options are reachable without a repository session.
  readonly loginRequirementDisabled = signal(false);

  /** Back button is shown on every view except the menu; it always returns to the menu. */
  readonly showBack = computed(() => this.view() !== 'menu');

  /** Title shown in the topbar for the current view. */
  readonly title = computed(() => {
    const v = this.view();
    return v === 'menu' ? 'Aktionen & Optionen' : (this.registry.get(v)?.label ?? 'Aktionen & Optionen');
  });

  /** The visible options for the current conditions (drives the menu). */
  readonly visibleOptions = computed<AppOption[]>(() => {
    const c = this.ui.conditions();
    return this.registry.options().filter((o) => o.visible(c));
  });

  constructor() {
    // Guard: if the current option becomes invisible (logout, node cleared, page change,
    // or a contributed option removed), don't strand the user on a dead screen — re-land
    // on a valid view.
    effect(() => {
      const v = this.view();
      if (v === 'menu') return;
      const opt = this.registry.get(v);
      if (!opt || !opt.visible(this.ui.conditions())) {
        this.land();
      }
    });
  }

  /** Navigate to an option, if currently visible. */
  go(id: OptionId): void {
    const opt = this.registry.get(id);
    if (!opt || !opt.visible(this.ui.conditions())) return;
    this.view.set(id);
  }

  openMenu(): void {
    this.view.set('menu');
  }

  // Pick the view that fits the current context. `nodeJustLoaded` marks an explicit node
  // load (PREVIEW_NODE / Verlauf) which should win over the OnlyOffice default. Always
  // resolves to a view that is actually visible under current conditions (falling back to
  // the menu), so the invisibility guard above cannot ping-pong.
  land(opts?: { nodeJustLoaded?: boolean }): void {
    const c = this.ui.conditions();
    // The login gate is only forced when login is still required in this deployment.
    if (!c.loggedIn && !this.loginRequirementDisabled()) { this.view.set('login'); return; }

    let target: View = 'menu';
    if (opts?.nodeJustLoaded && c.hasActiveNode) target = BUILTIN_OPTION_IDS.vorschau;
    else if (c.onlyOfficePresent) target = BUILTIN_OPTION_IDS.suchen;

    if (target !== 'menu' && !this.registry.get(target)?.visible(c)) target = 'menu';
    this.view.set(target);
  }
}
