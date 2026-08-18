// The chatbot's conversation, as it survives the panel: the widget keeps the id of the session it resumes in
// local storage, so a chat comes back mid-conversation after the panel was torn down and rebuilt — which
// happens on every page change. That is what a conversation is meant to do, and it is also why a screen that
// wants a fresh dialogue has to say so: nothing else ends a session, and the previous one is otherwise still
// on screen when the next check opens.
//
// The keys belong to the other project; see chatbot.md.

/** Where the widget keeps the session it resumes; a stored id means the chat comes back mid-conversation. */
const SESSION_KEY = 'boerdi_session_id';

/**
 * Where the widget notes which session it last showed its intro hint for. Cleared with the session so the
 * hint belongs to a conversation rather than to the browser.
 */
const HINT_KEY = 'boerdi_owl_hint_session';

const LOG = '[edu-sharing][boerdi]';

/** The session the widget would resume, if it stored one. Storage can be denied, which is simply no session. */
export function chatSession(): string | null {
  try {
    return localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

/**
 * End the stored conversation, so the next chat starts as a new one. Called before a screen that opens the
 * chat for an errand of its own — its dialogue is about this content and this check, and a resumed one would
 * bring the previous errand's messages with it.
 *
 * The reason is logged: a conversation that vanished is otherwise indistinguishable from one that never
 * started, and both are read from the chat's own trace.
 */
export function resetChatSession(reason: string): void {
  const session = chatSession();
  try {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(HINT_KEY);
  } catch {
    // Storage denied means there is no session to resume in the first place — nothing to end.
  }
  console.log(`${LOG} chat session ended (${reason})`, { session });
}
