import {
  afterRenderEffect, ChangeDetectionStrategy, Component, CUSTOM_ELEMENTS_SCHEMA, ElementRef,
  OnDestroy, effect, inject, input, output, signal, viewChild
} from '@angular/core';
import { HOME_REPOSITORY, Node } from 'ngx-edu-sharing-api';

import { MdsValues, firstString } from '../../../util/mds-values';
import { forMdsEditor, previewSrcOf } from '../../../util/mds-node';
import {
  BrowserExtensionCustomWebComponentService
} from '../../../services/browser-extension-custom-web-component.service';
import { MdsSuggestion, NodeSuggestions, aiFieldsOf, aiSuggestionsFor } from '../../../util/mds-suggestions';
import { LICENSE_FIELDS, mapAgentFields } from '../../../util/agent-fields';
import { loadWebComponentBundle } from '../../../services/web-component-bundle.service';
import { ImageTo3dComponent } from '../image-to-3d/image-to-3d.component';

const EDITOR_TAG = 'edu-sharing-mds-editor-wrapper';

/**
 * How the wrapper renders the view group's widgets: `inline` shows display values editable by click and
 * lets the preview widget write the picture itself, `nodes` renders a form whose values the caller
 * commits, and `form` is that same form without the parts that need a node the repository holds.
 */
export type PreviewEditorMode = 'inline' | 'nodes' | 'form';

/**
 * MDS view group whose form contains the native `<preview>` widget. The widget has no element of its
 * own — it is picked by widget id from the view's HTML — so the way to it is a group that declares it.
 * A metadata set without that group renders nothing at all, silently.
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
 * A node's preview as the repository renders it: the native preview widget has no element of its own, so
 * this mounts an `<edu-sharing-mds-editor-wrapper>` and lets {@link PREVIEW_GROUP} decide what else is on
 * screen. Nothing is saved here but the picture in `inline` mode; values go out via {@link valuesChange}.
 */
@Component({
  selector: 'es-mds-preview-widget',
  imports: [ImageTo3dComponent],
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
   * The payload the node's values came from, for its `_origins` alone: the fields it attributes to the
   * agent are handed to the group as KI-Vorschläge. Needed as well as {@link node}, since a node says
   * nothing about where its properties came from.
   */
  readonly metadata = input<Record<string, unknown> | null>(null);

  /**
   * Locks the group while the values are being written: the same lock the canvas below takes, since the
   * save reads this group's values too and a change made mid-write would land nowhere.
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
   * The properties handed over as suggestions instead of as values, read once at mount. A plain field
   * rather than a signal: tracking it in the effect below would rebuild the form on every payload change.
   */
  private aiFields: readonly string[] = [];

  private readonly onValuesChange = (event: Event): void => {
    this.valuesChange.emit((event as CustomEvent).detail as MdsValues);
  };

  /** The picture the group's preview widget currently shows — see {@link previewSrcOf}. */
  currentPreviewSrc(): string | null {
    return previewSrcOf(this.element);
  }

  /**
   * Hands the picture's address to the 3D conversion below the widget, as a function rather than a
   * value: the widget draws the picture itself, so there is an address only once it has, and it changes
   * again with every redraw.
   */
  protected readonly previewSource = (): string | null => this.currentPreviewSrc();

  /** The content's name, which the 3D model is named after. */
  protected contentName(): string | null {
    const node = this.node();
    return node.name ?? firstString(node.properties?.[NAME_FIELD]);
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

    // A node often arrives twice — announced, then hydrated — and the form is built from the properties
    // only the hydrated one has, so `nodes` is kept in sync. The proposed properties stay withheld: as
    // values they would fill the very widgets that were to take them on as suggestions.
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
    // The agent's fields as the group's own suggestions, which is what colours them; set before the
    // element connects, and under this form's field names. The licence is left out — it is set rather
    // than proposed, so its widget shows a licence chosen instead of one still to be accepted.
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
   * The file name as a proposal of the agent's, which no payload can state itself: the agent produces no
   * file name, so it is derived from its title and is the machine's exactly when that title is. Proposed
   * with the name the node already holds — saying where a name came from must not change what it is.
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
   * The node without the properties offered as suggestions — what the form is built on. Withholding them
   * is what makes the marking happen: a widget takes a suggestion on only while its own value is empty,
   * and colours only what it took on.
   */
  private withoutAiFields(node: Node): Node {
    if (!this.aiFields.length) return node;
    const properties = Object.fromEntries(
      Object.entries(node.properties ?? {}).filter(([key]) => !this.aiFields.includes(key)),
    );
    return { ...node, properties };
  }
}
