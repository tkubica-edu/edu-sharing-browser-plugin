import { Injectable, Signal, computed, inject, signal } from '@angular/core';

import { SectionId } from '../model/navigation';
import { CurationService } from './curation.service';
import { NavigationService } from './navigation.service';
import { PageRecognitionService } from './page-recognition.service';

/**
 * What the metadata screen hands to the footer: how to save, and whether saving is possible right now.
 * `canSave` is a signal, so the footer derives its state instead of being pushed to. `save` answers whether the
 * write succeeded, since the footer's action continues on the back of it.
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
  // The last write of the flow makes the open page one the repository holds — see {@link finishAction}.
  private readonly pageRecognition = inject(PageRecognitionService);

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
    // Under the login gate the section's own actions belong to a screen that is not on display, and
    // the only way on the gate has is the login on it — so what the footer carries there is the way
    // back out, as on every other step (see NavigationService.sessionGate).
    if (this.navigation.sessionGate()) return [this.backAction()];
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

      // The preview step of the Erschließung, and the step that writes the content: the node is created here and
      // every step behind this one edits it. Only on the back of a write that held — a step entered after a
      // failed save would work on a content that is not there.
      case 'curation-preview':
        return [
          this.backAction(),
          {
            label: this.curation.saving() ? 'Speichern…' : 'Weiter',
            disabled: this.curation.saving(),
            run: async () => {
              // Awaited: the handover reads a picked picture out of the widget, and it is that
              // picture the save writes onto the node it creates.
              await this.curation.applyDraftValues();
              if (!(await this.curation.createContent())) return;
              // Where the content goes is asked before it is described, so the filing steps come
              // first — and where none of them applies, the choice of process behind them does.
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
        // The Qualität view: its way on is the confirmation, since the criteria decide whether the content may be
        // published — available once they allow it, which is also what unlocks the Metadaten sub step. Once given,
        // the way on is the plain step forward, so returning to this view later still leads on.
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
              label: this.curation.saving() ? 'Speichern…' : 'Weiter',
              // While a check is still running its criteria are not answered yet, and the confirmation
              // records what is on screen: given now it would state a quality nobody has seen.
              disabled:
                !this.curation.qualityCriteriaMet() ||
                this.curation.qualityChecksRunning() ||
                this.curation.saving(),
              run: async () => {
                // The confirmation is a write: the criteria go onto the content and the quality
                // workflow is started with them (CurationService.confirmQuality).
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
      // on. The content exists by now, so the way on out of each of them writes what that step
      // picked — the collections it is referenced in, the folder it is moved to (see
      // CurationService.saveCollected) — and only then leads on: to the other of the two where it
      // applies, and to the choice of process behind them otherwise.
      case 'editorial-forward':
        return [
          this.backAction(),
          {
            label: this.curation.saving() ? 'Speichern…' : 'Weiter',
            disabled: this.curation.saving(),
            run: async () => {
              if (!(await this.curation.saveCollected())) return;
              this.navigation.go(this.nextSection('personal-storage'));
            }
          }
        ];

      // The filing's collection is optional and has no confirmation of its own, so the way on is
      // also what takes it over: a collection ticked in the embedded selector is applied here (the
      // screen registers the handler for it, see {@link ApplyHandler}) and then the step writes and
      // leads on. Nothing ticked is a step passed as it stands — the content is filed in the folder
      // alone.
      case 'personal-storage': {
        const handler = this.applyHandler();
        return [
          this.backAction(),
          {
            label: this.curation.saving() ? 'Speichern…' : 'Weiter',
            disabled: this.curation.saving(),
            run: async () => {
              if (handler?.canApply()) handler.apply();
              if (!(await this.curation.saveCollected())) return;
              this.navigation.go('flow-choice');
            }
          }
        ];
      }

      // "Prüfprozess auswählen": the two processes are options of one choice, marked on the screen
      // (FlowChoiceScreenComponent) and opened from here — the screen registers the way on as its
      // apply handler, the same arrangement "Sammlung auswählen" makes for its selector.
      case 'flow-choice': {
        const handler = this.applyHandler();
        return [
          this.backAction(),
          {
            label: 'Weiter',
            disabled: !handler?.canApply(),
            run: () => handler?.apply()
          }
        ];
      }

      // "Individuelle Qualitätsprüfung mit KI": the dialogue with the assistant IS the step, and it ends
      // in the same record the structured check produces — so it offers the same confirmation and the
      // same write (see AiQualityScreenComponent). What it waits for is an answer, not a good one: the
      // assistant judges every criterion and the person decides what to do with that, which is the
      // difference from the structured check, where the ticked boxes ARE the decision. Until an answer
      // is in, the way back is all there is.
      case 'ai-quality': {
        if (this.curation.qualityConfirmed()) return [this.backAction()];
        return [
          this.backAction(),
          {
            label: this.curation.saving() ? 'Speichern…' : 'Qualität bestätigen',
            disabled: !this.curation.qualityCriteriaJudged() || this.curation.saving(),
            // The same write as in the structured check: the criteria go onto the content and the
            // quality workflow is started with them (CurationService.confirmQuality).
            run: () => this.curation.confirmQuality()
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
   * The first of the given steps that applies right now, falling back to the choice of process — the
   * step every filing leads into. Both filings are optional, and a step that has nothing to offer is
   * walked past rather than shown empty (see the registry).
   */
  private nextSection(...candidates: readonly SectionId[]): SectionId {
    return candidates.find((id) => this.navigation.isVisible(id)) ?? 'flow-choice';
  }

  /**
   * The way out of the Qualitätsprüfung and into the Inhaltsübersicht — the last write of the flow: the metadata the
   * editor commits, the WLO extended fields and the handover to the editorial queue. The next step follows only on a
   * write that succeeded. Without an editor on screen, what the other steps recorded is written on its own.
   */
  private finishAction(): FooterAction {
    const handler = this.navigation.screen() === 'metadata' ? this.saveHandler() : null;
    const saves = (handler ? handler.canSave() : true) && !this.curation.metadataLocked();
    return {
      label: this.curation.saving() ? 'Speichern…' : 'Weiter',
      disabled: this.curation.saving() || (!saves && !this.curation.activeNode()),
      run: async () => {
        // Without an editor to commit, the step's own write still happens: the extended fields and
        // the handover are what leaving this view means, whether or not a form reported values.
        const save = handler
          ? () => handler.save()
          : () => this.curation.saveCollected({ metadata: true, review: true });
        if (saves && !(await save())) return;
        // The page has been erschlossen: the repository now answers the URL lookup with this content,
        // so the recognition's earlier "no content" no longer holds and is asked again on the way back
        // to the menu (see NavigationService.openMenu).
        this.pageRecognition.invalidate();
        this.navigation.go('overview');
      }
    };
  }
}
