import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installChatOverrides } from './chat-overrides';

/** Says which `<style>` in the shadow root is the panel's. */
const MARKER = 'data-es-chat-overrides';

const MET = 'es-verdict-met';
const VIOLATED = 'es-verdict-violated';
const UNCLEAR = 'es-verdict-unclear';
const GLYPH = 'es-verdict-glyph';
const OVERTAKEN = 'es-overtaken';

/** The chat element as the widget builds it: a host with a shadow root, or one not upgraded yet. */
function aChatElement(withRoot = true): HTMLElement {
  const element = document.createElement('div');
  document.body.appendChild(element);
  if (withRoot) element.attachShadow({ mode: 'open' });
  return element;
}

/** One message row, in the markup the widget renders (see the map at the top of chat-overrides.ts). */
function aRow(kind: 'bot' | 'user', inner: string, bubble = ''): string {
  return `<div class="message-row ${kind}-row"><div class="msg-bubble ${kind}-bubble ${bubble}">${inner}</div></div>`;
}

/** The messages area holding the given rows. */
function messages(...rows: string[]): string {
  return `<div class="messages-area">${rows.join('')}</div>`;
}

/** The observer reacts on a microtask; this is what lets it run. */
async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('installChatOverrides', () => {
  let element: HTMLElement;

  beforeEach(() => {
    element = aChatElement();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('puts the sheet into the shadow root, where a document-level rule reaches nothing', () => {
    installChatOverrides(element);
    const style = element.shadowRoot!.querySelector(`style[${MARKER}]`);
    expect(style).not.toBeNull();
    expect(style!.textContent).toContain(`.${MET}`);
  });

  it('appends it last, so an equally specific rule of the panel\'s wins on order', () => {
    element.shadowRoot!.innerHTML = '<style>/* the widget\'s own */</style>';
    installChatOverrides(element);
    expect(element.shadowRoot!.lastElementChild!.hasAttribute(MARKER)).toBe(true);
  });

  it('installs the sheet once per element', () => {
    installChatOverrides(element);
    installChatOverrides(element);
    expect(element.shadowRoot!.querySelectorAll(`style[${MARKER}]`)).toHaveLength(1);
  });

  it('waits for a root the element does not have yet, and gives up on one that never comes', () => {
    vi.useFakeTimers();
    const late = aChatElement(false);
    installChatOverrides(late);

    vi.advanceTimersByTime(200);
    late.attachShadow({ mode: 'open' });
    vi.advanceTimersByTime(100);

    expect(late.shadowRoot!.querySelector(`style[${MARKER}]`)).not.toBeNull();
  });

  it('stops waiting for a bundle that never upgrades, rather than leaving an interval running', () => {
    vi.useFakeTimers();
    installChatOverrides(aChatElement(false));

    vi.advanceTimersByTime(10_000);

    expect(vi.getTimerCount()).toBe(0);
  });

  describe('verdict marking', () => {
    /** The classes on the criterion name and on the wrapped glyph of the one line in the root. */
    function marksOf(root: ShadowRoot): { name: string; glyph: string | null } {
      const name = root.querySelector('strong')!;
      const glyph = root.querySelector(`.${GLYPH}`);
      return { name: name.className, glyph: glyph && glyph.className };
    }

    it('colours the glyph and the criterion name of a line the answer found met', () => {
      element.shadowRoot!.innerHTML = messages(
        aRow('bot', '<div class="msg-content"><ul><li>✓ <strong>Neutralität</strong>: sauber.</li></ul></div>'),
      );
      installChatOverrides(element);

      expect(marksOf(element.shadowRoot!)).toEqual({ name: MET, glyph: `${GLYPH} ${MET}` });
    });

    it('reads the neighbouring glyphs the assistant reaches for as the same verdict', () => {
      for (const [glyph, expected] of [
        ['✔', MET],
        ['✅', MET],
        ['✗', VIOLATED],
        ['❌', VIOLATED],
        ['○', UNCLEAR],
        ['?', UNCLEAR],
      ] as const) {
        const chat = aChatElement();
        chat.shadowRoot!.innerHTML = messages(
          aRow('bot', `<div class="msg-content"><p>${glyph} <strong>Neutralität</strong></p></div>`),
        );
        installChatOverrides(chat);
        expect(marksOf(chat.shadowRoot!).name).toBe(expected);
      }
    });

    it('leaves a line beginning with prose in the text colour', () => {
      element.shadowRoot!.innerHTML = messages(
        aRow('bot', '<div class="msg-content"><p>Zum <strong>Ergebnis</strong>: alles in Ordnung.</p></div>'),
      );
      installChatOverrides(element);

      expect(marksOf(element.shadowRoot!)).toEqual({ name: '', glyph: null });
    });

    it('finds the glyph where markdown opened the line with whitespace', () => {
      element.shadowRoot!.innerHTML = messages(
        aRow('bot', '<div class="msg-content"><li>\n  ✓ <strong>Neutralität</strong></li></div>'),
      );
      installChatOverrides(element);

      expect(marksOf(element.shadowRoot!).glyph).toBe(`${GLYPH} ${MET}`);
    });

    it('wraps the glyph once, so marking again cannot set off the observer that ran it', async () => {
      element.shadowRoot!.innerHTML = messages(
        aRow('bot', '<div class="msg-content"><li>✓ <strong>Neutralität</strong></li></div>'),
      );
      installChatOverrides(element);
      const first = element.shadowRoot!.querySelector(`.${GLYPH}`);

      element.shadowRoot!.querySelector('.messages-area')!.appendChild(document.createElement('div'));
      await settle();

      expect(element.shadowRoot!.querySelectorAll(`.${GLYPH}`)).toHaveLength(1);
      expect(element.shadowRoot!.querySelector(`.${GLYPH}`)).toBe(first);
    });

    it('corrects a line whose verdict changed while the answer was still streaming', async () => {
      const content = '<div class="msg-content"><li>✓ <strong>Neutralität</strong></li></div>';
      element.shadowRoot!.innerHTML = messages(aRow('bot', content));
      installChatOverrides(element);

      element.shadowRoot!.querySelector(`.${GLYPH}`)!.textContent = '✗';
      await settle();

      expect(marksOf(element.shadowRoot!)).toEqual({ name: VIOLATED, glyph: `${GLYPH} ${VIOLATED}` });
    });

    it('marks a line that arrives after the sheet is in', async () => {
      element.shadowRoot!.innerHTML = messages();
      installChatOverrides(element);

      element.shadowRoot!.querySelector('.messages-area')!.innerHTML = aRow(
        'bot',
        '<div class="msg-content"><li>✗ <strong>Jugendschutz</strong></li></div>',
      );
      await settle();

      expect(marksOf(element.shadowRoot!).name).toBe(VIOLATED);
    });

    it('leaves bold text outside a criterion line alone', () => {
      element.shadowRoot!.innerHTML = messages(
        aRow('bot', '<div class="msg-content"><li>✓ <strong>Neutralität</strong> und <strong>mehr</strong></li></div>'),
      );
      installChatOverrides(element);

      const bold = element.shadowRoot!.querySelectorAll('strong');
      expect(bold[0].className).toBe(MET);
      expect(bold[1].className).toBe('');
    });
  });

  describe('overtaken answers', () => {
    /** Whether each row in the root is marked as one the conversation has moved past. */
    function overtaken(root: ShadowRoot): boolean[] {
      return Array.from(root.querySelectorAll('.messages-area > .message-row')).map((row) =>
        row.classList.contains(OVERTAKEN),
      );
    }

    it('marks an answer whose next row is an instruction the panel wrote', () => {
      element.shadowRoot!.innerHTML = messages(
        aRow('bot', 'Erste Antwort'),
        aRow('user', 'Nächster Schritt', 'host-bubble'),
        aRow('bot', 'Zweite Antwort'),
      );
      installChatOverrides(element);

      expect(overtaken(element.shadowRoot!)).toEqual([true, false, false]);
    });

    it('leaves the last answer alone — it is still what the person is being asked', () => {
      element.shadowRoot!.innerHTML = messages(aRow('bot', 'Die Antwort'));
      installChatOverrides(element);

      expect(overtaken(element.shadowRoot!)).toEqual([false]);
    });

    it('does not read a message the person sent as the panel moving on', () => {
      element.shadowRoot!.innerHTML = messages(
        aRow('bot', 'Die Antwort'),
        aRow('user', 'Eine Rückfrage'),
      );
      installChatOverrides(element);

      expect(overtaken(element.shadowRoot!)).toEqual([false, false]);
    });

    it('marks the answer when the bubble after it becomes the panel\'s, with no node added', async () => {
      element.shadowRoot!.innerHTML = messages(aRow('bot', 'Die Antwort'), aRow('user', 'Nächster Schritt'));
      installChatOverrides(element);
      expect(overtaken(element.shadowRoot!)).toEqual([false, false]);

      element.shadowRoot!.querySelector('.user-bubble')!.classList.add('host-bubble');
      await settle();

      expect(overtaken(element.shadowRoot!)).toEqual([true, false]);
    });

    it('takes the mark off again where the conversation comes back to that answer', async () => {
      element.shadowRoot!.innerHTML = messages(
        aRow('bot', 'Die Antwort'),
        aRow('user', 'Nächster Schritt', 'host-bubble'),
      );
      installChatOverrides(element);
      expect(overtaken(element.shadowRoot!)).toEqual([true, false]);

      element.shadowRoot!.querySelector('.host-bubble')!.classList.remove('host-bubble');
      await settle();

      expect(overtaken(element.shadowRoot!)).toEqual([false, false]);
    });
  });
});
