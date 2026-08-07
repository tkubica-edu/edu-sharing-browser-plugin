import {
  afterRenderEffect, ChangeDetectionStrategy, Component, CUSTOM_ELEMENTS_SCHEMA, ElementRef,
  OnDestroy, effect, input, output, signal, viewChild
} from '@angular/core';
import { DEFAULT, HOME_REPOSITORY, Node } from 'ngx-edu-sharing-api';

import { MdsValues } from '../util/mds-values';
import { forMdsEditor, previewSrcOf } from '../util/mds-node';
import { loadWebComponentBundle } from '../services/web-component-bundle.service';

const EDITOR_TAG = 'edu-sharing-mds-editor-wrapper';

/**
 * How the wrapper renders the view group's widgets.
 *
 * - `inline` — each widget as its display value, editable by clicking it; the preview widget brings
 *   its own save for the picture, which writes straight to the node. For a node the repository
 *   holds.
 * - `nodes` — the widgets as a form, edited like any other. Nothing writes by itself; the values are
 *   reported via {@link MdsPreviewWidgetComponent.valuesChange} and committed by the caller. This is
 *   the mode for a node the repository does not have (yet).
 */
export type PreviewEditorMode = 'inline' | 'nodes' | 'form';

/**
 * MDS view group whose form contains the native `<preview>` widget.
 *
 * The widget has no element of its own: inside the MDS editor it is picked by *widget id* from the
 * view's HTML, so the way to it is a group that declares `<preview>`. `preview_sidebar_edit` is the
 * one edu-sharing uses for its own preview sidebar — a single view, so little of the form has to be
 * hidden. A metadata set without that group renders nothing at all, silently.
 */
const PREVIEW_GROUP = 'browser_extension_preview';

/** The wrapper element, typed for the inputs we set. */
interface MdsEditorElement extends HTMLElement {
  embedded?: boolean;
  editorMode?: string;
  groupId?: string;
  setId?: string;
  repository?: string;
  nodes?: Node[];
  nodeRefetch?: boolean;
}

/**
 * A node's preview as the repository itself renders it — by the native MDS preview widget rather than
 * by an `<img>`. Since that widget has no element of its own, this mounts an
 * `<edu-sharing-mds-editor-wrapper>` for the node and lets {@link PREVIEW_GROUP} decide what is on
 * screen besides the picture (its title, typically).
 *
 * It needs a node: a content the repository does not hold has none, and the caller either falls back
 * to the plain image (`CurationService.contentPreview`) or hands over a stand-in
 * (`CurationService.draftNode`).
 *
 * What the user changes here is *not* saved by this component. In `inline` mode the preview widget
 * writes the picture to the node itself; everything else is reported through {@link valuesChange} and
 * is the caller's to commit — embedded mode hides the wrapper's own save. The picture is read back by
 * {@link MdsPreviewWidgetComponent.currentPreviewSrc}, since it travels through no output at all.
 */
@Component({
  selector: 'es-mds-preview-widget',
  templateUrl: './mds-preview-widget.component.html',
  styleUrl: './mds-preview-widget.component.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class MdsPreviewWidgetComponent implements OnDestroy {
  /** The hydrated node whose preview is shown; an id alone will not do. */
  readonly node = input.required<Node>();

  /** The view group to render — see {@link PREVIEW_GROUP} for what it has to contain. */
  readonly groupId = input(PREVIEW_GROUP);

  /**
   * MDS set id; `-default-` resolves to the repository's default set. Applies to a node-less editor
   * only — with a node the wrapper takes the set from the node's own `metadataset`.
   */
  readonly setId = input(DEFAULT);

  /** How the group's widgets are rendered — see {@link PreviewEditorMode}. */
  readonly editorMode = input<PreviewEditorMode>('form');

  /**
   * The current values of the group's widgets, on every change. A SUBSET of the node's properties:
   * only what this group renders.
   */
  readonly valuesChange = output<MdsValues>();

  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');

  protected readonly bundle = loadWebComponentBundle('edu', EDITOR_TAG);

  /** True once the element is mounted, so the caller can tell "empty" from "still loading". */
  readonly ready = signal(false);

  private element: MdsEditorElement | null = null;

  private readonly onValuesChange = (event: Event): void => {
    this.valuesChange.emit((event as CustomEvent).detail as MdsValues);
  };

  /** The picture the group's preview widget currently shows — see {@link previewSrcOf}. */
  currentPreviewSrc(): string | null {
    return previewSrcOf(this.element);
  }

  constructor() {
    // Same as MdsEditorComponent: every input is set as a property BEFORE the element is appended
    // (the wrapper throws in its ngOnInit without `embedded`, and Angular Elements runs that on
    // connect, before a template's bindings would be applied). afterRenderEffect's write phase,
    // because this writes to the DOM and needs #host.
    afterRenderEffect({
      write: () => {
        if (this.bundle.ready()) this.mount();
      }
    });

    // A node often arrives twice — as announced, then hydrated — and the form is built from the
    // properties only the hydrated one has. So `nodes` is kept in sync rather than only seeded; the
    // wrapper re-initialises itself when the property changes again.
    effect(() => {
      const node = this.node();
      if (this.element) this.element.nodes = [forMdsEditor(node)];
    });
  }

  ngOnDestroy(): void {
    this.element?.removeEventListener('currentValuesChange', this.onValuesChange);
    this.element?.remove();
    this.element = null;
  }

  private mount(): void {
    if (this.element) return;
    const element = document.createElement(EDITOR_TAG) as MdsEditorElement;
    element.embedded = true;
    element.editorMode = this.editorMode();
    element.groupId = this.groupId();
    element.setId = this.setId();
    element.repository = HOME_REPOSITORY;
    // The node is already hydrated, so the wrapper must not fetch it again — and a stand-in node is
    // one the repository could not hand back at all.
    element.nodes = [forMdsEditor(this.node())];
    element.nodeRefetch = false;
    element.style.cssText = 'display:block;width:100%';
    element.addEventListener('currentValuesChange', this.onValuesChange);
    this.host().nativeElement.appendChild(element);
    this.element = element;
    this.ready.set(true);
  }
}
