import { Injectable, computed, inject, signal } from '@angular/core';

import { CurationService } from './curation.service';
import { NavigationService } from './navigation.service';

// A logical next action offered in the footer for the current screen. `kind` drives the
// button emphasis: 'primary' for the main action of a step (Erschließen, Speichern),
// 'option' for a choice among logical next steps (e.g. Metadaten editieren / Sammlung
// zuordnen from the Vorschau). Each screen can offer 0..n of these — the flow is a set of
// offered options, not a forced linear chain.
export interface NextAction {
  label: string;
  kind: 'primary' | 'option';
  disabled: boolean;
  run: () => void | Promise<void>;
}

// The reusable flow glue: turns (current view + conditions) into the footer's next step,
// and bridges the shell footer to a screen it does not own (the metadata editor's
// commit()), via a small handler registry.
@Injectable({ providedIn: 'root' })
export class FlowService {
  private readonly curation = inject(CurationService);
  private readonly nav = inject(NavigationService);

  // --- editor-commit bridge -------------------------------------------------
  // The metadata screen registers its primary handler (→ mdsEditor.commit()) on mount and
  // keeps `canPrimary` synced to the editor's ready() state. The footer invokes the handler
  // without referencing the editor directly.
  private primaryHandler: (() => void) | null = null;
  readonly canPrimary = signal(false);

  registerPrimary(fn: () => void): void { this.primaryHandler = fn; }
  clearPrimary(fn: () => void): void {
    if (this.primaryHandler === fn) this.primaryHandler = null;
    this.canPrimary.set(false);
  }

  readonly nextActions = computed<NextAction[]>(() => {
    switch (this.nav.view()) {
      case 'analyze':
        return [{
          label: this.curation.running() ? 'Erschließe… (kann etwas dauern)' : 'Erschließung starten',
          kind: 'primary',
          disabled: this.curation.running(),
          run: async () => {
            const ok = await this.curation.run();
            if (ok) this.nav.go('metadata');
          }
        }];

      case 'metadata':
        return [{
          label: this.curation.saving() ? 'Speichern…' : 'Speichern',
          kind: 'primary',
          disabled: !this.canPrimary() || this.curation.saving(),
          run: () => this.primaryHandler?.()
        }];

      case 'preview':
        // With a node open, offer the logical next actions as a choice (not a forced chain).
        return [
          { label: 'Metadaten editieren', kind: 'primary', disabled: false, run: () => this.nav.go('metadata') },
          { label: 'Sammlung zuordnen', kind: 'primary', disabled: false, run: () => this.nav.go('collections') }
        ];

      // These screens own their own primary action (selector insert, login form, etc.).
      case 'collections':
      case 'search':
      case 'history':
      case 'settings':
      case 'login':
      case 'menu':
      default:
        return [];
    }
  });
}
