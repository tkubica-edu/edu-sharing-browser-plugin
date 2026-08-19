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
// One correction is not a rule but a mark: the verdict glyph an answer's criteria lines start with says
// whether that criterion passed, and no selector can read text, so the classes below are put on the lines
// from script and coloured by the sheet.

/** Says which `<style>` in the shadow root is ours, so it is installed once per element. */
const MARKER = 'data-es-chat-overrides';

/** Marks the bold name of a criterion the answer found met, and one it found violated. */
const MET_CLASS = 'es-verdict-met';
const VIOLATED_CLASS = 'es-verdict-violated';

/**
 * The verdict glyphs a criterion line can start with, each with the class its name is then given. Several
 * per verdict: the check asks for ✓ and ✗, and the assistant reaches for a neighbouring glyph often enough
 * that a line marked ✔ or ❌ is the same verdict and is coloured as one. An unclear verdict (`?`) is in
 * neither list and stays in the text colour.
 */
const VERDICTS: ReadonlyArray<readonly [className: string, glyphs: readonly string[]]> = [
  [MET_CLASS, ['✓', '✔', '✅', '☑']],
  [VIOLATED_CLASS, ['✗', '✘', '❌', '×', '✕', '☒']],
];

/** How long to wait for the widget's shadow root, and how often to look for it. */
const ROOT_TIMEOUT_MS = 10_000;
const ROOT_POLL_MS = 50;

const CSS = `
/* TODO: Replace by updated chatbot version */
/* The AI notice and the widget's suggested replies under an answer the check has already moved past: the row
   after it is the panel's own instruction, so what that answer noted and offered is no longer what the
   person is being asked. The condition is on the following row, which is what :has(+ …) states — an answer
   keeps both for as long as it is the last thing said.

   The row after is a .user-row and what marks it as the panel's is the .host-bubble inside it, so the
   relative selector reaches that far down in one step. It has to: :has() may not be nested inside :has(),
   and a nested one is a syntax error — which takes the whole rule with it, both lines included, so nothing
   was hidden anywhere. Measured in the browser: 0 rules parsed, and querySelectorAll throws on it. */
.messages-area > .message-row.bot-row:has(+ .message-row.user-row .host-bubble) .ai-notice,
.messages-area > .message-row.bot-row:has(+ .message-row.user-row .host-bubble) boerdi-quick-replies {
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

/* The name of a criterion in an answer's verdict list, in the colour of its verdict: the glyph the line
   starts with says which one, and markVerdicts puts the class on the line's bold name.

   The panel's own tokens carry through the shadow boundary — custom properties inherit — with the literal
   they hold as the fallback, so the colours also hold in a document that does not define them. Declared
   important because the widget colours the text of a bubble and its markdown from its own sheet, which the shadow
   root may hold as an adopted one — those win a tie on order regardless of where this sheet sits. */
.${MET_CLASS} { color: var(--es-success, #1e8e5a) !important; }
.${VIOLATED_CLASS} { color: var(--es-danger, #c0392b) !important; }
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
  markVerdicts(root);
  new MutationObserver(() => markVerdicts(root)).observe(root, {
    subtree: true,
    childList: true,
    characterData: true,
  });
}

/**
 * Give the bold criterion name in each of an answer's verdict lines the class of that line's verdict.
 *
 * The lines are what the check asks the assistant to write — a glyph, the name of the criterion in bold,
 * then the reason. Markdown renders each as a list item, or as a paragraph where the assistant wrote them
 * without a list, so both are looked at: the glyph at the start of the line's text decides, and the class
 * goes on its first bold run. A line beginning with anything else — `?` for an unclear verdict, prose — and
 * any other bold text in the answer keep the text colour.
 */
function markVerdicts(root: ShadowRoot): void {
  for (const item of Array.from(root.querySelectorAll('.msg-content li, .msg-content p'))) {
    const name = item.querySelector('strong');
    if (!name) continue;
    const glyph = (item.textContent ?? '').trimStart().charAt(0);
    for (const [className, glyphs] of VERDICTS) {
      name.classList.toggle(className, glyphs.includes(glyph));
    }
  }
}
