import {
  afterRenderEffect, ChangeDetectionStrategy, Component, CUSTOM_ELEMENTS_SCHEMA, ElementRef,
  OnDestroy, inject, signal, viewChild
} from '@angular/core';

import { CurationService } from '../../services/curation.service';
import { loadWebComponentBundle } from '../../services/web-component-bundle.service';

const SHARE_TAG = 'edu-sharing-share-qr';

/** The <edu-sharing-share-qr> element, typed for the inputs we set. */
interface ShareQrElement extends HTMLElement {
  nodeId?: string;
  showLink?: boolean;
  size?: number;
  /** 'permalink' (default) | anything else → a share link, see below. */
  mode?: string;
}

/** Width of the QR code. Below the element's own 220 default: the panel is narrower than a page. */
const QR_SIZE = 200;

// "Inhalt teilen": the link to the content plus its QR code, rendered by the repository's own
// <edu-sharing-share-qr> element.
//
// The element REQUIRES `nodeId` and reads it in ngOnInit, which Angular Elements runs on append —
// BEFORE a host template's property bindings are applied. `[nodeId]="…"` in a template is therefore
// too late and the element fails with "no `node-id` given". So it is created imperatively with its
// inputs set as properties before it is appended, exactly as in MdsEditorComponent.
//
// It resolves the link itself, which means it loads the node: a session that may not read it gets
// nothing, so `failed` is surfaced rather than swallowed.
//
// `mode` is left at its default 'permalink' — the node's own URL. The alternative creates a share
// link with an unlimited expiry as a side effect, which sharing a *view* of the content must not do.
@Component({
  selector: 'es-share-screen',
  templateUrl: './share-screen.component.html',
  styleUrl: './share-screen.component.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ShareScreenComponent implements OnDestroy {
  protected readonly curation = inject(CurationService);

  protected readonly bundle = loadWebComponentBundle('edu', SHARE_TAG);

  /** Set when the element could not resolve a link (typically: the node is not readable here). */
  protected readonly error = signal<string | null>(null);

  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');

  private element: ShareQrElement | null = null;
  /** Which node the mounted element was built for; it reads its id only once. */
  private mountedNodeId: string | null = null;

  private readonly onFailed = (event: Event): void => {
    const detail = (event as CustomEvent).detail as { message?: string } | null;
    this.error.set(detail?.message || 'Der Link zum Inhalt konnte nicht erzeugt werden.');
  };

  private readonly onLinkReady = (): void => this.error.set(null);

  constructor() {
    // afterRenderEffect (write phase), not a plain effect: this writes to the DOM and needs the
    // #host element. Re-mounts for a different node, since the element takes its id only on init.
    afterRenderEffect({
      write: () => {
        const nodeId = this.curation.activeNode()?.nodeId ?? null;
        if (!this.bundle.ready() || !nodeId || nodeId === this.mountedNodeId) return;
        this.mount(nodeId);
      }
    });
  }

  ngOnDestroy(): void {
    this.unmount();
  }

  /** Create the element, set every input as a property, THEN append (see the class comment). */
  private mount(nodeId: string): void {
    this.unmount();
    this.error.set(null);
    const element = document.createElement(SHARE_TAG) as ShareQrElement;
    element.nodeId = nodeId;
    element.showLink = true;
    element.size = QR_SIZE;
    element.addEventListener('linkReady', this.onLinkReady);
    element.addEventListener('failed', this.onFailed);
    // Sized inline, not via the stylesheet: an imperatively created element carries no view
    // encapsulation attribute, so this component's styles would not match it.
    element.style.cssText = 'display:block;width:100%';
    this.host().nativeElement.appendChild(element);
    this.element = element;
    this.mountedNodeId = nodeId;
  }

  private unmount(): void {
    this.element?.removeEventListener('linkReady', this.onLinkReady);
    this.element?.removeEventListener('failed', this.onFailed);
    this.element?.remove();
    this.element = null;
    this.mountedNodeId = null;
  }
}
