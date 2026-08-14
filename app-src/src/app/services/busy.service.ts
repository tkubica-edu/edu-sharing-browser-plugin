import { Injectable, computed, inject } from '@angular/core';

import { CurationService } from './curation.service';

/** Shown wherever the panel refuses a control because a write is in flight. */
const BUSY_HINT = 'Der Inhalt wird gespeichert — bitte warten.';

/**
 * Whether a write is in flight that must not be steered away from — the one state the whole chrome is disabled by,
 * since a save is more than the request the button waits for and leaving mid-way leaves a content half-written.
 * Derived rather than a state of its own, and deliberately not a navigation condition, which would re-land the user.
 */
@Injectable({ providedIn: 'root' })
export class BusyService {
  private readonly curation = inject(CurationService);

  /** A write is in flight — the metadata save, or an assignment on its own. */
  readonly busy = computed(() => this.curation.saving() || this.curation.assigning());

  /** Why a control is refused, as its tooltip; `null` while nothing is refused. */
  readonly hint = computed<string | null>(() => (this.busy() ? BUSY_HINT : null));
}
