import {
  Component, ElementRef, EventEmitter, HostListener, Input, OnChanges, Output, ViewChild, inject
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import browser from 'webextension-polyfill';

import { AuthService } from '../services/auth.service';
import { toApiRootUrl } from '../config';

// Hosts the edu-sharing-mds-editor web component in a same-origin iframe and feeds it
// the generated metadata via postMessage. An iframe isolates the bundle's own Angular
// runtime from this sidebar's app.
@Component({
  selector: 'es-mds-editor',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './mds-editor.component.html',
  styleUrl: './mds-editor.component.scss'
})
export class MdsEditorComponent implements OnChanges {
  private readonly sanitizer = inject(DomSanitizer);
  private readonly auth = inject(AuthService);

  /** The generated-metadata payload (the raw /generate response). */
  @Input() metadata: unknown;
  /** MDS view group to render. */
  @Input() groupId = 'io';
  /** MDS repository segment. `local` targets the repo's own metadata sets. */
  @Input() repository = 'local';
  /**
   * MDS set id. Passed explicitly so the component does NOT derive an invalid set
   * from the payload's `metadataset` (e.g. `learning_material`). `-default-` resolves
   * to the repository's default set.
   */
  @Input() setId = '-default-';

  // Emits the edited MDS values when the user clicks "Speichern".
  @Output() save = new EventEmitter<Record<string, string[]>>();

  @ViewChild('frame') private frame?: ElementRef<HTMLIFrameElement>;

  readonly frameSrc: SafeResourceUrl;

  private ready = false;

  constructor() {
    const api = toApiRootUrl(this.auth.state().repositoryUrl);
    const base = browser?.runtime?.getURL
      ? browser.runtime.getURL('webcomponent/mds-editor.html')
      : 'webcomponent/mds-editor.html';
    const url = base + '?api=' + encodeURIComponent(api);
    this.frameSrc = this.sanitizer.bypassSecurityTrustResourceUrl(url);
  }

  ngOnChanges(): void {
    // Metadata changed after the iframe was ready → push an update.
    if (this.ready) this.post('setMetadata', this.metadata);
  }

  @HostListener('window:message', ['$event'])
  onMessage(event: MessageEvent): void {
    if (event.origin !== location.origin) return;
    const msg = event.data || {};
    if (msg.source !== 'mds-editor') return;
    switch (msg.type) {
      case 'ready':
        this.ready = true;
        this.post('init', {
          metadata: this.metadata,
          groupId: this.groupId,
          repository: this.repository,
          setId: this.setId,
          editorMode: 'form',
          showCancel: false
        });
        break;
      case 'save':
        this.save.emit((msg.detail ?? {}) as Record<string, string[]>);
        break;
    }
  }

  private post(type: string, detail: unknown): void {
    const win = this.frame?.nativeElement?.contentWindow;
    if (win) win.postMessage({ target: 'mds-editor', type, detail }, location.origin);
  }
}
