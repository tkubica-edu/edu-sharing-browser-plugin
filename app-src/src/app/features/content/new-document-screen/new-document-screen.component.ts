import {
  ChangeDetectionStrategy, Component, CUSTOM_ELEMENTS_SCHEMA, OnDestroy, inject, signal
} from '@angular/core';

import { captureBundleEditorWindow } from '../../../util/bundle-windows';
import { errorMessage } from '../../../util/errors';
import { AuthService } from '../../../services/auth.service';
import { ContentFlowService } from '../../../services/content-flow.service';
import { CurationService } from '../../../services/curation.service';
import { NavigationService } from '../../../services/navigation.service';
import { loadWebComponentBundle } from '../../../services/web-component-bundle.service';
import { LoginGateComponent } from '../../auth/login-gate/login-gate.component';

const CONNECTOR_TAG = 'edu-sharing-add-with-connector';

/** Log prefix, as everywhere else in the extension (`[edu-sharing][<station>]`). */
const LOG = '[edu-sharing][connector]';

// "Neues OnlyOffice-Dokument": embeds <edu-sharing-add-with-connector> as a REAL custom element
// (no iframe). Mounting the element opens the OnlyOffice create-dialog immediately and, on
// confirm, opens the OnlyOffice editor window. It authenticates via the shared repository session
// cookie, like the nodes selector.
@Component({
  selector: 'es-new-document-screen',
  imports: [LoginGateComponent],
  templateUrl: './new-document-screen.component.html',
  styleUrl: './new-document-screen.component.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class NewDocumentScreenComponent implements OnDestroy {
  protected readonly auth = inject(AuthService);
  private readonly curation = inject(CurationService);
  private readonly navigation = inject(NavigationService);
  private readonly flow = inject(ContentFlowService);

  // The element is rendered only once its tag is defined — mounting it opens the dialog, so it
  // must not appear before the bundle can drive it.
  protected readonly bundle = loadWebComponentBundle('edu', CONNECTOR_TAG);

  protected readonly error = signal<string | null>(null);

  /**
   * Undo for the `window.open` takeover: the dialog's own editor tab is suppressed, because the panel cannot follow
   * into it — the flow takes this tab there instead. This screen only, since the claim is global. The URL the dialog
   * wanted is merely logged: it arrives whenever the dialog gets round to it, and the flow derives its own anyway.
   */
  private readonly restoreWindows = captureBundleEditorWindow(
    () => this.auth.repositoryUrl(),
    (url) => console.log(`${LOG} the connector dialog would have opened its own tab on:`, url),
  );

  ngOnDestroy(): void {
    this.restoreWindows();
  }

  /** Fired once the node exists and the dialog has handed over the editor URL. */
  protected onNodeCreated(event: Event): void {
    const detail = (event as CustomEvent).detail as { ref?: { id?: string }; id?: string } | null;
    const nodeId = detail?.ref?.id ?? detail?.id;
    if (!nodeId) return;
    // Hydrate the new node into the flow (records it in the history), then enter the big step the
    // node calls for: a document created through a connector is edited there, so this lands in the
    // Bearbeitungsmodus and takes the tab into the editor — the page the user asked for by creating
    // the document.
    void this.curation
      .openNode(nodeId)
      .then(() => this.flow.edit())
      .catch((cause: unknown) => this.error.set(errorMessage(cause)));
  }

  /** Fired when the dialog closes; a null detail means the user cancelled. */
  protected onDialogClosed(event: Event): void {
    if ((event as CustomEvent).detail == null) this.navigation.go('add-content');
  }

  protected onFailed(event: Event): void {
    const detail = (event as CustomEvent).detail;
    this.error.set('Das Dokument konnte nicht erstellt werden: ' + String(detail ?? ''));
  }
}
