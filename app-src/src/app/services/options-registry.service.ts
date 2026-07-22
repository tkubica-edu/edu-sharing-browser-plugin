import { Injectable, computed, signal } from '@angular/core';

import { AppOption, Conditions, OptionId, OPTIONS, requiresLogin } from '../model/options';

// The runtime registry behind the "Aktionen & Optionen" menu. It merges the built-in
// OPTIONS seed with options contributed at runtime by externally loaded code (see
// AdditionalWebComponentService). Contributions with a built-in id REPLACE that option;
// a fresh id ADDS a new one. Order: built-ins first (in their declared order), then new
// contributed ids appended in contribution order. Signal-based so the zoneless UI reacts.
@Injectable({ providedIn: 'root' })
export class OptionsRegistryService {
  // Contributed options, in contribution order. A later contribution with the same id
  // wins (re-registration replaces).
  private readonly contributed = signal<AppOption[]>([]);

  /** The merged, ordered list of options driving the menu, navigation and landing. */
  readonly options = computed<AppOption[]>(() => {
    const merged = new Map<OptionId, AppOption>();
    // Seed built-ins (preserves declaration order).
    for (const o of OPTIONS) merged.set(o.id, o);
    // Apply contributions: same id replaces in place; new id appended at the end.
    for (const raw of this.contributed()) {
      merged.set(raw.id, this.normalize(raw));
    }
    return [...merged.values()];
  });

  /** Register (add or replace by id) one or more contributed options. */
  register(options: AppOption[]): void {
    if (!options.length) return;
    this.contributed.update((prev) => {
      const byId = new Map(prev.map((o) => [o.id, o]));
      for (const o of options) byId.set(o.id, o);
      return [...byId.values()];
    });
  }

  /** Look up a merged option by id (built-in or contributed). */
  get(id: OptionId): AppOption | undefined {
    return this.options().find((o) => o.id === id);
  }

  has(id: OptionId): boolean {
    return this.get(id) !== undefined;
  }

  // A contributed option that does NOT opt out of the login requirement is treated like a
  // built-in login-gated option: if it supplied no explicit predicate we default to
  // requiresLogin(); if it supplied one we AND it with loggedIn. A bypassLogin option is
  // used verbatim so it can be visible for guests.
  private normalize(o: AppOption): AppOption {
    const external = { ...o, external: true };
    if (o.bypassLogin) return external;
    const own: (c: Conditions) => boolean = o.visible ?? (() => true);
    return { ...external, visible: requiresLogin(own) };
  }
}
