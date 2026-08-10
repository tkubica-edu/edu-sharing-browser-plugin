import { Injectable, Signal, computed, inject, signal } from '@angular/core';

import { AdditionalWebComponentService } from './additional-web-component.service';
import { CurationService } from './curation.service';
import { NavigationService } from './navigation.service';

/**
 * What the metadata screen hands to the footer: how to get the editor's values out of it, and
 * whether that is possible right now. `canSave` is a signal, so the footer derives its state
 * instead of being pushed to.
 *
 * Both ways out answer whether they succeeded, because the footer's action continues on the back of
 * it — a step that is entered after a failed one would leave the content behind unwritten.
 */
export interface SaveHandler {
  /** Commit the editor and WRITE what it holds — for the step that ends with the save. */
  save: () => Promise<boolean>;
  /**
   * Commit the editor and hand its values to the flow WITHOUT writing them (see
   * CurationService.hold) — for leaving the Metadaten view while steps still follow it. The editor
   * is gone from then on, so this is the one moment its values can still be read.
   */
  collect: () => Promise<boolean>;
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
        // "Einsortieren und weiterleiten" is the rest of this same big step, so the content is not
        // written on the way there — the editor's values are only taken out of the view that is
        // about to close (see SaveHandler.collect), and the save waits for the end of the step.
        // Where that step does not apply at all (neither of its sub steps does), this IS the end of
        // it and the way on carries the write.
        if (this.navigation.isVisible('collections')) {
          const handler = this.saveHandler();
          return [
            ...back,
            {
              label: 'Einsortieren und weiterleiten',
              disabled: this.curation.metadataLocked(),
              run: async () => {
                if (handler?.canSave() && !(await handler.collect())) return;
                this.navigation.go('collections');
              }
            }
          ];
        }
        return [...back, this.finishAction()];
      }

      // "Einsortieren und weiterleiten": the last part of the first big step, and therefore where
      // the content is written — see {@link finishAction}. Only the way on: the way back is the
      // topbar's back button, and between the two sub steps it is the tab bar.
      case 'collections':
        return [this.finishAction()];

      // Every other section owns its own primary action (selector insert, login form, the
      // "Inhaltsoptionen" choice, …).
      default:
        return [];
    }
  });

  /**
   * The way out of the first big step and into the Inhaltsübersicht — the one action that writes.
   *
   * The content is created here and nowhere earlier: everything the step collected (the quality
   * criteria, the metadata, and what the sub steps of "Einsortieren und weiterleiten" will collect)
   * belongs to one content, so it is written once, at the end. The next step is entered only once
   * that succeeded — going on after a failed save would leave the content behind unwritten.
   *
   * Two ways to write it, depending on where the step ends. With the Metadaten view still on screen
   * the editor commits and its values are written directly; from a later sub step there is no editor
   * left, so what it handed over on its way out is written (CurationService.saveCollected).
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
