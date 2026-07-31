import { Component, CUSTOM_ELEMENTS_SCHEMA, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

import { AuthService } from '../../services/auth.service';
import { CurationService } from '../../services/curation.service';
import { NavigationService } from '../../services/navigation.service';
import { EduBundleService } from '../../services/edu-bundle.service';
import { LoginComponent } from '../login.component';
import { toApiRootUrl } from '../../config';

// "Neues OnlyOffice-Dokument": embeds <edu-sharing-add-with-connector> as a REAL custom
// element (no iframe). Mounting the element opens the OnlyOffice create-dialog immediately
// and, on confirm, opens the OnlyOffice editor window. The bundle is loaded once by
// EduBundleService and authenticates via the shared repository session cookie (no ticket —
// same as <edu-sharing-nodes-selector> in es-search).
//
// As in es-search, the tag is rendered behind a synchronous guard (`@if (ready())`) so its
// inputs are in place before the bundle upgrades the element on connect.
@Component({
  selector: 'es-new-document-screen',
  standalone: true,
  imports: [CommonModule, LoginComponent],
  templateUrl: './new-document-screen.component.html',
  styleUrl: './new-document-screen.component.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA]
})
export class NewDocumentScreenComponent {
  readonly auth = inject(AuthService);
  private readonly curation = inject(CurationService);
  private readonly nav = inject(NavigationService);
  private readonly bundle = inject(EduBundleService);

  readonly error = signal<string | null>(null);
  // Gates the custom element until the bundle finished loading (mirrors es-search's
  // `@if (option)` guard: the element must have its inputs before it upgrades).
  readonly ready = signal(false);

  constructor() {
    const api = toApiRootUrl(this.auth.state().repositoryUrl);
    this.bundle
      .load(api)
      .then(() => this.ready.set(true))
      .catch((e: unknown) => this.error.set(String((e as Error)?.message || e)));
  }

  // Fired once the IO node exists and the OnlyOffice editor window has been opened. Hydrate
  // the new node into the curation flow (records it in the Verlauf) and land on Vorschau.
  onNodeCreated(ev: Event): void {
    const detail = (ev as CustomEvent).detail as unknown;
    const id = this.extractNodeId(detail);
    if (!id) return;
    void this.curation
      .loadFromNode(id)
      .then(() => this.nav.land({ nodeJustLoaded: true }))
      .catch((e: unknown) => this.error.set(String((e as Error)?.message || e)));
  }

  // Fired when the dialog closes; detail is null if the user cancelled. On cancel, return to
  // the options menu (a create was handled by onNodeCreated).
  onDialogClosed(ev: Event): void {
    if ((ev as CustomEvent).detail == null) this.nav.openMenu();
  }

  onFailed(ev: Event): void {
    const detail = (ev as CustomEvent).detail;
    this.error.set('Das Dokument konnte nicht erstellt werden: ' + String(detail ?? ''));
  }

  // The nodeCreated detail carries the created node; tolerate the shapes the bundle may emit.
  private extractNodeId(detail: unknown): string | null {
    const d = detail as { ref?: { id?: string }; id?: string } | null | undefined;
    return d?.ref?.id ?? d?.id ?? null;
  }
}
