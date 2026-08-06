import { ChangeDetectionStrategy, Component } from '@angular/core';

// The edu-sharing house spinner: three overlapping hexagons in the brand blues, pulsing with a
// stagger. Rebuilt here rather than taken from the packaged web-component bundle — the bundle
// registers it as `<edu-sharing-spinner>`, but rendering that would mean loading ~1.6 MB of
// scripts plus a second Angular bootstrap just to show that something is loading.
//
// Geometry, colours and timing are the original's (see `scripts/edu/assets/spinner/hex*.svg` for
// the polygon and its three fills, and the `es-spinner` component in `scripts/edu/chunk-*.js` for
// the CSS): the hexagons are wider than the cells they sit in, which is what makes them overlap.
//
// Decorative by design — `aria-hidden`, because a spinner says nothing a caption next to it does
// not say better, and every call site here has one.
@Component({
  selector: 'es-spinner',
  templateUrl: './spinner.component.html',
  styleUrl: './spinner.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SpinnerComponent {}
