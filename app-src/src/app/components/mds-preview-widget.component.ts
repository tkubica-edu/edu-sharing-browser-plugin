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
 * The widget is not addressable on its own — the edu bundle registers 13 custom elements and none of
 * them is a preview editor, and inside the MDS editor the widget is picked by *widget id* from the
 * form's own view HTML (`nativeWidgets = {preview, author, version, license, …}`). So the way to it
 * is a group whose view declares `<preview>`.
 *
 * `preview_sidebar_edit` is that group — the one edu-sharing renders in its own preview sidebar. It
 * is a single view (`node_general`) that opens with `<preview>`, which keeps the rest of the form
 * that has to be hidden as small as possible. Verified against the staging repository's `mds_oeh`:
 * the other candidates that *declare* the widget (`io`, `___old_io`, `collection`) render nothing at
 * all here, so this is not a matter of taste.
 *
 * A repository whose metadata set has no such group renders nothing — silently, which is why the
 * caller has to treat this widget as a bonus and never as the only picture (see the class comment).
 */
const PREVIEW_GROUP = 'preview_sidebar_edit';

/**
 * The node in the shape the MDS machinery requires, which is stricter than the `Node` type says.
 *
 * Every widget builds its initial value by reducing over the property it is bound to, and that
 * reduction calls `.filter()` on the value — so a property that is a bare string throws
 * `o.filter is not a function` inside the bundle and the whole form (the preview included) fails to
 * render. The app does hand out such nodes: a content the repository will not return is substituted
 * by a stand-in built from the metadata agent's payload, whose values are scalars (see
 * `CurationService.applyStoredEntry` / `toPartialNode`).
 *
 * So the node is normalised here rather than trusted: `toMdsEditorValues` is exactly this coercion
 * (namespaced keys, every value a `string[]`), and it drops the agent's envelope keys (`_origins`,
 * `_source_text`) on the way, which are not node properties to begin with. `aspects` and `access`
 * are reduced over in the same way, so an absent one is turned into an empty list.
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
 * The repository's own preview of a node, rendered by the **native MDS preview widget** rather than
 * by an `<img>` of ours.
 *
 * There is no element for that widget, so this mounts a second `<edu-sharing-mds-editor-wrapper>`
 * for the node — read-only (`editorMode: 'viewer'`) and on the group whose view declares
 * `<preview>` — and the stylesheet keeps only that widget of the rendered form. That is the whole
 * trick: the form is rendered, and all of it but the picture is hidden.
 *
 * Consequences worth knowing before using this anywhere else:
 *
 * - **It needs a node.** The widget reads `node.preview`, so a curated content that has not been
 *   saved yet has nothing to show here — that case is what `CurationService.contentPreview` and the
 *   plain `<img>` around it are for.
 * - **Read-only on purpose.** The widget's editing affordances (upload, clipboard, from-search,
 *   delete) write through the wrapper's own save, which embedded mode hides and Angular Elements
 *   cannot reach (they proxy inputs and outputs, not methods). Offering them would offer changes
 *   that cannot be saved.
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

    // A node often arrives twice: first as it came with whatever announced it, then hydrated (see
    // CurationService.hydrateActiveNode) — and the form is built from the node's properties, which
    // only the hydrated one has. So the element's `nodes` is kept in sync rather than only seeded:
    // Angular Elements proxy input *properties*, and the wrapper re-initialises itself when `nodes`
    // changes after the first time (its own ngOnChanges).
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
    // 'viewer': the form renders what the node has, and no widget offers an edit — see the class
    // comment on why editing cannot be saved from here.
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
