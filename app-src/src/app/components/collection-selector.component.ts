import {
  Component, ElementRef, EventEmitter, HostListener, Output, ViewChild, inject
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import browser from 'webextension-polyfill';

import { AuthService } from '../services/auth.service';
import { toApiRootUrl } from '../config';

/** A collection the user picked in the selector. */
export interface CollectionChoice {
  id: string;
  name: string;
}

// Hosts the edu-sharing-nodes-selector web component in a same-origin iframe and
// relays the collection the user confirms back to the sidebar. Same iframe approach
// as the MDS editor / preview: the bundle ships its own Angular runtime, so it
// cannot share this app's document.
@Component({
  selector: 'es-collection-selector',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './collection-selector.component.html',
  styleUrl: './collection-selector.component.scss'
})
export class CollectionSelectorComponent {
  private readonly sanitizer = inject(DomSanitizer);
  private readonly auth = inject(AuthService);

  // Emits the collection(s) the user confirmed via the selector's apply button.
  @Output() choose = new EventEmitter<CollectionChoice[]>();

  @ViewChild('frame') private frame?: ElementRef<HTMLIFrameElement>;

  readonly frameSrc: SafeResourceUrl;

  private ready = false;

  constructor() {
    const api = toApiRootUrl(this.auth.state().repositoryUrl);
    const base = browser?.runtime?.getURL
      ? browser.runtime.getURL('webcomponent/collection-selector.html')
      : 'webcomponent/collection-selector.html';
    const url = base + '?api=' + encodeURIComponent(api);
    this.frameSrc = this.sanitizer.bypassSecurityTrustResourceUrl(url);
  }

  @HostListener('window:message', ['$event'])
  onMessage(event: MessageEvent): void {
    if (event.origin !== location.origin) return;
    const msg = event.data || {};
    if (msg.source !== 'nodes-selector') return;
    switch (msg.type) {
      case 'ready':
        this.ready = true;
        this.post('init', { applyLabel: 'In Sammlung einfügen' });
        break;
      case 'choose':
        this.choose.emit((msg.detail ?? []) as CollectionChoice[]);
        break;
    }
  }

  private post(type: string, detail: unknown): void {
    const win = this.frame?.nativeElement?.contentWindow;
    if (win) win.postMessage({ target: 'nodes-selector', type, detail }, location.origin);
  }
}
