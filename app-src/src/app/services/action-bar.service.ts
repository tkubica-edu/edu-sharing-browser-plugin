import { Injectable, Signal, computed, inject, signal } from '@angular/core';

import { SectionId } from '../model/navigation';
import { BrowserExtensionCustomWebComponentService } from './browser-extension-custom-web-component.service';
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
 * What a screen that embeds its own picker hands to the footer: how to confirm the selection, and
 * whether one that may be confirmed exists. Like {@link SaveHandler}, a signal so the footer derives
 * its state instead of being pushed to.
 */
export interface ApplyHandler {
  apply: () => void;
  canApply: Signal<boolean>;
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
   * action normally is. `secondary` is the primary colour as an outline, for the way *back* out of
   * a step, so it does not compete with going on.
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
  private readonly browserExtensionCustomWebComponent = inject(BrowserExtensionCustomWebComponentService);

  // The metadata screen registers its save handler (→ mdsEditor.commit()) while mounted, so the
  // footer can drive a save without referencing the editor.
  private readonly saveHandler = signal<SaveHandler | null>(null);

  registerSaveHandler(handler: SaveHandler): void {
    this.saveHandler.set(handler);
  }

  clearSaveHandler(handler: SaveHandler): void {
    this.saveHandler.update((current) => (current === handler ? null : current));
  }

  // The "Sammlung auswählen" step registers its selector while mounted, so the footer can confirm a
  // selection it does not own.
  private readonly applyHandler = signal<ApplyHandler | null>(null);

  registerApplyHandler(handler: ApplyHandler): void {
    this.applyHandler.set(handler);
  }

  clearApplyHandler(handler: ApplyHandler): void {
    this.applyHandler.update((current) => (current === handler ? null : current));
  }

  readonly actions = computed<FooterAction[]>(() => {
    switch (this.navigation.section()) {
      // "Inhalt erschließen": run the metadata agent on the page and hand its result to the preview
      // step. The screen starts that itself on entry, so what is left for the footer is the repeat —
      // after a failure, or for a page that has changed since.
      case 'curation':
        return [
          this.backAction(),
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
      // ways through it. The adjusted picture and title travel with it (applyDraftValues).
      case 'curation-preview':
        return [
          this.backAction(),
          {
            label: 'Weiter',
            disabled: false,
            run: async () => {
              // Awaited: the handover reads a picked picture out of the widget, and the next step's
              // editor is built from the node that picture goes on.
              await this.curation.applyDraftValues();
              // Where the content goes is asked before it is described, so the filing steps come
              // first — and where none of them applies, the Qualitätsprüfung behind them does.
              this.navigation.go(this.nextSection('editorial-forward', 'personal-storage'));
            }
          }
        ];

      // "Bearbeitungsmodus": the content is being edited in the connector; this hands over to the
      // Qualitätsprüfung when the user is done adjusting it.
      case 'editing':
        return [
          this.backAction(),
          { label: 'Weiter', disabled: false, run: () => this.navigation.go('quality') }
        ];

      // "Qualitätsprüfung": its views are walked through rather than jumped between, so the footer
      // carries that walk — the way on out of the Qualität view, the way back out of the Metadaten
      // one. The tab bar is still on screen; this is the way through the step, not the only one.
      case 'quality': {
        // The Qualität view: its way on IS the confirmation — the criteria decide whether the content
        // may be published, so going on without giving it would walk past the one question this view
        // asks. It is available once the criteria allow it (CurationService.qualityCriteriaMet, which
        // the view reports), and the Metadaten sub step is locked until then for the same reason.
        //
        // Once the confirmation is given the way on is the plain step forward: it is a statement
        // about the content, made once — coming back to this view later must still lead on.
        if (this.navigation.screen() !== 'metadata') {
          const next = this.navigation.nextTab();
          if (this.curation.qualityConfirmed()) {
            return [
              this.backAction(),
              {
                label: 'Weiter',
                disabled: !next || next.disabled,
                run: () => this.navigation.goNextTab()
              }
            ];
          }
          return [
            this.backAction(),
            {
              label: 'Weiter',
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
        // Back to the Qualität view where there is one — it is not on offer without the additional
        // web component (see the registry), and then the way back leaves the section altogether.
        const toQuality = this.navigation.tabs().some((tab) => tab.id === 'quality-check');
        const back: FooterAction = toQuality
          ? {
              label: 'Zurück',
              kind: 'secondary',
              disabled: false,
              run: () => this.navigation.goTab('quality-check')
            }
          : this.backAction();
        // The Metadaten view ends the first big step, so its way on carries the write — see
        // {@link finishAction}.
        return [back, this.finishAction()];
      }

      // "An Redaktionen weiterleiten" and "Persönliche Ablage": where the content is filed and handed
      // on, before it is described and written. Nothing is saved here — the way on leads through the
      // other of the two (where it applies) into the Qualitätsprüfung, whose own way out writes the
      // content with everything the flow collected.
      case 'editorial-forward':
        return [
          this.backAction(),
          {
            label: 'Weiter',
            disabled: false,
            run: () => this.navigation.go(this.nextSection('personal-storage'))
          }
        ];

      // The filing's collection is optional and has no confirmation of its own, so the way on is
      // also what takes it over: a collection ticked in the embedded selector is applied here (the
      // screen registers the handler for it, see {@link ApplyHandler}) and then the step leads on.
      // Nothing ticked is a step passed as it stands — the content is filed in the folder alone.
      case 'personal-storage': {
        const handler = this.applyHandler();
        return [
          this.backAction(),
          {
            label: 'Weiter',
            disabled: false,
            run: () => {
              if (handler?.canApply()) handler.apply();
              this.navigation.go('quality');
            }
          }
        ];
      }

      // "Sammlung auswählen": the confirmation belongs to the embedded selector, which the screen
      // registers here while it is mounted (see {@link ApplyHandler}) — so this step's controls are
      // the same pair as every other one's.
      case 'select-collection': {
        const handler = this.applyHandler();
        return [
          this.backAction(),
          {
            label: 'Sammlung übernehmen',
            disabled: !handler?.canApply(),
            run: () => handler?.apply()
          }
        ];
      }

      // "Inhaltsübersicht": the end of the flow. Nothing follows it, so the one way on is out — back
      // to where a new errand is started.
      case 'overview':
        return [
          {
            label: 'Zurück zum Hauptmenü',
            kind: 'secondary',
            disabled: false,
            run: () => this.navigation.openMenu()
          }
        ];

      // Every other section owns its own primary action (selector insert, login form, the
      // "Inhaltsoptionen" choice, …).
      default:
        return [];
    }
  });

  /**
   * The way back out of the open step, as every step offers it: the same walk the topbar's back
   * button makes (NavigationService.back), named after what it does rather than after where it
   * lands — a footer that names its targets makes each step read like a different kind of thing.
   */
  private backAction(): FooterAction {
    return { label: 'Zurück', kind: 'secondary', disabled: false, run: () => this.navigation.back() };
  }

  /**
   * The first of the given steps that applies right now, falling back to the Qualitätsprüfung — the
   * step every filing leads into. Both filings are optional, and a step that has nothing to offer is
   * walked past rather than shown empty (see the registry).
   */
  private nextSection(...candidates: readonly SectionId[]): SectionId {
    return candidates.find((id) => this.navigation.isVisible(id)) ?? 'quality';
  }

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
   * A content that has nothing left to write simply goes on — see
   * CurationService.hasCollectedValues and, for the browser extension custom web component,
   * `written` below.
   */
  private finishAction(): FooterAction {
    const handler = this.navigation.screen() === 'metadata' ? this.saveHandler() : null;
    // Saving through the browser extension custom web component goes through the agent's `/upload`,
    // which only ever CREATES — there is no endpoint that writes back to a node it made, and the
    // panel session (a guest) may not edit it either (see WIDGET-REFERENZ.md, "Bestandsinhalte via
    // Node-ID"). So once it has written one, writing again would produce a SECOND node for the same
    // content; the way on then only goes on.
    const written = this.browserExtensionCustomWebComponent.enabled() && this.curation.metadataSaved();
    const ready = handler ? handler.canSave() : this.curation.hasCollectedValues();
    const saves = ready && !this.curation.metadataLocked() && !written;
    return {
      label: this.curation.saving() ? 'Speichern…' : 'Weiter',
      disabled: this.curation.saving() || (!saves && !this.curation.activeNode()),
      run: async () => {
        const save = handler ? () => handler.save() : () => this.curation.saveCollected();
        if (saves && !(await save())) return;
        this.navigation.go('overview');
      }
    };
  }
}
