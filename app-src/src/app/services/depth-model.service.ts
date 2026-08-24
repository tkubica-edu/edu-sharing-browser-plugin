import { Injectable, signal } from '@angular/core';
import type { InferenceSession } from 'onnxruntime-web';

/**
 * Monocular depth estimator: Depth Anything V2 Small, quantised to uint8 (~27 MB). The smallest ONNX
 * export that still yields a usable relief — the true image-to-3D networks (TripoSR and its kin) are
 * three orders of magnitude larger and have no browser build at all.
 */
const MODEL_URL =
  'https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/main/onnx/model_quantized.onnx';

/**
 * The onnxruntime-web WASM binary, handed to the runtime as `env.wasm.wasmBinary`. Fetched rather than
 * packaged so the extension stays small, and fetched as a *binary* rather than let the runtime load it
 * by URL: an extension page may only run scripts from its own origin, and a binary is not a script.
 *
 * A runtime and its WASM are one build, so the address is taken from the version the runtime states of
 * itself — an upgrade of the dependency then moves both at once.
 */
function wasmUrl(version: string | undefined): string {
  // Every published build states its version; one that does not is not a build this can pair a binary
  // with, and guessing would fetch a WASM the runtime cannot use.
  if (!version) throw new Error('Die ONNX-Runtime nennt ihre Version nicht.');
  return `https://cdn.jsdelivr.net/npm/onnxruntime-web@${version}/dist/ort-wasm-simd-threaded.wasm`;
}

/** Where both downloads are kept, so the first conversion is the only one that waits for them. */
const CACHE_NAME = 'es-image-to-3d-v1';

/** Longest edge the network is fed. Its own preprocessor's size; everything is scaled to fit inside it. */
const INPUT_SIZE = 518;

/** The patch size the input's edges must be a multiple of (the ViT backbone's). */
const PATCH = 14;

/** ImageNet normalisation, as the model's `preprocessor_config.json` states it. */
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

/** A depth estimate: one value per pixel, larger meaning nearer, normalised to 0…1. */
export interface DepthMap {
  data: Float32Array;
  width: number;
  height: number;
}

/** What the estimator is busy with, for a caller that shows the wait. */
export type DepthStage = 'idle' | 'downloading' | 'preparing' | 'running';

/**
 * Runs depth estimation on the device and nowhere else. The picture never leaves the browser; the only
 * things fetched are the model and the runtime, both public files and both cached after the first run.
 */
@Injectable({ providedIn: 'root' })
export class DepthModelService {
  /** What is happening right now — see {@link DepthStage}. */
  readonly stage = signal<DepthStage>('idle');

  /** Progress of the current download, 0…1; `null` while the length is unknown. */
  readonly progress = signal<number | null>(null);

  /** True once the model is in memory, so the caller can promise a fast second run. */
  readonly loaded = signal(false);

  /**
   * The session, kept as the promise rather than its result: two conversions started before the first
   * finished would otherwise each build their own, and each build costs the whole download.
   */
  private session: Promise<InferenceSession> | null = null;

  /** Depth of the picture, at the resolution the network chose for it. */
  async estimate(image: ImageBitmap | HTMLImageElement): Promise<DepthMap> {
    const session = await this.load();
    const ort = await loadRuntime();
    const input = preprocess(image);
    this.stage.set('running');
    try {
      const name = session.inputNames[0];
      const feeds = {
        [name]: new ort.Tensor('float32', input.data, [1, 3, input.height, input.width])
      };
      const output = await session.run(feeds);
      return toDepthMap(output[session.outputNames[0]]);
    } finally {
      this.stage.set('idle');
    }
  }

  /** The inference session, built on first use and kept for the rest of the session. */
  private load(): Promise<InferenceSession> {
    // A failed build must not be remembered: a download that broke off has to be retriable.
    this.session ??= this.build().catch((error: unknown) => {
      this.session = null;
      throw error;
    });
    return this.session;
  }

  private async build(): Promise<InferenceSession> {
    const ort = await loadRuntime();
    this.stage.set('downloading');
    const wasmBinary = await this.fetchCached(wasmUrl(ort.env.versions.web));
    const model = await this.fetchCached(MODEL_URL);
    this.stage.set('preparing');
    this.progress.set(null);
    ort.env.wasm.wasmBinary = wasmBinary;
    // Single-threaded on purpose: the runtime starts its worker pool from a `blob:` URL, which an
    // extension page's script policy forbids. One thread is slower but is the only one allowed.
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    const session = await ort.InferenceSession.create(model, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all'
    });
    this.loaded.set(true);
    this.stage.set('idle');
    return session;
  }

  /**
   * A download kept in the Cache storage, reported byte by byte while it runs. A cache that refuses to
   * store (a private window, a browser that keeps none for extension pages) costs the next run another
   * download and nothing else, so its failures are swallowed.
   */
  private async fetchCached(url: string): Promise<ArrayBuffer> {
    // Guarded on the object as well as on the call: not every browser hands an extension page a cache
    // storage at all, and asking one that is not there throws before a rejection could be caught.
    const cache =
      typeof caches === 'undefined' ? null : await caches.open(CACHE_NAME).catch(() => null);
    const hit = await cache?.match(url).catch(() => undefined);
    if (hit) return hit.arrayBuffer();

    const response = await fetch(url);
    if (!response.ok) throw new Error(`${response.status} ${response.statusText} für ${url}`);
    const total = Number(response.headers.get('content-length')) || 0;
    const body = response.body;
    let bytes: Uint8Array;
    if (!body) {
      this.progress.set(null);
      bytes = new Uint8Array(await response.arrayBuffer());
    } else {
      const reader = body.getReader();
      const chunks: Uint8Array[] = [];
      let read = 0;
      this.progress.set(total ? 0 : null);
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        read += value.length;
        if (total) this.progress.set(Math.min(1, read / total));
      }
      bytes = new Uint8Array(read);
      let at = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, at);
        at += chunk.length;
      }
    }
    // The view covers its buffer exactly, so handing the buffer on copies nothing.
    const buffer = bytes.buffer as ArrayBuffer;
    await cache?.put(url, new Response(buffer)).catch(() => undefined);
    return buffer;
  }
}

/** The WASM-only runtime build, loaded on first use so its ~70 kB stay out of the panel's start. */
function loadRuntime(): Promise<typeof import('onnxruntime-web')> {
  return import('onnxruntime-web/wasm');
}

/**
 * The size the picture is fed at: scaled to fit inside {@link INPUT_SIZE} with its aspect ratio kept,
 * each edge rounded to a multiple of {@link PATCH}. The model's own preprocessor would instead scale by
 * whichever factor is nearer 1, which enlarges the long edge of a wide picture far past the limit — the
 * same depth at several times the work.
 */
function targetSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(INPUT_SIZE / width, INPUT_SIZE / height);
  const round = (value: number) => Math.max(PATCH, Math.round((value * scale) / PATCH) * PATCH);
  return { width: round(width), height: round(height) };
}

/** The picture as the network's input: normalised RGB planes (NCHW), at {@link targetSize}. */
function preprocess(image: ImageBitmap | HTMLImageElement): {
  data: Float32Array;
  width: number;
  height: number;
} {
  const source = sourceSize(image);
  const { width, height } = targetSize(source.width, source.height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Kein 2D-Kontext verfügbar.');
  context.drawImage(image, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;

  const plane = width * height;
  const data = new Float32Array(plane * 3);
  for (let i = 0; i < plane; i++) {
    for (let channel = 0; channel < 3; channel++) {
      data[channel * plane + i] = (pixels[i * 4 + channel] / 255 - MEAN[channel]) / STD[channel];
    }
  }
  return { data, width, height };
}

function sourceSize(image: ImageBitmap | HTMLImageElement): { width: number; height: number } {
  const width = 'naturalWidth' in image ? image.naturalWidth : image.width;
  const height = 'naturalHeight' in image ? image.naturalHeight : image.height;
  if (!width || !height) throw new Error('Das Bild hat keine lesbaren Maße.');
  return { width, height };
}

/**
 * The network's output as a depth map normalised to 0…1. The values it produces are inverse depth on an
 * arbitrary scale — comparable within one picture and meaningless between two — so only their order
 * carries over, which is exactly what a relief needs.
 */
function toDepthMap(tensor: { dims: readonly number[]; data: unknown }): DepthMap {
  const dims = tensor.dims;
  const height = dims[dims.length - 2];
  const width = dims[dims.length - 1];
  const raw = tensor.data as Float32Array;
  let min = Infinity;
  let max = -Infinity;
  for (const value of raw) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  const span = max - min || 1;
  const data = new Float32Array(width * height);
  for (let i = 0; i < data.length; i++) data[i] = (raw[i] - min) / span;
  return { data, width, height };
}

