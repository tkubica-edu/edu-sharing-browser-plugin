/// <reference lib="webworker" />
import { WebWorkerMLCEngineHandler } from '@mlc-ai/web-llm';

/**
 * The worker the local model runs in. Inference holds the thread it runs on for as long as a token takes, so
 * a conversation in the panel's own thread would freeze the panel for the length of every answer.
 *
 * It is a module worker from a file of the extension's own, put beside the sidebar's other chunks by the
 * build: `script-src 'self'` forbids the `blob:` URL a worker would otherwise be started from — the same
 * reason the pdf.js worker and the ONNX runtime are packaged rather than fetched (see BUILD.md).
 */
const handler = new WebWorkerMLCEngineHandler();

self.onmessage = (event: MessageEvent) => handler.onmessage(event);
