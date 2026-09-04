import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { chatSession, resetChatSession } from './chat-session';

/** The keys the chat widget keeps its conversation under; they belong to the other project (CHATBOT.md). */
const SESSION_KEY = 'boerdi_session_id';
const HINT_KEY = 'boerdi_owl_hint_session';

/**
 * Make every call on the storage refuse, as a browser with site data blocked does, and hand back the way
 * out again. Spied on the prototype rather than stubbed as a global: the way back has to be certain, since
 * a storage left denied would break every test after this one rather than this one.
 */
function denyStorage(): () => void {
  const spies = (['getItem', 'setItem', 'removeItem', 'clear'] as const).map((method) =>
    vi.spyOn(Storage.prototype, method).mockImplementation(() => {
      throw new Error('storage denied');
    }),
  );
  return () => spies.forEach((spy) => spy.mockRestore());
}

describe('chatSession', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('reads the session the widget would resume', () => {
    localStorage.setItem(SESSION_KEY, 'sitzung-1');
    expect(chatSession()).toBe('sitzung-1');
  });

  it('reads no session where the widget stored none', () => {
    expect(chatSession()).toBeNull();
  });

  it('reads no session where storage is denied, which is the same as having none', () => {
    const restore = denyStorage();
    try {
      expect(chatSession()).toBeNull();
    } finally {
      restore();
    }
  });
});

describe('resetChatSession', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('ends the stored conversation, so the next chat starts as a new one', () => {
    localStorage.setItem(SESSION_KEY, 'sitzung-1');
    resetChatSession('quality check');
    expect(chatSession()).toBeNull();
  });

  it('clears the intro hint with it, so the hint belongs to a conversation and not to the browser', () => {
    localStorage.setItem(SESSION_KEY, 'sitzung-1');
    localStorage.setItem(HINT_KEY, 'sitzung-1');
    resetChatSession('quality check');
    expect(localStorage.getItem(HINT_KEY)).toBeNull();
  });

  it('leaves everything else the page stored alone', () => {
    localStorage.setItem('edu-sharing.theme', 'dark');
    resetChatSession('quality check');
    expect(localStorage.getItem('edu-sharing.theme')).toBe('dark');
  });

  it('logs the reason, so a conversation that ended is told apart from one that never started', () => {
    localStorage.setItem(SESSION_KEY, 'sitzung-1');
    // `quiet-logs.setup.ts` has already replaced console.log for this test and restores it afterwards;
    // a second spy over that one would take its restore away, so its own mock is what is read here.
    const silenced = vi.isMockFunction(console.log);
    const logs = silenced ? vi.mocked(console.log) : vi.spyOn(console, 'log');
    logs.mockClear();

    resetChatSession('quality check');

    expect(logs).toHaveBeenCalledWith(expect.stringContaining('quality check'), { session: 'sitzung-1' });
    if (!silenced) logs.mockRestore();
  });

  it('ends nothing and throws nothing where storage is denied', () => {
    const restore = denyStorage();
    try {
      expect(() => resetChatSession('quality check')).not.toThrow();
    } finally {
      restore();
    }
  });
});
