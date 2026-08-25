import { vi } from 'vitest';

import { PageRecognitionService } from '../../app/services/page-recognition.service';

/**
 * `PageRecognitionService` as the three moves its dependents make on it, without the repository lookup
 * behind them. Both answers default to „no content", so a spec that does not care about the recognition
 * gets a panel that found none — and the assertion its dependents are written for is that the question was
 * asked again at all (see `invalidate`).
 */
export function fakePageRecognition() {
  const fake = {
    invalidate: vi.fn(),
    recognize: vi.fn((): Promise<boolean> => Promise.resolve(false)),
    recognizeIfStale: vi.fn((): Promise<boolean> => Promise.resolve(false)),
  } satisfies Partial<PageRecognitionService>;

  return { fake };
}

export type PageRecognitionFake = ReturnType<typeof fakePageRecognition>;
