import {
  afterRenderEffect, ChangeDetectionStrategy, Component, CUSTOM_ELEMENTS_SCHEMA, ElementRef,
  OnDestroy, effect, input, signal, viewChild
} from '@angular/core';
import { DEFAULT, HOME_REPOSITORY, Node } from 'ngx-edu-sharing-api';

import { toMdsEditorValues } from '../util/mds-values';
import { loadWebComponentBundle } from '../services/web-component-bundle.service';

const EDITOR_TAG = 'edu-sharing-mds-editor-wrapper';

/**
 * MDS view group whose form contains the native `<preview>` widget.
 *
 * The widget has no element of its own: inside the MDS editor it is picked by *widget id* from the
 * view's HTML, so the way to it is a group that declares `<preview>`. `preview_sidebar_edit` is the
 * one edu-sharing uses for its own preview sidebar — a single view, so little of the form has to be
 * hidden. A metadata set without that group renders nothing at all, silently.
 */
const PREVIEW_GROUP = 'preview_sidebar_edit';

/**
 * The node in the shape the MDS machinery requires, which is stricter than the `Node` type says: every
 * widget reduces over the property it is bound to and calls `.filter()` on the value, so a scalar
 * property throws inside the bundle and the whole form fails to render. The app does hand out such
 * nodes — a content the repository will not return is substituted by a stand-in built from the agent's
 * payload (`CurationService.applyStoredEntry`). `aspects` and `access` are reduced over likewise.
 */
function forMdsEditor(node: Node): Node {
  return {
    ...node,
    properties: toMdsEditorValues(node.properties),
    aspects: node.aspects ?? [],
    access: node.access ?? []
  };
}

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
 * The repository's own preview of a node, rendered by the native MDS preview widget rather than by an
 * `<img>`. Since that widget has no element, this mounts a second `<edu-sharing-mds-editor-wrapper>`
 * read-only for the node and the stylesheet hides everything of the form but the picture.
 *
 * Two limits: it needs a node (a content not yet saved has none — that is what
 * `CurationService.contentPreview` covers), and it stays read-only, because the widget's upload and
 * delete write through the wrapper's own save, which embedded mode hides.
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

  /** MDS set id; `-default-` resolves to the repository's default set. */
  readonly setId = input(DEFAULT);

  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');

  protected readonly bundle = loadWebComponentBundle('edu', EDITOR_TAG);

  /** True once the element is mounted, so the caller can tell "empty" from "still loading". */
  readonly ready = signal(false);

  private element: MdsEditorElement | null = null;

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
    this.element?.remove();
    this.element = null;
  }

  private mount(): void {
    if (this.element) return;
    const element = document.createElement(EDITOR_TAG) as MdsEditorElement;
    element.embedded = true;
    // 'viewer': the form renders what the node has and no widget offers an edit (see the class doc).
    element.editorMode = 'viewer';
    element.groupId = this.groupId();
    element.setId = this.setId();
    element.repository = HOME_REPOSITORY;
    // The node is already hydrated, so the wrapper must not fetch it again.
    element.nodes = [forMdsEditor(this.node())];
    element.nodeRefetch = false;
    element.style.cssText = 'display:block;width:100%';
    this.host().nativeElement.appendChild(element);
    this.element = element;
    this.ready.set(true);
  }
}
