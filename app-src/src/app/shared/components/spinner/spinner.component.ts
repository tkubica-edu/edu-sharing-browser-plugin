import { ChangeDetectionStrategy, Component } from '@angular/core';

// The edu-sharing house spinner: three overlapping hexagons in the brand blues, pulsing with a stagger. Rebuilt
// here rather than taken from the packaged bundle, which would mean loading ~1.6 MB of scripts and a second Angular
// bootstrap just to show that something is loading. Geometry, colours and timing are the original's. Decorative by
// design (`aria-hidden`): where a call site shows no caption, the element around it announces the wait.
@Component({
  selector: 'es-spinner',
  templateUrl: './spinner.component.html',
  styleUrl: './spinner.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SpinnerComponent {}
