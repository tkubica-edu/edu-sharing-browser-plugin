import {
  Component, CUSTOM_ELEMENTS_SCHEMA, ElementRef, EventEmitter, Input, OnDestroy, Output, ViewChild,
  signal, inject
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { DEFAULT, HOME_REPOSITORY } from 'ngx-edu-sharing-api';

import { AuthService } from '../services/auth.service';
import { EduBundleService } from '../services/edu-bundle.service';
import { toApiRootUrl } from '../config';
import { GeneratedMetadataPayload, valuesFromGeneratedMetadata } from '../util/values-from-payload';

// The <edu-sharing-mds-editor-wrapper> element, typed for the inputs we set.
interface MdsWrapperElement extends HTMLElement {
  embedded?: boolean;
  currentValues?: Record<string, string[]>;
  groupId?: string;
  setId?: string;
  repository?: string;
  editorMode?: string;
}

// Embeds <edu-sharing-mds-editor-wrapper> as a REAL custom element (no iframe).
//
// The wrapper REQUIRES `embedded = true` — it throws in ngOnInit otherwise ("Non-
// embedded use … deprecated"). Angular Elements runs that ngOnInit on connect
// (appendChild), BEFORE an Angular host's template property bindings are applied, so
// `[embedded]="true"` in a template is too late. We therefore create the element
// imperatively and set all inputs as properties BEFORE appending it (the same order
// the old iframe bridge used).
//
// In embedded mode the wrapper renders WITHOUT its own Save/Cancel. Saving is driven
// by the wizard footer, which calls commit() on this component. Angular Elements only
// proxy inputs/outputs (not methods), so edited metadata is read from the
// `currentValuesChange` output (kept in `latestValues`).
@Component({
  selector: 'es-mds-editor',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './mds-editor.component.html',
  styleUrl: './mds-editor.component.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA]
})
export class MdsEditorComponent implements OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly bundle = inject(EduBundleService);

  /** The generated-metadata payload (raw /generate output or a node's properties). */
  @Input() metadata: unknown;
  /** MDS view group to render. */
  @Input() groupId = 'io';
  /** Repository/app id the set lives in (matches the reference component's default). */
  @Input() repository = HOME_REPOSITORY;
  /** MDS set id; `-default-` resolves to the repository's default set. */
  @Input() setId = DEFAULT;

  /** Emits the current edited values when the wizard footer triggers a save. */
  @Output() save = new EventEmitter<Record<string, string[]>>();

  @ViewChild('host', { static: true }) private hostRef!: ElementRef<HTMLElement>;

  /** True once the bundle is loaded and the element is mounted. */
  readonly ready = signal(false);
  readonly error = signal<string | null>(null);

  private el?: MdsWrapperElement;
  // The full normalized metadata handed to the editor (all generated fields).
  private initialValues: Record<string, string[]> = {};
  // The view's widget values from currentValuesChange (a SUBSET — the io form has no
  // widget for every generated field, e.g. cclom:title).
  private latestValues: Record<string, string[]> | null = null;
  private readonly onValues = (e: Event): void => {
    this.latestValues = (e as CustomEvent).detail as Record<string, string[]>;
  };

  constructor() {
    const api = toApiRootUrl(this.auth.state().repositoryUrl);
    this.bundle
      .load(api)
      .then(() => customElements.whenDefined('edu-sharing-mds-editor-wrapper'))
      .then(() => this.mount())
      .catch((e: unknown) => this.error.set(String((e as Error)?.message || e)));
  }

  ngOnDestroy(): void {
    this.unmount();
  }

  // Called by the wizard footer's "Speichern" button (Angular Elements don't proxy
  // methods, so the host reaches in here rather than into the wrapped element).
  commit(): void {
    const values: Record<string, string[]> = { ...(this.latestValues ?? {}) };
    // Workaround (only this case): the io form has no title/name widget, so a save
    // can come back without a cm:name. When that happens and the generated metadata
    // carried a cclom:title, add just that title back (upload derives cm:name from
    // it). No other fields are merged.
    const title = this.initialValues['cclom:title'];
    if (!values['cm:name']?.length && title?.length) {
      values['cclom:title'] = title;
    }
    this.save.emit(values);
  }

  // Create the element, set every input as a property, THEN append (so `embedded` is
  // already true when the wrapper's ngOnInit runs on connect).
  private mount(values: unknown = this.metadata): void {
    const host = this.hostRef?.nativeElement;
    if (!host || this.el) return;
    const el = document.createElement('edu-sharing-mds-editor-wrapper') as MdsWrapperElement;
    el.embedded = true;
    // Value mode: edit a free values map (no node). 'form' emits the FULL live values
    // via currentValuesChange ('nodes' mode would emit only a node diff).
    el.editorMode = 'form';
    el.groupId = this.groupId;
    el.setId = this.setId;
    el.repository = this.repository;
    // Normalize the payload into MDS values (namespaced keys → string[]), exactly as
    // the original edu-sharing-mds-editor web component did internally.
    const initial = this.toValues(values);
    el.currentValues = initial;
    // Keep the full set for the save-time merge; seed latestValues so a save with no
    // edits still sends everything.
    this.initialValues = initial;
    this.latestValues = initial;
    el.style.display = 'block';
    el.style.width = '100%';
    el.style.minHeight = '400px';
    el.addEventListener('currentValuesChange', this.onValues);
    host.appendChild(el);
    this.el = el;
    this.ready.set(true);
  }

  // Accepts the payload as an object or a JSON string (as the reference did) and
  // converts it to MDS values.
  private toValues(payload: unknown): Record<string, string[]> {
    const obj = typeof payload === 'string' ? JSON.parse(payload) : (payload ?? {});
    return valuesFromGeneratedMetadata(obj as GeneratedMetadataPayload);
  }

  private unmount(): void {
    if (this.el) {
      this.el.removeEventListener('currentValuesChange', this.onValues);
      this.el.remove();
      this.el = undefined;
    }
  }
}
