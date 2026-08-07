import { Injectable, Signal, computed, inject, signal } from '@angular/core';

import { AdditionalWebComponentService } from './additional-web-component.service';
import { CurationService } from './curation.service';
import { NavigationService } from './navigation.service';

/**
 * What the metadata screen hands to the footer: how to save, and whether saving is possible
 * right now. `canSave` is a signal, so the footer derives its state instead of being pushed to.
 *
 * `save` answers whether the write succeeded, because the footer's action continues on the back of
 * it — a step that is entered after a failed save would leave the content behind unwritten.
 */
export interface SaveHandler {
  save: () => Promise<boolean>;
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
      // ways on — dropping the run altogether, or taking it into the Qualitätsprüfung, which is
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
            label: 'Qualitätsprüfung',
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
      // Qualitätsprüfung when the user is done adjusting it.
      case 'editing':
        return [
          {
            label: 'Anpassungen speichern',
            disabled: false,
            run: () => this.navigation.go('quality')
          }
        ];

      // "Qualitätsprüfung": its two views are walked through rather than jumped between, so the
      // footer carries that walk — "Weiter" out of the Qualität view, "Zurück" out of the Metadaten
      // one. The tab bar is still on screen; this is the way through the step, not the only one.
      //
      // The way out of the section belongs to the Metadaten view — from the Qualität view there is
      // nothing yet to leave.
      case 'quality': {
        if (this.navigation.screen() !== 'metadata') {
          const next = this.navigation.nextTab();
          return [
            {
              label: 'Weiter',
              disabled: !next || next.disabled,
              run: () => this.navigation.goNextTab()
            }
          ];
        }
        const handler = this.saveHandler();
        // Saving through the additional web component goes through the agent's `/upload`, which
        // only ever CREATES — there is no endpoint that writes back to a node it made, and the
        // panel session (a guest) may not edit it either (see WIDGET-REFERENZ.md, "Bestandsinhalte
        // via Node-ID"). So once it has written one, writing again would produce a SECOND node for
        // the same content; the way on then only goes on.
        const written = this.additionalWebComponent.enabled() && this.curation.metadataSaved();
        const saves = !!handler?.canSave() && !this.curation.metadataLocked() && !written;
        return [
          {
            label: 'Zurück',
            kind: 'secondary',
            disabled: false,
            run: () => this.navigation.goTab('quality-check')
          },
          {
            // The Metadaten view has no Speichern of its own for the moment, so the way on carries
            // the write: the content is saved and the next step entered once that succeeded — and
            // not at all when it failed, which would leave the content behind unwritten. A content
            // with nothing to commit simply goes on.
            label: this.curation.saving() ? 'Speichern…' : 'Inhaltsübersicht',
            disabled: this.curation.saving() || (!saves && !this.curation.activeNode()),
            run: async () => {
              if (saves && !(await handler!.save())) return;
              this.navigation.go('overview');
            }
          }
        ];
      }

      // Every other section owns its own primary action (selector insert, login form, the
      // "Inhaltsoptionen" choice, …).
      default:
        return [];
    }
  });
}
