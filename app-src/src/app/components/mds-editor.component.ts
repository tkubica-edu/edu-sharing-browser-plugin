import {
  afterRenderEffect, ChangeDetectionStrategy, Component, CUSTOM_ELEMENTS_SCHEMA, ElementRef,
  OnDestroy, input, output, signal, viewChild
} from '@angular/core';
import { DEFAULT, HOME_REPOSITORY } from 'ngx-edu-sharing-api';

import { MdsValues, toMdsEditorValues } from '../util/mds-values';
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
}

// Embeds <edu-sharing-mds-editor-wrapper> as a REAL custom element (no iframe).
//
// The wrapper REQUIRES `embedded = true` — it throws in ngOnInit otherwise ("Non-embedded use …
// deprecated"). Angular Elements runs that ngOnInit on connect (appendChild), BEFORE an Angular
// host's template property bindings are applied, so `[embedded]="true"` in a template would be
// too late. The element is therefore created imperatively with every input set as a property
// BEFORE it is appended.
//
// In embedded mode the wrapper renders WITHOUT its own Save/Cancel: saving is driven by the
// footer, which calls commit() on this component. Angular Elements proxy inputs/outputs but not
// methods, so the edited metadata is read from the `currentValuesChange` output.
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
    // Workaround (only this case): the io form has no title/name widget, so a save can come
    // back without a cm:name. When that happens and the metadata carried a cclom:title, add
    // just that title back (the repository derives cm:name from it). No other fields merge.
    const title = this.initialValues['cclom:title'];
    if (!values['cm:name']?.length && title?.length) values['cclom:title'] = title;
    this.save.emit(values);
  }

  /** Create the element, set every input as a property, THEN append (see the class comment). */
  private mount(): void {
    if (this.element) return;
    const element = document.createElement(EDITOR_TAG) as MdsEditorElement;
    element.embedded = true;
    // Value mode: edit a free values map (no node). 'form' emits the FULL live values via
    // currentValuesChange ('nodes' mode would emit only a node diff).
    element.editorMode = 'form';
    element.groupId = this.groupId();
    element.setId = this.setId();
    element.repository = this.repository();
    // Normalize the payload into MDS values (namespaced keys → string[]), exactly as the
    // original edu-sharing-mds-editor web component did internally.
    this.initialValues = toMdsEditorValues(this.metadata());
    // Seed latestValues so a save with no edits still sends everything.
    this.latestValues = this.initialValues;
    element.currentValues = this.initialValues;
    // Sized inline, not via the stylesheet: an imperatively created element carries no view
    // encapsulation attribute, so this component's styles would not match it.
    element.style.cssText = 'display:block;width:100%;min-height:400px';
    element.addEventListener('currentValuesChange', this.onValuesChange);
    this.host().nativeElement.appendChild(element);
    this.element = element;
    this.ready.set(true);
  }
}
