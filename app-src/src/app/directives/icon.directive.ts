import { Directive, input } from '@angular/core';

/**
 * Renders a Google Material icon on its host: `<i esIcon="folder_open"></i>`.
 *
 * The same selector and API as `esIcon` from ngx-edu-sharing-ui, deliberately — that library cannot
 * be installed here (it peers on Angular ≤ 18 plus Angular Material, this app is Angular 21), so the
 * panel carries the directive itself and the markup stays the one the library would take over.
 *
 * The glyph is a ligature, which is why the name is written as the host's text: the font turns
 * `folder_open` into the icon. `translate="no"` keeps a page translator from rewriting that text —
 * a translated ligature renders as the word itself.
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
