import { ChangeDetectionStrategy, Component } from '@angular/core';

import { SpinnerComponent } from './spinner.component';

// The waiting state for a running Erschließung: edu-sharing's spinner over a caption naming the
// three things that actually happen while the metadata agent works — the page is read, its images
// and texts are collected, the AI evaluates them — in the order they happen.
//
// Purely declarative: one CSS cycle drives the caption, so there is no timer, no change detection
// and nothing to stop — the component's presence is the whole state (see
// curation-progress.component.scss for the timing). The agent takes as long as it takes, so the
// cycle repeats rather than pretending to be a progress bar counting down to a known end.
@Component({
  selector: 'es-curation-progress',
  imports: [SpinnerComponent],
  templateUrl: './curation-progress.component.html',
  styleUrl: './curation-progress.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CurationProgressComponent {}
