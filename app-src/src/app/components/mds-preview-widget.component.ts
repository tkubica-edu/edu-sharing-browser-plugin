import {
  afterRenderEffect, ChangeDetectionStrategy, Component, CUSTOM_ELEMENTS_SCHEMA, ElementRef,
  OnDestroy, effect, inject, input, output, signal, viewChild
} from '@angular/core';
import { HOME_REPOSITORY, Node } from 'ngx-edu-sharing-api';

import { MdsValues, firstString } from '../util/mds-values';
import { forMdsEditor, previewSrcOf } from '../util/mds-node';
import {
  BrowserExtensionCustomWebComponentService
} from '../services/browser-extension-custom-web-component.service';
import { MdsSuggestion, NodeSuggestions, aiFieldsOf, aiSuggestionsFor } from '../util/mds-suggestions';
import { LICENSE_FIELDS, mapAgentFields } from '../util/agent-fields';
import { loadWebComponentBundle } from '../services/web-component-bundle.service';

const EDITOR_TAG = 'edu-sharing-mds-editor-wrapper';

/**
 * How the wrapper renders the view group's widgets.
 *
 * - `inline` — each widget as its display value, editable by clicking it; the preview widget brings
 *   its own save for the picture, which writes straight to the node. For a node the repository
 *   holds.
 * - `nodes` — the widgets as a form, edited like any other. Nothing writes by itself; the values are
 *   reported via {@link MdsPreviewWidgetComponent.valuesChange} and committed by the caller. For a
 *   node the repository holds.
 * - `form` — the same form, minus everything the wrapper only does for a node it can ask the
 *   repository about. The mode for a stand-in — see `EDITOR_MODE_FOR_DRAFT`.
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

/** The node's file name — the one field of {@link PREVIEW_GROUP} besides the picture. */
const NAME_FIELD = 'cm:name';

/** The content's title, which {@link NAME_FIELD} is derived from — see `withDerivedName`. */
const TITLE_FIELD = 'cclom:title';

/** The wrapper element, typed for the inputs we set. */
interface MdsEditorElement extends HTMLElement {
  embedded?: boolean;
  editorMode?: string;
  groupId?: string;
  setId?: string;
  repository?: string;
  nodes?: Node[];
  nodeRefetch?: boolean;
  suggestions?: NodeSuggestions[];
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
 *
 * What the metadata agent filled is handed to the group as its own KI-Vorschläge, so this form shows
 * which of its fields a machine proposed — see {@link metadata}. It matters here in particular
 * because the title and the file name are *this* group's to render: the editor below hides its own
 * widgets for them (see mds-editor.component.scss), so without this nothing would mark them.
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
   * MDS set id; `-default-` resolves to the repository's default set, `null` to the set the panel
   * itself is on (see BrowserExtensionCustomWebComponentService.metadataSet). Applies to a node-less
   * editor only — with a node the wrapper takes the set from the node's own `metadataset`.
   */
  readonly setId = input<string | null>(null);

  /** How the group's widgets are rendered — see {@link PreviewEditorMode}. */
  readonly editorMode = input<PreviewEditorMode>('form');

  /**
   * The metadata payload the node's values came from, for its `_origins` alone: the fields it
   * attributes to the metadata agent are handed to the group as KI-Vorschläge, so this form marks
   * them the way the editor below it does (see {@link aiFields}). `null` marks nothing.
   *
   * Needed as well as {@link node} because a node says nothing about where its properties came from
   * — that is what the payload carries (CurationService.editorMetadata).
   */
  readonly metadata = input<Record<string, unknown> | null>(null);

  /**
   * Locks the group: the picture and its fields stay visible but can no longer be changed. For the
   * window in which the values have left the editor and are being written (see
   * CurationService.metadataLocked) — the same lock the canvas below takes, since the two are one
   * form as far as the save is concerned: it reads this group's values too
   * (MetadataScreenComponent.previewOverrides), so a change made here mid-write would land nowhere.
   */
  readonly locked = input(false);

  /**
   * The current values of the group's widgets, on every change. A SUBSET of the node's properties:
   * only what this group renders.
   */
  readonly valuesChange = output<MdsValues>();

  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');

  private readonly webComponent = inject(BrowserExtensionCustomWebComponentService);

  protected readonly bundle = loadWebComponentBundle('edu', EDITOR_TAG);

  /** True once the element is mounted, so the caller can tell "empty" from "still loading". */
  readonly ready = signal(false);

  private element: MdsEditorElement | null = null;

  /**
   * The properties handed over as suggestions instead of as values — read once, at mount.
   *
   * A plain field rather than a signal on purpose: the effect below withholds them too, and tracking
   * them there would rebuild the form whenever the payload changed (which is what {@link node} is
   * already careful not to do).
   */
  private aiFields: readonly string[] = [];

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
    //
    // Withheld here as well: the later node carries the proposed properties again, and handing them
    // over as values would fill the widgets that were supposed to take them on as suggestions —
    // undoing the marking the mount just set up.
    effect(() => {
      const node = this.node();
      if (this.element) this.element.nodes = [this.withoutAiFields(forMdsEditor(node))];
    });
  }

  ngOnDestroy(): void {
    this.element?.removeEventListener('currentValuesChange', this.onValuesChange);
    this.element?.remove();
    this.element = null;
  }

  private mount(): void {
    if (this.element) return;
    const node = this.node();
    const element = document.createElement(EDITOR_TAG) as MdsEditorElement;
    element.embedded = true;
    element.editorMode = this.editorMode();
    element.groupId = this.groupId();
    element.setId = this.setId() ?? this.webComponent.metadataSet();
    element.repository = HOME_REPOSITORY;
    // The agent's fields as the group's own suggestions, which is what colours them — the same
    // arrangement MdsEditorComponent makes, and for the same reason it is made before the element
    // connects. Under this form's field names first, since the payload is the agent's.
    //
    // The licence is left out: it is set rather than proposed, so its widget shows a licence chosen
    // instead of one still to be accepted.
    const payload = mapAgentFields(this.metadata());
    const proposed = aiSuggestionsFor(payload, node.ref.id);
    for (const field of LICENSE_FIELDS) delete proposed?.suggestions[field];
    const suggestions = this.withDerivedName(proposed, node, payload);
    const offered = Object.keys(suggestions?.suggestions ?? {});
    if (suggestions && offered.length) {
      element.suggestions = [suggestions];
      this.aiFields = offered;
    }
    // The node is already hydrated, so the wrapper must not fetch it again — and a stand-in node is
    // one the repository could not hand back at all.
    element.nodes = [this.withoutAiFields(forMdsEditor(node))];
    element.nodeRefetch = false;
    element.style.cssText = 'display:block;width:100%';
    element.addEventListener('currentValuesChange', this.onValuesChange);
    this.host().nativeElement.appendChild(element);
    this.element = element;
    this.ready.set(true);
  }

  /**
   * The file name as a proposal of the agent's, which no payload can state itself.
   *
   * `cm:name` is the one field of {@link PREVIEW_GROUP} the metadata ever carries a value for, and
   * generated metadata never carries it: the agent produces no file name, so the name is *derived*
   * from its title (CurationService's `withTitleProperties`, RepositoryNodeService.toCreateBody).
   * It is therefore the machine's exactly when that title is — which is what this says, since
   * `_origins` only ever names fields the payload has.
   *
   * Proposed with the name the node ALREADY holds, never with the title: the two need not be equal
   * (a node written by the agent's own upload carries a name of its own), and saying where a name
   * came from must not change what it is.
   */
  private withDerivedName(
    suggestions: NodeSuggestions | null,
    node: Node,
    payload: Record<string, unknown> | null,
  ): NodeSuggestions | null {
    if (!aiFieldsOf(payload).includes(TITLE_FIELD)) return suggestions;
    const name = firstString(node.properties?.[NAME_FIELD]);
    if (!name) return suggestions;
    const derived: MdsSuggestion = {
      id: `es-ai-${NAME_FIELD}-0`,
      propertyId: NAME_FIELD,
      value: name,
      status: 'PENDING',
      type: 'AI'
    };
    return {
      nodeId: node.ref.id,
      suggestions: { ...(suggestions?.suggestions ?? {}), [NAME_FIELD]: [derived] }
    };
  }

  /**
   * The node without the properties offered as suggestions — what the form is built on.
   *
   * Withholding them is what makes the marking happen at all: a widget takes a suggestion on only
   * while its own value is empty, and colours only what it took on. So a proposed value reaches this
   * form through one door or the other, never both — see MdsEditorComponent.withoutAiFields, which
   * says what that means for a proposal the user leaves standing.
   */
  private withoutAiFields(node: Node): Node {
    if (!this.aiFields.length) return node;
    const properties = Object.fromEntries(
      Object.entries(node.properties ?? {}).filter(([key]) => !this.aiFields.includes(key)),
    );
    return { ...node, properties };
  }
}
