import { signal } from '@angular/core';
import { vi } from 'vitest';

import { ContentFlowService } from '../../app/services/content-flow.service';

/**
 * `ContentFlowService` as the screens that offer its steps see it: every step a spy, plus whether the
 * connector question behind „Inhalt bearbeiten" is still out. Which step a call leads to is the flow's
 * own business and is covered by its spec — a screen is asserted on the step it asked for.
 */
export function fakeContentFlow() {
  const fake = {
    deciding: signal(false),
    edit: vi.fn((): Promise<void> => Promise.resolve()),
    showContentOptions: vi.fn(),
    showCurationPreview: vi.fn(),
    showQuality: vi.fn(),
    showMetadata: vi.fn(),
    showEditorialForward: vi.fn(),
    showPersonalStorage: vi.fn(),
    showOverview: vi.fn(),
    showUsages: vi.fn(),
    showShare: vi.fn(),
    showNostrForward: vi.fn(),
    showInteractions: vi.fn(),
  } satisfies Partial<ContentFlowService>;

  return { fake };
}

export type ContentFlowFake = ReturnType<typeof fakeContentFlow>;
