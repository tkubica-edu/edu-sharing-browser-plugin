import {
  ChangeDetectionStrategy, Component, CUSTOM_ELEMENTS_SCHEMA, computed, input, linkedSignal,
  output, signal
} from '@angular/core';

import { MdsValues, toMdsEditorValues } from '../../../util/mds-values';
import { loadWebComponentBundle } from '../../../services/web-component-bundle.service';
import { MetadataEditor, MetadataSeed } from '../../../model/metadata-editor';

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
 * The two presets the bundle documents for embedded use, kept verbatim so they stay comparable with that
 * reference. `highlightAi` is this plugin's addition: the agent's fields are marked where they can also be
 * corrected, and a read-only view has nothing to ask.
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

// The WLO metadata canvas as a real custom element. While the browser extension custom web component is
// enabled it replaces both the edu-sharing MDS editor (mode 'edit') and the preview element (mode 'detail').
// In 'edit' mode its own save and upload buttons stay hidden: the footer owns "Speichern" and commit() hands
// over the values, which arrive continuously via `metadataChange`.
@Component({
  selector: 'es-wlo-canvas',
  templateUrl: './wlo-canvas.component.html',
  styleUrl: './wlo-canvas.component.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class WloCanvasComponent implements MetadataEditor {
  /**
   * The metadata payload to load. The canvas takes the metadata-agent payload as it is, so an analysis result
   * and a node's stored properties both work. Its `_origins` decide which fields count as the agent's — a
   * payload without them marks every filled field as generated.
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
   * A page the canvas should erschließen itself on mount, handed over as `url` + `inputMode="url"` with
   * `autoExtract`. Empty means nothing to extract, so the form shows only what it was seeded with.
   */
  readonly sourceUrl = input('');

  /** Emits the current values when the footer triggers a save (mode 'edit'). */
  readonly save = output<MdsValues>();

  /**
   * What the element is actually seeded with: the first payload the input carried, held for as long as this
   * component is mounted. The canvas reloads its whole state whenever that input changes, and saving does
   * change the payload's source — so without the freeze the editor would visibly reload after "Speichern".
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
   * The canvas' own export, flattened into the shape it is seeded from — what the metadata is re-read from
   * after a save. It carries what the committed values cannot: the envelope (`metadataset` above all, which
   * the content type is resolved from) and every value in the shape its field has.
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
