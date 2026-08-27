import { Injectable, Injector, computed, effect, inject, signal } from '@angular/core';

import { APP_CONFIG } from '../config';
import { errorMessage } from '../util/errors';
import {
  HOST_SEAM_PROTOCOL, HostEngineSeam, HostToolAnswer, HostToolSpec, toolText,
} from '../util/host-seam';
import { BrowserExtensionService } from './browser-extension.service';
import { LOCAL_MODELS, LocalLlmService } from './local-llm.service';

const LOG = '[edu-sharing][seam]';

/**
 * The tools this panel offers the widget's local engine. The names are the MCP names of the chatbot's
 * own tools on purpose: the German task texts the KI check sends already order those calls by name
 * (`util/ai-prompts.ts`), so the same wording works on both engines and this is a stand-in for that
 * catalogue rather than a second vocabulary.
 *
 * One tool for now — the one with no open questions. Reading a page is something the panel does for
 * every extraction anyway; the repository tools (`get_skill_registry`, `get_skill`,
 * `lookup_wlo_vocabulary`) need a search this app has never made, and they follow once that is
 * measured against a live repository.
 */
const TOOLS: readonly HostToolSpec[] = [
  {
    name: 'get_url_text',
    purpose: 'Liest den Text der Seite, die die Person gerade offen hat — auch aus einem PDF.',
    // Empty, because there is exactly one page this panel can read and no address to choose. Said in
    // the syntax rather than left open: asked for a URL, a 3B model invents one (measured 2026-08-27 —
    // it asked for a Wikipedia article that does not exist).
    argument: { syntax: 'leer lassen', example: '' },
  },
];

/**
 * Whether the chat is answered by a model on this device. Off by default: the model is a download of
 * one to two gigabytes, the route is new, and a person who did not ask for it should not wait for it.
 */
const DEFAULT_ENABLED = false;

/**
 * The seam handed to `<boerdi-chat>`: this panel's model, and the tools it can serve.
 *
 * The widget carries the engine — prompt assembly, the tool loop, the schema turns, the transcript —
 * and asks the host only for the two things it cannot have: a model (12 MB of runtime plus a worker,
 * unloadable in an extension page after the fact) and tools (they need the repository session). See
 * CHATBOT.md § The seam the bundle offers.
 */
@Injectable({ providedIn: 'root' })
export class HostSeamService {
  private readonly llm = inject(LocalLlmService);
  private readonly browserExtension = inject(BrowserExtensionService);
  private readonly injector = inject(Injector);

  private readonly enabledState = signal(DEFAULT_ENABLED);

  /** Whether the panel offers its model at all. Read as the chat element is created. */
  readonly enabled = this.enabledState.asReadonly();

  /** True while the device could actually run one — the switch says so rather than failing later. */
  readonly supported = this.llm.supported();

  /** What the model reports about itself while it loads, for a screen that shows the wait. */
  readonly progress = this.llm.progress;

  /** How far the switch stands from the checked-in configuration — counted by the settings screen. */
  readonly changedSettings = computed(() => (this.enabledState() === DEFAULT_ENABLED ? 0 : 1));

  async load(): Promise<void> {
    const stored = await this.browserExtension.storageGet(
      APP_CONFIG.storageKeys.localEngine,
      DEFAULT_ENABLED,
    );
    this.enabledState.set(!!stored && this.supported);
  }

  async setEnabled(enabled: boolean): Promise<void> {
    this.enabledState.set(enabled);
    await this.browserExtension.storageSet(APP_CONFIG.storageKeys.localEngine, enabled);
  }

  async resetToDefault(): Promise<void> {
    await this.setEnabled(DEFAULT_ENABLED);
  }

  /**
   * The seam itself, or `null` where this panel has nothing to offer — then the widget keeps to its
   * backend path, which is the same thing as never having been asked.
   */
  seam(): HostEngineSeam | null {
    if (!this.enabledState() || !this.supported) return null;
    return {
      protocol: HOST_SEAM_PROTOCOL,
      llm: {
        label: this.label(),
        ready: async () => {
          // Every movement of the seam is traced, and this is why: between "the switch is on" and "the
          // chat answers" lie a model download, a GPU upload and a worker, and a chat that stays empty
          // says nothing about which of them it was waiting for.
          const started = Date.now();
          console.log(`${LOG} → ready (${this.label()})`);
          try {
            await this.llm.prepare();
            console.log(`${LOG} ← ready after ${Date.now() - started}ms`);
          } catch (cause: unknown) {
            console.warn(`${LOG} ✗ ready failed after ${Date.now() - started}ms:`, errorMessage(cause));
            throw cause;
          }
        },
        // The service holds the loading as a signal; the widget wants a callback. An effect is the
        // bridge, and its `destroy` is what the widget gets back to end the observation — without it
        // one effect per turn would pile up on a service that outlives the screen.
        progress: (observer) => {
          const watcher = effect(
            () => {
              const state = this.llm.progress();
              if (state) observer({ text: state.text, done: state.done });
            },
            { injector: this.injector },
          );
          return () => watcher.destroy();
        },
        complete: async (request, onDelta) => {
          const started = Date.now();
          console.log(
            `${LOG} → complete: ${request.messages.length} message(s), `
            + `${request.schema ? 'schema-constrained' : 'prose'}, max ${request.maxTokens ?? 'default'}`,
          );
          const answer = await this.llm.ask(request.messages, {
            schema: request.schema ?? null,
            onDelta,
            maxTokens: request.maxTokens,
            temperature: request.temperature,
          });
          // The service keeps a failure as a signal and answers with an empty text; the widget can do
          // nothing with that but call the answer incomplete, which names the wrong cause. Thrown, the
          // reason reaches the conversation — and the reasons are ones a person can act on: no memory
          // for this model, no WebGPU, a download that broke.
          if (answer.stopReason === 'error' && !answer.text.trim()) {
            const reason = this.llm.error() ?? 'Das Modell konnte nicht antworten.';
            console.warn(`${LOG} ✗ complete failed after ${Date.now() - started}ms:`, reason);
            throw new Error(reason);
          }
          console.log(
            `${LOG} ← complete after ${Date.now() - started}ms: ${answer.text.length} characters, `
            + `stopReason ${answer.stopReason}`,
          );
          return answer;
        },
        interrupt: () => this.llm.interrupt(),
      },
      tools: {
        catalogue: () => TOOLS,
        invoke: (name, argument) => this.invoke(name, argument),
      },
    };
  }

  /** The model that is loaded or offered, as the widget names it in its footer. */
  private label(): string {
    const loaded = this.llm.loaded();
    return LOCAL_MODELS.find((model) => model.id === loaded)?.label ?? 'Modell auf dem Gerät';
  }

  /**
   * Run one tool. Every answer is a value, including every failure: the widget's loop carries on with
   * one fact fewer, and a thrown error would cost the whole turn.
   */
  private async invoke(name: string, argument: string): Promise<HostToolAnswer> {
    const started = Date.now();
    const answer = await this.run(name, argument.trim());
    console.log(
      `${LOG} ← ${name}(${argument || '—'}) in ${Date.now() - started}ms`,
      answer.ok ? `${answer.text.length} characters` : `failed: ${answer.reason}`,
    );
    return answer;
  }

  private async run(name: string, argument: string): Promise<HostToolAnswer> {
    if (name !== 'get_url_text') {
      return {
        ok: false,
        reason: 'invalid_args',
        text: `Das Werkzeug „${name}“ gibt es hier nicht. Verfügbar: ${TOOLS.map((t) => t.name).join(', ')}.`,
      };
    }
    try {
      // The open tab is the one page this panel can read whole — the content script reads it, and a
      // PDF is substituted with its own text (see BrowserExtensionService.extractPageData).
      const page = await this.browserExtension.extractPageData();
      const text = page?.formattedText || page?.mainContent || page?.text || '';
      const answer = toolText(text);
      // An address that is not the open one is answered with the open page all the same, and told so.
      // Refusing would spend the model's one attempt on a mistake it cannot correct — there is no
      // second page here to try — and a model that invented the address (which is what happens) would
      // learn nothing from „not found". Saying which page this is keeps it honest.
      if (answer.ok && argument && page?.url && !sameAddress(argument, page.url)) {
        return {
          ...answer,
          text: `Diese Adresse ist hier nicht lesbar. Stattdessen der Text der offenen Seite `
            + `(${page.url}):\n${answer.text}`,
        };
      }
      return answer;
    } catch (cause: unknown) {
      console.warn(`${LOG} get_url_text failed:`, errorMessage(cause));
      return { ok: false, reason: 'unavailable', text: 'Die Seite ließ sich gerade nicht lesen.' };
    }
  }
}

/** Whether the model asked for the page that is actually open — compared without query or fragment. */
function sameAddress(asked: string, open: string): boolean {
  try {
    const a = new URL(asked);
    const b = new URL(open);
    return a.origin === b.origin && a.pathname === b.pathname;
  } catch {
    return false;
  }
}
