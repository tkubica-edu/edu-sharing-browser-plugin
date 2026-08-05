import { ChangeDetectionStrategy, Component } from '@angular/core';

// The waiting animation for a running Erschließung: the open page's images and texts are picked off
// it, land in a shopping cart, and the collected cart is then evaluated by the AI — the three things
// that actually happen while the metadata agent works, in the order they happen.
//
// Purely declarative: one CSS cycle drives the scene AND the caption, so there is no timer, no
// change detection and nothing to stop — the component's presence is the whole state (see
// curation-progress.component.scss for the timing). The agent takes as long as it takes, so the
// cycle repeats rather than pretending to be a progress bar counting down to a known end.
@Component({
  selector: 'es-curation-progress',
  templateUrl: './curation-progress.component.html',
  styleUrl: './curation-progress.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CurationProgressComponent {}
