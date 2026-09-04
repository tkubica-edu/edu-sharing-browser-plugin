import { signal } from '@angular/core';
import { vi } from 'vitest';

import {
  AnalyzeOutcome,
  MetadataAgentService,
  ParsedMetadata,
} from '../../app/services/metadata-agent.service';
import { PageSource } from '../../app/services/browser-extension.service';

/** The page a run reports it was made on. */
export const A_RUN_SOURCE: PageSource = { url: 'https://example.org/optik', title: 'Optik' };

/** A run's answer, parsed the way the real service parses one. */
export function aParsedRun(raw: Record<string, unknown>): ParsedMetadata {
  return {
    fieldsExtracted: null,
    fieldsTotal: null,
    fields: Object.entries(raw)
      .filter(([key]) => key.includes(':'))
      .map(([key, value]) => ({ key, values: [String(value)] })),
    raw,
  };
}

/**
 * `MetadataAgentService` as the flow reads it: the last run, and whether one is out. The three ways in
 * are spies that put a run in place, so a spec states the outcome rather than the route — which route
 * produced a content is not something the flow behind it asks about.
 */
export function fakeMetadataAgent() {
  const lastRun = signal<AnalyzeOutcome | null>(null);

  /** What the next run answers with. */
  let outcome: AnalyzeOutcome = { ok: false, error: 'Unbekannter Fehler bei der Erschließung.' };

  const run = vi.fn(async (): Promise<AnalyzeOutcome> => {
    lastRun.set(outcome);
    return outcome;
  });

  const fake = {
    running: signal(false),
    lastRun,
    run,
    readPage: run,
    runForUrl: vi.fn(async (_url: string, _title?: string | null) => {
      lastRun.set(outcome);
      return outcome;
    }),
    extractField: vi.fn(async (_text: string, _fieldId: string) => ({ ok: true, values: [] })),
    parse: vi.fn((raw: Record<string, unknown> | undefined) => aParsedRun(raw ?? {})),
    reset: vi.fn(() => lastRun.set(null)),
    restore: vi.fn((next: AnalyzeOutcome | null) => lastRun.set(next)),
  } satisfies Partial<MetadataAgentService>;

  /** The next run reads this payload off the page. */
  function reads(raw: Record<string, unknown>, source: PageSource = A_RUN_SOURCE): void {
    outcome = { ok: true, source, parsed: aParsedRun(raw) };
  }

  /** It does not: the run failed with this message. */
  function fails(error = 'Der Seiteninhalt konnte nicht ausgelesen werden.'): void {
    outcome = { ok: false, error };
  }

  /** A run has already happened and answered with this payload — the state a later step starts in. */
  function hasRead(raw: Record<string, unknown>, source: PageSource = A_RUN_SOURCE): void {
    reads(raw, source);
    lastRun.set(outcome);
  }

  return { fake, reads, fails, hasRead, lastRun };
}

export type MetadataAgentFake = ReturnType<typeof fakeMetadataAgent>;
