import { Injectable, Signal, computed, inject, signal } from '@angular/core';

import { AdditionalWebComponentService } from './additional-web-component.service';
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
  /**
   * How the button carries. Defaults to `primary` — the offered next step, which is what a footer
   * action normally is. `secondary` is for the way *out* of a step (abandoning it), so it does not
   * compete with going on.
   */
  kind?: 'primary' | 'secondary';
}

/**
 * Drives the footer action bar: turns the open section (and, where it matters, its selected sub
 * step) into its next steps, and bridges the footer to a screen it does not own (the metadata
 * editor's commit()) via a small handler slot.
 */
@Injectable({ providedIn: 'root' })
export class ActionBarService {
  private readonly curation = inject(CurationService);
  private readonly navigation = inject(NavigationService);
  private readonly additionalWebComponent = inject(AdditionalWebComponentService);

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
    switch (this.navigation.section()) {
      // "Inhalt erschließen": run the metadata agent on the page and hand its result to the preview
      // step. The screen starts that itself on entry, so what is left for the footer is the repeat —
      // after a failure, or for a page that has changed since.
      case 'curation':
        return [
          {
            label: this.curation.running()
              ? 'Erschließe… (kann etwas dauern)'
              : 'Erschließung wiederholen',
            disabled: this.curation.running(),
            run: async () => {
              if (await this.curation.analyze()) this.navigation.go('curation-preview');
            }
          }
        ];

      // The preview step of the Erschließung: nothing is written here, so what it offers is the two
      // ways on — dropping the run altogether, or taking it into the Qualitätssicherung, which is
      // where the save lives. The adjusted picture and title travel with it (applyDraftValues).
      case 'curation-preview':
        return [
          {
            label: 'Abbrechen',
            kind: 'secondary',
            disabled: false,
            run: () => {
              this.curation.startNew();
              this.navigation.openMenu();
            }
          },
          {
            label: 'Zur Qualitätssicherung',
            disabled: false,
            run: async () => {
              // Awaited: the handover reads a picked picture out of the widget, and the next step's
              // editor is built from the node that picture goes on.
              await this.curation.applyDraftValues();
              this.navigation.go('quality');
            }
          }
        ];

      // "Bearbeitungsmodus": the content is being edited in the connector; this hands over to the
      // Qualitätssicherung when the user is done adjusting it.
      case 'editing':
        return [
          {
            label: 'Anpassungen speichern',
            disabled: false,
            run: () => this.navigation.go('quality')
          }
        ];

      // "Qualitätssicherung": saving belongs to the metadata sub step (the editor owns the values);
      // moving on to the last big step is offered from either sub step.
      case 'quality': {
        const onward: FooterAction = {
          label: 'Zur Inhaltsübersicht',
          disabled: !this.curation.activeNode(),
          run: () => this.navigation.go('overview')
        };
        if (this.navigation.screen() !== 'metadata') return [onward];
        const handler = this.saveHandler();
        return [
          {
            // Normally one label throughout: every save writes the same node, so a second wording
            // would announce a difference there is none.
            //
            // With the additional web component there IS one. Saving goes through the agent's
            // `/upload`, which only ever CREATES — there is no endpoint that writes back to a node
            // it made, and the panel session (a guest) may not edit it either (see
            // WIDGET-REFERENZ.md, "Bestandsinhalte via Node-ID"). So saving again produces ANOTHER
            // node and continues with it; "Erneut speichern" says that before it happens.
            label: this.curation.saving()
              ? 'Speichern…'
              : this.additionalWebComponent.enabled() && this.curation.metadataSaved()
                ? 'Erneut speichern'
                : 'Speichern',
            disabled: !handler?.canSave() || this.curation.metadataLocked(),
            run: () => handler?.save()
          },
          onward
        ];
      }

      // Every other section owns its own primary action (selector insert, login form, the
      // "Inhaltsoptionen" choice, …).
      default:
        return [];
    }
  });
}
