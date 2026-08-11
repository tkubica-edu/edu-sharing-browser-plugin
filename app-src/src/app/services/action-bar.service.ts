import { Injectable, Signal, computed, inject, signal } from '@angular/core';

import { SectionId } from '../model/navigation';
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
      // ways on — dropping the run altogether, or carrying it into the step that follows. The
      // adjusted picture and title travel with it (applyDraftValues).
      case 'curation-preview': {
        // Where the content goes is asked before it is described, so "Einsortieren und weiterleiten"
        // is next — unless neither of its sub steps applies, and then the Qualitätsprüfung behind it
        // is (see the registry).
        const next: SectionId = this.navigation.isVisible('collections') ? 'collections' : 'quality';
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
            label: next === 'collections' ? 'Einsortieren und weiterleiten' : 'Qualitätsprüfung',
            disabled: false,
            run: async () => {
              // Awaited: the handover reads a picked picture out of the widget, and the next step's
              // editor is built from the node that picture goes on.
              await this.curation.applyDraftValues();
              this.navigation.go(next);
            }
          }
        ];
      }

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

      // "Qualitätsprüfung": its views are walked through rather than jumped between, so the footer
      // carries that walk — the way on out of the Qualität view, "Zurück" out of the Metadaten one.
      // The tab bar is still on screen; this is the way through the step, not the only one.
      //
      // The way out of the section belongs to the Metadaten view — from the Qualität view there is
      // nothing yet to leave. Which is the whole step where the Qualität view does not apply (see
      // the registry), and the walk is then a single view with the way on under it.
      case 'quality': {
        // The Qualität view: its way on IS the confirmation — the criteria decide whether the content
        // may be published, so going on without giving it would walk past the one question this view
        // asks. It is available once the criteria allow it (CurationService.qualityCriteriaMet, which
        // the view reports), and the Metadaten sub step is locked until then for the same reason.
        //
        // Once given it is the plain "Weiter" again: the confirmation is a statement about the
        // content, made once — coming back to this view later must still lead on.
        if (this.navigation.screen() !== 'metadata') {
          const next = this.navigation.nextTab();
          if (this.curation.qualityConfirmed()) {
            return [
              {
                label: 'Weiter',
                disabled: !next || next.disabled,
                run: () => this.navigation.goNextTab()
              }
            ];
          }
          return [
            {
              label: 'Qualität bestätigen',
              disabled: !this.curation.qualityCriteriaMet(),
              run: async () => {
                await this.curation.confirmQuality();
                // Only on the back of a confirmation that held: one the repository refused is
                // reported in the view (CurationService.qualityError), which is here.
                if (this.curation.qualityConfirmed()) this.navigation.goNextTab();
              }
            }
          ];
        }
        // Only where the Qualität view is on offer at all (it is not without the additional web
        // component, see the registry): the way back through a step is a way back to a view, and
        // one that does not apply is not one — the button would refuse itself.
        const back: FooterAction[] = this.navigation.tabs().some((tab) => tab.id === 'quality-check')
          ? [
              {
                label: 'Zurück',
                kind: 'secondary',
                disabled: false,
                run: () => this.navigation.goTab('quality-check')
              }
            ]
          : [];
        // The Metadaten view ends the first big step, so its way on carries the write — see
        // {@link finishAction}.
        return [...back, this.finishAction()];
      }

      // "Einsortieren und weiterleiten": where the content is filed and handed on, before it is
      // described and written. Nothing is saved here — the way on leads into the Qualitätsprüfung,
      // whose own way out writes the content with everything the flow collected.
      //
      // Its sub steps are walked through like the Qualitätsprüfung's: from the forwarding the way on
      // is the Persönliche Ablage where that applies, and only from the last of them does it leave
      // the section. So both are offered rather than the second being reachable via the tab bar
      // alone — a step the footer walks past reads as one that was not meant to be filled in.
      //
      // Only the way on: the way back is the topbar's back button, and between the sub steps it is
      // the tab bar.
      case 'collections': {
        const next = this.navigation.nextTab();
        if (next && !next.disabled) {
          return [{ label: next.label, disabled: false, run: () => this.navigation.goNextTab() }];
        }
        return [
          {
            label: 'Qualitätsprüfung',
            disabled: false,
            run: () => this.navigation.go('quality')
          }
        ];
      }

      // Every other section owns its own primary action (selector insert, login form, the
      // "Inhaltsoptionen" choice, …).
      default:
        return [];
    }
  });

  /**
   * The way out of the Qualitätsprüfung and into the Inhaltsübersicht — the one action that writes.
   *
   * The content is created here and nowhere earlier: everything the flow collected (the quality
   * criteria, where the content was filed, and the metadata the editor commits now) belongs to one
   * content, so it is written once, at the end. The next step is entered only once that succeeded —
   * going on after a failed save would leave the content behind unwritten.
   *
   * The editor is on screen here, so it commits and its values are written. Without one — it has not
   * mounted, or the section carries no Metadaten view — what the other steps recorded is written on
   * its own (CurationService.saveCollected).
   *
   * A content that has nothing left to write simply goes on — see CurationService.hasCollectedValues
   * and, for the additional web component, `written` below.
   */
  private finishAction(): FooterAction {
    const handler = this.navigation.screen() === 'metadata' ? this.saveHandler() : null;
    // Saving through the additional web component goes through the agent's `/upload`, which only
    // ever CREATES — there is no endpoint that writes back to a node it made, and the panel session
    // (a guest) may not edit it either (see WIDGET-REFERENZ.md, "Bestandsinhalte via Node-ID"). So
    // once it has written one, writing again would produce a SECOND node for the same content; the
    // way on then only goes on.
    const written = this.additionalWebComponent.enabled() && this.curation.metadataSaved();
    const ready = handler ? handler.canSave() : this.curation.hasCollectedValues();
    const saves = ready && !this.curation.metadataLocked() && !written;
    return {
      label: this.curation.saving() ? 'Speichern…' : 'Inhaltsübersicht',
      disabled: this.curation.saving() || (!saves && !this.curation.activeNode()),
      run: async () => {
        const save = handler ? () => handler.save() : () => this.curation.saveCollected();
        if (saves && !(await save())) return;
        this.navigation.go('overview');
      }
    };
  }
}
