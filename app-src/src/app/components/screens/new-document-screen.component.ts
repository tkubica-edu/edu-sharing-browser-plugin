import { ChangeDetectionStrategy, Component, CUSTOM_ELEMENTS_SCHEMA, inject, signal } from '@angular/core';

import { errorMessage } from '../../util/errors';
import { AuthService } from '../../services/auth.service';
import { CurationService } from '../../services/curation.service';
import { NavigationService } from '../../services/navigation.service';
import { loadWebComponentBundle } from '../../services/web-component-bundle.service';
import { LoginComponent } from '../login.component';

const CONNECTOR_TAG = 'edu-sharing-add-with-connector';

// "Neues OnlyOffice-Dokument": embeds <edu-sharing-add-with-connector> as a REAL custom element
// (no iframe). Mounting the element opens the OnlyOffice create-dialog immediately and, on
// confirm, opens the OnlyOffice editor window. It authenticates via the shared repository session
// cookie, like the nodes selector.
@Component({
  selector: 'es-new-document-screen',
  imports: [LoginComponent],
  templateUrl: './new-document-screen.component.html',
  styleUrl: './new-document-screen.component.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class NewDocumentScreenComponent {
  protected readonly auth = inject(AuthService);
  private readonly curation = inject(CurationService);
  private readonly navigation = inject(NavigationService);

  // The element is rendered only once its tag is defined — mounting it opens the dialog, so it
  // must not appear before the bundle can drive it.
  protected readonly bundle = loadWebComponentBundle('edu', CONNECTOR_TAG);

  protected readonly error = signal<string | null>(null);

  /** Fired once the node exists and the OnlyOffice editor window has been opened. */
  protected onNodeCreated(event: Event): void {
    const detail = (event as CustomEvent).detail as { ref?: { id?: string }; id?: string } | null;
    const nodeId = detail?.ref?.id ?? detail?.id;
    if (!nodeId) return;
    // Hydrate the new node into the flow (records it in the history) and land on the preview.
    void this.curation
      .openNode(nodeId)
      .then(() => this.navigation.land({ nodeJustLoaded: true }))
      .catch((cause: unknown) => this.error.set(errorMessage(cause)));
  }

  /** Fired when the dialog closes; a null detail means the user cancelled. */
  protected onDialogClosed(event: Event): void {
    if ((event as CustomEvent).detail == null) this.navigation.openMenu();
  }

  protected onFailed(event: Event): void {
    const detail = (event as CustomEvent).detail;
    this.error.set('Das Dokument konnte nicht erstellt werden: ' + String(detail ?? ''));
  }
}
