import { Directive, input } from '@angular/core';

/**
 * Renders a Google Material icon on its host: `<i esIcon="folder_open"></i>`. Same selector and API as `esIcon` from
 * ngx-edu-sharing-ui, which cannot be installed here (Angular ≤ 18 peers). The glyph is a ligature, hence the host
 * text, and `translate="no"` keeps a page translator from rewriting it into a word.
 */
@Directive({
  selector: '[esIcon]',
  host: {
    class: 'material-symbols-outlined',
    translate: 'no',
    'aria-hidden': 'true',
    '[textContent]': 'esIcon()'
  }
})
export class IconDirective {
  /** The Material icon's name, e.g. `folder_open`. */
  readonly esIcon = input.required<string>();
}
