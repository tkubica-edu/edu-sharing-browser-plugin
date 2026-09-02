import {
  afterRenderEffect, ChangeDetectionStrategy, Component, CUSTOM_ELEMENTS_SCHEMA, ElementRef,
  OnDestroy, OnInit, inject, input, output, signal, viewChild
} from '@angular/core';
import { HOME_REPOSITORY, Node } from 'ngx-edu-sharing-api';

import { MdsValues, firstString, toMdsEditorValues } from '../../../util/mds-values';
import { sourceTextOf } from '../../../util/agent-payload';
import { NodeSuggestions, aiSuggestionsFor } from '../../../util/mds-suggestions';
import { TEXT_VARIABLE_MAX } from '../../../services/mds-ai-suggestion.service';
import { EDITOR_MODE_FOR_DRAFT, forMdsEditor, isDraftNode } from '../../../util/mds-node';
import { LICENSE_FIELDS, mapAgentFields } from '../../../util/agent-fields';
import { MetadataEditor, MetadataSeed } from '../../../model/metadata-editor';
import {
  BrowserExtensionCustomWebComponentService
} from '../../../services/browser-extension-custom-web-component.service';
import { MdsAiSuggestionService, SuggestionVariables } from '../../../services/mds-ai-suggestion.service';
import { SuggestionService } from '../../../services/suggestion.service';
import { loadWebComponentBundle } from '../../../services/web-component-bundle.service';

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

// Embeds <edu-sharing-mds-editor-wrapper> as a real custom element. It requires `embedded = true` and reads it in
// ngOnInit, which Angular Elements runs on append, so the element is created imperatively with its inputs already
// set; the footer then drives commit() and the values are read from `currentValuesChange`, since Angular Elements
// proxies no methods. It runs on a node where the caller has one and on a plain values map otherwise, which
// renders less of the view. What the agent filled is handed over as KI-Vorschläge — the ones the repository
// stores for the node where it has them, the run's own findings otherwise (see {@link loadSuggestions}), and
// on a node the repository is first asked to generate what nothing has answered yet (see
// {@link generateSuggestions}).
@Component({
  selector: 'es-mds-editor',
  templateUrl: './mds-editor.component.html',
  styleUrl: './mds-editor.component.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class MdsEditorComponent implements MetadataEditor, OnInit, OnDestroy {
  /** The metadata payload (raw agent output or a node's properties). */
  readonly metadata = input.required<MetadataSeed>();

  /**
   * The node the group's widgets work on, where the content has one to hand over; a stand-in counts. With it
   * the editor runs in `nodes` mode, which the native widgets need. Null falls back to value mode.
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

  // Reads the node's proposals out of the repository — see {@link loadSuggestions}.
  private readonly suggestions = inject(SuggestionService);

  // Has the repository generate what is still missing, before the proposals are read — see
  // {@link generateSuggestions}.
  private readonly aiSuggestions = inject(MdsAiSuggestionService);

  protected readonly bundle = loadWebComponentBundle('edu', EDITOR_TAG);

  /** True once the element is mounted and can be committed. */
  readonly ready = signal(false);

  /**
   * The properties the agent filled, handed to the editor as suggestions instead of as values; empty where the
   * seed names none and in value mode, whose widgets do not subscribe to suggestions. They have to be withheld
   * from the seed for the marking to happen: a widget takes a suggestion on only while its value is empty.
   */
  private readonly aiFields = signal<readonly string[]>([]);

  /**
   * The node's stored proposals, once the repository has answered about them; null where it holds none.
   * Read before the form is built, because whether a field is offered decides whether it is a value.
   */
  private readonly storedSuggestions = signal<NodeSuggestions | null>(null);

  /**
   * What the repository's generation run reports it proposed; null where none was made. The offer for a
   * store that will not hand its proposals back — the run wrote them, so it knows them.
   */
  private readonly generatedSuggestions = signal<NodeSuggestions | null>(null);

  /** The repository has been asked — the mount waits for this, whatever the answer was. */
  private readonly suggestionsRead = signal(false);

  /** While the repository is generating the missing fields, so the wait says what is being waited for. */
  protected readonly generating = signal(false);

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
        if (this.bundle.ready() && this.suggestionsRead()) this.mount();
      }
    });
  }

  ngOnInit(): void {
    void this.loadSuggestions();
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

  /**
   * Take over what the repository proposes for this node — written when the content was created (see
   * CurationService.createContent). A draft has no node to carry proposals, and a repository that cannot
   * answer leaves none: either way the mount goes on with the run's own findings instead.
   */
  private async loadSuggestions(): Promise<void> {
    const node = this.node();
    if (node && !isDraftNode(node)) {
      this.generatedSuggestions.set(await this.generateSuggestions(node.ref.id));
      this.storedSuggestions.set(await this.suggestions.load(node.ref.id));
    }
    this.suggestionsRead.set(true);
  }

  /**
   * Have the repository fill what the content does not say about itself yet, before the form is built from
   * what it does: the metadata set's own generation over the fields of this form it can generate, run on
   * this node and given what the content already states — its title and the text it was read off (see
   * MdsAiSuggestionService). What comes back is stored on the node, so it is read by the load behind this.
   *
   * Awaited rather than started: a form built while the run is still going would offer none of it, and the
   * step exists to describe the content, not to be walked past. Nothing hangs on the outcome.
   */
  private async generateSuggestions(nodeId: string): Promise<NodeSuggestions | null> {
    const variables = this.suggestionVariables();
    if (!Object.keys(variables).length) return null;
    this.generating.set(true);
    try {
      return await this.aiSuggestions.generate(nodeId, this.groupId(), variables);
    } finally {
      this.generating.set(false);
    }
  }

  /**
   * What the generation is given to work from: what the content is called and what its page says. Both are
   * left out where the content has neither — a run given nothing to read has nothing to write.
   */
  private suggestionVariables(): SuggestionVariables {
    const metadata = this.metadata();
    const title = firstString(mapAgentFields(metadata)['cclom:title']);
    const text = sourceTextOf(metadata);
    return {
      ...(title ? { 'cclom:title': [title] } : {}),
      ...(text ? { textContent: [text.slice(0, TEXT_VARIABLE_MAX)] } : {})
    };
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
    // The node's proposals, as the editor's own suggestions: what the repository stores for it, else the
    // run's findings for a content it holds none of. Handed in either way — the wrapper reads the stored
    // ones itself, but only this input turns the widgets' KI marking on.
    //
    // Node mode only: the fan-out that hands a suggestion to its widget is set up in `initWithNodes`, so a
    // form built on a values map never sees them (`nodes` is what decides that, not `editorMode` — a
    // draft's form is built on its stand-in node too). Set before the element connects, like every other
    // input.
    // What the repository stores for the node leads: those carry the ids an acceptance is recorded under.
    // Behind it what the run itself reported, for a store that will not hand its proposals back, and last
    // the findings of the panel's own Erschließung — which only a `/generate` result has.
    const suggestions = node
      ? this.storedSuggestions() ??
        this.generatedSuggestions() ??
        aiSuggestionsFor(metadata, node.ref.id)
      : null;
    // The licence is set rather than proposed: dropping it from the offer is what keeps it on the node,
    // so its widget shows a licence chosen instead of one to accept first.
    for (const field of LICENSE_FIELDS) delete suggestions?.suggestions[field];
    const offered = Object.keys(suggestions?.suggestions ?? {});
    if (suggestions && offered.length) {
      element.suggestions = [suggestions];
      this.aiFields.set(offered);
    }
    if (node) {
      // Node mode. Both modes emit the full live values of the rendered group, so commit() and the save path are
      // the same either way. A stand-in renders in the draft's mode: same form, but the wrapper stops asking the
      // repository about a node it does not have (see EDITOR_MODE_FOR_DRAFT).
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
   * The node without the properties offered as suggestions — what the form is built on. Nothing is lost: a
   * suggestion a single-value widget can take is applied as the form is built, and one left standing never
   * becomes a value, so a saved node keeps what it stored while a draft is saved without it.
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
