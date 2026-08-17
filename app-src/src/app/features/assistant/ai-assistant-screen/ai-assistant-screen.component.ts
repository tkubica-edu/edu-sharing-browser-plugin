import {
  afterRenderEffect, ChangeDetectionStrategy, Component, CUSTOM_ELEMENTS_SCHEMA, ElementRef,
  OnDestroy, effect, inject, viewChild
} from '@angular/core';

import { ConditionsService } from '../../../services/conditions.service';
import { loadWebComponentBundle } from '../../../services/web-component-bundle.service';
import { PageContext, pageContextOf, sameSubject } from '../../../util/page-context';

/** The chat element the boerdi bundle defines. */
const CHAT_TAG = 'boerdi-chat';

const LOG = '[edu-sharing][boerdi]';

/** The API the chat widget serves its conversations from. */
const CHAT_API_URL = 'https://87.106.127.225.nip.io';

/**
 * The <boerdi-chat> element, typed for what we use of it. The context methods exist on the element only once it
 * has been upgraded, hence the optional signatures — see {@link AiAssistantScreenComponent.mount}.
 */
interface ChatElement extends HTMLElement {
  /** Merge into the current context: no greeting, and what is not named stays as it was. */
  updateContext?(context: PageContext): void;
  /** Replace the current context, as a navigation would: stale ids are dropped and the new page is greeted. */
  replaceContext?(context: PageContext): void;
}

/** The context of a tab that is about nothing the assistant can use — enough to clear the previous page's. */
const NO_CONTEXT: PageContext = { page_kind: 'other' };

// "Boerdi - KI-Assistent", entered from the offer above the session bar (AiAssistantBarComponent): the
// assistant's own chat widget, embedded as the real custom element its bundle defines. It fills the screen
// on its own — frameless, so it draws no floating button of its own, and expanded, since being here is
// already the request to chat.
//
// The page the chat is about has to be handed over: the widget reads its own location for this, and in the
// panel that is the extension rather than the page — so `auto-context` is off, its URL watcher never fires
// (the panel's own address never changes while the tab it shows does), and the initial `page-context`
// attribute is read once as the element connects. Every later page is therefore passed through the element's
// own context methods; see {@link AiAssistantScreenComponent.follow}.
@Component({
  selector: 'es-ai-assistant-screen',
  templateUrl: './ai-assistant-screen.component.html',
  styleUrl: './ai-assistant-screen.component.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AiAssistantScreenComponent implements OnDestroy {
  private readonly conditions = inject(ConditionsService);

  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');

  protected readonly bundle = loadWebComponentBundle('boerdi', CHAT_TAG);

  private element: ChatElement | null = null;

  /** The context the widget currently holds, to tell an actual page change from a mere re-read. */
  private current: PageContext = NO_CONTEXT;

  constructor() {
    // Mount in the write phase, once the bundle defined the tag: this writes to the DOM and needs the
    // #host element, which a plain effect would run before.
    afterRenderEffect({
      write: () => {
        if (this.bundle.ready()) this.mount();
      }
    });
    // Logged, not just rendered: whether the widget ever arrived is the first question about a chat
    // that stays empty, and the bundle loads outside this screen's own lifecycle.
    effect(() => {
      if (this.bundle.ready()) console.log(`${LOG} bundle ready, <${CHAT_TAG}> defined`);
      const error = this.bundle.error();
      if (error) console.warn(`${LOG} bundle failed to load:`, error);
    });
    // Follow the active tab for as long as the screen is open. Reads the active page, so it re-runs on
    // every page change the panel is told about — including a title that only arrives afterwards.
    effect(() => this.follow(pageContextOf(this.conditions.activeUrl(), this.conditions.activeTitle()) ?? NO_CONTEXT));
  }

  ngOnDestroy(): void {
    this.element?.remove();
    this.element = null;
  }

  /** Create the element with its context already set, THEN append — it resolves the context as it connects. */
  private mount(): void {
    if (this.element) return;
    const element = document.createElement(CHAT_TAG) as ChatElement;
    element.setAttribute('api-url', CHAT_API_URL);
    element.setAttribute('embed-mode', 'frameless');
    element.setAttribute('initial-state', 'expanded');
    element.setAttribute('show-language-buttons', 'false');
    element.setAttribute('show-debug-button', 'false');
    // The panel is not the page: the widget's own detection would contribute the extension's address
    // instead of the tab's, so what we hand over stands alone.
    element.setAttribute('auto-context', 'false');
    this.current = pageContextOf(this.conditions.activeUrl(), this.conditions.activeTitle()) ?? NO_CONTEXT;
    element.setAttribute('page-context', JSON.stringify(this.current));
    // Sized inline, not via the stylesheet: an imperatively created element carries no view
    // encapsulation attribute, so this component's styles would not match it.
    element.style.cssText = 'display:block;flex:1 1 auto;min-height:420px';
    console.log(`${LOG} mounting <${CHAT_TAG}>`, { apiUrl: CHAT_API_URL, pageContext: this.current });
    this.host().nativeElement.appendChild(element);
    this.element = element;
  }

  /**
   * Hand a page to the widget, if it is a different one. Which method says what kind of change it was: another
   * page is replaced, so the previous page's ids leave the context and the new one can be greeted, while the
   * same page under a changed address is merged in, which keeps the running conversation quiet.
   */
  private follow(context: PageContext): void {
    const element = this.element;
    if (!element) {
      // Not lost: the page is read again as the element mounts, which is what this is waiting for.
      console.log(`${LOG} page seen before the chat was mounted, not handed over yet:`, context);
      return;
    }
    const previous = this.current;
    if (JSON.stringify(previous) === JSON.stringify(context)) return;
    this.current = context;
    const merge = sameSubject(previous, context);
    console.log(`${LOG} context ${merge ? 'updateContext (merge)' : 'replaceContext (new page)'}`, {
      previous,
      context
    });
    if (merge) element.updateContext?.(context);
    else element.replaceContext?.(context);
    // The methods live on the upgraded element; a missing one means the bundle's API changed and the
    // context silently never arrived.
    if (!element.updateContext || !element.replaceContext) {
      console.warn(`${LOG} <${CHAT_TAG}> exposes no context methods — the page change was not applied`);
    }
  }
}
