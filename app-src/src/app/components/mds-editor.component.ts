import {
  afterRenderEffect, ChangeDetectionStrategy, Component, CUSTOM_ELEMENTS_SCHEMA, ElementRef,
  OnDestroy, input, output, signal, viewChild
} from '@angular/core';
import { DEFAULT, HOME_REPOSITORY, Node } from 'ngx-edu-sharing-api';

import { MdsValues, toMdsEditorValues } from '../util/mds-values';
import { forMdsEditor, previewSrcOf } from '../util/mds-node';
import { MetadataEditor, MetadataSeed } from './metadata-editor';
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
// difference is not cosmetic: the group's native widgets ask the editor for a node, and `<preview>`
// hides itself outright when there is none — which is why a value-mode editor never shows a picture,
// however much of the metadata it is handed.
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
   * native widgets need: `<preview>` declares `requiresNode` and is hidden outright without one.
   *
   * `null` falls back to the value mode below, so callers that only have a payload are unaffected.
   */
  readonly node = input<Node | null>(null);
  /** MDS view group to render. */
  readonly groupId = input('io');
  /** Repository/app id the set lives in. */
  readonly repository = input(HOME_REPOSITORY);
  /** MDS set id; `-default-` resolves to the repository's default set. */
  readonly setId = input(DEFAULT);

  /** Emits the current edited values when the footer triggers a save. */
  readonly save = output<MdsValues>();

  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');

  protected readonly bundle = loadWebComponentBundle('edu', EDITOR_TAG);

  /** True once the element is mounted and can be committed. */
  readonly ready = signal(false);

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
    this.save.emit(values);
  }

  /**
   * The picture the group's preview widget currently shows — see {@link previewSrcOf}. Only ever
   * non-null in node mode, since that is the only mode the widget renders in at all.
   */
  currentPreviewSrc(): string | null {
    return previewSrcOf(this.element);
  }

  /** Create the element, set every input as a property, THEN append (see the class comment). */
  private mount(): void {
    if (this.element) return;
    const element = document.createElement(EDITOR_TAG) as MdsEditorElement;
    element.embedded = true;
    element.groupId = this.groupId();
    element.setId = this.setId();
    element.repository = this.repository();
    // Normalize the payload into MDS values (namespaced keys → string[]) — the shape the wrapper
    // expects `currentValues` in. Kept even in node mode: commit() reads the seeded title back out
    // of it, and the emitted values are only ever the rendered group's subset.
    this.initialValues = toMdsEditorValues(this.metadata());
    // Seed latestValues so a save with no edits still sends everything.
    this.latestValues = this.initialValues;

    const node = this.node();
    if (node) {
      // Node mode. Both modes emit the FULL live values of the rendered group via
      // currentValuesChange (the instance maps every widget's value, not a diff against the node),
      // so commit() and the save path are the same either way.
      element.editorMode = 'nodes';
      element.nodes = [forMdsEditor(node)];
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
}
