import {
  ChangeDetectionStrategy, Component, ElementRef, Input, OnChanges, Renderer2, inject,
} from '@angular/core';

/**
 * Renders a custom element (web component) by tag name that is not known at compile time,
 * and pushes `data` onto it as a `data` property. Used to place extension-provided custom
 * elements into the menu / screens without the core importing their tags.
 *
 * The element is created via Renderer2 (not the template), so no CUSTOM_ELEMENTS_SCHEMA is
 * required and the tag can be fully dynamic.
 */
@Component({
  selector: 'es-ext-element',
  standalone: true,
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExtElementComponent implements OnChanges {
  @Input({ required: true }) tag!: string;
  @Input() data: unknown;

  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly renderer = inject(Renderer2);

  private customElement: (HTMLElement & { data?: unknown }) | null = null;
  private currentTag: string | null = null;

  ngOnChanges(): void {
    if (this.tag !== this.currentTag) {
      if (this.customElement) this.renderer.removeChild(this.host.nativeElement, this.customElement);
      this.currentTag = this.tag;
      this.customElement = this.renderer.createElement(this.tag) as HTMLElement & { data?: unknown };
      this.renderer.appendChild(this.host.nativeElement, this.customElement);
    }
    if (this.customElement) this.customElement.data = this.data;
  }
}
