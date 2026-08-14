import { ChangeDetectionStrategy, Component } from '@angular/core';

import { SpinnerComponent } from '../../../shared/components/spinner/spinner.component';

// The waiting state for a running Erschließung: a spinner over a caption naming what happens while the metadata
// agent works, in that order. Purely declarative — one CSS cycle drives the caption, so there is no timer and
// nothing to stop. The agent takes as long as it takes, so the cycle repeats rather than counting down.
@Component({
  selector: 'es-curation-progress',
  imports: [SpinnerComponent],
  templateUrl: './curation-progress.component.html',
  styleUrl: './curation-progress.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CurationProgressComponent {}
