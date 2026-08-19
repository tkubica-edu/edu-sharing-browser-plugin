import {
  afterRenderEffect, ChangeDetectionStrategy, Component, CUSTOM_ELEMENTS_SCHEMA, ElementRef,
  OnDestroy, computed, effect, inject, input, output, viewChild
} from '@angular/core';

import { ConditionsService } from '../../../services/conditions.service';
import { loadWebComponentBundle } from '../../../services/web-component-bundle.service';
import { chatSession } from '../../../util/chat-session';
import { PageContext, pageContextOf, sameSubject } from '../../../util/page-context';

/** The chat element the boerdi bundle defines. */
const CHAT_TAG = 'boerdi-chat';

const LOG = '[edu-sharing][boerdi]';

/** The API the chat widget serves its conversations from. */
const CHAT_API_URL = 'https://87.106.127.225.nip.io';

/** The element the widget renders the conversation in — the one behind its context methods. */
const SHELL_TAG = 'boerdi-chat-shell';

/** How long to wait for that element, and how often to look for it, before giving up on the hand-over. */
const SHELL_TIMEOUT_MS = 10_000;
const SHELL_POLL_MS = 50;

/**
 * The engine a structured result needs. The widget's default one answers from its patterns, and a schema then
 * takes no effect at all — no result, no event, and nothing to see in the browser: the backend notes the
 * mismatch in its own log. Both or neither, so the two are set together.
 */
const AGENT_ENGINE = 'agent';

/**
 * How long a follow-up task waits before it goes out. The widget refuses anything put to it while it is busy,
 * and it is still busy when it reports a result: it clears that flag in the line *after* the one that fires the
 * event. A follow-up sent straight from the report would therefore be dropped without a word — this delay puts
 * it in a later turn of the event loop, by which time the flag is down.
 */
const FOLLOW_UP_DELAY_MS = 50;

/**
 * Where a structured result arrives. Every event the widget fires is dispatched twice — under this name first
 * and then under `badboerdi:…`, which is its indulgence towards the predecessor system. Listening to both
 * would process every answer twice.
 */
const RESULT_EVENT = 'boerdi:agent-result';

/**
 * What else the widget reports about a conversation, none of which the panel acts on. Traced all the same:
 * the chat is another project running in our document, and apart from the text it writes these five events
 * are everything it says about itself — which tools a turn called, how it was routed, where it would send
 * the person. A check that went wrong is read from this trace or from nothing.
 *
 * They are heard on `window` because the widget's own view sits in a shadow root, and that is also what
 * makes the trace independent of who dispatched them: an event our own development mode fires in the
 * widget's place is logged exactly like the widget's own.
 */
const REPORTED_EVENTS = [
  'boerdi:query-meta',
  'boerdi:page-action',
  'boerdi:guide-suggestion',
  'boerdi:routing-debug'
] as const;

/**
 * The <boerdi-chat> element, typed for what we use of it. The methods exist on the element only once it has
 * been upgraded, hence the optional signatures — see {@link AiAssistantScreenComponent.mount}.
 */
interface ChatElement extends HTMLElement {
  /** Merge into the current context: no greeting, and what is not named stays as it was. */
  updateContext?(context: PageContext): void;
  /** Replace the current context, as a navigation would: stale ids are dropped and the new page is greeted. */
  replaceContext?(context: PageContext): void;
  /**
   * State what the host wants done. `text` is the instruction and stays out of the conversation: the widget
   * carries it in the next turn's environment (`host_instruction`) and consumes it there. What the person sees
   * is `options.message`, the bubble that turn is shown as — a task with no message would show them the whole
   * instruction. `trigger: 'now'` starts that turn straight away; without it the instruction rides along with
   * whatever they send next. The turn takes the context as it stands at that moment, so the page goes first.
   */
  setHostInstruction?(
    text: string,
    options?: { trigger?: 'now' | 'next'; message?: string },
  ): void;
}

/**
 * What a screen has the assistant do, in the two parts the widget keeps apart: `text` is the instruction, which
 * travels in the request's environment and is never shown, and `message` is the short bubble the person sees in
 * its place. Both belong to one step — a bubble without its instruction is a message nobody wrote, an
 * instruction without a bubble is a turn the person cannot account for.
 */
export interface AssistantTask {
  text: string;
  message: string;
}

/**
 * What the assistant submitted at the end of a turn, as the widget reports it. Both fields are the other
 * project's: `result` follows whatever schema was asked for, and is `null` for every turn that produced none —
 * a plain "thank you" among them. `stopReason` says why, and only `submit` means an answer was actually filled
 * in; the four caps (`deadline`, `token_budget`, `max_iterations`, `no_progress`) mean the run was cut off,
 * which is a different thing from having nothing to say.
 */
export interface AgentResult {
  result: unknown;
  stopReason: string;
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
// {@link AiAssistantScreenComponent.openConversation}.
//
// A screen may also state what is to be done and in which shape it wants the answer — see
// {@link AiAssistantScreenComponent.task} and {@link AiAssistantScreenComponent.resultSchema}. The chat is
// then still a chat, with the person able to carry on in it; what the screen gains is that the dialogue ends
// in something it can record. Such a screen gives the `page-context` attribute up and has the page handed
// over right in front of its task, for reasons that decide whether the task arrives at all.
//
// Both are read once, as the element mounts. A screen whose task is not settled by then is better off not
// rendering this component yet — mounting happens once, and a task that arrives afterwards is never put.
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

  /**
   * What the assistant is asked to do as the conversation opens, for a screen that embeds the chat to have
   * something done rather than to be talked to — the KI quality check has it measure the content against the
   * criteria. Put once, as the conversation appears; the person then carries on in their own words. The
   * instruction itself stays out of the conversation and only its `message` is shown; see {@link AssistantTask}.
   */
  readonly task = input<AssistantTask | null>(null);

  /**
   * The shape an answer is expected in, as a JSON schema. Stated, every turn of the conversation ends in a
   * further model pass that fills it in and reports it through {@link AiAssistantScreenComponent.agentResult}
   * — which is what turns a dialogue into a result the panel can record. Unstated, the chat stays a chat.
   */
  readonly resultSchema = input<Record<string, unknown> | null>(null);

  /**
   * What the assistant submitted, one per turn — including the turns that submitted nothing, so that a run cut
   * off by a cap is not indistinguishable from one that had nothing to add.
   */
  readonly agentResult = output<AgentResult>();

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

  /** How many answers have come back, to number the turns in the trace. */
  private turns = 0;

  /** The task last put to the assistant, so a screen that states a new one is told apart from a re-read. */
  private asked: string | null = null;

  /** The schema last set on the element, compared as text since it is an attribute. */
  private schema: string | null = null;

  /** The timer holding a follow-up task, while one is waiting — see {@link FOLLOW_UP_DELAY_MS}. */
  private followUp: number | null = null;

  /** Reports a submitted result while the screen is open; the widget fires it on `window`. */
  private readonly onResult = (event: Event) => {
    const detail = (event as CustomEvent).detail as { result?: unknown; stop_reason?: unknown } | null;
    const stopReason = typeof detail?.stop_reason === 'string' ? detail.stop_reason : 'unknown';
    const result = detail?.result ?? null;
    this.turns += 1;
    this.trace(`← agent-result (turn ${this.turns})`, {
      stopReason,
      submitted: result !== null,
      result
    });
    this.agentResult.emit({ result, stopReason });
  };

  /** Traces anything the widget reports that the panel does not act on — see {@link REPORTED_EVENTS}. */
  private readonly onReport = (event: Event) => {
    this.trace(`← ${event.type}`, (event as CustomEvent).detail ?? null);
  };

  constructor() {
    // Mount in the write phase, once the bundle defined the tag: this writes to the DOM and needs the
    // #host element, which a plain effect would run before.
    afterRenderEffect({
      write: () => {
        if (this.bundle.ready()) this.mount();
      }
    });
    this.trace('screen opened', {
      apiUrl: CHAT_API_URL,
      hasTask: !!this.task(),
      hasResultSchema: !!this.resultSchema()
    });
    // Logged, not just rendered: whether the widget ever arrived is the first question about a chat
    // that stays empty, and the bundle loads outside this screen's own lifecycle.
    effect(() => {
      if (this.bundle.ready()) this.trace(`bundle ready, <${CHAT_TAG}> defined`);
      const error = this.bundle.error();
      if (error) console.warn(`${LOG} bundle failed to load:`, error);
    });
    // Follow what the chat is about for as long as the screen is open: it re-runs on every page change
    // the panel is told about — including a title that only arrives afterwards — and on every change to
    // a context an embedding screen states.
    effect(() => this.follow(this.subject()));
    // A screen may ask a second thing once the first is answered — the KI check classifies the content after
    // it judged it. Both the shape and the request are re-read here, in that order: the widget applies a
    // changed schema from the next turn on, and the next turn is the one this is about to start.
    effect(() => this.ask(this.task(), this.resultSchema()));
    // Registered for as long as the screen is open, not only once a schema is stated: the widget dispatches
    // on `window` because its own view sits in a shadow root, and the listener has to be there before the
    // task goes out — the first turn is the one that answers it.
    window.addEventListener(RESULT_EVENT, this.onResult);
    for (const name of REPORTED_EVENTS) window.addEventListener(name, this.onReport);
  }

  ngOnDestroy(): void {
    window.removeEventListener(RESULT_EVENT, this.onResult);
    for (const name of REPORTED_EVENTS) window.removeEventListener(name, this.onReport);
    if (this.followUp !== null) clearTimeout(this.followUp);
    this.stopWaitingForShell();
    this.element?.remove();
    this.element = null;
    this.trace(`screen closed after ${this.turns} answered turn(s)`);
  }

  /** Create the element with its context already set, THEN append — it resolves the context as it connects. */
  private mount(): void {
    if (this.element) return;
    const element = document.createElement(CHAT_TAG) as ChatElement;
    this.current = this.subject();
    const schema = this.resultSchema();
    const attributes: Record<string, string> = {
      'api-url': CHAT_API_URL,
      'embed-mode': 'frameless',
      'initial-state': 'expanded',
      'show-language-buttons': 'false',
      'show-debug-button': 'false',
      // Two of the widget's five reports are silent unless asked for. Asked for here, not because the panel
      // acts on them, but because they are the only account of how a turn was routed and which tools it
      // called — see {@link REPORTED_EVENTS}.
      'emit-guide-suggestion': 'true',
      'emit-routing-debug': 'true',
      // The panel is not the page: the widget's own detection would contribute the extension's address
      // instead of the tab's, so what we hand over stands alone.
      'auto-context': 'false',
      // A context set here is one the widget greets as the element connects, and it is still answering that
      // greeting when the conversation appears — which is exactly when a task would be put, and a task put
      // while the widget is busy is dropped without a word. A screen with a task therefore hands the page
      // over itself, in front of the task; see {@link AiAssistantScreenComponent.openConversation}.
      ...(this.task() ? {} : { 'page-context': JSON.stringify(this.current) }),
      ...(schema ? { 'result-schema': JSON.stringify(schema), engine: AGENT_ENGINE } : {})
    };
    this.schema = schema ? JSON.stringify(schema) : null;
    // One line per attribute, and the values whole rather than abbreviated: every one of them is read once
    // as the element connects and never again, so what stands here is what this conversation runs on for as
    // long as it lasts. Cut short, the one that was wrong would be the one that was cut.
    for (const [name, value] of Object.entries(attributes)) {
      element.setAttribute(name, value);
      this.trace(`→ ${name} = ${value}`);
    }
    if (this.task()) this.trace('page-context left unset — the page follows with the task');
    // Sized inline, not via the stylesheet: an imperatively created element carries no view
    // encapsulation attribute, so this component's styles would not match it.
    element.style.cssText = 'display:block;flex:1 1 auto;min-height:420px';
    this.host().nativeElement.appendChild(element);
    this.element = element;
    this.trace(`→ <${CHAT_TAG}> appended, the widget now boots`);
    this.openConversation();
  }

  /**
   * Open the conversation: hand the page over, then put the screen's task to it. Both in one wait, and the
   * two calls in that order and without anything in between — the widget takes the context as it stands the
   * moment the task goes out, so a task sent first is answered about the previous page.
   *
   * **The order is also what gets the task through at all.** Handing the page over makes the widget offer to
   * greet the new page, and it drops any message put to it while it is busy answering — silently, since a
   * refused task looks exactly like one nobody sent. Putting the task in the same turn of the event loop wins
   * that race: the task is the turn that runs, and the greeting is the one that gives way.
   *
   * Without a task the hand-over is only for a resumed session. The panel is reloaded on every page change, so
   * the widget is created anew each time while its session outlives it in local storage: a resumed
   * conversation keeps the context it was last given, and the `page-context` attribute is only read into a
   * conversation that starts here. Replacing rather than merging is what the page change is — the previous
   * page's ids leave the context and the new page is greeted.
   *
   * All of it deferred until the conversation is on screen: the element's methods reach the widget through the
   * component it renders, and a call made before that one exists is dropped without a trace.
   */
  private openConversation(): void {
    const element = this.element;
    if (!element) return;
    const task = this.task();
    const session = chatSession();
    if (!task && !session) {
      this.trace('nothing to open with — no task, and no session to hand the page to');
      return;
    }
    this.trace('waiting for the conversation before opening it', {
      reason: task ? 'the screen states a task' : 'a session was resumed',
      resumedSession: session
    });
    this.whenShellRendered(element, (rendered) => {
      if (!rendered) {
        console.warn(`${LOG} <${SHELL_TAG}> never rendered — neither page nor task reached the chat`);
        return;
      }
      this.trace('→ replaceContext (opening)', this.current);
      element.replaceContext?.(this.current);
      if (!task) return;
      this.asked = task.text;
      this.put(task, 'opening');
    });
  }

  /**
   * Put a further task, for a screen that asks a second thing once the first was answered. Nothing happens
   * before the element is mounted (the first task rides along with the mount) or where the request has not
   * actually changed — the input is a signal, and a re-read is not a new question.
   *
   * The shape goes first and the request after it: the widget applies a changed schema from its next turn on,
   * and this is about to start that turn. Both are held for a moment before going out, because the widget is
   * still marked busy at the instant it reports the previous answer — see {@link FOLLOW_UP_DELAY_MS}.
   */
  private ask(task: AssistantTask | null, schema: Record<string, unknown> | null): void {
    const element = this.element;
    if (!element || !task || task.text === this.asked) return;
    const stated = schema ? JSON.stringify(schema) : null;
    if (stated && stated !== this.schema) {
      element.setAttribute('result-schema', stated);
      this.schema = stated;
      // The schema goes to the log as the object it is, not as the text the attribute takes: the console
      // renders one as a tree that folds and the other as a wall the width of the panel.
      this.trace(`→ result-schema (${stated.length} characters)`, schema);
    }
    this.asked = task.text;
    if (this.followUp !== null) clearTimeout(this.followUp);
    this.trace(
      `→ setHostInstruction in ${FOLLOW_UP_DELAY_MS}ms, shown as „${task.message}“ ` +
        `(${task.text.length} characters)`,
    );
    this.followUp = window.setTimeout(() => {
      this.followUp = null;
      this.put(task, 'follow-up');
    }, FOLLOW_UP_DELAY_MS);
  }

  /**
   * Hand one task to the widget, and put its instruction on the record in the same breath.
   *
   * The instruction never appears in the conversation — the person reads `task.message` in its place, and the
   * widget carries the text itself in the turn's environment as `host_instruction`. This line is therefore the
   * only place the wording can be read back from: whole, verbatim, on its own line, and written at the moment
   * of the hand-over rather than when the task was worded, so that what the log shows is what actually went
   * out. A check that answered the wrong question is told apart from one that was asked the wrong thing here
   * or nowhere.
   */
  private put(task: AssistantTask, occasion: string): void {
    const element = this.element;
    if (!element?.setHostInstruction) {
      // Without it the screen shows a chat that was never asked anything, and the person is left to word the
      // task the panel meant to put — worth a line, since nothing else would show.
      console.warn(`${LOG} <${CHAT_TAG}> exposes no setHostInstruction — the ${occasion} task was not put`);
      return;
    }
    this.trace(
      `→ setHostInstruction (${occasion}), shown as „${task.message}“, ` +
        `${task.text.length} characters going out as host_instruction:\n${task.text}`,
    );
    element.setHostInstruction(task.text, { trigger: 'now', message: task.message });
  }

  /**
   * Replace the context with the page as it stands once the conversation is on screen — not as it stood when the
   * wait began, since every page change arriving in between is dropped for the same reason this wait exists.
   */
  private handOverWhenRendered(reason: string): void {
    const element = this.element;
    if (!element) return;
    this.trace(`${reason}: the page is handed over once the chat is on screen`);
    this.whenShellRendered(element, (rendered) => {
      if (!rendered) {
        console.warn(`${LOG} <${SHELL_TAG}> never rendered — the chat kept its previous page (${reason})`);
        return;
      }
      this.trace(`→ replaceContext (${reason})`, this.current);
      element.replaceContext?.(this.current);
    });
  }

  /** Call `then` with whether the conversation element appeared, once it did or once waiting for it timed out. */
  private whenShellRendered(element: ChatElement, then: (rendered: boolean) => void): void {
    this.stopWaitingForShell();
    if (shellRendered(element)) {
      this.trace(`<${SHELL_TAG}> already on screen`);
      then(true);
      return;
    }
    let waited = 0;
    this.shellWait = window.setInterval(() => {
      waited += SHELL_POLL_MS;
      const rendered = shellRendered(element);
      if (!rendered && waited < SHELL_TIMEOUT_MS) return;
      this.stopWaitingForShell();
      // How long it took is worth having: it is the widget's own boot, and a conversation that takes
      // seconds to appear is the difference between a slow chat and one that never got its task.
      this.trace(rendered ? `<${SHELL_TAG}> on screen after ${waited}ms` : `gave up after ${waited}ms`);
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
      this.trace('page seen before the chat was mounted, not handed over yet', context);
      return;
    }
    const previous = this.current;
    if (JSON.stringify(previous) === JSON.stringify(context)) {
      this.trace('page re-read, unchanged — nothing sent', context);
      return;
    }
    this.current = context;
    if (!shellRendered(element)) {
      // The context methods reach the widget through the component it renders; calling them before it exists
      // would lose the page silently, so the hand-over waits for it and then takes the page from `current`.
      this.handOverWhenRendered('page changed before the chat was on screen');
      return;
    }
    const merge = sameSubject(previous, context);
    this.trace(`→ ${merge ? 'updateContext (same subject, merged)' : 'replaceContext (new page)'}`, {
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

  /**
   * One line of this conversation's trace. Everything here is asynchronous — the bundle, the widget's own boot,
   * the answers — and which of them happened before which is the whole question when a chat stays empty, so the
   * order the lines are written in is what the trace is read for.
   *
   * `→` is what goes to the widget, `←` what comes back from it. A turn the person typed shows only as `←`;
   * their message never passes through this component.
   */
  private trace(message: string, detail?: unknown): void {
    if (detail === undefined) console.log(`${LOG} ${message}`);
    else console.log(`${LOG} ${message}`, detail);
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
