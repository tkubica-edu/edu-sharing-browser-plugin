import { ChangeDetectionStrategy, Component, CUSTOM_ELEMENTS_SCHEMA, input, output, signal } from '@angular/core';

import { MdsValues, toMdsEditorValues } from '../util/mds-values';
import { loadWebComponentBundle } from '../services/web-component-bundle.service';
import { MetadataEditor, MetadataSeed } from './metadata-editor';

const CANVAS_TAG = 'metadata-agent-canvas';

/**
 * What the canvas emits on `metadataChange` / `metadataSubmit` (its `getMetadataForExport()`):
 * the envelope of the metadata-agent payload, with the field values nested under `metadata`.
 */
interface CanvasMetadata {
  metadata?: Record<string, unknown>;
  [envelopeField: string]: unknown;
}

// The WLO metadata editor: <metadata-agent-canvas> from the packaged wlo bundle, used as a REAL
// custom element. Replaces the edu-sharing MDS editor on the metadata screen while the
// repository config enables the additional web component.
//
// It is configured for embedded use exactly like the previous WLO browser plugin did
// (`layout="plugin"`, no status bar, no AI highlighting), except that its own save and upload
// buttons stay hidden: as with MdsEditorComponent, the footer owns "Speichern" and commit()
// hands over the current values, which arrive continuously via `metadataChange`.
@Component({
  selector: 'es-wlo-canvas',
  templateUrl: './wlo-canvas.component.html',
  styleUrl: './wlo-canvas.component.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class WloCanvasComponent implements MetadataEditor {
  /**
   * The metadata payload to load. The canvas accepts the metadata-agent payload as-is (its
   * `importJsonData` reads `metadata || <the payload>` plus `metadataset`, `_origins`,
   * `_source_text` and `preview_image_url`), so an analysis result and a node's stored
   * properties both work.
   */
  readonly metadata = input.required<MetadataSeed>();

  /** Emits the current values when the footer triggers a save. */
  readonly save = output<MdsValues>();

  protected readonly bundle = loadWebComponentBundle('wlo', CANVAS_TAG);

  /** Ready once the element is rendered; it is seeded with `metadata` from the start. */
  readonly ready = this.bundle.ready;

  /** The canvas' latest state. Seeded from the input, so a save without edits still sends it. */
  private readonly latest = signal<CanvasMetadata | null>(null);

  commit(): void {
    const current = this.latest() ?? (this.metadata() as CanvasMetadata);
    // Keep only the namespaced field values — the envelope (contextName, schemaVersion,
    // metadataset_uri, _source_text, …) is not node metadata.
    this.save.emit(toMdsEditorValues(current.metadata ?? current));
  }

  /** `metadataChange` fires (debounced) on every canvas edit. */
  protected onMetadataChange(event: Event): void {
    const detail = (event as CustomEvent).detail as CanvasMetadata | null;
    if (detail) this.latest.set(detail);
  }

  /** `metadataSubmit` fires if the canvas ever surfaces a save control of its own. */
  protected onMetadataSubmit(event: Event): void {
    this.onMetadataChange(event);
    this.commit();
  }
}
