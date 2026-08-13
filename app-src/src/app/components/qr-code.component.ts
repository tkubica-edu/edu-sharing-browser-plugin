import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import qrcode from 'qrcode-generator';

/**
 * Error correction level. `M` is what edu-sharing's own `<edu-sharing-share-qr>` encodes with, so a
 * code shown here is the same code the repository shows for the same address.
 */
const EC_LEVEL = 'M';

/** Quiet zone in modules. Four is the standard's minimum for a code to be found by a scanner. */
const MARGIN = 4;

/** An empty code, for the moment before there is anything to encode. */
const NOTHING = { span: 0, path: '' };

/**
 * A QR code for a text, drawn as an SVG of its own.
 *
 * Encoded here rather than by `<edu-sharing-share-qr>`, which is the element the repository brings
 * for this: that element takes a *node id* and resolves the address itself, which means it loads the
 * node — and a node the panel session may not read (a content written by the metadata agent, see
 * CurationService.applySavedNode) yields a 403 and no code at all, although the address it would
 * encode has been known all along. So the address goes in, and nothing is requested.
 *
 * Black on white regardless of the panel's theme: the code is read by a camera off the screen, and
 * inverted or tinted modules are what a scanner reads worst.
 */
@Component({
  selector: 'es-qr-code',
  template: `
    <svg [attr.viewBox]="'0 0 ' + code().span + ' ' + code().span" [style.width.px]="size()"
         [style.height.px]="size()" shape-rendering="crispEdges" role="img"
         [attr.aria-label]="label()">
      <rect [attr.width]="code().span" [attr.height]="code().span" fill="#fff" />
      <path [attr.d]="code().path" fill="#000" />
    </svg>
  `,
  styles: ':host { display: block; } svg { display: block; }',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class QrCodeComponent {
  /** What the code encodes — an address, typically. */
  readonly data = input.required<string>();

  /** The rendered edge length in pixels; the code itself is resolution-independent. */
  readonly size = input(200);

  /** What the code is, for anyone who cannot see it. */
  readonly label = input('QR-Code');

  /**
   * The code as one SVG path plus the edge length of its grid, in modules: every dark module is a
   * 1×1 square of the path, so the whole code is a single element and scales with the SVG's viewBox.
   */
  protected readonly code = computed(() => {
    const data = this.data();
    if (!data) return NOTHING;
    // Type 0 picks the smallest version the data fits into; a text too long for any of them throws,
    // and an empty code is the answer to that — a screen must not fall over a link it cannot encode.
    const code = qrcode(0, EC_LEVEL);
    try {
      code.addData(data);
      code.make();
    } catch (cause: unknown) {
      console.warn('[qr] Der QR-Code konnte nicht erzeugt werden', cause);
      return NOTHING;
    }
    const count = code.getModuleCount();
    let path = '';
    for (let row = 0; row < count; row++) {
      for (let column = 0; column < count; column++) {
        if (code.isDark(row, column)) path += `M${column + MARGIN} ${row + MARGIN}h1v1h-1z`;
      }
    }
    return { span: count + 2 * MARGIN, path };
  });
}
