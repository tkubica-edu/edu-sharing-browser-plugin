import {
  Component, CUSTOM_ELEMENTS_SCHEMA, ElementRef, Input, OnChanges, OnDestroy, SimpleChanges,
  ViewChild, inject, signal
} from '@angular/core';
import { CommonModule } from '@angular/common';

import { NavigationService } from '../services/navigation.service';
import { CurationService } from '../services/curation.service';
import { ExtService } from '../services/ext.service';
import { PluginContextService } from '../services/plugin-context.service';
import { AppOption } from '../model/options';

// Renders a contributed option's custom view: either a custom element mounted inline
// (view.kind === 'element') or a remote page in a sandboxed iframe (view.kind === 'iframe').
// Page context is passed in (element props / iframe base64 `data` param) and results are
// routed back into the signal-backed services so the zoneless app reacts.
//
// Mirrors the mount/teardown discipline of MdsEditorComponent (create imperatively, set
// props before append, remove listeners + node on destroy).
@Component({
  selector: 'es-extension-view-host',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="ext-view-host" #host>
      <p class="ext-view-error" *ngIf="error() as e">{{ e }}</p>
    </div>
  `,
  styles: [`
    :host, .ext-view-host { display: block; width: 100%; height: 100%; }
    .ext-view-error { padding: 12px; color: #b00020; }
    iframe { border: 0; width: 100%; height: 100%; min-height: 480px; display: block; }
  `],
  schemas: [CUSTOM_ELEMENTS_SCHEMA]
})
export class ExtensionViewHostComponent implements OnChanges, OnDestroy {
  private readonly nav = inject(NavigationService);
  private readonly curation = inject(CurationService);
  private readonly ext = inject(ExtService);
  private readonly ctx = inject(PluginContextService);

  @Input() option!: AppOption;

  @ViewChild('host', { static: true }) private hostRef!: ElementRef<HTMLElement>;

  readonly error = signal<string | null>(null);

  private mountedId: string | null = null;
  private el?: HTMLElement;
  private iframe?: HTMLIFrameElement;
  private expectedOrigin: string | null = null;
  private readonly onMessage = (e: MessageEvent): void => this.handleMessage(e);
  private readonly onElementEvent = (e: Event): void => this.handleElementResult(e as CustomEvent);

  ngOnChanges(_changes: SimpleChanges): void {
    // Re-mount only when the option (id) actually changes.
    if (this.option?.id === this.mountedId) return;
    this.unmount();
    this.mount();
  }

  ngOnDestroy(): void {
    this.unmount();
  }

  private mount(): void {
    const view = this.option?.view;
    const host = this.hostRef?.nativeElement;
    if (!host || !view) return;
    this.error.set(null);
    try {
      if (view.kind === 'iframe') this.mountIframe(view.url, view.params, view.passContext);
      else if (view.kind === 'element') this.mountElement(view.tag, view.props);
      this.mountedId = this.option.id;
    } catch (e: unknown) {
      this.error.set(String((e as Error)?.message || e));
    }
  }

  private mountIframe(url: string, params?: Record<string, string>, passContext?: boolean): void {
    const u = new URL(url);
    for (const [k, v] of Object.entries(params ?? {})) u.searchParams.set(k, v);
    if (passContext) u.searchParams.set('data', this.ctx.encoded());
    this.expectedOrigin = u.origin;

    const iframe = document.createElement('iframe');
    iframe.src = u.toString();
    iframe.setAttribute('title', this.option.label);
    // allow-same-origin is required for the component's postMessage handshake; combined
    // with allow-scripts this weakens isolation to the remote origin only (documented).
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups');
    window.addEventListener('message', this.onMessage);
    this.hostRef.nativeElement.appendChild(iframe);
    this.iframe = iframe;
  }

  private mountElement(tag: string, props?: Record<string, unknown>): void {
    customElements
      .whenDefined(tag)
      .then(() => {
        if (this.mountedId !== null && this.option.id !== this.mountedId) return; // navigated away
        const el = document.createElement(tag) as HTMLElement & Record<string, unknown>;
        // Static props first, then the live context, then result listeners.
        for (const [k, v] of Object.entries(props ?? {})) el[k] = v;
        const ctx = this.ctx.snapshot();
        el['metadataInput'] = ctx.metadata ?? undefined;
        el['contextUrl'] = ctx.activeUrl ?? '';
        el.style.display = 'block';
        el.style.width = '100%';
        el.addEventListener('metadataSubmit', this.onElementEvent);
        el.addEventListener('uploadResult', this.onElementEvent);
        this.hostRef.nativeElement.appendChild(el);
        this.el = el;
      })
      .catch((e: unknown) => this.error.set(String((e as Error)?.message || e)));
  }

  // Inbound from an iframe view. Filter by the expected remote origin (never trust an
  // arbitrary sender). The metadata-agent posts CANVAS_* messages.
  private handleMessage(e: MessageEvent): void {
    if (this.expectedOrigin && e.origin !== this.expectedOrigin) return;
    const msg = e.data as { type?: string; metadata?: unknown; nodeId?: string } | null;
    if (!msg || typeof msg.type !== 'string') return;
    switch (msg.type) {
      case 'CANVAS_CLOSE':
        this.nav.openMenu();
        break;
      case 'CANVAS_METADATA_READY':
      case 'CANVAS_UPLOAD_RESULT':
        this.routeResult(msg.nodeId);
        break;
      default:
        break;
    }
  }

  // Inbound from an element view (CustomEvent detail).
  private handleElementResult(e: CustomEvent): void {
    const detail = (e.detail ?? {}) as { nodeId?: string; node?: { nodeId?: string } };
    this.routeResult(detail.nodeId ?? detail.node?.nodeId);
  }

  // A finished result that produced a node → load it into the curation flow and land on
  // Vorschau, reusing the existing preview flow. Writes to signals, so the zoneless app
  // reacts without a manual tick.
  private routeResult(nodeId?: string): void {
    if (!nodeId) return;
    void this.curation
      .loadFromNode(nodeId)
      .then(() => this.nav.land({ nodeJustLoaded: true }))
      .catch((err: unknown) => this.error.set(String((err as Error)?.message || err)));
  }

  private unmount(): void {
    window.removeEventListener('message', this.onMessage);
    if (this.el) {
      this.el.removeEventListener('metadataSubmit', this.onElementEvent);
      this.el.removeEventListener('uploadResult', this.onElementEvent);
      this.el.remove();
      this.el = undefined;
    }
    if (this.iframe) { this.iframe.remove(); this.iframe = undefined; }
    this.expectedOrigin = null;
    this.mountedId = null;
  }
}
