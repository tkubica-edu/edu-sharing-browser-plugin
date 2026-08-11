import {
  ChangeDetectionStrategy, Component, CUSTOM_ELEMENTS_SCHEMA, computed, input, linkedSignal,
  output, signal
} from '@angular/core';

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

/** How the canvas is used: editing the metadata, or showing it read-only. */
export type WloCanvasMode = 'edit' | 'detail';

/** The canvas settings that differ per mode. */
interface CanvasConfig {
  layout: string;
  columns: number;
  readonly: boolean;
  borderless: boolean;
  showInputArea: boolean;
  showFooter: boolean;
  showFieldActions: boolean;
  showFloatingControls: boolean;
  showContentType: boolean;
  showContentTypeOnly: boolean;
  showResetButton: boolean;
  highlightAi: boolean;
}

/**
 * The two presets the bundle documents for embedded use (see its own
 * `examples/canvas-parameter-demo.html`): "Plugin" for editing, "Detail (readonly)" for showing
 * the properties. Kept verbatim so they stay comparable with that reference.
 *
 * `highlightAi` is the plugin's own addition rather than part of those presets: the fields the
 * metadata agent filled are marked where they can also be corrected, since there the colour asks the
 * user to check them. A view that only shows the properties states what the content *is* and has
 * nothing to ask, so it leaves them unmarked.
 */
const CONFIGS: Record<WloCanvasMode, CanvasConfig> = {
  edit: {
    layout: 'plugin',
    columns: 1,
    readonly: false,
    borderless: true,
    showFooter: false,
    showFieldActions: true,
    showInputArea: false,
    showFloatingControls: false,
    showContentType: true,
    showContentTypeOnly: false,
    showResetButton: true,
    highlightAi: true
  },
  detail: {
    layout: 'detail',
    columns: 4,
    readonly: true,
    borderless: true,
    showFooter: false,
    showInputArea: false,
    showFieldActions: false,
    showFloatingControls: false,
    showContentType: true,
    showContentTypeOnly: true,
    showResetButton: false,
    highlightAi: false
  }
};

// The WLO metadata canvas: <metadata-agent-canvas> from the packaged wlo bundle, used as a REAL
// custom element. While the repository config enables the additional web component it replaces
// both the edu-sharing MDS editor (mode 'edit', on the metadata screen) and the preview element
// (mode 'detail', on the preview screen).
//
// In 'edit' mode its own save and upload buttons stay hidden: as with MdsEditorComponent, the
// footer owns "Speichern" and commit() hands over the current values, which arrive continuously
// via `metadataChange`. In 'detail' mode it is read-only and nothing is committed.
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
   *
   * Its `_origins` decide which fields count as the agent's — a payload without them marks every
   * filled field as generated, so the seed states the provenance of all of them (see
   * CurationService.editorMetadata).
   */
  readonly metadata = input.required<MetadataSeed>();

  /** Editing (default) or a read-only view of the properties. */
  readonly mode = input<WloCanvasMode>('edit');

  /**
   * Locks the form in 'edit' mode: the fields stay visible but can no longer be changed. For the
   * window in which the values have left the editor and are being written — a save in flight (see
   * CurationService.metadataLocked).
   */
  readonly locked = input(false);

  /**
   * The content's preview image. The canvas keeps it in its own state rather than reading it off
   * the payload, so it has to be passed separately; empty means "none".
   */
  readonly previewImage = input('');

  /**
   * A page the canvas should erschließen *itself* on mount: it is handed over as the element's
   * `url` + `inputMode="url"` with `autoExtract`, so the agent reads that page and fills the form.
   * Empty means "nothing to extract" — the form then only shows what it was seeded with.
   *
   * Used for a content whose source is known but whose metadata is not: a link that was just added
   * to the repository (see AddMaterialScreenComponent).
   */
  readonly sourceUrl = input('');

  /** Emits the current values when the footer triggers a save (mode 'edit'). */
  readonly save = output<MdsValues>();

  /**
   * What the element is actually seeded with: the FIRST payload the input carried, held for as long
   * as this component is mounted.
   *
   * The canvas reloads its whole state whenever `metadataInput` changes, which would discard the
   * user's edits and re-render the editor. Saving does change the source of that payload — the node's
   * stored properties replace the agent result — so without this freeze the editor would visibly
   * reload right after "Speichern". Like MdsEditorComponent, it is seeded once and owns its state
   * from then on; a different content arrives through a new instance of this component.
   */
  protected readonly seed = linkedSignal<MetadataSeed, MetadataSeed>({
    source: this.metadata,
    computation: (metadata, previous) => previous?.value ?? metadata
  });

  protected readonly config = computed(() => CONFIGS[this.mode()]);

  protected readonly bundle = loadWebComponentBundle('wlo', CANVAS_TAG);

  /** Ready once the element is rendered; it is seeded with `metadata` from the start. */
  readonly ready = this.bundle.ready;

  /** The canvas' latest state. Seeded from the input, so a save without edits still sends it. */
  private readonly latest = signal<CanvasMetadata | null>(null);

  commit(): void {
    const current = this.current();
    // Keep only the namespaced field values — the envelope (contextName, schemaVersion,
    // metadataset_uri, _source_text, …) is not node metadata.
    this.save.emit(toMdsEditorValues(current.metadata ?? current));
  }

  /**
   * The canvas' own export, flattened into the shape it is seeded from: the envelope, with the field
   * values next to it rather than nested under `metadata` (`importJsonData` accepts both, the rest of
   * the app states a payload flat).
   *
   * This is what the content's metadata is re-read from after a save, and it carries the two things
   * the committed values cannot:
   *
   * - the **envelope**, `metadataset` above all: the canvas resolves its content type — and with it
   *   every field beyond the core ones — from that key alone. Without it a canvas seeded back from
   *   the save has no schema to render the values against.
   * - every value in the **shape its field has**. A single-valued field is stated as a scalar here,
   *   whereas the committed values are `string[]` throughout (what the repository takes); seeded with
   *   a list, such a field renders empty.
   */
  payload(): Record<string, unknown> | null {
    const { metadata, ...envelope } = this.current();
    return { ...envelope, ...((metadata ?? {}) as Record<string, unknown>) };
  }

  /** What the canvas holds right now — its last report, else what it was seeded with. */
  private current(): CanvasMetadata {
    return this.latest() ?? (this.seed() as CanvasMetadata);
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
