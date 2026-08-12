import {
  afterRenderEffect, ChangeDetectionStrategy, Component, computed, CUSTOM_ELEMENTS_SCHEMA,
  ElementRef, OnDestroy, inject, input, output, signal, viewChild
} from '@angular/core';
import { HOME_REPOSITORY, Node } from 'ngx-edu-sharing-api';

import { MdsValues, toMdsEditorValues } from '../util/mds-values';
import { NodeSuggestions, aiSuggestionsFor } from '../util/mds-suggestions';
import { EDITOR_MODE_FOR_DRAFT, forMdsEditor, isDraftNode } from '../util/mds-node';
import { LICENSE_FIELDS, mapAgentFields } from '../util/agent-fields';
import { MetadataEditor, MetadataSeed } from './metadata-editor';
import {
  BrowserExtensionCustomWebComponentService
} from '../services/browser-extension-custom-web-component.service';
import { loadWebComponentBundle } from '../services/web-component-bundle.service';

const EDITOR_TAG = 'edu-sharing-mds-editor-wrapper';

/** The <edu-sharing-mds-editor-wrapper> element, typed for the inputs we set. */
interface MdsEditorElement extends HTMLElement {
  embedded?: boolean;
  currentValues?: MdsValues;
  groupId?: string;
  setId?: string;
  repository?: string;
  editorMode?: string;
  nodes?: Node[];
  nodeRefetch?: boolean;
  suggestions?: NodeSuggestions[];
}

// Embeds <edu-sharing-mds-editor-wrapper> as a REAL custom element (no iframe).
//
// The wrapper REQUIRES `embedded = true` — it throws in ngOnInit otherwise. Angular Elements runs
// that ngOnInit on connect (appendChild), BEFORE a host template's property bindings are applied,
// so `[embedded]="true"` in a template would be too late: the element is created imperatively with
// every input set as a property BEFORE it is appended.
//
// In embedded mode the wrapper renders WITHOUT its own Save/Cancel: saving is driven by the
// footer, which calls commit() on this component. Angular Elements proxy inputs/outputs but not
// methods, so the edited metadata is read from the `currentValuesChange` output.
//
// It runs on a NODE where the caller has one ({@link node}) and on a plain values map otherwise. The
// difference is not cosmetic: some of the group's native widgets ask the editor for a node and hide
// themselves outright when there is none, so a value-mode editor renders less of the view than a
// node-mode one, however much of the metadata it is handed.
//
// Three of the view's widgets are hidden by this component's stylesheet, because the screen shows them
// above the form already — see mds-editor.component.scss.
//
// What the metadata agent filled is handed to the editor as its own KI-Vorschläge rather than as
// plain values, so the form shows which fields a machine proposed — see {@link aiFields}.
@Component({
  selector: 'es-mds-editor',
  templateUrl: './mds-editor.component.html',
  styleUrl: './mds-editor.component.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class MdsEditorComponent implements MetadataEditor, OnDestroy {
  /** The metadata payload (raw agent output or a node's properties). */
  readonly metadata = input.required<MetadataSeed>();

  /**
   * The node the group's widgets work on, when the content has one to hand over (a stand-in counts —
   * see CurationService.editorNode). With it the editor runs in `nodes` mode, which is what the
   * native widgets need: several of them declare `requiresNode` and are hidden outright without one.
   *
   * `null` falls back to the value mode below, so callers that only have a payload are unaffected.
   */
  readonly node = input<Node | null>(null);
  /** MDS view group to render. */
  readonly groupId = input('io');
  /** Repository/app id the set lives in. */
  readonly repository = input(HOME_REPOSITORY);
  /**
   * MDS set id; `-default-` resolves to the repository's default set. `null` takes the set the panel
   * itself is on (see BrowserExtensionCustomWebComponentService.metadataSet), which is what every
   * caller so far wants.
   */
  readonly setId = input<string | null>(null);

  /** Emits the current edited values when the footer triggers a save. */
  readonly save = output<MdsValues>();

  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');

  private readonly webComponent = inject(BrowserExtensionCustomWebComponentService);

  protected readonly bundle = loadWebComponentBundle('edu', EDITOR_TAG);

  /** True once the element is mounted and can be committed. */
  readonly ready = signal(false);

  /**
   * The properties the metadata agent filled, handed to the editor as suggestions instead of as
   * values — empty when the seed names none (a node the panel did not curate), and in value mode,
   * where the widgets do not subscribe to suggestions at all (see mount()).
   *
   * They have to be *withheld* from the seed for the marking to happen: a widget only takes a
   * suggestion on while its own value is empty, and colours only what it took on. So a proposed
   * value reaches the form through one door or the other, never both.
   */
  private readonly aiFields = signal<readonly string[]>([]);

  /** Whether the form carries KI-Vorschläge — the note above it says what that means for them. */
  protected readonly hasAiSuggestions = computed(() => this.aiFields().length > 0);

  private element: MdsEditorElement | null = null;
  /** The full normalized metadata handed to the editor (all generated fields). */
  private initialValues: MdsValues = {};
  /**
   * The view's widget values from currentValuesChange — a SUBSET, because the io form has no
   * widget for every generated field (e.g. cclom:title).
   */
  private latestValues: MdsValues = {};

  private readonly onValuesChange = (event: Event): void => {
    this.latestValues = (event as CustomEvent).detail as MdsValues;
  };

  constructor() {
    // Mount as soon as the bundle defined the tag. afterRenderEffect (write phase), not effect:
    // this writes to the DOM and needs the #host element, which a plain effect would run before.
    // The metadata is read once, at mount time.
    afterRenderEffect({
      write: () => {
        if (this.bundle.ready()) this.mount();
      }
    });
  }

  ngOnDestroy(): void {
    this.element?.removeEventListener('currentValuesChange', this.onValuesChange);
    this.element?.remove();
    this.element = null;
  }

  /**
   * Called by the footer's save action (Angular Elements don't proxy methods, so the host
   * reaches in here rather than into the wrapped element).
   */
  commit(): void {
    const values: MdsValues = { ...this.latestValues };
    // The io form has no title/name widget, so the emitted values can come back without a
    // cm:name. In that case the seeded cclom:title is added back and the repository derives
    // cm:name from it. This is the only field ever merged back in.
    const title = this.initialValues['cclom:title'];
    if (!values['cm:name']?.length && title?.length) values['cclom:title'] = title;
    // Mapped on the way out too: what comes back is the rendered group's widget values, and the group
    // has no widget for the licence flags at all — unmapped they would be dropped instead of written.
    this.save.emit(toMdsEditorValues(mapAgentFields(values)));
  }

  /** Create the element, set every input as a property, THEN append (see the class comment). */
  private mount(): void {
    if (this.element) return;
    const element = document.createElement(EDITOR_TAG) as MdsEditorElement;
    element.embedded = true;
    element.groupId = this.groupId();
    element.setId = this.setId() ?? this.webComponent.metadataSet();
    element.repository = this.repository();
    // Under this form's field names first: the payload is the agent's, and only this form needs them
    // renamed — the WLO canvas takes them as they come (see `mapAgentFields`).
    const metadata = mapAgentFields(this.metadata());
    // Normalize the payload into MDS values (namespaced keys → string[]) — the shape the wrapper
    // expects `currentValues` in. Kept even in node mode: commit() reads the seeded title back out
    // of it, and the emitted values are only ever the rendered group's subset.
    this.initialValues = toMdsEditorValues(metadata);
    // Seed latestValues so a save with no edits still sends everything.
    this.latestValues = this.initialValues;

    const node = this.node();
    // The agent's fields, as the editor's own suggestions. Node mode only: the fan-out that hands a
    // suggestion to its widget is set up in `initWithNodes`, so a form built on a values map never
    // sees them (`nodes` is what decides that, not `editorMode` — a draft's form is built on its
    // stand-in node too). Set before the element connects, like every other input.
    const suggestions = node ? aiSuggestionsFor(metadata, node.ref.id) : null;
    // The licence is set rather than proposed: dropping it from the offer is what keeps it on the node,
    // so its widget shows a licence chosen instead of one to accept first.
    for (const field of LICENSE_FIELDS) delete suggestions?.suggestions[field];
    const offered = Object.keys(suggestions?.suggestions ?? {});
    if (suggestions && offered.length) {
      element.suggestions = [suggestions];
      this.aiFields.set(offered);
    }
    if (node) {
      // Node mode. Both modes emit the FULL live values of the rendered group via
      // currentValuesChange (the instance maps every widget's value, not a diff against the node),
      // so commit() and the save path are the same either way.
      // A stand-in renders in the draft's mode: the form is the same, but the wrapper stops asking
      // the repository about a node it does not have, and the group's native widgets fall back to
      // what they can do without one (see EDITOR_MODE_FOR_DRAFT).
      element.editorMode = isDraftNode(node) ? EDITOR_MODE_FOR_DRAFT : 'nodes';
      // Without the proposed properties: they arrive as suggestions instead (see aiFields), and a
      // widget that already holds the value would neither offer nor mark it. Withheld AFTER the
      // mapping, which reads the agent's fields to fill the form's own from them.
      element.nodes = [this.withoutAiFields(forMdsEditor(node))];
      // The node is already in hand, and a stand-in is one the repository could not hand back at
      // all — re-fetching it would fail rather than improve anything.
      element.nodeRefetch = false;
    } else {
      // Value mode: a free values map, for a caller that has no node to give.
      element.editorMode = 'form';
      element.currentValues = this.initialValues;
    }
    // Sized inline, not via the stylesheet: an imperatively created element carries no view
    // encapsulation attribute, so this component's styles would not match it.
    element.style.cssText = 'display:block;width:100%;min-height:400px';
    element.addEventListener('currentValuesChange', this.onValuesChange);
    this.host().nativeElement.appendChild(element);
    this.element = element;
    this.ready.set(true);
  }

  /**
   * The node without the properties that are offered as suggestions — what the form is built on.
   *
   * Nothing is lost by it: a suggestion a single-value widget can take is applied by that widget the
   * moment the form is built, and one that is left standing (a chip the user does not press) simply
   * never becomes a value — which for a *saved* node means the stored one stays, since the editor
   * reports only the widgets that changed. A draft has nothing stored, so an ignored proposal is one
   * the content is saved without; the note above the form says as much.
   */
  private withoutAiFields(node: Node): Node {
    const withheld = this.aiFields();
    if (!withheld.length) return node;
    const properties = Object.fromEntries(
      Object.entries(node.properties ?? {}).filter(([key]) => !withheld.includes(key)),
    );
    return { ...node, properties };
  }
}
