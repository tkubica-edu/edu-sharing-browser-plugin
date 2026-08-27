import { Injectable, signal } from '@angular/core';
import type { InitProgressReport, MLCEngineInterface } from '@mlc-ai/web-llm';

import { errorMessage } from '../util/errors';

const LOG = '[edu-sharing][llm]';

/**
 * The models the panel offers, largest first. All three are in WebLLM's prebuilt list, so none of them has to
 * be compiled: the weights are fetched from the CDN once and kept in the browser's Cache storage afterwards.
 *
 * `vram` is what the model needs on the GPU at {@link CONTEXT_WINDOW} — weights, KV cache and overhead
 * together — and it is what decides whether a device can run it at all.
 */
export const LOCAL_MODELS = [
  {
    id: 'Qwen2.5-3B-Instruct-q4f16_1-MLC',
    label: 'Qwen2.5 3B (empfohlen)',
    /** What the first visit downloads, in MB — paid once per installation, then read from the cache. */
    download: 1900,
    vram: 2900
  },
  {
    id: 'gemma-2-2b-it-q4f16_1-MLC',
    label: 'Gemma 2 2B (sparsam)',
    download: 1500,
    vram: 2400
  },
  {
    id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
    label: 'Llama 3.2 1B (schwache Geräte)',
    download: 800,
    vram: 1600
  }
] as const;

export type LocalModelId = (typeof LOCAL_MODELS)[number]['id'];

/** The model a device is offered where it says nothing about itself — the middle tier, which runs about anywhere. */
export const FALLBACK_MODEL: LocalModelId = 'gemma-2-2b-it-q4f16_1-MLC';

/**
 * How much of a GPU's largest buffer a model's weights may claim. WebGPU reports no VRAM, and `maxBufferSize`
 * is the closest thing to it that is actually exposed: an integrated GPU commonly answers 2 GiB and a discrete
 * one 4 GiB or more. The share is deliberately below 1, since the KV cache and the runtime need room beside
 * the weights — and the pick is a first guess either way, correctable in the settings.
 */
const BUFFER_SHARE = 0.9;

/**
 * As much of WebGPU as the pick below needs. Declared here rather than pulled in as `@webgpu/types`: the app
 * compiles with no ambient type packages at all, and one buffer limit is not worth the first of them.
 */
interface GpuAdapterProbe {
  requestAdapter(): Promise<{ limits?: { maxBufferSize?: number } } | null>;
}

/** What the engine is doing, for a screen that has to show the wait — the first load takes minutes. */
export type LlmStage = 'idle' | 'unsupported' | 'loading' | 'ready' | 'generating' | 'failed';

/** How a turn ended, in the vocabulary the panel already reads (see CHATBOT-IO.md § The outputs). */
export type LlmStopReason = 'submit' | 'text' | 'token_budget' | 'error';

/** One turn's answer: the text as it was streamed, and how it ended. */
export interface LlmAnswer {
  text: string;
  stopReason: LlmStopReason;
}

/** A message as the engine takes it — the OpenAI shape WebLLM implements. */
export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** What a turn may state beyond its messages. */
export interface LlmTurnOptions {
  /** The shape the answer has to have. Constrains the decoding itself, so what comes back parses. */
  schema?: Record<string, unknown> | null;
  /** Called with every token as it arrives, so the answer can be shown while it is still being written. */
  onDelta?: (delta: string) => void;
  temperature?: number;
  maxTokens?: number;
}

/**
 * The context the model is loaded with, above WebLLM's default of 4 096. The individuelle Qualitätsprüfung is
 * what needs it: its instruction is some 4 600 characters for twelve criteria, the content's own text stands
 * beside it, and the answer to a schema over those criteria is longer than either. All three share this, and
 * at 4 096 the answer would be cut off mid-object every time. The KV cache grows with it — which is what the
 * `vram` figures above already account for.
 */
const CONTEXT_WINDOW = 8192;

/** How long an answer may become where a turn names no bound of its own. */
const MAX_TOKENS = 1024;

/**
 * How long a structured answer may become. Three times the ordinary bound: a verdict per criterion, each with
 * its reason, is the longest thing this route produces, and a schema turn cut off by the budget is not a short
 * answer but a broken object.
 */
const SCHEMA_MAX_TOKENS = 3072;

/**
 * The model that answers in this browser. Nothing about a conversation leaves the device: the weights are
 * public files, the prompt and the answer never go anywhere, and the only network traffic is the one-time
 * download of the model itself.
 *
 * Held as a root service rather than by the screen, so the engine outlives a screen change — it does not
 * outlive a page change, since the panel itself is torn down and rebuilt with every one of those.
 */
@Injectable({ providedIn: 'root' })
export class LocalLlmService {
  /** What the engine is doing right now — see {@link LlmStage}. */
  readonly stage = signal<LlmStage>('idle');

  /** The model's own account of its loading, as WebLLM words it, plus how far it has come (0…1). */
  readonly progress = signal<{ text: string; done: number } | null>(null);

  /** The model that is loaded, or the one being loaded; null before either. */
  readonly loaded = signal<LocalModelId | null>(null);

  /** Why the engine is unusable, in words a person can act on; null while nothing failed. */
  readonly error = signal<string | null>(null);

  private engine: MLCEngineInterface | null = null;

  /** The engine's own creation, kept so two screens asking at once wait on one load rather than two. */
  private starting: Promise<MLCEngineInterface> | null = null;

  /** Whether this browser can run a model at all: WebGPU is what makes it more than a CPU toy. */
  supported(): boolean {
    return typeof navigator !== 'undefined' && 'gpu' in navigator;
  }

  /**
   * The model this device is offered, by the largest buffer its GPU admits to. A device that answers nothing
   * gets {@link FALLBACK_MODEL} rather than the largest model — being wrong the other way costs a failed load
   * of two gigabytes.
   */
  async suggestModel(): Promise<LocalModelId> {
    if (!this.supported()) return FALLBACK_MODEL;
    try {
      const gpu = (navigator as Navigator & { gpu?: GpuAdapterProbe }).gpu;
      const adapter = await gpu?.requestAdapter();
      const budget = ((adapter?.limits?.maxBufferSize ?? 0) / (1024 * 1024)) * BUFFER_SHARE;
      const fitting = LOCAL_MODELS.find((model) => model.vram <= budget);
      console.log(`${LOG} GPU buffer budget ${Math.round(budget)} MB → ${fitting?.id ?? FALLBACK_MODEL}`);
      return fitting?.id ?? FALLBACK_MODEL;
    } catch (cause: unknown) {
      console.warn(`${LOG} the GPU said nothing about itself:`, errorMessage(cause));
      return FALLBACK_MODEL;
    }
  }

  /**
   * The loaded engine, loading it on first use. Idempotent: the same model is loaded once and every later
   * caller gets the engine that is already there.
   *
   * The first load fetches the weights — minutes on a household connection — and every later one reads them
   * from Cache storage, which still costs the upload to the GPU. {@link progress} is what a screen shows
   * meanwhile.
   */
  async prepare(modelId?: LocalModelId): Promise<MLCEngineInterface> {
    if (!this.supported()) {
      this.stage.set('unsupported');
      throw new Error(
        'Dieser Browser kann kein Modell auf dem Gerät ausführen (WebGPU fehlt). ' +
          'Bitte einen aktuellen Chrome oder Edge verwenden.'
      );
    }
    if (this.engine && (!modelId || this.loaded() === modelId)) return this.engine;
    // Single-flight, and the flight is kept as the promise rather than the model: the screen asks as it opens
    // and the first turn asks again, and the model is only known once the GPU has been asked about itself —
    // so a second caller comparing model ids would start a second load of two gigabytes.
    if (!this.starting) {
      const run = this.begin(modelId);
      this.starting = run;
      run
        .catch(() => undefined)
        .then(() => {
          if (this.starting === run) this.starting = null;
        });
    }
    return this.starting;
  }

  /** The load itself: the model the caller named, else the one this device is judged to carry. */
  private async begin(modelId?: LocalModelId): Promise<MLCEngineInterface> {
    return this.start(modelId ?? this.loaded() ?? (await this.suggestModel()));
  }

  /** Create the worker and the engine on it, and report the load as it goes. */
  private async start(modelId: LocalModelId): Promise<MLCEngineInterface> {
    await this.unload();
    this.loaded.set(modelId);
    this.stage.set('loading');
    this.error.set(null);
    this.progress.set({ text: 'Das Modell wird vorbereitet…', done: 0 });
    console.log(`${LOG} loading ${modelId}`);
    const started = Date.now();
    try {
      // Imported here rather than at the top of the file, so the runtime is a lazy chunk: a panel that
      // never opens the chat does not carry it.
      const { CreateWebWorkerMLCEngine } = await import('@mlc-ai/web-llm');
      const worker = new Worker(new URL('../util/local-llm.worker', import.meta.url), { type: 'module' });
      const engine = await CreateWebWorkerMLCEngine(
        worker,
        modelId,
        {
          initProgressCallback: (report: InitProgressReport) =>
            this.progress.set({ text: report.text, done: report.progress })
        },
        { context_window_size: CONTEXT_WINDOW }
      );
      this.engine = engine;
      this.stage.set('ready');
      this.progress.set(null);
      console.log(`${LOG} ${modelId} ready after ${Date.now() - started}ms`);
      return engine;
    } catch (cause: unknown) {
      const message = errorMessage(cause);
      this.engine = null;
      this.loaded.set(null);
      this.stage.set('failed');
      this.progress.set(null);
      // Out of memory is the one failure worth naming, because it has an answer: a smaller model.
      const outOfMemory = /out of memory|allocation|exceeds|buffer size/i.test(message);
      this.error.set(
        outOfMemory
          ? 'Für dieses Modell reicht der Grafikspeicher nicht. Bitte in den Einstellungen ein kleineres wählen.'
          : `Das Modell konnte nicht geladen werden: ${message}`
      );
      console.warn(`${LOG} ${modelId} failed to load:`, message);
      throw cause;
    }
  }

  /**
   * One turn. The whole history goes out every time — the engine keeps no conversation of its own — and the
   * answer is streamed through `onDelta` while it is written, because a local model writes at reading speed
   * and an answer that appears only when it is finished reads as a hang.
   *
   * A stated schema constrains the decoding rather than merely asking for a shape, so what comes back parses;
   * `submit` is therefore reported for every schema turn that ran to its end.
   */
  async ask(
    messages: readonly LlmMessage[],
    options: LlmTurnOptions = {},
    retrying = false,
  ): Promise<LlmAnswer> {
    const engine = await this.prepare();
    if (!retrying) this.error.set(null);
    this.stage.set('generating');
    const started = Date.now();
    try {
      const stream = await engine.chat.completions.create({
        messages: messages as LlmMessage[],
        stream: true,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? (options.schema ? SCHEMA_MAX_TOKENS : MAX_TOKENS),
        ...(options.schema
          ? { response_format: { type: 'json_object', schema: JSON.stringify(options.schema) } }
          : {})
      });
      let text = '';
      let finish: string | null = null;
      for await (const chunk of stream) {
        const choice = chunk.choices[0];
        const delta = choice?.delta?.content ?? '';
        if (delta) {
          text += delta;
          options.onDelta?.(delta);
        }
        if (choice?.finish_reason) finish = choice.finish_reason;
      }
      const stopReason: LlmStopReason =
        finish === 'abort'
          ? 'error'
          : finish === 'length'
            ? 'token_budget'
            : options.schema
              ? 'submit'
              : 'text';
      console.log(
        `${LOG} answered in ${Date.now() - started}ms`,
        { characters: text.length, finish, stopReason }
      );
      return { text, stopReason };
    } catch (cause: unknown) {
      const message = errorMessage(cause);
      console.warn(`${LOG} the turn failed:`, message);
      // Kept, not just logged: the caller answers with the reason, and a reason that lives only in the
      // console leaves a chat saying „the model could not answer" while the console says why.
      this.error.set(message);
      // A shape the runtime refuses is the one failure with a way on. Constrained decoding compiles the
      // schema into a grammar first, and a schema it cannot compile fails the whole turn — while the
      // same question answered in prose usually succeeds. So it is asked once more without the shape:
      // the person gets an answer, the caller learns the shape was the problem (`stopReason: 'text'`
      // where it asked for `submit`), and the log says so outright.
      if (options.schema && !retrying) {
        console.warn(`${LOG} retrying without the schema — the shape may be what the runtime refused`);
        const plain = await this.ask(messages, { ...options, schema: null }, true);
        if (plain.text.trim()) {
          this.error.set(
            `Das Modell konnte die verlangte Form nicht erzeugen (${message}). Es hat in Prosa geantwortet.`,
          );
          return plain;
        }
      }
      return { text: '', stopReason: 'error' };
    } finally {
      this.stage.set(this.engine ? 'ready' : 'failed');
    }
  }

  /** Stop the answer being written. What was streamed so far stands; the turn ends where it was cut. */
  interrupt(): void {
    this.engine?.interruptGenerate();
  }

  /** Give the GPU its memory back — the depth model of the 3D conversion needs it too. */
  async unload(): Promise<void> {
    const engine = this.engine;
    this.engine = null;
    if (!engine) return;
    try {
      await engine.unload();
    } catch (cause: unknown) {
      console.warn(`${LOG} unloading failed:`, errorMessage(cause));
    }
  }
}
