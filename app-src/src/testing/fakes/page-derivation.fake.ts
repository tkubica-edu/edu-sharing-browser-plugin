import { vi } from 'vitest';

import { PageDerivationService } from '../../app/services/page-derivation.service';

/**
 * `PageDerivationService` as the two callers of it use it: the pass that reads what a page declares
 * about itself, either on its own or underneath a generated answer. Derives nothing by default, which
 * is a page whose statements say nothing the panel can use — the case every caller has to survive.
 */
export function fakePageDerivation() {
  type Derivation = Awaited<ReturnType<PageDerivationService['derive']>>;

  let derivation: Derivation = null;

  const fake = {
    derive: vi.fn((_page?: unknown): Promise<Derivation> => Promise.resolve(derivation)),
    deriveUnder: vi.fn(
      (_page?: unknown, _over?: Record<string, unknown>): Promise<Derivation> =>
        Promise.resolve(derivation),
    ),
  } satisfies Partial<PageDerivationService>;

  /** The page's own statements came to this payload, with the report naming the fields it filled. */
  function derives(payload: Record<string, unknown>, fields: string[] = Object.keys(payload)): void {
    derivation = {
      payload,
      report: {
        fields: fields.map((property) => ({ property, standing: 'filled', source: 'page' })),
      },
    } as unknown as Derivation;
  }

  return { fake, derives };
}

export type PageDerivationFake = ReturnType<typeof fakePageDerivation>;
