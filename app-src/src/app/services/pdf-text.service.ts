import { Injectable, signal } from '@angular/core';
import type { PDFDocumentProxy } from 'pdfjs-dist';

import { CONTENT_TEXT_MAX } from '../util/page-context';

/**
 * The pdf.js worker, served from the extension itself: the panel's own document is the base, and the file
 * is put beside it by the build (see angular.json `assets`). A worker script may only come from the
 * extension's own origin under its content security policy, so a CDN address would be refused — and the
 * point of reading here is that nothing about the document leaves the device anyway.
 */
const WORKER_FILE = 'pdf.worker.min.mjs';

/**
 * How many pages are read at most. A textbook of several hundred pages would spend minutes on pages whose
 * text is thrown away directly afterwards: {@link CONTENT_TEXT_MAX} is reached long before that.
 */
const PAGE_MAX = 60;

/** Content types that are certainly not a document, and are refused before the body is read. */
const NOT_A_DOCUMENT = /^(text\/html|image\/|video\/|audio\/)/i;

/** Largest document fetched, in bytes. Beyond this a download costs more than its text is worth. */
const BYTES_MAX = 60 * 1024 * 1024;

/** What the document says about itself — its Info dictionary, as far as it names metadata fields. */
export interface PdfInfo {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string;
  /** When the document states it was created, in its own `D:YYYYMMDD…` notation. */
  created?: string;
}

/** A document's text and what was read to get it. */
export interface PdfText {
  /** The text, pages separated by a heading, bounded by {@link CONTENT_TEXT_MAX}. */
  text: string;
  /** How many pages the document has. */
  pages: number;
  /** How many of them the text covers — fewer where a bound cut the reading short. */
  pagesRead: number;
  /** True where {@link PAGE_MAX} or the character budget ended the reading before the last page. */
  truncated: boolean;
  /** What the document states about itself; empty for one that states nothing. */
  info: PdfInfo;
}

/** What the reader is busy with, for a caller that shows the wait. */
export type PdfStage = 'idle' | 'loading' | 'reading';

/**
 * Reads the text of a PDF on the device and nowhere else. Both the library and its worker are part of the
 * extension, so reading a document neither uploads it nor fetches anything to make sense of it.
 *
 * A scanned document carries no text layer, and for one of those this answers with an empty text rather
 * than an error: that is a property of the document, and the caller decides what to make of it.
 */
@Injectable({ providedIn: 'root' })
export class PdfTextService {
  /** What is happening right now — see {@link PdfStage}. */
  readonly stage = signal<PdfStage>('idle');

  /**
   * The library, kept as the promise rather than its result: two documents opened before the first import
   * finished would otherwise each load their own copy.
   */
  private library: Promise<typeof import('pdfjs-dist')> | null = null;

  /** The text of a document, from its bytes. */
  async read(bytes: ArrayBuffer | Uint8Array): Promise<PdfText> {
    const pdfjs = await this.load();
    // A copy, since pdf.js transfers the buffer it is given to its worker and leaves the caller's
    // view of it detached — a caller that also uploads the file would find it emptied.
    const data = bytes instanceof Uint8Array ? new Uint8Array(bytes) : new Uint8Array(bytes.slice(0));
    const task = pdfjs.getDocument({ data });
    this.stage.set('reading');
    try {
      const opened = await task.promise;
      return { ...(await readPages(opened)), info: await readInfo(opened) };
    } finally {
      // Ends the worker and every request behind it, whether the reading finished or threw.
      await task.destroy();
      this.stage.set('idle');
    }
  }

  /**
   * The text of a document named by its address. Fetched here rather than in the background worker: the
   * reading happens in this document, and a fetch from the panel carries the session's cookies, which is
   * what a document behind a login needs.
   */
  async readUrl(url: string): Promise<PdfText> {
    const response = await fetch(url, { credentials: 'include' });
    if (!response.ok) throw new Error(`Das PDF ließ sich nicht laden (HTTP ${response.status}).`);
    const type = response.headers.get('content-type') ?? '';
    // Not a check for `application/pdf`: a repository serves a download under whatever type its
    // servlet states, and pdf.js is the one that can say for certain. What is refused here is what
    // is certainly something else, so an address guessed wrong costs no download of a whole film.
    if (NOT_A_DOCUMENT.test(type)) {
      throw new Error(`Unter dieser Adresse liegt kein PDF, sondern «${type}».`);
    }
    const length = Number(response.headers.get('content-length') ?? '0');
    if (length > BYTES_MAX) throw new Error('Das PDF ist zu groß, um es hier zu lesen.');
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > BYTES_MAX) throw new Error('Das PDF ist zu groß, um es hier zu lesen.');
    // A node whose content was never written answers 200 with nothing in it; said plainly here rather
    // than left to pdf.js, whose complaint about a broken file describes something else.
    if (!bytes.byteLength) throw new Error('Unter dieser Adresse liegt eine leere Datei.');
    return this.read(bytes);
  }

  /** The library, imported on first use so the panel's own bundle does not carry it. */
  private load(): Promise<typeof import('pdfjs-dist')> {
    if (!this.library) {
      this.stage.set('loading');
      this.library = import('pdfjs-dist').then((pdfjs) => {
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(WORKER_FILE, document.baseURI).href;
        return pdfjs;
      });
      this.library.catch(() => (this.library = null));
    }
    return this.library;
  }
}

/** A document's pages as one text, bounded by page count and characters alike. */
async function readPages(opened: PDFDocumentProxy): Promise<Omit<PdfText, 'info'>> {
  const pages = opened.numPages;
  const last = Math.min(pages, PAGE_MAX);
  const parts: string[] = [];
  let length = 0;
  let pagesRead = 0;
  for (let number = 1; number <= last; number++) {
    const page = await opened.getPage(number);
    try {
      const text = pageText(await page.getTextContent());
      const part = text ? `=== SEITE ${number} ===\n${text}` : '';
      // The budget is what the text is worth downstream; a page that no longer fits is where the
      // reading stops, rather than being cut mid-sentence. It does not count as read: what
      // {@link PdfText.pagesRead} states is what the text covers.
      if (part && length + part.length > CONTENT_TEXT_MAX) break;
      pagesRead = number;
      if (!part) continue;
      parts.push(part);
      length += part.length + 2;
    } finally {
      page.cleanup();
    }
  }
  return { text: parts.join('\n\n'), pages, pagesRead, truncated: pagesRead < pages };
}

/** One page's items as lines. pdf.js marks where a line ends; everything else is one run of text. */
function pageText(content: { items: readonly unknown[] }): string {
  const lines: string[] = [];
  let line = '';
  for (const item of content.items) {
    // Marked-content items structure the page and carry no text of their own.
    const text = item as { str?: string; hasEOL?: boolean };
    if (typeof text.str !== 'string') continue;
    line += text.str;
    if (text.hasEOL) {
      const trimmed = line.trim();
      if (trimmed) lines.push(trimmed);
      line = '';
    }
  }
  const rest = line.trim();
  if (rest) lines.push(rest);
  return lines.join('\n');
}

/** What the document states about itself, dropping the fields it leaves blank. */
async function readInfo(opened: PDFDocumentProxy): Promise<PdfInfo> {
  try {
    const { info } = (await opened.getMetadata()) as unknown as {
      info?: Record<string, unknown>;
    };
    return {
      ...field('title', info?.['Title']),
      ...field('author', info?.['Author']),
      ...field('subject', info?.['Subject']),
      ...field('keywords', info?.['Keywords']),
      ...field('created', info?.['CreationDate'])
    };
  } catch {
    // A document whose Info dictionary cannot be read still has its pages, which is what was asked for.
    return {};
  }
}

function field<K extends keyof PdfInfo>(name: K, value: unknown): Partial<PdfInfo> {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? { [name]: text } : {};
}

/** Whether an address is one a PDF is expected under — its path's ending, query and fragment aside. */
export function looksLikePdf(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    return /\.pdf$/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

/**
 * A document's text as a page extraction reads: the same section headings the content script writes for an
 * HTML page (see content/content.js), so what reaches the metadata agent looks the same whether the page
 * was read off the DOM or out of a PDF.
 */
export function formatPdfText(pdf: PdfText): string {
  const lines = [
    '=== PDF ===',
    `Seiten: ${pdf.pages}${pdf.truncated ? ` (davon ${pdf.pagesRead} gelesen)` : ''}`,
    ...Object.entries(PDF_INFO_LABELS)
      .map(([key, label]) => {
        const value = pdf.info[key as keyof PdfInfo];
        return value ? `${label}: ${value}` : null;
      })
      .filter((line): line is string => line !== null)
  ];
  return `${lines.join('\n')}\n\n${pdf.text}`;
}

/** What the document's own fields are called in the extracted text. */
const PDF_INFO_LABELS: Record<keyof PdfInfo, string> = {
  title: 'Titel',
  author: 'Autor',
  subject: 'Thema',
  keywords: 'Schlagworte',
  created: 'Erstellt'
};
