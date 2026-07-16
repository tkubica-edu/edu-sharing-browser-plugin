import {
  Component, ElementRef, HostListener, Input, OnChanges, ViewChild, inject
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import browser from 'webextension-polyfill';

import { AuthService } from '../services/auth.service';
import { toApiRootUrl } from '../config';

// Hosts the edu-sharing-preview-sidebar web component in a same-origin iframe and
// feeds it the created node via postMessage. An iframe isolates the bundle's own
// Angular runtime from this sidebar's app (same approach as the MDS editor).
//
// Contract: the element's `node` input is the full (hydrated) Node object — not an
// id — so the caller must already have the node loaded (see UploadService.getNode).
@Component({
  selector: 'es-preview-node',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './preview-node.component.html',
  styleUrl: './preview-node.component.scss'
})
export class PreviewNodeComponent implements OnChanges {
  private readonly sanitizer = inject(DomSanitizer);
  private readonly auth = inject(AuthService);

  /** The hydrated Node object to preview. */
  @Input() node: unknown;

  @ViewChild('frame') private frame?: ElementRef<HTMLIFrameElement>;

  readonly frameSrc: SafeResourceUrl;

  private ready = false;

  constructor() {
    const api = toApiRootUrl(this.auth.state().repositoryUrl);
    const base = browser?.runtime?.getURL
      ? browser.runtime.getURL('webcomponent/preview.html')
      : 'webcomponent/preview.html';
    const url = base + '?api=' + encodeURIComponent(api);
    this.frameSrc = this.sanitizer.bypassSecurityTrustResourceUrl(url);
  }

  ngOnChanges(): void {
    // Node changed after the iframe was ready → push an update.
    if (this.ready) this.post('setNode', this.node);
  }

  @HostListener('window:message', ['$event'])
  onMessage(event: MessageEvent): void {
    if (event.origin !== location.origin) return;
    const msg = event.data || {};
    if (msg.source !== 'preview-sidebar') return;
    if (msg.type === 'ready') {
      this.ready = true;
      this.post('init', { node: this.node, editorMode: 'viewer' });
    }
  }

  private post(type: string, detail: unknown): void {
    const win = this.frame?.nativeElement?.contentWindow;
    if (win) win.postMessage({ target: 'preview-sidebar', type, detail }, location.origin);
  }
}
