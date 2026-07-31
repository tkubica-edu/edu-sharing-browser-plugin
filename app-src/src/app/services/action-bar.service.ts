import { Injectable, Signal, computed, inject, signal } from '@angular/core';

import { CurationService } from './curation.service';
import { NavigationService } from './navigation.service';

/**
 * What the metadata screen hands to the footer: how to save, and whether saving is possible
 * right now. `canSave` is a signal, so the footer derives its state instead of being pushed to.
 */
export interface SaveHandler {
  save: () => void;
  canSave: Signal<boolean>;
}

/**
 * An action offered in the footer for the current view. Each view can offer 0..n of these —
 * the flow is a set of offered next steps, not a forced linear chain.
 */
export interface FooterAction {
  label: string;
  disabled: boolean;
  run: () => void | Promise<void>;
}

/**
 * Drives the footer action bar: turns the current view into its next steps, and bridges the
 * footer to a screen it does not own (the metadata editor's commit()) via a small handler slot.
 */
@Injectable({ providedIn: 'root' })
export class ActionBarService {
  private readonly curation = inject(CurationService);
  private readonly navigation = inject(NavigationService);

  // The metadata screen registers its save handler (→ mdsEditor.commit()) while mounted, so the
  // footer can drive a save without referencing the editor.
  private readonly saveHandler = signal<SaveHandler | null>(null);

  registerSaveHandler(handler: SaveHandler): void {
    this.saveHandler.set(handler);
  }

  clearSaveHandler(handler: SaveHandler): void {
    this.saveHandler.update((current) => (current === handler ? null : current));
  }

  readonly actions = computed<FooterAction[]>(() => {
    switch (this.navigation.view()) {
      case 'analyze':
        return [
          {
            label: this.curation.running() ? 'Erschließe… (kann etwas dauern)' : 'Erschließung starten',
            disabled: this.curation.running(),
            run: async () => {
              if (await this.curation.analyze()) this.navigation.go('metadata');
            }
          }
        ];

      case 'metadata': {
        const handler = this.saveHandler();
        return [
          {
            label: this.curation.saving() ? 'Speichern…' : 'Speichern',
            disabled: !handler?.canSave() || this.curation.saving(),
            run: () => handler?.save()
          }
        ];
      }

      case 'preview':
        // With a node open, offer the logical next steps as a choice.
        return [
          {
            label: 'Metadaten editieren',
            disabled: false,
            run: () => this.navigation.go('metadata')
          },
          {
            label: 'Sammlung zuordnen',
            disabled: false,
            run: () => this.navigation.go('collections')
          }
        ];

      // Every other view owns its own primary action (selector insert, login form, …).
      default:
        return [];
    }
  });
}
