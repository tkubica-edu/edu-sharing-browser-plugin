import { Injectable, computed, inject } from '@angular/core';

import { CurationService } from './curation.service';

/** Shown wherever the panel refuses a control because a write is in flight. */
const BUSY_HINT = 'Der Inhalt wird gespeichert — bitte warten.';

/**
 * Whether the panel is in the middle of a write that must not be steered away from — the one state the
 * whole chrome is disabled by (topbar, back button, tab bar, session bar, footer).
 *
 * There is more to a save than the one request the button waits for: the node is created, then the
 * confirmed quality, the picture and the forwarding are written onto it (see
 * {@link CurationService.save}). Leaving mid-way is what leaves a content half-written — a logout takes
 * the session those follow-ups run under, a page change tears the panel down, and re-entering a step
 * would offer to write again what is already being written.
 *
 * Deliberately DERIVED rather than a state of its own: the services that write already say when they
 * are writing, and a second flag beside them is a flag that can be left standing. For the same reason
 * it is not a condition of the navigation registry — a section that turns "disabled" is one the
 * guard re-lands away from (see NavigationService), and being thrown to the main menu is exactly what
 * this is here to prevent.
 */
@Injectable({ providedIn: 'root' })
export class BusyService {
  private readonly curation = inject(CurationService);

  /** A write is in flight — the metadata save, or an assignment on its own. */
  readonly busy = computed(() => this.curation.saving() || this.curation.assigning());

  /** Why a control is refused, as its tooltip; `null` while nothing is refused. */
  readonly hint = computed<string | null>(() => (this.busy() ? BUSY_HINT : null));
}
