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

/** Says which `<style>` in the shadow root is ours, so it is installed once per element. */
const MARKER = 'data-es-chat-overrides';

/** How long to wait for the widget's shadow root, and how often to look for it. */
const ROOT_TIMEOUT_MS = 10_000;
const ROOT_POLL_MS = 50;

const CSS = `
/* TODO: Replace by updated chatbot version */
/* The AI notice and the widget's suggested replies under an answer the check has already moved past: the row
   after it is the panel's own instruction, so what that answer noted and offered is no longer what the
   person is being asked. The condition is on the following row, which is what :has(+ …) states — an answer
   keeps both for as long as it is the last thing said. */
.messages-area > .message-row.bot-row:has(+ .message-row.user-row:has(.host-bubble)) .ai-notice,
.messages-area > .message-row.bot-row:has(+ .message-row.user-row:has(.host-bubble)) boerdi-quick-replies {
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

/** Whether the shadow root is there — and carries the sheet once it is. */
function attach(element: HTMLElement): boolean {
  const root = element.shadowRoot;
  if (!root) return false;
  if (!root.querySelector(`style[${MARKER}]`)) {
    const style = document.createElement('style');
    style.setAttribute(MARKER, '');
    style.textContent = CSS;
    root.appendChild(style);
  }
  return true;
}
