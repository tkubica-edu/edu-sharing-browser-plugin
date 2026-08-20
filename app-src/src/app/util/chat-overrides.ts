// Corrections to what the chat widget puts on screen, applied from outside it.
//
// They travel as a stylesheet inside the widget's shadow root, not in the panel's global stylesheet: the
// widget's root component renders with `ViewEncapsulation.ShadowDom`, so its whole view — panel, message
// rows, quick replies — sits behind that boundary, where a document-level rule reaches nothing. The rows
// inside it are ordinary light DOM of that tree, so once the sheet is in the root its classes address them
// directly.
//
// The rows the selectors below address are the children of `.messages-area`, one per message:
//
//   .message-row.bot-row   > .msg-bubble.bot-bubble  > .msg-content, p.ai-notice, boerdi-quick-replies
//   .message-row.user-row  > .msg-bubble.user-bubble[.host-bubble] > .msg-content
//
// `.host-bubble` marks a user row the panel wrote itself — the step's instruction — as against one the
// person sent.
//
// Two corrections are not rules but marks, put on from script and only styled by the sheet:
//
//   * the verdict glyph an answer's criteria lines start with says whether that criterion passed, and no
//     selector can read text. The glyph itself arrives as a bare text node with nothing to address, so it is
//     wrapped in a span of its own to be coloured along with the name it introduces.
//   * whether an answer has been overtaken by the panel's next instruction. CSS *can* say this one
//     (`:has(+ …)`), and it was said that way — but the condition turns true through a change in the
//     following row, and Safari does not reliably re-style the earlier one for it. See markOvertaken.

/** Says which `<style>` in the shadow root is ours, so it is installed once per element. */
const MARKER = 'data-es-chat-overrides';

/**
 * Marks the bold name of a criterion the answer found met, one it found violated, and one it could not
 * decide — the third is a verdict of its own, not the absence of one: nothing is recorded for it and it
 * is what the person is asked to look at again.
 */
const MET_CLASS = 'es-verdict-met';
const VIOLATED_CLASS = 'es-verdict-violated';
const UNCLEAR_CLASS = 'es-verdict-unclear';

/** Says which span holds a line's verdict glyph, so a line already marked is recognised as marked. */
const GLYPH_CLASS = 'es-verdict-glyph';

/**
 * Marks an answer the conversation has moved past: the row after it is the panel's own instruction, so what
 * that answer noted and offered is no longer what the person is being asked. Put on from script rather than
 * stated as a condition in the sheet — see {@link markOvertaken}.
 */
const OVERTAKEN_CLASS = 'es-overtaken';

/**
 * The verdict glyphs a criterion line can start with, each with the class its name is then given. Several
 * per verdict: the check asks for ✓, ✗ and ○, and the assistant reaches for a neighbouring glyph often
 * enough that a line marked ✔ or ❌ is the same verdict and is coloured as one. The question mark the check
 * asked for before an open circle counts as unclear too, since a conversation may still be holding it.
 * A line starting with anything else — prose — is in no list and stays in the text colour.
 */
const VERDICTS: ReadonlyArray<readonly [className: string, glyphs: readonly string[]]> = [
  [MET_CLASS, ['✓', '✔', '✅', '☑']],
  [VIOLATED_CLASS, ['✗', '✘', '❌', '×', '✕', '☒']],
  [UNCLEAR_CLASS, ['○', '◯', '◌', '⚪', '◦', '–', '—', '?', '？']],
];

/** How long to wait for the widget's shadow root, and how often to look for it. */
const ROOT_TIMEOUT_MS = 10_000;
const ROOT_POLL_MS = 50;

const CSS = `
/* TODO: Replace by updated chatbot version */
/* The AI notice and the widget's suggested replies under an answer the conversation has moved past — the
   class says which answer that is, and markOvertaken is what puts it on. Plain descendant selectors, so the
   rule holds the moment the class does, in every engine. */
.message-row.${OVERTAKEN_CLASS} .ai-notice,
.message-row.${OVERTAKEN_CLASS} boerdi-quick-replies {
  display: none;
}

/* TODO: Replace by updated chatbot version */
/* The widget's own sign-in and new-chat buttons in the footer, beside the input and the send button. Named
   with their tag as well, so the rule outranks the widget's own display rule on both regardless of the
   order the two sheets end up in. */
.chat-footer > button.btn-auth,
.chat-footer > button.btn-restart {
  display: none;
}

/* The glyph and the name of a criterion in an answer's verdict list, in the colour of its verdict: the
   glyph the line starts with says which one, and markVerdicts puts the class on both the span it wraps that
   glyph in and the line's bold name.

   The panel's own tokens carry through the shadow boundary — custom properties inherit — with the literal
   they hold as the fallback, so the colours also hold in a document that does not define them. Declared
   important because the widget colours the text of a bubble and its markdown from its own sheet, which the shadow
   root may hold as an adopted one — those win a tie on order regardless of where this sheet sits. */
.${MET_CLASS} { color: var(--es-success, #1e8e5a) !important; }
.${VIOLATED_CLASS} { color: var(--es-danger, #c0392b) !important; }
.${UNCLEAR_CLASS} { color: var(--es-warning, #9a6300) !important; }
`;

/**
 * Put the overrides into the chat element's shadow root, once it has one.
 *
 * Waited for rather than assumed: the root is created when the element is upgraded and its component built,
 * which is not guaranteed to have happened by the time the element is in the document. The wait is bounded,
 * so a bundle that never upgrades costs a stylesheet rather than a running interval.
 *
 * Appended last, after the widget's own sheets, so an equally specific rule of ours wins on order.
 */
export function installChatOverrides(element: HTMLElement): void {
  if (attach(element)) return;
  let waited = 0;
  const poll = window.setInterval(() => {
    waited += ROOT_POLL_MS;
    if (attach(element) || waited >= ROOT_TIMEOUT_MS) clearInterval(poll);
  }, ROOT_POLL_MS);
}

/** Whether the shadow root is there — and carries the sheet and the verdict marking once it is. */
function attach(element: HTMLElement): boolean {
  const root = element.shadowRoot;
  if (!root) return false;
  if (!root.querySelector(`style[${MARKER}]`)) {
    const style = document.createElement('style');
    style.setAttribute(MARKER, '');
    style.textContent = CSS;
    root.appendChild(style);
    observeVerdicts(root);
  }
  return true;
}

/**
 * Keep the verdict marking up with the messages: an answer arrives as new rows, and while it streams the
 * text of a row it is still writing changes under it, so both kinds of change are watched over the whole
 * tree. Marking is idempotent and reads only what is already in the DOM, so running it again on the rows it
 * has already seen costs a class that is set to what it holds.
 *
 * The observer lives as long as the shadow root does, which is as long as the element: it is dropped with
 * the tree it watches when the chat is destroyed.
 */
function observeVerdicts(root: ShadowRoot): void {
  mark(root);
  new MutationObserver(() => mark(root)).observe(root, {
    subtree: true,
    childList: true,
    characterData: true,
    // `host-bubble` is a class the widget toggles on a bubble that is already there, so the row after an
    // answer can become the panel's instruction without any node being added — see markOvertaken. Marking
    // sets classes itself, which cannot chase its own tail: a class already set is not written again, so no
    // record is queued for it and the second pass over a tree ends the run.
    attributes: true,
    attributeFilter: ['class'],
  });
}

/** Both marks the sheet works off, in one pass over the tree as it now stands. */
function mark(root: ShadowRoot): void {
  markVerdicts(root);
  markOvertaken(root);
}

/**
 * Mark every answer the conversation has moved past: one whose next row is an instruction the panel wrote —
 * a `.user-row` with a `.host-bubble` in it. The last answer keeps its notice and its chips, being still
 * what the person is being asked.
 *
 * Read here rather than stated as a selector, although CSS can say it: `:has(+ .message-row.user-row
 * .host-bubble)` is exactly this condition, and Safari does not always re-style the earlier row when the
 * condition turns true — which happens deep inside the *following* row, the weakest case of `:has()`
 * invalidation. The notice and the chips then stayed on screen until something else forced a recalculation;
 * re-entering the screen was one, which is how it looked intermittent. The observer above is told about the
 * very changes that turn the condition true, so the mark is put on where CSS was asked to notice it.
 */
function markOvertaken(root: ShadowRoot): void {
  const rows = Array.from(root.querySelectorAll('.messages-area > .message-row'));
  rows.forEach((row, index) => {
    const next = rows[index + 1];
    const overtaken =
      row.classList.contains('bot-row') &&
      !!next?.classList.contains('user-row') &&
      !!next.querySelector('.host-bubble');
    row.classList.toggle(OVERTAKEN_CLASS, overtaken);
  });
}

/**
 * Give the glyph and the bold criterion name in each of an answer's verdict lines the class of that line's
 * verdict.
 *
 * The lines are what the check asks the assistant to write — a glyph, the name of the criterion in bold,
 * then the reason. Markdown renders each as a list item, or as a paragraph where the assistant wrote them
 * without a list, so both are looked at: the glyph at the start of the line's text decides, and the classes
 * go on its first bold run and on the glyph itself. A line beginning with anything else — `?` for an unclear
 * verdict, prose — and any other bold text in the answer keep the text colour.
 */
function markVerdicts(root: ShadowRoot): void {
  for (const item of Array.from(root.querySelectorAll('.msg-content li, .msg-content p'))) {
    const name = item.querySelector('strong');
    if (!name) continue;
    const glyph = (item.textContent ?? '').trimStart().charAt(0);
    const verdict = VERDICTS.find(([, glyphs]) => glyphs.includes(glyph));
    for (const [className] of VERDICTS) {
      name.classList.toggle(className, className === verdict?.[0]);
    }
    if (verdict) wrapGlyph(item, glyph, verdict[0]);
  }
}

/**
 * Put the line's leading glyph into a span carrying the verdict's class, so the sheet can colour it.
 *
 * Idempotent, which the observer relies on: a line whose glyph is already wrapped only has the class
 * corrected, and the wrapping itself is one more childList change under a tree that is watched for them —
 * were it repeated, marking would set off the observer that set it off. The glyph is looked for in the
 * line's first text node with something in it, since markdown may open the line with whitespace.
 */
function wrapGlyph(item: Element, glyph: string, className: string): void {
  const marked = item.querySelector(`.${GLYPH_CLASS}`);
  if (marked) {
    for (const [name] of VERDICTS) marked.classList.toggle(name, name === className);
    return;
  }
  const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode() as Text | null;
  while (node && !node.data.trim()) node = walker.nextNode() as Text | null;
  const at = node?.data.search(/\S/) ?? -1;
  if (!node || at < 0 || node.data.charAt(at) !== glyph) return;
  // Cut the glyph out of the text node and put the span where it stood.
  const rest = node.splitText(at);
  rest.splitText(glyph.length);
  const span = item.ownerDocument.createElement('span');
  span.className = `${GLYPH_CLASS} ${className}`;
  span.textContent = glyph;
  rest.replaceWith(span);
}
