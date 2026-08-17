import {
  afterRenderEffect, ChangeDetectionStrategy, Component, CUSTOM_ELEMENTS_SCHEMA, ElementRef,
  OnDestroy, computed, effect, inject, input, viewChild
} from '@angular/core';

import { ConditionsService } from '../../../services/conditions.service';
import { loadWebComponentBundle } from '../../../services/web-component-bundle.service';
import { PageContext, pageContextOf, sameSubject } from '../../../util/page-context';

/** The chat element the boerdi bundle defines. */
const CHAT_TAG = 'boerdi-chat';

const LOG = '[edu-sharing][boerdi]';

/** The API the chat widget serves its conversations from. */
const CHAT_API_URL = 'https://87.106.127.225.nip.io';

/** Where the widget keeps the session it resumes; a stored id means the chat comes back mid-conversation. */
const SESSION_KEY = 'boerdi_session_id';

/** The element the widget renders the conversation in — the one behind its context methods. */
const SHELL_TAG = 'boerdi-chat-shell';

/** How long to wait for that element, and how often to look for it, before giving up on the hand-over. */
const SHELL_TIMEOUT_MS = 10_000;
const SHELL_POLL_MS = 50;

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
// already the request to chat. Other screens embed the same chat about a subject of their own; see
// {@link AiAssistantScreenComponent.context}.
//
// The page the chat is about has to be handed over: the widget reads its own location for this, and in the
// panel that is the extension rather than the page — so `auto-context` is off, its URL watcher never fires
// (the panel's own address never changes while the tab it shows does), and the initial `page-context`
// attribute is read once as the element connects. Every later page is therefore passed through the element's
// own context methods; see {@link AiAssistantScreenComponent.follow}. That attribute reaches a conversation
// starting here and no other: a session resumed from local storage keeps the context it was last given, so a
// widget mounting onto one is handed the page explicitly; see
// {@link AiAssistantScreenComponent.handOverToResumedSession}.
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

  /**
   * What the chat is to be about, for a screen that embeds it about something other than the open tab — the KI
   * quality check hands over the content it has the assistant analyse. Unset, which is how the assistant's own
   * screen uses it, the chat follows the tab the panel is open on.
   */
  readonly context = input<PageContext | null>(null);

  /** The context the chat is handed: what the embedding screen states, else the open page. */
  private readonly subject = computed(
    () =>
      this.context() ??
      pageContextOf(this.conditions.activeUrl(), this.conditions.activeTitle()) ??
      NO_CONTEXT,
  );

  protected readonly bundle = loadWebComponentBundle('boerdi', CHAT_TAG);

  private element: ChatElement | null = null;

  /** The context the widget currently holds, to tell an actual page change from a mere re-read. */
  private current: PageContext = NO_CONTEXT;

  /** The timer waiting for the conversation to be on screen, while one is running. */
  private shellWait: number | null = null;

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
    // Follow what the chat is about for as long as the screen is open: it re-runs on every page change
    // the panel is told about — including a title that only arrives afterwards — and on every change to
    // a context an embedding screen states.
    effect(() => this.follow(this.subject()));
  }

  ngOnDestroy(): void {
    this.stopWaitingForShell();
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
    this.current = this.subject();
    element.setAttribute('page-context', JSON.stringify(this.current));
    // Sized inline, not via the stylesheet: an imperatively created element carries no view
    // encapsulation attribute, so this component's styles would not match it.
    element.style.cssText = 'display:block;flex:1 1 auto;min-height:420px';
    console.log(`${LOG} mounting <${CHAT_TAG}>`, { apiUrl: CHAT_API_URL, pageContext: this.current });
    this.host().nativeElement.appendChild(element);
    this.element = element;
    this.handOverToResumedSession();
  }

  /**
   * Hand the page over to a conversation that came back with the panel. The panel is reloaded on every page
   * change, so the widget is created anew each time while its session outlives it in local storage: a resumed
   * conversation keeps the context it was last given, and the `page-context` attribute is only read into a
   * conversation that starts here. Replacing rather than merging is what the page change is — the previous
   * page's ids leave the context and the new page is greeted.
   *
   * Deferred until the conversation is on screen: the element's context methods reach the widget through the
   * component it renders, and a call made before that one exists is dropped without a trace.
   */
  private handOverToResumedSession(): void {
    if (!this.element || !storedSession()) return;
    this.handOverWhenRendered('resumed session');
  }

  /**
   * Replace the context with the page as it stands once the conversation is on screen — not as it stood when the
   * wait began, since every page change arriving in between is dropped for the same reason this wait exists.
   */
  private handOverWhenRendered(reason: string): void {
    const element = this.element;
    if (!element) return;
    console.log(`${LOG} ${reason}: page is handed over once the chat is on screen`);
    this.whenShellRendered(element, (rendered) => {
      if (!rendered) {
        console.warn(`${LOG} <${SHELL_TAG}> never rendered — the chat kept its previous page (${reason})`);
        return;
      }
      console.log(`${LOG} replaceContext (${reason})`, this.current);
      element.replaceContext?.(this.current);
    });
  }

  /** Call `then` with whether the conversation element appeared, once it did or once waiting for it timed out. */
  private whenShellRendered(element: ChatElement, then: (rendered: boolean) => void): void {
    this.stopWaitingForShell();
    if (shellRendered(element)) {
      then(true);
      return;
    }
    let waited = 0;
    this.shellWait = window.setInterval(() => {
      waited += SHELL_POLL_MS;
      const rendered = shellRendered(element);
      if (!rendered && waited < SHELL_TIMEOUT_MS) return;
      this.stopWaitingForShell();
      then(rendered);
    }, SHELL_POLL_MS);
  }

  private stopWaitingForShell(): void {
    if (this.shellWait === null) return;
    clearInterval(this.shellWait);
    this.shellWait = null;
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
    if (!shellRendered(element)) {
      // The context methods reach the widget through the component it renders; calling them before it exists
      // would lose the page silently, so the hand-over waits for it and then takes the page from `current`.
      this.handOverWhenRendered('page changed before the chat was on screen');
      return;
    }
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

/**
 * Whether the widget has the conversation on screen. The chat element renders its view into a shadow root, so
 * the conversation is not among its children; the light DOM is looked at as well, for a bundle that stops
 * encapsulating it.
 */
function shellRendered(element: HTMLElement): boolean {
  return !!(element.shadowRoot?.querySelector(SHELL_TAG) ?? element.querySelector(SHELL_TAG));
}

/** The session the widget would resume, if it stored one. Storage can be denied, which is simply no session. */
function storedSession(): string | null {
  try {
    return localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}
