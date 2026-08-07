import {
  afterRenderEffect, ChangeDetectionStrategy, Component, CUSTOM_ELEMENTS_SCHEMA, ElementRef,
  OnDestroy, inject, signal, viewChild
} from '@angular/core';

import { errorMessage } from '../../util/errors';
import { AuthService } from '../../services/auth.service';
import { ContentFlowService } from '../../services/content-flow.service';
import { CurationService } from '../../services/curation.service';
import {
  AddMaterialResult, MaterialUploadService, withScheme
} from '../../services/material-upload.service';
import { loadWebComponentBundle } from '../../services/web-component-bundle.service';
import { LoginComponent } from '../login.component';

const MATERIAL_TAG = 'edu-sharing-add-material';

/** The <edu-sharing-add-material> element, typed for the input we set. */
interface AddMaterialElement extends HTMLElement {
  dialogData?: {
    parent: unknown;
    chooseParent: boolean;
    childobject: boolean;
    multiple: boolean;
    showLti: boolean;
  };
}

// "Datei oder Link": embeds <edu-sharing-add-material> as a REAL custom element (no iframe).
//
// The element is the repository's own add-material dialog, and it is *only* the dialog: it emits
// the picked files or the entered link on `dialogResult` and leaves the writing to its host — see
// MaterialUploadService, which creates the node from that result and is the counterpart of the
// repository's UploadService.
//
// Like the MDS editor it is created imperatively: `dialogData` is read in the element's ngOnInit,
// which Angular Elements runs on connect — BEFORE a template binding would be applied — so the
// input has to be a property on the element before it is appended.
@Component({
  selector: 'es-add-material-screen',
  imports: [LoginComponent],
  templateUrl: './add-material-screen.component.html',
  styleUrl: './add-material-screen.component.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AddMaterialScreenComponent implements OnDestroy {
  protected readonly auth = inject(AuthService);
  private readonly upload = inject(MaterialUploadService);
  private readonly curation = inject(CurationService);
  private readonly flow = inject(ContentFlowService);

  private readonly host = viewChild<ElementRef<HTMLElement>>('host');

  protected readonly bundle = loadWebComponentBundle('edu', MATERIAL_TAG);

  protected readonly error = signal<string | null>(null);
  /** True while the node is being created — the dialog has done its part by then. */
  protected readonly saving = signal(false);

  private element: AddMaterialElement | null = null;
  /** `chooseParent` the mounted element was created with; see {@link mount}. */
  private mountedWithPicker: boolean | null = null;

  private readonly onResult = (event: Event): void => {
    const result = (event as CustomEvent).detail as AddMaterialResult | null;
    if (result) void this.save(result);
  };

  constructor() {
    afterRenderEffect({
      write: () => {
        // Reads loggedIn() as well, so a login that arrives later re-creates the element with the
        // location picker (the dialog reads dialogData once, at its own ngOnInit).
        this.auth.loggedIn();
        if (this.bundle.ready()) this.mount();
      }
    });
  }

  ngOnDestroy(): void {
    this.detach();
  }

  /**
   * Create the element, set its input as a property, THEN append (see the class comment).
   *
   * Re-created rather than updated when the login changes, or when the previous element left the
   * DOM with its host (the login gate replaces it): the dialog reads `dialogData` in its own
   * ngOnInit, so a later change would not reach it.
   */
  private mount(): void {
    const host = this.host()?.nativeElement;
    if (!host) return;
    // The location picker, exactly as the repository shows it (create-menu / nodes-selector: no
    // parent given ⇒ let the user choose one). It needs a session to browse and to write outside
    // the inbox, so without a login it stays off and the node goes to the inbox — which is also
    // the only thing that works where the panel runs without one.
    const withPicker = this.auth.loggedIn();
    if (this.element?.isConnected && this.mountedWithPicker === withPicker) return;
    this.detach();
    const element = document.createElement(MATERIAL_TAG) as AddMaterialElement;
    element.dialogData = {
      // No parent: with the picker on, that is what makes the dialog ask for one (and it insists —
      // its save stays disabled until a folder is picked); with it off, MaterialUploadService falls
      // back to the inbox, where a curated content lands too.
      parent: null,
      chooseParent: withPicker,
      childobject: false,
      // One material at a time — the flow it hands over to carries exactly one node.
      multiple: false,
      showLti: false
    };
    // Sized inline: an imperatively created element carries no view encapsulation attribute, so
    // this component's styles would not match it.
    element.style.cssText = 'display:block;width:100%';
    element.addEventListener('dialogResult', this.onResult);
    host.appendChild(element);
    this.element = element;
    this.mountedWithPicker = withPicker;
  }

  private detach(): void {
    this.element?.removeEventListener('dialogResult', this.onResult);
    this.element?.remove();
    this.element = null;
    this.mountedWithPicker = null;
  }

  /** Write the picked file / entered link into the repository and continue with the new node. */
  private async save(result: AddMaterialResult): Promise<void> {
    this.error.set(null);
    this.saving.set(true);
    try {
      const [node] = await this.upload.create(result);
      if (!node) return;
      // Same handover as a newly created document: hydrate the node into the flow (which records
      // it in the history), then enter the big step it calls for — for an added material that is
      // normally the Qualitätsprüfung.
      await this.curation.openNode(node.nodeId);
      // A link brings its own source: the page it points at. The metadata editor erschließt it as
      // it opens, so the form starts from that page instead of from the bare URL the node carries.
      // (openNode resets this, so it is set afterwards.)
      if (result.kind === 'link') this.curation.extractionUrl.set(withScheme(result.link));
      await this.flow.edit();
    } catch (cause: unknown) {
      this.error.set('Der Inhalt konnte nicht hinzugefügt werden: ' + errorMessage(cause));
    } finally {
      this.saving.set(false);
    }
  }
}
