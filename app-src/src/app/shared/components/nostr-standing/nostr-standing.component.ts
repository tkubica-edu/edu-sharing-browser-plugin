import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { IconDirective } from '../../../directives/icon.directive';
import { NostrForwardService } from '../../../services/nostr-forward.service';

/** Where the active content stands with the nostr relay, as one of eight mutually exclusive states. */
export type NostrState =
  | 'published'
  | 'foreign'
  | 'rejected'
  | 'failed'
  | 'sending'
  | 'looking'
  | 'unknown'
  | 'picked'
  | 'untouched';

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
 * is the answer somebody opening this is looking for. Nothing about a publication is kept in this browser,
 * so what it reports comes either from a publication this session made or from asking the relay itself
 * (NostrForwardService.lookup) — which is also why „unbekannt" is a state of its own: a lookup that did not
 * get through says nothing, and must not read as „nicht gesendet". What actually went out is the receipt
 * beside it (`es-nostr-receipt`), which this deliberately does not repeat.
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
    if (receipt?.accepted && receipt.own) {
      return {
        state: 'published',
        icon: 'cloud_done',
        label: 'Veröffentlicht',
        detail:
          (receipt.origin === 'relay'
            ? 'Das Relay hält einen AMB-Eintrag zu diesem Inhalt, veröffentlicht unter dem Schlüssel ' +
              'dieser Installation. '
            : 'Das Relay hat den AMB-Eintrag angenommen. ') +
          'Er ist dort unter der Kennung des Inhalts abrufbar — die Befehle dafür stehen in der Quittung.',
        adverse: false
      };
    }
    // A record for the same resource, but published by somebody else. Not a version of ours: an
    // addressable event is addressed by kind, publisher *and* identifier, so sending would put a second
    // record beside this one rather than replacing it.
    if (receipt?.accepted) {
      return {
        state: 'foreign',
        icon: 'cloud_sync',
        label: 'Von einem anderen Absender veröffentlicht',
        detail:
          'Das Relay hält bereits einen AMB-Eintrag zu diesem Inhalt, aber unter einem fremden ' +
          'Schlüssel. Ein Senden von hier aus stellt einen zweiten Eintrag daneben, statt diesen zu ' +
          'ersetzen.',
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
    if (this.nostr.looking()) {
      return {
        state: 'looking',
        icon: 'cloud_sync',
        label: 'Wird nachgesehen',
        detail: `Es wird bei ${relay} nachgefragt, ob dort schon ein Eintrag zu diesem Inhalt liegt.`,
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
    // Nichts wissen ist nicht dasselbe wie wissen, dass nichts da ist — und nur das Zweite dürfte als
    // „nicht gesendet" auftreten.
    if (this.nostr.lookupError()) {
      return {
        state: 'unknown',
        icon: 'cloud_off',
        label: 'Unbekannt',
        detail:
          `Bei ${relay} ließ sich nicht nachsehen, ob dort ein Eintrag zu diesem Inhalt liegt. ` +
          'Möglicherweise ist einer vorhanden.',
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
      detail: `${relay} hält keinen Eintrag zu diesem Inhalt.`,
      adverse: false
    };
  });
}
