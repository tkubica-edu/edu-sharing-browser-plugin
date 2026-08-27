/**
 * The seam the chat widget asks its host for: a language model, and a set of tools.
 *
 * **This is a mirror, not the source.** The contract belongs to the other project —
 * `frontend/projects/ui/src/host-seam/host-engine-seam.ts` in `edu-chatbot-sc`, together with
 * `docs/plans/2026-08-25-lokale-engine-und-host-werkzeuge.md`, which says why each rule is the way it
 * is. Kept verbatim in shape and naming so a seam built here reads like one the widget declares, the
 * same way `util/page-context.ts` mirrors the widget's wire format. Mirrored here is only what this
 * panel actually fills in.
 *
 * Why the panel provides both halves: the model is a runtime of some 12 MB plus a module worker, and
 * an extension page under `script-src 'self'` loads none of it after the fact — whoever has the
 * runtime has it in their own package. The tools need the repository session, which this panel has and
 * the widget does not. See CHATBOT.md § The seam the bundle offers.
 */

/** The contract version this panel speaks. A widget expecting another one refuses the seam. */
export const HOST_SEAM_PROTOCOL = 1;

/** A message as the model takes it — the OpenAI shape. */
export interface HostMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** What one turn asks of the model. */
export interface HostCompletionRequest {
  messages: readonly HostMessage[];
  /** The shape the answer has to have; constrains the decoding, so what comes back parses. */
  schema?: Record<string, unknown> | null;
  maxTokens?: number;
  temperature?: number;
}

/** Why a turn ended, in the vocabulary the widget already reads. */
export type HostStopReason = 'submit' | 'text' | 'token_budget' | 'error';

export interface HostCompletion {
  text: string;
  stopReason: HostStopReason;
}

/**
 * One tool, as the model is told about it. **Exactly one string argument** — a 4-bit model under
 * constrained decoding cannot pick a per-tool argument object, so `syntax` describes the string and
 * this side splits it.
 */
export interface HostToolSpec {
  name: string;
  /** One German sentence. It stands in the prompt and is all the model chooses by. */
  purpose: string;
  argument: { syntax: string; example: string };
}

export type HostToolFailure =
  | 'invalid_args' | 'not_found' | 'unauthorized' | 'timeout' | 'unavailable' | 'empty';

/**
 * What a tool answers with: text, never structure, and truncated on this side — the panel knows how
 * long a page is, the widget does not. A failure is a value and not a throw, and its `text` is the
 * German sentence the model gets to read, so a failed lookup costs facts rather than the turn.
 */
export type HostToolAnswer =
  | { ok: true; text: string; truncated: boolean }
  | { ok: false; reason: HostToolFailure; text: string };

export interface HostLlm {
  label: string;
  ready(): Promise<void>;
  /** Called with the loading state; the returned function ends the observation. */
  progress(observer: (state: { text: string; done: number }) => void): () => void;
  complete(request: HostCompletionRequest, onDelta: (delta: string) => void): Promise<HostCompletion>;
  interrupt(): void;
}

export interface HostTools {
  catalogue(): readonly HostToolSpec[];
  invoke(name: string, argument: string): Promise<HostToolAnswer>;
}

/** What is handed to `element.setHostSeam()`. */
export interface HostEngineSeam {
  protocol: number;
  llm?: HostLlm;
  tools?: HostTools;
}

/** What the widget answers `hostCapabilities()` with; read to find out whether it can switch at all. */
export interface HostCapabilities {
  protocol: number;
  /** The `engine` values it accepts. `local` appears only where a usable model is registered. */
  engines: readonly string[];
  hostLlm: boolean;
  hostTools: boolean;
}

/**
 * The event the widget fires once as it connects, for a host that does not own the element. Answered
 * **synchronously inside the listener** — afterwards the offer has lapsed.
 */
export const HOST_SEAM_EVENT = 'boerdi:host-seam';

/** The detail of that event. */
export interface HostSeamOffer {
  protocol: number;
  provide(seam: HostEngineSeam): void;
}

/** How much of a tool's answer the model is shown. The widget's own budget is 3 000 across a turn. */
export const TOOL_RESULT_MAX = 1_200;

/** A tool answer, cut to {@link TOOL_RESULT_MAX} and saying so where it was cut. */
export function toolText(text: string): HostToolAnswer {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, reason: 'empty', text: 'Dazu liegt hier kein Text vor.' };
  const cut = trimmed.length > TOOL_RESULT_MAX;
  return {
    ok: true,
    truncated: cut,
    text: cut ? `${trimmed.slice(0, TOOL_RESULT_MAX)}\n[… gekürzt]` : trimmed,
  };
}
