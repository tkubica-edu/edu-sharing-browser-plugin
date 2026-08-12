import {
  ChangeDetectionStrategy, Component, CUSTOM_ELEMENTS_SCHEMA, input, output
} from '@angular/core';
import { Node } from 'ngx-edu-sharing-api';

import { loadWebComponentBundle } from '../services/web-component-bundle.service';

const PICKER_TAG = 'edu-sharing-location-picker';

// Embeds <edu-sharing-location-picker> as a REAL custom element (no iframe): the repository's own
// "Ablageort" control — it shows the folder as a breadcrumb and opens the repository's file chooser
// to change it.
//
// The element reports the picked folder through `parentChange` and writes nothing itself, so the
// folder is the caller's to keep (see PersonalStorageScreenComponent).
//
// Gated on the bundle being loaded AND the tag being defined, so the element is upgraded the moment
// it is created and Angular's property bindings land on the component's own inputs. The `@if` is
// what puts the bindings before the insertion: inside a conditional block the node is created
// detached, bound, and only then inserted — so the folder is set before connectedCallback runs.
@Component({
  selector: 'es-storage-location-picker',
  templateUrl: './storage-location-picker.component.html',
  styleUrl: './storage-location-picker.component.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class StorageLocationPickerComponent {
  /**
   * The folder to show. `null` is the unset state the element renders as "no location chosen" — it
   * takes no folder of its own, so a caller that starts without one starts here.
   */
  readonly parent = input<Node | null>(null);

  /**
   * Whether the element offers to remember the picked folder as the user's default (a checkbox it
   * shows after a pick, which it saves in the user's own repository settings).
   */
  readonly allowSaveAsDefault = input(true);

  /** Message shown when the bundle cannot be loaded. */
  readonly errorLabel = input('Der Ablageort konnte nicht geladen werden');

  /** The folder the user picked in the repository's file chooser. */
  readonly parentChange = output<Node>();

  protected readonly bundle = loadWebComponentBundle('edu', PICKER_TAG);

  /** Report the picked folder out of the element's own event. */
  protected onParentChange(event: Event): void {
    const parent = (event as CustomEvent).detail as Node | null;
    if (parent) this.parentChange.emit(parent);
  }
}
