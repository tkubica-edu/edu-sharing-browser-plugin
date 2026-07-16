import { Component, ElementRef, HostListener, Input, ViewChild, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import browser from 'webextension-polyfill';

import { AuthService } from '../services/auth.service';
import { ExtService } from '../services/ext.service';
import { toApiRootUrl } from '../config';

// Hosts the edu-sharing-nodes-selector web component in a same-origin iframe. An iframe
// isolates the bundle's own Angular runtime from this sidebar's app. The selector opens
// directly on the SEARCH tab in "source" mode.
@Component({
  selector: 'es-search',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './search.component.html',
  styleUrl: './search.component.scss'
})
export class SearchComponent {
  private readonly sanitizer = inject(DomSanitizer);
  private readonly auth = inject(AuthService);
  private readonly ext = inject(ExtService);

  @Input() contextUrl: string | null = null;

  @ViewChild('frame') private frame?: ElementRef<HTMLIFrameElement>;

  readonly frameSrc: SafeResourceUrl;

  private ready = false;

  constructor() {
    const api = toApiRootUrl(this.auth.state().repositoryUrl);
    const base = browser?.runtime?.getURL
      ? browser.runtime.getURL('webcomponent/nodes-selector.html')
      : 'webcomponent/nodes-selector.html';
    const url = base + '?api=' + encodeURIComponent(api);
    this.frameSrc = this.sanitizer.bypassSecurityTrustResourceUrl(url);
  }

  @HostListener('window:message', ['$event'])
  onMessage(event: MessageEvent): void {
    if (event.origin !== location.origin) return;
    const msg = event.data || {};
    if (msg.source !== 'nodes-selector') return;
    console.log('[edu-sharing][search.component] ⬅ received from bridge:', msg.type, msg.detail);
    if (msg.type === 'ready' && !this.ready) {
      this.ready = true;
      this.post('init', {
        tabBlacklist: ['collections', 'upload'],
        // parent intentionally omitted → no auto-selected source node
        option: { option: 'SORT_INTO', trap: false, optionConfig: { state: 'search' } },
        primaryMode: 'activity'
      });
    } else if (msg.type === 'copy') {
      // User clicked "Gewählten Inhalt kopieren" → forward the selection to the host page.
      const nodes = msg.detail?.nodes ?? [];
      console.log('[edu-sharing][search.component] ➡ copy: forwarding', nodes.length, 'node(s) to host page via ExtService');
      this.ext.insertNodes(nodes);
    }
  }

  private post(type: string, detail: unknown): void {
    const win = this.frame?.nativeElement?.contentWindow;
    console.log('[edu-sharing][search.component] ➡ post to bridge:', type, detail, win ? '' : '(no iframe window!)');
    if (win) win.postMessage({ target: 'nodes-selector', type, detail }, location.origin);
  }
}
