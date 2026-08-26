import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { IconDirective } from '../../../directives/icon.directive';
import { NostrForwardService } from '../../../services/nostr-forward.service';

/** Where the active content stands with the nostr relay, as one of six mutually exclusive states. */
export type NostrState = 'published' | 'rejected' | 'failed' | 'sending' | 'picked' | 'untouched';

/** How one state is put: the glyph and words that name it, and the sentence that says what it means. */
interface Standing {
  state: NostrState;
  icon: string;
  label: string;
  detail: string;
  /** Drawn as an outcome that did not hold — a refusal or a failure. */
  adverse: boolean;
}

/**
 * Where the active content stands with the nostr relay: whether it is published there, to which relay, and
 * under which identity. One component, so the answer reads the same wherever it is asked — the *An Nostr
 * Relay senden* step, which acts on it, and the *Interaktionen* view, which only reports it.
 *
 * It states something for every content, including one nothing was ever done with: „liegt bei keinem Relay"
 * is the answer somebody opening this is looking for. What actually went out is the receipt beside it
 * (`es-nostr-receipt`), which this deliberately does not repeat.
 */
@Component({
  selector: 'es-nostr-standing',
  imports: [DatePipe, IconDirective],
  templateUrl: './nostr-standing.component.html',
  styleUrl: './nostr-standing.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class NostrStandingComponent {
  protected readonly nostr = inject(NostrForwardService);

  /**
   * The state, read off what was actually done rather than off what was planned: the forwarding step's tick
   * is only a plan for as long as that step is open, so it is the last thing asked and the weakest answer.
   *
   * A content that is published and whose *re-publication* then failed still reads as published — the record
   * on the relay is the older event, which is true and is what the error line beside this is about.
   */
  protected readonly standing = computed<Standing>(() => {
    const receipt = this.nostr.receipt();
    const relay = this.nostr.relayUrl();
    if (receipt?.accepted) {
      return {
        state: 'published',
        icon: 'cloud_done',
        label: 'Veröffentlicht',
        detail:
          'Das Relay hat den AMB-Eintrag angenommen. Er ist dort unter der Kennung des Inhalts ' +
          'abrufbar — die Befehle dafür stehen in der Quittung.',
        adverse: false
      };
    }
    if (receipt) {
      return {
        state: 'rejected',
        icon: 'cloud_off',
        label: 'Vom Relay abgelehnt',
        detail:
          `Der Eintrag wurde gesendet, aber ${relay} hat ihn nicht behalten. Was das Relay dazu gesagt ` +
          'hat, steht in der Quittung.',
        adverse: true
      };
    }
    if (this.nostr.sending()) {
      return {
        state: 'sending',
        icon: 'cloud_upload',
        label: 'Wird gesendet',
        detail: `Der Eintrag ist unterwegs zu ${relay}.`,
        adverse: false
      };
    }
    if (this.nostr.error()) {
      return {
        state: 'failed',
        icon: 'cloud_off',
        label: 'Senden fehlgeschlagen',
        detail: 'Es liegt nichts beim Relay: Der Versuch ist gescheitert, bevor eine Antwort kam.',
        adverse: true
      };
    }
    if (this.nostr.selected()) {
      return {
        state: 'picked',
        icon: 'schedule',
        label: 'Vorgemerkt',
        detail:
          'Im Schritt „An Redaktionen weiterleiten" ist das Relay angehakt; gesendet wird der Eintrag ' +
          'dort mit „An Relay senden".',
        adverse: false
      };
    }
    return {
      state: 'untouched',
      icon: 'cloud_queue',
      label: 'Nicht gesendet',
      detail: 'Dieser Inhalt liegt bei keinem Relay.',
      adverse: false
    };
  });
}
