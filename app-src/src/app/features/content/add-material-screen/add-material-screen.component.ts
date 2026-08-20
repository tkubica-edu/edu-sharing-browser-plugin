import {
  afterRenderEffect, ChangeDetectionStrategy, Component, CUSTOM_ELEMENTS_SCHEMA, ElementRef,
  OnDestroy, inject, signal, viewChild
} from '@angular/core';

import { errorMessage } from '../../../util/errors';
import { AuthService } from '../../../services/auth.service';
import { ContentFlowService } from '../../../services/content-flow.service';
import { CurationService } from '../../../services/curation.service';
import {
  AddMaterialResult, MaterialUploadService, withScheme
} from '../../../services/material-upload.service';
import { loadWebComponentBundle } from '../../../services/web-component-bundle.service';
import { LoginGateComponent } from '../../auth/login-gate/login-gate.component';

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

// "Datei oder Link": embeds <edu-sharing-add-material> as a real custom element. The element is only the dialog —
// it emits the picked files or the entered link and leaves the writing to its host (see MaterialUploadService).
// Like the MDS editor it is created imperatively: `dialogData` is read in its own ngOnInit, which Angular Elements
// runs on connect, before a template binding would be applied.
@Component({
  selector: 'es-add-material-screen',
  imports: [LoginGateComponent],
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
  /** The session state the mounted element was created with; see {@link mount}. */
  private mountedLoggedIn: boolean | null = null;

  private readonly onResult = (event: Event): void => {
    const added = (event as CustomEvent).detail as AddMaterialResult | null;
    if (added) void this.save(added);
  };

  constructor() {
    afterRenderEffect({
      write: () => {
        // Reads loggedIn() as well, so a login that arrives later re-creates the element for the
        // session it can write with (the dialog reads dialogData once, at its own ngOnInit).
        this.auth.loggedIn();
        if (this.bundle.ready()) this.mount();
      }
    });
  }

  ngOnDestroy(): void {
    this.detach();
  }

  /**
   * Create the element, set its input as a property, then append (see the class comment). Re-created rather than
   * updated when the login changes or the previous element left the DOM: the dialog reads `dialogData` in its own
   * ngOnInit, so a later change would not reach it.
   */
  private mount(): void {
    const host = this.host()?.nativeElement;
    if (!host) return;
    const loggedIn = this.auth.loggedIn();
    if (this.element?.isConnected && this.mountedLoggedIn === loggedIn) return;
    this.detach();
    const element = document.createElement(MATERIAL_TAG) as AddMaterialElement;
    element.dialogData = {
      // No parent and no picker: where the content is filed is asked once, by the "Persönliche
      // Ablage" step of the flow this hands over to — that step moves the node into the folder it
      // picks (CurationService.pendingStorageParent), so asking here as well would ask twice and
      // let the two answers disagree. The material is created in the inbox meanwhile, where a
      // curated content lands too (MaterialUploadService).
      parent: null,
      chooseParent: false,
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
    this.mountedLoggedIn = loggedIn;
  }

  private detach(): void {
    this.element?.removeEventListener('dialogResult', this.onResult);
    this.element?.remove();
    this.element = null;
    this.mountedLoggedIn = null;
  }

  /** Write the picked file / entered link into the repository and continue with the new node. */
  private async save(result: AddMaterialResult): Promise<void> {
    this.error.set(null);
    this.saving.set(true);
    try {
      const [node] = await this.upload.create(result);
      if (!node) return;
      // Hydrate the node into the flow (which records it in the history), then hand over to the step
      // that describes it: the material is in the repository, but nothing has been said about it yet,
      // and picture and title are what the content is recognised by everywhere else.
      await this.curation.openNode(node.nodeId);
      // A link brings its own source: the page it points at. The metadata editor erschließt it as
      // it opens, so the form starts from that page instead of from the bare URL the node carries.
      // (openNode resets this, so it is set afterwards.)
      if (result.kind === 'link') this.curation.extractionUrl.set(withScheme(result.link));
      this.flow.showCurationPreview();
    } catch (cause: unknown) {
      this.error.set('Der Inhalt konnte nicht hinzugefügt werden: ' + errorMessage(cause));
    } finally {
      this.saving.set(false);
    }
  }
}
