import { Signal } from '@angular/core';

import { MdsValues } from '../util/mds-values';

/**
 * The contract the metadata screen's footer drives, implemented by every embedded metadata
 * editor (MdsEditorComponent, WloCanvasComponent). Both render without a save button of their
 * own: the footer owns "Speichern" and calls {@link commit}, which emits the current values.
 */
export interface MetadataEditor {
  /** True once the editor is mounted and can be committed. */
  readonly ready: Signal<boolean>;
  /** Emit the current values through the component's `save` output. */
  commit(): void;
  /**
   * The payload behind the committed values, for an editor that has one of its own: the envelope it
   * works against and every value in the shape its field has, neither of which survives the
   * `string[]` map {@link commit} emits. It is what the content's metadata is re-read from once the
   * save has gone through — see CurationService.save. `null`/absent where the editor has nothing to
   * add beyond the values.
   */
  payload?(): MetadataSeed | null;
}

/** What an editor is seeded with: a metadata-agent payload or a node's stored properties. */
export type MetadataSeed = Record<string, unknown>;

/** Re-exported for editors implementing the contract. */
export type { MdsValues };
